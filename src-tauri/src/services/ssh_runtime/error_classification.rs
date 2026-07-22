//! Managed SSH runtime error classification and user guidance.
//!
//! @author kongweiguang

use serde::Serialize;

use crate::error::AppError;

/// Stable class for SSH runtime failures exposed to diagnostics and UI policy.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SshRuntimeFailureClass {
    AuthCanceled,
    BadCredential,
    KeyPassphraseMissing,
    UnknownHostKey,
    HostKeyChanged,
    JumpFailed,
    Timeout,
    ChannelUnsupported,
    PermissionDenied,
    RemoteExit,
    Canceled,
    CleanupFailed,
    Unknown,
}

impl SshRuntimeFailureClass {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::AuthCanceled => "authCanceled",
            Self::BadCredential => "badCredential",
            Self::KeyPassphraseMissing => "keyPassphraseMissing",
            Self::UnknownHostKey => "unknownHostKey",
            Self::HostKeyChanged => "hostKeyChanged",
            Self::JumpFailed => "jumpFailed",
            Self::Timeout => "timeout",
            Self::ChannelUnsupported => "channelUnsupported",
            Self::PermissionDenied => "permissionDenied",
            Self::RemoteExit => "remoteExit",
            Self::Canceled => "canceled",
            Self::CleanupFailed => "cleanupFailed",
            Self::Unknown => "unknown",
        }
    }
}

/// Classified failure safe to show or persist in diagnostics.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshRuntimeFailure {
    pub class: SshRuntimeFailureClass,
    pub next_action: &'static str,
    pub retryable: bool,
    pub sanitized_detail: String,
    pub user_message: &'static str,
}

pub fn classify_ssh_runtime_app_error(error: &AppError) -> SshRuntimeFailure {
    classify_ssh_runtime_failure(error.to_string())
}

pub fn classify_ssh_runtime_failure(message: impl AsRef<str>) -> SshRuntimeFailure {
    let sanitized_detail = sanitize_ssh_runtime_error_detail(message.as_ref());
    let normalized = sanitized_detail.to_lowercase();
    let failure_class = classify_normalized_message(&normalized);
    let (user_message, next_action, retryable) = failure_guidance(failure_class);

    SshRuntimeFailure {
        class: failure_class,
        next_action,
        retryable,
        sanitized_detail,
        user_message,
    }
}

fn classify_normalized_message(message: &str) -> SshRuntimeFailureClass {
    if contains_any(
        message,
        &[
            "auth canceled",
            "authentication canceled",
            "authentication cancelled",
            "user canceled authentication",
            "user cancelled authentication",
            "认证已取消",
            "用户取消认证",
        ],
    ) {
        return SshRuntimeFailureClass::AuthCanceled;
    }
    if contains_any(
        message,
        &[
            "key passphrase missing",
            "private key passphrase missing",
            "encrypted private key requires passphrase",
            "missing key passphrase",
            "缺少私钥 passphrase",
            "需要私钥 passphrase",
        ],
    ) {
        return SshRuntimeFailureClass::KeyPassphraseMissing;
    }
    if contains_any(
        message,
        &[
            "remote host identification has changed",
            "host key changed",
            "host key mismatch",
            "offending",
            "known_hosts",
            "主机密钥已变化",
            "host key verification failed",
        ],
    ) {
        return SshRuntimeFailureClass::HostKeyChanged;
    }
    if contains_any(
        message,
        &[
            "unknown host key",
            "unknown server key",
            "no host key is known",
            "no matching host key",
            "未知 host key",
            "未知主机密钥",
        ],
    ) {
        return SshRuntimeFailureClass::UnknownHostKey;
    }
    if contains_any(
        message,
        &[
            "stdio forwarding failed",
            "proxycommand",
            "proxyjump",
            "jump host",
            "bastion",
            "跳板",
            "channel 0: open failed",
            "channel open failed",
        ],
    ) {
        return SshRuntimeFailureClass::JumpFailed;
    }
    if contains_any(
        message,
        &[
            "timed out",
            "timeout",
            "operation timed out",
            "connection timed out",
            "启动确认超时",
            "执行超时",
        ],
    ) {
        return SshRuntimeFailureClass::Timeout;
    }
    if contains_any(
        message,
        &[
            "does not support",
            "unsupported",
            "unwired",
            "subsystem request failed",
            "shell request failed",
            "exec request failed",
            "远端拒绝 ssh shell/pty 请求",
            "远端拒绝执行",
        ],
    ) {
        return SshRuntimeFailureClass::ChannelUnsupported;
    }
    if contains_any(
        message,
        &[
            "permission denied (",
            "authentication failed",
            "too many authentication failures",
            "all configured authentication methods failed",
            "bad credentials",
            "bad credential",
            "密码错误",
            "认证失败",
        ],
    ) {
        return SshRuntimeFailureClass::BadCredential;
    }
    if contains_any(
        message,
        &[
            "unprotected private key file",
            "permissions are too open",
            "bad permissions",
            "load key",
            "permission denied",
            "权限不足",
            "权限被拒绝",
        ],
    ) {
        return SshRuntimeFailureClass::PermissionDenied;
    }
    if contains_any(
        message,
        &[
            "remote exit",
            "exit status",
            "exit code",
            "exited with",
            "退出码",
            "退出状态",
        ],
    ) {
        return SshRuntimeFailureClass::RemoteExit;
    }
    if contains_any(
        message,
        &[
            "cleanup failed",
            "cleanup failure",
            "close failed",
            "kill failed",
            "清理失败",
            "关闭失败",
        ],
    ) {
        return SshRuntimeFailureClass::CleanupFailed;
    }
    if contains_any(
        message,
        &[
            "cancelled",
            "canceled",
            "cancel token",
            "已取消",
            "用户取消",
        ],
    ) {
        return SshRuntimeFailureClass::Canceled;
    }
    SshRuntimeFailureClass::Unknown
}

