//! Explicit, opt-in live MCP probe. All remote operations use the official MCP client.
//! @author kongweiguang

use futures::FutureExt;
use rmcp::{
    model::{CallToolRequestParams, ClientInfo},
    service::Peer,
    transport::{
        streamable_http_client::StreamableHttpClientTransportConfig, StreamableHttpClientTransport,
    },
    RoleClient, ServiceExt,
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    error::Error,
    fs::File,
    io::{Read, Write},
    panic::AssertUnwindSafe,
    path::Path,
    time::{Duration, Instant},
};
use tokio::time::sleep;
use uuid::Uuid;

type ProbeResult<T> = Result<T, Box<dyn Error>>;

/// 不输出服务器错误正文，防止现场凭据或 endpoint 意外进入测试日志。
async fn call(client: &Peer<RoleClient>, tool: &str, args: Value) -> ProbeResult<Value> {
    let response = client
        .call_tool(
            CallToolRequestParams::new(tool.to_owned()).with_arguments(
                args.as_object()
                    .cloned()
                    .ok_or("arguments must be an object")?,
            ),
        )
        .await
        .map_err(|_| format!("MCP transport failed for {tool}"))?;
    if response.is_error == Some(true) {
        return Err(format!("MCP tool failed: {tool}").into());
    }
    response
        .structured_content
        .ok_or_else(|| "missing structured MCP result".into())
}

/// 入队必须在短调用预算内返回 queued；立即登记 id，后续校验失败也可清理该任务。
async fn enqueue(
    client: &Peer<RoleClient>,
    ids: &mut Vec<String>,
    source: Value,
    destination: Value,
) -> ProbeResult<String> {
    let started = Instant::now();
    let value = match call(client, "sftp.transfer.enqueue", json!({"source":source,"destination":destination,"kind":"file","conflictPolicy":"overwrite"})).await {
        Ok(value) => value,
        Err(error) => {
            // 响应丢失时后台可能已入队；无法按 id 证明已停止，就保留远端目录。
            ids.push(String::new());
            return Err(error);
        }
    };
    let elapsed = started.elapsed();
    let id = match value.pointer("/data/transfer/id").and_then(Value::as_str) {
        Some(id) => id.to_owned(),
        None => {
            // 已被远端接受却丢失 id 时无法证明写入已停止，保留测试目录供人工排查。
            ids.push(String::new());
            return Err("missing transfer id".into());
        }
    };
    ids.push(id.clone());
    if elapsed >= Duration::from_secs(5) {
        return Err("enqueue was not a short MCP call".into());
    }
    if value
        .pointer("/data/transfer/status")
        .and_then(Value::as_str)
        != Some("queued")
    {
        return Err("enqueue response did not report queue acceptance".into());
    }
    eprintln!("MCP enqueue accepted in {} ms", elapsed.as_millis());
    if !value
        .get("nextHints")
        .and_then(Value::as_array)
        .is_some_and(|hints| {
            hints.iter().any(|hint| {
                hint.as_str()
                    .is_some_and(|s| s.contains("sftp.transfer.list"))
            })
        })
    {
        return Err("successful wire result dropped polling nextHints".into());
    }
    Ok(id)
}

/// 仅按 transferId 查询权威投影，不通过文件暂未出现推断上传失败。
async fn snapshot(client: &Peer<RoleClient>, id: &str) -> ProbeResult<Value> {
    call(client, "sftp.transfer.list", json!({"transferId":id}))
        .await?
        .pointer("/data/transfers/0")
        .cloned()
        .ok_or_else(|| "transfer missing from list".into())
}

/// 取消与原子提交竞态可合法成功，所有三种终态都必须终止轮询。
fn terminal(value: &Value) -> bool {
    matches!(
        value.get("status").and_then(Value::as_str),
        Some("succeeded" | "failed" | "canceled")
    )
}

/// 现场探针上限只限制测试等待，不能改动被测传输的 idle timeout。
async fn wait_terminal(client: &Peer<RoleClient>, id: &str) -> ProbeResult<Value> {
    let deadline = Instant::now() + Duration::from_secs(1800);
    loop {
        let value = snapshot(client, id).await?;
        if terminal(&value) {
            return Ok(value);
        }
        if Instant::now() >= deadline {
            return Err("probe terminal wait expired".into());
        }
        sleep(Duration::from_millis(100)).await;
    }
}

/// 用成功状态和下载后的字节摘要联合验收，同时记录终态耗时与确认字节供现场判读。
async fn require_success(client: &Peer<RoleClient>, id: &str) -> ProbeResult<()> {
    let started = Instant::now();
    let final_snapshot = wait_terminal(client, id).await?;
    if final_snapshot.get("status").and_then(Value::as_str) != Some("succeeded") {
        return Err("transfer did not succeed".into());
    }
    eprintln!(
        "MCP transfer succeeded in {} ms, confirmed bytes {}",
        started.elapsed().as_millis(),
        final_snapshot
            .pointer("/progress/bytesTransferred")
            .and_then(Value::as_u64)
            .unwrap_or(0)
    );
    Ok(())
}

