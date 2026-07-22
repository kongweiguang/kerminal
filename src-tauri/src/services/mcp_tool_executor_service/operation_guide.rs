//! Kerminal operation guide MCP tool.
//!
//! @author kongweiguang

use super::diagnostics_common::{
    absent_tool_families, available_tool_ids, exposed_tool_definitions, missing_tool_ids,
    tool_references,
};
use super::tool_examples::example_arguments_for;
use super::*;

struct OperationGuidePlan {
    intent: &'static str,
    recommended_first_calls: Vec<&'static str>,
    workflow: Vec<Value>,
    referenced_tool_ids: Vec<&'static str>,
    fallbacks: Vec<&'static str>,
    next_hints: Vec<&'static str>,
}

pub(super) fn execute_kerminal_operation_guide(
    tools: &[ToolDefinition],
    arguments: &serde_json::Map<String, Value>,
) -> ToolExecutionResult {
    let exposed_tools = exposed_tool_definitions(tools);
    let requested_intent = arguments
        .get("intent")
        .and_then(Value::as_str)
        .unwrap_or("overview")
        .trim();
    let goal = arguments
        .get("goal")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);
    let plan = operation_guide_plan(requested_intent);
    let first_calls = available_tool_ids(&exposed_tools, &plan.recommended_first_calls);
    let referenced_tool_ids = unique_tool_ids(
        plan.recommended_first_calls
            .iter()
            .chain(plan.referenced_tool_ids.iter())
            .copied()
            .collect(),
    );
    let available_referenced_tool_ids = available_tool_ids(&exposed_tools, &referenced_tool_ids);
    let missing_referenced_tool_ids = missing_tool_ids(&exposed_tools, &referenced_tool_ids);
    let tool_reference = tool_references(&exposed_tools, &available_referenced_tool_ids);
    let intent_note = if plan.intent == requested_intent || requested_intent.is_empty() {
        None
    } else {
        Some(format!(
            "Unsupported intent `{requested_intent}` was normalized to `{}`.",
            plan.intent
        ))
    };

    ToolExecutionResult {
        status: McpToolExecutionStatus::Succeeded,
        result_summary: Some(format!(
            "Kerminal 操作指南已读取：intent={}；返回 {} 个步骤，{} 个当前可用相关 tools。",
            plan.intent,
            plan.workflow.len(),
            available_referenced_tool_ids.len()
        )),
        error: None,
        structured_result: Some(json!({
            "schemaVersion": 1,
            "intent": plan.intent,
            "requestedIntent": requested_intent,
            "goal": goal,
            "note": intent_note,
            "purpose": "Give external AI agents a concrete, safety-aware sequence for operating Kerminal through runtime MCP tools while keeping file-backed configuration file-first.",
            "recommendedFirstCalls": first_calls,
            "workflow": plan.workflow.clone(),
            "toolReference": tool_reference,
            "requiredContextFiles": [
                "AGENTS.md",
                "CLAUDE.md",
                "context/mcp-endpoint.json",
                "context/target-binding.json",
                "context/terminal-snapshot.json",
                "kerminal-config.md"
            ],
            "fileFirstConfiguration": {
                "readBeforeEditing": "kerminal-config.md or kerminal.config_guide",
                "guideTool": "kerminal.config_guide",
                "editableFiles": [
                    "settings.toml",
                    "profiles/*.toml",
                    "hosts/groups.toml",
                    "hosts/*.toml",
                    "snippets/*.toml",
                    "workflows/*.toml"
                ],
                "validator": "kerminal.config.validate",
                "mcpCrudBoundary": "Do not look for settings.*, profile.*, remote_host.*, snippet.*, workflow.*, or workspace.* MCP CRUD tools. Edit files directly and validate.",
                "secretBoundary": "Do not read or edit secrets/vault*.toml directly. Authorized credential work uses kerminal.host.upsert_with_credential or kerminal.vault.encrypt_secret."
            },
            "safetyBoundaries": {
                "hostPolicy": "The MCP host owns confirmation, approval, permissions, hooks, and audit.",
                "terminalWrite": "Before terminal.write, resolve and inspect the target; session-bound writes require agentSessionId, bindingGeneration, and data.",
                "remoteWrite": "For remote file deletes, tmux kills, port-forward closes, credential writes, and production hosts, rely on host approval and user intent before calling write/destructive tools.",
                "managedSsh": "For SSH-bound tool families, inspect kerminal.runtime_snapshot.managedSsh to verify whether terminal, SFTP, exec/tmux/system/container, port-forward, and MCP SSH tools are sharing a managed session; the snapshot is redacted and never returns credential material.",
                "externalLaunch": "External SSH launch compatibility is configured in settings.toml externalLaunch; runtime diagnostics expose only policy, counts, launch ids, and redacted rejection metadata.",
                "secrets": "Never copy passwords, tokens, private keys, vault keys, or decrypted secret material into chat, docs, logs, ordinary config files, or diagnostics."
            },
            "managedSshRuntime": {
                "inspectTool": "kerminal.runtime_snapshot",
                "snapshotPath": "managedSsh",
                "appliesToIntents": ["ssh-command", "sftp", "tmux", "container", "port-forward", "server-info", "diagnostics"],
                "sharedSessionRule": "Kerminal owns the authenticated ManagedSshSession and opens independent shell, SFTP, exec, and forwarding channels under the same session key when available.",
                "fallbackRule": "Only unsupported or unwired managed backends may fall back to legacy paths; auth, host-key, connect, subsystem, exec, or channel-open failures should not be hidden by opening a separate legacy SSH connection.",
                "secretBoundary": "managedSsh diagnostics include only redacted session/channel/runtime state, never passwords, private keys, passphrases, raw env, or vault refs."
            },
            "deliberatelyAbsentToolFamilies": absent_tool_families(),
            "availableReferencedToolIds": available_referenced_tool_ids.clone(),
            "missingReferencedToolIds": missing_referenced_tool_ids,
            "fallbacks": plan.fallbacks.clone(),
            "stopConditions": [
                "The requested target terminal is stale, closed, missing, or generation-mismatched.",
                "The task requires config CRUD tools that are intentionally absent; switch to direct file edits plus validation.",
                "The task asks for secret extraction, vault file editing, or plaintext credential disclosure.",
                "managedSsh diagnostics show a managed SSH failure that requires user action, host-key trust, missing credentials, or backend implementation rather than a second hidden SSH login.",
                "A destructive remote action, production write, or external side effect lacks clear user intent or host approval."
            ]
        })),
        entities: available_referenced_tool_ids
            .iter()
            .map(|tool_id| {
                json!({
                    "type": "mcpTool",
                    "id": tool_id
                })
            })
            .collect(),
        next_hints: plan
            .next_hints
            .iter()
            .map(|hint| (*hint).to_owned())
            .collect(),
        ..ToolExecutionResult::default()
    }
}

