//! External agent workspace file preparation methods.
//!
//! @author kongweiguang

use std::{io::ErrorKind, path::PathBuf};

use serde_json::{json, Map, Value};

use super::*;
use crate::{
    error::{AppError, AppResult},
    models::agent_session::{
        AgentSessionId, AgentTargetBindingContext, AgentTerminalSnapshotContext,
        AGENT_SESSION_SCHEMA_VERSION,
    },
    services::agent_session_file_store::AgentSessionFileStore,
};

impl ExternalAgentWorkspaceService {
    /// 写入所有 provider 共用的 session 文件；`.mcp.json` 放在此层以保证 Custom CLI
    /// 也能按工作目录自动发现同一 scoped endpoint。
    pub(super) fn prepare_agent_session_common_files(
        &self,
        context: &AgentSessionWorkspaceContext,
        include_claude_file: bool,
        options: &WorkspaceWriteOptions,
    ) -> AppResult<Vec<ExternalAgentFileOperation>> {
        let mut operations = Vec::with_capacity(if include_claude_file { 6 } else { 5 });
        operations.push(self.ensure_agent_session_instructions(context, options)?);
        if include_claude_file {
            operations.push(self.ensure_agent_session_claude_instructions(context, options)?);
        }
        operations.push(self.ensure_agent_session_mcp_json(context, options)?);
        operations.push(self.ensure_agent_session_mcp_endpoint(context, options)?);
        operations.push(self.ensure_agent_session_target_binding(context, options)?);
        operations.push(self.ensure_agent_session_terminal_snapshot(context, options)?);
        Ok(operations)
    }

    /// 只写内置 provider 专属配置，避免 Custom session 误生成 Codex 目录。
    pub(super) fn prepare_agent_session_provider_files(
        &self,
        context: &AgentSessionWorkspaceContext,
        options: &WorkspaceWriteOptions,
    ) -> AppResult<Vec<ExternalAgentFileOperation>> {
        Ok(vec![
            self.ensure_agent_session_codex_config(context, options)?
        ])
    }

