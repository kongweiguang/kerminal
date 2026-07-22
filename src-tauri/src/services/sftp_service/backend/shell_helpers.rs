use russh::ChannelMsg;

use crate::{
    error::{AppError, AppResult},
    models::{
        remote_host::RemoteHost,
        sftp::{SftpDirectoryListing, SftpEntry, SftpEntryKind},
    },
    services::{
        sftp_service::{
            backend::{SftpEndpoint, SftpRuntimeSettings},
            native_ssh::connect_native_ssh_chain,
            remote_text::sftp_entry_kind_rank,
            transfer_paths::parent_remote_path,
        },
        ssh_credential_resolver::NativeSshRouteMaterial,
        ssh_runtime::{
            facade::{SshRuntimeFacade, SshRuntimeSessionLane, SshRuntimeTargetContext},
            policy::{
                is_capability_unsupported, is_external_runtime_target_id,
                is_managed_runtime_unwired, runtime_host_key_policy_for_host_id,
                SshRuntimeCapability,
            },
            session_key::ssh_session_key_for_route,
            ManagedSshSessionManager, SshRuntimeConnectRequest, SshRuntimeExecOutput,
            SshRuntimeExecRequest,
        },
    },
};

use super::{
    errors::native_ssh_error, managed_exec_error, LEGACY_FALLBACK_SFTP_EXEC_UNSUPPORTED,
    LEGACY_FALLBACK_SFTP_EXEC_UNWIRED,
};

const DIRECTORY_DELETE_ERROR_BYTES: usize = 8 * 1024;
const SHELL_DIRECTORY_LIST_MAX_BYTES: usize = 2 * 1024 * 1024;

pub(super) async fn list_external_directory_with_shell(
    endpoint: &SftpEndpoint,
    path: &str,
    settings: SftpRuntimeSettings,
    managed_runtime: Option<&ManagedSshSessionManager>,
) -> AppResult<Option<SftpDirectoryListing>> {
    log_external_sftp_event("list.fallback.start", endpoint, Some(path), None);
    let script = shell_directory_list_script(path);
    let Some(output) = execute_managed_sftp_helper(
        endpoint,
        &script,
        settings,
        managed_runtime,
        "sftp.list.exec",
        SHELL_DIRECTORY_LIST_MAX_BYTES,
    )
    .await?
    else {
        log_external_sftp_event("list.fallback.unavailable", endpoint, Some(path), None);
        return Ok(None);
    };
    let listing = finish_shell_directory_listing(endpoint, path, output)?;
    log_external_sftp_event("list.fallback.ok", endpoint, Some(path), None);
    Ok(Some(listing))
}

pub(super) fn log_external_sftp_event(
    event: &'static str,
    endpoint: &SftpEndpoint,
    path: Option<&str>,
    error: Option<&str>,
) {
    if !is_external_runtime_target_id(&endpoint.host.id) {
        return;
    }
    match error {
        Some(_) => tauri_plugin_log::log::warn!(
            target: "sftp.external",
            "event={} target={} path_present={} failed=true",
            event,
            sftp_host_label(&endpoint.host),
            path.is_some_and(|value| !value.trim().is_empty())
        ),
        None => tauri_plugin_log::log::info!(
            target: "sftp.external",
            "event={} target={} path_present={}",
            event,
            sftp_host_label(&endpoint.host),
            path.is_some_and(|value| !value.trim().is_empty())
        ),
    }
}

