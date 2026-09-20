//! MCP SFTP tool adapters and the canonical source/destination transfer contract.
//!
//! @author kongweiguang

use serde::Deserialize;

use super::*;
use crate::models::sftp::{SftpRemoteCopyRequest, SftpTransferEndpoint};

/// MCP 统一传输请求在现有 SFTP 队列中的路由结果。
///
/// 这个 enum 只负责把 Agent 的端点语义映射到已有 managed transfer 或 remote copy
/// 引擎，避免在 MCP 层复制一套传输实现，也让路由规则可以脱离网络执行单测。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SftpTransferRoute {
    /// 本机与单个远程主机之间的 managed upload/download。
    Managed(SftpManagedTransferRequest),
    /// 两个远程端点之间的 remote copy，实际 transport mode 由服务自动选择。
    RemoteCopy(SftpRemoteCopyRequest),
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
enum CanonicalSftpEndpoint {
    /// Kerminal 所在本机的文件系统端点。
    Local { path: String },
    /// 已保存的 SSH/SFTP 主机端点。
    Remote {
        /// 保存的远程主机 id。
        #[serde(rename = "hostId")]
        host_id: String,
        /// 远程文件或目录路径。
        path: String,
    },
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CanonicalSftpTransferRequest {
    /// 待复制的来源端点。
    source: CanonicalSftpEndpoint,
    /// 待写入的目标端点。
    destination: CanonicalSftpEndpoint,
    /// 文件或目录。
    kind: SftpTransferKind,
    /// 目标冲突处理策略。
    conflict_policy: SftpTransferConflictPolicy,
}

pub(super) async fn execute_sftp_rename(
    sftp: &SftpService,
    paths: &KerminalPaths,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let request = match sftp_rename_request_from_arguments(arguments) {
        Ok(request) => request,
        Err(error) => return failure(error.to_string()),
    };
    let summary = summarize_sftp_rename_for_agent(&request);

    match sftp.rename(paths, request).await {
        Ok(true) => ToolExecutionResult {
            status: McpToolExecutionStatus::Succeeded,
            result_summary: Some(summary),
            error: None,
            ..ToolExecutionResult::default()
        },
        Ok(false) => failure("SFTP 重命名未完成。"),
        Err(error) => failure(error.to_string()),
    }
}

pub(super) fn sftp_rename_request_from_arguments(
    arguments: &serde_json::Map<String, Value>,
) -> AppResult<SftpRenameRequest> {
    Ok(SftpRenameRequest {
        host_id: required_string_arg(arguments, "hostId")?,
        from_path: required_string_arg(arguments, "fromPath")?,
        to_path: required_string_arg(arguments, "toPath")?,
    })
}

pub(super) fn summarize_sftp_rename_for_agent(request: &SftpRenameRequest) -> String {
    format!(
        "远程路径已重命名：{}:{} -> {}。",
        request.host_id, request.from_path, request.to_path
    )
}

pub(super) async fn execute_sftp_move(
    sftp: &SftpService,
    paths: &KerminalPaths,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let request = match sftp_rename_request_from_arguments(arguments) {
        Ok(request) => request,
        Err(error) => return failure(error.to_string()),
    };
    let summary = summarize_sftp_move_for_agent(&request);

    match sftp.rename(paths, request).await {
        Ok(true) => ToolExecutionResult {
            status: McpToolExecutionStatus::Succeeded,
            result_summary: Some(summary),
            error: None,
            ..ToolExecutionResult::default()
        },
        Ok(false) => failure("SFTP 移动未完成。"),
        Err(error) => failure(error.to_string()),
    }
}

pub(super) fn summarize_sftp_move_for_agent(request: &SftpRenameRequest) -> String {
    format!(
        "远程路径已移动：{}:{} -> {}。",
        request.host_id, request.from_path, request.to_path
    )
}

pub(super) async fn execute_sftp_preview(
    sftp: &SftpService,
    paths: &KerminalPaths,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let request = match sftp_preview_request_from_arguments(arguments) {
        Ok(request) => request,
        Err(error) => return failure(error.to_string()),
    };

    match sftp.preview_file(paths, request).await {
        Ok(preview) => ToolExecutionResult {
            status: McpToolExecutionStatus::Succeeded,
            result_summary: Some(summarize_sftp_preview_for_agent(&preview)),
            error: None,
            ..ToolExecutionResult::default()
        },
        Err(error) => failure(error.to_string()),
    }
}

pub(super) fn sftp_preview_request_from_arguments(
    arguments: &serde_json::Map<String, Value>,
) -> AppResult<SftpPreviewRequest> {
    Ok(SftpPreviewRequest {
        host_id: required_string_arg(arguments, "hostId")?,
        path: required_string_arg(arguments, "path")?,
        max_bytes: optional_usize_arg(arguments, "maxBytes")?,
    })
}

/// 将 SFTP 文件预览压缩成外部 Agent 可读摘要，避免返回完整文件内容。
pub fn summarize_sftp_preview_for_agent(preview: &SftpFilePreview) -> String {
    let sample = preview
        .content
        .lines()
        .take(4)
        .collect::<Vec<_>>()
        .join(" ");
    let sample = collapse_whitespace(&sample);
    let sample = truncate_string(&sample);
    let (sample, redacted) = redact_terminal_text(&sample);
    let redaction_label = if redacted { "，片段已脱敏" } else { "" };
    let truncation_label = if preview.truncated {
        "，内容已截断"
    } else {
        ""
    };

    if sample.is_empty() {
        format!(
            "远程文件已预览：{}:{}，读取 {} / {} 字节{}{}。",
            preview.host_id,
            preview.path,
            preview.bytes_read,
            preview.max_bytes,
            truncation_label,
            redaction_label
        )
    } else {
        format!(
            "远程文件已预览：{}:{}，读取 {} / {} 字节{}{}，片段：{}。",
            preview.host_id,
            preview.path,
            preview.bytes_read,
            preview.max_bytes,
            truncation_label,
            redaction_label,
            sample
        )
    }
}

pub(super) async fn execute_sftp_create_directory(
    sftp: &SftpService,
    paths: &KerminalPaths,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let request = match sftp_path_request_from_arguments(arguments) {
        Ok(request) => request,
        Err(error) => return failure(error.to_string()),
    };
    let summary = format!("远程目录已创建：{}:{}。", request.host_id, request.path);

    match sftp.create_directory(paths, request).await {
        Ok(true) => ToolExecutionResult {
            status: McpToolExecutionStatus::Succeeded,
            result_summary: Some(summary),
            error: None,
            ..ToolExecutionResult::default()
        },
        Ok(false) => failure("SFTP 创建目录未完成。"),
        Err(error) => failure(error.to_string()),
    }
}

pub(super) fn sftp_path_request_from_arguments(
    arguments: &serde_json::Map<String, Value>,
) -> AppResult<SftpPathRequest> {
    Ok(SftpPathRequest {
        host_id: required_string_arg(arguments, "hostId")?,
        path: required_string_arg(arguments, "path")?,
    })
}

pub(super) async fn execute_sftp_chmod(
    sftp: &SftpService,
    paths: &KerminalPaths,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let request = match sftp_chmod_request_from_arguments(arguments) {
        Ok(request) => request,
        Err(error) => return failure(error.to_string()),
    };
    let summary = format!(
        "远程路径权限已修改：{}:{} -> {}。",
        request.host_id, request.path, request.mode
    );

    match sftp.chmod(paths, request).await {
        Ok(true) => ToolExecutionResult {
            status: McpToolExecutionStatus::Succeeded,
            result_summary: Some(summary),
            error: None,
            ..ToolExecutionResult::default()
        },
        Ok(false) => failure("SFTP chmod 未完成。"),
        Err(error) => failure(error.to_string()),
    }
}

pub(super) fn sftp_chmod_request_from_arguments(
    arguments: &serde_json::Map<String, Value>,
) -> AppResult<SftpChmodRequest> {
    Ok(SftpChmodRequest {
        host_id: required_string_arg(arguments, "hostId")?,
        path: required_string_arg(arguments, "path")?,
        mode: required_string_arg(arguments, "mode")?,
    })
}

pub(super) async fn execute_sftp_upload(
    sftp: &SftpService,
    paths: &KerminalPaths,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let request = match sftp_transfer_request_from_arguments(arguments) {
        Ok(request) => request,
        Err(error) => return failure(error.to_string()),
    };
    let summary = summarize_sftp_upload_for_agent(&request);

    match sftp.upload(paths, request).await {
        Ok(true) => ToolExecutionResult {
            status: McpToolExecutionStatus::Succeeded,
            result_summary: Some(summary),
            error: None,
            ..ToolExecutionResult::default()
        },
        Ok(false) => failure("SFTP 上传未完成。"),
        Err(error) => failure(error.to_string()),
    }
}

pub(super) fn summarize_sftp_upload_for_agent(request: &SftpTransferRequest) -> String {
    format!(
        "本地文件已上传：{} -> {}:{}。",
        request.local_path, request.host_id, request.remote_path
    )
}

pub(super) async fn execute_sftp_upload_directory(
    sftp: &SftpService,
    paths: &KerminalPaths,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let request = match sftp_transfer_request_from_arguments(arguments) {
        Ok(request) => request,
        Err(error) => return failure(error.to_string()),
    };
    let summary = format!(
        "本地目录已递归上传：{} -> {}:{}。",
        request.local_path, request.host_id, request.remote_path
    );

    match sftp.upload_directory(paths, request).await {
        Ok(true) => ToolExecutionResult {
            status: McpToolExecutionStatus::Succeeded,
            result_summary: Some(summary),
            error: None,
            ..ToolExecutionResult::default()
        },
        Ok(false) => failure("SFTP 递归上传未完成。"),
        Err(error) => failure(error.to_string()),
    }
}

pub(super) async fn execute_sftp_download(
    sftp: &SftpService,
    paths: &KerminalPaths,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let request = match sftp_transfer_request_from_arguments(arguments) {
        Ok(request) => request,
        Err(error) => return failure(error.to_string()),
    };
    let summary = summarize_sftp_download_for_agent(&request);

    match sftp.download(paths, request).await {
        Ok(true) => ToolExecutionResult {
            status: McpToolExecutionStatus::Succeeded,
            result_summary: Some(summary),
            error: None,
            ..ToolExecutionResult::default()
        },
        Ok(false) => failure("SFTP 下载未完成。"),
        Err(error) => failure(error.to_string()),
    }
}

pub(super) async fn execute_sftp_download_directory(
    sftp: &SftpService,
    paths: &KerminalPaths,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let request = match sftp_transfer_request_from_arguments(arguments) {
        Ok(request) => request,
        Err(error) => return failure(error.to_string()),
    };
    let summary = format!(
        "远程目录已递归下载：{}:{} -> {}。",
        request.host_id, request.remote_path, request.local_path
    );

    match sftp.download_directory(paths, request).await {
        Ok(true) => ToolExecutionResult {
            status: McpToolExecutionStatus::Succeeded,
            result_summary: Some(summary),
            error: None,
            ..ToolExecutionResult::default()
        },
        Ok(false) => failure("SFTP 递归下载未完成。"),
        Err(error) => failure(error.to_string()),
    }
}

pub(super) fn sftp_transfer_request_from_arguments(
    arguments: &serde_json::Map<String, Value>,
) -> AppResult<SftpTransferRequest> {
    Ok(SftpTransferRequest {
        host_id: required_string_arg(arguments, "hostId")?,
        remote_path: required_string_arg(arguments, "remotePath")?,
        local_path: required_string_arg(arguments, "localPath")?,
        conflict_policy: SftpTransferConflictPolicy::Overwrite,
    })
}

pub(super) fn summarize_sftp_download_for_agent(request: &SftpTransferRequest) -> String {
    format!(
        "远程文件已下载：{}:{} -> {}。",
        request.host_id, request.remote_path, request.local_path
    )
}

pub(super) async fn execute_sftp_delete(
    sftp: &SftpService,
    paths: &KerminalPaths,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let request = match sftp_delete_request_from_arguments(arguments) {
        Ok(request) => request,
        Err(error) => return failure(error.to_string()),
    };
    let summary = summarize_sftp_delete_for_agent(&request);

    match sftp.delete(paths, request).await {
        Ok(true) => ToolExecutionResult {
            status: McpToolExecutionStatus::Succeeded,
            result_summary: Some(summary),
            error: None,
            ..ToolExecutionResult::default()
        },
        Ok(false) => failure("SFTP 删除未完成。"),
        Err(error) => failure(error.to_string()),
    }
}

pub(super) fn sftp_delete_request_from_arguments(
    arguments: &serde_json::Map<String, Value>,
) -> AppResult<SftpDeleteRequest> {
    Ok(SftpDeleteRequest {
        host_id: required_string_arg(arguments, "hostId")?,
        path: required_string_arg(arguments, "path")?,
        directory: optional_bool_arg(arguments, "directory")?,
    })
}

pub(super) fn summarize_sftp_delete_for_agent(request: &SftpDeleteRequest) -> String {
    let target = if request.directory {
        "远程空目录"
    } else {
        "远程文件"
    };
    format!("{target}删除已执行：{}:{}。", request.host_id, request.path)
}

/// 解析并路由统一 source/destination 请求，同时保留旧 flat 请求的长期兼容入口。
///
/// 路由在入队前完成，保证 local-local、同一远端路径和目录嵌套等不会创建残留任务；
/// remote-remote 始终交给既有 remote copy 队列，由运行时决定桥接还是临时中转。
pub(super) fn sftp_transfer_route_from_arguments(
    arguments: &serde_json::Map<String, Value>,
) -> AppResult<SftpTransferRoute> {
    let has_canonical = arguments.contains_key("source") || arguments.contains_key("destination");
    let has_legacy = ["hostId", "localPath", "remotePath", "direction"]
        .iter()
        .any(|key| arguments.contains_key(*key));

    if has_canonical && has_legacy {
        return Err(AppError::InvalidInput(
            "sftp.transfer.enqueue 不能混用 canonical source/destination 与旧 flat 参数；请选择一种格式。"
                .to_owned(),
        ));
    }

    if has_canonical {
        let request = serde_json::from_value::<CanonicalSftpTransferRequest>(Value::Object(
            arguments.clone(),
        ))
        .map_err(|error| {
            AppError::InvalidInput(format!("sftp.transfer.enqueue canonical 参数无效: {error}"))
        })?;
        return canonical_sftp_transfer_route(request);
    }

    if !has_legacy {
        return Err(AppError::InvalidInput(
            "sftp.transfer.enqueue 必须提供 source、destination、kind 和 conflictPolicy。"
                .to_owned(),
        ));
    }
    if !arguments.contains_key("conflictPolicy") {
        return Err(AppError::InvalidInput(
            "旧版 sftp.transfer.enqueue 参数必须提供 conflictPolicy；请改用 source/destination 格式。"
                .to_owned(),
        ));
    }

    request_from_arguments::<SftpManagedTransferRequest>(arguments, "sftp.transfer.enqueue")
        .map(SftpTransferRoute::Managed)
}

/// 把已经反序列化的 canonical 请求转换成现有两种队列请求。
fn canonical_sftp_transfer_route(
    request: CanonicalSftpTransferRequest,
) -> AppResult<SftpTransferRoute> {
    let source = normalize_canonical_sftp_endpoint(request.source, "source")?;
    let destination = normalize_canonical_sftp_endpoint(request.destination, "destination")?;

    match (source, destination) {
        (CanonicalSftpEndpoint::Local { .. }, CanonicalSftpEndpoint::Local { .. }) => {
            Err(AppError::InvalidInput(
                "sftp.transfer.enqueue 不支持 local -> local；请直接使用本机文件系统能力。"
                    .to_owned(),
            ))
        }
        (
            CanonicalSftpEndpoint::Local { path: local_path },
            CanonicalSftpEndpoint::Remote {
                host_id,
                path: remote_path,
            },
        ) => Ok(SftpTransferRoute::Managed(SftpManagedTransferRequest {
            host_id,
            remote_path,
            local_path,
            direction: SftpTransferDirection::Upload,
            kind: request.kind,
            conflict_policy: request.conflict_policy,
            view_scope: None,
        })),
        (
            CanonicalSftpEndpoint::Remote {
                host_id,
                path: remote_path,
            },
            CanonicalSftpEndpoint::Local { path: local_path },
        ) => Ok(SftpTransferRoute::Managed(SftpManagedTransferRequest {
            host_id,
            remote_path,
            local_path,
            direction: SftpTransferDirection::Download,
            kind: request.kind,
            conflict_policy: request.conflict_policy,
            view_scope: None,
        })),
        (
            CanonicalSftpEndpoint::Remote {
                host_id: source_host_id,
                path: source_remote_path,
            },
            CanonicalSftpEndpoint::Remote {
                host_id: target_host_id,
                path: target_remote_path,
            },
        ) => {
            if source_host_id == target_host_id {
                if source_remote_path == target_remote_path {
                    return Err(AppError::InvalidInput(
                        "远程复制的源路径和目标路径不能相同。".to_owned(),
                    ));
                }
                if request.kind == SftpTransferKind::Directory
                    && (is_remote_descendant_for_mcp(&source_remote_path, &target_remote_path)
                        || is_remote_descendant_for_mcp(&target_remote_path, &source_remote_path))
                {
                    return Err(AppError::InvalidInput(
                        "同一主机的目录复制不能把目标放在源目录内或把源目录放在目标目录内。"
                            .to_owned(),
                    ));
                }
            }
            Ok(SftpTransferRoute::RemoteCopy(SftpRemoteCopyRequest {
                source_host_id,
                source_remote_path,
                target_host_id,
                target_remote_path,
                kind: request.kind,
                conflict_policy: request.conflict_policy,
                view_scope: None,
            }))
        }
    }
}

/// 校验 endpoint 文本并归一化路径，尽早阻止空路径、控制字符和远端根目录写入。
fn normalize_canonical_sftp_endpoint(
    endpoint: CanonicalSftpEndpoint,
    label: &str,
) -> AppResult<CanonicalSftpEndpoint> {
    match endpoint {
        CanonicalSftpEndpoint::Local { path } => {
            let path = path.trim().to_owned();
            validate_mcp_endpoint_path(&path, label)?;
            Ok(CanonicalSftpEndpoint::Local { path })
        }
        CanonicalSftpEndpoint::Remote { host_id, path } => {
            let host_id = host_id.trim().to_owned();
            if host_id.is_empty() {
                return Err(AppError::InvalidInput(format!("{label}.hostId 不能为空。")));
            }
            let path = normalize_mcp_remote_path(&path, label)?;
            Ok(CanonicalSftpEndpoint::Remote { host_id, path })
        }
    }
}

/// 校验本地端点路径；远端路径由单独的 normalizer 拒绝根目录。
fn validate_mcp_endpoint_path(path: &str, label: &str) -> AppResult<()> {
    if path.is_empty() {
        return Err(AppError::InvalidInput(format!("{label}.path 不能为空。")));
    }
    if path
        .chars()
        .any(|character| matches!(character, '\0' | '\r' | '\n'))
    {
        return Err(AppError::InvalidInput(format!(
            "{label}.path 不能包含控制字符。"
        )));
    }
    Ok(())
}

/// 归一化 MCP 远端路径，避免把根目录作为文件/目录复制目标。
fn normalize_mcp_remote_path(path: &str, label: &str) -> AppResult<String> {
    let path = path.trim().replace('\\', "/");
    validate_mcp_endpoint_path(&path, label)?;
    let mut normalized = path;
    while normalized.len() > 1 && normalized.ends_with('/') {
        normalized.pop();
    }
    if normalized == "/" {
        return Err(AppError::InvalidInput(format!(
            "{label}.path 不允许使用远程根目录。"
        )));
    }
    Ok(normalized)
}

/// 判断两个已经归一化的远端路径是否存在目录层级包含关系。
fn is_remote_descendant_for_mcp(parent: &str, candidate: &str) -> bool {
    candidate
        .strip_prefix(parent)
        .is_some_and(|suffix| suffix.starts_with('/'))
}

/// 把传输任务加入对应的现有队列，并返回不泄漏内部路径的结构化快照。
pub(super) fn execute_sftp_transfer_enqueue(
    sftp: &SftpService,
    paths: &KerminalPaths,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let route = match sftp_transfer_route_from_arguments(arguments) {
        Ok(route) => route,
        Err(error) => return transfer_failure(error.to_string()),
    };

    let result = match route {
        SftpTransferRoute::Managed(request) => sftp.enqueue_transfer(paths, request),
        SftpTransferRoute::RemoteCopy(request) => sftp.enqueue_remote_copy(paths, request),
    };

    match result {
        Ok(summary) => {
            let transfer = sftp_transfer_projection(&summary);
            ToolExecutionResult {
                status: McpToolExecutionStatus::Succeeded,
                result_summary: Some(summarize_sftp_transfer_for_agent(
                    "SFTP 传输任务已入队",
                    &summary,
                )),
                error: None,
                structured_result: Some(json!({ "transfer": transfer })),
                entities: vec![sftp_transfer_entity(&summary)],
                next_hints: vec![
                    "使用 sftp.transfer.list 并传入 transferId 查询进度；需要停止时再调用 sftp.transfer.cancel。"
                        .to_owned(),
                ],
                ..ToolExecutionResult::default()
            }
        }
        Err(error) => transfer_failure(error.to_string()),
    }
}

/// 查询全部或指定 id 的 SFTP 任务，并始终返回统一 transfer projection。
pub(super) fn execute_sftp_transfer_list_with_arguments(
    sftp: &SftpService,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let transfer_id = match optional_string_arg(arguments, "transferId") {
        Ok(value) => value.map(|value| value.trim().to_owned()),
        Err(error) => return transfer_failure(error.to_string()),
    };
    if transfer_id.as_deref().is_some_and(str::is_empty) {
        return transfer_failure("transferId 不能为空。".to_owned());
    }

    match sftp.list_transfers() {
        Ok(transfers) => {
            let transfers = transfers
                .into_iter()
                .filter(|summary| {
                    transfer_id
                        .as_deref()
                        .map(|id| summary.id == id)
                        .unwrap_or(true)
                })
                .collect::<Vec<_>>();
            let projections = transfers
                .iter()
                .map(sftp_transfer_projection)
                .collect::<Vec<_>>();
            let summary = match transfer_id.as_deref() {
                Some(id) if transfers.is_empty() => format!("未找到 SFTP 传输任务：{id}。"),
                Some(id) => format!("已找到 SFTP 传输任务：{id}。"),
                None => summarize_sftp_transfers_for_agent(&transfers),
            };
            ToolExecutionResult {
                status: McpToolExecutionStatus::Succeeded,
                result_summary: Some(summary),
                error: None,
                structured_result: Some(json!({
                    "transfers": projections,
                    "count": transfers.len(),
                    "transferId": transfer_id,
                })),
                entities: transfers.iter().map(sftp_transfer_entity).collect(),
                ..ToolExecutionResult::default()
            }
        }
        Err(error) => transfer_failure(error.to_string()),
    }
}

/// 请求取消指定任务，并返回取消后的统一任务快照。
pub(super) fn execute_sftp_transfer_cancel(
    sftp: &SftpService,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let request = match request_from_arguments::<SftpTransferCancelRequest>(
        arguments,
        "sftp.transfer.cancel",
    ) {
        Ok(request) => request,
        Err(error) => return transfer_failure(error.to_string()),
    };

    match sftp.cancel_transfer(request) {
        Ok(summary) => ToolExecutionResult {
            status: McpToolExecutionStatus::Succeeded,
            result_summary: Some(summarize_sftp_transfer_for_agent(
                "SFTP 传输任务已请求取消",
                &summary,
            )),
            error: None,
            structured_result: Some(json!({
                "transfer": sftp_transfer_projection(&summary),
            })),
            entities: vec![sftp_transfer_entity(&summary)],
            ..ToolExecutionResult::default()
        },
        Err(error) => transfer_failure(error.to_string()),
    }
}

/// 清理已结束任务，并返回本次清理数量与剩余任务数量，而不是泄漏内部任务列表。
pub(super) fn execute_sftp_transfer_clear_completed(sftp: &SftpService) -> ToolExecutionResult {
    let before = match sftp.list_transfers() {
        Ok(transfers) => transfers,
        Err(error) => return transfer_failure(error.to_string()),
    };
    match sftp.clear_completed_transfers() {
        Ok(remaining) => {
            let removed_count = before.len().saturating_sub(remaining.len());
            ToolExecutionResult {
                status: McpToolExecutionStatus::Succeeded,
                result_summary: Some(format!(
                    "已清理 {} 个结束的 SFTP 传输任务，当前保留 {} 个任务。",
                    removed_count,
                    remaining.len()
                )),
                error: None,
                structured_result: Some(json!({
                    "removedCount": removed_count,
                    "remainingCount": remaining.len(),
                })),
                ..ToolExecutionResult::default()
            }
        }
        Err(error) => transfer_failure(error.to_string()),
    }
}

/// 为 Agent 生成短摘要；完整状态通过 structured_result 的 projection 返回。
pub(super) fn summarize_sftp_transfers_for_agent(transfers: &[SftpTransferSummary]) -> String {
    if transfers.is_empty() {
        return "当前没有 SFTP 传输任务。".to_owned();
    }

    let samples = transfers
        .iter()
        .take(5)
        .map(|summary| summarize_sftp_transfer_for_agent("任务", summary))
        .collect::<Vec<_>>()
        .join("；");
    format!(
        "当前共有 {} 个 SFTP 传输任务。示例：{}。",
        transfers.len(),
        samples
    )
}

/// 将内部传输摘要投影为稳定、精简且不暴露 hostLabel/临时路径的 MCP 对象。
fn sftp_transfer_projection(summary: &SftpTransferSummary) -> Value {
    json!({
        "id": summary.id,
        "status": serde_json::to_value(summary.status).unwrap_or(Value::Null),
        "operation": serde_json::to_value(summary.operation).unwrap_or(Value::Null),
        "source": sftp_transfer_endpoint_projection(&summary.source),
        "destination": sftp_transfer_endpoint_projection(&summary.target),
        "kind": serde_json::to_value(summary.kind).unwrap_or(Value::Null),
        "conflictPolicy": summary
            .conflict_policy
            .and_then(|policy| serde_json::to_value(policy).ok()),
        "progress": {
            "bytesTransferred": summary.bytes_transferred,
            "totalBytes": summary.total_bytes,
            "speedBytesPerSecond": summary.speed_bytes_per_second,
        },
        "transportMode": serde_json::to_value(summary.transport_mode).unwrap_or(Value::Null),
        "phase": summary.phase,
        "error": sanitize_sftp_transfer_error(summary.error.as_ref()),
    })
}

/// 隐藏本地临时中转目录，避免远程复制失败时把 Kerminal 内部工作区泄漏给 Agent。
fn sanitize_sftp_transfer_error(error: Option<&String>) -> Option<String> {
    error.map(|error| {
        if [
            "sftp-remote-copy",
            "sftp-archive-download",
            "sftp-archive-upload",
        ]
        .iter()
        .any(|marker| error.contains(marker))
        {
            "SFTP 传输失败；临时中转路径已隐藏。".to_owned()
        } else {
            error.clone()
        }
    })
}

/// 把内部 endpoint 的 kind/hostLabel 形状转换为公开的 type/path/hostId 形状。
fn sftp_transfer_endpoint_projection(endpoint: &SftpTransferEndpoint) -> Value {
    let mut value = serde_json::to_value(endpoint).unwrap_or_else(|_| json!({}));
    if let Some(object) = value.as_object_mut() {
        let endpoint_type = object
            .remove("kind")
            .unwrap_or_else(|| Value::String("unknown".to_owned()));
        object.remove("hostLabel");
        object.insert("type".to_owned(), endpoint_type);
    }
    value
}

/// 为结果实体生成统一包装，令 MCP host 可以按 type/id 识别传输任务。
fn sftp_transfer_entity(summary: &SftpTransferSummary) -> Value {
    json!({
        "type": "sftpTransfer",
        "id": summary.id,
        "transfer": sftp_transfer_projection(summary),
    })
}

/// 标记 SFTP 参数或队列错误为可恢复，并给 Agent 下一步排障方向。
fn transfer_failure(message: impl Into<String>) -> ToolExecutionResult {
    ToolExecutionResult {
        status: McpToolExecutionStatus::Failed,
        result_summary: None,
        error: Some(message.into()),
        error_kind: Some("sftpTransferError".to_owned()),
        recoverable: true,
        next_hints: vec![
            "检查 endpoint、保存的主机凭据、主机密钥信任、SFTP subsystem 和路径权限后重试。"
                .to_owned(),
        ],
        ..ToolExecutionResult::default()
    }
}

/// 生成不携带内部 legacy 字段的短传输摘要。
pub(super) fn summarize_sftp_transfer_for_agent(
    prefix: &str,
    summary: &SftpTransferSummary,
) -> String {
    let progress = summary
        .total_bytes
        .map(|total| format!("{} / {} 字节", summary.bytes_transferred, total))
        .unwrap_or_else(|| format!("{} 字节", summary.bytes_transferred));
    format!(
        "{prefix}：{} {} -> {}，状态：{}，进度：{}，id={}。",
        sftp_transfer_kind_label(summary.kind),
        sftp_transfer_endpoint_label(&summary.source),
        sftp_transfer_endpoint_label(&summary.target),
        sftp_transfer_status_label(summary.status),
        progress,
        summary.id
    )
}

/// 把投影端点压缩成人类可读的 hostId:path 或本机路径。
fn sftp_transfer_endpoint_label(endpoint: &SftpTransferEndpoint) -> String {
    let projection = sftp_transfer_endpoint_projection(endpoint);
    match projection.get("type").and_then(Value::as_str) {
        Some("remote") => format!(
            "{}:{}",
            projection
                .get("hostId")
                .and_then(Value::as_str)
                .unwrap_or("unknown"),
            projection
                .get("path")
                .and_then(Value::as_str)
                .unwrap_or("unknown")
        ),
        _ => projection
            .get("path")
            .and_then(Value::as_str)
            .unwrap_or("unknown")
            .to_owned(),
    }
}

pub(super) fn sftp_transfer_kind_label(kind: SftpTransferKind) -> &'static str {
    match kind {
        SftpTransferKind::File => "文件",
        SftpTransferKind::Directory => "目录",
    }
}

