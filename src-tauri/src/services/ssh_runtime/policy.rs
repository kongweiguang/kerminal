//! Managed SSH runtime policy decisions shared by capability services.
//!
//! @author kongweiguang

use std::path::Path;

use russh::keys::PublicKey;

use crate::error::AppError;

use super::{
    SshRuntimeHostKeyPolicy, MANAGED_SSH_DYNAMIC_FORWARD_UNSUPPORTED, MANAGED_SSH_EXEC_UNSUPPORTED,
    MANAGED_SSH_LOCAL_FORWARD_UNSUPPORTED, MANAGED_SSH_REMOTE_DYNAMIC_FORWARD_UNSUPPORTED,
    MANAGED_SSH_REMOTE_FORWARD_UNSUPPORTED, MANAGED_SSH_SFTP_UNSUPPORTED,
    MANAGED_SSH_SHELL_UNSUPPORTED, MANAGED_SSH_STREAMING_EXEC_UNSUPPORTED,
};

const EXTERNAL_TARGET_ID_PREFIX: &str = "external:";
const MANAGED_RUNTIME_UNWIRED: &str = "managed SSH runtime backend is not wired yet";

/// Managed SSH capability used for fallback and unsupported classification.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SshRuntimeCapability {
    Shell,
    Exec,
    StreamingExec,
    Sftp,
    Forward,
}

/// Returns whether a host id refers to an external launch temporary target.
pub fn is_external_runtime_target_id(host_id: &str) -> bool {
    host_id.starts_with(EXTERNAL_TARGET_ID_PREFIX)
}

/// Host key policy shared by shell, exec, SFTP and forwarding.
pub fn runtime_host_key_policy_for_host_id(host_id: &str) -> SshRuntimeHostKeyPolicy {
    let _ = host_id;
    // 外部启动通常就是首次连接，silent TOFU 无法防御首次中间人攻击。
    // 所有 managed SSH 目标都先要求 known_hosts；外部目标通过显式指纹确认流程写入信任。
    SshRuntimeHostKeyPolicy::RequireKnown
}

/// User-facing error for a missing external launch target.
pub fn external_target_not_available_error(host_id: &str) -> AppError {
    let request_hash = host_id
        .strip_prefix(EXTERNAL_TARGET_ID_PREFIX)
        .map(crate::services::external_launch::redaction::opaque_id_hash)
        .unwrap_or_else(|| crate::services::external_launch::redaction::opaque_id_hash(host_id));
    AppError::NotFound(format!(
        "外部 SSH 临时目标不存在或已关闭: request_hash={request_hash}"
    ))
}

/// `russh` 的 known_hosts 匹配忽略 OpenSSH `@revoked`，连接前必须额外按 key hard fail。
pub fn known_hosts_revokes_key(key: &PublicKey, known_hosts_path: &Path) -> bool {
    let Ok(expected) = key.to_openssh() else {
        return true;
    };
    let Ok(content) = std::fs::read_to_string(known_hosts_path) else {
        return false;
    };
    content.lines().any(|line| {
        let mut fields = line.split_whitespace();
        if fields.next() != Some("@revoked") {
            return false;
        }
        let _patterns = fields.next();
        let Some(algorithm) = fields.next() else {
            return false;
        };
        let Some(encoded_key) = fields.next() else {
            return false;
        };
        format!("{algorithm} {encoded_key}") == expected
    })
}

/// Whether a managed runtime backend is not connected yet.
pub fn is_managed_runtime_unwired(error: &AppError) -> bool {
    matches!(error, AppError::SshCommand(message) if message == MANAGED_RUNTIME_UNWIRED)
}

/// Whether a managed runtime capability is unsupported by the active backend.
pub fn is_capability_unsupported(error: &AppError, capability: SshRuntimeCapability) -> bool {
    let Some(message) = managed_capability_error_message(error) else {
        return false;
    };
    match capability {
        SshRuntimeCapability::Shell => message == MANAGED_SSH_SHELL_UNSUPPORTED,
        SshRuntimeCapability::Exec => message == MANAGED_SSH_EXEC_UNSUPPORTED,
        SshRuntimeCapability::StreamingExec => message == MANAGED_SSH_STREAMING_EXEC_UNSUPPORTED,
        SshRuntimeCapability::Sftp => message == MANAGED_SSH_SFTP_UNSUPPORTED,
        SshRuntimeCapability::Forward => matches!(
            message,
            MANAGED_SSH_LOCAL_FORWARD_UNSUPPORTED
                | MANAGED_SSH_REMOTE_FORWARD_UNSUPPORTED
                | MANAGED_SSH_DYNAMIC_FORWARD_UNSUPPORTED
                | MANAGED_SSH_REMOTE_DYNAMIC_FORWARD_UNSUPPORTED
        ),
    }
}

fn managed_capability_error_message(error: &AppError) -> Option<&str> {
    match error {
        AppError::SshCommand(message) => Some(message),
        AppError::Sftp(message) => message
            .strip_prefix("受管 SSH SFTP channel 失败: ")
            .or_else(|| message.strip_prefix("受管 SSH exec channel 失败: ")),
        _ => None,
    }
}

/// Whether a failed operation is a pre-command transient channel-open failure.
pub fn is_retryable_channel_open_error(error: &AppError) -> bool {
    let message = error.to_string().to_ascii_lowercase();
    message.contains("failed to open channel")
        || message.contains("connectfailed")
        || (message.contains("open channel") && message.contains("failed"))
        || (message.contains("channel open") && message.contains("failed"))
}
