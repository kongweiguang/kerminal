//! MCP SFTP tool adapters.
//!
//! @author kongweiguang

use super::{
    sftp_transfer_route::{sftp_transfer_route_from_arguments, SftpTransferRoute},
    *,
};
use crate::models::sftp::{SftpTransferEndpoint, SftpTransferFailureKind};

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
    let message = "同步 SFTP 传输工具已下线：请使用 sftp.transfer.enqueue 获取任务 id，再使用 sftp.transfer.list 查询；需要停止或恢复时使用 sftp.transfer.cancel 或继续传输。";
    ToolExecutionResult {
        status: McpToolExecutionStatus::Failed,
        result_summary: Some(message.to_owned()),
        error: Some(message.to_owned()),
        structured_result: Some(json!({
            "migration": "sftp.transfer.enqueue -> sftp.transfer.list -> sftp.transfer.cancel/retry",
            "retryable": false,
        })),
        next_hints: vec![
            "sftp.transfer.enqueue 立即返回任务 id，不等待连接或文件传输完成。".to_owned(),
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
        "idleTimeoutSeconds": summary.idle_timeout_seconds,
        "failureKind": summary.failure_kind,
        "failure": summary.failure_kind.map(|failure_kind| json!({
            "kind": failure_kind,
            "idleTimeoutSeconds": summary.idle_timeout_seconds,
            "bytesTransferred": summary.bytes_transferred,
            "retryable": matches!(failure_kind, SftpTransferFailureKind::IdleTimeout),
        })),
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