fn operation_guide_plan(requested_intent: &str) -> OperationGuidePlan {
    let normalized_intent = requested_intent
        .trim()
        .to_ascii_lowercase()
        .replace('_', "-");

    match normalized_intent.as_str() {
        "terminal" => guide_plan(
            "terminal",
            vec!["kerminal.runtime_snapshot", "terminal.list"],
            vec![
                guide_step(
                    "discover",
                    Some("terminal.list"),
                    "List live terminal sessions and choose an explicit target session id.",
                    &[],
                    "There is no implicit target in the global workspace.",
                ),
                guide_step(
                    "inspect",
                    Some("terminal.snapshot"),
                    "Read recent output before deciding whether to write.",
                    &["sessionId"],
                    "Do not write to a terminal whose purpose is unclear.",
                ),
                guide_step(
                    "act",
                    Some("terminal.write"),
                    "Write only the requested input to the selected live terminal.",
                    &["sessionId", "data"],
                    "MCP host confirmation owns approval; never infer a target from filenames.",
                ),
            ],
            vec!["terminal.snapshot", "terminal.write"],
            vec![
                "If no live terminal exists, ask the user to create or bind one in Kerminal.",
                "If the terminal output is ambiguous, ask before writing.",
            ],
            vec!["Use session-terminal intent inside an Agent session workspace."],
        ),
        "session-terminal" | "session" | "agent" => guide_plan(
            "session-terminal",
            vec![
                "kerminal.runtime_snapshot",
                "kerminal.agent.current_session",
                "kerminal.agent.target_context",
            ],
            vec![
                guide_step(
                    "read-context",
                    None,
                    "Read context/mcp-endpoint.json, context/target-binding.json, and context/terminal-snapshot.json.",
                    &["session workspace"],
                    "These files seed the session-scoped endpoint and last known target; refresh with live tools before writes.",
                ),
                guide_step(
                    "resolve",
                    Some("kerminal.agent.target_context"),
                    "Resolve the current Agent target and refresh the bounded terminal snapshot.",
                    &["agentSessionId"],
                    "Stop if target status is stale, missing, closed, or generation-mismatched.",
                ),
                guide_step(
                    "inspect",
                    Some("terminal.snapshot"),
                    "Inspect the bound target output before acting.",
                    &["agentSessionId"],
                    "Use the returned binding generation for subsequent writes.",
                ),
                guide_step(
                    "act",
                    Some("terminal.write"),
                    "Write to the bound target using agentSessionId, bindingGeneration, and data.",
                    &["agentSessionId", "bindingGeneration", "data"],
                    "Never substitute a guessed sessionId when the binding is invalid.",
                ),
            ],
            vec!["terminal.snapshot", "terminal.write", "terminal.resolve_agent_target"],
            vec![
                "If the target is stale, ask the user to rebind the Agent session in Kerminal.",
                "If the session-scoped endpoint is unavailable, use the global endpoint only with an explicit live sessionId.",
            ],
            vec!["Call kerminal.agent.target_context again after a target rebind."],
        ),
        "ssh-command" | "ssh" => guide_plan(
            "ssh-command",
            vec!["kerminal.runtime_snapshot", "ssh.command_on_resolved_host"],
            vec![
                guide_step(
                    "target",
                    None,
                    "Identify the host id from the bound Agent target or by reading hosts/*.toml.",
                    &["host id or target context"],
                    "Do not add remote_host.* expectations; host metadata is file-backed.",
                ),
                managed_ssh_runtime_step(),
                guide_step(
                    "execute",
                    Some("ssh.command_on_resolved_host"),
                    "Run a non-interactive command on a saved host through the managed SSH exec facade.",
                    &["hostId", "command"],
                    "Avoid interactive commands; use terminal tools for interactive shells.",
                ),
                guide_step(
                    "fallback",
                    Some("ssh.command"),
                    "Use direct SSH command execution when the request provides an explicit target ref accepted by the tool schema.",
                    &["target", "command"],
                    "Do not embed passwords, tokens, or private keys in commands.",
                ),
            ],
            vec!["ssh.command", "kerminal.agent.target_context"],
            vec![
                "If host metadata is missing, edit hosts/*.toml directly and validate before running commands.",
                "If credentials are missing, ask for authorization and use credential tools; do not read secrets/.",
            ],
            vec![
                "For repeated interactive work, ask the user to open or bind a terminal.",
                "After an SSH-bound operation, inspect managedSsh again when you need proof of session/channel reuse.",
            ],
        ),
        "sftp" => guide_plan(
            "sftp",
            vec!["kerminal.runtime_snapshot", "sftp.list"],
            vec![
                managed_ssh_runtime_step(),
                guide_step(
                    "browse",
                    Some("sftp.list"),
                    "List the remote directory before previewing or transferring files.",
                    &["hostId", "path"],
                    "Use saved Kerminal host credentials; do not read vault files.",
                ),
                guide_step(
                    "inspect",
                    Some("sftp.preview"),
                    "Preview text-like files before editing or transferring when the user needs content context.",
                    &["hostId", "path"],
                    "Avoid dumping large or sensitive files into chat.",
                ),
                guide_step(
                    "transfer",
                    Some("sftp.transfer.enqueue"),
                    "Queue upload/download/copy style transfer work when a managed transfer is needed.",
                    &["operation", "source", "destination"],
                    "Confirm overwrite/delete semantics through the MCP host for risky paths.",
                ),
            ],
            vec![
                "sftp.preview",
                "sftp.upload",
                "sftp.upload_directory",
                "sftp.download",
                "sftp.download_directory",
                "sftp.rename",
                "sftp.move",
                "sftp.create_directory",
                "sftp.chmod",
                "sftp.delete",
                "sftp.transfer.enqueue",
                "sftp.transfer.list",
                "sftp.transfer.cancel",
                "sftp.transfer.clear_completed",
            ],
            vec![
                "If the host id is unknown, read hosts/*.toml directly or use the bound target context.",
                "If managedSsh reports backend unsupported/unwired, legacy fallback may be expected; auth, host-key, connect, subsystem, or channel errors should not be retried through a hidden legacy SSH login.",
                "If a destructive remote file operation is requested, rely on host approval and clear user intent.",
            ],
            vec!["Use sftp.transfer.list after enqueueing long-running transfers."],
        ),
        "tmux" => guide_plan(
            "tmux",
            vec!["kerminal.runtime_snapshot", "tmux.probe", "tmux.list_sessions"],
            vec![
                managed_ssh_runtime_step(),
                guide_step(
                    "probe",
                    Some("tmux.probe"),
                    "Check whether tmux is available on the local or SSH target.",
                    &["targetKind"],
                    "Do not assume tmux exists just because a terminal is running.",
                ),
                guide_step(
                    "discover",
                    Some("tmux.list_sessions"),
                    "List sessions before creating, attaching, renaming, killing, or capturing panes.",
                    &["targetKind"],
                    "Use list_windows/list_panes before pane-specific operations.",
                ),
                guide_step(
                    "inspect",
                    Some("tmux.capture_pane"),
                    "Capture pane output for context.",
                    &["session", "window", "pane"],
                    "Limit output size and avoid leaking secrets from scrollback.",
                ),
            ],
            vec![
                "tmux.create_session",
                "tmux.rename_session",
                "tmux.kill_session",
                "tmux.list_windows",
                "tmux.list_panes",
                "tmux.capture_pane",
                "tmux.attach_plan",
            ],
            vec![
                "If tmux is unavailable, use ordinary terminal or SSH command tools.",
                "For SSH targets, tmux tools should flow through managed exec; inspect managedSsh if tmux appears to ask for a second login.",
                "Treat tmux.kill_session as destructive and require clear user intent.",
            ],
            vec!["Use tmux.attach_plan to explain how the user can attach from the UI/terminal."],
        ),
        "container" | "docker" | "podman" => guide_plan(
            "container",
            vec!["kerminal.runtime_snapshot", "container.list"],
            vec![
                managed_ssh_runtime_step(),
                guide_step(
                    "discover",
                    Some("container.list"),
                    "List containers on the SSH host.",
                    &["hostId"],
                    "Container tools inspect runtime state; host definitions remain file-backed.",
                ),
                guide_step(
                    "inspect",
                    Some("container.inspect"),
                    "Read inspect summary before lifecycle changes or deep troubleshooting.",
                    &["hostId", "containerId"],
                    "Inspect output is summarized; avoid copying raw inspect JSON into chat unless needed.",
                ),
                guide_step(
                    "observe",
                    Some("container.logs.tail"),
                    "Tail recent container logs for runtime context.",
                    &["hostId", "containerId", "tail"],
                    "Keep tail bounded and avoid exposing secrets from application logs.",
                ),
                guide_step(
                    "stats",
                    Some("container.stats"),
                    "Read a one-shot no-stream stats snapshot.",
                    &["hostId", "containerId"],
                    "Stats are read-only but still execute remotely through the saved host.",
                ),
                guide_step(
                    "files",
                    Some("container.files.list"),
                    "List files inside a selected container path.",
                    &["hostId", "containerId", "path"],
                    "Prefer preview before copying sensitive paths into chat.",
                ),
                guide_step(
                    "preview",
                    Some("container.files.preview"),
                    "Preview a file inside the selected container.",
                    &["hostId", "containerId", "path"],
                    "Avoid large binary or secret-like paths.",
                ),
                guide_step(
                    "write-text",
                    Some("container.files.write_text"),
                    "Write UTF-8 text inside the selected container, using expectedRevision when editing an existing file.",
                    &["hostId", "containerId", "path", "content", "encoding"],
                    "For existing files, preview/read first and avoid overwriteOnConflict unless the user explicitly accepts replacement.",
                ),
                guide_step(
                    "transfer",
                    Some("container.files.upload"),
                    "Upload local files or directories into a container, or use container.files.download for the reverse direction.",
                    &["hostId", "containerId", "localPath", "remotePath", "kind"],
                    "Transfers are remote side effects; confirm destination, kind, and overwrite expectations first.",
                ),
                guide_step(
                    "manage-files",
                    Some("container.files.rename"),
                    "Create directories, rename paths, chmod paths, or delete only an explicitly selected container path.",
                    &["hostId", "containerId", "path"],
                    "container.files.delete is destructive and requires clear user intent plus host approval/audit.",
                ),
                guide_step(
                    "lifecycle",
                    Some("container.restart"),
                    "Start, stop, restart, or remove only the explicitly selected container.",
                    &["hostId", "containerId"],
                    "Lifecycle changes are remote side effects; container.remove is destructive and requires clear user intent.",
                ),
            ],
            vec![
                "container.inspect",
                "container.logs.tail",
                "container.stats",
                "container.start",
                "container.stop",
                "container.restart",
                "container.remove",
                "container.files.list",
                "container.files.preview",
                "container.files.write_text",
                "container.files.create_directory",
                "container.files.rename",
                "container.files.chmod",
                "container.files.upload",
                "container.files.download",
                "container.files.delete",
            ],
            vec![
                "If the host id is unknown, read hosts/*.toml directly or use the bound target context.",
                "For SSH-host containers, list/logs/stats/lifecycle should flow through managed exec and container files through managed SSH/SFTP capability paths.",
                "Use SSH command tools only for container actions that are not exposed as dedicated MCP tools.",
            ],
            vec![
                "For destructive lifecycle or container file deletion work, inspect first and rely on host approval/audit before calling remove/delete.",
            ],
        ),
        "port-forward" | "port" | "forward" => guide_plan(
            "port-forward",
            vec!["kerminal.runtime_snapshot", "port_forward.list"],
            vec![
                managed_ssh_runtime_step(),
                guide_step(
                    "discover",
                    Some("port_forward.list"),
                    "List existing managed port forwards and local proxy entries.",
                    &[],
                    "Reuse a running forward when it already matches the target.",
                ),
                guide_step(
                    "create",
                    Some("port_forward.create"),
                    "Create a managed SSH port forward for an explicit host and target port.",
                    &["hostId", "targetHost", "targetPort"],
                    "Avoid binding public interfaces unless the user explicitly asks.",
                ),
                guide_step(
                    "close",
                    Some("port_forward.close"),
                    "Close only the managed forward selected by id.",
                    &["id"],
                    "Closing is disruptive; confirm the selected id and purpose first.",
                ),
            ],
            vec!["port_forward.create", "port_forward.close"],
            vec![
                "If the local port is busy, choose another port or ask the user.",
                "Managed port-forward diagnostics should show backend, tunnel kind, session/channel/tunnel id, cleanup/reconnect state, and fallback reason.",
                "If the host id is missing, edit/read hosts/*.toml directly before creating a forward.",
            ],
            vec!["Call kerminal.runtime_snapshot to see running forward counts in a broader runtime view."],
        ),
        "server-info" | "server" | "info" => guide_plan(
            "server-info",
            vec!["kerminal.runtime_snapshot", "server_info.snapshot"],
            vec![
                managed_ssh_runtime_step(),
                guide_step(
                    "snapshot",
                    Some("server_info.snapshot"),
                    "Read machine health and system summary for a saved SSH host through managed SSH exec.",
                    &["hostId"],
                    "This is read-only but still uses saved host access; do not expose secrets from diagnostics.",
                ),
            ],
            vec![],
            vec!["If host id is unknown, read hosts/*.toml directly or use the bound target context."],
            vec!["Use diagnostics.runtime_health for local Kerminal process health instead."],
        ),
        "history" => guide_plan(
            "history",
            vec!["history.search"],
            vec![guide_step(
                "search",
                Some("history.search"),
                "Search command history for relevant prior commands.",
                &["query"],
                "History is read-only over MCP; history.record/delete/clear tools are intentionally absent.",
            )],
            vec![],
            vec!["Do not edit data/command.sqlite directly."],
            vec!["Use terminal snapshots or SSH logs for live output, not history search."],
        ),
        "external-launch" | "external-ssh-launch" | "bastion-launch" | "jump-host-launch" => {
            guide_plan(
                "external-launch",
                vec![
                    "kerminal.runtime_snapshot",
                    "kerminal.config_guide",
                    "kerminal.config.validate",
                ],
                vec![
                    guide_step(
                        "inspect-runtime",
                        Some("kerminal.runtime_snapshot"),
                        "Inspect externalLaunch for current policy, pending queue counts, redacted last rejection, and session-only secret counts.",
                        &[],
                        "Snapshot never returns plaintext password, key passphrase, private key content, or password file contents.",
                    ),
                    guide_step(
                        "read-config-rules",
                        Some("kerminal.config_guide"),
                        "Read the settings.toml configuration rules before changing externalLaunch policy.",
                        &["settings.toml"],
                        "Do not look for external_launch.* MCP config/control tools; they are intentionally absent.",
                    ),
                    guide_step(
                        "edit-policy",
                        None,
                        "Edit settings.toml externalLaunch to enable/disable external launch, vendor argument parsing, shim bridge, autoOpenSftp, or disabledTools.",
                        &["direct file edit"],
                        "Never write plaintext credentials, private keys, password file contents, or key passphrases into settings.toml.",
                    ),
                    guide_step(
                        "validate",
                        Some("kerminal.config.validate"),
                        "Validate settings after the file edit, then re-read kerminal.runtime_snapshot to confirm the runtime policy.",
                        &["scope=settings"],
                        "Validation success is required before claiming the policy is production-ready.",
                    ),
                ],
                vec![],
                vec![
                    "If a jump platform only supports fixed terminal names, use the compatibility shim distribution path rather than MCP.",
                    "If external launches are rejected, use rawHash and redacted metadata only; do not ask for or print plaintext secrets.",
                ],
                vec![
                    "Use kerminal.runtime_snapshot after validation to confirm policy and queue status.",
                ],
            )
        },
        "config" | "configuration" => guide_plan(
            "config",
            vec!["kerminal.config_guide", "kerminal.config.validate"],
            vec![
                guide_step(
                    "read-guide",
                    Some("kerminal.config_guide"),
                    "Read the generated Kerminal configuration guide before editing any Kerminal configuration file. In an initialized workspace, kerminal-config.md contains the same rules.",
                    &["kerminal-config.md or MCP access"],
                    "Do not guess field names or relationships from filenames alone.",
                ),
                guide_step(
                    "edit-files",
                    None,
                    "Edit only the requested file-backed config: settings.toml, profiles/*.toml, hosts/groups.toml, hosts/*.toml, snippets/*.toml, or workflows/*.toml.",
                    &["direct file edit"],
                    "Preserve comments, ids, unknown fields, timestamps, and ordering unless the request needs a change.",
                ),
                guide_step(
                    "validate",
                    Some("kerminal.config.validate"),
                    "Validate with scope all or the narrowest matching scope.",
                    &["scope"],
                    "Fix every diagnostic before reporting success; auto-refresh notices do not replace validation.",
                ),
            ],
            vec![],
            vec![
                "If MCP is unavailable, manually check kerminal-config.md and state that validation was manual only.",
                "If credential material is involved, switch to credentials intent and do not edit secrets/vault*.toml directly.",
            ],
            vec!["Never add MCP config CRUD tools for settings/profile/host/snippet/workflow edits."],
        ),
        "credentials" | "credential" | "vault" | "secret" => guide_plan(
            "credentials",
            vec![
                "kerminal.host.upsert_with_credential",
                "kerminal.vault.encrypt_secret",
                "kerminal.config.validate",
            ],
            vec![
                guide_step(
                    "authorize",
                    None,
                    "Proceed only when the user explicitly asks for credential save or rotation work.",
                    &["explicit user intent"],
                    "Never extract or reveal existing secret material.",
                ),
                guide_step(
                    "save-host",
                    Some("kerminal.host.upsert_with_credential"),
                    "Create or update a host and save the provided credential into the encrypted vault.",
                    &["host metadata", "credential material"],
                    "Ordinary hosts/*.toml must keep only secret_ref, not plaintext.",
                ),
                guide_step(
                    "encrypt",
                    Some("kerminal.vault.encrypt_secret"),
                    "Encrypt authorized secret material for an existing host reference.",
                    &["kind", "hostId", "scope", "material", "plaintext"],
                    "Do not copy plaintext into docs, logs, chat, or tests.",
                ),
                guide_step(
                    "validate",
                    Some("kerminal.config.validate"),
                    "Validate host configuration after credential save.",
                    &["scope=hosts"],
                    "Do not read or edit secrets/vault*.toml directly.",
                ),
            ],
            vec![],
            vec![
                "If the user asks to inspect stored secrets, refuse plaintext extraction and offer connection testing or credential rotation.",
                "If the credential belongs in ssh-agent or a local key file, store only the reference in host TOML.",
            ],
            vec!["Credential tools are write tools; the MCP host owns confirmation and audit."],
        ),
        "diagnostics" | "diagnostic" => guide_plan(
            "diagnostics",
            vec!["kerminal.runtime_snapshot", "diagnostics.runtime_health"],
            vec![
                guide_step(
                    "runtime",
                    Some("kerminal.runtime_snapshot"),
                    "Read current terminal, Agent session, managed SSH session/channel, port-forward, and MCP tool counts.",
                    &[],
                    "Snapshot is summarized and does not read secrets.",
                ),
                guide_step(
                    "health",
                    Some("diagnostics.runtime_health"),
                    "Read local Kerminal process, system, storage, and command database health.",
                    &[],
                    "Output is summarized for external agents.",
                ),
                guide_step(
                    "bundle",
                    Some("diagnostics.create_bundle"),
                    "Create a redacted diagnostic bundle when the user needs a support artifact.",
                    &[],
                    "Do not attach or paste sensitive raw files; rely on redaction.",
                ),
            ],
            vec!["diagnostics.create_bundle", "kerminal.config.validate"],
            vec![
                "If the issue is a bad config edit, run kerminal.config.validate first.",
                "If the issue is terminal-specific, inspect the target with terminal.snapshot or kerminal.agent.target_context.",
            ],
            vec!["Use kerminal.operation_guide with a narrower intent after the failing subsystem is known."],
        ),
        _ => guide_plan(
            "overview",
            vec!["kerminal.runtime_snapshot"],
            vec![
                guide_step(
                    "discover",
                    Some("kerminal.capabilities"),
                    "Read the current tool map, runtime families, file-first config boundary, and intentionally absent tools.",
                    &[],
                    "Use kerminal.tool_help for exact schemas, examples, and safety annotations before calling a runtime tool.",
                ),
                guide_step(
                    "snapshot",
                    Some("kerminal.runtime_snapshot"),
                    "Read the current running terminals, Agent sessions, managed SSH sessions/channels, port forwards, local proxy entries, and next actions.",
                    &[],
                    "The snapshot is a summary; use specialized tools for details.",
                ),
                guide_step(
                    "narrow",
                    Some("kerminal.operation_guide"),
                    "Call this tool again with a narrower intent such as terminal, session-terminal, external-launch, config, sftp, tmux, credentials, or diagnostics.",
                    &["intent"],
                    "Choose the intent from the user's requested action, not from guessed files.",
                ),
            ],
            vec![],
            vec![
                "If the task is file-backed config, read kerminal-config.md and edit files directly.",
                "If the task requires live runtime state, use MCP tools after checking capabilities and snapshots.",
            ],
            vec!["Start with overview when the task type is unclear."],
        ),
    }
}

