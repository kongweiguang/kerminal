//! MCP tool schema examples shared by discovery and operation guide tools.
//!
//! @author kongweiguang

use super::*;

pub(super) fn example_arguments_for(tool_id: ToolId) -> Option<Value> {
    match tool_id {
        ToolId::KerminalCapabilities | ToolId::KerminalRuntimeSnapshot | ToolId::TerminalList => {
            Some(json!({}))
        }
        ToolId::KerminalOperationGuide => Some(json!({
            "intent": "session-terminal",
            "goal": "Inspect and operate the currently bound Kerminal target safely."
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
        ToolId::TerminalSnapshot => Some(json!({
            "agentSessionId": "<agent-session-id>",
            "maxBytes": 24576
        })),
        ToolId::TerminalWrite => Some(json!({
            "agentSessionId": "<agent-session-id>",
            "bindingGeneration": 7,
            "data": "pwd\n"
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
        ToolId::SftpUpload | ToolId::SftpUploadDirectory => Some(json!({
            "hostId": "<host-id>",
            "localPath": "C:/path/to/local/file-or-directory",
            "remotePath": "/srv/app/file-or-directory"
        })),
        ToolId::SftpDownload | ToolId::SftpDownloadDirectory => Some(json!({
            "hostId": "<host-id>",
            "remotePath": "/srv/app/file-or-directory",
            "localPath": "C:/path/to/local/file-or-directory"
        })),
        ToolId::SftpTransferEnqueue => Some(json!({
            "hostId": "<host-id>",
            "remotePath": "/srv/app/archive.tar.gz",
            "localPath": "C:/path/to/archive.tar.gz",
            "direction": "download",
            "kind": "file"
        })),
        ToolId::SftpTransferCancel => Some(json!({
            "transferId": "<transfer-id-from-sftp.transfer.list>"
        })),
        ToolId::SftpTransferList | ToolId::SftpTransferClearCompleted => Some(json!({})),
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
