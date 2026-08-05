//! 外部 Agent 可用的 Kerminal 工作台上下文模型。
//!
//! @author kongweiguang

use serde::{Deserialize, Serialize};

use crate::models::terminal::{TerminalOutputSnapshot, TerminalSessionSummary};

/// 外部 Agent 可感知的当前应用工作台上下文。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentApplicationContextRequest {
    /// 当前打开的右侧工具面板。
    #[serde(default)]
    pub active_tool_id: Option<String>,
    /// 当前 active tab。
    #[serde(default)]
    pub active_tab: Option<AgentApplicationTabContext>,
    /// 当前聚焦 pane。
    #[serde(default)]
    pub focused_pane: Option<AgentApplicationPaneContext>,
    /// 当前选中的主机。
    #[serde(default)]
    pub selected_machine: Option<AgentApplicationMachineContext>,
}

/// 当前应用 tab 摘要。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentApplicationTabContext {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub machine_id: Option<String>,
}

/// 当前应用 pane 摘要。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentApplicationPaneContext {
    pub id: String,
    pub title: String,
    pub mode: String,
    pub status: String,
    #[serde(default)]
    pub machine_id: Option<String>,
    #[serde(default)]
    pub session_id: Option<String>,
}

/// 当前应用主机摘要。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentApplicationMachineContext {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub status: String,
}

/// 请求当前终端上下文的参数。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentTerminalContextRequest {
    /// 当前 pane 绑定的 terminal session id。
    pub session_id: String,
    /// 前端工作台 pane id，用于审计和用户可见定位。
    pub pane_id: Option<String>,
    /// 当前 pane 标题。
    pub pane_title: Option<String>,
    /// 当前 tab id。
    pub tab_id: Option<String>,
    /// 当前 tab 标题。
    pub tab_title: Option<String>,
    /// 当前主机 id。
    pub machine_id: Option<String>,
    /// 当前主机名称。
    pub machine_name: Option<String>,
    /// 当前主机类型，例如 local 或 ssh。
    pub machine_kind: Option<String>,
    /// 最近输出最大字节数；为空时使用服务默认值。
    pub max_output_bytes: Option<usize>,
}

/// 终端上下文来源元数据。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentTerminalContextSource {
    /// 前端工作台 pane id。
    pub pane_id: Option<String>,
    /// 当前 pane 标题。
    pub pane_title: Option<String>,
    /// 当前 tab id。
    pub tab_id: Option<String>,
    /// 当前 tab 标题。
    pub tab_title: Option<String>,
    /// 当前主机 id。
    pub machine_id: Option<String>,
    /// 当前主机名称。
    pub machine_name: Option<String>,
    /// 当前主机类型。
    pub machine_kind: Option<String>,
}

/// 本次上下文采集策略快照。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentContextPolicySnapshot {
    /// 当前策略模式。
    pub mode: String,
    /// 是否包含最近终端输出。
    pub includes_recent_output: bool,
    /// 是否包含完整终端历史。
    pub includes_full_history: bool,
    /// 是否启用基础密钥脱敏。
    pub secret_redaction: bool,
    /// 最近输出最大字节数。
    pub max_output_bytes: usize,
}

/// 外部 Agent 可读取的当前终端上下文快照。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentTerminalContextSnapshot {
    /// 快照生成时间，Unix 秒字符串。
    pub generated_at: String,
    /// 当前 session 摘要。
    pub session: TerminalSessionSummary,
    /// 工作台来源信息。
    pub source: AgentTerminalContextSource,
    /// 最近终端输出。
    pub output: TerminalOutputSnapshot,
    /// 输出是否经过基础脱敏。
    pub redacted: bool,
    /// 本次上下文策略。
    pub policy: AgentContextPolicySnapshot,
}
