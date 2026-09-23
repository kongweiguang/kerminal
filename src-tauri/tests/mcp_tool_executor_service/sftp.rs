//! MCP SFTP transfer contract tests.
//!
//! @author kongweiguang

use super::fixtures::*;
use kerminal_lib::models::sftp::{
    SftpManagedTransferRequest, SftpTransferCancelRequest, SftpTransferConflictPolicy,
    SftpTransferDirection,
};

/// 验证公开 enqueue schema 只暴露 canonical source/destination 端点和必填策略。
#[test]
fn mcp_sftp_transfer_enqueue_schema_is_canonical() {
    let (_home, state) = test_state();
    let tool = state
        .mcp_tool_catalog()
        .list_tools()
        .into_iter()
        .find(|tool| tool.id == "sftp.transfer.enqueue")
        .expect("sftp transfer enqueue tool");
    let schema = &tool.input_schema;
    let properties = schema["properties"].as_object().expect("schema properties");

    assert_eq!(
        schema["allOf"][0]["required"],
        json!(["source", "destination", "kind", "conflictPolicy"])
    );
    assert!(schema.get("required").is_none());
    assert!(schema["additionalProperties"] == false);
    assert!(properties.contains_key("source"));
    assert!(properties.contains_key("destination"));
    assert_eq!(properties["idleTimeoutSeconds"]["minimum"], 30);
    assert_eq!(properties["idleTimeoutSeconds"]["maximum"], 3600);
    assert!(!properties.contains_key("hostId"));
    assert!(!properties.contains_key("localPath"));
    assert!(!properties.contains_key("remotePath"));
    assert!(!properties.contains_key("direction"));
    assert_eq!(
        properties["source"]["oneOf"][0]["properties"]["type"]["const"],
        "local"
    );
    assert_eq!(
        properties["source"]["oneOf"][1]["properties"]["type"]["const"],
        "remote"
    );

    let retry_tool = state
        .mcp_tool_catalog()
        .list_tools()
        .into_iter()
        .find(|tool| tool.id == "sftp.transfer.retry")
        .expect("sftp transfer retry tool");
    assert_eq!(retry_tool.input_schema["required"], json!(["transferId"]));
    assert_eq!(
        retry_tool.input_schema["properties"]["transferId"]["type"],
        "string"
    );
}

/// 验证三种 canonical 路由都进入现有队列，并只返回 destination projection。
#[tokio::test]
async fn mcp_sftp_transfer_enqueue_returns_canonical_projection_for_three_routes() {
    let (_home, state) = test_state();
    let source_host_id = create_saved_password_host(&state);
    let target_host_id = create_saved_password_host(&state);
    let tools = state.mcp_tool_catalog().list_tools();

    let cases = [
        (
            json!({
                "source": { "type": "local", "path": "C:/data/report.txt" },
                "destination": { "type": "remote", "hostId": source_host_id, "path": "/data/report.txt" },
                "kind": "file",
                "conflictPolicy": "overwrite"
            }),
            "upload",
            "local",
            "remote",
        ),
        (
            json!({
                "source": { "type": "remote", "hostId": source_host_id, "path": "/data/report" },
                "destination": { "type": "local", "path": "C:/data/report" },
                "kind": "directory",
                "conflictPolicy": "rename"
            }),
            "download",
            "remote",
            "local",
        ),
        (
            json!({
                "source": { "type": "remote", "hostId": source_host_id, "path": "/data/report" },
                "destination": { "type": "remote", "hostId": target_host_id, "path": "/backup/report" },
                "kind": "directory",
                "conflictPolicy": "skip"
            }),
            "remoteCopy",
            "remote",
            "remote",
        ),
    ];

    for (arguments, operation, source_type, destination_type) in cases {
        let output = state
            .mcp_tool_executor()
            .execute(
                mcp_context(&state, state.ssh_commands()),
                &tools,
                "sftp.transfer.enqueue",
                arguments,
            )
            .await
            .expect("enqueue canonical transfer");

        assert_eq!(output.status, McpToolExecutionStatus::Succeeded);
        let transfer = &output.data["transfer"];
        assert_eq!(transfer["operation"], operation);
        assert_eq!(transfer["source"]["type"], source_type);
        assert_eq!(transfer["destination"]["type"], destination_type);
        assert_eq!(transfer["idleTimeoutSeconds"], 180);
        assert_eq!(transfer["cancelRequested"], false);
        assert_eq!(transfer["recoveryAttempt"], 0);
        assert_eq!(transfer["retryable"], false);
        assert_eq!(transfer["resumable"], false);
        assert!(transfer.get("target").is_none());
        assert!(transfer.get("hostLabel").is_none());
        assert!(transfer.get("localPath").is_none());
        assert!(transfer.get("remotePath").is_none());
        assert_eq!(output.entities.len(), 1);
        assert!(output
            .next_hints
            .iter()
            .any(|hint| hint.contains("sftp.transfer.list")));
    }
}

