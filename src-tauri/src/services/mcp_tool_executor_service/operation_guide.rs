//! Kerminal operation guide MCP tool.
//!
//! @author kongweiguang

use super::diagnostics_common::{
    absent_tool_families, available_tool_ids, exposed_tool_definitions, missing_tool_ids,
    tool_references,
};
use super::tool_examples::example_arguments_for;
use super::*;

#[path = "terminal_guide.rs"]
mod terminal_guide;

struct OperationGuidePlan {
    intent: &'static str,
    recommended_first_calls: Vec<&'static str>,
    workflow: Vec<Value>,
    referenced_tool_ids: Vec<&'static str>,
    fallbacks: Vec<&'static str>,
    next_hints: Vec<&'static str>,
}

/// 根据任务意图生成 MCP 操作顺序，默认把当前 targetBinding 当作首选目标，
/// 让普通命令经由真实可见 PTY 执行；只有切换到其它终端或后台 SSH 时才扩展流程。
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
            "purpose": "Give external AI agents a concrete sequence for operating Kerminal through runtime MCP tools. Prefer the current targetBinding and visible PTY for ordinary commands; use global scope members or background tools only when the task needs them.",
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
                "hostPolicy": "The MCP host owns any confirmation, approval, permissions, hooks, and audit it chooses; Kerminal does not add a second per-command prompt.",
                "terminalWrite": "Every external Agent session uses global scope. Prefer the current live targetBinding, inspect it with terminal.snapshot, and write through terminal.write so input and output remain visible in the user's left PTY. Use terminal.list and an explicit sessionId only for another user terminal or stale target; the server validates any explicit membership.",
                "remoteWrite": "For remote file deletes, tmux kills, port-forward closes, and credential writes, rely on host approval and user intent before calling write/destructive tools.",
                "backgroundSsh": "ssh.command and ssh.command_on_resolved_host are non-interactive background fallbacks; their structured stdout/stderr do not appear in the left terminal. Prefer terminal.create for a headless PTY when no live PTY exists, and use SSH background tools only when the user explicitly requests structured background output or PTY execution is unsuitable.",
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
                "An explicitly selected sessionId is not a member of the global Agent scope or the requested terminal has been closed.",
                "The task requires config CRUD tools that are intentionally absent; switch to direct file edits plus validation.",
                "The task asks for secret extraction, vault file editing, or plaintext credential disclosure.",
                "managedSsh diagnostics show a managed SSH failure that requires user action, host-key trust, missing credentials, or backend implementation rather than a second hidden SSH login.",
                "A destructive remote action or external side effect lacks clear user intent or host approval."
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

/// 将用户意图映射到最窄的运行态流程，并为 SFTP 传输固定端点确认、入队、跟踪和取消顺序。
fn operation_guide_plan(requested_intent: &str) -> OperationGuidePlan {
    let normalized_intent = requested_intent
        .trim()
        .to_ascii_lowercase()
        .replace('_', "-");

    if let Some(plan) = terminal_guide::plan(&normalized_intent) {
        return plan;
    }

    match normalized_intent.as_str() {
        "sftp" => guide_plan(
            "sftp",
            vec!["sftp.list"],
            vec![
                guide_step(
                    "confirm-endpoints",
                    Some("sftp.list"),
                    "Optionally confirm each remote endpoint with sftp.list when its existence or kind is uncertain; local endpoints are paths on the Kerminal machine and need no remote listing.",
                    &["hostId", "path"],
                    "Use saved Kerminal host credentials and inspect only the needed directory; do not read vault files or dump sensitive contents.",
                ),
                guide_step(
                    "enqueue",
                    Some("sftp.transfer.enqueue"),
                    "Queue one copy with canonical source and destination endpoints. This covers local-to-remote, remote-to-local, same-host, and cross-host remote copies for files or directories.",
                    &["source", "destination", "kind", "conflictPolicy"],
                    "conflictPolicy is required and must be overwrite, skip, or rename; copying never deletes the source, and the MCP host owns approval.",
                ),
                guide_step(
                    "track",
                    Some("sftp.transfer.list"),
                    "Read the transfer.id returned by enqueue by calling sftp.transfer.list with { transferId } until the task reaches a terminal state.",
                    &["transferId"],
                    "Enqueue means accepted into the queue, not completed; transportMode is selected automatically and is not an Agent option.",
                ),
                guide_step(
                    "cancel",
                    Some("sftp.transfer.cancel"),
                    "If the user asks to stop the task, cancel it with the same transferId and inspect the returned transfer snapshot.",
                    &["transferId"],
                    "Cancel only the explicitly selected task and rely on MCP host approval for the remote side effect.",
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
                "Canonical source and destination endpoints support local -> remote, remote -> local, same-host remote copy, and cross-host remote copy; a local path always means the computer running Kerminal.",
                "kind and conflictPolicy are required for every transfer; choose file or directory and overwrite, skip, or rename respectively.",
                "Do not choose clientBridge or localStage: the runtime selects transportMode automatically and hides temporary staging paths.",
                "A missing host, credential, host-key trust, SFTP subsystem, or path permission is a recoverable transfer error; fix that condition before retrying.",
                "If the host id is unknown, read hosts/*.toml directly or use the selected scope member's host context.",
                "If a local-to-local copy is requested, use the local filesystem capability instead; SFTP transfer does not implement it.",
            ],
            vec![
                "After enqueue, call sftp.transfer.list with the returned transfer.id as transferId.",
                "Call sftp.transfer.cancel with that transferId only when the user asks to stop the task.",
                "Use sftp.transfer.clear_completed after reviewing finished tasks when queue cleanup is requested.",
            ],
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
                "If the host id is unknown, read hosts/*.toml directly or use the selected scope member's host context.",
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
            vec!["If host id is unknown, read hosts/*.toml directly or use the selected scope member's host context."],
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
                "If the issue is terminal-specific, inspect a scope member with terminal.snapshot or refresh scope with kerminal.agent.target_context.",
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
        "Inspect managedSsh session/channel diagnostics for the selected host before treating SSH-bound tool failures as independent logins.",
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