    /// 生成 Agent 会话规则，将 tab/global scope 和可恢复的终端操作写入受管工作区。
    ///
    /// 规则文件必须描述运行态授权边界而不是缓存某一个 pane；MCP 服务端会在每次
    /// snapshot/write 调用中校验显式 sessionId 的 scope membership。
    pub(super) fn ensure_agent_session_instructions(
        &self,
        context: &AgentSessionWorkspaceContext,
        options: &WorkspaceWriteOptions,
    ) -> AppResult<ExternalAgentFileOperation> {
        let agent_title = match context.agent_id.as_str() {
            "codex" => "Codex",
            "claude" => "Claude",
            "pi" => "PI Agent",
            "custom" => "Custom Agent",
            _ => "External Agent",
        };
        let agents_body = format!(
            r#"{MANAGED_BLOCK_START}
# Kerminal Agent Session

- You are an external Agent launched from the Kerminal right panel.
- Agent provider: `{}`.
- Agent title: `{}`.
- Kerminal agent session id: `{}`.
- Kerminal workspace root: `{}`.
- This session root: `{}`.
- Session-scoped MCP endpoint: `{}`.
- This is a Kerminal runtime workspace, not a source-code repository.
- Read `context/mcp-endpoint.json`, `context/target-binding.json`, and `context/terminal-snapshot.json` before runtime work. They contain the scoped endpoint, the session scope with its live terminal membership, and the most recent bounded terminal output snapshots.
- Kerminal MCP is tools-only; use it for live runtime actions, not file-backed configuration CRUD.
- Operate Kerminal through MCP when the task needs the live app: terminal sessions, SSH commands, SFTP files, tmux sessions, containers, port forwarding, server info, command history, diagnostics, runtime snapshot, or authorized credential saving.
- Start by calling `kerminal.app_guide` when you need the product/UI structure map; call `kerminal.capabilities` when you need the current tool map, file-first configuration boundary, or deliberately absent tool families; call `kerminal.tool_help` with `toolId`, `family`, or `query` when you need exact schemas, examples, and safety annotations; call `kerminal.config_guide` when you need the generated configuration rules through MCP; call `kerminal.operation_guide` with an intent such as `terminal`, `session-terminal`, `ssh-command`, `config`, `sftp`, `tmux`, `container`, `port-forward`, `server-info`, `history`, `credentials`, or `diagnostics` when you need a concrete tool sequence; call `kerminal.runtime_snapshot` when you need the current running terminals, Agent sessions, port forwards, and next actions.
- MCP host policy owns confirmation, approval, permissions, hooks, and audit. Kerminal exposes tools and validates arguments; it does not provide a second pending/confirm queue.
- Start runtime work by calling `kerminal.agent.current_session` and `kerminal.agent.target_context` on the session-scoped endpoint. These tools refresh the scope membership and `context/terminal-snapshot.json`; a `tab` scope includes every current and future user terminal pane in that tab, while a `global` scope includes user terminals across all Kerminal tabs.
- Pass `agentSessionId` from `context/mcp-endpoint.json` to the Agent scope tools; pass an explicit returned `sessionId` to terminal snapshot/write tools.
- Use `terminal.list` to discover the current scope members, then `terminal.snapshot` and `terminal.write` with an explicit `sessionId`. The server checks that the session belongs to this Agent scope, so never guess or reuse a session id from another scope. The right-panel Agent TUI is excluded from both scopes.
- If a scoped terminal is disconnected, call `terminal.reconnect` with its `paneId`, wait for the acknowledgement, then call `terminal.list` and `terminal.snapshot` again. A disconnect does not invalidate the tab or global scope, so continue the task after reconnecting it.
- Useful runtime tool families: `terminal.*` including `terminal.reconnect`, `ssh.command`, `ssh.command_on_resolved_host`, `sftp.*`, `tmux.*`, `container.*` including `container.files.*` (`container.files.list`, `container.files.preview`, `container.files.write_text`, `container.files.upload`, `container.files.download`, `container.files.create_directory`, `container.files.rename`, `container.files.chmod`, `container.files.delete`), `port_forward.*`, `server_info.snapshot`, `history.search`, `diagnostics.*`, `kerminal.app_guide`, `kerminal.config_guide`, `kerminal.capabilities`, `kerminal.tool_help`, `kerminal.operation_guide`, `kerminal.runtime_snapshot`, `kerminal.host.upsert_with_credential`, and `kerminal.vault.encrypt_secret`.
- File-backed Kerminal configuration is file-first: edit files under the workspace root directly, including `settings.toml`, `profiles/*.toml`, `hosts/groups.toml`, `hosts/*.toml`, `snippets/*.toml`, and `workflows/*.toml`.
- Before editing Kerminal configuration files, read `{}` from the workspace root or call `kerminal.config_guide` for the same generated rules. It documents file purposes, relationships, fields, examples, forbidden edits, and validation.
- After editing Kerminal configuration files, call MCP tool `{CONFIG_VALIDATOR_TOOL_ID}` with `scope = "all"` or the narrowest matching scope. If MCP validation is unavailable, manually check the guide and say validation was manual only.
- If Kerminal is running, valid file-backed config edits auto-refresh the UI and show a concise `cfg: ...` notice; invalid TOML keeps last-known-good. This feedback does not replace validation.
- Do not expect MCP config CRUD for settings, profiles, hosts, snippets, workflows, UI choreography, history writes, or approval/audit queues.
- Do not edit `data/command.sqlite` directly; use command history lookup tools when command history is needed.
- Do not read or edit `secrets/` unless the user explicitly asks for credential work; when authorized, follow `kerminal-config.md` and use the UI save flow, `kerminal.host.upsert_with_credential`, or `kerminal.vault.encrypt_secret` so ordinary host files only keep `secret_ref` / `key_passphrase_ref`; never write `password`, `credential_secret`, or `inline_private_key` into ordinary config files.
{MANAGED_BLOCK_END}
"#,
            context.agent_id,
            agent_title,
            context.agent_session_id,
            workspace_display_path(&self.workspace_dir, &self.workspace_dir),
            workspace_display_path(&self.workspace_dir, &context.session_root),
            context.mcp_endpoint,
            CONFIG_REFERENCE_FILE_NAME
        );
        patch_managed_block(
            &context.session_root.join("AGENTS.md"),
            &agents_body,
            "Update agent session instructions.",
            options,
        )
    }

