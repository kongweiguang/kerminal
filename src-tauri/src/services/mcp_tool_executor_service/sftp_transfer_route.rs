//! Canonical MCP SFTP transfer routing and validation.
//!
//! @author kongweiguang

use serde::Deserialize;

use super::*;
use crate::models::sftp::{SftpRemoteCopyRequest, SftpTransferConflictPolicy};

/// MCP 统一传输请求在现有 SFTP 队列中的路由结果。
///
/// 这个 enum 只负责把 Agent 的端点语义映射到已有 managed transfer 或 remote copy
/// 引擎，避免在 MCP 层复制一套传输实现，也让路由规则可以脱离网络执行单测。
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum SftpTransferRoute {
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
    /// 可选的连续无字节进度保护秒数；为空时使用并固化全局设置。
    #[serde(default)]
    idle_timeout_seconds: Option<u16>,
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
            idle_timeout_seconds: request.idle_timeout_seconds,
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
            idle_timeout_seconds: request.idle_timeout_seconds,
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
                idle_timeout_seconds: request.idle_timeout_seconds,
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
}