pub(super) async fn remove_remote_directory_with_shell(
    endpoint: &SftpEndpoint,
    path: &str,
    settings: SftpRuntimeSettings,
    managed_runtime: Option<&ManagedSshSessionManager>,
) -> AppResult<()> {
    validate_remote_directory_shell_delete_path(path)?;
    let script = format!("rm -rf -- {}\n", shell_single_quote(path));
    if let Some(output) =
        execute_managed_directory_delete(endpoint, &script, settings, managed_runtime).await?
    {
        return finish_remote_directory_delete(output.exit_code, &output.stderr);
    }

    let connection = connect_native_ssh_chain(endpoint, settings).await?;

    let mut channel = connection
        .target()
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

    let mut stderr = Vec::new();
    let mut exit_code = None;
    let mut exec_request_failed = false;
    while let Some(message) = channel.wait().await {
        match message {
            ChannelMsg::ExtendedData { data, .. } => {
                push_limited_bytes(&mut stderr, data.as_ref(), DIRECTORY_DELETE_ERROR_BYTES);
            }
            ChannelMsg::ExitStatus { exit_status } => {
                exit_code = i32::try_from(exit_status).ok();
            }
            ChannelMsg::ExitSignal {
                signal_name,
                error_message,
                ..
            } => {
                if !error_message.trim().is_empty() {
                    push_limited_bytes(
                        &mut stderr,
                        error_message.as_bytes(),
                        DIRECTORY_DELETE_ERROR_BYTES,
                    );
                    push_limited_bytes(&mut stderr, b"\n", DIRECTORY_DELETE_ERROR_BYTES);
                }
                push_limited_bytes(
                    &mut stderr,
                    format!("remote process terminated by signal: {signal_name:?}\n").as_bytes(),
                    DIRECTORY_DELETE_ERROR_BYTES,
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
    connection.disconnect("directory deleted").await;

    if exec_request_failed {
        return Err(AppError::Sftp("远端拒绝执行目录递归删除命令".to_owned()));
    }
    if exit_code == Some(0) {
        return Ok(());
    }

    let detail = String::from_utf8_lossy(&stderr).trim().to_owned();
    let exit_detail = exit_code
        .map(|code| format!("退出码 {code}"))
        .unwrap_or_else(|| "退出码未知".to_owned());
    if detail.is_empty() {
        Err(AppError::Sftp(format!(
            "远程目录递归删除失败: {exit_detail}"
        )))
    } else {
        Err(AppError::Sftp(format!(
            "远程目录递归删除失败: {exit_detail}: {detail}"
        )))
    }
}

async fn execute_managed_directory_delete(
    endpoint: &SftpEndpoint,
    script: &str,
    settings: SftpRuntimeSettings,
    managed_runtime: Option<&ManagedSshSessionManager>,
) -> AppResult<Option<SshRuntimeExecOutput>> {
    execute_managed_sftp_helper(
        endpoint,
        script,
        settings,
        managed_runtime,
        "sftp.exec",
        DIRECTORY_DELETE_ERROR_BYTES,
    )
    .await
}

async fn execute_managed_sftp_helper(
    endpoint: &SftpEndpoint,
    script: &str,
    settings: SftpRuntimeSettings,
    managed_runtime: Option<&ManagedSshSessionManager>,
    capability: &str,
    max_output_bytes: usize,
) -> AppResult<Option<SshRuntimeExecOutput>> {
    let Some(managed_runtime) = managed_runtime else {
        return Ok(None);
    };
    let key = ssh_session_key_for_route(
        &endpoint.host,
        &endpoint.route_auth,
        &endpoint.known_hosts_path,
    )
    .map_err(managed_exec_error)?;
    let request = SshRuntimeConnectRequest::native(
        key,
        endpoint.host.clone(),
        endpoint.known_hosts_path.clone(),
        settings.timeout_seconds,
    )
    .with_host_key_policy(runtime_host_key_policy_for_host_id(&endpoint.host.id))
    .with_native_route_material(NativeSshRouteMaterial::from_resolved_auth(
        &endpoint.route_auth,
    )?);
    let facade = SshRuntimeFacade::new(managed_runtime.clone());
    let context = SshRuntimeTargetContext::new(request)
        .with_lane(SshRuntimeSessionLane::Capability)
        .with_target_label(sftp_host_label(&endpoint.host));
    let request = SshRuntimeExecRequest::new(
        script.to_owned(),
        settings.timeout_seconds,
        max_output_bytes,
    );
    match facade.execute_exec(&context, request).await {
        Ok(output) => Ok(Some(output)),
        Err(error) if is_managed_runtime_unwired(&error) => {
            facade.record_legacy_fallback(
                capability,
                LEGACY_FALLBACK_SFTP_EXEC_UNWIRED,
                Some(&context),
            );
            Ok(None)
        }
        Err(error) if is_capability_unsupported(&error, SshRuntimeCapability::Exec) => {
            facade.record_legacy_fallback(
                capability,
                LEGACY_FALLBACK_SFTP_EXEC_UNSUPPORTED,
                Some(&context),
            );
            Ok(None)
        }
        Err(error) => Err(managed_exec_error(error)),
    }
}

fn shell_directory_list_script(path: &str) -> String {
    let quoted_path = shell_single_quote(path);
    format!(
        r#"dir={quoted_path}
if [ ! -d "$dir" ]; then
  printf '%s\n' "not a directory: $dir" >&2
  exit 2
fi
for item in "$dir"/.[!.]* "$dir"/..?* "$dir"/*; do
  [ -e "$item" ] || [ -L "$item" ] || continue
  name=${{item##*/}}
  case "$name" in .|..) continue;; esac
  if [ -L "$item" ]; then
    kind=symlink
  elif [ -d "$item" ]; then
    kind=directory
  elif [ -f "$item" ]; then
    kind=file
  else
    kind=other
  fi
  raw=$(ls -ldn -- "$item" 2>/dev/null || ls -ld -- "$item" 2>/dev/null || printf '')
  printf '%s\0%s\0%s\0%s\0' "$kind" "$item" "$name" "$raw"
done
"#
    )
}

fn finish_shell_directory_listing(
    endpoint: &SftpEndpoint,
    path: &str,
    output: SshRuntimeExecOutput,
) -> AppResult<SftpDirectoryListing> {
    if output.exit_code != Some(0) {
        let detail = output.stderr.trim();
        let exit_detail = output
            .exit_code
            .map(|code| format!("退出码 {code}"))
            .unwrap_or_else(|| "退出码未知".to_owned());
        if detail.is_empty() {
            return Err(AppError::Sftp(format!(
                "远程目录浏览降级命令失败: {exit_detail}"
            )));
        }
        return Err(AppError::Sftp(format!(
            "远程目录浏览降级命令失败: {exit_detail}: {detail}"
        )));
    }
    let mut entries = parse_shell_directory_listing(path, &output.stdout)?;
    entries.sort_by(|left, right| {
        sftp_entry_kind_rank(&left.kind)
            .cmp(&sftp_entry_kind_rank(&right.kind))
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });
    Ok(SftpDirectoryListing {
        host_id: endpoint.host.id.clone(),
        parent_path: parent_remote_path(path),
        path: path.to_owned(),
        entries,
    })
}

fn parse_shell_directory_listing(parent: &str, stdout: &str) -> AppResult<Vec<SftpEntry>> {
    let parts = stdout.split('\0').collect::<Vec<_>>();
    let mut entries = Vec::new();
    for chunk in parts.chunks(4) {
        if chunk.len() < 4 || chunk.iter().all(|value| value.is_empty()) {
            continue;
        }
        let kind = shell_entry_kind(chunk[0]);
        let name = chunk[2].trim();
        if name.is_empty() || name == "." || name == ".." {
            continue;
        }
        let raw = chunk[3].trim().to_owned();
        entries.push(SftpEntry {
            name: name.to_owned(),
            path: remote_child_path(parent, name),
            kind,
            size: shell_entry_size(&raw),
            permissions: raw.split_whitespace().next().map(ToOwned::to_owned),
            modified: None,
            raw,
        });
    }
    Ok(entries)
}

fn shell_entry_kind(value: &str) -> SftpEntryKind {
    match value {
        "directory" => SftpEntryKind::Directory,
        "file" => SftpEntryKind::File,
        "symlink" => SftpEntryKind::Symlink,
        _ => SftpEntryKind::Other,
    }
}

fn shell_entry_size(raw: &str) -> Option<u64> {
    raw.split_whitespace().nth(4)?.parse::<u64>().ok()
}

fn remote_child_path(parent: &str, name: &str) -> String {
    if parent == "/" {
        format!("/{name}")
    } else {
        format!("{}/{}", parent.trim_end_matches('/'), name)
    }
}

pub(super) fn sftp_host_label(host: &RemoteHost) -> String {
    if let Some(launch_id) = host.id.strip_prefix("external:") {
        return format!(
            "external:request_hash={}",
            crate::services::external_launch::redaction::opaque_id_hash(launch_id)
        );
    }
    format!(
        "{}@{}:{}",
        redacted_sftp_username(&host.username),
        host.host,
        host.port
    )
}

fn redacted_sftp_username(username: &str) -> String {
    if username
        .get(..5)
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case("b64>>"))
    {
        "b64>><redacted>".to_owned()
    } else {
        username.to_owned()
    }
}