/// 验证 MCP 入队会固化边界值，并在网络任务开始前拒绝范围外的无进度保护值。
#[tokio::test]
async fn mcp_sftp_transfer_enqueue_validates_and_projects_idle_timeout() {
    let (_home, state) = test_state();
    let host_id = create_saved_password_host(&state);
    let tools = state.mcp_tool_catalog().list_tools();

    for idle_timeout_seconds in [30, 3600] {
        let output = state
            .mcp_tool_executor()
            .execute(
                mcp_context(&state, state.ssh_commands()),
                &tools,
                "sftp.transfer.enqueue",
                json!({
                    "source": { "type": "local", "path": "C:/data/report.txt" },
                    "destination": { "type": "remote", "hostId": host_id, "path": "/data/report.txt" },
                    "kind": "file",
                    "conflictPolicy": "overwrite",
                    "idleTimeoutSeconds": idle_timeout_seconds
                }),
            )
            .await
            .expect("enqueue bounded idle-timeout transfer");
        assert_eq!(output.status, McpToolExecutionStatus::Succeeded);
        assert_eq!(
            output.data["transfer"]["idleTimeoutSeconds"],
            idle_timeout_seconds
        );
    }

    let invalid = state
        .mcp_tool_executor()
        .execute(
            mcp_context(&state, state.ssh_commands()),
            &tools,
            "sftp.transfer.enqueue",
            json!({
                "source": { "type": "local", "path": "C:/data/report.txt" },
                "destination": { "type": "remote", "hostId": host_id, "path": "/data/report.txt" },
                "kind": "file",
                "conflictPolicy": "overwrite",
                "idleTimeoutSeconds": 3601
            }),
        )
        .await
        .expect("return validation failure result");
    assert_eq!(invalid.status, McpToolExecutionStatus::Failed);
    assert!(invalid
        .error
        .as_deref()
        .is_some_and(|message| message.contains("30-3600")));
}

/// 验证已退役同步工具不再出现在自发现目录，旧缓存调用也只收到无副作用迁移提示。
#[tokio::test]
async fn mcp_sftp_retired_sync_tools_return_migration_hint() {
    let (_home, state) = test_state();
    let tools = state.mcp_tool_catalog().list_tools();

    for tool_id in [
        "sftp.upload",
        "sftp.upload_directory",
        "sftp.download",
        "sftp.download_directory",
    ] {
        assert!(tools.iter().all(|tool| tool.id != tool_id));
        let output = state
            .mcp_tool_executor()
            .execute(
                mcp_context(&state, state.ssh_commands()),
                &tools,
                tool_id,
                json!({}),
            )
            .await
            .expect("return retired-tool migration result");
        assert_eq!(output.status, McpToolExecutionStatus::Failed);
        assert_eq!(
            output.data["migration"],
            "sftp.transfer.enqueue -> sftp.transfer.list -> sftp.transfer.cancel/retry"
        );
    }
}

/// 验证旧 flat 参数能通过真实 MCP executor 进入兼容路由，而不是被 canonical 必填门禁拦截。
#[tokio::test]
async fn mcp_sftp_transfer_enqueue_accepts_legacy_flat_arguments() {
    let (_home, state) = test_state();
    let host_id = create_saved_password_host(&state);
    let output = state
        .mcp_tool_executor()
        .execute(
            mcp_context(&state, state.ssh_commands()),
            &state.mcp_tool_catalog().list_tools(),
            "sftp.transfer.enqueue",
            json!({
                "hostId": host_id,
                "remotePath": "/data/report.txt",
                "localPath": "C:/data/report.txt",
                "direction": "upload",
                "kind": "file",
                "conflictPolicy": "skip"
            }),
        )
        .await
        .expect("legacy enqueue call");

    assert_eq!(output.status, McpToolExecutionStatus::Succeeded);
    assert_eq!(output.data["transfer"]["operation"], "upload");
    assert_eq!(output.data["transfer"]["conflictPolicy"], "skip");
}

