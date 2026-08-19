//! Streamable HTTP MCP Server 服务。
//!
//! @author kongweiguang

use std::{
    future::Future,
    io::ErrorKind,
    net::{IpAddr, Ipv4Addr, SocketAddr},
};

use axum::{extract::OriginalUri, http::request::Parts};
use rmcp::{
    model::{
        object, CallToolRequestParams, CallToolResult, GetPromptRequestParams, GetPromptResult,
        Implementation, ListPromptsResult, ListResourceTemplatesResult, ListResourcesResult,
        ListToolsResult, PaginatedRequestParams, ReadResourceRequestParams, ReadResourceResult,
        ServerCapabilities, ServerInfo as RmcpServerInfo, Tool, ToolAnnotations,
    },
    service::{MaybeSendFuture, RequestContext, RoleServer},
    ErrorData as McpError, ServerHandler,
};
use serde_json::{json, Value};
use tauri::Manager;

use crate::{
    error::{AppError, AppResult},
    models::{agent_session::AgentSessionId, mcp_server::ToolDefinition},
    services::{
        mcp_tool_catalog_service::ToolId,
        mcp_tool_executor_service::{
            McpToolExecutionContext, McpToolExecutionOutput, McpToolExecutionStatus,
        },
    },
    state::AppState,
};

const DEFAULT_BIND_ADDRESS: &str = "127.0.0.1";
const DEFAULT_MCP_HTTP_PORT: u16 = 37657;
const MCP_HTTP_PORT_SCAN_LIMIT: u16 = 64;
const MCP_PATH: &str = "/mcp";
const MCP_AGENT_PATH: &str = "/mcp/agents";
const MCP_SERVER_INSTRUCTIONS: &str = "Kerminal exposes local runtime tools for existing terminal sessions, SSH/SFTP, tmux, containers, port forwarding, server info, command history, diagnostics, authorized credential saving, and read-only file-backed config validation. Edit Kerminal configuration directly in the external agent workspace according to AGENTS.md and CLAUDE.md, then call kerminal.config.validate. MCP tool approval is owned by the MCP host; Kerminal validates its allowlist, arguments, local-only transport, and sensitive output boundaries.";

/// Streamable HTTP MCP server runtime rules used by integration tests.
#[doc(hidden)]
pub mod rules {
    use std::net::SocketAddr;

    use tokio::net::TcpListener;

    use crate::{error::AppResult, models::mcp_server::ToolDefinition};

    pub fn default_bind_address() -> &'static str {
        super::DEFAULT_BIND_ADDRESS
    }

    pub fn default_mcp_http_port() -> u16 {
        super::DEFAULT_MCP_HTTP_PORT
    }

    pub fn mcp_http_port_scan_limit() -> u16 {
        super::MCP_HTTP_PORT_SCAN_LIMIT
    }

    pub fn is_externally_callable_tool(tool: &ToolDefinition) -> bool {
        super::is_externally_callable_tool(tool)
    }

    pub fn normalize_bind_address(host: Option<&str>) -> AppResult<String> {
        super::normalize_bind_address(host)
    }

    pub fn requested_start_port(port: Option<u16>) -> u16 {
        super::requested_start_port(port)
    }

    pub async fn bind_loopback_port_from(start_port: u16) -> AppResult<(TcpListener, SocketAddr)> {
        super::bind_loopback_port_from(start_port).await
    }
}

mod lifecycle;
use lifecycle::KerminalMcpServer;
pub use lifecycle::McpStreamableHttpServerService;

#[allow(clippy::manual_async_fn)]
impl<R: tauri::Runtime> ServerHandler for KerminalMcpServer<R> {
    fn get_info(&self) -> RmcpServerInfo {
        RmcpServerInfo::new(ServerCapabilities::builder().enable_tools().build())
            .with_server_info(
                Implementation::new("kerminal", env!("CARGO_PKG_VERSION"))
                    .with_title("Kerminal")
                    .with_description("Kerminal local terminal workspace MCP server"),
            )
            .with_instructions(MCP_SERVER_INSTRUCTIONS)
    }

