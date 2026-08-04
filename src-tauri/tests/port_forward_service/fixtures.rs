#![allow(unused_imports)]

// @author kongweiguang

pub use std::{
    fs,
    io::{Read, Write},
    net::{SocketAddr, TcpListener, TcpStream},
    sync::Arc,
    thread,
    time::Duration,
};

pub use super::support::{
    managed_ssh_runtime::FakeManagedSshRuntime,
    ssh_terminal_smoke::{
        trust_loopback_host_key, LoopbackTerminalJumpServer, LOOPBACK_JUMP_PASSWORD,
    },
};
pub use kerminal_lib::{
    error::AppError,
    models::{
        port_forward::{
            PortForwardCreateRequest, PortForwardEndpoint, PortForwardKind, PortForwardOrigin,
            PortForwardProxyApplyScope, PortForwardProxyProtocol, PortForwardRuntimeMode,
            PortForwardStatus, PortForwardSummary,
        },
        remote_host::{RemoteHostAuthType, RemoteHostCreateRequest},
    },
    paths::KerminalPaths,
    services::{
        external_launch::{ExternalLaunchAcceptOutcome, ExternalLaunchEntrypoint},
        port_forward_service::PortForwardService,
        ssh_runtime::{
            ManagedSshSessionManager, SshChannelKind, SshRuntimeDynamicForwardRequest,
            SshRuntimeLocalForwardRequest, SshRuntimeRemoteDynamicForwardRequest,
            SshRuntimeRemoteForwardRequest,
        },
    },
    state::AppState,
};
pub use tempfile::{tempdir, TempDir};

pub fn test_state() -> (TempDir, AppState) {
    let home = tempdir().expect("create temp home");
    let paths = KerminalPaths::from_home_dir(home.path());
    let state = AppState::initialize_with_paths(paths).expect("initialize app state");
    (home, state)
}

pub fn create_saved_password_host(state: &AppState) -> String {
    state
        .remote_hosts()
        .create_host(RemoteHostCreateRequest {
            auth_type: RemoteHostAuthType::Password,
            credential_ref: None,
            credential_secret: Some("correct horse battery staple".to_owned()),
            group_id: None,
            host: "dev.internal".to_owned(),
            name: "dev".to_owned(),
            port: 2222,
            ssh_options: Default::default(),
            tags: vec!["dev".to_owned()],
            username: "deploy".to_owned(),
            protocol: Default::default(),
        })
        .expect("create saved password host")
        .id
}

pub fn queue_putty_external_password_launch(state: &AppState, port: u16) -> String {
    let outcome = state
        .external_launch_intake()
        .accept_args(
            vec![
                "putty.exe".to_owned(),
                "-ssh".to_owned(),
                "deploy@127.0.0.1".to_owned(),
                "-P".to_owned(),
                port.to_string(),
                "-pw".to_owned(),
                "secret".to_owned(),
            ],
            None,
            ExternalLaunchEntrypoint::DirectArgv,
        )
        .expect("queue external launch");
    match outcome {
        ExternalLaunchAcceptOutcome::Queued(queued) => queued.launch_id,
        other => panic!("expected queued external launch, got {other:?}"),
    }
}

pub fn unused_local_port() -> u16 {
    TcpListener::bind(("127.0.0.1", 0))
        .expect("bind unused local port")
        .local_addr()
        .expect("unused local addr")
        .port()
}

pub fn socks5_connect(stream: &mut TcpStream, target: SocketAddr) {
    stream
        .write_all(&[0x05, 0x01, 0x00])
        .expect("write socks greeting");
    let mut method_response = [0_u8; 2];
    stream
        .read_exact(&mut method_response)
        .expect("read socks method response");
    assert_eq!(method_response, [0x05, 0x00]);

    let mut request = vec![0x05, 0x01, 0x00];
    match target.ip() {
        std::net::IpAddr::V4(ip) => {
            request.push(0x01);
            request.extend(ip.octets());
        }
        std::net::IpAddr::V6(ip) => {
            request.push(0x04);
            request.extend(ip.octets());
        }
    }
    request.extend(target.port().to_be_bytes());
    stream.write_all(&request).expect("write socks connect");

    let mut connect_response = [0_u8; 10];
    stream
        .read_exact(&mut connect_response)
        .expect("read socks connect response");
    assert_eq!(&connect_response[..2], &[0x05, 0x00]);
}