    /// 为 Claude 会话生成与 AGENTS.md 一致的 scope-aware 规则，避免 provider 模板
    /// 重新引入单终端绑定门禁或把断线误报为会话失效。
    pub(super) fn ensure_agent_session_claude_instructions(
        &self,
        context: &AgentSessionWorkspaceContext,
        options: &WorkspaceWriteOptions,
    ) -> AppResult<ExternalAgentFileOperation> {
        let claude_body = format!(
            r#"{MANAGED_BLOCK_START}
@AGENTS.md

## Kerminal Claude Session

- Follow `AGENTS.md` for this Kerminal agent session.
- This is a Kerminal runtime workspace, not a source-code repository.
- Kerminal MCP is tools-only; use it for live runtime actions, not file-backed configuration CRUD.
- MCP host policy owns confirmation, approval, permissions, hooks, and audit; Kerminal does not provide a second pending/confirm queue.
- Call `kerminal.app_guide` when you need the product/UI structure map; call `kerminal.capabilities` when you need the current runtime tool map or config/tool boundary; call `kerminal.tool_help` with `toolId`, `family`, or `query` when you need exact schemas, examples, and safety annotations; call `kerminal.config_guide` when you need the generated configuration rules through MCP; call `kerminal.operation_guide` with an intent such as `session-terminal`, `ssh-command`, `config`, `sftp`, `tmux`, `container`, `port-forward`, `server-info`, `history`, `credentials`, or `diagnostics` when you need a concrete tool sequence; call `kerminal.runtime_snapshot` when you need the current running terminals, Agent sessions, port forwards, and next actions.
- Read `context/mcp-endpoint.json`, `context/target-binding.json`, and `context/terminal-snapshot.json`, then use the session-scoped endpoint for `kerminal.agent.current_session`, `kerminal.agent.target_context`, `terminal.list`, `terminal.snapshot`, and `terminal.write`.
- Pass `agentSessionId` to `kerminal.agent.current_session` and `kerminal.agent.target_context`; terminal snapshot/write calls use explicit scope-member `sessionId` values.
- Resolve the current scope first, choose a returned member, and pass its explicit `sessionId` to `terminal.snapshot` or `terminal.write`; membership is checked by the server for every call.
- Use runtime tool families from `AGENTS.md`, including `terminal.*` and `terminal.reconnect`, `ssh.command`, `ssh.command_on_resolved_host`, `sftp.*`, `tmux.*`, `container.*` including `container.files.*` (`container.files.list`, `container.files.preview`, `container.files.write_text`, `container.files.upload`, `container.files.download`, `container.files.create_directory`, `container.files.rename`, `container.files.chmod`, `container.files.delete`), `port_forward.*`, `server_info.snapshot`, `history.search`, `diagnostics.*`, `kerminal.app_guide`, `kerminal.config_guide`, `kerminal.capabilities`, `kerminal.tool_help`, `kerminal.operation_guide`, `kerminal.runtime_snapshot`, and credential helpers.
- Prefer direct file edits in the Kerminal workspace root for `settings.toml`, `profiles/*.toml`, `hosts/*.toml`, `snippets/*.toml`, and `workflows/*.toml`.
- Before editing Kerminal configuration files, read `{}` from the workspace root or call `kerminal.config_guide` for the same generated rules.
- After editing Kerminal configuration files, call MCP tool `{CONFIG_VALIDATOR_TOOL_ID}` with `scope = "all"` or the narrowest matching scope. If MCP validation is unavailable, manually check the guide and say validation was manual only.
- If Kerminal is running, valid file-backed config edits auto-refresh the UI and show a concise `cfg: ...` notice; invalid TOML keeps last-known-good. This feedback does not replace validation.
- Use the session-scoped MCP endpoint `{}`.
- If a member is disconnected, use `terminal.reconnect` with its `paneId`, wait for acknowledgement, and refresh the scope; a disconnected terminal is a recoverable runtime condition.
- Do not expect MCP tools for config CRUD or UI choreography such as `settings.*`, `profile.*`, `remote_host.*`, `snippet.*`, `workflow.*`, `workspace.*`, or `terminal.create`; `terminal.reconnect` is the narrow exception for recovering an existing pane.
- Do not read or edit `secrets/` unless the user explicitly asks for credential work; when authorized, follow `kerminal-config.md` and use the UI save flow, `kerminal.host.upsert_with_credential`, or `kerminal.vault.encrypt_secret` so ordinary host files only keep `secret_ref` / `key_passphrase_ref`; never write `password`, `credential_secret`, or `inline_private_key` into ordinary config files.
{MANAGED_BLOCK_END}
"#,
            CONFIG_REFERENCE_FILE_NAME, context.mcp_endpoint
        );
        patch_managed_block(
            &context.session_root.join("CLAUDE.md"),
            &claude_body,
            "Update Claude agent session instructions.",
            options,
        )
    }

    pub(super) fn ensure_agent_session_codex_config(
        &self,
        context: &AgentSessionWorkspaceContext,
        options: &WorkspaceWriteOptions,
    ) -> AppResult<ExternalAgentFileOperation> {
        let path = context.session_root.join(".codex").join("config.toml");
        let snippet = format!(
            r#"[mcp_servers.kerminal]
url = "{}"
default_tools_approval_mode = "prompt"
tool_timeout_sec = 60
enabled = true
"#,
            context.mcp_endpoint
        );
        let current = read_optional_string(&path)?;
        let current_content = current.as_deref().unwrap_or_default();
        let next = replace_toml_table(current_content, "[mcp_servers.kerminal]", &snippet);
        let current_snippet = extract_toml_table(current_content, "[mcp_servers.kerminal]");
        apply_text_plan(
            WorkspaceTextPlan {
                path,
                next,
                current,
                current_snippet,
                next_snippet: snippet,
                reason: "Update session Codex MCP server table.".to_owned(),
            },
            options,
        )
    }

