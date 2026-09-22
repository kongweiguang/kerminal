//! SFTP 与端口转发工具目录。
//!
//! @author kongweiguang

use crate::{
    models::mcp_server::ToolCategory,
    services::mcp_tool_catalog_service::{ToolDescriptor, ToolId},
};

use serde_json::json;

use super::super::schema::{
    boolean_field, enum_field, number_field, object_schema, string_field, tool, tool_with_exposure,
    ToolEffect,
};

pub(super) fn sftp_tools() -> Vec<ToolDescriptor> {
    vec![
        tool(
            ToolId::SftpList,
            "列出远程目录",
            "读取当前 SSH 主机上的远程目录内容。",
            ToolCategory::Sftp,
            ToolEffect::Remote,
            object_schema(vec![
                string_field("hostId", "远程主机 id。", true),
                string_field("path", "远程目录路径。", true),
            ]),
        ),
        tool(
            ToolId::SftpRename,
            "重命名远程路径",
            "重命名远程文件或目录；调用前确认由 MCP host 负责。",
            ToolCategory::Sftp,
            ToolEffect::Remote,
            object_schema(vec![
                string_field("hostId", "远程主机 id。", true),
                string_field("fromPath", "原远程路径。", true),
                string_field("toPath", "新远程路径。", true),
            ]),
        ),
        tool(
            ToolId::SftpMove,
            "移动远程路径",
            "移动远程文件或目录；调用前确认由 MCP host 负责。",
            ToolCategory::Sftp,
            ToolEffect::Remote,
            object_schema(vec![
                string_field("hostId", "远程主机 id。", true),
                string_field("fromPath", "原远程路径。", true),
                string_field("toPath", "目标远程路径。", true),
            ]),
        ),
        tool(
            ToolId::SftpPreview,
            "预览远程文件",
            "读取远程文本文件预览。",
            ToolCategory::Sftp,
            ToolEffect::Remote,
            object_schema(vec![
                string_field("hostId", "远程主机 id。", true),
                string_field("path", "远程文件路径。", true),
                number_field("maxBytes", "最多读取字节数。", false),
            ]),
        ),
        tool_with_exposure(
            ToolId::SftpDelete,
            "删除远程文件",
            "删除远程文件或空目录；调用前确认由 MCP host 负责。",
            ToolCategory::Sftp,
            ToolEffect::Destructive,
            true,
            true,
            object_schema(vec![
                string_field("hostId", "远程主机 id。", true),
                string_field("path", "远程路径。", true),
                boolean_field("directory", "是否按空目录删除。", false),
            ]),
        ),
        tool(
            ToolId::SftpCreateDirectory,
            "创建远程目录",
            "创建远程目录；调用前确认由 MCP host 负责。",
            ToolCategory::Sftp,
            ToolEffect::Remote,
            object_schema(vec![
                string_field("hostId", "远程主机 id。", true),
                string_field("path", "远程目录路径。", true),
            ]),
        ),
        tool(
            ToolId::SftpChmod,
            "修改远程权限",
            "修改远程路径权限；调用前确认由 MCP host 负责。",
            ToolCategory::Sftp,
            ToolEffect::Remote,
            object_schema(vec![
                string_field("hostId", "远程主机 id。", true),
                string_field("path", "远程路径。", true),
                string_field("mode", "八进制权限模式，例如 644 或 0755。", true),
            ]),
        ),
        tool(
            ToolId::SftpTransferEnqueue,
            "创建 SFTP 传输任务",
            "按 source -> destination 加入 SFTP 队列；支持本机与远程主机之间，以及远程主机之间的文件或目录复制。",
            ToolCategory::Sftp,
            ToolEffect::Remote,
            sftp_transfer_enqueue_schema(),
        ),
        tool(
            ToolId::SftpTransferList,
            "列出 SFTP 传输任务",
            "读取 SFTP 队列、状态和进度；可按 transferId 精确查询。",
            ToolCategory::Sftp,
            ToolEffect::Read,
            object_schema(vec![string_field(
                "transferId",
                "可选的 SFTP 传输任务 id；不传则返回全部任务。",
                false,
            )]),
        ),
        tool(
            ToolId::SftpTransferCancel,
            "取消 SFTP 传输任务",
            "取消指定传输任务；调用前确认由 MCP host 负责。",
            ToolCategory::Sftp,
            ToolEffect::Remote,
            object_schema(vec![string_field("transferId", "SFTP 传输任务 id。", true)]),
        ),
        tool(
            ToolId::SftpTransferClearCompleted,
            "清理已结束 SFTP 任务",
            "清理成功、失败或取消的任务。",
            ToolCategory::Sftp,
            ToolEffect::Write,
            object_schema(vec![]),
        ),
        tool(
            ToolId::ServerInfoSnapshot,
            "读取服务器信息",
            "读取 SSH 主机 CPU、内存、磁盘、网络和运行时间摘要。",
            ToolCategory::ServerInfo,
            ToolEffect::Remote,
            object_schema(vec![string_field("hostId", "远程主机 id。", true)]),
        ),
        tool(
            ToolId::PortForwardCreate,
            "创建端口转发",
            "创建 SSH 端口转发，包括本机和远端 SOCKS 转发。",
            ToolCategory::PortForward,
            ToolEffect::Remote,
            object_schema(vec![
                string_field("hostId", "远程主机 id。", true),
                string_field("name", "用户可见转发名称。", false),
                enum_field(
                    "kind",
                    "转发类型。",
                    true,
                    vec!["local", "remote", "remoteDynamic", "dynamic"],
                ),
                enum_field(
                    "proxyProtocol",
                    "SOCKS 转发代理协议。",
                    false,
                    vec!["socks5"],
                ),
                string_field("bindHost", "监听地址，默认 127.0.0.1。", false),
                string_field("localBindHost", "本机侧监听地址或本机代理绑定地址。", false),
                string_field("remoteBindHost", "远端监听地址。", false),
                number_field("sourcePort", "监听端口；remote 时为远端端口。", true),
                string_field("targetHost", "目标主机；dynamic 转发可为空。", false),
                number_field("targetPort", "目标端口；dynamic 转发可为空。", false),
                enum_field(
                    "remoteAccessScope",
                    "远端监听范围；非 loopback 需 GatewayPorts。",
                    false,
                    vec!["loopback", "privateNetwork", "allInterfaces", "custom"],
                ),
                enum_field(
                    "proxyApplyScope",
                    "代理应用范围；MCP 默认不写远端 profile。",
                    false,
                    vec![
                        "none",
                        "currentTerminal",
                        "futureTerminals",
                        "userProfile",
                        "toolOnly",
                    ],
                ),
            ]),
        ),
        tool(
            ToolId::PortForwardList,
            "列出端口转发",
            "读取端口转发配置和状态。",
            ToolCategory::PortForward,
            ToolEffect::Read,
            object_schema(vec![]),
        ),
        tool(
            ToolId::PortForwardClose,
            "停止端口转发",
            "停止转发会话并保留配置；调用前确认由 MCP host 负责。",
            ToolCategory::PortForward,
            ToolEffect::Remote,
            object_schema(vec![string_field("forwardId", "端口转发会话 id。", true)]),
        ),
    ]
}

