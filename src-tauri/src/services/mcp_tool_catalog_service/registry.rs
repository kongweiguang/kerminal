//! MCP 工具标识与 descriptor 注册边界。
//!
//! @author kongweiguang

use crate::models::mcp_server::ToolDefinition;

macro_rules! define_tool_ids {
    ($($name:ident => $value:literal),+ $(,)?) => {
        /// 已登记 MCP 工具的强类型标识。
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
        pub enum ToolId {
            $($name),+
        }

        impl ToolId {
            /// 返回稳定的公开 MCP tool id。
            pub const fn as_str(self) -> &'static str {
                match self {
                    $(Self::$name => $value),+
                }
            }

            /// 解析已登记的公开 MCP tool id。
            pub fn parse(value: &str) -> Option<Self> {
                match value {
                    $($value => Some(Self::$name),)+
                    _ => None,
                }
            }
        }
    };
}

define_tool_ids! {
    HistorySearch => "history.search",
    DiagnosticsRuntimeHealth => "diagnostics.runtime_health",
    DiagnosticsCreateBundle => "diagnostics.create_bundle",
    ContainerList => "container.list",
    ContainerInspect => "container.inspect",
    ContainerLogsTail => "container.logs.tail",
    ContainerStats => "container.stats",
    ContainerStart => "container.start",
    ContainerStop => "container.stop",
    ContainerRestart => "container.restart",
    ContainerRemove => "container.remove",
    ContainerFilesList => "container.files.list",
    ContainerFilesPreview => "container.files.preview",
    ContainerFilesWriteText => "container.files.write_text",
    ContainerFilesCreateDirectory => "container.files.create_directory",
    ContainerFilesRename => "container.files.rename",
    ContainerFilesChmod => "container.files.chmod",
    ContainerFilesUpload => "container.files.upload",
    ContainerFilesDownload => "container.files.download",
    ContainerFilesDelete => "container.files.delete",
    KerminalHostUpsertWithCredential => "kerminal.host.upsert_with_credential",
    KerminalVaultEncryptSecret => "kerminal.vault.encrypt_secret",
    KerminalCapabilities => "kerminal.capabilities",
    KerminalAppGuide => "kerminal.app_guide",
    KerminalConfigGuide => "kerminal.config_guide",
    KerminalToolHelp => "kerminal.tool_help",
    KerminalOperationGuide => "kerminal.operation_guide",
    KerminalRuntimeSnapshot => "kerminal.runtime_snapshot",
    TerminalWrite => "terminal.write",
    TerminalSnapshot => "terminal.snapshot",
    TerminalResolveAgentTarget => "terminal.resolve_agent_target",
    KerminalAgentCurrentSession => "kerminal.agent.current_session",
    KerminalAgentTargetContext => "kerminal.agent.target_context",
    KerminalConfigValidate => "kerminal.config.validate",
    TerminalResize => "terminal.resize",
    TerminalList => "terminal.list",
    TerminalReconnect => "terminal.reconnect",
    TerminalClose => "terminal.close",
    TerminalLogStart => "terminal.log.start",
    TerminalLogStop => "terminal.log.stop",
    TerminalLogState => "terminal.log.state",
    SshCommand => "ssh.command",
    SshCommandOnResolvedHost => "ssh.command_on_resolved_host",
    SftpList => "sftp.list",
    SftpRename => "sftp.rename",
    SftpMove => "sftp.move",
    SftpPreview => "sftp.preview",
    SftpDownload => "sftp.download",
    SftpUpload => "sftp.upload",
    SftpDelete => "sftp.delete",
    SftpCreateDirectory => "sftp.create_directory",
    SftpChmod => "sftp.chmod",
    SftpUploadDirectory => "sftp.upload_directory",
    SftpDownloadDirectory => "sftp.download_directory",
    SftpTransferEnqueue => "sftp.transfer.enqueue",
    SftpTransferList => "sftp.transfer.list",
    SftpTransferCancel => "sftp.transfer.cancel",
    SftpTransferClearCompleted => "sftp.transfer.clear_completed",
    ServerInfoSnapshot => "server_info.snapshot",
    PortForwardCreate => "port_forward.create",
    PortForwardList => "port_forward.list",
    PortForwardClose => "port_forward.close",
    TmuxProbe => "tmux.probe",
    TmuxListSessions => "tmux.list_sessions",
    TmuxCreateSession => "tmux.create_session",
    TmuxRenameSession => "tmux.rename_session",
    TmuxKillSession => "tmux.kill_session",
    TmuxListWindows => "tmux.list_windows",
    TmuxListPanes => "tmux.list_panes",
    TmuxCapturePane => "tmux.capture_pane",
    TmuxAttachPlan => "tmux.attach_plan",
}

