//! Native managed SSH forwarding tasks.
//!
//! @author kongweiguang

use std::{
    fmt,
    io::ErrorKind,
    net::{IpAddr, Ipv4Addr, Ipv6Addr, TcpListener as StdTcpListener},
    sync::{
        mpsc::{self, Receiver},
        Arc,
    },
    thread,
    time::Duration,
};

use russh::{client, Channel};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    sync::{oneshot, Mutex},
};

use super::connection::{
    clear_native_connection_if_current, native_connection_from_state,
    should_clear_native_connection_after_channel_error,
    should_clear_native_connection_after_proxy_error,
};
use crate::{
    error::{AppError, AppResult},
    services::{
        ssh_command_service::native::{
            cancel_remote_tcpip_forward_on_native_connection,
            open_direct_tcpip_channel_on_native_connection, ping_native_connection_ref,
            proxy_direct_tcpip_channel_to_stream, start_remote_tcpip_forward_on_native_connection,
            NativeDirectTcpipProxyRequest, NativeHostKeyPolicy, NativeRemoteForwardRegistry,
            NativeRemoteForwardTarget, NativeSshCommandExecution, NativeSshConnectionChain,
        },
        ssh_runtime::{
            SshRuntimeDynamicForwardRequest, SshRuntimeForwardTask, SshRuntimeLocalForwardRequest,
            SshRuntimeRemoteDynamicForwardRequest, SshRuntimeRemoteForwardRequest,
        },
    },
};

mod remote;

pub(super) use remote::NativeRemoteForwardTask;

const SOCKS5_SUCCESS_REPLY: &[u8] = &[0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0];
const SOCKS5_GENERAL_FAILURE_REPLY: &[u8] = &[0x05, 0x01, 0x00, 0x01, 0, 0, 0, 0, 0, 0];

#[derive(Clone)]
struct NativeForwardConnectionContext {
    connection: Arc<Mutex<Option<Arc<NativeSshConnectionChain>>>>,
    execution: NativeSshCommandExecution,
    host_key_policy: NativeHostKeyPolicy,
    remote_forwards: NativeRemoteForwardRegistry,
}

#[derive(Default)]
struct NativeForwardFailureState(std::sync::Mutex<Option<String>>);

impl fmt::Debug for NativeForwardFailureState {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("NativeForwardFailureState(<redacted>)")
    }
}

impl NativeForwardFailureState {
    fn record(&self, failure: String) {
        if let Ok(mut recent_failure) = self.0.lock() {
            *recent_failure = Some(failure);
        }
    }

    fn take(&self) -> AppResult<Option<String>> {
        self.0
            .lock()
            .map(|mut recent_failure| recent_failure.take())
            .map_err(|_| AppError::StateLockPoisoned("native SSH forward recent failure"))
    }
}

#[derive(Debug)]
pub(super) struct NativeLocalForwardTask {
    failures: Arc<NativeForwardFailureState>,
    id: String,
    shutdown: Option<oneshot::Sender<()>>,
    status: Receiver<String>,
    worker: Option<thread::JoinHandle<()>>,
}

impl NativeLocalForwardTask {
    pub(super) fn start(
        id: String,
        connection: Arc<Mutex<Option<Arc<NativeSshConnectionChain>>>>,
        execution: NativeSshCommandExecution,
        host_key_policy: NativeHostKeyPolicy,
        remote_forwards: NativeRemoteForwardRegistry,
        request: SshRuntimeLocalForwardRequest,
    ) -> AppResult<Self> {
        let listener = bind_local_forward_listener(&request)?;
        let (shutdown_tx, shutdown_rx) = oneshot::channel();
        let (status_tx, status_rx) = mpsc::channel();
        let (ready_tx, ready_rx) = mpsc::channel();
        let failures = Arc::new(NativeForwardFailureState::default());
        let thread_name = format!("kerminal-ssh-forward-{id}");
        let context = NativeForwardConnectionContext {
            connection,
            execution,
            host_key_policy,
            remote_forwards,
        };
        let worker_failures = Arc::clone(&failures);
        let worker = thread::Builder::new()
            .name(thread_name)
            .spawn(move || {
                let status = match tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                {
                    Ok(runtime) => runtime.block_on(run_local_forward_listener(
                        listener,
                        shutdown_rx,
                        context,
                        request,
                        ready_tx,
                        worker_failures,
                    )),
                    Err(error) => {
                        let status = format!("无法启动受管 SSH local forward 运行时: {error}");
                        let _ = ready_tx.send(Err(status.clone()));
                        status
                    }
                };
                let _ = status_tx.send(status);
            })
            .map_err(|error| {
                AppError::PortForward(format!("无法启动受管 SSH local forward 线程: {error}"))
            })?;

        match ready_rx.recv_timeout(Duration::from_secs(30)) {
            Ok(Ok(())) => Ok(Self {
                failures,
                id,
                shutdown: Some(shutdown_tx),
                status: status_rx,
                worker: Some(worker),
            }),
            Ok(Err(error)) => {
                let _ = shutdown_tx.send(());
                let _ = worker.join();
                Err(AppError::PortForward(error))
            }
            Err(error) => {
                let _ = shutdown_tx.send(());
                let _ = worker.join();
                Err(AppError::PortForward(format!(
                    "受管 SSH local forward 启动确认超时: {error}"
                )))
            }
        }
    }
}