fn finish_remote_directory_delete(exit_code: Option<i32>, stderr: &str) -> AppResult<()> {
    if exit_code == Some(0) {
        return Ok(());
    }

    let detail = stderr.trim();
    let exit_detail = exit_code
        .map(|code| format!("退出码 {code}"))
        .unwrap_or_else(|| "退出码未知".to_owned());
    if detail.is_empty() {
        Err(AppError::Sftp(format!(
            "远程目录递归删除失败: {exit_detail}"
        )))
    } else {
        Err(AppError::Sftp(format!(
            "远程目录递归删除失败: {exit_detail}: {detail}"
        )))
    }
}

pub(crate) fn validate_remote_directory_shell_delete_path(path: &str) -> AppResult<()> {
    if !path.starts_with('/') {
        return Err(AppError::InvalidInput(
            "目录递归删除需要使用绝对远程路径".to_owned(),
        ));
    }
    if path == "/" {
        return Err(AppError::InvalidInput(
            "不允许对远程根目录执行该操作".to_owned(),
        ));
    }
    if path.split('/').any(|segment| segment == "..") {
        return Err(AppError::InvalidInput(
            "目录递归删除路径不能包含 .. 路径段".to_owned(),
        ));
    }
    Ok(())
}

pub(crate) fn shell_single_quote(value: &str) -> String {
    if value.is_empty() {
        return "''".to_owned();
    }
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn push_limited_bytes(buffer: &mut Vec<u8>, bytes: &[u8], max_bytes: usize) {
    let remaining = max_bytes.saturating_sub(buffer.len());
    if remaining == 0 {
        return;
    }
    buffer.extend_from_slice(&bytes[..bytes.len().min(remaining)]);
}