pub fn trigger_local_forward_attempt(source_port: u16) {
    let mut client =
        TcpStream::connect(("127.0.0.1", source_port)).expect("connect local forward listener");
    client
        .set_read_timeout(Some(Duration::from_millis(500)))
        .expect("set local forward read timeout");
    let _ = client.write_all(b"x");
    let mut buffer = [0_u8; 1];
    let _ = client.read(&mut buffer);
}

pub fn http_get_via_forward(source_port: u16, path: &str) -> String {
    let mut client =
        TcpStream::connect(("127.0.0.1", source_port)).expect("connect local HTTP forward");
    client
        .set_read_timeout(Some(Duration::from_secs(5)))
        .expect("set HTTP forward read timeout");
    write!(
        client,
        "GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{source_port}\r\nUser-Agent: kerminal-test\r\nConnection: close\r\n\r\n"
    )
    .expect("write HTTP request");
    let mut response = String::new();
    client
        .read_to_string(&mut response)
        .expect("read HTTP response");
    response
}

pub fn wait_for_atomic_count(counter: &std::sync::atomic::AtomicUsize, expected: usize) {
    for _ in 0..100 {
        if counter.load(std::sync::atomic::Ordering::SeqCst) >= expected {
            return;
        }
        thread::sleep(Duration::from_millis(10));
    }
    panic!(
        "expected atomic count >= {expected}, got {}",
        counter.load(std::sync::atomic::Ordering::SeqCst)
    );
}

pub struct HttpAssetServer {
    pub addr: SocketAddr,
    worker: Option<thread::JoinHandle<()>>,
}

impl HttpAssetServer {
    pub fn start(expected_requests: usize) -> Self {
        let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind HTTP asset server");
        let addr = listener.local_addr().expect("read HTTP asset server addr");
        let worker = thread::spawn(move || {
            let mut workers = Vec::new();
            for _ in 0..expected_requests {
                let Ok((mut stream, _peer)) = listener.accept() else {
                    break;
                };
                workers.push(thread::spawn(move || {
                    let mut buffer = [0_u8; 4096];
                    let read = stream.read(&mut buffer).unwrap_or(0);
                    let request = String::from_utf8_lossy(&buffer[..read]);
                    let path = request
                        .lines()
                        .next()
                        .and_then(|line| line.split_whitespace().nth(1))
                        .unwrap_or("/");
                    let body = format!("asset:{path}:{}", "0123456789abcdef".repeat(192 * 1024));
                    let response = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                        body.len()
                    );
                    let _ = stream.write_all(response.as_bytes());
                }));
            }
            for worker in workers {
                let _ = worker.join();
            }
        });
        Self {
            addr,
            worker: Some(worker),
        }
    }

    pub fn join(mut self) {
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

pub struct EchoServer {
    pub addr: SocketAddr,
    worker: Option<thread::JoinHandle<()>>,
}

impl EchoServer {
    pub fn start() -> Self {
        let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind echo server");
        let addr = listener.local_addr().expect("read echo server addr");
        let worker = thread::spawn(move || {
            if let Ok((mut stream, _peer)) = listener.accept() {
                let mut buffer = [0_u8; 4096];
                if let Ok(read) = stream.read(&mut buffer) {
                    let _ = stream.write_all(&buffer[..read]);
                }
            }
        });
        Self {
            addr,
            worker: Some(worker),
        }
    }

    pub fn join(mut self) {
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}