fn guide_plan(
    intent: &'static str,
    extra_first_calls: Vec<&'static str>,
    workflow: Vec<Value>,
    referenced_tool_ids: Vec<&'static str>,
    fallbacks: Vec<&'static str>,
    next_hints: Vec<&'static str>,
) -> OperationGuidePlan {
    let mut recommended_first_calls = vec![
        "kerminal.capabilities",
        "kerminal.tool_help",
        "kerminal.operation_guide",
    ];
    recommended_first_calls.extend(extra_first_calls);
    let recommended_first_calls = unique_tool_ids(recommended_first_calls);
    let mut all_referenced_tool_ids = recommended_first_calls.clone();
    all_referenced_tool_ids.extend(referenced_tool_ids);

    OperationGuidePlan {
        intent,
        recommended_first_calls,
        workflow,
        referenced_tool_ids: unique_tool_ids(all_referenced_tool_ids),
        fallbacks,
        next_hints,
    }
}

fn guide_step(
    phase: &str,
    tool_id: Option<&str>,
    action: &str,
    requires: &[&str],
    safety: &str,
) -> Value {
    json!({
        "phase": phase,
        "toolId": tool_id,
        "action": action,
        "requires": requires,
        "safety": safety,
        "exampleArguments": tool_id.and_then(ToolId::parse).and_then(example_arguments_for)
    })
}

fn managed_ssh_runtime_step() -> Value {
    guide_step(
        "inspect-runtime",
        Some("kerminal.runtime_snapshot"),
        "Inspect managedSsh session/channel diagnostics for the target before treating SSH-bound tool failures as independent logins.",
        &[],
        "Snapshot output is redacted; use it for backend/session/channel/fallback evidence, not for credential extraction.",
    )
}

fn unique_tool_ids(ids: Vec<&'static str>) -> Vec<&'static str> {
    let mut unique = Vec::new();
    for id in ids {
        if !unique.contains(&id) {
            unique.push(id);
        }
    }
    unique
}
