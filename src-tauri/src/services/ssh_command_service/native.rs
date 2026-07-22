//! native russh 非交互命令执行链。
//!
//! @author kongweiguang

mod auth;
mod connection;
mod forwarded;
mod output;
mod remote_forward;

use std::{
    path::PathBuf,
    time::{Duration, Instant},
};

use russh::{
    client,
    keys::{self, PublicKey},
    Channel, ChannelMsg, Pty,
};
use tokio_util::sync::CancellationToken;

use self::{
    auth::{
        native_auth_material_from_runtime, native_runtime_hop_label, required_native_port,
        required_native_text, resolve_native_jump_auth_material,
    },
    connection::{
        authenticate_native_ssh, connect_native_ssh, connect_native_ssh_through_direct_tcpip,
        exec_cancelled_error, native_ssh_error,
    },
    forwarded::proxy_forwarded_tcpip_to_target,
    output::LimitedRawOutputBuffer,
};

use crate::{
    error::{AppError, AppResult},
    models::{
        remote_host::{RemoteHost, SshJumpHostOptions},
        ssh_command::{SshCommandOutput, SshCommandRequest},
    },
    paths::KerminalPaths,
    services::{
        ssh_credential_resolver::{NativeSshHopMaterial, NativeSshRouteMaterial},
        ssh_route_plan::build_ssh_route_plan,
        ssh_runtime::{
            policy::known_hosts_revokes_key, SshRuntimeExecRawOutput, SshRuntimeSftpStream,
            SshRuntimeShellRequest,
        },
    },
};
pub(crate) use auth::resolve_native_auth_material;
pub(crate) use remote_forward::{NativeRemoteForwardRegistry, NativeRemoteForwardTarget};

use super::{
    normalize_command_script, normalize_output_bytes, normalize_timeout_seconds,
    LimitedOutputBuffer, DEFAULT_OUTPUT_BYTES,
};

#[derive(Clone)]
pub(crate) struct NativeSshCommandExecution {
    jumps: Vec<NativeSshHopExecution>,
    max_output_bytes: usize,
    script: String,
    target: NativeSshHopExecution,
    timeout_seconds: u64,
}

#[derive(Clone)]
struct NativeSshHopExecution {
    auth: NativeSshAuthMaterial,
    host: String,
    known_hosts_path: PathBuf,
    port: u16,
    username: String,
}

pub(crate) struct NativeSshConnectionChain {
    jumps: Vec<client::Handle<NativeCommandClientHandler>>,
    target: client::Handle<NativeCommandClientHandler>,
}

#[derive(Clone)]
pub(crate) struct NativeDirectTcpipProxyRequest {
    pub target_host: String,
    pub target_port: u16,
    pub originator_host: String,
    pub originator_port: u16,
}

#[derive(Clone)]
pub(crate) enum NativeSshAuthMaterial {
    Agent,
    Password(String),
    PrivateKey(NativeSshPrivateKey),
}

#[derive(Clone)]
pub(crate) enum NativeSshPrivateKey {
    Path {
        path: PathBuf,
        passphrase: Option<String>,
    },
    Pem {
        content: String,
        passphrase: Option<String>,
    },
}

#[derive(Debug)]
struct NativeCommandClientHandler {
    host: String,
    host_key_policy: NativeHostKeyPolicy,
    known_hosts_path: PathBuf,
    port: u16,
    remote_forwards: NativeRemoteForwardRegistry,
}

#[derive(Debug, Clone, Copy)]
pub(crate) enum NativeHostKeyPolicy {
    RequireKnown,
    TrustUnknown,
}

impl client::Handler for NativeCommandClientHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &PublicKey,
    ) -> Result<bool, Self::Error> {
        if known_hosts_revokes_key(server_public_key, &self.known_hosts_path) {
            return Ok(false);
        }
        match keys::known_hosts::check_known_hosts_path(
            &self.host,
            self.port,
            server_public_key,
            &self.known_hosts_path,
        ) {
            Ok(true) => Ok(true),
            Ok(false) => match self.host_key_policy {
                NativeHostKeyPolicy::RequireKnown => Ok(false),
                NativeHostKeyPolicy::TrustUnknown => Ok(keys::known_hosts::learn_known_hosts_path(
                    &self.host,
                    self.port,
                    server_public_key,
                    &self.known_hosts_path,
                )
                .is_ok()),
            },
            Err(_) => Ok(false),
        }
    }

    fn server_channel_open_forwarded_tcpip(
        &mut self,
        channel: Channel<client::Msg>,
        connected_address: &str,
        connected_port: u32,
        _originator_address: &str,
        _originator_port: u32,
        _session: &mut client::Session,
    ) -> impl std::future::Future<Output = Result<(), Self::Error>> + Send {
        let target = self
            .remote_forwards
            .resolve(connected_address, connected_port);
        async move {
            if let Some(target) = target {
                tokio::spawn(async move {
                    let _ = proxy_forwarded_tcpip_to_target(channel, target).await;
                });
            }
            Ok(())
        }
    }
}

