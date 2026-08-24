//! 外部 Agent provider 标识。
//!
//! @author kongweiguang

use serde::{Deserialize, Serialize};

/// PI 新会话的原生启动命令；`--approve` 允许读取 session-local 配置文件。
pub const PI_AGENT_LAUNCH_COMMAND: &str = "pi --approve --mcp-config .mcp.json";
/// PI 恢复命令沿用相同 MCP 配置并继续当前 cwd 的最近会话。
pub const PI_AGENT_RESUME_COMMAND: &str = "pi --approve --mcp-config .mcp.json --continue";

/// 外部 Agent 类型。
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AgentId {
    /// OpenAI Codex CLI。
    Codex,
    /// Claude Code CLI。
    Claude,
    /// PI coding agent CLI。
    Pi,
    /// 用户自定义命令。
    Custom,
}