impl ToolId {
    /// 公开 catalog 的稳定顺序；调整此列表属于 MCP 外部契约变更。
    pub const CATALOG_ORDER: &'static [Self] = &[
        Self::KerminalCapabilities,
        Self::KerminalAppGuide,
        Self::KerminalConfigGuide,
        Self::KerminalToolHelp,
        Self::KerminalOperationGuide,
        Self::KerminalRuntimeSnapshot,
        Self::TerminalWrite,
        Self::TerminalSnapshot,
        Self::TerminalResolveAgentTarget,
        Self::KerminalAgentCurrentSession,
        Self::KerminalAgentTargetContext,
        Self::KerminalConfigValidate,
        Self::TerminalResize,
        Self::TerminalList,
        Self::TerminalReconnect,
        Self::TerminalClose,
        Self::TerminalLogStart,
        Self::TerminalLogStop,
        Self::TerminalLogState,
        Self::KerminalHostUpsertWithCredential,
        Self::KerminalVaultEncryptSecret,
        Self::SshCommand,
        Self::SshCommandOnResolvedHost,
        Self::SftpList,
        Self::SftpRename,
        Self::SftpMove,
        Self::SftpPreview,
        Self::SftpDownload,
        Self::SftpUpload,
        Self::SftpDelete,
        Self::SftpCreateDirectory,
        Self::SftpChmod,
        Self::SftpUploadDirectory,
        Self::SftpDownloadDirectory,
        Self::SftpTransferEnqueue,
        Self::SftpTransferList,
        Self::SftpTransferCancel,
        Self::SftpTransferClearCompleted,
        Self::ServerInfoSnapshot,
        Self::PortForwardCreate,
        Self::PortForwardList,
        Self::PortForwardClose,
        Self::ContainerList,
        Self::ContainerInspect,
        Self::ContainerLogsTail,
        Self::ContainerStats,
        Self::ContainerStart,
        Self::ContainerStop,
        Self::ContainerRestart,
        Self::ContainerRemove,
        Self::ContainerFilesList,
        Self::ContainerFilesPreview,
        Self::ContainerFilesWriteText,
        Self::ContainerFilesCreateDirectory,
        Self::ContainerFilesRename,
        Self::ContainerFilesChmod,
        Self::ContainerFilesUpload,
        Self::ContainerFilesDownload,
        Self::ContainerFilesDelete,
        Self::TmuxProbe,
        Self::TmuxListSessions,
        Self::TmuxCreateSession,
        Self::TmuxRenameSession,
        Self::TmuxKillSession,
        Self::TmuxListWindows,
        Self::TmuxListPanes,
        Self::TmuxCapturePane,
        Self::TmuxAttachPlan,
        Self::HistorySearch,
        Self::DiagnosticsRuntimeHealth,
        Self::DiagnosticsCreateBundle,
    ];
}

/// catalog 内部使用的强类型工具描述。
#[derive(Debug, Clone)]
pub struct ToolDescriptor {
    id: ToolId,
    definition: ToolDefinition,
}

impl ToolDescriptor {
    /// 从 typed id 与公开定义构造 descriptor。
    pub(crate) fn new(id: ToolId, definition: ToolDefinition) -> Self {
        debug_assert_eq!(definition.id, id.as_str());
        Self { id, definition }
    }

    /// 返回 typed tool id。
    pub const fn id(&self) -> ToolId {
        self.id
    }

    /// 返回公开工具定义。
    pub fn definition(&self) -> &ToolDefinition {
        &self.definition
    }

    /// 转换为兼容现有调用方的公开工具定义。
    pub fn into_definition(self) -> ToolDefinition {
        self.definition
    }
}
