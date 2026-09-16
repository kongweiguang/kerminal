//! Terminal-focused MCP operation guide plans.
//!
//! @author kongweiguang

use super::*;

/// 生成终端相关意图的完整流程；将 headless 创建、targetBinding 首选和后台
/// SSH fallback 集中在此处，避免通用操作指南承担终端策略细节。
pub(super) fn plan(normalized_intent: &str) -> Option<OperationGuidePlan> {
    match normalized_intent {
        "terminal" => Some(guide_plan(
            "terminal",
            vec![
                "kerminal.agent.target_context",
                "terminal.snapshot",
                "terminal.list",
            ],
            vec![
                guide_step(
                    "target",
                    Some("kerminal.agent.target_context"),
                    "Use the live targetBinding as the preferred terminal; it is a convenience target, not an access boundary.",
                    &[],
                    "Every external Agent session has global scope across Kerminal tabs. Do not ask the user to reopen an already available terminal or create a new binding.",
                ),
                guide_step(
                    "ensure-pty",
                    Some("terminal.create"),
                    "If no live target PTY exists, create a headless local or saved-host SSH PTY and continue with its returned sessionId; skip this step when targetBinding is live.",
                    &["target or hostId"],
                    "terminal.create does not open a UI pane or Tab. Close the headless session after the task completes.",
                ),
                guide_step(
                    "inspect",
                    Some("terminal.snapshot"),
                    "Read recent output from the preferred target before writing so the command runs in the user's visible PTY.",
                    &["targetBinding or sessionId"],
                    "If the task names another terminal, discover it with terminal.list and pass its returned sessionId.",
                ),
                guide_step(
                    "act",
                    Some("terminal.write"),
                    "Write the requested input to the preferred live terminal so the command and output remain visible on the left.",
                    &["data"],
                    "Use the targetBinding default or an explicit sessionId from terminal.list; never infer a target from filenames.",
                ),
            ],
            vec![
                "terminal.create",
                "terminal.snapshot",
                "terminal.write",
                "terminal.reconnect",
                "ssh.command",
                "ssh.command_on_resolved_host",
            ],
            vec![
                "If the preferred target is unavailable but another global user terminal is live, use terminal.list and continue with that member; do not ask the user to reopen an already available terminal.",
                "If no live PTY exists, use terminal.create for a headless local or saved-host SSH PTY, then terminal.snapshot/write and terminal.close; use ssh.command or ssh.command_on_resolved_host only for explicitly requested structured background output and state that it is not visible in the left terminal.",
            ],
            vec![
                "Use session-terminal intent inside an Agent session workspace when context files or reconnect handling are needed.",
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
                    "Refresh the current Agent global scope and preferred targetBinding. All user terminals across Kerminal tabs are available; targetBinding only marks the terminal to try first.",
                    &["agentSessionId"],
                    "The right-panel Agent TUI is excluded; a disconnected member remains in scope and can be recovered.",
                ),
                guide_step(
                    "discover",
                    Some("terminal.list"),
                    "Use targetBinding first. Call terminal.list when it is missing/stale or the task names another global user terminal, then retain its sessionId and paneId.",
                    &[],
                    "Use only sessionIds returned for this Agent global scope; membership is checked server-side for explicit selections.",
                ),
                guide_step(
                    "ensure-pty",
                    Some("terminal.create"),
                    "If no live user PTY is available, create a headless local or saved-host SSH PTY and continue with its returned sessionId; skip this step when targetBinding or another listed terminal is live.",
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
                "If the session-scoped endpoint is unavailable, use the global endpoint and targetBinding or an explicit sessionId returned by terminal.list; if no PTY exists, create one with terminal.create instead of asking the user to open a Tab.",
            ],
            vec![
                "Refresh kerminal.agent.target_context and terminal.list after opening a new pane or reconnecting an existing pane.",
            ],
        )),
        "ssh-command" | "ssh" => Some(guide_plan(
            "ssh-command",
            vec![
                "kerminal.agent.target_context",
                "terminal.snapshot",
                "terminal.write",
            ],
            vec![
                guide_step(
                    "target",
                    Some("kerminal.agent.target_context"),
                    "Use the current targetBinding as the preferred live PTY and take host context from it when the command needs a remote target.",
                    &[],
                    "targetBinding is a preference, not a restriction; do not ask the user to reopen an available terminal or create a new binding.",
                ),
                guide_step(
                    "ensure-pty",
                    Some("terminal.create"),
                    "If the preferred target has no live PTY, create a headless local or saved-host SSH PTY and continue through terminal.snapshot/write on its returned sessionId.",
                    &["target or hostId"],
                    "terminal.create works without a UI Tab; close the headless session when the command is complete.",
                ),
                guide_step(
                    "visible",
                    Some("terminal.snapshot"),
                    "Inspect the preferred target PTY, then send the command through terminal.write so it executes visibly in the left terminal.",
                    &["data"],
                    "Use terminal.list only when another global user terminal is requested or targetBinding is unavailable.",
                ),
                guide_step(
                    "visible",
                    Some("terminal.write"),
                    "Write the requested command to the preferred targetBinding PTY so the user can see it execute in the left terminal.",
                    &["data"],
                    "Use the current targetBinding by default; pass an explicit sessionId only when selecting another global user terminal.",
                ),
                guide_step(
                    "fallback",
                    Some("kerminal.runtime_snapshot"),
                    "If no live PTY can perform the work, inspect managed SSH runtime state before selecting a background execution path.",
                    &[],
                    "This inspection is only needed for the background fallback; ordinary visible PTY work does not require a second SSH login.",
                ),
                guide_step(
                    "background",
                    Some("ssh.command_on_resolved_host"),
                    "Run a structured non-interactive command in the background only when a suitable PTY cannot be created or the user explicitly requests background output.",
                    &["hostId", "command"],
                    "The returned stdout/stderr do not appear in the left terminal; do not present them as PTY output and do not embed passwords, tokens, or private keys.",
                ),
            ],
            vec![
                "terminal.create",
                "terminal.snapshot",
                "terminal.write",
                "terminal.list",
                "terminal.reconnect",
                "ssh.command",
                "ssh.command_on_resolved_host",
                "kerminal.agent.target_context",
            ],
            vec![
                "If targetBinding is unavailable but another global user terminal is live, use terminal.list and continue visibly through terminal.write.",
                "If no live PTY exists, use terminal.create and continue with terminal.snapshot/write/close; use ssh.command_on_resolved_host or ssh.command only when a structured background result is explicitly requested or PTY execution is unsuitable, and state that it is not shown in the left terminal.",
                "If host metadata is missing, edit hosts/*.toml directly and validate before running background commands.",
                "If credentials are missing, use the existing credential flow when authorized; do not read secrets/.",
            ],
            vec![
                "For repeated interactive work, keep using the current targetBinding PTY; only switch terminals when the task requires it.",
                "After a background SSH operation, inspect managedSsh again when you need proof of session/channel reuse.",
            ],
        )),
        _ => None,
    }
}