    /// 为所有外部 Agent 写入通用 `.mcp.json`，使支持该标准的自定义 CLI（如 PI）
    /// 与 Claude 一样自动发现当前 session-scoped Kerminal MCP endpoint。
    pub(super) fn ensure_agent_session_mcp_json(
        &self,
        context: &AgentSessionWorkspaceContext,
        options: &WorkspaceWriteOptions,
    ) -> AppResult<ExternalAgentFileOperation> {
        let path = context.session_root.join(".mcp.json");
        let current = read_optional_string(&path)?;
        let mut root = match parse_claude_mcp_json(&path, current.as_deref(), options)? {
            Some(root) => root,
            None => json!({}),
        };
        let previous_server = root
            .pointer("/mcpServers/kerminal")
            .map(|value| serde_json::to_string_pretty(value).unwrap_or_else(|_| value.to_string()));
        let object = root.as_object_mut().ok_or_else(|| {
            AppError::InvalidInput(
                ".mcp.json must be a JSON object. Use overwritePolicy=backupAndReplaceInvalid to repair it."
                    .to_owned(),
            )
        })?;
        let servers = object
            .entry("mcpServers")
            .or_insert_with(|| Value::Object(Map::new()));
        if !servers.is_object() {
            match options.overwrite_policy {
                ExternalAgentOverwritePolicy::BackupAndReplaceInvalid => {
                    *servers = Value::Object(Map::new());
                }
                ExternalAgentOverwritePolicy::PreserveUserContent => {
                    return Err(AppError::InvalidInput(
                        ".mcp.json mcpServers must be a JSON object. Use overwritePolicy=backupAndReplaceInvalid to repair it."
                            .to_owned(),
                    ));
                }
            }
        }
        let servers_object = servers.as_object_mut().expect("mcpServers object");
        servers_object.insert(
            "kerminal".to_owned(),
            json!({
                "type": "http",
                "url": context.mcp_endpoint.as_str(),
                "timeout": 60000
            }),
        );
        let next = serde_json::to_string_pretty(&root)?;
        apply_text_plan(
            WorkspaceTextPlan {
                path,
                next: format!("{next}\n"),
                current,
                current_snippet: previous_server,
                next_snippet: serde_json::to_string_pretty(&json!({
                    "type": "http",
                    "url": context.mcp_endpoint.as_str(),
                    "timeout": 60000
                }))?,
                reason: "Update session MCP server entry.".to_owned(),
            },
            options,
        )
    }

    pub(super) fn ensure_agent_session_mcp_endpoint(
        &self,
        context: &AgentSessionWorkspaceContext,
        options: &WorkspaceWriteOptions,
    ) -> AppResult<ExternalAgentFileOperation> {
        let env = self.agent_session_env(context);
        let next = serde_json::to_string_pretty(&json!({
            "schemaVersion": 1,
            "agentSessionId": context.agent_session_id.as_str(),
            "agentId": context.agent_id.as_str(),
            "workspaceRoot": path_to_string(&self.workspace_dir),
            "agentSessionRoot": path_to_string(&context.session_root),
            "endpoint": context.mcp_endpoint.as_str(),
            "transport": "streamable-http",
            "toolsOnly": true,
            "generatedAt": current_unix_timestamp_string(),
            "env": env
        }))?;
        let path = context
            .session_root
            .join("context")
            .join("mcp-endpoint.json");
        let current = read_optional_string(&path)?;
        apply_text_plan(
            WorkspaceTextPlan {
                path,
                next: format!("{next}\n"),
                current,
                current_snippet: None,
                next_snippet: next,
                reason: "Update session MCP endpoint context.".to_owned(),
            },
            options,
        )
    }

    pub(super) fn ensure_agent_session_target_binding(
        &self,
        context: &AgentSessionWorkspaceContext,
        options: &WorkspaceWriteOptions,
    ) -> AppResult<ExternalAgentFileOperation> {
        let target_context = self.seed_agent_session_target_binding_context(context)?;
        let next = serde_json::to_string_pretty(&target_context)?;
        let path = context
            .session_root
            .join("context")
            .join("target-binding.json");
        let current = read_optional_string(&path)?;
        apply_text_plan(
            WorkspaceTextPlan {
                path,
                next: format!("{next}\n"),
                current,
                current_snippet: None,
                next_snippet: next,
                reason: "Update session target binding context.".to_owned(),
            },
            options,
        )
    }

    pub(super) fn ensure_agent_session_terminal_snapshot(
        &self,
        context: &AgentSessionWorkspaceContext,
        options: &WorkspaceWriteOptions,
    ) -> AppResult<ExternalAgentFileOperation> {
        let agent_session_id = AgentSessionId::new(context.agent_session_id.clone())?;
        let snapshot_context = AgentTerminalSnapshotContext {
            schema_version: AGENT_SESSION_SCHEMA_VERSION,
            agent_session_id,
            target_terminal_session_id: None,
            captured_bytes: 0,
            max_bytes: AGENT_SESSION_TERMINAL_SNAPSHOT_BYTES,
            truncated: false,
            redacted: false,
            output: String::new(),
            generated_at: current_unix_timestamp_string(),
        };
        let next = serde_json::to_string_pretty(&snapshot_context)?;
        let path = context
            .session_root
            .join("context")
            .join("terminal-snapshot.json");
        let current = read_optional_string(&path)?;
        apply_text_plan(
            WorkspaceTextPlan {
                path,
                next: format!("{next}\n"),
                current,
                current_snippet: None,
                next_snippet: next,
                reason: "Update session terminal snapshot context.".to_owned(),
            },
            options,
        )
    }

    pub(super) fn seed_agent_session_target_binding_context(
        &self,
        context: &AgentSessionWorkspaceContext,
    ) -> AppResult<AgentTargetBindingContext> {
        let agent_session_id = AgentSessionId::new(context.agent_session_id.clone())?;
        let generated_at = current_unix_timestamp_string();
        let store = AgentSessionFileStore::new(&self.workspace_dir);
        match store.read_session(&agent_session_id) {
            Ok(session) => Ok(AgentTargetBindingContext::from_session_target(
                &session,
                generated_at,
            )),
            Err(AppError::Io(error)) if error.kind() == ErrorKind::NotFound => Ok(
                unbound_agent_target_binding_context(agent_session_id, generated_at),
            ),
            Err(error) => Err(error),
        }
    }