/// 回下载每个独立目标并验证摘要，避免并发任务串线或部分内容提交漏检。
async fn verify_download(
    client: &Peer<RoleClient>,
    ids: &mut Vec<String>,
    host: &str,
    remote: &str,
    local: &Path,
    digest: &str,
) -> ProbeResult<()> {
    let id = enqueue(
        client,
        ids,
        json!({"type":"remote","hostId":host,"path":remote}),
        json!({"type":"local","path":local.to_string_lossy()}),
    )
    .await?;
    require_success(client, &id).await?;
    if sha256_file(local)? != digest {
        return Err("download SHA-256 mismatch".into());
    }
    Ok(())
}

/// 先停止全部已登记任务并等终态，才删除本次 UUID 目录的精确 final/partial/checkpoint 文件。
/// checkpoint 当前位于内存；磁盘 sidecar 若存在仅接受本次已知目标后缀，绝不递归删除目录。
async fn cleanup(
    client: &Peer<RoleClient>,
    ids: &[String],
    host: &str,
    root: &str,
    paths: &[String],
) -> ProbeResult<()> {
    let mut stopped = true;
    for id in ids {
        match snapshot(client, id).await {
            Ok(value) if terminal(&value) => {}
            Ok(_) => {
                if call(client, "sftp.transfer.cancel", json!({"transferId":id}))
                    .await
                    .is_err()
                {
                    stopped = false;
                }
            }
            Err(_) => stopped = false,
        }
    }
    for id in ids {
        if wait_terminal(client, id).await.is_err() {
            stopped = false;
        }
    }
    if !stopped {
        return Err(
            "cleanup stopped: could not confirm every task terminal; probe directory retained"
                .into(),
        );
    }
    let listing = call(client, "sftp.list", json!({"hostId":host,"path":root})).await?;
    let entries = listing
        .pointer("/data/entries")
        .and_then(Value::as_array)
        .ok_or("cleanup listing missing entries")?;
    for entry in entries {
        let path = entry
            .get("path")
            .and_then(Value::as_str)
            .ok_or("cleanup entry missing path")?;
        if !paths.iter().any(|target| {
            path == target
                || path == format!("{target}.kerminal-part")
                || path == format!("{target}.kerminal-part.checkpoint")
        }) {
            return Err("cleanup refused an unexpected entry in the probe directory".into());
        }
        call(
            client,
            "sftp.delete",
            json!({"hostId":host,"path":path,"directory":false}),
        )
        .await?;
    }
    call(
        client,
        "sftp.delete",
        json!({"hostId":host,"path":root,"directory":true}),
    )
    .await?;
    Ok(())
}

