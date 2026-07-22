//! SSH 宿主上的 Docker/Podman 容器服务。
//!
//! @author kongweiguang

use crate::{
    error::{AppError, AppResult},
    models::{
        docker::{
            DockerComposeMetadata, DockerComposeRuntimeFamily, DockerContainerChmodRequest,
            DockerContainerDeleteRequest, DockerContainerDirectoryListing,
            DockerContainerFilePreview, DockerContainerInfoRequest, DockerContainerInspectSummary,
            DockerContainerLifecycleAction, DockerContainerLifecycleRequest,
            DockerContainerLifecycleResult, DockerContainerListRequest, DockerContainerLogsRequest,
            DockerContainerLogsResult, DockerContainerPathRequest, DockerContainerPreviewRequest,
            DockerContainerReadTextFileRequest, DockerContainerReadTextFileResponse,
            DockerContainerRenameRequest, DockerContainerStatsRequest, DockerContainerStatsResult,
            DockerContainerStatus, DockerContainerSummary, DockerContainerTerminalCreateRequest,
            DockerContainerTransferRequest, DockerContainerWriteTextFileRequest,
            DockerContainerWriteTextFileResponse,
        },
        remote_host::RemoteHost,
        sftp::{SftpEntry, SftpEntryKind, SftpFileRevision, SftpTransferKind},
        ssh_command::SshCommandRequest,
        target::{ContainerRuntime, RemoteTargetRef, TargetCapabilities},
        terminal::{SshTerminalCreateRequest, TerminalOutputEvent, TerminalSessionSummary},
    },
    paths::KerminalPaths,
    services::{
        external_launch::is_external_target_id, remote_host_service::RemoteHostService,
        ssh_command_service::SshCommandService, ssh_terminal_service::SshTerminalService,
        terminal_manager::TerminalManager,
    },
};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs::{self, File as StdFile},
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    thread,
};
use tar::{Archive, Builder};
use uuid::Uuid;

const CONTAINER_LIST_TIMEOUT_SECONDS: u64 = 60;
const CONTAINER_LIST_OUTPUT_BYTES: usize = 128 * 1024;
const CONTAINER_LIFECYCLE_TIMEOUT_SECONDS: u64 = 30;
const CONTAINER_LIFECYCLE_OUTPUT_BYTES: usize = 64 * 1024;
const CONTAINER_INSPECT_TIMEOUT_SECONDS: u64 = 60;
const CONTAINER_INSPECT_OUTPUT_BYTES: usize = 512 * 1024;
const CONTAINER_LOGS_TIMEOUT_SECONDS: u64 = 20;
const CONTAINER_LOGS_OUTPUT_BYTES: usize = 256 * 1024;
const CONTAINER_STATS_TIMEOUT_SECONDS: u64 = 20;
const CONTAINER_STATS_OUTPUT_BYTES: usize = 64 * 1024;
const DEFAULT_CONTAINER_LOG_TAIL: u16 = 200;
const MAX_CONTAINER_LOG_TAIL: u16 = 1000;
const CONTAINER_FILE_TIMEOUT_SECONDS: u64 = 30;
const CONTAINER_FILE_OUTPUT_BYTES: usize = 512 * 1024;
const DEFAULT_PREVIEW_BYTES: usize = 64 * 1024;
const MAX_PREVIEW_BYTES: usize = 1024 * 1024;
const DEFAULT_TEXT_FILE_BYTES: usize = 10 * 1024 * 1024;
const MAX_TEXT_FILE_BYTES: usize = 10 * 1024 * 1024;
const CONTAINER_TRANSFER_TIMEOUT_SECONDS: u64 = 30 * 60;

mod file_ops;
mod helpers;
mod normalization;
mod parsing;
mod runtime_ops;
mod script;
mod terminal_request;
mod text_file;
mod transfer;

#[doc(hidden)]
pub mod rules {
    pub use super::parsing::{
        merge_container_summary_labels, parse_compose_metadata,
        parse_container_label_inspect_output, parse_container_list_output, parse_ls_entries,
        split_preview_output,
    };
    pub use super::script::{
        build_container_exec_script, build_container_inspect_script,
        build_container_label_inspect_script, build_container_lifecycle_script,
        build_container_logs_script, build_container_stats_script,
    };
    pub use super::terminal_request::build_container_terminal_remote_command;
    pub use super::text_file::{detect_line_ending, same_revision, split_text_output};
    pub use super::transfer::{extract_first_file, write_tar_stream};
    pub use super::{parse_container_inspect_summary, parse_container_stats_output};
}