pub(super) fn sftp_transfer_status_label(status: SftpTransferStatus) -> &'static str {
    match status {
        SftpTransferStatus::Queued => "排队中",
        SftpTransferStatus::Running => "运行中",
        SftpTransferStatus::Succeeded => "已成功",
        SftpTransferStatus::Failed => "已失败",
        SftpTransferStatus::Canceled => "已取消",
    }
}

pub(super) async fn execute_sftp_list(
    sftp: &SftpService,
    paths: &KerminalPaths,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let host_id = match required_string_arg(arguments, "hostId") {
        Ok(host_id) => host_id,
        Err(error) => return failure(error.to_string()),
    };
    let path = match required_string_arg(arguments, "path") {
        Ok(path) => path,
        Err(error) => return failure(error.to_string()),
    };

    match sftp
        .list_directory(paths, SftpListDirectoryRequest { host_id, path })
        .await
    {
        Ok(listing) => ToolExecutionResult {
            status: McpToolExecutionStatus::Succeeded,
            result_summary: Some(summarize_sftp_listing_for_agent(&listing)),
            error: None,
            structured_result: Some(json!({
                "hostId": listing.host_id,
                "path": listing.path,
                "entryCount": listing.entries.len(),
                "entries": listing.entries,
            })),
            entities: listing
                .entries
                .iter()
                .map(|entry| {
                    json!({
                        "type": "sftpEntry",
                        "hostId": listing.host_id,
                        "path": listing.path,
                        "name": entry.name,
                        "kind": entry.kind,
                        "size": entry.size,
                        "modified": entry.modified,
                    })
                })
                .collect(),
            ..ToolExecutionResult::default()
        },
        Err(error) => failure(error.to_string()),
    }
}

