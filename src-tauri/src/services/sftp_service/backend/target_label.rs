//! SFTP 目标的脱敏诊断标签。
//!
//! @author kongweiguang

use crate::models::remote_host::RemoteHost;

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
