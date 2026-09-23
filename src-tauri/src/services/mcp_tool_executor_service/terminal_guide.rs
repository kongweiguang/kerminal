//! Terminal-focused MCP operation guide plans.
//!
//! @author kongweiguang

use super::*;

/// 生成终端相关意图的完整流程；外部 MCP 以后台或 headless 生命周期为默认，
/// 仅把 targetBinding 可见路径留给内置右栏 Agent，避免指南诱导隐式操作 UI Tab。
pub(super) fn plan(normalized_intent: &str) -> Option<OperationGuidePlan> {
    match normalized_intent {
        "terminal" => Some(guide_plan(
            "terminal",
            vec!["terminal.create"],
            vec![
                guide_step(
                    "create",
                    Some("terminal.create"),
                    "Create a headless local or saved-host SSH PTY for persistent, interactive, or local shell work and retain the returned sessionId.",
                    &["target or hostId"],
                    "terminal.create does not open a UI pane or Tab; external MCP must keep the returned sessionId explicit for the rest of the lifecycle.",
                ),
                guide_step(
                    "inspect",
                    Some("terminal.snapshot"),
                    "Read recent output from the created headless session before writing, using the explicit sessionId returned by terminal.create.",
                    &["sessionId"],
                    "Do not infer a visible target from targetBinding or filenames; the headless session is the external MCP default.",
                ),
                guide_step(
                    "act",
                    Some("terminal.write"),
                    "Write the requested input to the headless session with its explicit sessionId.",
                    &["sessionId", "data"],
                    "The output is not a UI Tab interaction; do not switch to a visible terminal if the headless write fails.",
                ),
                guide_step(
                    "close",
                    Some("terminal.close"),
                    "Close the created headless session after the persistent or interactive work completes.",
                    &["sessionId"],
                    "Close only the sessionId returned by terminal.create and do not close a user Tab implicitly.",
                ),
            ],
            vec![
                "terminal.create",
                "terminal.snapshot",
                "terminal.write",
                "terminal.close",
                "terminal.list",
                "terminal.reconnect",
            ],
            vec![
                "Use ssh.command or ssh.command_on_resolved_host instead when the command is non-interactive SSH and does not need a persistent shell.",
                "Only an explicit request to operate a visible UI Tab permits terminal.list followed by target confirmation and terminal.snapshot/write with an explicit sessionId; a stale target is reported, never replaced.",
                "A headless failure does not authorize switching to a visible Tab or another session.",
            ],
            vec![
                "Use session-terminal only for the built-in right-panel Agent/session-terminal flow when targetBinding and scope behavior are required.",
            ],
        )),
        "session-terminal" | "session" | "agent" => Some(guide_plan(
            "session-terminal",
            vec![
                "kerminal.runtime_snapshot",
                "kerminal.agent.current_session",
                "kerminal.agent.target_context",
                "terminal.list",
            ],
            vec![
                guide_step(
                    "read-context",
                    None,
                    "Read context/mcp-endpoint.json, context/target-binding.json, and context/terminal-snapshot.json.",
                    &["session workspace"],
                    "These files seed the session-scoped endpoint, scope kind, and latest terminal snapshots; refresh with live tools before writes.",
                ),
                guide_step(
                    "scope",
                    Some("kerminal.agent.target_context"),
                    "Refresh the built-in right-panel Agent global scope and preferred targetBinding. This targetBinding-first path is not the external MCP default.",
                    &["agentSessionId"],
                    "The right-panel Agent TUI is excluded; a disconnected member remains in scope and can be recovered.",
                ),
                guide_step(
                    "discover",
                    Some("terminal.list"),
                    "Use targetBinding first inside the built-in Agent flow. Call terminal.list when it is missing/stale or the task names another global user terminal, then retain its sessionId and paneId.",
                    &[],
                    "Use only sessionIds returned for this Agent global scope; membership is checked server-side for explicit selections.",
                ),
                guide_step(
                    "ensure-pty",
                    Some("terminal.create"),
                    "If no live user PTY is available in the built-in Agent flow, create a headless local or saved-host SSH PTY and continue with its returned sessionId; skip this step when targetBinding or another listed terminal is live.",
                    &["target or hostId"],
                    "Headless creation does not open a UI pane or Tab. Close the created session after the task completes.",
                ),
                guide_step(
                    "inspect",
                    Some("terminal.snapshot"),
                    "Inspect the selected scope member output before acting.",
                    &["sessionId"],
                    "If the member is disconnected, recover it with terminal.reconnect using its paneId and wait for acknowledgement before retrying.",
                ),
                guide_step(
                    "act",
                    Some("terminal.write"),
                    "Write to the selected scope member using sessionId and data.",
                    &["sessionId", "data"],
                    "Never substitute a guessed sessionId; the service rejects members outside this Agent scope.",
                ),
            ],
            vec![
                "terminal.create",
                "terminal.list",
                "terminal.snapshot",
                "terminal.write",
                "terminal.reconnect",
            ],
            vec![
                "If a member is disconnected, call terminal.reconnect with its paneId, wait for acknowledgement, and refresh terminal.list.",
                "This session-terminal plan is for the built-in right-panel Agent. External MCP calls should use ssh.command or terminal.create directly and must not open a UI Tab implicitly.",
            ],
            vec![
                "Refresh kerminal.agent.target_context and terminal.list after opening a new pane or reconnecting an existing pane.",
            ],
        )),
        "ssh-command" | "ssh" => Some(guide_plan(
            "ssh-command",
            vec!["ssh.command", "ssh.command_on_resolved_host"],
            vec![
                guide_step(
                    "background",
                    Some("ssh.command"),
                    "Run a non-interactive SSH command in the background by default and return structured stdout/stderr. Choose exactly one of ssh.command and ssh.command_on_resolved_host; they are alternatives, not sequential steps.",
                    &["hostId", "command"],
                    "Background output does not appear in the left terminal; a failure must not fall back to a visible PTY.",
                ),
                guide_step(
                    "background-resolved",
                    Some("ssh.command_on_resolved_host"),
                    "Use the resolved-host variant when the saved host must be selected from host/group/name context rather than a direct hostId. Choose exactly one SSH command variant; do not execute the same command twice.",
                    &["command", "host context"],
                    "This remains a background non-interactive path; do not display its output as terminal output.",
                ),
                guide_step(
                    "interactive",
                    Some("terminal.create"),
                    "For persistent, interactive, or local shell semantics, create a headless PTY and retain its returned sessionId.",
                    &["target or hostId"],
                    "terminal.create does not open a UI Tab; follow with terminal.snapshot/write/close using the explicit sessionId.",
                ),
                guide_step(
                    "interactive-lifecycle",
                    Some("terminal.snapshot"),
                    "Inspect the headless session with its explicit sessionId before writing.",
                    &["sessionId"],
                    "Interactive shell work still remains outside the UI unless the user explicitly requests a visible Tab.",
                ),
                guide_step(
                    "interactive-lifecycle",
                    Some("terminal.write"),
                    "Write the interactive input to the headless session with the same explicit sessionId.",
                    &["sessionId", "data"],
                    "Do not replace the headless session with a visible Tab when the write fails.",
                ),
                guide_step(
                    "interactive-lifecycle",
                    Some("terminal.close"),
                    "Close the headless session after the interactive work completes.",
                    &["sessionId"],
                    "Close only the session created for this operation.",
                ),
                guide_step(
                    "ui-tab",
                    None,
                    "Only when the user explicitly asks to operate a specific visible UI Tab, call terminal.list, confirm that target, then use terminal.snapshot/write with its explicit sessionId; reconnect only that named pane when it is disconnected.",
                    &["explicit UI Tab target", "sessionId"],
                    "If the named UI target is stale, report it and do not substitute another Tab; this branch never happens implicitly after background failure.",
                ),
            ],
            vec![
                "ssh.command",
                "ssh.command_on_resolved_host",
                "terminal.create",
                "terminal.snapshot",
                "terminal.write",
                "terminal.close",
                "terminal.list",
                "terminal.reconnect",
            ],
            vec![
                "Use ssh.command or ssh.command_on_resolved_host directly for the default non-interactive SSH path; do not inspect or switch a UI Tab first.",
                "Use terminal.create and its explicit sessionId for persistent, interactive, or local shell work; close the created session after completion.",
                "Only an explicit UI Tab request permits terminal.list and visible snapshot/write. A stale target is reported without selecting another Tab, and background failures never trigger this branch.",
                "If host metadata is missing, edit hosts/*.toml directly and validate before running background commands.",
                "If credentials are missing, use the existing credential flow when authorized; do not read secrets/.",
            ],
            vec![
                "Use session-terminal for the built-in right-panel Agent when targetBinding-first scope behavior is explicitly required.",
                "After a background SSH operation, inspect managedSsh again when you need proof of session/channel reuse; this does not change the execution target.",
            ],
        )),
        _ => None,
    }
}
