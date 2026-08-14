//! Shared managed SSH runtime types.
//!
//! @author kongweiguang

use serde::{Deserialize, Serialize};

/// SSH runtime channel categories opened from a managed session.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SshChannelKind {
    Shell,
    Exec,
    Sftp,
    DirectTcpIp,
    ForwardListener,
}

impl SshChannelKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Shell => "shell",
            Self::Exec => "exec",
            Self::Sftp => "sftp",
            Self::DirectTcpIp => "direct-tcpip",
            Self::ForwardListener => "forward-listener",
        }
    }
}

/// Host key policy for a managed SSH connection attempt.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SshRuntimeHostKeyPolicy {
    RequireKnown,
    TrustUnknown,
}

/// Auth material identity used for session keying. This never stores secret values.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum SshAuthIdentity {
    Agent,
    VaultRef {
        secret_kind: SshAuthSecretKind,
        ref_id: String,
    },
    KeyPath {
        fingerprint: String,
        passphrase_ref: Option<String>,
    },
    SessionOnly {
        prompt_id: String,
    },
    PromptOnly,
}

/// Secret type represented by a vault ref or session-only prompt.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SshAuthSecretKind {
    Password,
    PrivateKey,
    KeyPassphrase,
}

impl SshAuthSecretKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Password => "password",
            Self::PrivateKey => "private-key",
            Self::KeyPassphrase => "key-passphrase",
        }
    }
}

/// Stable peer identity that participates in SSH session reuse.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshSessionPeer {
    pub role: SshSessionPeerRole,
    pub host_id: Option<String>,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth: SshAuthIdentity,
}

impl SshSessionPeer {
    pub fn target(
        host_id: impl Into<String>,
        host: impl Into<String>,
        port: u16,
        username: impl Into<String>,
        auth: SshAuthIdentity,
    ) -> Self {
        Self {
            role: SshSessionPeerRole::Target,
            host_id: Some(host_id.into()),
            host: host.into(),
            port,
            username: username.into(),
            auth,
        }
    }

    pub fn jump(
        host: impl Into<String>,
        port: u16,
        username: impl Into<String>,
        auth: SshAuthIdentity,
    ) -> Self {
        Self {
            role: SshSessionPeerRole::Jump,
            host_id: None,
            host: host.into(),
            port,
            username: username.into(),
            auth,
        }
    }

    fn label(&self) -> String {
        format!("{}@{}:{}", self.username, self.host, self.port)
    }
}

/// Peer role inside a target route.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SshSessionPeerRole {
    Target,
    Jump,
}

/// Complete key for managed SSH session reuse.
///
/// The key intentionally contains fingerprints and refs only; passwords, private
/// key contents, passphrases and prompt responses are represented elsewhere.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshSessionKey {
    pub target: SshSessionPeer,
    #[serde(default)]
    pub jumps: Vec<SshSessionPeer>,
    pub known_hosts_profile: String,
    pub proxy_profile: Option<String>,
    #[serde(default)]
    pub runtime_flags: Vec<String>,
}

impl SshSessionKey {
    pub fn new(target: SshSessionPeer) -> Self {
        Self {
            target,
            jumps: Vec::new(),
            known_hosts_profile: "default".to_owned(),
            proxy_profile: None,
            runtime_flags: Vec::new(),
        }
    }

    pub fn with_jump(mut self, jump: SshSessionPeer) -> Self {
        self.jumps.push(jump);
        self
    }

    pub fn with_known_hosts_profile(mut self, profile: impl Into<String>) -> Self {
        self.known_hosts_profile = profile.into();
        self
    }

    pub fn with_proxy_profile(mut self, profile: impl Into<String>) -> Self {
        self.proxy_profile = Some(profile.into());
        self
    }

    pub fn with_runtime_flag(mut self, flag: impl Into<String>) -> Self {
        self.runtime_flags.push(flag.into());
        self.runtime_flags.sort();
        self.runtime_flags.dedup();
        self
    }

    pub fn summary(&self) -> SshSessionKeySummary {
        SshSessionKeySummary {
            target: self.target.label(),
            jumps: self.jumps.iter().map(SshSessionPeer::label).collect(),
            known_hosts_profile: self.known_hosts_profile.clone(),
            proxy_profile: self.proxy_profile.clone(),
            runtime_flags: self.runtime_flags.clone(),
        }
    }
}

/// Redacted key summary for diagnostics.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshSessionKeySummary {
    pub target: String,
    pub jumps: Vec<String>,
    pub known_hosts_profile: String,
    pub proxy_profile: Option<String>,
    pub runtime_flags: Vec<String>,
}

/// Runtime state for one managed session.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ManagedSshSessionState {
    Ready,
    Closing,
    Failed,
}

pub const MANAGED_SSH_EXEC_UNSUPPORTED: &str =
    "managed SSH runtime backend does not support exec channels yet";
pub const MANAGED_SSH_STREAMING_EXEC_UNSUPPORTED: &str =
    "managed SSH runtime backend does not support streaming exec channels yet";
pub const MANAGED_SSH_SFTP_UNSUPPORTED: &str =
    "managed SSH runtime backend does not support SFTP channels yet";
pub const MANAGED_SSH_SHELL_UNSUPPORTED: &str =
    "managed SSH runtime backend does not support shell channels yet";
pub const MANAGED_SSH_LOCAL_FORWARD_UNSUPPORTED: &str =
    "managed SSH runtime backend does not support local port forwarding yet";
pub const MANAGED_SSH_REMOTE_FORWARD_UNSUPPORTED: &str =
    "managed SSH runtime backend does not support remote port forwarding yet";
pub const MANAGED_SSH_DYNAMIC_FORWARD_UNSUPPORTED: &str =
    "managed SSH runtime backend does not support dynamic port forwarding yet";
pub const MANAGED_SSH_REMOTE_DYNAMIC_FORWARD_UNSUPPORTED: &str =
    "managed SSH runtime backend does not support remote dynamic port forwarding yet";
pub const MANAGED_SSH_CAPABILITY_RUNTIME_FLAG: &str = "capability";
pub const MANAGED_SSH_BULK_TRANSFER_RUNTIME_FLAG: &str = "bulk-transfer";
/// 唯一所有者使用该标记让连接在最后一个 handle/channel 释放后立刻回收，避免不可复用的会话常驻。
pub const MANAGED_SSH_EPHEMERAL_RUNTIME_FLAG: &str = "ephemeral";