/// 将 SFTP 目录列表压缩成外部 Agent 可读摘要。
pub fn summarize_sftp_listing_for_agent(listing: &SftpDirectoryListing) -> String {
    let directory_count = listing
        .entries
        .iter()
        .filter(|entry| matches!(&entry.kind, SftpEntryKind::Directory))
        .count();
    let file_count = listing
        .entries
        .iter()
        .filter(|entry| matches!(&entry.kind, SftpEntryKind::File))
        .count();
    let symlink_count = listing
        .entries
        .iter()
        .filter(|entry| matches!(&entry.kind, SftpEntryKind::Symlink))
        .count();
    let sample = listing
        .entries
        .iter()
        .take(5)
        .map(|entry| entry.name.as_str())
        .collect::<Vec<_>>();
    let sample_text = if sample.is_empty() {
        "无条目".to_owned()
    } else {
        sample.join("、")
    };

    format!(
        "远程目录已读取：{}:{}，共 {} 项（目录 {}、文件 {}、链接 {}），示例：{}。",
        listing.host_id,
        listing.path,
        listing.entries.len(),
        directory_count,
        file_count,
        symlink_count,
        sample_text
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 构造 MCP 参数 map，令路由测试直接覆盖公开 JSON 形状而不是内部请求 struct。
    fn arguments(value: Value) -> serde_json::Map<String, Value> {
        value
            .as_object()
            .cloned()
            .expect("test arguments must be an object")
    }

    /// 验证三种 canonical 端点方向都映射到既有 managed/remote copy 队列。
    #[test]
    fn canonical_transfer_routes_local_and_remote_endpoints() {
        let upload = sftp_transfer_route_from_arguments(&arguments(json!({
            "source": { "type": "local", "path": "C:/data/report.txt" },
            "destination": { "type": "remote", "hostId": "server-a", "path": "/data/report.txt" },
            "kind": "file",
            "conflictPolicy": "overwrite"
        })))
        .expect("local to remote route");
        assert!(matches!(
            upload,
            SftpTransferRoute::Managed(SftpManagedTransferRequest {
                direction: SftpTransferDirection::Upload,
                kind: SftpTransferKind::File,
                conflict_policy: SftpTransferConflictPolicy::Overwrite,
                ..
            })
        ));

        let download = sftp_transfer_route_from_arguments(&arguments(json!({
            "source": { "type": "remote", "hostId": "server-a", "path": "/data/report" },
            "destination": { "type": "local", "path": "C:/data/report" },
            "kind": "directory",
            "conflictPolicy": "rename"
        })))
        .expect("remote to local route");
        assert!(matches!(
            download,
            SftpTransferRoute::Managed(SftpManagedTransferRequest {
                direction: SftpTransferDirection::Download,
                kind: SftpTransferKind::Directory,
                conflict_policy: SftpTransferConflictPolicy::Rename,
                ..
            })
        ));

        let remote_copy = sftp_transfer_route_from_arguments(&arguments(json!({
            "source": { "type": "remote", "hostId": "server-a", "path": "/data/report" },
            "destination": { "type": "remote", "hostId": "server-b", "path": "/backup/report" },
            "kind": "directory",
            "conflictPolicy": "skip"
        })))
        .expect("remote to remote route");
        assert!(matches!(
            remote_copy,
            SftpTransferRoute::RemoteCopy(SftpRemoteCopyRequest {
                kind: SftpTransferKind::Directory,
                conflict_policy: SftpTransferConflictPolicy::Skip,
                source_host_id,
                target_host_id,
                ..
            }) if source_host_id == "server-a" && target_host_id == "server-b"
        ));

        let same_host_copy = sftp_transfer_route_from_arguments(&arguments(json!({
            "source": { "type": "remote", "hostId": "server-a", "path": "/data/report" },
            "destination": { "type": "remote", "hostId": "server-a", "path": "/backup/report" },
            "kind": "file",
            "conflictPolicy": "overwrite"
        })))
        .expect("same-host remote copy route");
        assert!(matches!(
            same_host_copy,
            SftpTransferRoute::RemoteCopy(SftpRemoteCopyRequest {
                source_host_id,
                target_host_id,
                kind: SftpTransferKind::File,
                ..
            }) if source_host_id == "server-a" && target_host_id == "server-a"
        ));
    }

    /// 验证 local-local、同路径和危险目录嵌套在入队前失败。
    #[test]
    fn canonical_transfer_rejects_local_local_and_overlapping_remote_directories() {
        let local_local = sftp_transfer_route_from_arguments(&arguments(json!({
            "source": { "type": "local", "path": "C:/data/source" },
            "destination": { "type": "local", "path": "C:/data/target" },
            "kind": "directory",
            "conflictPolicy": "skip"
        })))
        .expect_err("local-local must be rejected");
        assert!(local_local.to_string().contains("local -> local"));

        let nested = sftp_transfer_route_from_arguments(&arguments(json!({
            "source": { "type": "remote", "hostId": "server-a", "path": "/data" },
            "destination": { "type": "remote", "hostId": "server-a", "path": "/data/archive" },
            "kind": "directory",
            "conflictPolicy": "overwrite"
        })))
        .expect_err("nested remote directory must be rejected");
        assert!(nested.to_string().contains("目录复制"));
    }

    /// 验证旧 flat 参数仍可路由，缺 conflictPolicy 与 canonical 混用会清晰拒绝。
    #[test]
    fn legacy_transfer_arguments_are_compatible_but_mixing_is_rejected() {
        let legacy = sftp_transfer_route_from_arguments(&arguments(json!({
            "hostId": "server-a",
            "remotePath": "/data/report",
            "localPath": "C:/data/report",
            "direction": "download",
            "kind": "file",
            "conflictPolicy": "rename"
        })))
        .expect("legacy route");
        assert!(matches!(
            legacy,
            SftpTransferRoute::Managed(SftpManagedTransferRequest {
                direction: SftpTransferDirection::Download,
                conflict_policy: SftpTransferConflictPolicy::Rename,
                ..
            })
        ));

        let missing_policy = sftp_transfer_route_from_arguments(&arguments(json!({
            "hostId": "server-a",
            "remotePath": "/data/report",
            "localPath": "C:/data/report",
            "direction": "download",
            "kind": "file"
        })))
        .expect_err("legacy request without policy");
        assert!(missing_policy.to_string().contains("conflictPolicy"));

        let mixed = sftp_transfer_route_from_arguments(&arguments(json!({
            "source": { "type": "local", "path": "C:/data/report" },
            "destination": { "type": "remote", "hostId": "server-a", "path": "/data/report" },
            "hostId": "server-a",
            "kind": "file",
            "conflictPolicy": "skip"
        })))
        .expect_err("canonical and legacy arguments must not mix");
        assert!(mixed.to_string().contains("不能混用"));
    }

    /// 验证 canonical 端点的空 path/hostId 在路由阶段拒绝，避免依赖后续队列副作用才能发现输入错误。
    #[test]
    fn canonical_transfer_rejects_empty_endpoint_fields() {
        let empty_local_path = sftp_transfer_route_from_arguments(&arguments(json!({
            "source": { "type": "local", "path": " " },
            "destination": { "type": "remote", "hostId": "server-a", "path": "/data/report" },
            "kind": "file",
            "conflictPolicy": "skip"
        })))
        .expect_err("empty local path");
        assert!(empty_local_path.to_string().contains("source.path"));

        let empty_remote_host = sftp_transfer_route_from_arguments(&arguments(json!({
            "source": { "type": "remote", "hostId": " ", "path": "/data/report" },
            "destination": { "type": "local", "path": "C:/data/report" },
            "kind": "file",
            "conflictPolicy": "skip"
        })))
        .expect_err("empty remote host id");
        assert!(empty_remote_host.to_string().contains("source.hostId"));
    }

    /// 验证传输失败摘要不会暴露 remote-copy 临时目录标记。
    #[test]
    fn transfer_projection_hides_staged_temp_path_errors() {
        let error = Some("无法打开 C:/kerminal/temp/sftp-remote-copy/id/file".to_owned());
        let sanitized = sanitize_sftp_transfer_error(error.as_ref());
        assert_eq!(
            sanitized.as_deref(),
            Some("SFTP 传输失败；临时中转路径已隐藏。")
        );
    }
}