fn failure_guidance(failure_class: SshRuntimeFailureClass) -> (&'static str, &'static str, bool) {
    match failure_class {
        SshRuntimeFailureClass::AuthCanceled => (
            "SSH 认证已取消。",
            "重新连接并完成认证，或在主机设置中保存可用凭据。",
            false,
        ),
        SshRuntimeFailureClass::BadCredential => (
            "SSH 凭据认证失败。",
            "检查用户名、密码、私钥或 ssh-agent 后再手动重连。",
            false,
        ),
        SshRuntimeFailureClass::KeyPassphraseMissing => (
            "私钥需要 passphrase。",
            "输入本次 passphrase，或将 passphrase 保存到 encrypted vault 后重试。",
            false,
        ),
        SshRuntimeFailureClass::UnknownHostKey => (
            "SSH 主机密钥尚未信任。",
            "核对主机指纹；确认可信后添加 known_hosts 或重新发起受控信任流程。",
            false,
        ),
        SshRuntimeFailureClass::HostKeyChanged => (
            "SSH 主机密钥已变化。",
            "先确认目标主机身份；确认安全后再更新 known_hosts，未确认前不要重连。",
            false,
        ),
        SshRuntimeFailureClass::JumpFailed => (
            "SSH 跳板或代理链路失败。",
            "检查跳板主机、代理命令、端口和凭据后手动重试。",
            false,
        ),
        SshRuntimeFailureClass::Timeout => (
            "SSH 操作超时。",
            "检查网络、DNS、端口、防火墙或远端负载后重试。",
            true,
        ),
        SshRuntimeFailureClass::ChannelUnsupported => (
            "当前 SSH backend 不支持该 channel。",
            "切换到支持该能力的 backend，或显式使用 legacy compatibility mode。",
            false,
        ),
        SshRuntimeFailureClass::PermissionDenied => (
            "SSH 操作被权限拒绝。",
            "修正本地私钥权限、远端目录权限或命令权限后重试。",
            false,
        ),
        SshRuntimeFailureClass::RemoteExit => (
            "远端命令已退出且返回失败状态。",
            "查看远端 stdout/stderr，修正命令、工作目录或环境后重试。",
            false,
        ),
        SshRuntimeFailureClass::Canceled => (
            "SSH 操作已取消。",
            "确认这是预期取消；需要继续时重新执行该操作。",
            false,
        ),
        SshRuntimeFailureClass::CleanupFailed => (
            "SSH 资源清理失败。",
            "关闭相关 session 或重启应用后再检查 runtime diagnostics。",
            true,
        ),
        SshRuntimeFailureClass::Unknown => (
            "SSH 失败原因未归类。",
            "查看脱敏 diagnostics 和终端输出；补充具体错误后再重试。",
            false,
        ),
    }
}

fn contains_any(value: &str, needles: &[&str]) -> bool {
    needles.iter().any(|needle| value.contains(needle))
}

fn sanitize_ssh_runtime_error_detail(value: &str) -> String {
    let without_external_secret = redact_marker(value, "external-secret:");
    let without_password = redact_assignment(&without_external_secret, "password=");
    let without_passphrase = redact_assignment(&without_password, "passphrase=");
    redact_assignment(&without_passphrase, "key_passphrase=")
}

fn redact_marker(value: &str, marker: &str) -> String {
    let mut output = String::with_capacity(value.len());
    let mut remaining = value;
    while let Some(index) = remaining.find(marker) {
        output.push_str(&remaining[..index]);
        output.push_str(marker);
        output.push_str("<redacted>");
        let token_start = index + marker.len();
        let token_end = remaining[token_start..]
            .find(is_secret_boundary)
            .map(|offset| token_start + offset)
            .unwrap_or(remaining.len());
        remaining = &remaining[token_end..];
    }
    output.push_str(remaining);
    output
}

fn redact_assignment(value: &str, marker: &str) -> String {
    let lower = value.to_ascii_lowercase();
    let mut output = String::with_capacity(value.len());
    let mut cursor = 0;
    let mut search_from = 0;
    while let Some(relative_index) = lower[search_from..].find(marker) {
        let index = search_from + relative_index;
        output.push_str(&value[cursor..index]);
        output.push_str(&value[index..index + marker.len()]);
        output.push_str("<redacted>");
        let token_start = index + marker.len();
        let token_end = value[token_start..]
            .find(is_secret_boundary)
            .map(|offset| token_start + offset)
            .unwrap_or(value.len());
        cursor = token_end;
        search_from = token_end;
    }
    output.push_str(&value[cursor..]);
    output
}

fn is_secret_boundary(character: char) -> bool {
    character.is_whitespace() || matches!(character, ',' | ';' | ')' | ']' | '}')
}