/// 构造统一传输工具的公开 schema；allOf 保留 canonical 必填约束，同时让执行器能接收旧 flat 参数。
///
/// 执行器的通用必填检查只读取顶层 `required`；将约束放进 allOf 不会把旧参数暴露到公开 schema，
/// 也能让旧 flat 请求继续进入兼容解析器，而不是在 MCP 入口处被提前拦截。
fn sftp_transfer_enqueue_schema() -> serde_json::Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "allOf": [{
            "required": ["source", "destination", "kind", "conflictPolicy"]
        }],
        "properties": {
            "source": sftp_transfer_endpoint_schema("源端点"),
            "destination": sftp_transfer_endpoint_schema("目标端点"),
            "kind": {
                "type": "string",
                "description": "传输对象类型。",
                "enum": ["file", "directory"]
            },
            "conflictPolicy": {
                "type": "string",
                "description": "目标已存在时的处理方式。",
                "enum": ["overwrite", "skip", "rename"]
            },
            "idleTimeoutSeconds": {
                "type": "number",
                "description": "可选的连续无字节进度保护秒数；30-3600，未传时使用全局设置。不会限制传输总时长。",
                "minimum": 30,
                "maximum": 3600
            }
        }
    })
}

/// 构造 endpoint 的 oneOf schema，避免 public MCP schema 暴露内部 direction/hostId flat 契约。
fn sftp_transfer_endpoint_schema(description: &str) -> serde_json::Value {
    json!({
        "description": description,
        "oneOf": [
            {
                "type": "object",
                "additionalProperties": false,
                "required": ["type", "path"],
                "properties": {
                    "type": { "const": "local", "description": "运行 Kerminal 的本机。" },
                    "path": { "type": "string", "description": "本机文件或目录路径。" }
                }
            },
            {
                "type": "object",
                "additionalProperties": false,
                "required": ["type", "hostId", "path"],
                "properties": {
                    "type": { "const": "remote", "description": "保存的 SSH/SFTP 主机。" },
                    "hostId": { "type": "string", "description": "保存的远程主机 id。" },
                    "path": { "type": "string", "description": "远程文件或目录路径。" }
                }
            }
        ]
    })
}
