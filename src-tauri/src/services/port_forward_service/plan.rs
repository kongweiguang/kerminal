//! SSH 端口转发命令计划模型。
//!
//! @author kongweiguang

use std::{fmt, net::IpAddr, path::PathBuf};

use crate::{
    error::{AppError, AppResult},
    models::{
        port_forward::{
            PortForwardCreateRequest, PortForwardEndpoint, PortForwardKind,
            PortForwardProxyProtocol, PortForwardRemoteAccessScope, PortForwardStatus,
            PortForwardSummary,
        },
        remote_host::RemoteHost,
        terminal::TerminalSecretInputPlan,
    },
    paths::KerminalPaths,
    services::{
        ssh_command_plan::{
            known_hosts_args, preferred_authentication_args, resolve_ssh_auth_plan, SshAuthMethod,
        },
        ssh_route_plan::{build_ssh_route_plan, materialize_openssh_route_plan},
    },
};

/// OpenSSH 端口转发命令的完整运行时计划。
#[derive(Clone, PartialEq, Eq)]
pub struct ForwardCommandPlan {
    /// OpenSSH 可执行文件路径或命令名。
    pub executable: String,
    /// 传给 OpenSSH 的参数，不包含密码或内联私钥明文。
    pub args: Vec<String>,
    /// 端口转发进程结束后需要清理的临时文件。
    pub cleanup_paths: Vec<PathBuf>,
    /// 密码认证时的 PTY 安全输入计划。
    pub secret_input_plan: Option<TerminalSecretInputPlan>,
    /// 实际监听地址。
    pub bind_host: String,
    /// 目标主机；动态 SOCKS 转发可为空。
    pub target_host: Option<String>,
    /// 目标端口；动态 SOCKS 转发可为空。
    pub target_port: Option<u16>,
    /// 本机监听地址或本机侧代理入口地址。
    pub local_bind_host: Option<String>,
    /// 远端监听地址。
    pub remote_bind_host: Option<String>,
    /// 本机侧端点。
    pub local_endpoint: Option<PortForwardEndpoint>,
    /// 远端侧端点。
    pub remote_endpoint: Option<PortForwardEndpoint>,
    /// SOCKS 转发协议；`Http` 仅用于识别旧记录。
    pub proxy_protocol: Option<PortForwardProxyProtocol>,
    /// 远端监听可见范围。
    pub remote_access_scope: Option<PortForwardRemoteAccessScope>,
    /// 用户可复制的代理 URL。
    pub proxy_url: Option<String>,
    /// 脱敏后的命令预览。
    pub command_preview: String,
}

impl fmt::Debug for ForwardCommandPlan {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ForwardCommandPlan")
            .field("executable", &self.executable)
            .field("args", &self.args)
            .field("cleanup_paths", &self.cleanup_paths)
            .field(
                "secret_entry_count",
                &self
                    .secret_input_plan
                    .as_ref()
                    .map(|plan| plan.entries.len())
                    .unwrap_or_default(),
            )
            .field("bind_host", &self.bind_host)
            .field("target_host", &self.target_host)
            .field("target_port", &self.target_port)
            .field("local_bind_host", &self.local_bind_host)
            .field("remote_bind_host", &self.remote_bind_host)
            .field("local_endpoint", &self.local_endpoint)
            .field("remote_endpoint", &self.remote_endpoint)
            .field("proxy_protocol", &self.proxy_protocol)
            .field("remote_access_scope", &self.remote_access_scope)
            .field("proxy_url", &self.proxy_url)
            .field("command_preview", &self.command_preview)
            .finish()
    }
}

