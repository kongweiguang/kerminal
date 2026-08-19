// @author kongweiguang
use super::*;

pub(super) async fn execute_tool(
    context: &McpToolExecutionContext<'_>,
    tools: &[ToolDefinition],
    tool_id: ToolId,
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    match tool_id {
        ToolId::KerminalAppGuide => execute_kerminal_app_guide(tools),
        ToolId::KerminalCapabilities => execute_kerminal_capabilities(tools),
        ToolId::KerminalConfigGuide => execute_kerminal_config_guide(),
        ToolId::KerminalToolHelp => execute_kerminal_tool_help(tools, arguments),
        ToolId::KerminalOperationGuide => execute_kerminal_operation_guide(tools, arguments),
        ToolId::KerminalRuntimeSnapshot => execute_kerminal_runtime_snapshot(context, tools),
        ToolId::TerminalList => execute_terminal_list(
            context.agent_sessions,
            context.terminals,
            context.terminal_session_bindings,
            arguments,
        ),
        ToolId::TerminalReconnect => {
            execute_terminal_reconnect(
                context.agent_sessions,
                context.terminal_session_bindings,
                context.terminal_reconnect,
                arguments,
            )
            .await
        }
        ToolId::TerminalClose => execute_terminal_close(
            context.agent_sessions,
            context.terminals,
            context.terminal_session_bindings,
            arguments,
        ),
        ToolId::TerminalLogStart => execute_terminal_log_start(
            context.agent_sessions,
            context.terminals,
            context.terminal_session_bindings,
            context.paths,
            arguments,
        ),
        ToolId::TerminalLogStop => execute_terminal_log_stop(
            context.agent_sessions,
            context.terminals,
            context.terminal_session_bindings,
            arguments,
        ),
        ToolId::TerminalLogState => execute_terminal_log_state(
            context.agent_sessions,
            context.terminals,
            context.terminal_session_bindings,
            arguments,
        ),
        ToolId::SshCommand => {
            execute_ssh_command(
                context.ssh_commands,
                context.command_history,
                context.paths,
                context.command_store,
                arguments,
            )
            .await
        }
        ToolId::SshCommandOnResolvedHost => {
            execute_ssh_command_on_resolved_host(
                context.ssh_commands,
                context.command_history,
                context.paths,
                context.remote_hosts,
                context.command_store,
                arguments,
            )
            .await
        }
        ToolId::ServerInfoSnapshot => {
            execute_server_info_snapshot(
                context.server_info,
                context.remote_hosts,
                context.paths,
                context.ssh_commands,
                arguments,
            )
            .await
        }
        ToolId::DiagnosticsRuntimeHealth => execute_diagnostics_runtime_health(
            context.diagnostics,
            context.paths,
            context.command_store,
        ),
        ToolId::DiagnosticsCreateBundle => execute_diagnostics_create_bundle(
            context.diagnostics,
            context.paths,
            context.command_store,
            context.settings,
            context.terminals,
        ),
        ToolId::SftpList => execute_sftp_list(context.sftp, context.paths, arguments).await,
        ToolId::SftpRename => execute_sftp_rename(context.sftp, context.paths, arguments).await,
        ToolId::SftpMove => execute_sftp_move(context.sftp, context.paths, arguments).await,
        ToolId::SftpPreview => execute_sftp_preview(context.sftp, context.paths, arguments).await,
        ToolId::SftpCreateDirectory => {
            execute_sftp_create_directory(context.sftp, context.paths, arguments).await
        }
        ToolId::SftpChmod => execute_sftp_chmod(context.sftp, context.paths, arguments).await,
        ToolId::SftpUpload => execute_sftp_upload(context.sftp, context.paths, arguments).await,
        ToolId::SftpUploadDirectory => {
            execute_sftp_upload_directory(context.sftp, context.paths, arguments).await
        }
        ToolId::SftpDownload => execute_sftp_download(context.sftp, context.paths, arguments).await,
        ToolId::SftpDownloadDirectory => {
            execute_sftp_download_directory(context.sftp, context.paths, arguments).await
        }
        ToolId::SftpDelete => execute_sftp_delete(context.sftp, context.paths, arguments).await,
        ToolId::SftpTransferEnqueue => {
            execute_sftp_transfer_enqueue(context.sftp, context.paths, arguments)
        }
        ToolId::SftpTransferList => execute_sftp_transfer_list(context.sftp),
        ToolId::SftpTransferCancel => execute_sftp_transfer_cancel(context.sftp, arguments),
        ToolId::SftpTransferClearCompleted => execute_sftp_transfer_clear_completed(context.sftp),
        ToolId::ContainerList => {
            execute_container_list(
                context.docker_hosts,
                context.paths,
                context.ssh_commands,
                arguments,
            )
            .await
        }
        ToolId::ContainerInspect => {
            execute_container_inspect(
                context.docker_hosts,
                context.paths,
                context.ssh_commands,
                arguments,
            )
            .await
        }
        ToolId::ContainerLogsTail => {
            execute_container_logs_tail(
                context.docker_hosts,
                context.paths,
                context.ssh_commands,
                arguments,
            )
            .await
        }
        ToolId::ContainerStats => {
            execute_container_stats(
                context.docker_hosts,
                context.paths,
                context.ssh_commands,
                arguments,
            )
            .await
        }
        ToolId::ContainerStart => {
            execute_container_start(
                context.docker_hosts,
                context.paths,
                context.ssh_commands,
                arguments,
            )
            .await
        }
        ToolId::ContainerStop => {
            execute_container_stop(
                context.docker_hosts,
                context.paths,
                context.ssh_commands,
                arguments,
            )
            .await
        }
        ToolId::ContainerRestart => {
            execute_container_restart(
                context.docker_hosts,
                context.paths,
                context.ssh_commands,
                arguments,
            )
            .await
        }
        ToolId::ContainerRemove => {
            execute_container_remove(
                context.docker_hosts,
                context.paths,
                context.ssh_commands,
                arguments,
            )
            .await
        }
        ToolId::ContainerFilesList => {
            execute_container_files_list(
                context.docker_hosts,
                context.paths,
                context.ssh_commands,
                arguments,
            )
            .await
        }
        ToolId::ContainerFilesPreview => {
            execute_container_files_preview(
                context.docker_hosts,
                context.paths,
                context.ssh_commands,
                arguments,
            )
            .await
        }
        ToolId::ContainerFilesWriteText => {
            execute_container_files_write_text(
                context.docker_hosts,
                context.remote_hosts,
                context.paths,
                context.ssh_commands,
                arguments,
            )
            .await
        }
        ToolId::ContainerFilesCreateDirectory => {
            execute_container_files_create_directory(
                context.docker_hosts,
                context.paths,
                context.ssh_commands,
                arguments,
            )
            .await
        }
        ToolId::ContainerFilesDelete => {
            execute_container_files_delete(
                context.docker_hosts,
                context.paths,
                context.ssh_commands,
                arguments,
            )
            .await
        }
        ToolId::ContainerFilesRename => {
            execute_container_files_rename(
                context.docker_hosts,
                context.paths,
                context.ssh_commands,
                arguments,
            )
            .await
        }
        ToolId::ContainerFilesChmod => {
            execute_container_files_chmod(
                context.docker_hosts,
                context.paths,
                context.ssh_commands,
                arguments,
            )
            .await
        }
        ToolId::ContainerFilesUpload => {
            execute_container_files_upload(
                context.docker_hosts,
                context.remote_hosts,
                context.paths,
                context.ssh_commands,
                arguments,
            )
            .await
        }
        ToolId::ContainerFilesDownload => {
            execute_container_files_download(
                context.docker_hosts,
                context.remote_hosts,
                context.paths,
                context.ssh_commands,
                arguments,
            )
            .await
        }
        ToolId::TmuxProbe => {
            execute_tmux_probe(context.tmux, context.paths, context.ssh_commands, arguments).await
        }
        ToolId::TmuxListSessions => {
            execute_tmux_list_sessions(context.tmux, context.paths, context.ssh_commands, arguments)
                .await
        }
        ToolId::TmuxCreateSession => {
            execute_tmux_create_session(
                context.tmux,
                context.paths,
                context.ssh_commands,
                arguments,
            )
            .await
        }
        ToolId::TmuxRenameSession => {
            execute_tmux_rename_session(
                context.tmux,
                context.paths,
                context.ssh_commands,
                arguments,
            )
            .await
        }
        ToolId::TmuxKillSession => {
            execute_tmux_kill_session(context.tmux, context.paths, context.ssh_commands, arguments)
                .await
        }
        ToolId::TmuxListWindows => {
            execute_tmux_list_windows(context.tmux, context.paths, context.ssh_commands, arguments)
                .await
        }
        ToolId::TmuxListPanes => {
            execute_tmux_list_panes(context.tmux, context.paths, context.ssh_commands, arguments)
                .await
        }
        ToolId::TmuxCapturePane => {
            execute_tmux_capture_pane(context.tmux, context.paths, context.ssh_commands, arguments)
                .await
        }
        ToolId::TmuxAttachPlan => execute_tmux_attach_plan(context.tmux, arguments),
        ToolId::PortForwardCreate => execute_port_forward_create(
            context.port_forwards,
            context.storage,
            context.remote_hosts,
            context.paths,
            arguments,
        ),
        ToolId::PortForwardList => {
            execute_port_forward_list(context.port_forwards, context.storage)
        }
        ToolId::PortForwardClose => {
            execute_port_forward_close(context.port_forwards, context.storage, arguments)
        }
        ToolId::HistorySearch => {
            execute_history_search(context.command_history, context.command_store, arguments)
        }
        ToolId::TerminalResize => execute_terminal_resize(
            context.agent_sessions,
            context.terminals,
            context.terminal_session_bindings,
            arguments,
        ),
        ToolId::TerminalSnapshot => execute_terminal_snapshot(
            context.agent_sessions,
            context.terminals,
            context.terminal_session_bindings,
            arguments,
        ),
        ToolId::TerminalResolveAgentTarget => execute_terminal_resolve_agent_target(
            context.agent_sessions,
            context.terminals,
            context.terminal_session_bindings,
            arguments,
        ),
        ToolId::KerminalAgentCurrentSession => execute_agent_current_session(
            context.agent_sessions,
            context.terminals,
            context.terminal_session_bindings,
            arguments,
        ),
        ToolId::KerminalAgentTargetContext => execute_agent_target_context(
            context.agent_sessions,
            context.terminals,
            context.terminal_session_bindings,
            arguments,
        ),
        ToolId::KerminalHostUpsertWithCredential => {
            execute_host_upsert_with_credential(context.remote_hosts, arguments)
        }
        ToolId::KerminalVaultEncryptSecret => {
            execute_vault_encrypt_secret(context.paths, arguments)
        }
        ToolId::KerminalConfigValidate => execute_config_validate(context.paths, arguments),
        ToolId::TerminalWrite => execute_terminal_write(
            context.agent_sessions,
            context.terminals,
            context.terminal_session_bindings,
            context.command_history,
            context.command_store,
            arguments,
        ),
    }
}
