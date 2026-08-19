//! Kerminal Tauri 运行时状态。
//!
//! @author kongweiguang

use std::sync::Arc;

use crate::{
    error::AppResult,
    models::settings::{AppSettings, TerminalInlineSuggestionSettings},
    paths::KerminalPaths,
    services::{
        agent_context_service::AgentContextService,
        agent_session_service::AgentSessionService,
        application_runtime::ApplicationRuntime,
        command_history_service::CommandHistoryService,
        command_suggestion_service::CommandSuggestionService,
        config_change_observer_service::ConfigChangeObserverService,
        credential_service::CredentialService,
        diagnostics_service::DiagnosticsService,
        docker_host_service::DockerHostService,
        external_launch::{
            ExternalLaunchIntake, ExternalLaunchPolicy, ExternalLaunchTaskRegistry,
            ExternalSessionMaterializer,
        },
        mcp_streamable_http_server::McpStreamableHttpServerService,
        mcp_tool_catalog_service::McpToolCatalogService,
        mcp_tool_executor_service::McpToolExecutorService,
        port_forward_service::PortForwardService,
        profile_service::ProfileService,
        remote_host_service::RemoteHostService,
        serial_terminal_service::SerialTerminalService,
        server_info_service::ServerInfoService,
        settings_service::SettingsService,
        sftp_service::SftpService,
        snippet_service::SnippetService,
        ssh_command_service::SshCommandService,
        ssh_runtime::{
            auth_broker::SshAuthBroker, native_backend::NativeSshRuntimeBackend,
            ManagedSshSessionManager,
        },
        ssh_terminal_service::SshTerminalService,
        telnet_terminal_service::TelnetTerminalService,
        terminal_manager::TerminalManager,
        terminal_session_binding_service::TerminalSessionBindingService,
        tmux_service::TmuxService,
        workflow_service::WorkflowService,
        workspace_sync_service::WorkspaceSyncService,
    },
    storage::{config_file_store::ConfigFileStore, CommandSqliteStore, RuntimeFileStore},
};

mod agent_capabilities;
mod configuration_capabilities;
mod file_capabilities;
mod mcp_capabilities;
mod operational_capabilities;
mod remote_capabilities;
mod startup_recovery;
mod terminal_capabilities;

use crate::services::external_agent_workspace::ExternalAgentWorkspaceService;
use agent_capabilities::AgentCapabilities;
use configuration_capabilities::ConfigurationCapabilities;
use file_capabilities::FileCapabilities;
use mcp_capabilities::McpCapabilities;
use operational_capabilities::OperationalCapabilities;
use remote_capabilities::RemoteCapabilities;
pub use startup_recovery::{StartupRecoveryDiagnostic, StartupRecoverySnapshot};
use terminal_capabilities::TerminalCapabilities;

/// Kerminal Rust 侧全局状态。
#[derive(Debug)]
pub struct AppState {
    agent: AgentCapabilities,
    application_runtime: ApplicationRuntime,
    files: FileCapabilities,
    mcp: McpCapabilities,
    paths: KerminalPaths,
    remote: RemoteCapabilities,
    operations: OperationalCapabilities,
    terminal: TerminalCapabilities,
    configuration: ConfigurationCapabilities,
    startup_recovery: StartupRecoverySnapshot,
}

/// AppState 的显式组合入口。
///
/// 桌面启动继续使用 `AppState::initialize`，测试与 portable 运行模式可在不依赖
/// 环境变量的情况下传入已解析的路径集合。
#[derive(Debug)]
pub struct AppStateBuilder {
    paths: KerminalPaths,
    build_observer: Arc<dyn AppStateBuildObserver>,
    external_ports: Arc<dyn AppStateExternalPorts>,
}

/// AppState 组合过程中的稳定阶段标识。
///
/// 该枚举只描述本地组合顺序，不能据此改变 Tauri command、运行时服务或配置语义。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AppStateBuildPhase {
    /// 初始化本地运行时、命令 SQLite 与 Agent workspace。
    Operations,
    /// 初始化文件化配置、工作空间 bootstrap 与配置观察服务。
    Configuration,
    /// 根据已加载设置配置外部启动策略。
    ExternalLaunchPolicy,
    /// 创建 SSH runtime 及其依赖的远程服务。
    Remote,
    /// 组合长期任务生命周期 supervisor。
    ApplicationRuntime,
}

