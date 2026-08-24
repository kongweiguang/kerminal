//! Agent session 业务服务。
//!
//! @author kongweiguang

use std::{
    fmt,
    path::PathBuf,
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

use uuid::Uuid;

use crate::{
    error::{AppError, AppResult},
    models::agent_session::{
        AgentId, AgentMcpCallLogEntry, AgentMcpEndpointContext, AgentProviderSession, AgentSession,
        AgentSessionCreateRequest, AgentSessionId, AgentSessionLaunch, AgentSessionLaunchRequest,
        AgentSessionList, AgentSessionRecord, AgentSessionScope, AgentSessionStatus,
        AgentSessionUpdateRequest, AgentTargetBindingContext, AgentTerminalSnapshotContext,
        AgentWorkspaceSnapshotContext, AGENT_SESSION_SCHEMA_VERSION,
    },
    services::agent_session_file_store::AgentSessionFileStore,
};

/// Agent session id 生成器。
pub trait AgentSessionIdGenerator: Send + Sync {
    /// 生成新的 Agent session id。
    fn generate(&self) -> AppResult<AgentSessionId>;
}

/// 基于当前时间和 UUID 的生产 id 生成器。
#[derive(Debug, Default)]
pub struct SystemAgentSessionIdGenerator;

impl AgentSessionIdGenerator for SystemAgentSessionIdGenerator {
    fn generate(&self) -> AppResult<AgentSessionId> {
        let seconds = current_unix_timestamp();
        let uuid = Uuid::new_v4().simple().to_string();
        AgentSessionId::new(format!("ags_{seconds}_{}", &uuid[..8]))
    }
}

/// Agent session 业务服务。
#[derive(Clone)]
pub struct AgentSessionService {
    store: AgentSessionFileStore,
    id_generator: Arc<dyn AgentSessionIdGenerator>,
}

impl fmt::Debug for AgentSessionService {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("AgentSessionService")
            .field("store", &self.store)
            .finish_non_exhaustive()
    }
}

impl AgentSessionService {
    /// 使用 workspace root 创建服务。
    pub fn new(workspace_root: impl Into<PathBuf>) -> Self {
        Self::from_store(AgentSessionFileStore::new(workspace_root))
    }

    /// 使用文件 store 创建服务。
    pub fn from_store(store: AgentSessionFileStore) -> Self {
        Self {
            store,
            id_generator: Arc::new(SystemAgentSessionIdGenerator),
        }
    }

    /// 使用自定义 id 生成器创建服务，主要用于测试。
    pub fn with_id_generator(
        store: AgentSessionFileStore,
        id_generator: Arc<dyn AgentSessionIdGenerator>,
    ) -> Self {
        Self {
            store,
            id_generator,
        }
    }

    /// 创建 Agent session。
    pub fn create_session(
        &self,
        request: AgentSessionCreateRequest,
    ) -> AppResult<AgentSessionRecord> {
        self.create_session_with_launcher_key(request, None)
    }

    /// 创建带稳定 launcher key 的 Agent session；旧调用方继续走无 key 的兼容入口。
    pub fn create_session_with_launcher_key(
        &self,
        request: AgentSessionCreateRequest,
        launcher_key: Option<String>,
    ) -> AppResult<AgentSessionRecord> {
        self.create_session_at_with_launcher_key(request, launcher_key, current_unix_timestamp())
    }

    /// 用指定时间创建 Agent session，主要用于测试和恢复流程。
    pub fn create_session_at(
        &self,
        request: AgentSessionCreateRequest,
        timestamp: impl Into<String>,
    ) -> AppResult<AgentSessionRecord> {
        self.create_session_at_with_launcher_key(request, None, timestamp)
    }