pub(crate) fn build_native_command_execution(
    host: &RemoteHost,
    paths: &KerminalPaths,
    request: SshCommandRequest,
) -> AppResult<NativeSshCommandExecution> {
    let _route_plan = build_ssh_route_plan(host)?;
    let known_hosts_path = paths.root.join("known_hosts");
    build_native_command_execution_for_known_hosts(host, known_hosts_path, request)
}

pub(crate) fn build_native_command_execution_for_known_hosts(
    host: &RemoteHost,
    known_hosts_path: PathBuf,
    request: SshCommandRequest,
) -> AppResult<NativeSshCommandExecution> {
    Ok(NativeSshCommandExecution {
        jumps: host
            .ssh_options
            .jump_hosts
            .iter()
            .enumerate()
            .map(|(index, jump)| build_native_jump_execution(index, jump, known_hosts_path.clone()))
            .collect::<AppResult<Vec<_>>>()?,
        max_output_bytes: normalize_output_bytes(request.max_output_bytes),
        script: normalize_command_script(&request.command)?,
        target: build_native_target_execution(host, known_hosts_path)?,
        timeout_seconds: normalize_timeout_seconds(request.timeout_seconds),
    })
}

pub(crate) fn build_native_connection_execution(
    host: &RemoteHost,
    paths: &KerminalPaths,
    timeout_seconds: u64,
) -> AppResult<NativeSshCommandExecution> {
    let _route_plan = build_ssh_route_plan(host)?;
    let known_hosts_path = paths.root.join("known_hosts");
    build_native_connection_execution_for_known_hosts(host, known_hosts_path, timeout_seconds)
}

pub(crate) fn build_native_connection_execution_for_known_hosts(
    host: &RemoteHost,
    known_hosts_path: PathBuf,
    timeout_seconds: u64,
) -> AppResult<NativeSshCommandExecution> {
    Ok(NativeSshCommandExecution {
        jumps: host
            .ssh_options
            .jump_hosts
            .iter()
            .enumerate()
            .map(|(index, jump)| build_native_jump_execution(index, jump, known_hosts_path.clone()))
            .collect::<AppResult<Vec<_>>>()?,
        max_output_bytes: DEFAULT_OUTPUT_BYTES,
        script: String::new(),
        target: build_native_target_execution(host, known_hosts_path)?,
        timeout_seconds,
    })
}

pub(crate) fn build_native_connection_execution_from_material(
    route_material: &NativeSshRouteMaterial,
    known_hosts_path: PathBuf,
    timeout_seconds: u64,
) -> AppResult<NativeSshCommandExecution> {
    build_native_execution_from_material(
        route_material,
        known_hosts_path,
        String::new(),
        normalize_timeout_seconds(Some(timeout_seconds)),
        DEFAULT_OUTPUT_BYTES,
    )
}

fn build_native_execution_from_material(
    route_material: &NativeSshRouteMaterial,
    known_hosts_path: PathBuf,
    script: String,
    timeout_seconds: u64,
    max_output_bytes: usize,
) -> AppResult<NativeSshCommandExecution> {
    Ok(NativeSshCommandExecution {
        jumps: route_material
            .jumps
            .iter()
            .map(|jump| build_native_hop_execution_from_material(jump, known_hosts_path.clone()))
            .collect::<AppResult<Vec<_>>>()?,
        max_output_bytes,
        script,
        target: build_native_hop_execution_from_material(&route_material.target, known_hosts_path)?,
        timeout_seconds,
    })
}

pub(crate) async fn execute_native_ssh_command(
    host: &RemoteHost,
    execution: NativeSshCommandExecution,
    cancel_token: CancellationToken,
) -> AppResult<SshCommandOutput> {
    if cancel_token.is_cancelled() {
        return Err(exec_cancelled_error());
    }
    let started = Instant::now();
    let timeout = Duration::from_secs(execution.timeout_seconds);
    match tokio::select! {
        result = tokio::time::timeout(timeout, execute_native_ssh_command_inner(host, execution)) => result,
        _ = cancel_token.cancelled() => return Err(exec_cancelled_error()),
    } {
        Ok(result) => result.map(|mut output| {
            output.duration_ms = started.elapsed().as_millis();
            output
        }),
        Err(_) => Err(AppError::SshCommand(format!(
            "远程命令执行超时（{} 秒）",
            timeout.as_secs()
        ))),
    }
}