    /// 汇总无需额外 adapter 的内置 provider 状态；PI 使用专门入口区分 CLI 与 adapter。
    pub(super) fn agent_status(
        &self,
        id: &str,
        title: &str,
        command: &str,
        config_path: PathBuf,
    ) -> ExternalAgentStatus {
        let installed = executable_on_path(command);
        let config_ready = match id {
            "codex" => {
                codex_config_ready(&config_path)
                    && self.agents_file_path().is_file()
                    && self.config_reference_path().is_file()
            }
            "claude" => {
                claude_config_ready(&config_path)
                    && self.agents_file_path().is_file()
                    && self.config_reference_path().is_file()
                    && self.claude_instructions_path().is_file()
            }
            _ => false,
        };
        let status_detail = match (installed, config_ready) {
            (true, true) => "Ready".to_owned(),
            (true, false) => "CLI installed; workspace files need regeneration".to_owned(),
            (false, true) => "Workspace files ready; CLI not found in PATH".to_owned(),
            (false, false) => "CLI not found in PATH; workspace files need regeneration".to_owned(),
        };

        ExternalAgentStatus {
            id: id.to_owned(),
            title: title.to_owned(),
            cli_command: command.to_owned(),
            installed,
            adapter_available: true,
            config_ready,
            config_path: path_to_string(&config_path),
            status_detail,
        }
    }

    /// 独立报告 PI CLI、MCP adapter 与 workspace config，避免任一缺失被误报为可启动。
    pub(super) fn pi_agent_status(&self) -> ExternalAgentStatus {
        let config_path = self.claude_config_path();
        let installed = executable_on_path("pi");
        let adapter_available = pi_mcp_adapter_available();
        let config_ready = claude_config_ready(&config_path)
            && self.agents_file_path().is_file()
            && self.config_reference_path().is_file();
        let status_detail = if !installed {
            "PI CLI not found in PATH"
        } else if !adapter_available {
            "PI MCP adapter is not installed"
        } else if !config_ready {
            "PI CLI and MCP adapter are ready; workspace files need regeneration"
        } else {
            "Ready"
        };

        ExternalAgentStatus {
            id: "pi".to_owned(),
            title: "PI Agent".to_owned(),
            cli_command: PI_AGENT_LAUNCH_COMMAND.to_owned(),
            installed,
            adapter_available,
            config_ready,
            config_path: path_to_string(&config_path),
            status_detail: status_detail.to_owned(),
        }
    }

    /// Custom 命令按定义动态探测，因此 workspace 级状态不假定 CLI 或 adapter 存在。
    pub(super) fn custom_agent_status(&self) -> ExternalAgentStatus {
        ExternalAgentStatus {
            id: "custom".to_owned(),
            title: "Custom Agent".to_owned(),
            cli_command: String::new(),
            installed: false,
            adapter_available: false,
            config_ready: false,
            config_path: path_to_string(&self.workspace_dir),
            status_detail: "Enter a custom CLI command to launch it in this workspace".to_owned(),
        }
    }

    pub(super) fn prepare_codex_files(
        &self,
        options: &WorkspaceWriteOptions,
    ) -> AppResult<Vec<ExternalAgentFileOperation>> {
        Ok(vec![
            self.ensure_shared_instructions(options)?,
            self.ensure_config_reference(options)?,
            self.ensure_codex_config(options)?,
        ])
    }

    pub(super) fn prepare_claude_files(
        &self,
        options: &WorkspaceWriteOptions,
    ) -> AppResult<Vec<ExternalAgentFileOperation>> {
        let mut operations = Vec::with_capacity(4);
        operations.push(self.ensure_shared_instructions(options)?);
        operations.push(self.ensure_config_reference(options)?);
        operations.extend(self.ensure_claude_files(options)?);
        Ok(operations)
    }

    /// PI 与 Claude 共享标准 `.mcp.json`，但不生成 Claude 专用说明文件。
    pub(super) fn prepare_pi_files(
        &self,
        options: &WorkspaceWriteOptions,
    ) -> AppResult<Vec<ExternalAgentFileOperation>> {
        Ok(vec![
            self.ensure_shared_instructions(options)?,
            self.ensure_config_reference(options)?,
            self.ensure_claude_mcp_json(options)?,
        ])
    }

    pub(super) fn validator_status(&self) -> ExternalAgentValidatorStatus {
        let available = self.mcp_server_running;
        ExternalAgentValidatorStatus {
            available,
            command: format!("MCP tool: {CONFIG_VALIDATOR_TOOL_ID} {{\"scope\":\"all\"}}"),
            detail: if available {
                "Call this read-only MCP tool after editing settings.toml, profiles, hosts, snippets, or workflows.".to_owned()
            } else {
                "Start the Kerminal MCP Server to use runtime config validation; otherwise manually check kerminal-config.md.".to_owned()
            },
            status: if available {
                "available"
            } else {
                "mcp-unavailable"
            }
            .to_owned(),
        }
    }