    /// 用指定时间和 launcher key 创建 session，供兼容 fixture 与稳定身份测试复用。
    pub fn create_session_at_with_launcher_key(
        &self,
        request: AgentSessionCreateRequest,
        launcher_key: Option<String>,
        timestamp: impl Into<String>,
    ) -> AppResult<AgentSessionRecord> {
        let timestamp = timestamp.into();
        let agent_session_id = self.id_generator.generate()?;
        let session_root = self.store.session_root(&agent_session_id)?;
        let session_root_text = path_to_string(&session_root);
        let workspace_root = path_to_string(self.store.workspace_root());
        let launch = build_launch(request.agent_id, request.launch, session_root_text.clone())?;
        let launcher_key = crate::models::agent_session::normalize_agent_launcher_key(
            request.agent_id,
            launcher_key,
        )?;
        let title = request
            .title
            .and_then(normalize_optional_text)
            .unwrap_or_else(|| default_title(request.agent_id).to_owned());
        let session =
            AgentSession {
                schema_version: AGENT_SESSION_SCHEMA_VERSION,
                agent_session_id: agent_session_id.clone(),
                agent_id: request.agent_id,
                launcher_key,
                title,
                created_at: timestamp.clone(),
                updated_at: timestamp.clone(),
                status: AgentSessionStatus::Active,
                workspace_root,
                session_root: session_root_text,
                launch,
                scope: Some(request.scope.unwrap_or_else(|| {
                    AgentSessionScope::from_legacy_target(request.target.as_ref())
                })),
                target: request.target,
            };
        let provider = request
            .provider
            .unwrap_or_else(|| AgentProviderSession::for_agent(request.agent_id));
        provider.validate()?;

        self.store.write_session(&session)?;
        self.store.write_provider(&agent_session_id, &provider)?;
        self.store.write_target_binding_context(
            &AgentTargetBindingContext::from_session_target(&session, timestamp.clone()),
        )?;
        self.store
            .write_mcp_endpoint_context(&AgentMcpEndpointContext::new(
                agent_session_id.clone(),
                request.mcp_endpoint,
                timestamp,
            ))?;
        self.store
            .write_workspace_snapshot_context(&AgentWorkspaceSnapshotContext {
                schema_version: AGENT_SESSION_SCHEMA_VERSION,
                agent_session_id: agent_session_id.clone(),
                workspace_root: path_to_string(self.store.workspace_root()),
                session_root: session.session_root.clone(),
                workspace_session_json: path_to_string(
                    &self
                        .store
                        .workspace_root()
                        .join("workspace")
                        .join("session.json"),
                ),
                generated_at: session.created_at.clone(),
            })?;

        self.store.read_record(&agent_session_id)
    }

    /// 列出 Agent sessions。
    pub fn list_sessions(&self) -> AppResult<AgentSessionList> {
        self.store.list_sessions()
    }

    /// 读取单个 Agent session。
    pub fn get_session(&self, agent_session_id: &AgentSessionId) -> AppResult<AgentSessionRecord> {
        self.store.read_record(agent_session_id)
    }

    /// 更新 Agent session。
    pub fn update_session(
        &self,
        agent_session_id: &AgentSessionId,
        request: AgentSessionUpdateRequest,
    ) -> AppResult<AgentSessionRecord> {
        self.update_session_at(agent_session_id, request, current_unix_timestamp())
    }

    /// 用指定时间更新 Agent session。
    pub fn update_session_at(
        &self,
        agent_session_id: &AgentSessionId,
        request: AgentSessionUpdateRequest,
        timestamp: impl Into<String>,
    ) -> AppResult<AgentSessionRecord> {
        let timestamp = timestamp.into();
        let mut session = self.store.read_session(agent_session_id)?;
        if let Some(title) = request.title {
            let Some(title) = normalize_optional_text(title) else {
                return Err(AppError::InvalidInput(
                    "Agent session title 不能为空".to_owned(),
                ));
            };
            session.title = title;
        }
        if let Some(status) = request.status {
            session.status = status;
        }
        if let Some(launch) = request.launch {
            validate_launch(&launch)?;
            session.launch = launch;
        }
        if let Some(scope) = request.scope {
            session.scope = Some(scope);
        }
        if request.clear_target {
            session.target = None;
        } else if let Some(target) = request.target {
            session.target = Some(target);
        }
        session.updated_at = timestamp.clone();
        self.store.write_session(&session)?;

        if let Some(provider) = request.provider {
            provider.validate()?;
            self.store.write_provider(agent_session_id, &provider)?;
        }
        if let Some(context) = request.target_binding_context {
            self.store.write_target_binding_context(&context)?;
        } else {
            self.store.write_target_binding_context(
                &AgentTargetBindingContext::from_session_target(&session, timestamp),
            )?;
        }
        if let Some(context) = request.mcp_endpoint {
            self.store.write_mcp_endpoint_context(&context)?;
        }

        self.store.read_record(agent_session_id)
    }

