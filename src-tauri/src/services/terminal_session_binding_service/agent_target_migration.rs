// @author kongweiguang

use super::{
    state::TerminalSessionBindingState, AgentTargetBindingSnapshot, AgentTargetBindingStatus,
    TerminalSessionBindingSnapshot,
};

/// 同一逻辑 pane 的底层终端重连后，把仍指向旧 session 的 Agent 迁移到替代 session。
///
/// pane id 只表达界面位置，不能单独作为远端身份；当两侧都有权威 targetRef 时必须一致，
/// 避免 pane 被其它主机复用时把仍在运行的 Agent 静默切到错误目标。
pub(super) fn migrate_agent_targets_to_replacement_binding(
    state: &mut TerminalSessionBindingState,
    replacement: &TerminalSessionBindingSnapshot,
    occurred_at_ms: u64,
) {
    let agent_session_ids = state
        .agent_targets
        .iter()
        .filter(|(_, target)| {
            target.pane_id == replacement.pane_id
                && target.target_terminal_session_id != replacement.session_id
                && agent_target_matches_replacement(target, replacement)
        })
        .map(|(agent_session_id, _)| agent_session_id.clone())
        .collect::<Vec<_>>();
    let metadata = replacement.metadata.as_ref();

    for agent_session_id in agent_session_ids {
        let generation = state.next_generation();
        if let Some(target) = state.agent_targets.get_mut(&agent_session_id) {
            target.binding_id = format!("atb_{generation}");
            target.generation = generation;
            target.status = AgentTargetBindingStatus::Live;
            target.live = true;
            target.stale = false;
            target.updated_at_ms = occurred_at_ms;
            target.target_terminal_session_id = replacement.session_id.clone();
            target.tab_id = metadata.and_then(|value| value.tab_id.clone());
            target.target_ref = metadata.and_then(|value| value.target_ref.clone());
            target.cwd = metadata.and_then(|value| value.cwd.clone());
            target.shell = metadata.and_then(|value| value.shell.clone());
        }
    }
}

fn agent_target_matches_replacement(
    target: &AgentTargetBindingSnapshot,
    replacement: &TerminalSessionBindingSnapshot,
) -> bool {
    let replacement_target_ref = replacement
        .metadata
        .as_ref()
        .and_then(|metadata| metadata.target_ref.as_deref());
    match (target.target_ref.as_deref(), replacement_target_ref) {
        (Some(current), Some(next)) => current == next,
        (None, None) => true,
        _ => false,
    }
}
