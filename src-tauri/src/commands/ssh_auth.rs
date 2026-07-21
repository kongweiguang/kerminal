//! SSH authentication broker commands.
//!
//! @author kongweiguang

use std::fmt;

use serde::Deserialize;
use tauri::State;

use crate::{
    error::{AppError, AppResult},
    models::remote_host::{RemoteHostAuthType, RemoteHostUpdateRequest},
    services::ssh_runtime::{
        auth_broker::{SshAuthBrokerSnapshot, SshSessionSecretInput, SshSessionSecretReceipt},
        SshAuthSecretKind,
    },
    state::AppState,
};

/// Prompt response submitted by the trusted desktop UI.
#[derive(Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshAuthPromptResponseRequest {
    pub prompt_id: String,
    pub secret_kind: SshAuthSecretKind,
    pub value: String,
    #[serde(default)]
    pub persist_to_host_id: Option<String>,
}

impl fmt::Debug for SshAuthPromptResponseRequest {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("SshAuthPromptResponseRequest")
            .field("prompt_id", &self.prompt_id)
            .field("secret_kind", &self.secret_kind)
            .field("value", &"<redacted>")
            .field("persist_to_host_id", &self.persist_to_host_id)
            .finish()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshAuthForgetSessionSecretRequest {
    pub prompt_id: String,
    pub secret_kind: SshAuthSecretKind,
}

/// Store one session-only SSH prompt response, optionally persisting target host material.
#[tauri::command]
pub fn ssh_auth_submit_prompt_response(
    state: State<'_, AppState>,
    request: SshAuthPromptResponseRequest,
) -> Result<SshSessionSecretReceipt, String> {
    let receipt = state
        .ssh_auth_broker()
        .remember_session_secret(SshSessionSecretInput {
            prompt_id: request.prompt_id.clone(),
            secret_kind: request.secret_kind,
            value: request.value.clone(),
        })
        .map_err(|error| error.to_string())?;

    if let Some(host_id) = request.persist_to_host_id.as_deref() {
        if let Err(error) = persist_target_host_secret(
            &state,
            host_id,
            request.secret_kind,
            &request.value,
            &request.prompt_id,
        ) {
            let _ = state
                .ssh_auth_broker()
                .forget_session_secret(&request.prompt_id, request.secret_kind);
            return Err(error.to_string());
        }
    }

    Ok(receipt)
}

/// Forget one session-only SSH prompt secret.
#[tauri::command]
pub fn ssh_auth_forget_session_secret(
    state: State<'_, AppState>,
    request: SshAuthForgetSessionSecretRequest,
) -> Result<bool, String> {
    state
        .ssh_auth_broker()
        .forget_session_secret(&request.prompt_id, request.secret_kind)
        .map_err(|error| error.to_string())
}

/// Clear all session-only SSH prompt secrets.
#[tauri::command]
pub fn ssh_auth_clear_session_secrets(state: State<'_, AppState>) -> Result<usize, String> {
    state
        .ssh_auth_broker()
        .clear_session_secrets()
        .map_err(|error| error.to_string())
}

/// Return a redacted SSH auth broker diagnostics snapshot.
#[tauri::command]
pub fn ssh_auth_broker_snapshot(
    state: State<'_, AppState>,
) -> Result<SshAuthBrokerSnapshot, String> {
    state
        .ssh_auth_broker()
        .snapshot()
        .map_err(|error| error.to_string())
}

fn persist_target_host_secret(
    state: &AppState,
    host_id: &str,
    secret_kind: SshAuthSecretKind,
    value: &str,
    prompt_id: &str,
) -> AppResult<()> {
    if !prompt_id.starts_with("ssh-auth:target:") {
        return Err(AppError::InvalidInput(
            "当前只支持保存目标 SSH 主机的认证材料，跳板机凭据请在主机配置中保存".to_owned(),
        ));
    }

    let host = state.remote_hosts().require_host(host_id)?;
    let (auth_type, credential_ref) = match secret_kind {
        SshAuthSecretKind::Password if matches!(host.auth_type, RemoteHostAuthType::Password) => {
            (RemoteHostAuthType::Password, None)
        }
        SshAuthSecretKind::PrivateKey if matches!(host.auth_type, RemoteHostAuthType::Key) => {
            (RemoteHostAuthType::Key, None)
        }
        SshAuthSecretKind::KeyPassphrase => {
            return Err(AppError::InvalidInput(
                "暂不支持从认证 prompt 单独保存私钥 passphrase".to_owned(),
            ));
        }
        SshAuthSecretKind::Password | SshAuthSecretKind::PrivateKey => {
            return Err(AppError::InvalidInput(
                "认证材料类型与目标主机认证方式不匹配，未写入 encrypted vault".to_owned(),
            ));
        }
    };

    state.remote_hosts().update_host(RemoteHostUpdateRequest {
        id: host.id,
        group_id: host.group_id,
        name: host.name,
        host: host.host,
        port: host.port,
        username: host.username,
        protocol: host.protocol,
        auth_type,
        credential_ref,
        credential_secret: Some(value.to_owned()),
        tags: host.tags,
        production: host.production,
        ssh_options: host.ssh_options,
        sort_order: host.sort_order,
    })?;

    Ok(())
}