impl ForwardCommandPlan {
    pub(super) fn to_summary(
        &self,
        host: &RemoteHost,
        request: &PortForwardCreateRequest,
        pid: Option<u32>,
        id: String,
        created_at: String,
    ) -> PortForwardSummary {
        PortForwardSummary {
            id,
            host_id: host.id.clone(),
            host_name: host.name.clone(),
            name: normalized_name(request, host),
            kind: request.kind,
            origin: request.origin,
            bind_host: self.bind_host.clone(),
            local_bind_host: self.local_bind_host.clone(),
            remote_bind_host: self.remote_bind_host.clone(),
            source_port: request.source_port,
            target_host: self.target_host.clone(),
            target_port: self.target_port,
            local_endpoint: self.local_endpoint.clone(),
            remote_endpoint: self.remote_endpoint.clone(),
            proxy_protocol: self.proxy_protocol,
            remote_access_scope: self.remote_access_scope,
            proxy_url: self.proxy_url.clone(),
            proxy_apply_scope: request.proxy_apply_scope,
            command_preview: self.command_preview.clone(),
            last_error: None,
            runtime: None,
            pid,
            status: PortForwardStatus::Running,
            created_at,
        }
    }
}

/// 构建受管 SSH runtime 使用的端口转发元数据计划。
pub(super) fn build_managed_forward_plan(
    request: &PortForwardCreateRequest,
) -> AppResult<ForwardCommandPlan> {
    if request.source_port == 0 {
        return Err(AppError::InvalidInput("监听端口必须大于 0".to_owned()));
    }

    let route = resolve_forward_route(request)?;
    let command_preview = format!("managed-ssh-runtime {}", route.forward_arg);
    Ok(ForwardCommandPlan {
        executable: "managed-ssh-runtime".to_owned(),
        args: Vec::new(),
        cleanup_paths: Vec::new(),
        secret_input_plan: None,
        bind_host: route.bind_host,
        target_host: route.target_host,
        target_port: route.target_port,
        local_bind_host: route.local_bind_host,
        remote_bind_host: route.remote_bind_host,
        local_endpoint: route.local_endpoint,
        remote_endpoint: route.remote_endpoint,
        proxy_protocol: route.proxy_protocol,
        remote_access_scope: route.remote_access_scope,
        proxy_url: route.proxy_url,
        command_preview,
    })
}

/// 构建 OpenSSH 端口转发启动计划。
pub fn build_forward_plan(
    host: &RemoteHost,
    executable: String,
    paths: Option<&KerminalPaths>,
    request: &PortForwardCreateRequest,
) -> AppResult<ForwardCommandPlan> {
    if request.source_port == 0 {
        return Err(AppError::InvalidInput("监听端口必须大于 0".to_owned()));
    }

    let route = resolve_forward_route(request)?;
    let mut args = vec!["-N".to_owned(), "-T".to_owned(), "-a".to_owned()];
    let cleanup_paths;
    let secret_input_plan;

    if host.ssh_options.jump_hosts.is_empty() {
        let auth = resolve_ssh_auth_plan(host, paths)?;
        let batch_mode = auth.method != SshAuthMethod::Password;

        args.extend(["-p".to_owned(), host.port.to_string()]);
        if let Some(paths) = paths {
            args.extend(known_hosts_args(paths.root.join("known_hosts")));
        }
        if batch_mode {
            args.extend(["-o".to_owned(), "BatchMode=yes".to_owned()]);
        }
        args.extend(preferred_authentication_args(host.auth_type));
        args.extend(auth.args);
        args.extend(forward_common_args());
        args.push(forward_flag(route.kind).to_owned());
        args.push(route.forward_arg);
        args.push(format!("{}@{}", host.username, host.host));

        cleanup_paths = auth.cleanup_paths;
        secret_input_plan = auth.secret_input_plan;
    } else {
        let paths = paths.ok_or_else(|| {
            AppError::InvalidInput(
                "SSH 跳板端口转发需要应用路径上下文以创建临时 ssh config".to_owned(),
            )
        })?;
        let ssh_route = build_ssh_route_plan(host)?;
        let open_ssh =
            materialize_openssh_route_plan(&ssh_route, paths, paths.root.join("known_hosts"))?;

        if open_ssh.secret_input_plan.entries.is_empty() {
            args.extend(["-o".to_owned(), "BatchMode=yes".to_owned()]);
        }
        args.extend(forward_common_args());
        args.push(forward_flag(route.kind).to_owned());
        args.push(route.forward_arg);
        args.extend(open_ssh.args);

        cleanup_paths = open_ssh.cleanup_paths;
        secret_input_plan =
            (!open_ssh.secret_input_plan.entries.is_empty()).then_some(open_ssh.secret_input_plan);
    }

    let command_preview = command_preview(&executable, &args);

    Ok(ForwardCommandPlan {
        executable,
        args,
        cleanup_paths,
        secret_input_plan,
        bind_host: route.bind_host,
        target_host: route.target_host,
        target_port: route.target_port,
        local_bind_host: route.local_bind_host,
        remote_bind_host: route.remote_bind_host,
        local_endpoint: route.local_endpoint,
        remote_endpoint: route.remote_endpoint,
        proxy_protocol: route.proxy_protocol,
        remote_access_scope: route.remote_access_scope,
        proxy_url: route.proxy_url,
        command_preview,
    })
}

