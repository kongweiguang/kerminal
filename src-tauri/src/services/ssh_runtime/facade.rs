//! Facade for managed SSH runtime capability entrypoints.
//!
//! @author kongweiguang

use std::{fmt, path::PathBuf};

use crate::{error::AppResult, models::remote_host::RemoteHostAuthType};

use super::{
    policy::runtime_host_key_policy_for_host_id, ManagedSshForwardTunnel,
    ManagedSshRuntimeSnapshot, ManagedSshSessionHandle, ManagedSshSessionManager,
    ManagedSshSftpChannel, ManagedSshShellSession, ManagedSshStreamingExecSession, SshAuthIdentity,
    SshRuntimeConnectRequest, SshRuntimeDynamicForwardRequest, SshRuntimeExecOutput,
    SshRuntimeExecRequest, SshRuntimeHostKeyPolicy, SshRuntimeLocalForwardRequest,
    SshRuntimeRemoteDynamicForwardRequest, SshRuntimeRemoteForwardRequest, SshRuntimeShellRequest,
    SshRuntimeStreamingExecRequest,
};

/// Session isolation lane selected by higher-level capability services.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SshRuntimeSessionLane {
    Interactive,
    Capability,
    BulkTransfer,
}

/// Redacted target metadata carried next to a managed SSH connection request.
#[derive(Clone, PartialEq, Eq)]
pub struct SshRuntimeTargetSnapshot {
    pub auth: SshAuthIdentity,
    pub auth_type: Option<RemoteHostAuthType>,
    pub connect_timeout_seconds: Option<u64>,
    pub host: String,
    pub host_id: String,
    pub host_key_policy: SshRuntimeHostKeyPolicy,
    pub keepalive_seconds: Option<u64>,
    pub known_hosts_path: Option<PathBuf>,
    pub known_hosts_profile: String,
    pub port: u16,
    pub proxy_profile: Option<String>,
    pub runtime_flags: Vec<String>,
    pub target_label: String,
    pub username: String,
}

impl fmt::Debug for SshRuntimeTargetSnapshot {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("SshRuntimeTargetSnapshot")
            .field("auth", &self.auth)
            .field("auth_type", &self.auth_type)
            .field("connect_timeout_seconds", &self.connect_timeout_seconds)
            .field("host", &self.host)
            .field("host_id", &self.host_id)
            .field("host_key_policy", &self.host_key_policy)
            .field("keepalive_seconds", &self.keepalive_seconds)
            .field(
                "known_hosts_path",
                &self.known_hosts_path.as_ref().map(|_| "<redacted-path>"),
            )
            .field("known_hosts_profile", &self.known_hosts_profile)
            .field("port", &self.port)
            .field("proxy_profile", &self.proxy_profile)
            .field("runtime_flags", &self.runtime_flags)
            .field("target_label", &self.target_label)
            .field("username", &self.username)
            .finish()
    }
}

/// Complete facade input for one managed SSH target.
#[derive(Clone)]
pub struct SshRuntimeTargetContext {
    connect_request: SshRuntimeConnectRequest,
    lane: SshRuntimeSessionLane,
    target: SshRuntimeTargetSnapshot,
}

impl fmt::Debug for SshRuntimeTargetContext {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("SshRuntimeTargetContext")
            .field("connect_request", &self.connect_request)
            .field("lane", &self.lane)
            .field("target", &self.target)
            .finish()
    }
}

impl SshRuntimeTargetContext {
    pub fn new(connect_request: SshRuntimeConnectRequest) -> Self {
        let key = connect_request.key();
        let key_summary = key.summary();
        let native_host = connect_request.native_host();
        let host_id = key
            .target
            .host_id
            .clone()
            .unwrap_or_else(|| key.target.host.clone());
        let target = SshRuntimeTargetSnapshot {
            auth: key.target.auth.clone(),
            auth_type: native_host.map(|host| host.auth_type),
            connect_timeout_seconds: connect_request.native_connect_timeout_seconds(),
            host: native_host
                .map(|host| host.host.clone())
                .unwrap_or_else(|| key.target.host.clone()),
            host_id: host_id.clone(),
            host_key_policy: connect_request
                .native_host_key_policy()
                .unwrap_or_else(|| runtime_host_key_policy_for_host_id(&host_id)),
            keepalive_seconds: connect_request.native_keepalive_seconds(),
            known_hosts_path: connect_request.native_known_hosts_path().map(PathBuf::from),
            known_hosts_profile: key.known_hosts_profile.clone(),
            port: native_host.map(|host| host.port).unwrap_or(key.target.port),
            proxy_profile: key.proxy_profile.clone(),
            runtime_flags: key.runtime_flags.clone(),
            target_label: key_summary.target,
            username: native_host
                .map(|host| host.username.clone())
                .unwrap_or_else(|| key.target.username.clone()),
        };
        Self {
            connect_request,
            lane: SshRuntimeSessionLane::Interactive,
            target,
        }
    }

