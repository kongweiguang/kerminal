//! 已解析 SSH 凭据向运行时主机的物化。
//!
//! @author kongweiguang

use crate::{
    error::{AppError, AppResult},
    models::remote_host::{parse_vault_secret_ref, RemoteHost, SshJumpHostOptions},
};

use super::{
    ResolvedSshAuthMaterial, ResolvedSshRouteAuth, ResolvedSshSecretValue, VaultResolvedSource,
};

pub(super) fn vault_source(secret_ref: &str) -> AppResult<VaultResolvedSource> {
    let parsed = parse_vault_secret_ref(secret_ref).map_err(AppError::InvalidInput)?;
    Ok(VaultResolvedSource {
        secret_ref: secret_ref.to_owned(),
        entry_id: parsed.entry_id(),
    })
}

pub(super) fn normalized(value: Option<&str>) -> Option<&str> {
    value.map(str::trim).filter(|value| !value.is_empty())
}

pub(super) fn materialize_runtime_host(
    host: &RemoteHost,
    resolved_auth: &ResolvedSshRouteAuth,
) -> RemoteHost {
    let mut runtime_host = host.clone();
    apply_material_to_host(&mut runtime_host, &resolved_auth.target.material);
    for (jump, resolved_jump) in runtime_host
        .ssh_options
        .jump_hosts
        .iter_mut()
        .zip(&resolved_auth.jumps)
    {
        apply_material_to_jump(jump, &resolved_jump.material);
    }
    runtime_host
}

fn apply_material_to_host(host: &mut RemoteHost, material: &ResolvedSshAuthMaterial) {
    match material {
        ResolvedSshAuthMaterial::Agent { .. } => {
            host.credential_ref = None;
            host.credential_secret = None;
            host.key_passphrase_secret = None;
        }
        ResolvedSshAuthMaterial::Password { value, .. } => {
            host.credential_ref = None;
            host.credential_secret = Some(value.clone());
            host.key_passphrase_secret = None;
        }
        ResolvedSshAuthMaterial::PrivateKeyPath {
            path, passphrase, ..
        } => {
            host.credential_ref = Some(display_path_arg(path));
            host.credential_secret = None;
            host.key_passphrase_secret = passphrase_value(passphrase);
        }
        ResolvedSshAuthMaterial::PrivateKeyPem {
            content,
            passphrase,
            ..
        } => {
            host.credential_ref = None;
            host.credential_secret = Some(content.clone());
            host.key_passphrase_secret = passphrase_value(passphrase);
        }
        ResolvedSshAuthMaterial::PromptOnly { .. } => {
            host.credential_secret = None;
            host.key_passphrase_secret = None;
        }
    }
}

fn apply_material_to_jump(jump: &mut SshJumpHostOptions, material: &ResolvedSshAuthMaterial) {
    match material {
        ResolvedSshAuthMaterial::Agent { .. } => {
            jump.credential_ref = None;
            jump.credential_secret = None;
            jump.key_passphrase_secret = None;
        }
        ResolvedSshAuthMaterial::Password { value, .. } => {
            jump.credential_ref = None;
            jump.credential_secret = Some(value.clone());
            jump.key_passphrase_secret = None;
        }
        ResolvedSshAuthMaterial::PrivateKeyPath {
            path, passphrase, ..
        } => {
            jump.credential_ref = Some(display_path_arg(path));
            jump.credential_secret = None;
            jump.key_passphrase_secret = passphrase_value(passphrase);
        }
        ResolvedSshAuthMaterial::PrivateKeyPem {
            content,
            passphrase,
            ..
        } => {
            jump.credential_ref = None;
            jump.credential_secret = Some(content.clone());
            jump.key_passphrase_secret = passphrase_value(passphrase);
        }
        ResolvedSshAuthMaterial::PromptOnly { .. } => {
            jump.credential_secret = None;
            jump.key_passphrase_secret = None;
        }
    }
}

fn passphrase_value(passphrase: &Option<ResolvedSshSecretValue>) -> Option<String> {
    passphrase.as_ref().map(|value| value.value.clone())
}

fn display_path_arg(path: &std::path::Path) -> String {
    path.to_string_lossy().into_owned()
}
