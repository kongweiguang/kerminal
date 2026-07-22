//! 外部 SFTP 目标的脱敏运行日志。
//!
//! @author kongweiguang

use super::{
    shell_helpers::sftp_host_label,
    {is_external_runtime_target_id, SftpEndpoint},
};

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