    pub fn with_lane(mut self, lane: SshRuntimeSessionLane) -> Self {
        self.lane = lane;
        self
    }

    pub fn with_target_label(mut self, target_label: impl Into<String>) -> Self {
        self.target.target_label = target_label.into();
        self
    }

    pub fn connect_request(&self) -> &SshRuntimeConnectRequest {
        &self.connect_request
    }

    pub fn lane(&self) -> SshRuntimeSessionLane {
        self.lane
    }

    pub fn target(&self) -> &SshRuntimeTargetSnapshot {
        &self.target
    }
}

/// Narrow entrypoint for managed SSH runtime capabilities.
#[derive(Clone, Debug)]
pub struct SshRuntimeFacade {
    manager: ManagedSshSessionManager,
}

impl SshRuntimeFacade {
    pub fn new(manager: ManagedSshSessionManager) -> Self {
        Self { manager }
    }

    pub fn manager(&self) -> &ManagedSshSessionManager {
        &self.manager
    }

    pub fn acquire_session(
        &self,
        context: &SshRuntimeTargetContext,
    ) -> AppResult<ManagedSshSessionHandle> {
        match context.lane {
            SshRuntimeSessionLane::Interactive => self
                .manager
                .acquire_session_with_request(context.connect_request.clone()),
            SshRuntimeSessionLane::Capability => self
                .manager
                .acquire_capability_session_with_request(context.connect_request.clone()),
            SshRuntimeSessionLane::BulkTransfer => self
                .manager
                .acquire_bulk_transfer_session_with_request(context.connect_request.clone()),
        }
    }

    pub async fn open_shell(
        &self,
        context: &SshRuntimeTargetContext,
        request: SshRuntimeShellRequest,
    ) -> AppResult<ManagedSshShellSession> {
        self.acquire_session(context)?.open_shell(request).await
    }

    pub async fn execute_exec(
        &self,
        context: &SshRuntimeTargetContext,
        request: SshRuntimeExecRequest,
    ) -> AppResult<SshRuntimeExecOutput> {
        self.acquire_session(context)?.execute_exec(request).await
    }

    pub async fn open_streaming_exec(
        &self,
        context: &SshRuntimeTargetContext,
        request: SshRuntimeStreamingExecRequest,
    ) -> AppResult<ManagedSshStreamingExecSession> {
        self.acquire_session(context)?
            .open_streaming_exec(request)
            .await
    }

    pub async fn open_sftp(
        &self,
        context: &SshRuntimeTargetContext,
    ) -> AppResult<ManagedSshSftpChannel> {
        self.acquire_session(context)?.open_sftp().await
    }

    pub fn start_local_forward(
        &self,
        context: &SshRuntimeTargetContext,
        request: SshRuntimeLocalForwardRequest,
    ) -> AppResult<ManagedSshForwardTunnel> {
        self.acquire_session(context)?.start_local_forward(request)
    }

    pub fn start_dynamic_forward(
        &self,
        context: &SshRuntimeTargetContext,
        request: SshRuntimeDynamicForwardRequest,
    ) -> AppResult<ManagedSshForwardTunnel> {
        self.acquire_session(context)?
            .start_dynamic_forward(request)
    }

    pub fn start_remote_forward(
        &self,
        context: &SshRuntimeTargetContext,
        request: SshRuntimeRemoteForwardRequest,
    ) -> AppResult<ManagedSshForwardTunnel> {
        self.acquire_session(context)?.start_remote_forward(request)
    }

    pub fn start_remote_dynamic_forward(
        &self,
        context: &SshRuntimeTargetContext,
        request: SshRuntimeRemoteDynamicForwardRequest,
    ) -> AppResult<ManagedSshForwardTunnel> {
        self.acquire_session(context)?
            .start_remote_dynamic_forward(request)
    }

    pub fn record_legacy_fallback(
        &self,
        capability: impl Into<String>,
        reason: impl Into<String>,
        context: Option<&SshRuntimeTargetContext>,
    ) {
        self.manager.record_legacy_fallback(
            capability,
            reason,
            context.map(|context| context.target.target_label.clone()),
        );
    }

    pub fn snapshot(&self) -> AppResult<ManagedSshRuntimeSnapshot> {
        self.manager.snapshot()
    }
}
