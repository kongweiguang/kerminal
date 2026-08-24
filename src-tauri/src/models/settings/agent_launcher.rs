//! Agent Launcher 持久化设置与边界校验。
//!
//! @author kongweiguang

use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::{AppError, AppResult};

/// 最多持久化的自定义 Agent 数量，限制设置文件体积和下拉列表可用性。
pub const MAX_CUSTOM_AGENT_DEFINITIONS: usize = 32;
/// 自定义 Agent 名称最大字符数。
pub const MAX_CUSTOM_AGENT_NAME_CHARS: usize = 64;
/// 自定义 Agent 启动命令最大字符数。
pub const MAX_CUSTOM_AGENT_COMMAND_CHARS: usize = 4096;
/// 内置 Codex 的稳定 launcher key。
pub const BUILTIN_CODEX_LAUNCHER_KEY: &str = "builtin:codex";
/// 内置 Claude 的稳定 launcher key。
pub const BUILTIN_CLAUDE_LAUNCHER_KEY: &str = "builtin:claude";
/// 内置 PI Agent 的稳定 launcher key。
pub const BUILTIN_PI_LAUNCHER_KEY: &str = "builtin:pi";

/// 可由用户保存并重复启动的自定义 Agent 定义。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CustomAgentDefinition {
    /// 稳定 UUID；展示名称或命令变化时仍用于区分历史会话。
    pub id: String,
    /// 下拉列表与 Agent 终端使用的用户可见名称。
    pub name: String,
    /// 通过现有 shell 包装执行的明文启动命令。
    pub command: String,
}

impl CustomAgentDefinition {
    /// 规范化并校验单个定义，避免同一个 UUID 因大小写或空白产生多个身份。
    fn validated(mut self) -> AppResult<Self> {
        let id = Uuid::parse_str(self.id.trim())
            .map_err(|_| AppError::InvalidInput("自定义 Agent id 必须是有效 UUID".to_owned()))?;
        self.id = id.to_string();
        self.name = self.name.trim().to_owned();
        self.command = self.command.trim().to_owned();

        if self.name.is_empty() {
            return Err(AppError::InvalidInput(
                "自定义 Agent 名称不能为空".to_owned(),
            ));
        }
        if self.name.chars().count() > MAX_CUSTOM_AGENT_NAME_CHARS {
            return Err(AppError::InvalidInput(format!(
                "自定义 Agent 名称不能超过 {MAX_CUSTOM_AGENT_NAME_CHARS} 个字符"
            )));
        }
        if self.command.is_empty() {
            return Err(AppError::InvalidInput(
                "自定义 Agent 启动命令不能为空".to_owned(),
            ));
        }
        if self.command.chars().count() > MAX_CUSTOM_AGENT_COMMAND_CHARS {
            return Err(AppError::InvalidInput(format!(
                "自定义 Agent 启动命令不能超过 {MAX_CUSTOM_AGENT_COMMAND_CHARS} 个字符"
            )));
        }
        Ok(self)
    }
}

/// Agent 助手选择器的全局持久化设置。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentLauncherSettings {
    /// 上次选择的内置或自定义 Agent 稳定 key。
    #[serde(default = "default_agent_launcher_selected_key")]
    pub selected_agent_key: String,
    /// 按添加顺序展示的自定义 Agent 定义。
    #[serde(default)]
    pub custom_agents: Vec<CustomAgentDefinition>,
}

impl Default for AgentLauncherSettings {
    fn default() -> Self {
        Self {
            selected_agent_key: BUILTIN_CODEX_LAUNCHER_KEY.to_owned(),
            custom_agents: Vec::new(),
        }
    }
}

/// 为旧 settings.toml 或仅包含 customAgents 的局部设置提供稳定默认选择。
fn default_agent_launcher_selected_key() -> String {
    BUILTIN_CODEX_LAUNCHER_KEY.to_owned()
}

impl AgentLauncherSettings {
    /// 原子校验选择项与定义集合，防止落盘的 selected key 指向已删除的自定义 Agent。
    pub(super) fn validated(mut self) -> AppResult<Self> {
        if self.custom_agents.len() > MAX_CUSTOM_AGENT_DEFINITIONS {
            return Err(AppError::InvalidInput(format!(
                "最多保存 {MAX_CUSTOM_AGENT_DEFINITIONS} 个自定义 Agent"
            )));
        }

        let mut ids = BTreeSet::new();
        let mut normalized_names = BTreeSet::new();
        let mut custom_agents = Vec::with_capacity(self.custom_agents.len());
        for definition in self.custom_agents {
            let definition = definition.validated()?;
            if !ids.insert(definition.id.clone()) {
                return Err(AppError::InvalidInput(
                    "自定义 Agent id 不能重复".to_owned(),
                ));
            }
            if !normalized_names.insert(definition.name.to_lowercase()) {
                return Err(AppError::InvalidInput(
                    "自定义 Agent 名称不能重复（忽略大小写）".to_owned(),
                ));
            }
            custom_agents.push(definition);
        }

        self.selected_agent_key = normalize_selected_agent_key(&self.selected_agent_key, &ids)?;
        self.custom_agents = custom_agents;
        Ok(self)
    }
}

/// 将 selected key 收敛为稳定格式，并拒绝指向不存在定义的悬空引用。
fn normalize_selected_agent_key(value: &str, custom_ids: &BTreeSet<String>) -> AppResult<String> {
    let value = value.trim();
    if matches!(
        value,
        BUILTIN_CODEX_LAUNCHER_KEY | BUILTIN_CLAUDE_LAUNCHER_KEY | BUILTIN_PI_LAUNCHER_KEY
    ) {
        return Ok(value.to_owned());
    }
    let Some(id) = value.strip_prefix("custom:") else {
        return Err(AppError::InvalidInput("Agent 选择 key 不受支持".to_owned()));
    };
    let id = Uuid::parse_str(id.trim())
        .map_err(|_| AppError::InvalidInput("自定义 Agent 选择 key 不合法".to_owned()))?
        .to_string();
    if !custom_ids.contains(&id) {
        return Err(AppError::InvalidInput(
            "选中的自定义 Agent 不存在".to_owned(),
        ));
    }
    Ok(format!("custom:{id}"))
}