    fn list_tools(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> impl Future<Output = Result<ListToolsResult, McpError>> + MaybeSendFuture + '_ {
        async move {
            let state = self.app.state::<AppState>();
            let definitions = externally_callable_tool_definitions(&state)?;
            Ok(ListToolsResult::with_all_items(
                definitions
                    .iter()
                    .map(tool_definition_to_rmcp_tool)
                    .collect::<Vec<_>>(),
            ))
        }
    }

    fn get_tool(&self, name: &str) -> Option<Tool> {
        let state = self.app.state::<AppState>();
        externally_callable_tool_definitions(&state)
            .ok()?
            .into_iter()
            .find(|definition| definition.id == name)
            .map(|definition| tool_definition_to_rmcp_tool(&definition))
    }

    fn call_tool(
        &self,
        request: CallToolRequestParams,
        context: RequestContext<RoleServer>,
    ) -> impl Future<Output = Result<CallToolResult, McpError>> + MaybeSendFuture + '_ {
        async move { self.call_tool_inner(request, context).await }
    }

    fn list_resources(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> impl Future<Output = Result<ListResourcesResult, McpError>> + MaybeSendFuture + '_ {
        async move { Ok(ListResourcesResult::with_all_items(Vec::new())) }
    }

    fn list_resource_templates(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> impl Future<Output = Result<ListResourceTemplatesResult, McpError>> + MaybeSendFuture + '_
    {
        async move { Ok(ListResourceTemplatesResult::with_all_items(Vec::new())) }
    }

    fn read_resource(
        &self,
        _request: ReadResourceRequestParams,
        _context: RequestContext<RoleServer>,
    ) -> impl Future<Output = Result<ReadResourceResult, McpError>> + MaybeSendFuture + '_ {
        async move {
            Err(McpError::invalid_params(
                "Kerminal MCP Server does not expose resources; use tools/list or edit workspace files directly.",
                None,
            ))
        }
    }

    fn list_prompts(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> impl Future<Output = Result<ListPromptsResult, McpError>> + MaybeSendFuture + '_ {
        async move { Ok(ListPromptsResult::with_all_items(Vec::new())) }
    }

    fn get_prompt(
        &self,
        _request: GetPromptRequestParams,
        _context: RequestContext<RoleServer>,
    ) -> impl Future<Output = Result<GetPromptResult, McpError>> + MaybeSendFuture + '_ {
        async move {
            Err(McpError::invalid_params(
                "Kerminal MCP Server does not expose prompts; use tools/list or workspace instructions.",
                None,
            ))
        }
    }
}

impl<R: tauri::Runtime> KerminalMcpServer<R> {
    async fn call_tool_inner(
        &self,
        request: CallToolRequestParams,
        context: RequestContext<RoleServer>,
    ) -> Result<CallToolResult, McpError> {
        let state = self.app.state::<AppState>();
        let definitions = externally_callable_tool_definitions(&state)?;
        let tool_id = request.name.to_string();
        if !definitions
            .iter()
            .any(|definition| definition.id == tool_id)
        {
            return Err(McpError::invalid_params(
                format!("未知或不可通过 HTTP MCP 直接调用的工具: {tool_id}"),
                None,
            ));
        }

        let typed_tool_id = ToolId::parse(&tool_id).ok_or_else(|| {
            McpError::invalid_params(format!("工具未登记到 typed catalog: {tool_id}"), None)
        })?;
        let arguments = scoped_tool_arguments(
            typed_tool_id,
            request.arguments.unwrap_or_default(),
            scoped_agent_session_id_from_request_context(&context).as_deref(),
        )?;

        let result = state
            .mcp_tool_executor()
            .execute(
                execution_context(&state),
                &definitions,
                &tool_id,
                Value::Object(arguments),
            )
            .await
            .map_err(app_error_to_mcp_error)?;

        Ok(tool_execution_to_call_tool_result(result))
    }
}

/// 判断工具是否适合通过外部 MCP client 直接调用。
pub fn is_externally_callable_tool(definition: &ToolDefinition) -> bool {
    definition.enabled && definition.exposed_to_mcp
}

