// @author kongweiguang

use super::*;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostUpsertWithCredentialRequest {
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    group_id: Option<String>,
    name: String,
    host: String,
    #[serde(default)]
    port: Option<u16>,
    username: String,
    password: String,
}

fn host_upsert_with_credential_request_from_arguments(
    arguments: &serde_json::Map<String, Value>,
) -> AppResult<HostUpsertWithCredentialRequest> {
    request_from_arguments(arguments, "kerminal.host.upsert_with_credential")
}

pub(super) fn execute_vault_encrypt_secret(
    paths: &KerminalPaths,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let kind = match required_string_arg(arguments, "kind") {
        Ok(value) => value,
        Err(error) => return failure(error.to_string()),
    };
    let host_id = match required_string_arg(arguments, "hostId") {
        Ok(value) => value,
        Err(error) => return failure(error.to_string()),
    };
    let scope = match required_string_arg(arguments, "scope") {
        Ok(value) => value,
        Err(error) => return failure(error.to_string()),
    };
    let material = match required_string_arg(arguments, "material") {
        Ok(value) => value,
        Err(error) => return failure(error.to_string()),
    };
    let plaintext = match required_string_arg(arguments, "plaintext") {
        Ok(value) => value,
        Err(error) => return failure(error.to_string()),
    };
    if plaintext.trim().is_empty() {
        return failure("plaintext 不能为空。");
    }

    let secret_ref =
        build_vault_secret_ref(kind.trim(), host_id.trim(), scope.trim(), material.trim());
    let parsed = match parse_vault_secret_ref(&secret_ref) {
        Ok(parsed) => parsed,
        Err(error) => return failure(error),
    };
    let vault = EncryptedVaultService::new(paths.clone());
    let entry = match vault.upsert_secret(
        &parsed.entry_id(),
        kind.trim(),
        secret_ref.as_bytes(),
        plaintext.as_bytes(),
    ) {
        Ok(entry) => entry,
        Err(error) => return failure(error.to_string()),
    };

    ToolExecutionResult {
        status: McpToolExecutionStatus::Succeeded,
        result_summary: Some(format!(
            "Secret 已加密保存到 Kerminal vault：{}。",
            secret_ref
        )),
        structured_result: Some(json!({
            "secretRef": secret_ref,
            "entryId": parsed.entry_id(),
            "kind": entry.kind,
            "keyId": entry.key_id,
            "updatedAt": entry.updated_at,
        })),
        ..ToolExecutionResult::default()
    }
}

pub(super) fn execute_host_upsert_with_credential(
    remote_hosts: &RemoteHostService,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let request = match host_upsert_with_credential_request_from_arguments(arguments) {
        Ok(request) => request,
        Err(error) => return failure(error.to_string()),
    };
    if request.password.trim().is_empty() {
        return failure("password 不能为空。");
    }
    let port = request.port.unwrap_or(22);
    let existing = match resolve_existing_host(remote_hosts, &request, port) {
        Ok(existing) => existing,
        Err(error) => return failure(error.to_string()),
    };

    let result = if let Some(existing) = existing {
        remote_hosts.update_host(RemoteHostUpdateRequest {
            id: existing.id,
            group_id: request.group_id.or(existing.group_id),
            name: request.name,
            host: request.host,
            port,
            username: request.username,
            protocol: existing.protocol,
            auth_type: RemoteHostAuthType::Password,
            credential_ref: None,
            credential_secret: Some(request.password),
            tags: existing.tags,
            ssh_options: existing.ssh_options,
            sort_order: existing.sort_order,
        })
    } else {
        remote_hosts.create_host(RemoteHostCreateRequest {
            group_id: request.group_id,
            name: request.name,
            host: request.host,
            port,
            username: request.username,
            protocol: Default::default(),
            auth_type: RemoteHostAuthType::Password,
            credential_ref: None,
            credential_secret: Some(request.password),
            tags: Vec::new(),
            ssh_options: Default::default(),
        })
    };

    let host = match result {
        Ok(host) => host,
        Err(error) => return failure(error.to_string()),
    };

    ToolExecutionResult {
        status: McpToolExecutionStatus::Succeeded,
        result_summary: Some(format!(
            "主机已保存：{}@{}:{}，凭据已写入 encrypted vault。",
            host.username, host.host, host.port
        )),
        structured_result: Some(json!({
            "hostId": host.id,
            "name": host.name,
            "host": host.host,
            "port": host.port,
            "username": host.username,
            "authType": host.auth_type,
            "secretRef": host.secret_ref,
            "credentialStatus": host.credential_status,
        })),
        ..ToolExecutionResult::default()
    }
}

fn resolve_existing_host(
    remote_hosts: &RemoteHostService,
    request: &HostUpsertWithCredentialRequest,
    port: u16,
) -> AppResult<Option<RemoteHost>> {
    if let Some(id) = request
        .id
        .as_deref()
        .map(str::trim)
        .filter(|id| !id.is_empty())
    {
        return remote_hosts.host_by_id(id);
    }
    let groups = remote_hosts.list_tree()?;
    Ok(groups
        .into_iter()
        .flat_map(|group| group.hosts)
        .find(|host| {
            host.host == request.host.trim()
                && host.username == request.username.trim()
                && host.port == port
        }))
}