    /// 生成全局 Kerminal 工作区规则；无 session 时仍以显式 scope member 操作运行态，
    /// 同时保留文件优先配置和凭据隔离边界。
    pub(super) fn ensure_shared_instructions(
        &self,
        options: &WorkspaceWriteOptions,
    ) -> AppResult<ExternalAgentFileOperation> {
        let validator_line = format!(
            "- After changing Kerminal configuration files, call MCP tool `{CONFIG_VALIDATOR_TOOL_ID}` with `scope = \"all\"` or the narrowest matching scope, then fix any diagnostics before reporting success. If the tool is unavailable, manually check `{CONFIG_REFERENCE_FILE_NAME}` and say validation was manual only."
        );
        let agents_body = format!(
            r#"{MANAGED_BLOCK_START}
# Kerminal External Agent Workspace

- Treat this directory as the Kerminal runtime workspace, not a source-code repository.
- Your job is to operate Kerminal for the user through the Kerminal MCP server and edit file-backed configuration only when the user asks for configuration changes.
- Operate Kerminal through MCP for live app features: terminal sessions, SSH commands, SFTP files, tmux sessions, containers, port forwarding, server info, command history, diagnostics, runtime snapshot, and authorized credential saving. MCP endpoint: `{}`.
- Call MCP tool `kerminal.app_guide` when you need the product/UI structure map; call `kerminal.capabilities` when you need the current Kerminal tool map, recommended first calls, file-first config boundary, or deliberately absent tool families; call `kerminal.tool_help` with `toolId`, `family`, or `query` when you need exact schemas, examples, and safety annotations; call `kerminal.config_guide` when you need the generated configuration rules through MCP; call `kerminal.operation_guide` with an intent such as `terminal`, `session-terminal`, `ssh-command`, `config`, `sftp`, `tmux`, `container`, `port-forward`, `server-info`, `history`, `credentials`, or `diagnostics` when you need a concrete tool sequence; call `kerminal.runtime_snapshot` when you need the current running terminals, Agent sessions, port forwards, and next actions.
- MCP host policy owns confirmation, approval, permissions, hooks, and audit. Kerminal exposes tools and validates arguments; it does not provide a second pending/confirm queue.
- Useful MCP tool families include `terminal.*` including `terminal.reconnect`, `ssh.command`, `ssh.command_on_resolved_host`, `sftp.*`, `tmux.*`, `container.*` including `container.files.*` (`container.files.list`, `container.files.preview`, `container.files.write_text`, `container.files.upload`, `container.files.download`, `container.files.create_directory`, `container.files.rename`, `container.files.chmod`, `container.files.delete`), `port_forward.*`, `server_info.snapshot`, `history.search`, `diagnostics.*`, `kerminal.app_guide`, `kerminal.config_guide`, `kerminal.capabilities`, `kerminal.tool_help`, `kerminal.operation_guide`, `kerminal.runtime_snapshot`, credential helpers (`kerminal.host.upsert_with_credential`, `kerminal.vault.encrypt_secret`), and, in session workspaces, `kerminal.agent.*`.
- If this workspace has an Agent session under `agents/sessions/<id>/`, prefer launching from that session directory so `AGENTS.md`, `context/mcp-endpoint.json`, `context/target-binding.json`, `context/terminal-snapshot.json`, and the session-scoped endpoint describe the current scope. The session cwd is intentionally isolated under `agents/sessions/<id>/`; its logical Kerminal workspace remains the parent `~/.kerminal` root.
- A session with `tab` scope can operate every user terminal in that tab, including panes opened after the Agent started. A `global` scope can operate user terminals across all workspace tabs. The right-panel Agent TUI is never a member. Start with `kerminal.agent.target_context`, `terminal.list`, and `kerminal.runtime_snapshot`, then choose an explicit returned `sessionId`.
- Before any `terminal.write`, inspect the selected scope member with `terminal.snapshot`; pass `sessionId` and `data`, and let the server enforce scope membership. If the member is disconnected, call `terminal.reconnect` with its `paneId`, wait for acknowledgement, and refresh the list. Do not infer a target from filenames; continue after the connection acknowledgement.
- Use Kerminal MCP for saved credentials and remote access. Do not read `secrets/` to get passwords, private keys, or key passphrases.
- Before editing Kerminal configuration files, read `{CONFIG_REFERENCE_FILE_NAME}` or call `kerminal.config_guide` for the same generated rules. It documents file purposes, relationships, fields, examples, forbidden edits, and validation.
- Prefer direct file edits for file-backed Kerminal configuration; use MCP for runtime operation rather than config CRUD.
- Editable config files by default: `settings.toml`, `profiles/*.toml`, `hosts/groups.toml`, `hosts/*.toml`, `snippets/*.toml`, and `workflows/*.toml`.
- When Kerminal is running, valid file-backed config edits auto-refresh the UI and show a short `cfg: ...` notice; invalid TOML keeps last-known-good. Still validate with `{CONFIG_VALIDATOR_TOOL_ID}` before reporting success.
- Do not use Kerminal MCP tools for settings, profile, host, snippet, or workflow CRUD when the same change can be made by editing the files above.
- Do not expect MCP tools for config CRUD or UI choreography such as `settings.*`, `profile.*`, `remote_host.*`, `snippet.*`, `workflow.*`, `workspace.*`, `terminal.create`, `terminal.resolve_current`, `workspace.focus_tab`, or history write/delete/clear operations. `terminal.reconnect` is the intentionally narrow exception for reconnecting an existing pane; it does not create terminals or orchestrate arbitrary UI.
- Kerminal-owned runtime areas: `data/`, `logs/`, `cache/`, `temp/`, and `exports/`; prefer MCP tools over direct edits there.
- Do not edit `data/command.sqlite` directly; use `history.search` when command history is needed.
- Secret scope: do not read or edit `secrets/` unless the user explicitly asks for credential work.
- When credential work is authorized, follow `kerminal-config.md` and use the UI save flow, `kerminal.host.upsert_with_credential`, or `kerminal.vault.encrypt_secret` so host files only keep `secret_ref` / `key_passphrase_ref`; never write `password =`, `credential_secret`, or `inline_private_key` into ordinary config files.
- Never store API keys, tokens, passwords, or private keys in ordinary config files.
- Keep edits small and targeted; do not reformat all TOML or remove comments outside the requested change.
{}
{MANAGED_BLOCK_END}
"#,
            self.mcp_endpoint, validator_line
        );
        patch_managed_block(
            &self.agents_file_path(),
            &agents_body,
            "Update shared external agent instructions.",
            options,
        )
    }

