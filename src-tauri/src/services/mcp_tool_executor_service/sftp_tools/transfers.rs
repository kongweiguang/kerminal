//! MCP SFTP transfer queue operations and their agent-facing projection.
//! @author kongweiguang

use super::*;

pub(in crate::services::mcp_tool_executor_service) fn execute_sftp_transfer_enqueue(
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
                    "使用 sftp.transfer.list 并传入 transferId 查询进度；终态失败且 retryable=true 时调用 sftp.transfer.retry，resumable=false 会从头重传，只有用户明确要求停止时才调用 sftp.transfer.cancel。"
                        .to_owned(),
                ],
                ..ToolExecutionResult::default()
            }
        }
        Err(error) => transfer_failure(error.to_string()),
    }
}

/// 查询全部或指定 id 的权威 SFTP 快照；下一步提示只依据已观测终态与 retryable。
///
/// Agent 不应因为最终文件暂未出现就重建上传请求，提交结果未确认时也绝不能建议重试。
pub(in crate::services::mcp_tool_executor_service) fn execute_sftp_transfer_list_with_arguments(
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
            // 查询结果直接给出下一步，避免外部 Agent 把排队中的缺失正式文件当作失败。
            let next_hints = if transfers.is_empty() {
                vec!["核对 transferId；任务可能已被清理。".to_owned()]
            } else if transfers.iter().any(|task| {
                task.status == SftpTransferStatus::Failed
                    && task.failure_kind == Some(SftpTransferFailureKind::CommitUnknown)
            }) {
                vec!["提交结果未确认：先核对目标文件的实际状态与内容；该任务 retryable=false，不要自动调用 sftp.transfer.retry 或再次上传。".to_owned()]
            } else if transfers.iter().any(|task| {
                matches!(
                    task.status,
                    SftpTransferStatus::Failed | SftpTransferStatus::Canceled
                ) && task.retryable
                    && task.successor_id.is_none()
            }) {
                vec!["此任务可恢复：对失败或已取消任务调用 sftp.transfer.retry({transferId})，再按返回的后继 id 查询终态；resumable=false 时会从头传输。".to_owned()]
            } else if transfers.iter().any(|task| task.successor_id.is_some()) {
                vec!["任务已生成后继：使用 successorId 调用 sftp.transfer.list 查询其终态，不要重复构造新的上传请求。".to_owned()]
            } else if transfers.iter().any(|task| {
                matches!(
                    task.status,
                    SftpTransferStatus::Queued | SftpTransferStatus::Running
                )
            }) {
                vec!["传输仍在后台运行；稍后按 transferId 再次调用 sftp.transfer.list。只有用户要求停止时才调用 sftp.transfer.cancel。".to_owned()]
            } else if transfers
                .iter()
                .any(|task| task.status == SftpTransferStatus::Failed)
            {
                vec!["任务失败且当前不可安全重试；先查看脱敏错误并核对目标文件，再决定是否另起传输。".to_owned()]
            } else {
                vec!["任务已结束；确认 status=succeeded 后再使用最终文件。".to_owned()]
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
                next_hints,
                ..ToolExecutionResult::default()
            }
        }
        Err(error) => transfer_failure(error.to_string()),
    }
}

/// 请求取消指定任务，并返回取消后的统一任务快照。
pub(in crate::services::mcp_tool_executor_service) fn execute_sftp_transfer_cancel(
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
            next_hints: vec![
                "取消调用只表示已请求停止；继续使用 sftp.transfer.list 观察终态 canceled、failed 或 succeeded。若原子提交已经完成，任务仍可能 succeeded。若终态报告 retryable=true，可按用户意图调用 sftp.transfer.retry；resumable=false 时服务会从头重传。"
                    .to_owned(),
            ],
            ..ToolExecutionResult::default()
        },
        Err(error) => transfer_failure(error.to_string()),
    }
}