async fn execute_native_ssh_command_inner(
    host: &RemoteHost,
    execution: NativeSshCommandExecution,
) -> AppResult<SshCommandOutput> {
    let connection =
        connect_native_command_target(&execution, NativeHostKeyPolicy::RequireKnown).await?;

    let mut channel = connection
        .target
        .channel_open_session()
        .await
        .map_err(native_ssh_error)?;
    channel
        .exec(true, "sh -s")
        .await
        .map_err(native_ssh_error)?;
    channel
        .data_bytes(execution.script.into_bytes())
        .await
        .map_err(native_ssh_error)?;
    channel.eof().await.map_err(native_ssh_error)?;

    let mut stdout = LimitedOutputBuffer::new(execution.max_output_bytes);
    let mut stderr = LimitedOutputBuffer::new(execution.max_output_bytes);
    let mut exit_code = None;
    let mut exec_request_failed = false;

    while let Some(message) = channel.wait().await {
        match message {
            ChannelMsg::Data { data } => stdout.push(data.as_ref()),
            ChannelMsg::ExtendedData { data, .. } => stderr.push(data.as_ref()),
            ChannelMsg::ExitStatus { exit_status } => {
                exit_code = i32::try_from(exit_status).ok();
            }
            ChannelMsg::ExitSignal {
                signal_name,
                error_message,
                ..
            } => {
                if !error_message.trim().is_empty() {
                    stderr.push(error_message.as_bytes());
                    stderr.push(b"\n");
                }
                stderr.push(
                    format!("remote process terminated by signal: {signal_name:?}\n").as_bytes(),
                );
            }
            ChannelMsg::Failure => {
                exec_request_failed = true;
            }
            ChannelMsg::Close => break,
            _ => {}
        }
    }

    let _ = channel.close().await;
    disconnect_native_connection(connection, "command completed").await;

    if exec_request_failed {
        return Err(AppError::SshCommand(
            "远端拒绝执行非交互命令请求".to_owned(),
        ));
    }

    let stdout = stdout.finish();
    let stderr = stderr.finish();
    let success = exit_code == Some(0);
    Ok(SshCommandOutput {
        host_id: host.id.clone(),
        host_name: host.name.clone(),
        host: host.host.clone(),
        port: host.port,
        username: host.username.clone(),
        exit_code,
        success,
        stdout: stdout.text,
        stderr: stderr.text,
        stdout_bytes: stdout.captured_bytes,
        stderr_bytes: stderr.captured_bytes,
        stdout_truncated: stdout.truncated,
        stderr_truncated: stderr.truncated,
        max_output_bytes: execution.max_output_bytes,
        duration_ms: 0,
    })
}

fn build_native_target_execution(
    host: &RemoteHost,
    known_hosts_path: PathBuf,
) -> AppResult<NativeSshHopExecution> {
    Ok(NativeSshHopExecution {
        auth: resolve_native_auth_material(host)?,
        host: required_native_text(&host.host, "目标主机 host")?,
        known_hosts_path,
        port: required_native_port(host.port, "目标主机 port")?,
        username: required_native_text(&host.username, "目标主机 username")?,
    })
}

fn build_native_jump_execution(
    index: usize,
    jump: &SshJumpHostOptions,
    known_hosts_path: PathBuf,
) -> AppResult<NativeSshHopExecution> {
    let label = format!("跳板主机 jump-{index}");
    Ok(NativeSshHopExecution {
        auth: resolve_native_jump_auth_material(jump, &label)?,
        host: required_native_text(&jump.host, &format!("{label} host"))?,
        known_hosts_path,
        port: required_native_port(jump.port, &format!("{label} port"))?,
        username: required_native_text(&jump.username, &format!("{label} username"))?,
    })
}

fn build_native_hop_execution_from_material(
    hop: &NativeSshHopMaterial,
    known_hosts_path: PathBuf,
) -> AppResult<NativeSshHopExecution> {
    let label = native_runtime_hop_label(hop);
    Ok(NativeSshHopExecution {
        auth: native_auth_material_from_runtime(&hop.auth)?,
        host: required_native_text(&hop.host, &format!("{label} host"))?,
        known_hosts_path,
        port: required_native_port(hop.port, &format!("{label} port"))?,
        username: required_native_text(&hop.username, &format!("{label} username"))?,
    })
}