/// 验证 transferId 查询只返回精确任务，不存在任务仍以成功的空结果返回，并覆盖清理响应形状。
#[tokio::test]
async fn mcp_sftp_transfer_list_filters_by_id_and_clear_returns_counts() {
    let (_home, state) = test_state();
    let host_id = create_saved_password_host(&state);
    let tools = state.mcp_tool_catalog().list_tools();
    let enqueue = state
        .mcp_tool_executor()
        .execute(
            mcp_context(&state, state.ssh_commands()),
            &tools,
            "sftp.transfer.enqueue",
            json!({
                "source": { "type": "local", "path": "C:/data/report.txt" },
                "destination": { "type": "remote", "hostId": host_id, "path": "/data/report.txt" },
                "kind": "file",
                "conflictPolicy": "overwrite"
            }),
        )
        .await
        .expect("enqueue transfer");
    let transfer_id = enqueue.data["transfer"]["id"]
        .as_str()
        .expect("transfer id")
        .to_owned();

    let exact = state
        .mcp_tool_executor()
        .execute(
            mcp_context(&state, state.ssh_commands()),
            &tools,
            "sftp.transfer.list",
            json!({ "transferId": transfer_id }),
        )
        .await
        .expect("exact transfer list");
    assert_eq!(exact.status, McpToolExecutionStatus::Succeeded);
    assert_eq!(exact.data["count"], 1);
    assert_eq!(exact.data["transfers"].as_array().map(Vec::len), Some(1));

    let missing = state
        .mcp_tool_executor()
        .execute(
            mcp_context(&state, state.ssh_commands()),
            &tools,
            "sftp.transfer.list",
            json!({ "transferId": "missing-transfer" }),
        )
        .await
        .expect("missing transfer list");
    assert_eq!(missing.status, McpToolExecutionStatus::Succeeded);
    assert_eq!(missing.data["count"], 0);
    assert!(missing.data["transfers"]
        .as_array()
        .is_some_and(Vec::is_empty));

    let clear = state
        .mcp_tool_executor()
        .execute(
            mcp_context(&state, state.ssh_commands()),
            &tools,
            "sftp.transfer.clear_completed",
            json!({}),
        )
        .await
        .expect("clear completed transfers");
    assert_eq!(clear.status, McpToolExecutionStatus::Succeeded);
    assert!(clear.data.get("removedCount").is_some());
    assert!(clear.data.get("remainingCount").is_some());
}

/// 验证 canonical local-local 请求在 MCP 入队前失败，且不会制造队列残留任务。
#[tokio::test]
async fn mcp_sftp_transfer_enqueue_rejects_local_local_without_residue() {
    let (_home, state) = test_state();
    let tools = state.mcp_tool_catalog().list_tools();
    let output = state
        .mcp_tool_executor()
        .execute(
            mcp_context(&state, state.ssh_commands()),
            &tools,
            "sftp.transfer.enqueue",
            json!({
                "source": { "type": "local", "path": "C:/data/source" },
                "destination": { "type": "local", "path": "C:/data/target" },
                "kind": "directory",
                "conflictPolicy": "rename"
            }),
        )
        .await
        .expect("local-local rejection result");

    assert_eq!(output.status, McpToolExecutionStatus::Failed);
    assert!(output
        .error
        .as_deref()
        .is_some_and(|error| error.contains("local -> local")));

    let listed = state
        .mcp_tool_executor()
        .execute(
            mcp_context(&state, state.ssh_commands()),
            &tools,
            "sftp.transfer.list",
            json!({}),
        )
        .await
        .expect("list after rejected transfer");
    assert_eq!(listed.data["count"], 0);
}

/// 验证取消传输也返回 canonical projection 和 entity，且不泄漏内部 legacy 字段。
#[tokio::test]
async fn mcp_sftp_transfer_cancel_returns_canonical_projection() {
    let (_home, state) = test_state();
    let host_id = create_saved_password_host(&state);
    let tools = state.mcp_tool_catalog().list_tools();
    let enqueue = state
        .mcp_tool_executor()
        .execute(
            mcp_context(&state, state.ssh_commands()),
            &tools,
            "sftp.transfer.enqueue",
            json!({
                "source": { "type": "local", "path": "C:/data/cancel-source" },
                "destination": { "type": "remote", "hostId": host_id, "path": "/data/cancel-target" },
                "kind": "directory",
                "conflictPolicy": "rename"
            }),
        )
        .await
        .expect("enqueue transfer before cancel");
    assert_eq!(enqueue.status, McpToolExecutionStatus::Succeeded);
    let transfer_id = enqueue.data["transfer"]["id"]
        .as_str()
        .expect("transfer id")
        .to_owned();

    let canceled = state
        .mcp_tool_executor()
        .execute(
            mcp_context(&state, state.ssh_commands()),
            &tools,
            "sftp.transfer.cancel",
            json!({ "transferId": transfer_id }),
        )
        .await
        .expect("cancel transfer");

    assert_eq!(canceled.status, McpToolExecutionStatus::Succeeded);
    let transfer = canceled.data["transfer"]
        .as_object()
        .expect("transfer data");
    assert_eq!(transfer["id"], json!(transfer_id));
    for field in ["target", "hostLabel", "localPath", "remotePath"] {
        assert!(
            transfer.get(field).is_none(),
            "legacy field leaked: {field}"
        );
    }
    let entity = canceled
        .entities
        .first()
        .and_then(|entity| entity.get("transfer"))
        .and_then(Value::as_object)
        .expect("canonical transfer entity");
    assert_eq!(entity["id"], json!(transfer_id));
    for field in ["target", "hostLabel", "localPath", "remotePath"] {
        assert!(
            entity.get(field).is_none(),
            "legacy entity field leaked: {field}"
        );
    }
}