impl SshRuntimeForwardTask for NativeLocalForwardTask {
    fn id(&self) -> Option<String> {
        Some(self.id.clone())
    }

    fn try_wait(&mut self) -> AppResult<Option<String>> {
        match self.status.try_recv() {
            Ok(status) => Ok(Some(status)),
            Err(mpsc::TryRecvError::Empty) => Ok(None),
            Err(mpsc::TryRecvError::Disconnected) => {
                Ok(Some("受管 SSH local forward 线程已结束".to_owned()))
            }
        }
    }

    fn take_recent_failure(&mut self) -> AppResult<Option<String>> {
        self.failures.take()
    }

    fn kill(&mut self) -> AppResult<()> {
        if let Some(shutdown) = self.shutdown.take() {
            let _ = shutdown.send(());
        }
        Ok(())
    }

    fn wait(&mut self) {
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

fn bind_local_forward_listener(
    request: &SshRuntimeLocalForwardRequest,
) -> AppResult<StdTcpListener> {
    let address = format!("{}:{}", request.bind_host, request.bind_port);
    let listener = StdTcpListener::bind(&address).map_err(|error| {
        AppError::PortForward(format!("无法监听本地端口转发 {address}: {error}"))
    })?;
    listener.set_nonblocking(true).map_err(|error| {
        AppError::PortForward(format!("无法设置本地端口转发非阻塞监听 {address}: {error}"))
    })?;
    Ok(listener)
}

async fn run_local_forward_listener(
    listener: StdTcpListener,
    mut shutdown: oneshot::Receiver<()>,
    context: NativeForwardConnectionContext,
    request: SshRuntimeLocalForwardRequest,
    ready: mpsc::Sender<Result<(), String>>,
    failures: Arc<NativeForwardFailureState>,
) -> String {
    let listener = match TcpListener::from_std(listener) {
        Ok(listener) => listener,
        Err(error) => {
            let status = format!("无法创建受管 SSH local forward listener: {error}");
            let _ = ready.send(Err(status.clone()));
            return status;
        }
    };
    let _ = ready.send(Ok(()));
    loop {
        tokio::select! {
            _ = &mut shutdown => {
                return "受管 SSH local forward 已停止".to_owned();
            }
            accepted = listener.accept() => {
                match accepted {
                    Ok((stream, peer_addr)) => {
                            let context = context.clone();
                            let request = request.clone();
                            let failures = Arc::clone(&failures);
                            tokio::spawn(async move {
                            let originator_host = peer_addr.ip().to_string();
                            let originator_port = peer_addr.port();
                            if let Err(error) = proxy_local_forward_connection(
                                context,
                                request,
                                stream,
                                originator_host,
                                originator_port,
                            ).await {
                                failures.record(format!(
                                    "受管 SSH local forward direct-tcpip 失败: {error}"
                                ));
                            }
                        });
                    }
                    Err(error) if is_recoverable_listener_accept_error(&error) => {
                        continue;
                    }
                    Err(error) => {
                        return format!("受管 SSH local forward 接受连接失败: {error}");
                    }
                }
            }
        }
    }
}

async fn proxy_local_forward_connection(
    context: NativeForwardConnectionContext,
    request: SshRuntimeLocalForwardRequest,
    stream: TcpStream,
    originator_host: String,
    originator_port: u16,
) -> AppResult<(u64, u64)> {
    let proxy_request = NativeDirectTcpipProxyRequest {
        target_host: request.target_host,
        target_port: request.target_port,
        originator_host,
        originator_port,
    };
    let (connection, channel) =
        open_direct_tcpip_channel_with_reconnect(&context, &proxy_request).await?;
    let result = proxy_direct_tcpip_channel_to_stream(
        channel,
        stream,
        &proxy_request.target_host,
        proxy_request.target_port,
    )
    .await;
    if let Err(error) = &result {
        if should_clear_native_connection_after_channel_error(error) {
            clear_native_connection_if_current(
                &context.connection,
                &connection,
                &format!("managed SSH local forward direct-tcpip failed: {error}"),
            )
            .await;
        }
    }
    result
}

#[derive(Debug)]
pub(super) struct NativeDynamicForwardTask {
    failures: Arc<NativeForwardFailureState>,
    id: String,
    shutdown: Option<oneshot::Sender<()>>,
    status: Receiver<String>,
    worker: Option<thread::JoinHandle<()>>,
}

impl NativeDynamicForwardTask {
    pub(super) fn start(
        id: String,
        connection: Arc<Mutex<Option<Arc<NativeSshConnectionChain>>>>,
        execution: NativeSshCommandExecution,
        host_key_policy: NativeHostKeyPolicy,
        remote_forwards: NativeRemoteForwardRegistry,
        request: SshRuntimeDynamicForwardRequest,
    ) -> AppResult<Self> {
        let listener = bind_dynamic_forward_listener(&request)?;
        let (shutdown_tx, shutdown_rx) = oneshot::channel();
        let (status_tx, status_rx) = mpsc::channel();
        let (ready_tx, ready_rx) = mpsc::channel();
        let failures = Arc::new(NativeForwardFailureState::default());
        let thread_name = format!("kerminal-ssh-forward-{id}");
        let context = NativeForwardConnectionContext {
            connection,
            execution,
            host_key_policy,
            remote_forwards,
        };
        let worker_failures = Arc::clone(&failures);
        let worker = thread::Builder::new()
            .name(thread_name)
            .spawn(move || {
                let status = match tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                {
                    Ok(runtime) => runtime.block_on(run_dynamic_forward_listener(
                        listener,
                        shutdown_rx,
                        context,
                        ready_tx,
                        worker_failures,
                    )),
                    Err(error) => {
                        let status = format!("无法启动受管 SSH dynamic forward 运行时: {error}");
                        let _ = ready_tx.send(Err(status.clone()));
                        status
                    }
                };
                let _ = status_tx.send(status);
            })
            .map_err(|error| {
                AppError::PortForward(format!("无法启动受管 SSH dynamic forward 线程: {error}"))
            })?;

        match ready_rx.recv_timeout(Duration::from_secs(30)) {
            Ok(Ok(())) => Ok(Self {
                failures,
                id,
                shutdown: Some(shutdown_tx),
                status: status_rx,
                worker: Some(worker),
            }),
            Ok(Err(error)) => {
                let _ = shutdown_tx.send(());
                let _ = worker.join();
                Err(AppError::PortForward(error))
            }
            Err(error) => {
                let _ = shutdown_tx.send(());
                let _ = worker.join();
                Err(AppError::PortForward(format!(
                    "受管 SSH dynamic forward 启动确认超时: {error}"
                )))
            }
        }
    }
}

impl SshRuntimeForwardTask for NativeDynamicForwardTask {
    fn id(&self) -> Option<String> {
        Some(self.id.clone())
    }

    fn try_wait(&mut self) -> AppResult<Option<String>> {
        match self.status.try_recv() {
            Ok(status) => Ok(Some(status)),
            Err(mpsc::TryRecvError::Empty) => Ok(None),
            Err(mpsc::TryRecvError::Disconnected) => {
                Ok(Some("受管 SSH dynamic forward 线程已结束".to_owned()))
            }
        }
    }

    fn take_recent_failure(&mut self) -> AppResult<Option<String>> {
        self.failures.take()
    }

    fn kill(&mut self) -> AppResult<()> {
        if let Some(shutdown) = self.shutdown.take() {
            let _ = shutdown.send(());
        }
        Ok(())
    }

    fn wait(&mut self) {
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

fn bind_dynamic_forward_listener(
    request: &SshRuntimeDynamicForwardRequest,
) -> AppResult<StdTcpListener> {
    let address = format!("{}:{}", request.bind_host, request.bind_port);
    let listener = StdTcpListener::bind(&address).map_err(|error| {
        AppError::PortForward(format!("无法监听本地 SOCKS 转发 {address}: {error}"))
    })?;
    listener.set_nonblocking(true).map_err(|error| {
        AppError::PortForward(format!(
            "无法设置本地 SOCKS 转发非阻塞监听 {address}: {error}"
        ))
    })?;
    Ok(listener)
}

async fn run_dynamic_forward_listener(
    listener: StdTcpListener,
    mut shutdown: oneshot::Receiver<()>,
    context: NativeForwardConnectionContext,
    ready: mpsc::Sender<Result<(), String>>,
    failures: Arc<NativeForwardFailureState>,
) -> String {
    let listener = match TcpListener::from_std(listener) {
        Ok(listener) => listener,
        Err(error) => {
            let status = format!("无法创建受管 SSH dynamic forward listener: {error}");
            let _ = ready.send(Err(status.clone()));
            return status;
        }
    };
    let _ = ready.send(Ok(()));
    loop {
        tokio::select! {
            _ = &mut shutdown => {
                return "受管 SSH dynamic forward 已停止".to_owned();
            }
            accepted = listener.accept() => {
                match accepted {
                    Ok((stream, peer_addr)) => {
                        let context = context.clone();
                        let failures = Arc::clone(&failures);
                        tokio::spawn(async move {
                            let originator_host = peer_addr.ip().to_string();
                            let originator_port = peer_addr.port();
                            if let Err(error) = proxy_dynamic_forward_connection(
                                context,
                                stream,
                                originator_host,
                                originator_port,
                            ).await {
                                failures.record(format!(
                                    "受管 SSH dynamic forward direct-tcpip 失败: {error}"
                                ));
                            }
                        });
                    }
                    Err(error) if is_recoverable_listener_accept_error(&error) => {
                        continue;
                    }
                    Err(error) => {
                        return format!("受管 SSH dynamic forward 接受连接失败: {error}");
                    }
                }
            }
        }
    }
}

fn is_recoverable_listener_accept_error(error: &std::io::Error) -> bool {
    matches!(error.kind(), ErrorKind::Interrupted | ErrorKind::WouldBlock)
}

async fn proxy_dynamic_forward_connection(
    context: NativeForwardConnectionContext,
    mut stream: TcpStream,
    originator_host: String,
    originator_port: u16,
) -> AppResult<(u64, u64)> {
    let request = match read_socks5_connect_request(&mut stream).await {
        Ok(request) => request,
        Err(error) => {
            let _ = stream.write_all(SOCKS5_GENERAL_FAILURE_REPLY).await;
            return Err(error);
        }
    };
    let proxy_request = NativeDirectTcpipProxyRequest {
        target_host: request.target_host,
        target_port: request.target_port,
        originator_host,
        originator_port,
    };
    let (connection, channel) =
        match open_direct_tcpip_channel_with_reconnect(&context, &proxy_request).await {
            Ok(opened) => opened,
            Err(error) => {
                let _ = stream.write_all(SOCKS5_GENERAL_FAILURE_REPLY).await;
                return Err(error);
            }
        };
    stream
        .write_all(SOCKS5_SUCCESS_REPLY)
        .await
        .map_err(|error| {
            AppError::PortForward(format!("SOCKS5 CONNECT 成功响应写入失败: {error}"))
        })?;
    let result = proxy_direct_tcpip_channel_to_stream(
        channel,
        stream,
        &proxy_request.target_host,
        proxy_request.target_port,
    )
    .await;
    if let Err(error) = &result {
        if should_clear_native_connection_after_proxy_error(error) {
            clear_native_connection_if_current(
                &context.connection,
                &connection,
                &format!("managed SSH dynamic forward direct-tcpip failed: {error}"),
            )
            .await;
        }
    }
    result
}

async fn open_direct_tcpip_channel_with_reconnect(
    context: &NativeForwardConnectionContext,
    request: &NativeDirectTcpipProxyRequest,
) -> AppResult<(Arc<NativeSshConnectionChain>, Channel<client::Msg>)> {
    let connection = native_connection_from_state(
        &context.connection,
        &context.execution,
        context.host_key_policy,
        context.remote_forwards.clone(),
        None,
    )
    .await?;
    match open_direct_tcpip_channel_on_native_connection(&connection, request).await {
        Ok(channel) => return Ok((connection, channel)),
        Err(error) if should_clear_native_connection_after_channel_error(&error) => {
            clear_native_connection_if_current(
                &context.connection,
                &connection,
                &format!("managed SSH forward direct-tcpip open failed: {error}"),
            )
            .await;
        }
        Err(error) => return Err(error),
    }
    let retry_connection = native_connection_from_state(
        &context.connection,
        &context.execution,
        context.host_key_policy,
        context.remote_forwards.clone(),
        None,
    )
    .await?;
    let retry_channel =
        open_direct_tcpip_channel_on_native_connection(&retry_connection, request).await?;
    Ok((retry_connection, retry_channel))
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct Socks5ConnectRequest {
    target_host: String,
    target_port: u16,
}

async fn read_socks5_connect_request(stream: &mut TcpStream) -> AppResult<Socks5ConnectRequest> {
    let mut greeting = [0_u8; 2];
    stream
        .read_exact(&mut greeting)
        .await
        .map_err(|error| AppError::PortForward(format!("SOCKS5 握手读取失败: {error}")))?;
    if greeting[0] != 0x05 {
        return Err(AppError::PortForward("只支持 SOCKS5 协议".to_owned()));
    }
    let method_count = usize::from(greeting[1]);
    let mut methods = vec![0_u8; method_count];
    stream
        .read_exact(&mut methods)
        .await
        .map_err(|error| AppError::PortForward(format!("SOCKS5 认证方法读取失败: {error}")))?;
    if !methods.contains(&0x00) {
        stream.write_all(&[0x05, 0xff]).await.map_err(|error| {
            AppError::PortForward(format!("SOCKS5 认证拒绝响应写入失败: {error}"))
        })?;
        return Err(AppError::PortForward(
            "SOCKS5 客户端未提供 no-auth 方法".to_owned(),
        ));
    }
    stream
        .write_all(&[0x05, 0x00])
        .await
        .map_err(|error| AppError::PortForward(format!("SOCKS5 认证响应写入失败: {error}")))?;

    let mut header = [0_u8; 4];
    stream
        .read_exact(&mut header)
        .await
        .map_err(|error| AppError::PortForward(format!("SOCKS5 CONNECT 请求读取失败: {error}")))?;
    if header[0] != 0x05 {
        return Err(AppError::PortForward(
            "SOCKS5 CONNECT 请求版本无效".to_owned(),
        ));
    }
    if header[1] != 0x01 {
        stream
            .write_all(&[0x05, 0x07, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
            .await
            .map_err(|error| AppError::PortForward(format!("SOCKS5 拒绝响应写入失败: {error}")))?;
        return Err(AppError::PortForward(
            "SOCKS5 只支持 CONNECT 命令".to_owned(),
        ));
    }
    let target_host = match header[3] {
        0x01 => {
            let mut octets = [0_u8; 4];
            stream.read_exact(&mut octets).await.map_err(|error| {
                AppError::PortForward(format!("SOCKS5 IPv4 地址读取失败: {error}"))
            })?;
            IpAddr::V4(Ipv4Addr::from(octets)).to_string()
        }
        0x03 => {
            let mut length = [0_u8; 1];
            stream.read_exact(&mut length).await.map_err(|error| {
                AppError::PortForward(format!("SOCKS5 域名长度读取失败: {error}"))
            })?;
            let mut domain = vec![0_u8; usize::from(length[0])];
            stream
                .read_exact(&mut domain)
                .await
                .map_err(|error| AppError::PortForward(format!("SOCKS5 域名读取失败: {error}")))?;
            String::from_utf8(domain)
                .map_err(|_| AppError::PortForward("SOCKS5 域名不是有效 UTF-8".to_owned()))?
        }
        0x04 => {
            let mut octets = [0_u8; 16];
            stream.read_exact(&mut octets).await.map_err(|error| {
                AppError::PortForward(format!("SOCKS5 IPv6 地址读取失败: {error}"))
            })?;
            IpAddr::V6(Ipv6Addr::from(octets)).to_string()
        }
        _ => {
            stream
                .write_all(&[0x05, 0x08, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
                .await
                .map_err(|error| {
                    AppError::PortForward(format!("SOCKS5 地址类型拒绝响应写入失败: {error}"))
                })?;
            return Err(AppError::PortForward(
                "SOCKS5 CONNECT 地址类型不支持".to_owned(),
            ));
        }
    };
    let mut port_bytes = [0_u8; 2];
    stream
        .read_exact(&mut port_bytes)
        .await
        .map_err(|error| AppError::PortForward(format!("SOCKS5 目标端口读取失败: {error}")))?;
    let target_port = u16::from_be_bytes(port_bytes);
    if target_port == 0 {
        return Err(AppError::PortForward(
            "SOCKS5 CONNECT 目标端口必须大于 0".to_owned(),
        ));
    }
    Ok(Socks5ConnectRequest {
        target_host,
        target_port,
    })
}
