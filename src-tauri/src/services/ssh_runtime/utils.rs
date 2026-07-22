//! Managed SSH runtime internal helpers.
//!
//! @author kongweiguang

use std::time::{SystemTime, UNIX_EPOCH};

use crate::error::AppError;

pub(super) fn missing_session_error(session_id: &str) -> AppError {
    AppError::SshCommand(format!("managed SSH session not found: {session_id}"))
}

pub(super) fn unix_timestamp() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_owned())
}

pub(super) fn truncate_diagnostic_text(value: String, max_chars: usize) -> String {
    if value.chars().count() <= max_chars {
        return value;
    }
    let mut truncated = value
        .chars()
        .take(max_chars.saturating_sub(1))
        .collect::<String>();
    truncated.push('…');
    truncated
}
