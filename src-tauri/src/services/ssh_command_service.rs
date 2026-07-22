//! SSH 非交互命令执行服务。
//!
//! @author kongweiguang

use std::{io::Read, time::Duration};

pub(crate) mod native;

use crate::{
    error::{AppError, AppResult},
    models::{
        remote_host::{RemoteHost, RemoteHostAuthType},
        ssh_command::{SshCommandOutput, SshCommandRequest},
    },
    paths::KerminalPaths,
    services::{
        encrypted_vault_service::EncryptedVaultService,
        external_launch::ExternalSessionMaterializer,
        remote_host_capability::{ensure_remote_host_capability, RemoteHostCapability},
        ssh_credential_resolver::{
            NativeSshRouteMaterial, ResolvedSshRouteAuth, SshCredentialResolver,
        },
        ssh_identity_file::resolve_identity_file_path,
        ssh_runtime::{
            auth_broker::{SshAuthBroker, SshAuthBrokerResolution, SshAuthPromptPlan},
            facade::{SshRuntimeFacade, SshRuntimeTargetContext},
            policy::{
                external_target_not_available_error, is_capability_unsupported,
                is_external_runtime_target_id, is_managed_runtime_unwired,
                runtime_host_key_policy_for_host_id, SshRuntimeCapability,
            },
            session_key::ssh_session_key_for_route,
            ManagedSshSessionManager, ManagedSshStreamingExecSession, SshRuntimeConnectRequest,
            SshRuntimeExecOutput, SshRuntimeExecRequest, SshRuntimeStreamingExecRequest,
        },
    },
    storage::{config_file_store::ConfigFileStore, file_store::FileStoreError},
};
use tokio_util::sync::CancellationToken;

use native::{
    build_native_command_execution, build_native_connection_execution,
    connect_native_command_target, disconnect_native_connection, execute_native_ssh_command,
    resolve_native_auth_material, NativeHostKeyPolicy, NativeSshAuthMaterial, NativeSshPrivateKey,
};

const DEFAULT_TIMEOUT_SECONDS: u64 = 30;
const MIN_TIMEOUT_SECONDS: u64 = 1;
const MAX_TIMEOUT_SECONDS: u64 = 300;
const DEFAULT_OUTPUT_BYTES: usize = 16 * 1024;
const MIN_OUTPUT_BYTES: usize = 256;
const MAX_OUTPUT_BYTES: usize = 128 * 1024;
const MAX_COMMAND_CHARS: usize = 16 * 1024;
const LEGACY_FALLBACK_EXEC_UNWIRED: &str = "managed-exec-backend-unwired";
const LEGACY_FALLBACK_EXEC_UNSUPPORTED: &str = "managed-exec-unsupported";
const LEGACY_FALLBACK_STREAMING_EXEC_UNWIRED: &str = "managed-streaming-exec-backend-unwired";
const LEGACY_FALLBACK_STREAMING_EXEC_UNSUPPORTED: &str = "managed-streaming-exec-unsupported";

/// SSH 非交互命令业务入口。
#[derive(Clone, Debug, Default)]
pub struct SshCommandService {
    managed_runtime: Option<ManagedSshSessionManager>,
    auth_broker: Option<SshAuthBroker>,
    external_targets: Option<ExternalSessionMaterializer>,
}

impl SshCommandService {
    /// 创建 SSH 非交互命令服务。
    pub fn new() -> Self {
        Self {
            managed_runtime: None,
            auth_broker: None,
            external_targets: None,
        }
    }

    /// 创建接入受管 SSH 运行时的非交互命令服务。
    pub fn with_ssh_runtime(
        managed_runtime: ManagedSshSessionManager,
        auth_broker: SshAuthBroker,
        external_targets: ExternalSessionMaterializer,
    ) -> Self {
        Self {
            managed_runtime: Some(managed_runtime),
            auth_broker: Some(auth_broker),
            external_targets: Some(external_targets),
        }
    }