use self::{
    helpers::{
        field_string, first_csv_value, first_non_empty, normalize_optional, normalize_required,
        shell_quote, short_container_id,
    },
    normalization::{
        ensure_not_root_for_write, normalize_chmod_request, normalize_delete_request,
        normalize_path_request, normalize_preview_request, normalize_read_text_file_request,
        normalize_rename_request, normalize_transfer_request, normalize_write_text_file_request,
        parent_remote_path, remote_file_name,
    },
    parsing::{
        container_summary_needs_label_inspect, merge_container_summary_labels,
        parse_container_label_inspect_output, parse_container_list_output, parse_ls_entries,
        split_preview_output,
    },
    script::{
        build_container_inspect_script, build_container_label_inspect_script,
        build_container_lifecycle_script, build_container_list_script, build_container_logs_script,
        build_container_stats_script, execute_container_script, ContainerScriptRequest,
    },
    terminal_request::{build_container_terminal_remote_command, resolve_host},
    text_file::{
        container_file_revision, detect_line_ending, read_container_text_file, same_revision,
        validate_text_encoding, write_temp_container_text_file,
    },
    transfer::{download_from_container, upload_to_container},
};

pub(crate) use self::script::build_container_exec_script;

/// Docker/Podman 容器业务入口。
#[derive(Debug, Default)]
pub struct DockerHostService;

impl DockerHostService {
    /// 创建容器服务。
    pub fn new() -> Self {
        Self
    }

    /// 创建指定容器的交互式终端会话。
    pub fn create_container_session<F>(
        &self,
        remote_hosts: &RemoteHostService,
        paths: &KerminalPaths,
        ssh_terminals: &SshTerminalService,
        terminals: &TerminalManager,
        request: DockerContainerTerminalCreateRequest,
        output: F,
    ) -> AppResult<TerminalSessionSummary>
    where
        F: Fn(TerminalOutputEvent) -> bool + Send + 'static,
    {
        let terminal_request = self.resolve_container_ssh_terminal_request(request)?;
        ssh_terminals.create_session(remote_hosts, paths, terminals, terminal_request, output)
    }

    /// 上传本地文件或目录到容器。
    pub async fn upload(
        &self,
        remote_hosts: &RemoteHostService,
        paths: &KerminalPaths,
        ssh_commands: &SshCommandService,
        request: DockerContainerTransferRequest,
    ) -> AppResult<bool> {
        let request = normalize_transfer_request(request)?;
        ensure_not_root_for_write(&request.remote_path)?;
        let host = resolve_host(remote_hosts, paths, ssh_commands, &request.host_id)?;
        upload_to_container(paths, ssh_commands, &host, request).await?;
        Ok(true)
    }

    /// 下载容器内文件或目录到本地。
    pub async fn download(
        &self,
        remote_hosts: &RemoteHostService,
        paths: &KerminalPaths,
        ssh_commands: &SshCommandService,
        request: DockerContainerTransferRequest,
    ) -> AppResult<bool> {
        let request = normalize_transfer_request(request)?;
        let host = resolve_host(remote_hosts, paths, ssh_commands, &request.host_id)?;
        download_from_container(paths, ssh_commands, &host, request).await?;
        Ok(true)
    }

    /// 将容器目标解析为普通 SSH 终端启动请求，复用 SSH 密码/私钥/跳板链。
    pub fn resolve_container_ssh_terminal_request(
        &self,
        request: DockerContainerTerminalCreateRequest,
    ) -> AppResult<SshTerminalCreateRequest> {
        let host_id = request.host_id.clone();
        let rows = request.rows;
        let cols = request.cols;
        let remote_command = build_container_terminal_remote_command(request)?;

        Ok(SshTerminalCreateRequest {
            host_id,
            cwd: None,
            remote_command: Some(remote_command),
            cols,
            rows,
        })
    }
}

fn lifecycle_action_label(action: DockerContainerLifecycleAction) -> &'static str {
    match action {
        DockerContainerLifecycleAction::Start => "启动",
        DockerContainerLifecycleAction::Stop => "停止",
        DockerContainerLifecycleAction::Restart => "重启",
        DockerContainerLifecycleAction::Remove => "删除",
    }
}

