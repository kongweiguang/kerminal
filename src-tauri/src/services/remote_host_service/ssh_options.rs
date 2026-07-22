//! SSH 选项规范化边界。
//!
//! @author kongweiguang

use crate::{
    error::{AppError, AppResult},
    models::remote_host::{RemoteHostAuthType, SshOptions, SshProxyProtocol, SshTunnelKind},
};

use super::normalize_optional_text;

pub(super) fn normalize_ssh_options(mut options: SshOptions) -> AppResult<SshOptions> {
    options.proxy.host = normalize_optional_text(options.proxy.host);
    options.proxy.username = normalize_optional_text(options.proxy.username);
    options.proxy.credential_ref = normalize_optional_text(options.proxy.credential_ref);
    if matches!(options.proxy.protocol, SshProxyProtocol::None) {
        options.proxy.host = None;
        options.proxy.port = None;
        options.proxy.username = None;
        options.proxy.credential_ref = None;
    }

    options.tunnels = options
        .tunnels
        .into_iter()
        .map(|mut tunnel| {
            tunnel.name = tunnel.name.trim().to_owned();
            tunnel.bind_host = tunnel.bind_host.trim().to_owned();
            tunnel.target_host = tunnel.target_host.trim().to_owned();
            tunnel
        })
        .filter(|tunnel| {
            tunnel.bind_port.is_some()
                || !tunnel.bind_host.is_empty()
                || !tunnel.target_host.is_empty()
                || tunnel.target_port.is_some()
                || !tunnel.name.is_empty()
        })
        .filter(|tunnel| {
            matches!(tunnel.kind, SshTunnelKind::Dynamic)
                || !tunnel.target_host.is_empty()
                || tunnel.target_port.is_some()
        })
        .collect();

    options.jump_hosts = options
        .jump_hosts
        .into_iter()
        .map(|mut jump_host| {
            jump_host.name = jump_host.name.trim().to_owned();
            jump_host.host = jump_host.host.trim().to_owned();
            jump_host.username = jump_host.username.trim().to_owned();
            jump_host.credential_ref = normalize_optional_text(jump_host.credential_ref);
            jump_host.credential_secret = jump_host
                .credential_secret
                .filter(|secret| !secret.trim().is_empty());
            match jump_host.auth_type {
                RemoteHostAuthType::Agent => {
                    jump_host.credential_ref = None;
                    jump_host.credential_secret = None;
                }
                RemoteHostAuthType::Password => {
                    jump_host.credential_ref = None;
                }
                RemoteHostAuthType::Key => {
                    if jump_host.credential_secret.is_some() {
                        jump_host.credential_ref = None;
                    }
                }
            }
            jump_host
        })
        .map(|jump_host| {
            if jump_host
                .credential_ref
                .as_deref()
                .is_some_and(|value| value.starts_with("credential:"))
            {
                return Err(AppError::InvalidInput(
                    "跳板机密钥认证不再支持 credential: 凭据引用".to_owned(),
                ));
            }
            Ok(jump_host)
        })
        .collect::<AppResult<Vec<_>>>()?
        .into_iter()
        .filter(|jump_host| !jump_host.host.is_empty())
        .collect();

    options.terminal.encoding = options.terminal.encoding.trim().to_owned();
    options.terminal.terminal_type = options.terminal.terminal_type.trim().to_owned();
    options.terminal.keyboard_profile = options.terminal.keyboard_profile.trim().to_owned();
    options.terminal.alt_modifier = options.terminal.alt_modifier.trim().to_owned();
    options.terminal.backspace_key = options.terminal.backspace_key.trim().to_owned();
    options.terminal.delete_key = options.terminal.delete_key.trim().to_owned();
    options.terminal.startup_command = options.terminal.startup_command.trim().to_owned();
    options.terminal.environment = options.terminal.environment.trim().to_owned();
    options.terminal.login_script = options.terminal.login_script.trim().to_owned();

    options.transfer.remote_start_directory =
        options.transfer.remote_start_directory.trim().to_owned();
    options.transfer.local_start_directory =
        options.transfer.local_start_directory.trim().to_owned();
    options.transfer.max_concurrent_transfers =
        options.transfer.max_concurrent_transfers.clamp(1, 16);

    Ok(options)
}