    pub(super) fn ensure_config_reference(
        &self,
        options: &WorkspaceWriteOptions,
    ) -> AppResult<ExternalAgentFileOperation> {
        let path = self.config_reference_path();
        let current = read_optional_string(&path)?;
        apply_text_plan(
            WorkspaceTextPlan {
                path,
                next: CONFIG_REFERENCE_BODY.to_owned(),
                current: current.clone(),
                current_snippet: current,
                next_snippet: CONFIG_REFERENCE_BODY.to_owned(),
                reason: "Update Kerminal configuration guide for external agents.".to_owned(),
            },
            options,
        )
    }

    pub(super) fn ensure_codex_config(
        &self,
        options: &WorkspaceWriteOptions,
    ) -> AppResult<ExternalAgentFileOperation> {
        let path = self.codex_config_path();
        let snippet = format!(
            r#"[mcp_servers.kerminal]
url = "{}"
default_tools_approval_mode = "prompt"
tool_timeout_sec = 60
enabled = true
"#,
            self.mcp_endpoint
        );
        let current = read_optional_string(&path)?;
        let current_content = current.as_deref().unwrap_or_default();
        let next = replace_toml_table(current_content, "[mcp_servers.kerminal]", &snippet);
        let current_snippet = extract_toml_table(current_content, "[mcp_servers.kerminal]");
        apply_text_plan(
            WorkspaceTextPlan {
                path,
                next,
                current,
                current_snippet,
                next_snippet: snippet,
                reason: "Update Codex MCP server table.".to_owned(),
            },
            options,
        )
    }

    pub(super) fn ensure_claude_files(
        &self,
        options: &WorkspaceWriteOptions,
    ) -> AppResult<Vec<ExternalAgentFileOperation>> {
        let claude_body = format!(
            r#"{MANAGED_BLOCK_START}
@AGENTS.md

## Claude Code

- Treat this directory as the Kerminal runtime workspace, not a source-code repository.
- Follow `AGENTS.md` first.
- Operate Kerminal through MCP for live terminal, SSH/SFTP, tmux, container, port forwarding, server info, history, diagnostics, runtime snapshot, and authorized credential saving work: `{}`.
- Call MCP tool `kerminal.app_guide` when you need the product/UI structure map; call `kerminal.capabilities` when you need the current Kerminal tool map or config/tool boundary; call `kerminal.tool_help` with `toolId`, `family`, or `query` when you need exact schemas, examples, and safety annotations; call `kerminal.config_guide` when you need the generated configuration rules through MCP; call `kerminal.operation_guide` with an intent such as `terminal`, `session-terminal`, `ssh-command`, `config`, `sftp`, `tmux`, `container`, `port-forward`, `server-info`, `history`, `credentials`, or `diagnostics` when you need a concrete tool sequence; call `kerminal.runtime_snapshot` when you need the current running terminals, Agent sessions, port forwards, and next actions.
- Useful runtime tool families include `terminal.*`, `kerminal.agent.*`, `ssh.command`, `ssh.command_on_resolved_host`, `sftp.*`, `tmux.*`, `container.*` including `container.files.*` (`container.files.list`, `container.files.preview`, `container.files.write_text`, `container.files.upload`, `container.files.download`, `container.files.create_directory`, `container.files.rename`, `container.files.chmod`, `container.files.delete`), `port_forward.*`, `server_info.snapshot`, `history.search`, `diagnostics.*`, `kerminal.app_guide`, `kerminal.config_guide`, `kerminal.capabilities`, `kerminal.tool_help`, `kerminal.operation_guide`, `kerminal.runtime_snapshot`, `kerminal.host.upsert_with_credential`, and `kerminal.vault.encrypt_secret`.
- MCP host policy owns confirmation, approval, permissions, hooks, and audit; Kerminal does not provide a second pending/confirm queue.
- In a session workspace, read `context/mcp-endpoint.json`, `context/target-binding.json`, and `context/terminal-snapshot.json`, then call `kerminal.agent.target_context` and `terminal.list` to refresh scope membership before `terminal.write`.
- Inspect a selected member with `terminal.snapshot`, then pass its explicit `sessionId` and `data` to `terminal.write`; the server validates membership.
- Before editing Kerminal configuration files, read `{CONFIG_REFERENCE_FILE_NAME}` or call `kerminal.config_guide` for the same generated rules.
- After editing Kerminal configuration files, call MCP tool `{CONFIG_VALIDATOR_TOOL_ID}` with `scope = "all"` or the narrowest matching scope. If MCP validation is unavailable, manually check `{CONFIG_REFERENCE_FILE_NAME}` and say validation was manual only.
- Prefer direct file edits for file-backed Kerminal configuration; use the Kerminal MCP server only for runtime actions that require the live app, an existing terminal session, saved connection credentials, SSH/SFTP, tmux, containers, port forwarding, server info, history, diagnostics, runtime snapshot, or authorized credential saving: `{}`.
- Do not use Kerminal MCP tools for settings, profile, host, snippet, or workflow CRUD when direct file edits can express the change.
- Do not expect MCP tools for config CRUD or UI choreography such as `settings.*`, `profile.*`, `remote_host.*`, `snippet.*`, `workflow.*`, `workspace.*`, or `terminal.create`; `terminal.reconnect` is the narrow exception for recovering an existing pane.
- If a selected member is disconnected, call `terminal.reconnect` with `paneId`, wait for acknowledgement, and repeat `terminal.list`; a disconnect is recoverable and does not change scope.
- Do not edit `data/command.sqlite` directly; use `history.search` when command history is needed.
- Do not edit `secrets/` unless the user explicitly asks; when authorized, follow `kerminal-config.md` and use the UI save flow, `kerminal.host.upsert_with_credential`, or `kerminal.vault.encrypt_secret` so ordinary host files only keep `secret_ref` / `key_passphrase_ref`; never write `password`, `credential_secret`, or `inline_private_key` into ordinary config files.
{MANAGED_BLOCK_END}
"#,
            self.mcp_endpoint, self.mcp_endpoint
        );
        Ok(vec![
            patch_managed_block(
                &self.claude_instructions_path(),
                &claude_body,
                "Update Claude workspace instructions.",
                options,
            )?,
            self.ensure_claude_mcp_json(options)?,
        ])
    }