/// 先同步取消排队文件，再从公开 MCP 入口重试两次；锁定短调用与唯一后继契约。
#[tokio::test(flavor = "current_thread")]
async fn mcp_sftp_transfer_retry_reuses_one_successor_and_requires_followup_query() {
    let (home, state) = test_state();
    let host_id = create_saved_password_host(&state);
    let source = home.path().join("probe.bin");
    fs::write(&source, b"probe").expect("write source");
    let source_task = state
        .sftp()
        .enqueue_transfer(
            state.paths(),
            SftpManagedTransferRequest {
                host_id,
                remote_path: "/tmp/kerminal-mcp-retry-test.bin".to_owned(),
                local_path: source.to_string_lossy().into_owned(),
                direction: SftpTransferDirection::Upload,
                kind: SftpTransferKind::File,
                conflict_policy: SftpTransferConflictPolicy::Overwrite,
                view_scope: None,
                idle_timeout_seconds: Some(30),
            },
        )
        .expect("enqueue source task");
    let canceled = state
        .sftp()
        .cancel_transfer(SftpTransferCancelRequest {
            transfer_id: source_task.id.clone(),
            view_scope: None,
        })
        .expect("cancel queued source task");
    assert!(canceled.retryable);

    let tools = state.mcp_tool_catalog().list_tools();
    let unavailable = state
        .mcp_tool_executor()
        .execute(
            mcp_context(&state, state.ssh_commands()),
            &tools,
            "sftp.transfer.retry",
            json!({ "transferId": "missing-transfer" }),
        )
        .await
        .expect("unknown retry returns stable result");
    assert_eq!(unavailable.status, McpToolExecutionStatus::Failed);
    assert_eq!(
        unavailable.error_kind.as_deref(),
        Some("sftpTransferRetryUnavailable")
    );
    assert!(unavailable
        .next_hints
        .iter()
        .any(|hint| hint.contains("sftp.transfer.list")));
    let first = state
        .mcp_tool_executor()
        .execute(
            mcp_context(&state, state.ssh_commands()),
            &tools,
            "sftp.transfer.retry",
            json!({ "transferId": source_task.id }),
        )
        .await
        .expect("first retry call");
    assert_eq!(first.status, McpToolExecutionStatus::Succeeded);
    let successor_id = first.data["retry"]["transferId"]
        .as_str()
        .expect("successor id")
        .to_owned();
    assert_eq!(first.data["retry"]["sourceTransferId"], source_task.id);
    assert_eq!(first.data["retry"]["accepted"], true);
    assert_eq!(first.data["retry"]["resumeMode"], "pendingValidation");
    assert_eq!(first.data["transfer"]["idleTimeoutSeconds"], 30);
    assert!(first
        .next_hints
        .iter()
        .any(|hint| hint.contains("sftp.transfer.list")));

    let repeated = state
        .mcp_tool_executor()
        .execute(
            mcp_context(&state, state.ssh_commands()),
            &tools,
            "sftp.transfer.retry",
            json!({ "transferId": source_task.id }),
        )
        .await
        .expect("repeated retry call");
    assert_eq!(repeated.status, McpToolExecutionStatus::Succeeded);
    assert_eq!(repeated.data["retry"]["transferId"], successor_id);

    let source_snapshot = state
        .mcp_tool_executor()
        .execute(
            mcp_context(&state, state.ssh_commands()),
            &tools,
            "sftp.transfer.list",
            json!({ "transferId": source_task.id }),
        )
        .await
        .expect("source list");
    assert_eq!(
        source_snapshot.data["transfers"][0]["successorId"],
        successor_id
    );
    assert!(source_snapshot
        .next_hints
        .iter()
        .any(|hint| hint.contains("successorId")));
}
