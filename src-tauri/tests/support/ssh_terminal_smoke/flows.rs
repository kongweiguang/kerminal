#[derive(Debug)]
pub struct PasswordSmokeConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
    pub known_host_line: Option<String>,
    pub ready_marker: Option<String>,
    pub expect_auth_failure: bool,
}

impl PasswordSmokeConfig {
    pub fn from_env() -> Result<Option<Self>, String> {
        if env::var(RUN_FLAG).ok().as_deref() != Some("1") {
            return Ok(None);
        }

        let host = required_env(HOST_ENV)?;
        let username = required_env(USER_ENV)?;
        let password = required_env(PASSWORD_ENV)?;
        let port = optional_env(PORT_ENV)
            .map(|value| {
                value
                    .parse::<u16>()
                    .map_err(|error| format!("{PORT_ENV} must be a valid TCP port: {error}"))
            })
            .transpose()?
            .unwrap_or(22);

        Ok(Some(Self {
            host,
            port,
            username,
            password,
            known_host_line: optional_env(KNOWN_HOST_ENV),
            ready_marker: optional_env(READY_MARKER_ENV),
            expect_auth_failure: env::var(EXPECT_AUTH_FAILURE_ENV).ok().as_deref() == Some("1"),
        }))
    }
}

fn required_env(name: &str) -> Result<String, String> {
    optional_env(name).ok_or_else(|| format!("{name} is required"))
}

fn optional_env(name: &str) -> Option<String> {
    env::var(name)
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
}

pub fn trust_smoke_host_key(
    paths: &KerminalPaths,
    config: &PasswordSmokeConfig,
) -> Result<(), String> {
    let known_host_line = match config.known_host_line.as_deref() {
        Some(line) => line.to_owned(),
        None => scan_host_key(config)?,
    };
    fs::create_dir_all(&paths.root).map_err(|error| error.to_string())?;
    fs::write(
        paths.root.join("known_hosts"),
        format!("{}\n", known_host_line.trim()),
    )
    .map_err(|error| error.to_string())
}