/// AppState 组合的可注入观察端口。
///
/// 测试或 portable 宿主可在阶段开始前记录或拒绝装配；默认实现不产生额外行为。
/// 返回错误会停止后续 capability 的创建，已构造但未交给 `AppState` 的值由 Rust
/// 自动析构，避免把半初始化状态暴露给调用方。
pub trait AppStateBuildObserver: std::fmt::Debug + Send + Sync {
    /// 某个能力组合阶段开始前调用。
    fn before_phase(&self, phase: AppStateBuildPhase) -> AppResult<()>;
}

/// AppState 构造时可替换的外部副作用端口。
///
/// 端口只覆盖 workspace 文件准备和 SSH runtime 创建，不暴露 capability 内部可变状态；
/// 测试可据此稳定注入失败，生产默认实现仍使用原有 service constructor。
pub trait AppStateExternalPorts: std::fmt::Debug + Send + Sync {
    /// 确保外部 Agent 所需的默认 workspace 文件存在。
    fn prepare_agent_workspace(&self, paths: &KerminalPaths) -> AppResult<()>;

    /// 创建远程能力共享的 SSH runtime。
    fn create_ssh_runtime(&self) -> AppResult<ManagedSshSessionManager>;
}

#[derive(Debug)]
struct NoopAppStateBuildObserver;

#[derive(Debug)]
struct ProductionAppStateExternalPorts;

impl AppStateBuildObserver for NoopAppStateBuildObserver {
    fn before_phase(&self, _phase: AppStateBuildPhase) -> AppResult<()> {
        Ok(())
    }
}

impl AppStateExternalPorts for ProductionAppStateExternalPorts {
    fn prepare_agent_workspace(&self, paths: &KerminalPaths) -> AppResult<()> {
        ExternalAgentWorkspaceService::new(paths.root.clone(), None, false)
            .ensure_default_agent_files()
    }

    fn create_ssh_runtime(&self) -> AppResult<ManagedSshSessionManager> {
        Ok(ManagedSshSessionManager::with_backend(Arc::new(
            NativeSshRuntimeBackend::new(),
        )))
    }
}

impl AppStateBuilder {
    /// 以已解析的数据目录创建组合入口。
    pub fn with_paths(paths: KerminalPaths) -> Self {
        Self {
            paths,
            build_observer: Arc::new(NoopAppStateBuildObserver),
            external_ports: Arc::new(ProductionAppStateExternalPorts),
        }
    }

    /// 使用组合阶段观察端口创建入口。
    ///
    /// 该入口用于 portable 宿主和集成测试验证阶段性失败；观察端口不能直接取得
    /// capability 实例，因此不会扩大运行时服务的可变访问面。
    pub fn with_build_observer(mut self, build_observer: Arc<dyn AppStateBuildObserver>) -> Self {
        self.build_observer = build_observer;
        self
    }

    /// 替换 AppState 构造时使用的外部副作用端口。
    ///
    /// 该入口面向集成测试和 portable 宿主；返回错误会终止后续 bundle 创建，已经创建的
    /// 进程内能力按 Rust 所有权规则析构，不会返回半初始化状态。
    pub fn with_external_ports(mut self, external_ports: Arc<dyn AppStateExternalPorts>) -> Self {
        self.external_ports = external_ports;
        self
    }

    /// 构造应用状态；初始化失败时不会返回半初始化的 AppState。
    pub fn build(self) -> AppResult<AppState> {
        AppState::build_from_paths(self.paths, self.build_observer, self.external_ports)
    }
}

impl AppState {
    /// 使用当前系统 home 目录初始化应用状态。
    pub fn initialize() -> AppResult<Self> {
        Self::initialize_with_paths(KerminalPaths::from_environment_or_current_home()?)
    }

    /// 使用指定路径初始化应用状态，主要用于测试和未来 portable 模式。
    pub fn initialize_with_paths(paths: KerminalPaths) -> AppResult<Self> {
        AppStateBuilder::with_paths(paths).build()
    }