/// 显式运行必须提供新 dev endpoint 和 saved host，并通过 MCP 握手版本及 runtime 快照
/// 拒绝误连其它 Kerminal 进程；默认 200 MiB 不意味着必定超过 60 秒。
/// 长传输时间边界由可控 loopback 测试覆盖，本探针只报告实际发生的现场结果。
#[tokio::test]
#[ignore = "requires explicit dev MCP endpoint and saved writable SFTP host"]
async fn live_sftp_mcp_probe() -> ProbeResult<()> {
    let endpoint = std::env::var("KERMINAL_SFTP_PROBE_ENDPOINT")
        .ok()
        .filter(|v| !v.trim().is_empty())
        .ok_or("KERMINAL_SFTP_PROBE_ENDPOINT is required")?;
    let host = std::env::var("KERMINAL_SFTP_PROBE_HOST_ID")
        .ok()
        .filter(|v| !v.trim().is_empty())
        .ok_or("KERMINAL_SFTP_PROBE_HOST_ID is required")?;
    let bytes = match std::env::var("KERMINAL_SFTP_PROBE_BYTES") {
        Ok(value) => value.parse::<u64>()?,
        Err(_) => 200 * 1024 * 1024,
    };
    if bytes == 0 {
        return Err("probe bytes must be positive".into());
    }
    let _ = rustls::crypto::ring::default_provider().install_default();
    let client = ClientInfo::default()
        .serve(StreamableHttpClientTransport::from_config(
            StreamableHttpClientTransportConfig::with_uri(endpoint),
        ))
        .await
        .map_err(|_| "MCP connection failed")?;
    let server_version = client
        .peer()
        .peer_info()
        .ok_or("MCP initialize reply missing")?
        .server_info
        .version
        .as_str();
    if server_version != env!("CARGO_PKG_VERSION") {
        return Err("MCP server version does not match the tested build".into());
    }
    let local = tempfile::tempdir()?;
    let source = local.path().join("source.bin");
    write_deterministic_payload(&source, bytes)?;
    let digest = sha256_file(&source)?;
    let root = format!("/tmp/kerminal-sftp-mcp-probe-{}", Uuid::new_v4().simple());
    let paths = [
        "source.bin",
        "concurrent-a.bin",
        "concurrent-b.bin",
        "cancel.bin",
    ]
    .map(|name| format!("{root}/{name}"));
    let mut ids = Vec::new();
    let mut directory_created = false;
    let result: ProbeResult<()> = match AssertUnwindSafe(async {
        let capabilities = call(client.peer(), "kerminal.capabilities", json!({})).await?;
        if !capabilities.to_string().contains("sftp.transfer.retry") { return Err("retry capability missing".into()); }
        let guide = call(client.peer(), "kerminal.operation_guide", json!({"intent":"sftp"})).await?;
        if !guide.to_string().contains("sftp.transfer.retry") { return Err("retry guide missing".into()); }
        let runtime = call(client.peer(), "kerminal.runtime_snapshot", json!({})).await?;
        if runtime.pointer("/data/schemaVersion").and_then(Value::as_u64) != Some(1) { return Err("runtime snapshot missing or incompatible".into()); }
        call(client.peer(), "sftp.create_directory", json!({"hostId":host,"path":root})).await?;
        directory_created = true;
        let local_endpoint = json!({"type":"local","path":source.to_string_lossy()});
        let upload = enqueue(client.peer(), &mut ids, local_endpoint.clone(), json!({"type":"remote","hostId":host,"path":paths[0]})).await?;
        require_success(client.peer(), &upload).await?;
        verify_download(client.peer(), &mut ids, &host, &paths[0], &local.path().join("download.bin"), &digest).await?;
        let first = enqueue(client.peer(), &mut ids, local_endpoint.clone(), json!({"type":"remote","hostId":host,"path":paths[1]})).await?;
        let second = enqueue(client.peer(), &mut ids, local_endpoint.clone(), json!({"type":"remote","hostId":host,"path":paths[2]})).await?;
        require_success(client.peer(), &first).await?;
        require_success(client.peer(), &second).await?;
        for (index, path) in paths[1..3].iter().enumerate() {
            verify_download(client.peer(), &mut ids, &host, path, &local.path().join(format!("concurrent-{index}.bin")), &digest).await?;
        }
        let cancel_id = enqueue(client.peer(), &mut ids, local_endpoint, json!({"type":"remote","hostId":host,"path":paths[3]})).await?;
        let progress_deadline = Instant::now() + Duration::from_secs(180);
        loop {
            let state = snapshot(client.peer(), &cancel_id).await?;
            if terminal(&state) { return Err("cancel candidate completed before active ACK observation".into()); }
            if state.pointer("/progress/bytesTransferred").and_then(Value::as_u64).unwrap_or(0) > 0 { break; }
            if Instant::now() >= progress_deadline { return Err("no confirmed ACK before cancellation".into()); }
            sleep(Duration::from_millis(20)).await;
        }
        let start = Instant::now();
        call(client.peer(), "sftp.transfer.cancel", json!({"transferId":cancel_id})).await?;
        let canceled = wait_terminal(client.peer(), &cancel_id).await?;
        if start.elapsed() >= Duration::from_secs(2) { return Err("cancel did not reach terminal within two seconds".into()); }
        if canceled.get("retryable").and_then(Value::as_bool) != Some(true) { return Err("cancel candidate is not retryable (commit may have won); cancellation/retry scenario not verified".into()); }
        let retry = match call(client.peer(), "sftp.transfer.retry", json!({"transferId":cancel_id})).await {
            Ok(value) => value,
            Err(error) => {
                // 首次重试响应丢失时可能已有未知后继写入，保留探针目录。
                ids.push(String::new());
                return Err(error);
            }
        };
        let retry_id = match retry.pointer("/data/retry/transferId").and_then(Value::as_str) {
            Some(id) => id.to_owned(),
            None => {
                ids.push(String::new());
                return Err("missing successor id".into());
            }
        };
        ids.push(retry_id.clone());
        let repeated = match call(client.peer(), "sftp.transfer.retry", json!({"transferId":cancel_id})).await {
            Ok(value) => value,
            Err(error) => {
                ids.push(String::new());
                return Err(error);
            }
        };
        let repeated_id = match repeated.pointer("/data/retry/transferId").and_then(Value::as_str) {
            Some(id) => id.to_owned(),
            None => {
                ids.push(String::new());
                return Err("missing repeated successor id".into());
            }
        };
        ids.push(repeated_id.clone());
        if retry_id != repeated_id { return Err("retry created competing successors".into()); }
        require_success(client.peer(), &retry_id).await?;
        verify_download(client.peer(), &mut ids, &host, &paths[3], &local.path().join("retry.bin"), &digest).await?;
        Ok(())
    }).catch_unwind().await {
        Ok(result) => result,
        Err(_) => Err("live probe panicked; cleanup still executed".into()),
    };
    let cleanup_result = if directory_created {
        cleanup(client.peer(), &ids, &host, &root, &paths).await
    } else {
        Ok(())
    };
    let _ = client.cancel().await;
    // 清理错误不能被原场景失败掩盖，否则现场残留会被误当作已处理。
    cleanup_result?;
    result
}