    /// 在已保存 SSH 主机上通过 native russh 执行非交互命令。
    ///
    /// 该路径先从 encrypted vault 物化运行态密码、内联私钥或私钥路径，
    /// 不把 secret 暴露到本地进程参数。
    pub async fn execute_native(
        &self,
        paths: &KerminalPaths,
        request: SshCommandRequest,
    ) -> AppResult<SshCommandOutput> {
        self.execute_native_with_cancel_token(paths, request, CancellationToken::new())
            .await
    }

    /// Execute a native command with an explicit cancellation hook for managed runtime callers.
    pub async fn execute_native_with_cancel_token(
        &self,
        paths: &KerminalPaths,
        request: SshCommandRequest,
        cancel_token: CancellationToken,
    ) -> AppResult<SshCommandOutput> {
        if cancel_token.is_cancelled() {
            return Err(command_cancelled_error());
        }
        let (host, route_auth) = self.resolve_native_runtime_host(paths, &request.host_id)?;
        if let Some(output) = self
            .try_execute_managed_exec(paths, &host, &route_auth, &request, cancel_token.clone())
            .await?
        {
            return Ok(output);
        }
        let execution = build_native_command_execution(&host, paths, request)?;
        execute_native_ssh_command(&host, execution, cancel_token).await
    }

    /// 测试未保存或已保存 SSH 主机配置能否完成 native 连接与认证。
    pub async fn test_connection(&self, paths: &KerminalPaths, host: &RemoteHost) -> AppResult<()> {
        let timeout_seconds = normalize_timeout_seconds(Some(u64::from(
            host.ssh_options.terminal.connect_timeout_seconds,
        )));
        let execution = build_native_connection_execution(host, paths, timeout_seconds)?;
        let timeout = Duration::from_secs(timeout_seconds);
        match tokio::time::timeout(timeout, async {
            let connection =
                connect_native_command_target(&execution, NativeHostKeyPolicy::TrustUnknown)
                    .await?;
            disconnect_native_connection(connection, "connection test completed").await;
            Ok(())
        })
        .await
        {
            Ok(result) => result,
            Err(_) => Err(AppError::SshCommand(format!(
                "SSH 连接测试超时（{} 秒）",
                timeout.as_secs()
            ))),
        }
    }

    /// Resolve host metadata through the same native runtime path used by managed exec.
    ///
    /// External launch targets do not have a host TOML record, so callers that only
    /// need host metadata should use this instead of `RemoteHostService::require_host`.
    /// The returned value is scrubbed of runtime-only secret material.
    pub fn resolve_native_runtime_host_metadata(
        &self,
        paths: &KerminalPaths,
        host_id: &str,
    ) -> AppResult<RemoteHost> {
        let (mut host, _) = self.resolve_native_runtime_host(paths, host_id)?;
        clear_runtime_secret_material(&mut host);
        Ok(host)
    }

    /// Open a streaming exec channel through the managed SSH runtime.
    ///
    /// Returns `Ok(None)` only for explicit migration fallback cases: runtime
    /// unwired or backend streaming exec unsupported.
    pub async fn open_managed_streaming_exec(
        &self,
        paths: &KerminalPaths,
        host_id: &str,
        command: String,
        timeout_seconds: u64,
        cancel_token: CancellationToken,
    ) -> AppResult<Option<ManagedSshStreamingExecSession>> {
        let (host, route_auth) = self.resolve_native_runtime_host(paths, host_id)?;
        self.try_open_managed_streaming_exec(
            paths,
            &host,
            &route_auth,
            command,
            timeout_seconds,
            cancel_token,
        )
        .await
    }