    pub(super) fn ensure_claude_mcp_json(
        &self,
        options: &WorkspaceWriteOptions,
    ) -> AppResult<ExternalAgentFileOperation> {
        let path = self.claude_config_path();
        let current = read_optional_string(&path)?;
        let mut root = match parse_claude_mcp_json(&path, current.as_deref(), options)? {
            Some(root) => root,
            None => json!({}),
        };
        let previous_server = root
            .pointer("/mcpServers/kerminal")
            .map(|value| serde_json::to_string_pretty(value).unwrap_or_else(|_| value.to_string()));
        let object = root.as_object_mut().ok_or_else(|| {
            AppError::InvalidInput(
                ".mcp.json must be a JSON object. Use overwritePolicy=backupAndReplaceInvalid to repair it."
                    .to_owned(),
            )
        })?;
        let servers = object
            .entry("mcpServers")
            .or_insert_with(|| Value::Object(Map::new()));
        if !servers.is_object() {
            match options.overwrite_policy {
                ExternalAgentOverwritePolicy::BackupAndReplaceInvalid => {
                    *servers = Value::Object(Map::new());
                }
                ExternalAgentOverwritePolicy::PreserveUserContent => {
                    return Err(AppError::InvalidInput(
                        ".mcp.json mcpServers must be a JSON object. Use overwritePolicy=backupAndReplaceInvalid to repair it."
                            .to_owned(),
                    ));
                }
            }
        }
        let servers_object = servers.as_object_mut().expect("mcpServers object");
        servers_object.insert(
            "kerminal".to_owned(),
            json!({
                "type": "http",
                "url": self.mcp_endpoint,
                "timeout": 60000
            }),
        );
        let next = serde_json::to_string_pretty(&root)?;
        apply_text_plan(
            WorkspaceTextPlan {
                path,
                next: format!("{next}\n"),
                current,
                current_snippet: previous_server,
                next_snippet: serde_json::to_string_pretty(&json!({
                    "type": "http",
                    "url": self.mcp_endpoint,
                    "timeout": 60000
                }))?,
                reason: "Update Claude project MCP server entry.".to_owned(),
            },
            options,
        )
    }

    pub(super) fn agents_file_path(&self) -> PathBuf {
        self.workspace_dir.join("AGENTS.md")
    }

    pub(super) fn claude_instructions_path(&self) -> PathBuf {
        self.workspace_dir.join("CLAUDE.md")
    }

    pub(super) fn config_reference_path(&self) -> PathBuf {
        self.workspace_dir.join(CONFIG_REFERENCE_FILE_NAME)
    }

    pub(super) fn codex_config_path(&self) -> PathBuf {
        self.workspace_dir.join(".codex").join("config.toml")
    }

    pub(super) fn claude_config_path(&self) -> PathBuf {
        self.workspace_dir.join(".mcp.json")
    }
}
