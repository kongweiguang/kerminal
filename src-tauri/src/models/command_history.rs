//! 命令历史 IPC 数据模型。
//!
//! @author kongweiguang

use serde::{Deserialize, Serialize};

/// 命令历史目标类型。
#[derive(Debug, Clone, Copy, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum CommandHistoryTarget {
    /// 本地终端命令。
    #[default]
    Local,
    /// SSH 远程终端或远程命令。
    Ssh,
    /// Telnet 远程终端命令。
    Telnet,
    /// Serial 串口终端命令。
    Serial,
    /// SSH 宿主上的 Docker/Podman 容器终端命令。
    DockerContainer,
}

impl CommandHistoryTarget {
    /// 返回数据库中保存的稳定文本。
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Local => "local",
            Self::Ssh => "ssh",
            Self::Telnet => "telnet",
            Self::Serial => "serial",
            Self::DockerContainer => "dockerContainer",
        }
    }
}

impl TryFrom<&str> for CommandHistoryTarget {
    type Error = String;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        match value {
            "local" => Ok(Self::Local),
            "ssh" => Ok(Self::Ssh),
            "telnet" => Ok(Self::Telnet),
            "serial" => Ok(Self::Serial),
            "dockerContainer" => Ok(Self::DockerContainer),
            _ => Err(format!("未知命令历史目标类型: {value}")),
        }
    }
}

/// 命令历史来源。
#[derive(Debug, Clone, Copy, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum CommandHistorySource {
    /// 用户直接在终端里输入。
    #[default]
    User,
    /// 脚本片段触发。
    Snippet,
    /// 多步命令工作流触发。
    Workflow,
    /// 批量发送到多个 pane。
    Broadcast,
    /// 应用内部工具或命令面板触发。
    Tool,
}

impl CommandHistorySource {
    /// 返回数据库中保存的稳定文本。
    pub fn as_str(self) -> &'static str {
        match self {
            Self::User => "user",
            Self::Snippet => "snippet",
            Self::Workflow => "workflow",
            Self::Broadcast => "broadcast",
            Self::Tool => "tool",
        }
    }
}

impl TryFrom<&str> for CommandHistorySource {
    type Error = String;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        match value {
            "user" => Ok(Self::User),
            "snippet" => Ok(Self::Snippet),
            "workflow" => Ok(Self::Workflow),
            "broadcast" => Ok(Self::Broadcast),
            "tool" => Ok(Self::Tool),
            _ => Err(format!("未知命令历史来源: {value}")),
        }
    }
}

/// 一条命令历史记录。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommandHistoryEntry {
    /// 稳定历史 id。
    pub id: String,
    /// 规范化后的命令内容。
    pub command: String,
    /// 命令来源。
    pub source: CommandHistorySource,
    /// 命令目标。
    pub target: CommandHistoryTarget,
    /// 终端 session id。
    pub session_id: Option<String>,
    /// 前端 pane id。
    pub pane_id: Option<String>,
    /// 前端 tab id。
    pub tab_id: Option<String>,
    /// 本地 profile id。
    pub profile_id: Option<String>,
    /// SSH 主机 id。
    pub remote_host_id: Option<String>,
    /// 命令执行时的工作目录。
    pub cwd: Option<String>,
    /// 命令执行时的 shell。
    pub shell: Option<String>,
    /// 记录时间。
    pub created_at: String,
}

/// 命令历史列表过滤请求。
#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommandHistoryListRequest {
    /// 搜索关键词，会匹配命令、路径、shell 和目标 id。
    pub query: Option<String>,
    /// 来源过滤。
    pub source: Option<CommandHistorySource>,
    /// 目标过滤。
    pub target: Option<CommandHistoryTarget>,
    /// 前端 pane id 过滤。
    pub pane_id: Option<String>,
    /// SSH 主机过滤。
    pub remote_host_id: Option<String>,
    /// 终端 session 过滤。
    pub session_id: Option<String>,
    /// 返回数量上限。
    pub limit: Option<usize>,
}

/// 命令历史清理范围；所有字段为空时保留清空全部历史的兼容语义。
#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommandHistoryClearRequest {
    /// 目标类型过滤。
    pub target: Option<CommandHistoryTarget>,
    /// 前端 pane id 过滤。
    pub pane_id: Option<String>,
    /// SSH 主机过滤。
    pub remote_host_id: Option<String>,
    /// 终端 session 过滤。
    pub session_id: Option<String>,
}

/// 记录命令历史请求。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommandHistoryRecordRequest {
    /// 命令内容。
    pub command: String,
    /// 命令来源。
    #[serde(default)]
    pub source: CommandHistorySource,
    /// 命令目标。
    #[serde(default)]
    pub target: CommandHistoryTarget,
    /// 当前会话是否允许记录历史；为 false 时直接跳过。
    pub record: Option<bool>,
    /// 终端 session id。
    pub session_id: Option<String>,
    /// 前端 pane id。
    pub pane_id: Option<String>,
    /// 前端 tab id。
    pub tab_id: Option<String>,
    /// 本地 profile id。
    pub profile_id: Option<String>,
    /// SSH 主机 id。
    pub remote_host_id: Option<String>,
    /// 命令执行时的工作目录。
    pub cwd: Option<String>,
    /// 命令执行时的 shell。
    pub shell: Option<String>,
}

/// 记录命令历史的结果。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommandHistoryRecordResult {
    /// 是否真正写入 SQLite。
    pub recorded: bool,
    /// 写入后的历史记录。
    pub entry: Option<CommandHistoryEntry>,
    /// 跳过原因。
    pub skip_reason: Option<String>,
}