    fn resolve_native_runtime_host(
        &self,
        paths: &KerminalPaths,
        host_id: &str,
    ) -> AppResult<(RemoteHost, ResolvedSshRouteAuth)> {
        if let Some(external_targets) = &self.external_targets {
            if let Some(target) = external_targets.resolve_target(host_id)? {
                ensure_remote_host_capability(&target.host, RemoteHostCapability::Shell)?;
                return Ok((target.host, target.route_auth));
            }
        }
        if is_external_runtime_target_id(host_id) {
            return Err(external_target_not_available_error(host_id));
        }
        let host = resolve_remote_host_from_files(paths, host_id)?;
        ensure_remote_host_capability(&host, RemoteHostCapability::Shell)?;
        let resolver = SshCredentialResolver::new(EncryptedVaultService::new(paths.clone()));
        let resolved_auth = resolver.resolve_host(&host)?;
        let resolved_auth = match &self.auth_broker {
            Some(auth_broker) => match auth_broker.resolve_route_auth(&resolved_auth)? {
                SshAuthBrokerResolution::Ready { auth } => auth,
                SshAuthBrokerResolution::PromptRequired { prompt_plan, .. } => {
                    return Err(prompt_required_command_error(prompt_plan));
                }
            },
            None => resolved_auth,
        };
        let host = SshCredentialResolver::materialize_runtime_host_from_auth(&host, &resolved_auth);
        Ok((host, resolved_auth))
    }

    async fn try_execute_managed_exec(
        &self,
        paths: &KerminalPaths,
        host: &RemoteHost,
        route_auth: &ResolvedSshRouteAuth,
        request: &SshCommandRequest,
        cancel_token: CancellationToken,
    ) -> AppResult<Option<SshCommandOutput>> {
        let Some(managed_runtime) = self.managed_runtime.as_ref() else {
            return Ok(None);
        };
        let known_hosts_path = paths.root.join("known_hosts");
        let key = ssh_session_key_for_route(host, route_auth, &known_hosts_path)?;
        let connect_request = SshRuntimeConnectRequest::native(
            key,
            host.clone(),
            known_hosts_path,
            normalize_timeout_seconds(request.timeout_seconds),
        )
        .with_host_key_policy(runtime_host_key_policy_for_host_id(&host.id))
        .with_native_route_material(NativeSshRouteMaterial::from_resolved_auth(route_auth)?);
        let facade = SshRuntimeFacade::new(managed_runtime.clone());
        let context = SshRuntimeTargetContext::new(connect_request);
        let runtime_request = SshRuntimeExecRequest::new(
            normalize_command_script(&request.command)?,
            normalize_timeout_seconds(request.timeout_seconds),
            normalize_output_bytes(request.max_output_bytes),
        )
        .with_cancel_token(cancel_token);
        match facade.execute_exec(&context, runtime_request).await {
            Ok(output) => Ok(Some(ssh_command_output_from_runtime(host, output))),
            Err(error) if is_managed_runtime_unwired(&error) => {
                facade.record_legacy_fallback("exec", LEGACY_FALLBACK_EXEC_UNWIRED, Some(&context));
                Ok(None)
            }
            Err(error) if is_capability_unsupported(&error, SshRuntimeCapability::Exec) => {
                facade.record_legacy_fallback(
                    "exec",
                    LEGACY_FALLBACK_EXEC_UNSUPPORTED,
                    Some(&context),
                );
                Ok(None)
            }
            Err(error) => Err(error),
        }
    }

    async fn try_open_managed_streaming_exec(
        &self,
        paths: &KerminalPaths,
        host: &RemoteHost,
        route_auth: &ResolvedSshRouteAuth,
        command: String,
        timeout_seconds: u64,
        cancel_token: CancellationToken,
    ) -> AppResult<Option<ManagedSshStreamingExecSession>> {
        let Some(managed_runtime) = self.managed_runtime.as_ref() else {
            return Ok(None);
        };
        let known_hosts_path = paths.root.join("known_hosts");
        let key = ssh_session_key_for_route(host, route_auth, &known_hosts_path)?;
        let connect_request =
            SshRuntimeConnectRequest::native(key, host.clone(), known_hosts_path, timeout_seconds)
                .with_host_key_policy(runtime_host_key_policy_for_host_id(&host.id))
                .with_native_route_material(NativeSshRouteMaterial::from_resolved_auth(
                    route_auth,
                )?);
        let facade = SshRuntimeFacade::new(managed_runtime.clone());
        let context = SshRuntimeTargetContext::new(connect_request);
        let runtime_request = SshRuntimeStreamingExecRequest::new(command, timeout_seconds)
            .with_cancel_token(cancel_token);
        match facade.open_streaming_exec(&context, runtime_request).await {
            Ok(session) => Ok(Some(session)),
            Err(error) if is_managed_runtime_unwired(&error) => {
                facade.record_legacy_fallback(
                    "streaming-exec",
                    LEGACY_FALLBACK_STREAMING_EXEC_UNWIRED,
                    Some(&context),
                );
                Ok(None)
            }
            Err(error)
                if is_capability_unsupported(&error, SshRuntimeCapability::StreamingExec) =>
            {
                facade.record_legacy_fallback(
                    "streaming-exec",
                    LEGACY_FALLBACK_STREAMING_EXEC_UNSUPPORTED,
                    Some(&context),
                );
                Ok(None)
            }
            Err(error) => Err(error),
        }
    }
}

