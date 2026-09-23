// @author kongweiguang

use super::*;
use crate::sftp_test_support::{create_password_remote_host, loopback::start_loopback_sftp_server};

/// 验证生成的 Streamable HTTP 配置暴露 canonical SFTP schema、拒绝 local-local，并执行远端复制。
#[tokio::test]
async fn generated_configs_expose_canonical_sftp_transfer_contract() {
    install_test_rustls_provider();

    let home = tempfile::tempdir().expect("temp home");
    let paths = KerminalPaths::from_home_dir(home.path());
    let state = AppState::initialize_with_paths(paths).expect("initialize app state");
    let app = tauri::test::mock_builder()
        .manage(state)
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("build mock app");
    let state = app.state::<AppState>();
    let status = state
        .mcp_http_server()
        .start(
            app.handle().clone(),
            Some(McpHttpServerStartRequest {
                host: Some("127.0.0.1".to_owned()),
                port: Some(0),
            }),
        )
        .await
        .expect("start mcp server");
    let endpoint = status.endpoint.expect("endpoint");
    let client = ClientInfo::default()
        .serve(StreamableHttpClientTransport::from_config(
            StreamableHttpClientTransportConfig::with_uri(endpoint),
        ))
        .await
        .expect("connect mcp client");
    let tools = client
        .peer()
        .list_tools(None)
        .await
        .expect("list tools through mcp endpoint");
    let enqueue_tool = tools
        .tools
        .iter()
        .find(|tool| tool.name == "sftp.transfer.enqueue")
        .expect("sftp transfer enqueue tool through mcp endpoint");
    let mut properties = enqueue_tool.input_schema["properties"]
        .as_object()
        .expect("enqueue schema properties")
        .keys()
        .cloned()
        .collect::<Vec<_>>();
    properties.sort_unstable();
    assert_eq!(
        properties,
        vec![
            "conflictPolicy",
            "destination",
            "idleTimeoutSeconds",
            "kind",
            "source"
        ]
    );
    assert_eq!(
        enqueue_tool.input_schema["allOf"][0]["required"],
        serde_json::json!(["source", "destination", "kind", "conflictPolicy"])
    );
    assert_eq!(
        enqueue_tool.input_schema["properties"]["idleTimeoutSeconds"]["minimum"],
        30
    );
    assert_eq!(
        enqueue_tool.input_schema["properties"]["idleTimeoutSeconds"]["maximum"],
        3600
    );
    let retry_tool = tools
        .tools
        .iter()
        .find(|tool| tool.name == "sftp.transfer.retry")
        .expect("sftp transfer retry tool through mcp endpoint");
    assert_eq!(
        retry_tool.input_schema["required"],
        serde_json::json!(["transferId"])
    );

    let local_local = client
        .peer()
        .call_tool(
            CallToolRequestParams::new("sftp.transfer.enqueue").with_arguments(
                serde_json::json!({
                    "source": { "type": "local", "path": "C:/data/source" },
                    "destination": { "type": "local", "path": "C:/data/target" },
                    "kind": "directory",
                    "conflictPolicy": "rename"
                })
                .as_object()
                .cloned()
                .expect("local-local arguments object"),
            ),
        )
        .await
        .expect("local-local transfer returns structured tool error");
    assert_eq!(local_local.is_error, Some(true));
    assert!(local_local
        .structured_content
        .as_ref()
        .and_then(|content| content.pointer("/error"))
        .and_then(Value::as_str)
        .is_some_and(|error| error.contains("local -> local")));

    let source_root = tempfile::tempdir().expect("source SFTP root");
    let target_root = tempfile::tempdir().expect("target SFTP root");
    tokio::fs::write(source_root.path().join("artifact.txt"), b"mcp remote copy")
        .await
        .expect("seed source SFTP file");
    let source_server = start_loopback_sftp_server(source_root.path().to_path_buf()).await;
    let target_server = start_loopback_sftp_server(target_root.path().to_path_buf()).await;
    let source_host_id =
        create_password_remote_host(&state, "mcp source", source_server.addr.port());
    let target_host_id =
        create_password_remote_host(&state, "mcp target", target_server.addr.port());
    for host_id in [&source_host_id, &target_host_id] {
        state
            .sftp()
            .trust_host_key(
                state.paths(),
                SftpTrustHostKeyRequest {
                    host_id: host_id.clone(),
                },
            )
            .await
            .expect("trust loopback SFTP host");
    }

    let remote_copy = client
        .peer()
        .call_tool(
            CallToolRequestParams::new("sftp.transfer.enqueue").with_arguments(
                serde_json::json!({
                    "source": { "type": "remote", "hostId": source_host_id, "path": "/artifact.txt" },
                    "destination": { "type": "remote", "hostId": target_host_id, "path": "/copied.txt" },
                    "kind": "file",
                    "conflictPolicy": "overwrite"
                })
                .as_object()
                .cloned()
                .expect("remote copy arguments object"),
            ),
        )
        .await
        .expect("enqueue remote copy through MCP endpoint");
    assert_eq!(remote_copy.is_error, Some(false));
    assert!(
        remote_copy
            .structured_content
            .as_ref()
            .and_then(|content| content.pointer("/nextHints"))
            .and_then(Value::as_array)
            .is_some_and(|hints| hints.iter().any(|hint| {
                hint.as_str()
                    .is_some_and(|hint| hint.contains("sftp.transfer.list"))
            })),
        "successful MCP calls must preserve nextHints"
    );
    let transfer_id = remote_copy
        .structured_content
        .as_ref()
        .and_then(|content| content.pointer("/data/transfer/id"))
        .and_then(Value::as_str)
        .expect("remote copy transfer id")
        .to_owned();
    for _ in 0..100 {
        let listed = client
            .peer()
            .call_tool(
                CallToolRequestParams::new("sftp.transfer.list").with_arguments(
                    serde_json::json!({ "transferId": transfer_id })
                        .as_object()
                        .cloned()
                        .expect("transfer list arguments object"),
                ),
            )
            .await
            .expect("poll remote copy through MCP endpoint");
        match listed
            .structured_content
            .as_ref()
            .and_then(|content| content.pointer("/data/transfers/0/status"))
            .and_then(Value::as_str)
        {
            Some("succeeded") => break,
            Some("failed" | "canceled") => panic!("remote copy failed: {listed:?}"),
            _ => tokio::time::sleep(std::time::Duration::from_millis(20)).await,
        }
    }
    assert_eq!(
        tokio::fs::read(target_root.path().join("copied.txt"))
            .await
            .expect("read MCP remote copy target"),
        b"mcp remote copy"
    );

    let _ = client.cancel().await;
    state.mcp_http_server().stop().expect("stop mcp server");
}