    /// 由 builder 调用的实际构造过程，保证所有入口共享同一初始化顺序。
    fn build_from_paths(
        paths: KerminalPaths,
        build_observer: Arc<dyn AppStateBuildObserver>,
        external_ports: Arc<dyn AppStateExternalPorts>,
    ) -> AppResult<Self> {
        build_observer.before_phase(AppStateBuildPhase::Operations)?;
        let files = FileCapabilities::initialize(&paths)?;
        let agent = AgentCapabilities::initialize(&paths, external_ports.as_ref())?;
        let operations = OperationalCapabilities::new();
        let mcp = McpCapabilities::new();
        let terminal = TerminalCapabilities::new(&paths);
        let config_files = ConfigFileStore::new(paths.root.clone());
        build_observer.before_phase(AppStateBuildPhase::Configuration)?;
        let (configuration, persisted_settings, startup_recovery) =
            ConfigurationCapabilities::initialize(&paths, config_files.clone())?;
        build_observer.before_phase(AppStateBuildPhase::ExternalLaunchPolicy)?;
        operations
            .external_launch_intake
            .configure_policy(ExternalLaunchPolicy::from(
                &persisted_settings.external_launch,
            ))?;
        build_observer.before_phase(AppStateBuildPhase::Remote)?;
        let remote = RemoteCapabilities::new(
            &paths,
            config_files.clone(),
            operations.external_launch_intake.clone(),
            external_ports.as_ref(),
        )?;
        build_observer.before_phase(AppStateBuildPhase::ApplicationRuntime)?;
        let application_runtime = ApplicationRuntime::new(
            configuration.config_change_observer.clone(),
            mcp.http_server.clone(),
        );

        Ok(Self {
            agent,
            application_runtime,
            files,
            mcp,
            paths,
            remote,
            operations,
            terminal,
            configuration,
            startup_recovery,
        })
    }

    /// 返回本地数据目录集合。
    pub fn paths(&self) -> &KerminalPaths {
        &self.paths
    }

    /// 返回应用级长期任务生命周期 supervisor。
    pub fn application_runtime(&self) -> &ApplicationRuntime {
        &self.application_runtime
    }

    /// 返回启动阶段的脱敏只读恢复诊断。
    pub fn startup_recovery(&self) -> &StartupRecoverySnapshot {
        &self.startup_recovery
    }

    /// 返回外部 Agent / MCP 上下文服务。
    pub fn agent_context(&self) -> &AgentContextService {
        &self.agent.agent_context
    }

    /// 返回外部 Agent session 文件服务。
    pub fn agent_sessions(&self) -> &AgentSessionService {
        &self.agent.agent_sessions
    }

    /// 返回 MCP tool 直接执行器。
    pub fn mcp_tool_executor(&self) -> &McpToolExecutorService {
        &self.mcp.tool_executor
    }

    /// 返回命令历史服务。
    pub fn command_history(&self) -> &CommandHistoryService {
        &self.agent.command_history
    }

    /// 返回命令历史和命令建议专用 SQLite 存储。
    pub fn command_store(&self) -> &CommandSqliteStore {
        &self.files.command_store
    }

    /// 返回命令建议服务。
    pub fn command_suggestions(&self) -> &CommandSuggestionService {
        &self.agent.command_suggestions
    }

    /// 返回文件型配置变更观察服务。
    pub fn config_change_observer(&self) -> &ConfigChangeObserverService {
        &self.configuration.config_change_observer
    }

    /// 返回本地凭据服务。
    pub fn credentials(&self) -> &CredentialService {
        &self.files.credentials
    }

    /// 返回诊断包服务。
    pub fn diagnostics(&self) -> &DiagnosticsService {
        &self.files.diagnostics
    }

    /// 返回 SSH 宿主上的容器服务。
    pub fn docker_hosts(&self) -> &DockerHostService {
        &self.remote.docker_hosts
    }

    /// 返回外部 SSH 启动 intake 服务。
    pub fn external_launch_intake(&self) -> &ExternalLaunchIntake {
        &self.operations.external_launch_intake
    }

    /// 返回 external SSH 创建任务注册表。
    pub fn external_launch_tasks(&self) -> &ExternalLaunchTaskRegistry {
        &self.operations.external_launch_tasks
    }

    /// 返回外部 SSH 启动临时 target materializer。
    pub fn external_session_materializer(&self) -> &ExternalSessionMaterializer {
        &self.remote.external_session_materializer
    }