fn tool_definition_to_rmcp_tool(definition: &ToolDefinition) -> Tool {
    Tool::new(
        definition.id.clone(),
        definition.description.clone(),
        object(definition.input_schema.clone()),
    )
    .with_title(definition.title.clone())
    .with_annotations(tool_annotations_for(definition))
}

fn tool_annotations_for(definition: &ToolDefinition) -> ToolAnnotations {
    let annotations = definition.annotations;
    ToolAnnotations::with_title(definition.title.clone())
        .read_only(annotations.read_only_hint)
        .destructive(annotations.destructive_hint)
        .idempotent(annotations.idempotent_hint)
        .open_world(annotations.open_world_hint)
}

fn externally_callable_tool_definitions(state: &AppState) -> Result<Vec<ToolDefinition>, McpError> {
    Ok(state
        .mcp_tool_catalog()
        .list_tools()
        .into_iter()
        .filter(is_externally_callable_tool)
        .collect())
}

fn scoped_tool_arguments(
    tool_id: ToolId,
    mut arguments: serde_json::Map<String, Value>,
    scoped_agent_session_id: Option<&str>,
) -> Result<serde_json::Map<String, Value>, McpError> {
    let Some(scoped_agent_session_id) = scoped_agent_session_id else {
        return Ok(arguments);
    };

    if let Some(argument_agent_session_id) = arguments.get("agentSessionId").and_then(Value::as_str)
    {
        if argument_agent_session_id.trim() != scoped_agent_session_id {
            return Err(McpError::invalid_params(
                format!(
                    "agentSessionId {argument_agent_session_id} does not match scoped MCP endpoint {scoped_agent_session_id}"
                ),
                None,
            ));
        }
        return Ok(arguments);
    }

    if accepts_scoped_agent_session_id(tool_id) {
        arguments.insert(
            "agentSessionId".to_owned(),
            Value::String(scoped_agent_session_id.to_owned()),
        );
    }
    Ok(arguments)
}

fn accepts_scoped_agent_session_id(tool_id: ToolId) -> bool {
    matches!(
        tool_id,
        ToolId::TerminalList
            | ToolId::TerminalClose
            | ToolId::TerminalLogStart
            | ToolId::TerminalLogStop
            | ToolId::TerminalLogState
            | ToolId::TerminalResize
            | ToolId::TerminalReconnect
            | ToolId::TerminalSnapshot
            | ToolId::TerminalWrite
            | ToolId::KerminalAgentCurrentSession
            | ToolId::KerminalAgentTargetContext
            | ToolId::TerminalResolveAgentTarget
    )
}

fn scoped_agent_session_id_from_request_context(
    context: &RequestContext<RoleServer>,
) -> Option<String> {
    let parts = context.extensions.get::<Parts>()?;
    scoped_agent_session_id_from_http_parts(parts)
}

fn scoped_agent_session_id_from_http_parts(parts: &Parts) -> Option<String> {
    parts
        .extensions
        .get::<OriginalUri>()
        .and_then(|uri| scoped_agent_session_id_from_path(uri.0.path()))
        .or_else(|| scoped_agent_session_id_from_path(parts.uri.path()))
}

fn scoped_agent_session_id_from_path(path: &str) -> Option<String> {
    [
        path.strip_prefix("/mcp/agents/"),
        path.strip_prefix("/agents/"),
        path.strip_prefix('/'),
    ]
    .into_iter()
    .flatten()
    .find_map(|suffix| {
        let segment = suffix.split('/').next()?.trim();
        if AgentSessionId::new(segment.to_owned()).is_ok() {
            Some(segment.to_owned())
        } else {
            None
        }
    })
}

