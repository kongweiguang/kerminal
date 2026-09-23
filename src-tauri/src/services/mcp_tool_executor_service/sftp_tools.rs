//! MCP SFTP tool adapters.
//!
//! @author kongweiguang

use super::{
    sftp_transfer_route::{sftp_transfer_route_from_arguments, SftpTransferRoute},
    *,
};
use crate::models::sftp::{SftpTransferEndpoint, SftpTransferFailureKind};
mod transfers;
pub(in crate::services::mcp_tool_executor_service) use transfers::*;

const RETIRED_SYNC_SFTP_TRANSFER_TOOLS: &[&str] = &[
    "sftp.upload",
    "sftp.upload_directory",
    "sftp.download",
    "sftp.download_directory",
];

/// 判断调用是否命中已从公开目录下线的同步传输工具。
///
/// 旧 Agent 可能在工具列表缓存尚未刷新时继续调用这些 id；保留这一极窄的识别层能够给出
/// 稳定迁移提示，而不会重新开放会等待文件完成的 MCP 长任务入口。
pub(super) fn is_retired_sync_sftp_transfer_tool(tool_id: &str) -> bool {
    RETIRED_SYNC_SFTP_TRANSFER_TOOLS.contains(&tool_id)
}

/// 返回同步传输工具的固定迁移结果，不执行任何网络或文件副作用。
///
/// 调用方必须显式改为 enqueue -> list -> cancel/retry 闭环；失败状态避免 MCP host 把此
/// 响应误判为已经完成文件复制。
pub(super) fn retired_sync_sftp_transfer_result() -> ToolExecutionResult {
    let message = "同步 SFTP 传输工具已下线：请使用 sftp.transfer.enqueue 获取任务 id，再使用 sftp.transfer.list 查询；需要停止或恢复时使用 sftp.transfer.cancel 或 sftp.transfer.retry。";
    ToolExecutionResult {
        status: McpToolExecutionStatus::Failed,
        result_summary: Some(message.to_owned()),
        error: Some(message.to_owned()),
        structured_result: Some(json!({
            "migration": "sftp.transfer.enqueue -> sftp.transfer.list -> sftp.transfer.cancel/retry",
            "retryable": false,
        })),
        next_hints: vec![
            "sftp.transfer.enqueue 立即返回任务 id，不等待连接或文件传输完成；终态报告 retryable=true 时调用 sftp.transfer.retry，resumable=false 表示从头重传。".to_owned(),
        ],
        ..ToolExecutionResult::default()
    }
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

/// 把传输任务加入对应的现有队列，并返回不泄漏内部路径的结构化快照。
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