fn forward_common_args() -> Vec<String> {
    vec![
        "-o".to_owned(),
        "ExitOnForwardFailure=yes".to_owned(),
        "-o".to_owned(),
        "ServerAliveInterval=30".to_owned(),
        "-o".to_owned(),
        "ServerAliveCountMax=3".to_owned(),
    ]
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ForwardRoutePlan {
    kind: PortForwardKind,
    forward_arg: String,
    bind_host: String,
    target_host: Option<String>,
    target_port: Option<u16>,
    local_bind_host: Option<String>,
    remote_bind_host: Option<String>,
    local_endpoint: Option<PortForwardEndpoint>,
    remote_endpoint: Option<PortForwardEndpoint>,
    proxy_protocol: Option<PortForwardProxyProtocol>,
    remote_access_scope: Option<PortForwardRemoteAccessScope>,
    proxy_url: Option<String>,
}

fn resolve_forward_route(request: &PortForwardCreateRequest) -> AppResult<ForwardRoutePlan> {
    if request.proxy_protocol == Some(PortForwardProxyProtocol::Http) {
        return Err(AppError::InvalidInput(
            "HTTP 网络助手已移除，请改用远端 SOCKS 转发".to_owned(),
        ));
    }

    match request.kind {
        PortForwardKind::Local => resolve_local_route(request),
        PortForwardKind::Remote
            if request.proxy_protocol == Some(PortForwardProxyProtocol::Socks5)
                && request.target_host.is_none()
                && request.target_port.is_none() =>
        {
            resolve_remote_dynamic_route(request)
        }
        PortForwardKind::Remote => resolve_remote_route(request),
        PortForwardKind::RemoteDynamic => resolve_remote_dynamic_route(request),
        PortForwardKind::Dynamic => resolve_dynamic_route(request),
    }
}

fn resolve_local_route(request: &PortForwardCreateRequest) -> AppResult<ForwardRoutePlan> {
    let bind_host = listener_bind_host(request.local_bind_host.as_deref(), request)?;
    let target_host = required_target_host(request)?;
    let target_port = required_target_port(request)?;
    let local_endpoint = endpoint(
        Some(bind_host.clone()),
        Some(request.source_port),
        "本机监听",
    )?;
    let remote_endpoint = endpoint(Some(target_host.clone()), Some(target_port), "主机目标服务")?;

    Ok(ForwardRoutePlan {
        kind: PortForwardKind::Local,
        forward_arg: format!(
            "{}:{}:{}:{}",
            bind_host, request.source_port, target_host, target_port
        ),
        bind_host,
        target_host: Some(target_host),
        target_port: Some(target_port),
        local_bind_host: local_endpoint
            .as_ref()
            .map(|endpoint| endpoint.host.clone()),
        remote_bind_host: None,
        local_endpoint,
        remote_endpoint,
        proxy_protocol: None,
        remote_access_scope: None,
        proxy_url: None,
    })
}

fn resolve_remote_route(request: &PortForwardCreateRequest) -> AppResult<ForwardRoutePlan> {
    let bind_host = listener_bind_host(request.remote_bind_host.as_deref(), request)?;
    let target_host = required_target_host(request)?;
    let target_port = required_target_port(request)?;
    let remote_endpoint = endpoint(
        Some(bind_host.clone()),
        Some(request.source_port),
        "主机监听",
    )?;
    let local_endpoint = endpoint(Some(target_host.clone()), Some(target_port), "本机目标服务")?;
    let remote_access_scope = Some(
        request
            .remote_access_scope
            .unwrap_or_else(|| infer_remote_access_scope(&bind_host)),
    );

    Ok(ForwardRoutePlan {
        kind: PortForwardKind::Remote,
        forward_arg: format!(
            "{}:{}:{}:{}",
            bind_host, request.source_port, target_host, target_port
        ),
        bind_host,
        target_host: Some(target_host),
        target_port: Some(target_port),
        local_bind_host: None,
        remote_bind_host: remote_endpoint
            .as_ref()
            .map(|endpoint| endpoint.host.clone()),
        local_endpoint,
        remote_endpoint,
        proxy_protocol: None,
        remote_access_scope,
        proxy_url: None,
    })
}

fn resolve_dynamic_route(request: &PortForwardCreateRequest) -> AppResult<ForwardRoutePlan> {
    let bind_host = listener_bind_host(request.local_bind_host.as_deref(), request)?;
    let local_endpoint = endpoint(
        Some(bind_host.clone()),
        Some(request.source_port),
        "本机 SOCKS",
    )?;

    Ok(ForwardRoutePlan {
        kind: PortForwardKind::Dynamic,
        forward_arg: format!("{}:{}", bind_host, request.source_port),
        bind_host,
        target_host: None,
        target_port: None,
        local_bind_host: local_endpoint
            .as_ref()
            .map(|endpoint| endpoint.host.clone()),
        remote_bind_host: None,
        local_endpoint,
        remote_endpoint: None,
        proxy_protocol: Some(PortForwardProxyProtocol::Socks5),
        remote_access_scope: None,
        proxy_url: Some(format!(
            "socks5h://{}:{}",
            format_proxy_host(&proxy_client_host(&request_bind_host(request))),
            request.source_port
        )),
    })
}

fn resolve_remote_dynamic_route(request: &PortForwardCreateRequest) -> AppResult<ForwardRoutePlan> {
    let bind_host = listener_bind_host(request.remote_bind_host.as_deref(), request)?;
    let remote_endpoint = endpoint(
        Some(bind_host.clone()),
        Some(request.source_port),
        "主机代理监听",
    )?;
    let remote_access_scope = Some(
        request
            .remote_access_scope
            .unwrap_or_else(|| infer_remote_access_scope(&bind_host)),
    );

    Ok(ForwardRoutePlan {
        kind: PortForwardKind::RemoteDynamic,
        forward_arg: format!("{}:{}", bind_host, request.source_port),
        bind_host: bind_host.clone(),
        target_host: None,
        target_port: None,
        local_bind_host: None,
        remote_bind_host: remote_endpoint
            .as_ref()
            .map(|endpoint| endpoint.host.clone()),
        local_endpoint: None,
        remote_endpoint,
        proxy_protocol: Some(PortForwardProxyProtocol::Socks5),
        remote_access_scope,
        proxy_url: Some(format!(
            "socks5h://{}:{}",
            format_proxy_host(&proxy_client_host(&bind_host)),
            request.source_port
        )),
    })
}

fn listener_bind_host(
    preferred: Option<&str>,
    request: &PortForwardCreateRequest,
) -> AppResult<String> {
    validate_host_like(
        preferred
            .or(request.bind_host.as_deref())
            .filter(|value| !value.trim().is_empty())
            .unwrap_or("127.0.0.1"),
        "监听地址",
    )
}

fn request_bind_host(request: &PortForwardCreateRequest) -> String {
    request
        .local_bind_host
        .as_deref()
        .or(request.bind_host.as_deref())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("127.0.0.1")
        .trim()
        .to_owned()
}

fn proxy_client_host(bind_host: &str) -> String {
    match bind_host.trim() {
        "" | "0.0.0.0" => "127.0.0.1".to_owned(),
        "::" => "::1".to_owned(),
        host => host.to_owned(),
    }
}

fn format_proxy_host(host: &str) -> String {
    if host.contains(':') && !host.starts_with('[') {
        format!("[{host}]")
    } else {
        host.to_owned()
    }
}

fn endpoint(
    host: Option<String>,
    port: Option<u16>,
    label: &str,
) -> AppResult<Option<PortForwardEndpoint>> {
    let Some(host) = host else {
        return Ok(None);
    };
    Ok(Some(PortForwardEndpoint {
        host: validate_host_like(&host, label)?,
        port,
        label: Some(label.to_owned()),
    }))
}

fn required_target_host(request: &PortForwardCreateRequest) -> AppResult<String> {
    let target_host = request
        .target_host
        .as_deref()
        .ok_or_else(|| AppError::InvalidInput("目标主机不能为空".to_owned()))?;
    validate_host_like(target_host, "目标主机")
}

fn required_target_port(request: &PortForwardCreateRequest) -> AppResult<u16> {
    match request.target_port {
        Some(port) if port > 0 => Ok(port),
        _ => Err(AppError::InvalidInput("目标端口必须大于 0".to_owned())),
    }
}

fn validate_host_like(value: &str, label: &str) -> AppResult<String> {
    let trimmed = value.trim();
    if trimmed.is_empty()
        || trimmed.contains('\0')
        || trimmed.contains('\r')
        || trimmed.contains('\n')
        || trimmed.split_whitespace().count() > 1
    {
        return Err(AppError::InvalidInput(format!("{label}不合法")));
    }
    Ok(trimmed.to_owned())
}

fn infer_remote_access_scope(bind_host: &str) -> PortForwardRemoteAccessScope {
    let trimmed = bind_host.trim();
    if matches!(trimmed, "127.0.0.1" | "localhost" | "::1") {
        return PortForwardRemoteAccessScope::Loopback;
    }
    if matches!(trimmed, "0.0.0.0" | "::") {
        return PortForwardRemoteAccessScope::AllInterfaces;
    }
    if trimmed
        .parse::<IpAddr>()
        .ok()
        .is_some_and(|ip| matches!(ip, IpAddr::V4(ip) if ip.is_private()))
    {
        return PortForwardRemoteAccessScope::PrivateNetwork;
    }
    PortForwardRemoteAccessScope::Custom
}

pub(super) fn forward_flag(kind: PortForwardKind) -> &'static str {
    match kind {
        PortForwardKind::Local => "-L",
        PortForwardKind::Remote | PortForwardKind::RemoteDynamic => "-R",
        PortForwardKind::Dynamic => "-D",
    }
}

fn normalized_name(request: &PortForwardCreateRequest, host: &RemoteHost) -> String {
    request
        .name
        .as_deref()
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| format!("{} {}", host.name, forward_flag(request.kind)))
}

fn command_preview(executable: &str, args: &[String]) -> String {
    std::iter::once(executable)
        .chain(args.iter().map(String::as_str))
        .map(shell_quote)
        .collect::<Vec<_>>()
        .join(" ")
}

fn shell_quote(value: &str) -> String {
    if !value.is_empty()
        && value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || "-_./:=@".contains(ch))
    {
        return value.to_owned();
    }
    format!("'{}'", value.replace('\'', "'\\''"))
}
