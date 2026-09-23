//! SSH 运行态工具目录。
//!
//! @author kongweiguang

use crate::{
    models::mcp_server::ToolCategory,
    services::mcp_tool_catalog_service::{ToolDescriptor, ToolId},
};

use super::super::schema::{
    enum_field, number_field, object_schema, string_field, tool, ToolEffect,
};

/// 生成 SSH 工具描述；非交互命令是外部 MCP 的默认后台路径，避免把一次命令
/// 隐式注入可见 Tab，同时保留内置右栏 Agent 显式 session-terminal 的兼容说明。
pub(super) fn remote_tools() -> Vec<ToolDescriptor> {
    vec![
        tool(
            ToolId::SshCommand,
            "执行远程命令",
            "外部 MCP 默认后台执行非交互 SSH 命令并返回结构化 stdout/stderr；结果不会显示在左侧终端。持久/交互任务请先用 terminal.create 创建 headless PTY，再用显式 sessionId 调用 terminal.snapshot/write/close；只有用户明确要求操作 UI Tab 时才确认可见目标。MCP host 仍可按自身策略处理调用，不需要 Kerminal 额外创建确认步骤。",
            ToolCategory::Ssh,
            ToolEffect::Remote,
            object_schema(vec![
                string_field("hostId", "远程主机 id。", true),
                string_field("command", "远程 shell 命令或脚本片段。", true),
                string_field(
                    "proxyUrl",
                    "本次远程命令临时代理，不写远端 profile。",
                    false,
                ),
                enum_field(
                    "proxyProtocol",
                    "proxyUrl 的协议；缺省时根据 URL 推断。",
                    false,
                    vec!["http", "socks5"],
                ),
                number_field("timeoutSeconds", "执行超时时间，单位秒。", false),
                number_field("maxOutputBytes", "stdout/stderr 最大保留字节数。", false),
            ]),
        ),
        tool(
            ToolId::SshCommandOnResolvedHost,
            "解析目标后执行远程命令",
            "外部 MCP 默认解析已保存 SSH 主机并后台执行非交互命令；结果不会显示在左侧终端。持久/交互任务请先用 terminal.create 创建 headless PTY，再用显式 sessionId 调用 terminal.snapshot/write/close；只有用户明确要求操作 UI Tab 时才确认可见目标。",
            ToolCategory::Ssh,
            ToolEffect::Remote,
            object_schema(vec![
                string_field("hostId", "可选远程主机 id；已知时优先传入。", false),
                string_field("groupId", "可选主机分组 id。", false),
                string_field("groupName", "可选主机分组名称。", false),
                string_field("name", "可选主机名称。", false),
                string_field("host", "可选主机名或 IP。", false),
                string_field("username", "可选 SSH 用户名。", false),
                number_field("port", "可选 SSH 端口。", false),
                string_field("command", "远程 shell 命令或脚本片段。", true),
                string_field(
                    "proxyUrl",
                    "本次远程命令临时代理，不写远端 profile。",
                    false,
                ),
                enum_field(
                    "proxyProtocol",
                    "proxyUrl 的协议；缺省时根据 URL 推断。",
                    false,
                    vec!["http", "socks5"],
                ),
                number_field("timeoutSeconds", "执行超时时间，单位秒。", false),
                number_field("maxOutputBytes", "stdout/stderr 最大保留字节数。", false),
            ]),
        ),
    ]
}
