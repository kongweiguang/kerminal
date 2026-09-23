//! 终端运行态工具目录。
//!
//! @author kongweiguang

use crate::{
    models::mcp_server::ToolCategory,
    services::mcp_tool_catalog_service::{ToolDescriptor, ToolId},
};

use super::super::schema::{
    boolean_field, enum_field, number_field, object_schema, string_field, tool, tool_with_exposure,
    ToolEffect,
};

/// 生成基础运行态工具描述；外部 MCP 默认走后台路径，右栏 Agent 的 targetBinding
/// 仅作为内置 session-terminal 的兼容首选，因此描述必须同时标出两种调用边界。
pub(super) fn foundation_tools() -> Vec<ToolDescriptor> {
    vec![
        tool(
            ToolId::KerminalCapabilities,
            "读取 Kerminal MCP 能力指南",
            "返回外部 Agent 使用 Kerminal MCP 的结构化能力地图、global 终端 scope、外部 MCP 默认后台执行规则、内置 Agent 的 targetBinding 首选目标、文件型配置边界和故意不提供的 MCP CRUD/UI 编排工具族。",
            ToolCategory::Diagnostics,
            ToolEffect::Read,
            object_schema(vec![]),
        ),
        tool(
            ToolId::KerminalAppGuide,
            "读取 Kerminal 应用导航指南",
            "返回面向外部 Agent 的 Kerminal 产品结构地图：左栏主机、中间终端工作区、右栏工具、Agent 会话、global 终端 scope、外部 MCP 默认后台工具、内置 Agent 的 targetBinding 首选目标、文件型配置和对应 MCP 工具族；不执行 UI 编排。",
            ToolCategory::Diagnostics,
            ToolEffect::Read,
            object_schema(vec![]),
        ),
        tool(
            ToolId::KerminalConfigGuide,
            "读取 Kerminal 配置指南",
            "返回与工作空间 kerminal-config.md 同源的文件型配置规则正文、可编辑文件、受保护路径、验证入口和 secret 边界；只读，不做配置 CRUD。",
            ToolCategory::Diagnostics,
            ToolEffect::Read,
            object_schema(vec![]),
        ),
        tool(
            ToolId::KerminalToolHelp,
            "读取 Kerminal 工具帮助",
            "按 toolId、family 或 query 返回当前暴露 MCP tool 的 schema、示例参数和安全标注，并说明故意缺席的配置 CRUD/UI 编排/历史写入工具族；只读，不执行动作。",
            ToolCategory::Diagnostics,
            ToolEffect::Read,
            object_schema(vec![
                string_field("toolId", "精确 MCP tool id，例如 terminal.write。", false),
                enum_field(
                    "family",
                    "工具族过滤，可用于读取一组相关 tools。",
                    false,
                    vec![
                        "discovery",
                        "agent-session",
                        "terminal",
                        "ssh",
                        "sftp",
                        "tmux",
                        "container",
                        "port-forward",
                        "server-info",
                        "history",
                        "diagnostics",
                        "config",
                        "credentials",
                    ],
                ),
                string_field("query", "按工具 id、标题、描述或分类做大小写不敏感搜索。", false),
                boolean_field(
                    "includeSchemas",
                    "是否返回 inputSchema，默认 true；false 时只返回摘要、示例和安全标注。",
                    false,
                ),
            ]),
        ),
        tool(
            ToolId::KerminalOperationGuide,
            "读取 Kerminal 操作指南",
            "按任务意图返回外部 Agent 操作 Kerminal 的推荐 MCP 调用顺序，默认使用后台工具；持久/交互/local shell 才创建 headless PTY，并说明内置 Agent 的 targetBinding、显式 UI Tab 边界、文件优先配置和缺席工具；不读取 secrets，不执行动作。",
            ToolCategory::Diagnostics,
            ToolEffect::Read,
            object_schema(vec![
                enum_field(
                    "intent",
                    "操作意图，默认 overview。",
                    false,
                    vec![
                        "overview",
                        "terminal",
                        "session-terminal",
                        "ssh-command",
                        "sftp",
                        "tmux",
                        "container",
                        "port-forward",
                        "server-info",
                        "history",
                        "config",
                        "credentials",
                        "diagnostics",
                    ],
                ),
                string_field("goal", "用户目标的可选自然语言摘要；仅回显帮助 Agent 对齐上下文。", false),
            ]),
        ),
        tool(
            ToolId::KerminalRuntimeSnapshot,
            "读取 Kerminal 运行态快照",
            "返回当前 Kerminal 运行态摘要：终端、Agent session、targetBinding、端口转发、本机代理入口和 MCP 工具数量，并说明外部 MCP 默认后台、headless PTY 与显式 UI Tab 的执行路径；不读取 secrets，不提供文件型配置 CRUD。",
            ToolCategory::Diagnostics,
            ToolEffect::Read,
            object_schema(vec![]),
        ),
        tool(
            ToolId::TerminalCreate,
            "创建后台终端",
            "为持久、交互或 local shell 创建可操作的 headless PTY；target=local 支持本地 shell，target=ssh 使用已保存 SSH 主机的登录 shell，返回 sessionId 供 terminal.snapshot/write/resize/close 使用，不创建 UI pane 或 Tab。外部 MCP 必须沿用该显式 sessionId；内置右栏 Agent 的 session-terminal 才可按 targetBinding 解析现有用户终端。",
            ToolCategory::Terminal,
            ToolEffect::Write,
            object_schema(vec![
                enum_field(
                    "target",
                    "终端目标，local（默认）或 ssh。",
                    false,
                    vec!["local", "ssh"],
                ),
                string_field(
                    "hostId",
                    "已保存 SSH 主机 id；target=ssh 时必填，只引用保存凭据，不接收密码或私钥。",
                    false,
                ),
                string_field(
                    "cwd",
                    "可选工作目录；local 使用本机路径，ssh 使用远端路径。",
                    false,
                ),
                string_field(
                    "shell",
                    "可选 shell；仅 target=local 时生效，target=ssh 使用已保存主机的登录 shell。",
                    false,
                ),
                number_field("cols", "可选列数，默认 120。", false),
                number_field("rows", "可选行数，默认 30。", false),
                string_field(
                    "agentSessionId",
                    "可选 Agent session id，仅作为调用关联信息，不限制 global scope；省略时创建可供第三方 MCP 使用的全局 headless session。",
                    false,
                ),
            ]),
        ),
        tool(
            ToolId::TerminalWrite,
            "写入终端",
            "向既有终端写入原始输入。外部 MCP 仅在 terminal.create 返回的 headless sessionId 或用户明确指定并确认的 UI Tab sessionId 上使用；可见输入/输出不是默认路径。内置右栏 Agent/session-terminal 仍使用 global scope 和 targetBinding 首选目标，不额外创建 Kerminal 确认步骤。",
            ToolCategory::Terminal,
            ToolEffect::Write,
            object_schema(vec![
                string_field(
                    "sessionId",
                    "外部 MCP 使用 terminal.create 后必须传回的显式 session id，或用户明确指定并确认的 UI Tab session id；内置右栏 Agent 可省略并按 targetBinding 解析，Agent session 的 scope 为 global。",
                    false,
                ),
                string_field("agentSessionId", "Kerminal Agent session id；仅内置右栏 Agent/session-terminal 用于解析 targetBinding 和 global scope。", false),
                number_field(
                    "bindingGeneration",
                    "兼容旧调用的可选 generation；当前 targetBinding 或显式 sessionId 路径无需提供。",
                    false,
                ),
                string_field("data", "写入终端的原始输入。", true),
            ]),
        ),
        tool(
            ToolId::TerminalSnapshot,
            "读取终端快照",
            "读取指定 headless session 或用户明确指定的 UI Tab 的最近输出快照，用于写入前确认上下文；内置右栏 Agent/session-terminal 也可按 targetBinding 读取 global scope 成员。",
            ToolCategory::Terminal,
            ToolEffect::Read,
            object_schema(vec![
                string_field("sessionId", "外部 MCP 使用 terminal.create 返回的显式 session id，或用户明确确认的 UI Tab session id；内置 Agent 可省略。", false),
                string_field("agentSessionId", "Kerminal Agent session id；仅内置右栏 Agent/session-terminal 用于解析 targetBinding 和 global scope。", false),
                number_field("maxBytes", "最多读取的最近输出字节数，默认 24576。", false),
            ]),
        ),
        tool(
            ToolId::TerminalResolveAgentTarget,
            "解析 Agent 目标终端",
            "把内置右栏 Agent session id 解析为当前 targetBinding 首选终端，并返回 live/stale 状态；该解析不改变外部 MCP 的后台默认，也不限制 Agent global scope 中的其它终端。",
            ToolCategory::Terminal,
            ToolEffect::Read,
            object_schema(vec![string_field(
                "agentSessionId",
                "Kerminal Agent session id。",
                true,
            )]),
        ),
        tool(
            ToolId::KerminalAgentCurrentSession,
            "读取 Agent 会话",
            "读取当前 Kerminal Agent session 文件元数据、provider 和关键路径。",
            ToolCategory::Terminal,
            ToolEffect::Read,
            object_schema(vec![string_field(
                "agentSessionId",
                "Kerminal Agent session id。",
                true,
            )]),
        ),
        tool(
            ToolId::KerminalAgentTargetContext,
            "读取 Agent 目标上下文",
            "读取内置右栏 Agent 的 targetBinding 首选目标、global scope、live/stale 状态和最近终端输出快照；外部 MCP 默认不因该上下文切换到可见 Tab。",
            ToolCategory::Terminal,
            ToolEffect::Read,
            object_schema(vec![
                string_field("agentSessionId", "Kerminal Agent session id。", true),
                number_field("maxBytes", "最多读取的最近输出字节数，默认 24576。", false),
            ]),
        ),
        tool(
            ToolId::KerminalConfigValidate,
            "校验文件配置",
            "只读校验当前 Kerminal 文件型配置是否可被运行时代码加载；用于外部 Agent 编辑 settings/profiles/hosts/snippets/workflows 后验证，不做配置 CRUD，不读取 secrets。",
            ToolCategory::Diagnostics,
            ToolEffect::Read,
            object_schema(vec![enum_field(
                "scope",
                "校验范围，默认 all。",
                false,
                vec!["all", "settings", "profiles", "hosts", "snippets", "workflows"],
            )]),
        ),
        tool(
            ToolId::TerminalResize,
            "调整终端尺寸",
            "同步 rows/cols 到后端会话。",
            ToolCategory::Terminal,
            ToolEffect::Write,
            object_schema(vec![
                string_field("sessionId", "终端 session id。", true),
                string_field("agentSessionId", "Agent session id；提供时校验当前 scope。", false),
                number_field("cols", "目标列数。", true),
                number_field("rows", "目标行数。", true),
            ]),
        ),
        tool(
            ToolId::TerminalList,
            "列出终端会话",
            "读取当前运行时全部用户终端会话摘要；Agent endpoint 默认按 global scope 返回所有 Kerminal tabs 的用户终端及断开 pane 成员，targetBinding 仅标记内置 Agent 的首选目标。外部 MCP 可用该列表做后台会话查询、诊断和清理；列表可见不等于 UI 操作授权，只有用户明确要求操作某个 UI Tab 时才可选择对应 sessionId 写入。",
            ToolCategory::Terminal,
            ToolEffect::Read,
            object_schema(vec![string_field(
                "agentSessionId",
                "Agent session id；由 session-scoped endpoint 自动注入。",
                false,
            )]),
        ),
        tool(
            ToolId::TerminalReconnect,
            "重连终端 pane",
            "仅当首选或所选 pane 确实断开时，请求前端按 paneId 复用现有连接配置执行真实重连；不要求用户重新打开或切换 scope，也不在 Rust 猜测主机凭据。",
            ToolCategory::Terminal,
            ToolEffect::Write,
            object_schema(vec![
                string_field("paneId", "需要重连的终端 pane id。", true),
                string_field("agentSessionId", "Agent session id；提供时校验 pane 属于当前 scope。", false),
                number_field("timeoutMs", "等待前端确认的超时毫秒数，默认 30000，最大 60000。", false),
            ]),
        ),
        tool_with_exposure(
            ToolId::TerminalClose,
            "关闭终端会话",
            "关闭并移除指定本地终端会话；调用前确认由 MCP host 负责。",
            ToolCategory::Terminal,
            ToolEffect::Destructive,
            true,
            true,
            object_schema(vec![
                string_field("sessionId", "终端 session id。", true),
                string_field("agentSessionId", "Agent session id；提供时校验当前 scope。", false),
            ]),
        ),
        tool(
            ToolId::TerminalLogStart,
            "开始终端日志",
            "开始把指定终端 session 的新输出写入本地日志文件。",
            ToolCategory::Terminal,
            ToolEffect::Write,
            object_schema(vec![
                string_field("sessionId", "终端 session id。", true),
                string_field("agentSessionId", "Agent session id；提供时校验当前 scope。", false),
            ]),
        ),
        tool(
            ToolId::TerminalLogStop,
            "停止终端日志",
            "停止日志记录并返回路径摘要。",
            ToolCategory::Terminal,
            ToolEffect::Write,
            object_schema(vec![
                string_field("sessionId", "终端 session id。", true),
                string_field("agentSessionId", "Agent session id；提供时校验当前 scope。", false),
            ]),
        ),
        tool(
            ToolId::TerminalLogState,
            "读取终端日志状态",
            "读取指定终端 session 当前日志记录状态。",
            ToolCategory::Terminal,
            ToolEffect::Read,
            object_schema(vec![
                string_field("sessionId", "终端 session id。", true),
                string_field("agentSessionId", "Agent session id；提供时校验当前 scope。", false),
            ]),
        ),
    ]
}
