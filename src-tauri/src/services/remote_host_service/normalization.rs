//! 远程主机字段归一化与协议标签策略。
//!
//! @author kongweiguang

use std::collections::HashSet;

use crate::error::{AppError, AppResult};

use super::normalize_required_text;

pub(super) fn normalize_host(value: String) -> AppResult<String> {
    let host = normalize_required_text("主机地址", value)?;
    if host.chars().any(char::is_whitespace) {
        return Err(AppError::InvalidInput(
            "主机地址不能包含空白字符".to_owned(),
        ));
    }
    Ok(host)
}

pub(super) fn normalize_port(port: u16) -> AppResult<u16> {
    if port == 0 {
        return Err(AppError::InvalidInput("SSH 端口必须大于 0".to_owned()));
    }
    Ok(port)
}

pub(super) fn normalize_tags(tags: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut normalized = Vec::new();
    for tag in tags {
        let tag = tag.trim().to_owned();
        if !tag.is_empty() && seen.insert(tag.to_lowercase()) {
            normalized.push(tag);
        }
    }
    normalized
}