pub(crate) async fn connect_native_command_target(
    execution: &NativeSshCommandExecution,
    host_key_policy: NativeHostKeyPolicy,
) -> AppResult<NativeSshConnectionChain> {
    connect_native_command_target_with_remote_forward_registry(
        execution,
        host_key_policy,
        NativeRemoteForwardRegistry::default(),
    )
    .await
}

pub(crate) async fn connect_native_command_target_with_remote_forward_registry(
    execution: &NativeSshCommandExecution,
    host_key_policy: NativeHostKeyPolicy,
    remote_forwards: NativeRemoteForwardRegistry,
) -> AppResult<NativeSshConnectionChain> {
    if execution.jumps.is_empty() {
        let mut target = connect_native_ssh(
            &execution.target,
            execution.timeout_seconds,
            host_key_policy,
            remote_forwards,
        )
        .await?;
        authenticate_native_ssh(&mut target, &execution.target, execution.timeout_seconds).await?;
        return Ok(NativeSshConnectionChain {
            jumps: Vec::new(),
            target,
        });
    }

    let mut jumps = Vec::with_capacity(execution.jumps.len());
    let mut upstream = connect_native_ssh(
        &execution.jumps[0],
        execution.timeout_seconds,
        host_key_policy,
        NativeRemoteForwardRegistry::default(),
    )
    .await?;
    authenticate_native_ssh(
        &mut upstream,
        &execution.jumps[0],
        execution.timeout_seconds,
    )
    .await?;

    for jump in execution.jumps.iter().skip(1) {
        let mut next = connect_native_ssh_through_direct_tcpip(
            &upstream,
            jump,
            execution.timeout_seconds,
            host_key_policy,
            NativeRemoteForwardRegistry::default(),
        )
        .await?;
        authenticate_native_ssh(&mut next, jump, execution.timeout_seconds).await?;
        jumps.push(upstream);
        upstream = next;
    }

    let mut target = connect_native_ssh_through_direct_tcpip(
        &upstream,
        &execution.target,
        execution.timeout_seconds,
        host_key_policy,
        remote_forwards,
    )
    .await?;
    authenticate_native_ssh(&mut target, &execution.target, execution.timeout_seconds).await?;
    jumps.push(upstream);

    Ok(NativeSshConnectionChain { jumps, target })
}

pub(crate) async fn disconnect_native_connection(
    connection: NativeSshConnectionChain,
    reason: &str,
) {
    disconnect_native_connection_ref(&connection, reason).await;
}

pub(crate) async fn disconnect_native_connection_ref(
    connection: &NativeSshConnectionChain,
    reason: &str,
) {
    let _ = connection
        .target
        .disconnect(russh::Disconnect::ByApplication, reason, "")
        .await;
    for jump in connection.jumps.iter().rev() {
        let _ = jump
            .disconnect(russh::Disconnect::ByApplication, reason, "")
            .await;
    }
}

pub(crate) async fn ping_native_connection_ref(
    connection: &NativeSshConnectionChain,
) -> AppResult<()> {
    connection
        .target
        .send_ping()
        .await
        .map_err(native_ssh_error)
}

pub(crate) async fn execute_script_on_native_connection(
    connection: &NativeSshConnectionChain,
    script: String,
    max_output_bytes: usize,
) -> AppResult<SshRuntimeExecRawOutput> {
    let mut channel = connection
        .target
        .channel_open_session()
        .await
        .map_err(native_ssh_error)?;
    channel
        .exec(true, "sh -s")
        .await
        .map_err(native_ssh_error)?;
    channel
        .data_bytes(script.into_bytes())
        .await
        .map_err(native_ssh_error)?;
    channel.eof().await.map_err(native_ssh_error)?;

    let mut stdout = LimitedRawOutputBuffer::new(max_output_bytes);
    let mut stderr = LimitedRawOutputBuffer::new(max_output_bytes);
    let mut exit_code = None;
    let mut exec_request_failed = false;

    while let Some(message) = channel.wait().await {
        match message {
            ChannelMsg::Data { data } => stdout.push(data.as_ref()),
            ChannelMsg::ExtendedData { data, .. } => stderr.push(data.as_ref()),
            ChannelMsg::ExitStatus { exit_status } => {
                exit_code = i32::try_from(exit_status).ok();
            }
            ChannelMsg::ExitSignal {
                signal_name,
                error_message,
                ..
            } => {
                if !error_message.trim().is_empty() {
                    stderr.push(error_message.as_bytes());
                    stderr.push(b"\n");
                }
                stderr.push(
                    format!("remote process terminated by signal: {signal_name:?}\n").as_bytes(),
                );
            }
            ChannelMsg::Failure => {
                exec_request_failed = true;
            }
            ChannelMsg::Close => break,
            _ => {}
        }
    }

    let _ = channel.close().await;

    if exec_request_failed {
        return Err(AppError::SshCommand(
            "远端拒绝执行非交互命令请求".to_owned(),
        ));
    }

    Ok(SshRuntimeExecRawOutput {
        exit_code,
        stdout: stdout.finish(),
        stderr: stderr.finish(),
    })
}