fn execution_context<'a>(state: &'a AppState) -> McpToolExecutionContext<'a> {
    McpToolExecutionContext {
        terminals: state.terminals(),
        agent_sessions: state.agent_sessions(),
        terminal_session_bindings: state.terminal_session_bindings(),
        terminal_reconnect: state.terminal_reconnect(),
        command_history: state.command_history(),
        command_store: state.command_store(),
        settings: state.settings(),
        remote_hosts: state.remote_hosts(),
        server_info: state.server_info(),
        diagnostics: state.diagnostics(),
        sftp: state.sftp(),
        docker_hosts: state.docker_hosts(),
        external_launch_intake: state.external_launch_intake(),
        external_launch_tasks: state.external_launch_tasks(),
        tmux: state.tmux(),
        port_forwards: state.port_forwards(),
        ssh_commands: state.ssh_commands(),
        ssh_runtime: state.ssh_runtime(),
        paths: state.paths(),
        storage: state.storage(),
    }
}

fn normalize_bind_address(host: Option<&str>) -> AppResult<String> {
    match host.map(str::trim).filter(|host| !host.is_empty()) {
        None | Some("localhost") | Some(DEFAULT_BIND_ADDRESS) => {
            Ok(DEFAULT_BIND_ADDRESS.to_owned())
        }
        Some("::1") => Ok(DEFAULT_BIND_ADDRESS.to_owned()),
        Some(value) => Err(AppError::InvalidInput(format!(
            "Streamable HTTP MCP Server 只允许绑定本机 loopback 地址，当前请求: {value}"
        ))),
    }
}

fn requested_start_port(port: Option<u16>) -> u16 {
    port.filter(|value| *value != 0)
        .unwrap_or(DEFAULT_MCP_HTTP_PORT)
}

async fn bind_loopback_port_from(
    start_port: u16,
) -> AppResult<(tokio::net::TcpListener, SocketAddr)> {
    let mut port = start_port;
    for attempt in 0..MCP_HTTP_PORT_SCAN_LIMIT {
        let socket_addr = SocketAddr::new(IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1)), port);
        match tokio::net::TcpListener::bind(socket_addr).await {
            Ok(listener) => {
                let local_addr = listener.local_addr()?;
                return Ok((listener, local_addr));
            }
            Err(error) if error.kind() == ErrorKind::AddrInUse => {
                if attempt + 1 >= MCP_HTTP_PORT_SCAN_LIMIT {
                    return Err(AppError::InvalidInput(format!(
                        "Streamable HTTP MCP Server 没有可用端口，从 {start_port} 开始向后试探 {MCP_HTTP_PORT_SCAN_LIMIT} 次仍失败"
                    )));
                }
                port = port.checked_add(1).ok_or_else(|| {
                    AppError::InvalidInput(format!(
                        "Streamable HTTP MCP Server 没有可用端口，从 {start_port} 开始向后试探时已经到达端口上限"
                    ))
                })?;
            }
            Err(error) => return Err(error.into()),
        }
    }

    Err(AppError::InvalidInput(format!(
        "Streamable HTTP MCP Server 没有可用端口，从 {start_port} 开始向后试探时已经到达端口上限"
    )))
}

fn tool_execution_to_call_tool_result(result: McpToolExecutionOutput) -> CallToolResult {
    let summary = result
        .summary
        .clone()
        .or_else(|| result.error.clone())
        .unwrap_or_else(|| match result.status {
            McpToolExecutionStatus::Succeeded => "Tool completed successfully.".to_owned(),
            McpToolExecutionStatus::Failed => "Tool execution failed.".to_owned(),
        });

    if result.status == McpToolExecutionStatus::Succeeded {
        return CallToolResult::structured(json!({
            "summary": summary,
            "data": result.data,
            "entities": result.entities,
        }));
    }

    CallToolResult::structured_error(json!({
        "summary": summary,
        "error": result.error,
        "data": result.data,
        "entities": result.entities,
        "errorKind": result.error_kind,
        "recoverable": result.recoverable,
        "nextHints": result.next_hints,
    }))
}

fn app_error_to_mcp_error(error: AppError) -> McpError {
    match error {
        AppError::InvalidInput(message) => McpError::invalid_params(message, None),
        AppError::NotFound(message) => McpError::invalid_params(message, None),
        other => McpError::internal_error(other.to_string(), None),
    }
}