/// 单独用较大文件验证真实 MCP 任务跨过旧 60 秒调用窗口后仍继续前进；
/// 只创建一个 UUID 远端目标，避免把并发/取消探针的多轮传输放大到数 GiB。
#[tokio::test]
#[ignore = "requires explicit dev MCP endpoint and saved writable SFTP host"]
async fn live_sftp_mcp_upload_runs_beyond_sixty_seconds() -> ProbeResult<()> {
    let endpoint = std::env::var("KERMINAL_SFTP_PROBE_ENDPOINT")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .ok_or("KERMINAL_SFTP_PROBE_ENDPOINT is required")?;
    let host = std::env::var("KERMINAL_SFTP_PROBE_HOST_ID")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .ok_or("KERMINAL_SFTP_PROBE_HOST_ID is required")?;
    let bytes: u64 = 800 * 1024 * 1024;
    let _ = rustls::crypto::ring::default_provider().install_default();
    let client = ClientInfo::default()
        .serve(StreamableHttpClientTransport::from_config(
            StreamableHttpClientTransportConfig::with_uri(endpoint),
        ))
        .await
        .map_err(|_| "MCP connection failed")?;
    if client
        .peer()
        .peer_info()
        .ok_or("MCP initialize reply missing")?
        .server_info
        .version
        != env!("CARGO_PKG_VERSION")
    {
        return Err("MCP server version does not match the tested build".into());
    }
    let local = tempfile::tempdir()?;
    let source = local.path().join("source.bin");
    write_deterministic_payload(&source, bytes)?;
    let digest = sha256_file(&source)?;
    let root = format!("/tmp/kerminal-sftp-mcp-probe-{}", Uuid::new_v4().simple());
    let remote = format!("{root}/source.bin");
    let mut ids = Vec::new();
    let mut directory_created = false;
    let result: ProbeResult<()> = match AssertUnwindSafe(async {
        call(
            client.peer(),
            "sftp.create_directory",
            json!({"hostId":host,"path":root}),
        )
        .await?;
        directory_created = true;
        let id = enqueue(
            client.peer(),
            &mut ids,
            json!({"type":"local","path":source.to_string_lossy()}),
            json!({"type":"remote","hostId":host,"path":remote}),
        )
        .await?;
        let started = Instant::now();
        require_success(client.peer(), &id).await?;
        let elapsed = started.elapsed();
        if elapsed < Duration::from_secs(60) {
            return Err("upload finished too quickly to prove the 60-second boundary".into());
        }
        verify_download(
            client.peer(),
            &mut ids,
            &host,
            &remote,
            &local.path().join("download.bin"),
            &digest,
        )
        .await?;
        eprintln!(
            "MCP upload remained active for {} seconds",
            elapsed.as_secs()
        );
        Ok(())
    })
    .catch_unwind()
    .await
    {
        Ok(result) => result,
        Err(_) => Err("long upload probe panicked; cleanup still executed".into()),
    };
    let cleanup_result = if directory_created {
        cleanup(client.peer(), &ids, &host, &root, &[remote]).await
    } else {
        Ok(())
    };
    let _ = client.cancel().await;
    cleanup_result?;
    result
}

/// 固定非秘密内容允许逐字节验证，同时保持常数内存使用。
fn write_deterministic_payload(path: &Path, bytes: u64) -> ProbeResult<()> {
    let mut file = File::create(path)?;
    let block: Vec<u8> = (0..1024 * 1024).map(|index| (index % 251) as u8).collect();
    let mut remaining = bytes;
    while remaining > 0 {
        let length = remaining.min(block.len() as u64) as usize;
        file.write_all(&block[..length])?;
        remaining -= length as u64;
    }
    file.sync_all()?;
    Ok(())
}

/// 流式计算避免 200 MiB 现场验收引入同量级额外内存。
fn sha256_file(path: &Path) -> ProbeResult<String> {
    let mut file = File::open(path)?;
    let mut hash = Sha256::new();
    let mut buffer = vec![0; 1024 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hash.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hash.finalize()))
}