fn scan_host_key(config: &PasswordSmokeConfig) -> Result<String, String> {
    let output = Command::new("ssh-keyscan")
        .args(["-p", &config.port.to_string(), &config.host])
        .output()
        .map_err(|error| {
            format!(
                "failed to run ssh-keyscan; set {KNOWN_HOST_ENV} with a trusted known_hosts line: {error}"
            )
        })?;
    if !output.status.success() {
        return Err(format!(
            "ssh-keyscan failed; set {KNOWN_HOST_ENV} with a trusted known_hosts line:\n{}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    let known_host_line = String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty() && !line.starts_with('#'))
        .map(str::to_owned)
        .ok_or_else(|| "ssh-keyscan returned no host key lines".to_owned())?;
    Ok(known_host_line)
}

pub fn create_remote_host(state: &AppState, config: &PasswordSmokeConfig) -> String {
    state
        .remote_hosts()
        .create_host(RemoteHostCreateRequest {
            auth_type: RemoteHostAuthType::Password,
            credential_ref: None,
            credential_secret: Some(config.password.clone()),
            group_id: None,
            host: config.host.clone(),
            name: "OpenSSH password smoke".to_owned(),
            port: config.port,
            production: false,
            ssh_options: Default::default(),
            tags: vec!["smoke".to_owned()],
            username: config.username.clone(),
        protocol: Default::default(),
        })
        .expect("create password smoke remote host")
        .id
}

pub fn create_remote_host_with_password_jump(
    state: &AppState,
    config: &PasswordSmokeConfig,
    jump: &LoopbackTerminalJumpServer,
) -> String {
    let mut request = RemoteHostCreateRequest {
        auth_type: RemoteHostAuthType::Password,
        credential_ref: None,
        credential_secret: Some(config.password.clone()),
        group_id: None,
        host: config.host.clone(),
        name: "OpenSSH password jump smoke".to_owned(),
        port: config.port,
        production: false,
        ssh_options: Default::default(),
        tags: vec!["smoke".to_owned(), "jump".to_owned()],
        username: config.username.clone(),
    protocol: Default::default(),
    };
    request.ssh_options.jump_hosts.push(SshJumpHostOptions {
        auth_type: RemoteHostAuthType::Password,
        credential_ref: None,
        secret_ref: None,
        key_passphrase_ref: None,
        key_passphrase_secret: None,
        credential_secret: Some(LOOPBACK_JUMP_PASSWORD.to_owned()),
        credential_status: Default::default(),
        host: "127.0.0.1".to_owned(),
        name: "Loopback jump".to_owned(),
        port: jump.addr.port(),
        username: LOOPBACK_JUMP_USER.to_owned(),
    });

    state
        .remote_hosts()
        .create_host(request)
        .expect("create password jump smoke remote host")
        .id
}

pub fn run_smoke_terminal_flow(
    terminals: &TerminalManager,
    session_id: &str,
    receiver: &mpsc::Receiver<TerminalOutputEvent>,
    config: &PasswordSmokeConfig,
) -> Result<String, String> {
    let mut received = String::new();
    if let Some(ready_marker) = config.ready_marker.as_deref() {
        received = collect_until_output(
            terminals,
            session_id,
            receiver,
            ready_marker,
            received,
            Duration::from_secs(20),
        )?;
    } else {
        received = collect_any_data(
            terminals,
            session_id,
            receiver,
            received,
            Duration::from_secs(5),
        )?;
        std::thread::sleep(Duration::from_millis(1000));
    }

    let smoke_command = if config.ready_marker.as_deref() == Some(LOOPBACK_READY_MARKER) {
        format!("echo {COMMAND_MARKER} {LOOPBACK_UNICODE_REQUEST_MARKER}\r")
    } else {
        let unicode_marker_escape = posix_printf_octal_escape(UNICODE_COMMAND_MARKER);
        format!("printf '%s\\n{unicode_marker_escape}\\n' '{COMMAND_MARKER}'\r")
    };
    terminals
        .write(session_id, &smoke_command)
        .map_err(|error| error.to_string())?;
    let received = collect_until_output(
        terminals,
        session_id,
        receiver,
        COMMAND_MARKER,
        received,
        Duration::from_secs(10),
    )?;

    collect_until_output(
        terminals,
        session_id,
        receiver,
        UNICODE_COMMAND_MARKER,
        received,
        Duration::from_secs(10),
    )
}

pub fn run_expected_auth_failure_flow(
    terminals: &TerminalManager,
    session_id: &str,
    receiver: &mpsc::Receiver<TerminalOutputEvent>,
    config: &PasswordSmokeConfig,
) -> Result<String, String> {
    let mut received = collect_until_auth_failure_feedback(
        terminals,
        session_id,
        receiver,
        String::new(),
        Duration::from_secs(15),
    )?;
    received.push_str(&collect_additional_output_for(
        terminals,
        session_id,
        receiver,
        Duration::from_millis(1200),
    )?);
    if let Some(ready_marker) = config.ready_marker.as_deref() {
        if received.contains(ready_marker) {
            return Err(format!(
                "wrong password unexpectedly reached ready marker {ready_marker:?}: {received:?}"
            ));
        }
    }
    Ok(received)
}

fn posix_printf_octal_escape(text: &str) -> String {
    text.as_bytes()
        .iter()
        .map(|byte| format!("\\{byte:03o}"))
        .collect()
}

fn collect_any_data(
    terminals: &TerminalManager,
    session_id: &str,
    receiver: &mpsc::Receiver<TerminalOutputEvent>,
    mut received: String,
    timeout: Duration,
) -> Result<String, String> {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        let remaining = deadline.saturating_duration_since(Instant::now());
        let Ok(event) = receiver.recv_timeout(remaining) else {
            break;
        };
        if event.kind == TerminalOutputKind::Data {
            handle_terminal_data(terminals, session_id, &event.data, &mut received)?;
            if !received.is_empty() {
                return Ok(received);
            }
        }
    }
    Err("timed out waiting for any SSH terminal output".to_owned())
}

fn collect_until_auth_failure_feedback(
    terminals: &TerminalManager,
    session_id: &str,
    receiver: &mpsc::Receiver<TerminalOutputEvent>,
    mut received: String,
    timeout: Duration,
) -> Result<String, String> {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        let remaining = deadline.saturating_duration_since(Instant::now());
        let Ok(event) = receiver.recv_timeout(remaining) else {
            break;
        };
        if event.kind == TerminalOutputKind::Data {
            handle_terminal_data(terminals, session_id, &event.data, &mut received)?;
        }
        if auth_failure_feedback_seen(&received) {
            return Ok(received);
        }
    }

    Err(format!(
        "expected SSH terminal output to contain authentication failure feedback, got: {received:?}"
    ))
}

pub fn collect_additional_output_for(
    terminals: &TerminalManager,
    session_id: &str,
    receiver: &mpsc::Receiver<TerminalOutputEvent>,
    duration: Duration,
) -> Result<String, String> {
    let deadline = Instant::now() + duration;
    let mut received = String::new();
    while Instant::now() < deadline {
        let remaining = deadline.saturating_duration_since(Instant::now());
        let Ok(event) = receiver.recv_timeout(remaining) else {
            break;
        };
        match event.kind {
            TerminalOutputKind::Data => {
                handle_terminal_data(terminals, session_id, &event.data, &mut received)?;
            }
            TerminalOutputKind::Error => {
                return Err(format!(
                    "terminal error while collecting output: {}",
                    event.data
                ));
            }
            _ => {}
        }
    }
    Ok(received)
}

pub fn auth_failure_feedback_seen(output: &str) -> bool {
    let output = output.to_ascii_lowercase();
    output.contains("permission denied")
        || output.contains("authentication failed")
        || output.contains("认证失败")
        || output.contains("try again")
        || output.contains("access denied")
}

pub fn collect_until_output(
    terminals: &TerminalManager,
    session_id: &str,
    receiver: &mpsc::Receiver<TerminalOutputEvent>,
    expected: &str,
    mut received: String,
    timeout: Duration,
) -> Result<String, String> {
    if received.contains(expected) {
        return Ok(received);
    }

    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        let remaining = deadline.saturating_duration_since(Instant::now());
        let Ok(event) = receiver.recv_timeout(remaining) else {
            break;
        };
        match event.kind {
            TerminalOutputKind::Data => {
                handle_terminal_data(terminals, session_id, &event.data, &mut received)?;
            }
            TerminalOutputKind::Error => {
                return Err(format!(
                    "terminal error while waiting for {expected:?}: {}",
                    event.data
                ));
            }
            _ => {}
        }
        if received.contains(expected) {
            return Ok(received);
        }
    }

    Err(format!(
        "expected SSH terminal output to contain {expected:?}, got: {received:?}"
    ))
}

