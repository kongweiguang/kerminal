//! MCP tool schema examples shared by discovery and operation guide tools.
//!
//! @author kongweiguang

use super::*;

/// 为工具发现和操作指南生成不执行副作用的参数样例。
///
/// 这里按公开字符串先处理可选的运行态工具，避免指南代码在 catalog 增加
/// `terminal.reconnect` 等工具时复制一套业务分支；具体 schema 仍由 catalog
/// 返回，样例表达 global scope 下 targetBinding 首选、显式 sessionId 选其它
/// 终端以及 paneId 重连的最小调用边界。SFTP 队列样例固定使用 canonical
/// source/destination，避免 Agent 从示例推断内部 legacy flat 参数。
pub(super) fn example_arguments_for(tool_id: ToolId) -> Option<Value> {
    match tool_id {
        ToolId::KerminalCapabilities | ToolId::KerminalRuntimeSnapshot | ToolId::TerminalList => {
            Some(json!({}))
        }
        ToolId::KerminalOperationGuide => Some(json!({
            "intent": "session-terminal",
            "goal": "Operate the current targetBinding visibly; use another global terminal only when the task needs it, create a headless PTY when no PTY is available, and use background SSH only when structured output is explicitly requested."
        })),
        ToolId::KerminalToolHelp => Some(json!({
            "toolId": "terminal.write",
            "includeSchemas": true
        })),
        ToolId::KerminalAgentCurrentSession => Some(json!({
            "agentSessionId": "<agent-session-id-from-context/mcp-endpoint.json>"
        })),
        ToolId::KerminalAgentTargetContext => Some(json!({
            "agentSessionId": "<agent-session-id-from-context/mcp-endpoint.json>",
            "maxBytes": 24576
        })),
        ToolId::TerminalResolveAgentTarget => Some(json!({
            "agentSessionId": "<agent-session-id-from-context/mcp-endpoint.json>"
        })),
        ToolId::TerminalCreate => Some(json!({
            "target": "local",
            "cwd": "C:/work",
            "cols": 120,
            "rows": 30
        })),
        ToolId::TerminalSnapshot => Some(json!({
            "sessionId": "<scope-member-terminal-session-id>",
            "agentSessionId": "<agent-session-id-from-context/mcp-endpoint.json>",
            "maxBytes": 24576
        })),
        ToolId::TerminalWrite => Some(json!({
            "sessionId": "<scope-member-terminal-session-id>",
            "agentSessionId": "<agent-session-id-from-context/mcp-endpoint.json>",
            "data": "pwd\n"
        })),
        ToolId::TerminalReconnect => Some(json!({
            "paneId": "<disconnected-pane-id>",
            "agentSessionId": "<agent-session-id-from-context/mcp-endpoint.json>",
            "timeoutMs": 30000
        })),
        ToolId::TerminalResize => Some(json!({
            "sessionId": "<terminal-session-id>",
            "cols": 120,
            "rows": 32
        })),
        ToolId::TerminalClose
        | ToolId::TerminalLogStart
        | ToolId::TerminalLogStop
        | ToolId::TerminalLogState => Some(json!({
            "sessionId": "<terminal-session-id>"
        })),
        ToolId::SshCommandOnResolvedHost => Some(json!({
            "hostId": "<host-id-from-hosts-toml-or-bound-target>",
            "command": "uname -a"
        })),
        ToolId::SshCommand => Some(json!({
            "hostId": "<host-id>",
            "command": "uptime"
        })),
        ToolId::SftpList | ToolId::SftpPreview => Some(json!({
            "hostId": "<host-id>",
            "path": "/srv/app"
        })),
        ToolId::SftpCreateDirectory => Some(json!({
            "hostId": "<host-id>",
            "path": "/srv/app/new-directory"
        })),
        ToolId::SftpRename => Some(json!({
            "hostId": "<host-id>",
            "fromPath": "/srv/app/old-name.txt",
            "toPath": "/srv/app/new-name.txt"
        })),
        ToolId::SftpMove => Some(json!({
            "hostId": "<host-id>",
            "fromPath": "/srv/app/source.txt",
            "toPath": "/srv/app/archive/source.txt"
        })),
        ToolId::SftpChmod => Some(json!({
            "hostId": "<host-id>",
            "path": "/srv/app/script.sh",
            "mode": "0755"
        })),
        ToolId::SftpDelete => Some(json!({
            "hostId": "<host-id>",
            "path": "/srv/app/obsolete.txt",
            "directory": false
        })),
        ToolId::SftpTransferEnqueue => Some(json!({
            "source": {
                "type": "remote",
                "hostId": "<source-host-id>",
                "path": "/srv/app/reports"
            },
            "destination": {
                "type": "remote",
                "hostId": "<destination-host-id>",
                "path": "/backup/reports"
            },
            "kind": "directory",
            "conflictPolicy": "rename"
        })),
        ToolId::SftpTransferCancel => Some(json!({
            "transferId": "<transfer-id-from-sftp.transfer.enqueue>"
        })),
        ToolId::SftpTransferList => Some(json!({
            "transferId": "<transfer-id-from-sftp.transfer.enqueue>"
        })),
        ToolId::SftpTransferClearCompleted => Some(json!({})),
        ToolId::TmuxProbe | ToolId::TmuxListSessions => Some(json!({
            "targetKind": "ssh",
            "hostId": "<host-id>"
        })),
        ToolId::TmuxCreateSession => Some(json!({
            "targetKind": "ssh",
            "hostId": "<host-id>",
            "name": "work"
        })),
        ToolId::TmuxRenameSession => Some(json!({
            "targetKind": "ssh",
            "hostId": "<host-id>",
            "sessionId": "old-name",
            "name": "new-name"
        })),
        ToolId::TmuxKillSession | ToolId::TmuxListWindows | ToolId::TmuxAttachPlan => Some(json!({
            "targetKind": "ssh",
            "hostId": "<host-id>",
            "sessionId": "work"
        })),
        ToolId::TmuxListPanes => Some(json!({
            "targetKind": "ssh",
            "hostId": "<host-id>",
            "targetId": "work:0"
        })),
        ToolId::TmuxCapturePane => Some(json!({
            "targetKind": "ssh",
            "hostId": "<host-id>",
            "paneId": "%1",
            "lines": 200
        })),
        ToolId::ContainerList => Some(json!({
            "hostId": "<host-id>",
            "runtime": "docker",
            "includeStopped": false
        })),
        ToolId::ContainerInspect | ToolId::ContainerStats => Some(json!({
            "hostId": "<host-id>",
            "containerId": "<container-id-or-name>",
            "runtime": "docker"
        })),
        ToolId::ContainerLogsTail => Some(json!({
            "hostId": "<host-id>",
            "containerId": "<container-id-or-name>",
            "runtime": "docker",
            "tail": 120
        })),
        ToolId::ContainerStart | ToolId::ContainerStop | ToolId::ContainerRestart => Some(json!({
            "hostId": "<host-id>",
            "containerId": "<container-id-or-name>",
            "runtime": "docker"
        })),
        ToolId::ContainerRemove => Some(json!({
            "hostId": "<host-id>",
            "containerId": "<container-id-or-name>",
            "runtime": "docker",
            "force": false
        })),
        ToolId::ContainerFilesList | ToolId::ContainerFilesPreview => Some(json!({
            "hostId": "<host-id>",
            "containerId": "<container-id-or-name>",
            "runtime": "docker",
            "path": "/app"
        })),
        ToolId::ContainerFilesWriteText => Some(json!({
            "hostId": "<host-id>",
            "containerId": "<container-id-or-name>",
            "runtime": "docker",
            "path": "/app/config.local",
            "content": "KEY=value\n",
            "encoding": "utf-8",
            "create": true,
            "overwriteOnConflict": false
        })),
        ToolId::ContainerFilesCreateDirectory => Some(json!({
            "hostId": "<host-id>",
            "containerId": "<container-id-or-name>",
            "runtime": "docker",
            "path": "/app/new-directory"
        })),
        ToolId::ContainerFilesRename => Some(json!({
            "hostId": "<host-id>",
            "containerId": "<container-id-or-name>",
            "runtime": "docker",
            "fromPath": "/app/old-name.txt",
            "toPath": "/app/new-name.txt"
        })),
        ToolId::ContainerFilesChmod => Some(json!({
            "hostId": "<host-id>",
            "containerId": "<container-id-or-name>",
            "runtime": "docker",
            "path": "/app/script.sh",
            "mode": "0755"
        })),
        ToolId::ContainerFilesUpload | ToolId::ContainerFilesDownload => Some(json!({
            "hostId": "<host-id>",
            "containerId": "<container-id-or-name>",
            "runtime": "docker",
            "localPath": "C:/path/to/local/file-or-directory",
            "remotePath": "/app/file-or-directory",
            "kind": "file"
        })),
        ToolId::ContainerFilesDelete => Some(json!({
            "hostId": "<host-id>",
            "containerId": "<container-id-or-name>",
            "runtime": "docker",
            "path": "/app/obsolete.txt",
            "directory": false
        })),
        ToolId::PortForwardList => Some(json!({})),
        ToolId::PortForwardCreate => Some(json!({
            "hostId": "<host-id>",
            "kind": "local",
            "bindHost": "127.0.0.1",
            "sourcePort": 15432,
            "targetHost": "127.0.0.1",
            "targetPort": 5432
        })),
        ToolId::PortForwardClose => Some(json!({
            "forwardId": "<port-forward-id-from-port_forward.list>"
        })),
        ToolId::ServerInfoSnapshot => Some(json!({
            "hostId": "<host-id>"
        })),
        ToolId::HistorySearch => Some(json!({
            "query": "docker compose",
            "limit": 20
        })),
        ToolId::KerminalAppGuide
        | ToolId::KerminalConfigGuide
        | ToolId::DiagnosticsRuntimeHealth
        | ToolId::DiagnosticsCreateBundle => Some(json!({})),
        ToolId::KerminalConfigValidate => Some(json!({
            "scope": "all"
        })),
        ToolId::KerminalHostUpsertWithCredential => Some(json!({
            "id": "<optional-host-id>",
            "name": "staging-web",
            "host": "staging.example.internal",
            "port": 22,
            "username": "deploy",
            "password": "<credential-provided-by-user-for-this-save-only>"
        })),
        ToolId::KerminalVaultEncryptSecret => Some(json!({
            "kind": "ssh-host",
            "hostId": "<host-id>",
            "scope": "target",
            "material": "password",
            "plaintext": "<credential-provided-by-user-for-this-save-only>"
        })),
    }
}