/// 继续一个已经结束且允许重试的传输，并把唯一后继任务返回给 MCP host。
///
/// 重试由 SFTP 服务层负责幂等和断点校验；MCP 层只做短参数适配，避免 Agent 自行重建
/// 端点时丢失实际冲突策略、无进度阈值或恢复偏移。返回 `retry.transferId` 供调用方把
/// 后继行合并到原任务展示中，重复调用仍由服务层返回同一个后继摘要。`accepted` 只表示
/// 任务已入队，不代表连接、断点校验或文件提交已经完成；调用方必须继续查询后继任务终态。
pub(in crate::services::mcp_tool_executor_service) fn execute_sftp_transfer_retry(
    sftp: &SftpService,
    paths: &KerminalPaths,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let transfer_id = match required_string_arg(arguments, "transferId") {
        Ok(value) => value.trim().to_owned(),
        Err(error) => return transfer_failure(error.to_string()),
    };
    if transfer_id.is_empty() {
        return transfer_failure("transferId 不能为空。".to_owned());
    }

    let source_transfer_id = transfer_id.clone();
    let request = SftpTransferRetryRequest {
        transfer_id,
        view_scope: None,
    };
    match sftp.retry_transfer(paths, request) {
        Ok(summary) => {
            ToolExecutionResult {
                status: McpToolExecutionStatus::Succeeded,
                result_summary: Some(summarize_sftp_transfer_for_agent(
                    "SFTP 重试请求已接受",
                    &summary,
                )),
                error: None,
                structured_result: Some(json!({
                    "transfer": sftp_transfer_projection(&summary),
                    "retry": {
                        "sourceTransferId": source_transfer_id,
                        "transferId": summary.id,
                        "accepted": true,
                        "completed": matches!(summary.status, SftpTransferStatus::Succeeded),
                        "resumeMode": "pendingValidation",
                    },
                })),
                entities: vec![sftp_transfer_entity(&summary)],
                next_hints: vec![
                    "使用 sftp.transfer.list 并传入 retry.transferId 查询后继任务；是否安全使用断点由后台校验决定，只有用户明确要求停止时才调用 sftp.transfer.cancel。"
                        .to_owned(),
                ],
                ..ToolExecutionResult::default()
            }
        }
        Err(_) => ToolExecutionResult {
            status: McpToolExecutionStatus::Failed,
            error: Some("该传输任务暂不能继续；请按 transferId 查询最新状态，核对 retryable 和 successorId。".to_owned()),
            error_kind: Some("sftpTransferRetryUnavailable".to_owned()),
            recoverable: false,
            next_hints: vec!["调用 sftp.transfer.list({transferId}) 查询权威任务状态；提交结果未确认时先核对目标文件，不能直接重试。".to_owned()],
            ..ToolExecutionResult::default()
        },
    }
}

/// 清理已结束任务，并返回本次清理数量与剩余任务数量，而不是泄漏内部任务列表。
pub(in crate::services::mcp_tool_executor_service) fn execute_sftp_transfer_clear_completed(
    sftp: &SftpService,
) -> ToolExecutionResult {
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
pub(in crate::services::mcp_tool_executor_service) fn summarize_sftp_transfers_for_agent(
    transfers: &[SftpTransferSummary],
) -> String {
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
        "cancelRequested": summary.cancel_requested,
        "lastProgressAt": summary.last_progress_at,
        "recoveryAttempt": summary.recovery_attempt,
        "retryable": summary.retryable,
        "resumable": summary.resumable,
        "successorId": summary.successor_id,
        "failureKind": summary.failure_kind,
        "failure": summary.failure_kind.map(|failure_kind| json!({
            "kind": failure_kind,
            "idleTimeoutSeconds": summary.idle_timeout_seconds,
            "bytesTransferred": summary.bytes_transferred,
            "retryable": summary.retryable,
            "resumable": summary.resumable,
        })),
        "transportMode": serde_json::to_value(summary.transport_mode).unwrap_or(Value::Null),
        "phase": summary.phase,
        "error": sanitize_sftp_transfer_error(summary.error.as_ref()),
    })
}

/// 隐藏本地临时中转目录，避免远程复制失败时把 Kerminal 内部工作区泄漏给 Agent。
pub(in crate::services::mcp_tool_executor_service) fn sanitize_sftp_transfer_error(
    error: Option<&String>,
) -> Option<String> {
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
pub(in crate::services::mcp_tool_executor_service) fn summarize_sftp_transfer_for_agent(
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

pub(in crate::services::mcp_tool_executor_service) fn sftp_transfer_kind_label(
    kind: SftpTransferKind,
) -> &'static str {
    match kind {
        SftpTransferKind::File => "文件",
        SftpTransferKind::Directory => "目录",
    }
}

pub(in crate::services::mcp_tool_executor_service) fn sftp_transfer_status_label(
    status: SftpTransferStatus,
) -> &'static str {
    match status {
        SftpTransferStatus::Queued => "排队中",
        SftpTransferStatus::Running => "运行中",
        SftpTransferStatus::Succeeded => "已成功",
        SftpTransferStatus::Failed => "已失败",
        SftpTransferStatus::Canceled => "已取消",
    }
}