fn clear_runtime_secret_material(host: &mut RemoteHost) {
    host.credential_secret = None;
    for jump in &mut host.ssh_options.jump_hosts {
        jump.credential_secret = None;
    }
}

fn ssh_command_output_from_runtime(
    host: &RemoteHost,
    output: SshRuntimeExecOutput,
) -> SshCommandOutput {
    SshCommandOutput {
        host_id: host.id.clone(),
        host_name: host.name.clone(),
        host: host.host.clone(),
        port: host.port,
        username: host.username.clone(),
        exit_code: output.exit_code,
        success: output.exit_code == Some(0),
        stdout: output.stdout,
        stderr: output.stderr,
        stdout_bytes: output.stdout_bytes,
        stderr_bytes: output.stderr_bytes,
        stdout_truncated: output.stdout_truncated,
        stderr_truncated: output.stderr_truncated,
        max_output_bytes: output.max_output_bytes,
        duration_ms: output.duration_ms,
    }
}

fn prompt_required_command_error(prompt_plan: SshAuthPromptPlan) -> AppError {
    let prompts = prompt_plan
        .prompts
        .iter()
        .map(|prompt| {
            format!(
                "{}@{}:{} {}",
                prompt.username,
                prompt.host,
                prompt.port,
                prompt.secret_kind.as_str()
            )
        })
        .collect::<Vec<_>>()
        .join(", ");
    AppError::Credential(format!(
        "SSH authentication is required before executing remote command: {prompts}"
    ))
}

fn command_cancelled_error() -> AppError {
    AppError::SshCommand("远程命令已取消".to_owned())
}

#[doc(hidden)]
pub mod rules {
    use std::{io::Read, path::PathBuf};

    use super::*;

    #[derive(Debug, Clone, PartialEq, Eq)]
    pub enum NativeAuthMaterialSummary {
        Agent,
        Password(String),
        PrivateKeyPath {
            path: PathBuf,
            passphrase: Option<String>,
        },
        PrivateKeyPem {
            content: String,
            passphrase: Option<String>,
        },
    }

    #[derive(Debug, Clone, PartialEq, Eq)]
    pub struct LimitedOutputSummary {
        pub text: String,
        pub captured_bytes: usize,
        pub truncated: bool,
    }

    impl From<LimitedOutput> for LimitedOutputSummary {
        fn from(output: LimitedOutput) -> Self {
            Self {
                text: output.text,
                captured_bytes: output.captured_bytes,
                truncated: output.truncated,
            }
        }
    }

    pub fn resolve_native_auth_material_summary(
        host: &RemoteHost,
    ) -> AppResult<NativeAuthMaterialSummary> {
        match resolve_native_auth_material(host)? {
            NativeSshAuthMaterial::Agent => Ok(NativeAuthMaterialSummary::Agent),
            NativeSshAuthMaterial::Password(password) => {
                Ok(NativeAuthMaterialSummary::Password(password))
            }
            NativeSshAuthMaterial::PrivateKey(NativeSshPrivateKey::Path { path, passphrase }) => {
                Ok(NativeAuthMaterialSummary::PrivateKeyPath { path, passphrase })
            }
            NativeSshAuthMaterial::PrivateKey(NativeSshPrivateKey::Pem {
                content,
                passphrase,
            }) => Ok(NativeAuthMaterialSummary::PrivateKeyPem {
                content,
                passphrase,
            }),
        }
    }

