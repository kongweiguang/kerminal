//! AppState 的本地终端能力组合。
//! @author kongweiguang

use crate::{
    paths::KerminalPaths,
    services::{
        terminal_manager::TerminalManager, terminal_reconnect_service::TerminalReconnectService,
        terminal_session_binding_service::TerminalSessionBindingService,
    },
};

/// 本地终端会话和 pane/session 绑定能力集合。
#[derive(Debug)]
pub(super) struct TerminalCapabilities {
    pub(super) session_bindings: TerminalSessionBindingService,
    pub(super) reconnect: TerminalReconnectService,
    pub(super) terminals: TerminalManager,
}

impl TerminalCapabilities {
    pub(super) fn new(paths: &KerminalPaths) -> Self {
        Self {
            session_bindings: TerminalSessionBindingService::default(),
            reconnect: TerminalReconnectService::default(),
            terminals: TerminalManager::with_shell_integration_cache_dir(paths.cache.clone()),
        }
    }
}