pub(crate) async fn open_streaming_exec_on_native_connection(
    connection: &NativeSshConnectionChain,
    command: String,
) -> AppResult<Channel<client::Msg>> {
    let channel = connection
        .target
        .channel_open_session()
        .await
        .map_err(native_ssh_error)?;
    channel
        .exec(true, command)
        .await
        .map_err(native_ssh_error)?;
    Ok(channel)
}

pub(crate) async fn open_shell_on_native_connection(
    connection: &NativeSshConnectionChain,
    request: SshRuntimeShellRequest,
) -> AppResult<Channel<client::Msg>> {
    let channel = connection
        .target
        .channel_open_session()
        .await
        .map_err(native_ssh_error)?;
    for (name, value) in request.env {
        channel
            .set_env(true, name, value)
            .await
            .map_err(native_ssh_error)?;
    }
    channel
        .request_pty(
            true,
            &request.term,
            u32::from(request.cols.max(1)),
            u32::from(request.rows.max(1)),
            request.pixel_width,
            request.pixel_height,
            &[] as &[(Pty, u32)],
        )
        .await
        .map_err(native_ssh_error)?;
    channel
        .request_shell(true)
        .await
        .map_err(native_ssh_error)?;
    Ok(channel)
}

pub(crate) async fn open_sftp_on_native_connection(
    connection: &NativeSshConnectionChain,
) -> AppResult<Box<dyn SshRuntimeSftpStream>> {
    let channel = connection
        .target
        .channel_open_session()
        .await
        .map_err(native_ssh_error)?;
    channel
        .request_subsystem(true, "sftp")
        .await
        .map_err(native_ssh_error)?;
    Ok(Box::new(channel.into_stream()))
}

pub(crate) async fn open_direct_tcpip_channel_on_native_connection(
    connection: &NativeSshConnectionChain,
    request: &NativeDirectTcpipProxyRequest,
) -> AppResult<Channel<client::Msg>> {
    connection
        .target
        .channel_open_direct_tcpip(
            request.target_host.clone(),
            u32::from(request.target_port),
            request.originator_host.clone(),
            u32::from(request.originator_port),
        )
        .await
        .map_err(|error| {
            AppError::SshCommand(format!(
                "无法打开 direct-tcpip 到 {}:{}: {error}",
                request.target_host, request.target_port
            ))
        })
}

pub(crate) async fn proxy_direct_tcpip_channel_to_stream(
    channel: Channel<client::Msg>,
    mut stream: tokio::net::TcpStream,
    target_host: &str,
    target_port: u16,
) -> AppResult<(u64, u64)> {
    let mut channel_stream = channel.into_stream();
    tokio::io::copy_bidirectional(&mut stream, &mut channel_stream)
        .await
        .map_err(|error| {
            AppError::SshCommand(format!(
                "direct-tcpip 数据转发失败 {target_host}:{target_port}: {error}"
            ))
        })
}

pub(crate) async fn start_remote_tcpip_forward_on_native_connection(
    connection: &NativeSshConnectionChain,
    bind_host: String,
    bind_port: u16,
) -> AppResult<u32> {
    let requested_port = u32::from(bind_port);
    let allocated_port = connection
        .target
        .tcpip_forward(bind_host.clone(), requested_port)
        .await
        .map_err(|error| {
            AppError::SshCommand(format!(
                "无法启动 remote tcpip-forward {}:{}: {error}",
                bind_host, bind_port
            ))
        })?;
    if requested_port == 0 {
        Ok(allocated_port)
    } else {
        Ok(requested_port)
    }
}

pub(crate) async fn cancel_remote_tcpip_forward_on_native_connection(
    connection: &NativeSshConnectionChain,
    bind_host: String,
    bind_port: u32,
) -> AppResult<()> {
    connection
        .target
        .cancel_tcpip_forward(bind_host.clone(), bind_port)
        .await
        .map_err(|error| {
            AppError::SshCommand(format!(
                "无法取消 remote tcpip-forward {}:{}: {error}",
                bind_host, bind_port
            ))
        })
}