    /// 返回 Streamable HTTP MCP Server 生命周期服务。
    pub fn mcp_http_server(&self) -> &McpStreamableHttpServerService {
        &self.mcp.http_server
    }

    /// 返回 SSH 端口转发服务。
    pub fn port_forwards(&self) -> &PortForwardService {
        &self.remote.port_forwards
    }

    /// 返回运行态文件存储入口。
    pub fn storage(&self) -> &RuntimeFileStore {
        &self.files.storage
    }

    /// 返回终端 Profile 服务。
    pub fn profiles(&self) -> &ProfileService {
        &self.configuration.profiles
    }

    /// 返回远程主机服务。
    pub fn remote_hosts(&self) -> &RemoteHostService {
        &self.remote.remote_hosts
    }

    /// 返回 Serial 串口终端服务。
    pub fn serial_terminals(&self) -> &SerialTerminalService {
        &self.remote.serial_terminals
    }

    /// 返回服务器信息采集服务。
    pub fn server_info(&self) -> &ServerInfoService {
        &self.remote.server_info
    }

    /// 返回应用设置服务。
    pub fn settings(&self) -> &SettingsService {
        &self.configuration.settings
    }

    /// 返回远端命令建议刷新所需的终端策略快照。
    ///
    /// Tauri command 不直接读取文件型设置，避免把运行态配置选择散落在 IPC adapter 中。
    pub fn terminal_inline_suggestion_settings(
        &self,
    ) -> AppResult<TerminalInlineSuggestionSettings> {
        Ok(self.settings().load_settings()?.terminal.inline_suggestion)
    }

    /// 更新应用设置并同步需要立即生效的运行态策略。
    pub fn update_settings(&self, request: AppSettings) -> AppResult<AppSettings> {
        let settings = self.configuration.settings.update_settings(request)?;
        self.operations
            .external_launch_intake
            .configure_policy(ExternalLaunchPolicy::from(&settings.external_launch))?;
        Ok(settings)
    }

    /// 返回 SFTP 文件工具服务。
    pub fn sftp(&self) -> &SftpService {
        &self.remote.sftp
    }

    /// 返回脚本片段服务。
    pub fn snippets(&self) -> &SnippetService {
        &self.configuration.snippets
    }

    /// 返回 SSH 认证 broker。
    pub fn ssh_auth_broker(&self) -> &SshAuthBroker {
        &self.remote.ssh_auth_broker
    }

    /// 返回 SSH 非交互命令服务。
    pub fn ssh_commands(&self) -> &SshCommandService {
        &self.remote.ssh_commands
    }

    /// 返回受管 SSH 会话运行时。
    pub fn ssh_runtime(&self) -> &ManagedSshSessionManager {
        &self.remote.ssh_runtime
    }

    /// 返回 SSH 远程终端服务。
    pub fn ssh_terminals(&self) -> &SshTerminalService {
        &self.remote.ssh_terminals
    }

    /// 返回 Telnet 远程终端服务。
    pub fn telnet_terminals(&self) -> &TelnetTerminalService {
        &self.remote.telnet_terminals
    }

    /// 返回终端会话管理服务。
    pub fn terminals(&self) -> &TerminalManager {
        &self.terminal.terminals
    }

    /// 返回终端 pane/session 绑定旁路服务。
    pub fn terminal_session_bindings(&self) -> &TerminalSessionBindingService {
        &self.terminal.session_bindings
    }

    /// 返回前端终端 pane 重连 request/ack 协调器。
    pub fn terminal_reconnect(
        &self,
    ) -> &crate::services::terminal_reconnect_service::TerminalReconnectService {
        &self.terminal.reconnect
    }

    /// 返回 tmux 管理服务。
    pub fn tmux(&self) -> &TmuxService {
        &self.remote.tmux
    }

    /// 返回 Kerminal MCP tool catalog。
    pub fn mcp_tool_catalog(&self) -> &McpToolCatalogService {
        &self.mcp.tool_catalog
    }

    /// 返回命令工作流服务。
    pub fn workflows(&self) -> &WorkflowService {
        &self.configuration.workflows
    }

    /// 返回工作空间同步与 encrypted vault bootstrap 服务。
    pub fn workspace_sync(&self) -> &WorkspaceSyncService {
        &self.configuration.workspace_sync
    }
}