pub fn collect_until_closed(
    terminals: &TerminalManager,
    session_id: &str,
    receiver: &mpsc::Receiver<TerminalOutputEvent>,
    mut received: String,
    timeout: Duration,
) -> Result<String, String> {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        let remaining = deadline.saturating_duration_since(Instant::now());
        let Ok(event) = receiver.recv_timeout(remaining) else {
            break;
        };
        match event.kind {
            TerminalOutputKind::Data => {
                handle_terminal_data(terminals, session_id, &event.data, &mut received)?;
            }
            TerminalOutputKind::Closed => return Ok(received),
            TerminalOutputKind::Error => {
                return Err(format!(
                    "terminal error while waiting for close: {}",
                    event.data
                ));
            }
            TerminalOutputKind::AgentSignal => {}
        }
    }

    Err(format!(
        "expected SSH terminal to close, got output so far: {received:?}"
    ))
}

pub fn collect_until_agent_signal(
    terminals: &TerminalManager,
    session_id: &str,
    receiver: &mpsc::Receiver<TerminalOutputEvent>,
    mut received: String,
    timeout: Duration,
) -> Result<(String, TerminalAgentSignalSummary), String> {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        let remaining = deadline.saturating_duration_since(Instant::now());
        let Ok(event) = receiver.recv_timeout(remaining) else {
            break;
        };
        match event.kind {
            TerminalOutputKind::Data => {
                handle_terminal_data(terminals, session_id, &event.data, &mut received)?;
            }
            TerminalOutputKind::AgentSignal => {
                let Some(signal) = event.agent_signal else {
                    return Err("agent signal event did not include a signal summary".to_owned());
                };
                return Ok((received, signal));
            }
            TerminalOutputKind::Closed => {
                return Err(format!(
                    "terminal closed before agent signal, got output: {received:?}"
                ));
            }
            TerminalOutputKind::Error => {
                return Err(format!(
                    "terminal error while waiting for agent signal: {}",
                    event.data
                ));
            }
        }
    }

    Err(format!(
        "expected SSH terminal agent signal, got output so far: {received:?}"
    ))
}

fn handle_terminal_data(
    terminals: &TerminalManager,
    session_id: &str,
    data: &str,
    received: &mut String,
) -> Result<(), String> {
    received.push_str(data);
    if data.contains("\u{1b}[6n") {
        terminals
            .write(session_id, "\u{1b}[1;1R")
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}
