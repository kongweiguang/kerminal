//! Agent session launcher key 兼容与校验。
//!
//! @author kongweiguang

use uuid::Uuid;

use crate::error::{AppError, AppResult};

use super::AgentId;

/// Codex 会话使用的稳定 launcher key。
pub const BUILTIN_CODEX_LAUNCHER_KEY: &str = "builtin:codex";
/// Claude 会话使用的稳定 launcher key。
pub const BUILTIN_CLAUDE_LAUNCHER_KEY: &str = "builtin:claude";
/// PI Agent 会话使用的稳定 launcher key。
pub const BUILTIN_PI_LAUNCHER_KEY: &str = "builtin:pi";

/// 规范化 launcher key，并保证 key 类型与 session 的 provider 一致。
///
/// 缺失值必须保持为 None，以兼容 schema v1 的既有 session；只有新调用方显式
/// 提供 key 时才要求内置常量或 `custom:<uuid>` 的稳定身份格式。
pub fn normalize_agent_launcher_key(
    agent_id: AgentId,
    launcher_key: Option<String>,
) -> AppResult<Option<String>> {
    let Some(launcher_key) = launcher_key else {
        return Ok(None);
    };
    let launcher_key = launcher_key.trim();
    let normalized = match agent_id {
        AgentId::Codex if launcher_key == BUILTIN_CODEX_LAUNCHER_KEY => launcher_key.to_owned(),
        AgentId::Claude if launcher_key == BUILTIN_CLAUDE_LAUNCHER_KEY => launcher_key.to_owned(),
        AgentId::Pi if launcher_key == BUILTIN_PI_LAUNCHER_KEY => launcher_key.to_owned(),
        AgentId::Custom => {
            let id = launcher_key
                .strip_prefix("custom:")
                .ok_or_else(|| {
                    AppError::InvalidInput(
                        "Custom Agent launcherKey 必须使用 custom:<uuid>".to_owned(),
                    )
                })?
                .trim();
            let id = Uuid::parse_str(id).map_err(|_| {
                AppError::InvalidInput("Custom Agent launcherKey 必须使用 custom:<uuid>".to_owned())
            })?;
            format!("custom:{id}")
        }
        _ => {
            return Err(AppError::InvalidInput(
                "Agent launcherKey 与 agentId 不匹配".to_owned(),
            ))
        }
    };
    Ok(Some(normalized))
}