    pub fn normalize_command_script(command: &str) -> AppResult<String> {
        super::normalize_command_script(command)
    }

    pub fn read_limited_output_summary<R: Read>(
        reader: R,
        max_bytes: usize,
    ) -> std::io::Result<LimitedOutputSummary> {
        super::read_limited_output(reader, max_bytes).map(Into::into)
    }

    pub fn limited_output_summary_from_chunks(
        max_bytes: usize,
        chunks: &[&[u8]],
    ) -> LimitedOutputSummary {
        let mut buffer = LimitedOutputBuffer::new(max_bytes);
        for chunk in chunks {
            buffer.push(chunk);
        }
        buffer.finish().into()
    }
}

fn resolve_remote_host_from_files(paths: &KerminalPaths, host_id: &str) -> AppResult<RemoteHost> {
    ConfigFileStore::new(paths.root.clone())
        .remote_host_by_id(host_id)
        .map_err(config_file_error)?
        .ok_or_else(|| AppError::NotFound(format!("远程主机不存在: {host_id}")))
}

fn config_file_error(error: FileStoreError) -> AppError {
    match error {
        FileStoreError::Io(error) => AppError::Io(error),
        other => AppError::InvalidInput(other.to_string()),
    }
}

/// 受控 SSH 远程命令计划。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SshCommandPlan {
    /// SSH 可执行文件。
    pub executable: String,
    /// SSH 参数。
    pub args: Vec<String>,
    /// 通过 stdin 传入远端 `sh -s` 的脚本。
    pub script: String,
    /// 超时时间，单位秒。
    pub timeout_seconds: u64,
    /// stdout/stderr 各自最多保留的字节数。
    pub max_output_bytes: usize,
}