pub fn parse_container_inspect_summary(
    host_id: &str,
    container_id: &str,
    runtime: ContainerRuntime,
    output: &str,
) -> AppResult<DockerContainerInspectSummary> {
    let value: Value = serde_json::from_str(output.trim())?;
    let subject = value
        .as_array()
        .and_then(|items| items.first())
        .unwrap_or(&value);
    let name = json_string(subject.pointer("/Name"))
        .map(|value| value.trim_start_matches('/').to_owned())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| container_id.to_owned());
    let status = json_string(subject.pointer("/State/Status")).unwrap_or_else(|| "unknown".into());

    Ok(DockerContainerInspectSummary {
        command: json_array_strings(subject.pointer("/Config/Cmd")),
        container_id: container_id.to_owned(),
        created: json_string(subject.get("Created")),
        entrypoint: json_array_strings(subject.pointer("/Config/Entrypoint")),
        finished_at: json_string(subject.pointer("/State/FinishedAt")),
        host_id: host_id.to_owned(),
        id: json_string(subject.get("Id")).unwrap_or_else(|| container_id.to_owned()),
        image: json_string(subject.pointer("/Config/Image"))
            .or_else(|| json_string(subject.get("Image")))
            .unwrap_or_default(),
        labels: json_string_map(subject.pointer("/Config/Labels")),
        name,
        networks: json_object_keys(subject.pointer("/NetworkSettings/Networks")),
        ports: inspect_ports(subject.pointer("/NetworkSettings/Ports")),
        raw_json: serde_json::to_string_pretty(subject)
            .unwrap_or_else(|_| output.trim().to_owned()),
        running: json_bool(subject.pointer("/State/Running")).unwrap_or(false),
        runtime,
        started_at: json_string(subject.pointer("/State/StartedAt")),
        status,
        user: json_non_empty_string(subject.pointer("/Config/User")),
        working_dir: json_non_empty_string(subject.pointer("/Config/WorkingDir")),
    })
}

pub fn parse_container_stats_output(
    host_id: &str,
    container_id: &str,
    runtime: ContainerRuntime,
    output: &str,
) -> DockerContainerStatsResult {
    let trimmed = output.trim();
    let value = serde_json::from_str::<Value>(trimmed).ok();
    let subject = value.as_ref();

    DockerContainerStatsResult {
        block_io: first_json_field(subject, &["BlockIO", "BlockI", "blockIO", "block_io"]),
        container_id: container_id.to_owned(),
        cpu_percent: first_json_field(subject, &["CPUPerc", "CPU%", "cpuPercent", "cpu_percent"]),
        host_id: host_id.to_owned(),
        memory_percent: first_json_field(subject, &["MemPerc", "Mem%", "memoryPercent"]),
        memory_usage: first_json_field(subject, &["MemUsage", "Mem", "memoryUsage"]),
        network_io: first_json_field(subject, &["NetIO", "Net", "networkIO", "network_io"]),
        pids: first_json_field(subject, &["PIDs", "Pids", "pids"]),
        raw: trimmed.to_owned(),
        runtime,
    }
}

fn json_string(value: Option<&Value>) -> Option<String> {
    value.and_then(|value| match value {
        Value::String(text) => Some(text.clone()),
        Value::Number(number) => Some(number.to_string()),
        Value::Bool(value) => Some(value.to_string()),
        _ => None,
    })
}

fn json_non_empty_string(value: Option<&Value>) -> Option<String> {
    json_string(value).filter(|value| !value.trim().is_empty())
}

fn json_bool(value: Option<&Value>) -> Option<bool> {
    value.and_then(Value::as_bool)
}

fn json_array_strings(value: Option<&Value>) -> Vec<String> {
    match value {
        Some(Value::Array(items)) => items
            .iter()
            .filter_map(|item| json_string(Some(item)))
            .collect(),
        Some(Value::String(text)) if !text.trim().is_empty() => vec![text.clone()],
        _ => Vec::new(),
    }
}

fn json_string_map(value: Option<&Value>) -> BTreeMap<String, String> {
    let mut values = BTreeMap::new();
    if let Some(Value::Object(map)) = value {
        for (key, value) in map {
            if let Some(text) = json_string(Some(value)) {
                values.insert(key.clone(), text);
            }
        }
    }
    values
}

fn json_object_keys(value: Option<&Value>) -> Vec<String> {
    match value {
        Some(Value::Object(map)) => map.keys().cloned().collect(),
        _ => Vec::new(),
    }
}

fn inspect_ports(value: Option<&Value>) -> Vec<String> {
    let Some(Value::Object(ports)) = value else {
        return Vec::new();
    };
    let mut summaries = Vec::new();
    for (container_port, bindings) in ports {
        match bindings {
            Value::Array(items) if !items.is_empty() => {
                for binding in items {
                    let host_ip = json_string(binding.get("HostIp")).unwrap_or_default();
                    let host_port = json_string(binding.get("HostPort")).unwrap_or_default();
                    let host = match (host_ip.trim().is_empty(), host_port.trim().is_empty()) {
                        (true, true) => String::new(),
                        (true, false) => host_port,
                        (false, true) => host_ip,
                        (false, false) => format!("{host_ip}:{host_port}"),
                    };
                    summaries.push(if host.is_empty() {
                        container_port.clone()
                    } else {
                        format!("{host}->{container_port}")
                    });
                }
            }
            _ => summaries.push(container_port.clone()),
        }
    }
    summaries
}

fn first_json_field(value: Option<&Value>, keys: &[&str]) -> Option<String> {
    let object = value.and_then(Value::as_object)?;
    keys.iter()
        .find_map(|key| json_non_empty_string(object.get(*key)))
}
