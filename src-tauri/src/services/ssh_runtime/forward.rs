//! Managed SSH forwarding requests and task trait.
//!
//! @author kongweiguang

use std::fmt;

use crate::error::AppResult;

/// Request for local SSH port forwarding over a managed session.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SshRuntimeLocalForwardRequest {
    pub bind_host: String,
    pub bind_port: u16,
    pub target_host: String,
    pub target_port: u16,
}

impl SshRuntimeLocalForwardRequest {
    pub fn new(
        bind_host: impl Into<String>,
        bind_port: u16,
        target_host: impl Into<String>,
        target_port: u16,
    ) -> Self {
        Self {
            bind_host: bind_host.into(),
            bind_port,
            target_host: target_host.into(),
            target_port,
        }
    }
}

/// Request for local dynamic SOCKS forwarding over a managed session.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SshRuntimeDynamicForwardRequest {
    pub bind_host: String,
    pub bind_port: u16,
}

impl SshRuntimeDynamicForwardRequest {
    pub fn new(bind_host: impl Into<String>, bind_port: u16) -> Self {
        Self {
            bind_host: bind_host.into(),
            bind_port,
        }
    }
}

/// Request for remote dynamic SOCKS forwarding over a managed session.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SshRuntimeRemoteDynamicForwardRequest {
    pub bind_host: String,
    pub bind_port: u16,
}

impl SshRuntimeRemoteDynamicForwardRequest {
    pub fn new(bind_host: impl Into<String>, bind_port: u16) -> Self {
        Self {
            bind_host: bind_host.into(),
            bind_port,
        }
    }
}

/// Request for remote SSH port forwarding over a managed session.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SshRuntimeRemoteForwardRequest {
    pub bind_host: String,
    pub bind_port: u16,
    pub target_host: String,
    pub target_port: u16,
}

impl SshRuntimeRemoteForwardRequest {
    pub fn new(
        bind_host: impl Into<String>,
        bind_port: u16,
        target_host: impl Into<String>,
        target_port: u16,
    ) -> Self {
        Self {
            bind_host: bind_host.into(),
            bind_port,
            target_host: target_host.into(),
            target_port,
        }
    }
}

/// Runtime-owned forwarding task. Implementations must not expose credentials in Debug.
pub trait SshRuntimeForwardTask: Send + fmt::Debug {
    fn id(&self) -> Option<String>;

    fn try_wait(&mut self) -> AppResult<Option<String>>;

    /// 取走最近一次不会终止隧道的连接级失败。
    fn take_recent_failure(&mut self) -> AppResult<Option<String>> {
        Ok(None)
    }

    fn kill(&mut self) -> AppResult<()>;

    fn wait(&mut self);
}