/// 使用指定 SSH 可执行文件构建远程命令计划，供测试验证参数边界。
pub fn build_ssh_command_plan_with_executable(
    host: &RemoteHost,
    executable: String,
    request: SshCommandRequest,
) -> AppResult<SshCommandPlan> {
    let script = normalize_command_script(&request.command)?;
    let mut args = vec![
        "-p".to_owned(),
        host.port.to_string(),
        "-o".to_owned(),
        "BatchMode=yes".to_owned(),
        "-o".to_owned(),
        "ConnectTimeout=10".to_owned(),
        "-o".to_owned(),
        "ServerAliveInterval=30".to_owned(),
        "-o".to_owned(),
        "ServerAliveCountMax=3".to_owned(),
    ];
    args.extend(auth_args(host.auth_type));
    args.extend(identity_file_args(host)?);
    args.push(format!("{}@{}", host.username, host.host));
    args.push("sh".to_owned());
    args.push("-s".to_owned());

    Ok(SshCommandPlan {
        executable,
        args,
        script,
        timeout_seconds: normalize_timeout_seconds(request.timeout_seconds),
        max_output_bytes: normalize_output_bytes(request.max_output_bytes),
    })
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct LimitedOutput {
    text: String,
    captured_bytes: usize,
    truncated: bool,
}

#[derive(Debug)]
struct LimitedOutputBuffer {
    captured: Vec<u8>,
    max_bytes: usize,
    total_bytes: usize,
}

impl LimitedOutputBuffer {
    fn new(max_bytes: usize) -> Self {
        Self {
            captured: Vec::with_capacity(max_bytes.min(8 * 1024)),
            max_bytes,
            total_bytes: 0,
        }
    }

    fn push(&mut self, bytes: &[u8]) {
        self.total_bytes = self.total_bytes.saturating_add(bytes.len());
        let remaining = self.max_bytes.saturating_sub(self.captured.len());
        if remaining > 0 {
            let visible = bytes.len().min(remaining);
            self.captured.extend_from_slice(&bytes[..visible]);
        }
    }

    fn finish(self) -> LimitedOutput {
        LimitedOutput {
            text: String::from_utf8_lossy(&self.captured).into_owned(),
            captured_bytes: self.captured.len(),
            truncated: self.total_bytes > self.captured.len(),
        }
    }
}

fn read_limited_output<R: Read>(mut reader: R, max_bytes: usize) -> std::io::Result<LimitedOutput> {
    let mut captured = Vec::with_capacity(max_bytes.min(8 * 1024));
    let mut total_bytes = 0usize;
    let mut buffer = [0u8; 8 * 1024];

    loop {
        let read = reader.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        total_bytes = total_bytes.saturating_add(read);
        let remaining = max_bytes.saturating_sub(captured.len());
        if remaining > 0 {
            let visible = read.min(remaining);
            captured.extend_from_slice(&buffer[..visible]);
        }
    }

    Ok(LimitedOutput {
        text: String::from_utf8_lossy(&captured).into_owned(),
        captured_bytes: captured.len(),
        truncated: total_bytes > captured.len(),
    })
}

fn auth_args(auth_type: RemoteHostAuthType) -> Vec<String> {
    let preferred = match auth_type {
        RemoteHostAuthType::Password => "password,keyboard-interactive",
        RemoteHostAuthType::Key => "publickey",
        RemoteHostAuthType::Agent => "publickey,keyboard-interactive,password",
    };

    vec![
        "-o".to_owned(),
        format!("PreferredAuthentications={preferred}"),
    ]
}

fn identity_file_args(host: &RemoteHost) -> AppResult<Vec<String>> {
    if host.auth_type != RemoteHostAuthType::Key {
        return Ok(Vec::new());
    }
    if normalized_credential_secret(host).is_some() {
        return Err(AppError::InvalidInput(
            "内联 SSH 私钥需要使用 native SSH 命令路径执行".to_owned(),
        ));
    }
    let Some(credential_ref) = host
        .credential_ref
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return Ok(Vec::new());
    };
    if credential_ref.starts_with("credential:") {
        return Err(AppError::InvalidInput(
            "SSH 主机不再支持 credential: 私钥引用，请保存私钥路径或明文私钥内容".to_owned(),
        ));
    }
    let identity_path = resolve_identity_file_path(credential_ref)?;
    Ok(vec![
        "-i".to_owned(),
        identity_path.to_string_lossy().into_owned(),
    ])
}

fn normalized_credential_secret(host: &RemoteHost) -> Option<&str> {
    host.credential_secret
        .as_deref()
        .filter(|value| !value.trim().is_empty())
}

fn normalize_command_script(command: &str) -> AppResult<String> {
    if command.contains('\0') {
        return Err(AppError::InvalidInput(
            "远程命令不能包含 NUL 字符".to_owned(),
        ));
    }

    let normalized = command.replace("\r\n", "\n").replace('\r', "\n");
    let trimmed = normalized.trim();
    if trimmed.is_empty() {
        return Err(AppError::InvalidInput("远程命令不能为空".to_owned()));
    }
    if trimmed.chars().count() > MAX_COMMAND_CHARS {
        return Err(AppError::InvalidInput(format!(
            "远程命令长度不能超过 {MAX_COMMAND_CHARS} 个字符"
        )));
    }

    if trimmed.ends_with('\n') {
        Ok(trimmed.to_owned())
    } else {
        Ok(format!("{trimmed}\n"))
    }
}

fn normalize_timeout_seconds(timeout_seconds: Option<u64>) -> u64 {
    timeout_seconds
        .unwrap_or(DEFAULT_TIMEOUT_SECONDS)
        .clamp(MIN_TIMEOUT_SECONDS, MAX_TIMEOUT_SECONDS)
}

fn normalize_output_bytes(max_output_bytes: Option<usize>) -> usize {
    max_output_bytes
        .unwrap_or(DEFAULT_OUTPUT_BYTES)
        .clamp(MIN_OUTPUT_BYTES, MAX_OUTPUT_BYTES)
}