    /// 归档 Agent session。
    pub fn archive_session(
        &self,
        agent_session_id: &AgentSessionId,
    ) -> AppResult<AgentSessionRecord> {
        self.archive_session_at(agent_session_id, current_unix_timestamp())
    }

    /// 用指定时间归档 Agent session。
    pub fn archive_session_at(
        &self,
        agent_session_id: &AgentSessionId,
        timestamp: impl Into<String>,
    ) -> AppResult<AgentSessionRecord> {
        self.update_session_at(
            agent_session_id,
            AgentSessionUpdateRequest {
                status: Some(AgentSessionStatus::Archived),
                ..AgentSessionUpdateRequest::default()
            },
            timestamp,
        )
    }

    /// 写入最近目标终端快照文件。
    pub fn write_terminal_snapshot_context(
        &self,
        context: &AgentTerminalSnapshotContext,
    ) -> AppResult<()> {
        self.store.write_terminal_snapshot_context(context)
    }

    /// 写入 MCP call JSONL 日志。
    pub fn append_mcp_call_log(&self, entry: &AgentMcpCallLogEntry) -> AppResult<()> {
        self.store.append_mcp_call_log(entry)
    }
}

fn build_launch(
    agent_id: AgentId,
    request: Option<AgentSessionLaunchRequest>,
    session_root: String,
) -> AppResult<AgentSessionLaunch> {
    let request = request.unwrap_or_default();
    let command_label = request
        .command_label
        .and_then(normalize_optional_text)
        .unwrap_or_else(|| default_command(agent_id).to_owned());
    let shell = request
        .shell
        .and_then(normalize_optional_text)
        .unwrap_or_else(|| default_command(agent_id).to_owned());
    let cwd = request
        .cwd
        .and_then(normalize_optional_text)
        .unwrap_or(session_root);
    let launch = AgentSessionLaunch {
        command_label,
        shell,
        args: request.args,
        cwd,
    };
    validate_launch(&launch)?;
    Ok(launch)
}

fn validate_launch(launch: &AgentSessionLaunch) -> AppResult<()> {
    if launch.command_label.trim().is_empty() {
        return Err(AppError::InvalidInput(
            "Agent launch command_label 不能为空".to_owned(),
        ));
    }
    if launch.shell.trim().is_empty() {
        return Err(AppError::InvalidInput(
            "Agent launch shell 不能为空".to_owned(),
        ));
    }
    if launch.cwd.trim().is_empty() {
        return Err(AppError::InvalidInput(
            "Agent launch cwd 不能为空".to_owned(),
        ));
    }
    Ok(())
}

fn default_title(agent_id: AgentId) -> &'static str {
    match agent_id {
        AgentId::Codex => "Codex",
        AgentId::Claude => "Claude",
        AgentId::Pi => "PI Agent",
        AgentId::Custom => "Custom Agent",
    }
}

fn default_command(agent_id: AgentId) -> &'static str {
    match agent_id {
        AgentId::Codex => "codex",
        AgentId::Claude => "claude",
        AgentId::Pi => "pi",
        AgentId::Custom => "custom",
    }
}

fn normalize_optional_text(value: String) -> Option<String> {
    let value = value.trim();
    if value.is_empty() {
        None
    } else {
        Some(value.to_owned())
    }
}

fn current_unix_timestamp() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_owned())
}

fn path_to_string(path: &std::path::Path) -> String {
    path.display().to_string()
}
