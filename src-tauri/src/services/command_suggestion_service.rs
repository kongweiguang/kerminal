//! 命令建议业务服务。
//!
//! @author kongweiguang

use std::{
    collections::{BTreeMap, HashMap, HashSet},
    sync::{Arc, Mutex, MutexGuard},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::storage::command_suggestion_audit as command_suggestion_event_store;
use crate::{
    error::{AppError, AppResult},
    models::{
        command_history::{CommandHistoryEntry, CommandHistorySource, CommandHistoryTarget},
        command_suggestion::{
            CommandSuggestionActivation, CommandSuggestionAuditDecision,
            CommandSuggestionAuditEventKind, CommandSuggestionAuditRecordRequest,
            CommandSuggestionAuditRecordResult, CommandSuggestionCandidate,
            CommandSuggestionCandidateKind, CommandSuggestionDiagnosticsCleanupRequest,
            CommandSuggestionDiagnosticsCleanupResult, CommandSuggestionFeedbackAction,
            CommandSuggestionFeedbackRecordRequest, CommandSuggestionFeedbackRecordResult,
            CommandSuggestionGitRefreshRequest, CommandSuggestionGitRefreshResult,
            CommandSuggestionProviderTelemetry, CommandSuggestionRemoteCommandRefreshRequest,
            CommandSuggestionRemoteCommandRefreshResult,
            CommandSuggestionRemoteHistoryRefreshRequest,
            CommandSuggestionRemoteHistoryRefreshResult, CommandSuggestionRemotePathRefreshRequest,
            CommandSuggestionRemotePathRefreshResult, CommandSuggestionReplacementRange,
            CommandSuggestionRequest, CommandSuggestionSensitivity,
            CommandSuggestionTelemetryExport, CommandSuggestionTelemetrySummary,
            SuggestionProviderKind,
        },
        settings::{
            TerminalInlineSuggestionProductionHostPolicy, TerminalInlineSuggestionSettings,
        },
        sftp::{SftpDirectoryListing, SftpEntry, SftpEntryKind, SftpListDirectoryRequest},
        snippet::{SnippetCatalogListRequest, SnippetScope},
        ssh_command::SshCommandRequest,
    },
    paths::KerminalPaths,
    services::{
        command_history_service::CommandHistoryService, sftp_service::SftpService,
        snippet_catalog_service, snippet_service::SnippetService,
        ssh_command_service::SshCommandService,
    },
    storage::{
        command_suggestion_cache::CommandSuggestionProviderCacheWrite,
        command_suggestion_feedback::CommandSuggestionFeedbackWrite,
        command_suggestion_telemetry::{
            CommandSuggestionTelemetryRow, CommandSuggestionTelemetryUpdate,
        },
        config_file_store::ConfigFileStore,
        file_store::FileStoreError,
        CommandSqliteStore,
    },
};

mod api;
mod cache_utils;
pub mod classification;
pub mod discovery;
mod feedback;
mod git_candidates;
mod history_candidates;
mod model;
mod providers;
mod ranking;
mod refresh;
mod remote_cache_policy;
mod remote_refresh;
mod shell_path;
mod snippet_candidates;
mod spec_candidates;
mod spec_registry;
mod telemetry_persistence;

pub use self::model::{GitRefEntry, GitRefKind};

use self::{
    cache_utils::*, classification::*, discovery::*, feedback::*, git_candidates::*,
    history_candidates::*, model::*, ranking::*, remote_cache_policy::*, remote_refresh::*,
    shell_path::*, snippet_candidates::*, spec_candidates::*, telemetry_persistence::*,
};

const DEFAULT_LIMIT: usize = 8;
const MAX_LIMIT: usize = 50;
const HISTORY_SCAN_LIMIT: usize = 500;
const HISTORY_MENU_SCAN_LIMIT: usize = 512;
const MAX_INPUT_CHARS: usize = 4_000;
const MAX_CONTEXT_CHARS: usize = 1_000;
const MAX_AUDIT_EVENTS_EXPORT: usize = 100;
const DEFAULT_AUDIT_RETENTION_DAYS: u32 = 30;
const DEFAULT_FEEDBACK_RETENTION_DAYS: u32 = 365;
const MAX_DIAGNOSTIC_RETENTION_DAYS: u32 = 3_650;
const MAX_AUDIT_METADATA_ENTRIES: usize = 16;
const MAX_AUDIT_METADATA_KEY_CHARS: usize = 64;
const MAX_AUDIT_METADATA_VALUE_CHARS: usize = 256;
const DEFAULT_REMOTE_PATH_TTL_SECS: u64 = 30;
const MAX_REMOTE_PATH_TTL_SECS: u64 = 300;
const DEFAULT_REMOTE_PATH_MAX_ENTRIES: usize = 250;
const MAX_REMOTE_PATH_MAX_ENTRIES: usize = 1_000;
const MAX_REMOTE_PATH_CACHE_DIRECTORIES: usize = 256;
const REMOTE_REFRESH_GLOBAL_CONCURRENCY: usize = 4;
const REMOTE_REFRESH_PER_HOST_CONCURRENCY: usize = 2;
const REMOTE_REFRESH_BACKOFF_BASE_SECS: u64 = 2;
const REMOTE_REFRESH_BACKOFF_MAX_SECS: u64 = 60;
const REMOTE_REFRESH_COORDINATOR_STALE_SECS: u64 = 3_600;
const REMOTE_PROVIDER_STALE_RETENTION_SECS: u64 = 3_600;
const REMOTE_COMMAND_CACHE_SCOPE_KEY: &str = "";
const DEFAULT_REMOTE_COMMAND_TTL_SECS: u64 = 300;
const MAX_REMOTE_COMMAND_TTL_SECS: u64 = 3_600;
const DEFAULT_REMOTE_COMMAND_MAX_ENTRIES: usize = 1_500;
const MAX_REMOTE_COMMAND_MAX_ENTRIES: usize = 5_000;
const REMOTE_COMMAND_DISCOVERY_TIMEOUT_SECS: u64 = 2;
const REMOTE_COMMAND_DISCOVERY_OUTPUT_BYTES: usize = 64 * 1024;
const REMOTE_HISTORY_CACHE_SCOPE_KEY: &str = "remoteHistory";
const DEFAULT_REMOTE_HISTORY_TTL_SECS: u64 = 900;
const MAX_REMOTE_HISTORY_TTL_SECS: u64 = 86_400;
const DEFAULT_REMOTE_HISTORY_MAX_ENTRIES: usize = 1_000;
const MAX_REMOTE_HISTORY_MAX_ENTRIES: usize = 5_000;
const REMOTE_HISTORY_DISCOVERY_TIMEOUT_SECS: u64 = 2;
const REMOTE_HISTORY_DISCOVERY_OUTPUT_BYTES: usize = 256 * 1024;
const REMOTE_HISTORY_DISCOVERY_SCRIPT: &str = r#"
HISTORY_LINE_LIMIT=3000
HOME_DIR=${HOME:-}
[ -n "$HOME_DIR" ] || exit 0
for file in \
  "$HOME_DIR/.history" \
  "$HOME_DIR/.sh_history" \
  "$HOME_DIR/.ash_history" \
  "$HOME_DIR/.zsh_history" \
  "$HOME_DIR/.bash_history"
do
  [ -r "$file" ] || continue
  tail -n "$HISTORY_LINE_LIMIT" "$file" 2>/dev/null || cat "$file" 2>/dev/null
done
"#;
const DEFAULT_GIT_TTL_SECS: u64 = 60;
const MAX_GIT_TTL_SECS: u64 = 600;
const DEFAULT_GIT_MAX_ENTRIES: usize = 500;
const MAX_GIT_MAX_ENTRIES: usize = 5_000;
const MAX_GIT_CACHE_REPOSITORIES: usize = 128;
const GIT_DISCOVERY_TIMEOUT_SECS: u64 = 2;
const GIT_DISCOVERY_OUTPUT_BYTES: usize = 64 * 1024;
const POSIX_SHELL_BUILTINS: &[&str] = &[
    "alias", "bg", "break", "cd", "command", "continue", "echo", "eval", "exec", "exit", "export",
    "false", "fg", "jobs", "kill", "printf", "pwd", "read", "return", "set", "shift", "test",
    "times", "trap", "true", "type", "ulimit", "umask", "unalias", "unset", "wait",
];
const TELEMETRY_PROVIDER_ORDER: &[SuggestionProviderKind] = &[
    SuggestionProviderKind::History,
    SuggestionProviderKind::RemotePath,
    SuggestionProviderKind::RemoteCommand,
    SuggestionProviderKind::Git,
    SuggestionProviderKind::Spec,
    SuggestionProviderKind::Snippet,
];
/// 命令建议业务入口。
#[derive(Debug)]
pub struct CommandSuggestionService {
    git_ref_cache: Mutex<HashMap<GitCacheKey, GitCacheEntry>>,
    git_refresh: RemoteRefreshRuntime<GitCacheKey, CommandSuggestionGitRefreshResult>,
    pending_telemetry_updates:
        Mutex<HashMap<SuggestionProviderKind, CommandSuggestionTelemetryUpdate>>,
    remote_command_cache: Mutex<HashMap<String, RemoteCommandCacheEntry>>,
    remote_command_refresh:
        RemoteRefreshRuntime<String, CommandSuggestionRemoteCommandRefreshResult>,
    remote_history_cache: Mutex<HashMap<String, RemoteHistoryCacheEntry>>,
    remote_history_refresh:
        RemoteRefreshRuntime<String, CommandSuggestionRemoteHistoryRefreshResult>,
    remote_path_cache: Mutex<HashMap<RemotePathCacheKey, RemotePathCacheEntry>>,
    remote_path_refresh:
        RemoteRefreshRuntime<RemotePathCacheKey, CommandSuggestionRemotePathRefreshResult>,
    telemetry: Mutex<CommandSuggestionTelemetryState>,
}

impl Default for CommandSuggestionService {
    fn default() -> Self {
        let concurrency = Arc::new(
            RemoteRefreshConcurrency::new(
                REMOTE_REFRESH_GLOBAL_CONCURRENCY,
                REMOTE_REFRESH_PER_HOST_CONCURRENCY,
            )
            .expect("远端建议并发常量必须有效"),
        );
        Self {
            git_ref_cache: Mutex::new(HashMap::new()),
            git_refresh: RemoteRefreshRuntime::with_shared_concurrency(
                remote_refresh_policy(MAX_GIT_CACHE_REPOSITORIES),
                Arc::clone(&concurrency),
            )
            .expect("Git refresh policy 常量必须有效"),
            pending_telemetry_updates: Mutex::new(HashMap::new()),
            remote_command_cache: Mutex::new(HashMap::new()),
            remote_command_refresh: RemoteRefreshRuntime::with_shared_concurrency(
                remote_refresh_policy(128),
                Arc::clone(&concurrency),
            )
            .expect("远端命令 refresh policy 常量必须有效"),
            remote_history_cache: Mutex::new(HashMap::new()),
            remote_history_refresh: RemoteRefreshRuntime::with_shared_concurrency(
                remote_refresh_policy(128),
                Arc::clone(&concurrency),
            )
            .expect("远端历史 refresh policy 常量必须有效"),
            remote_path_cache: Mutex::new(HashMap::new()),
            remote_path_refresh: RemoteRefreshRuntime::with_shared_concurrency(
                remote_refresh_policy(MAX_REMOTE_PATH_CACHE_DIRECTORIES),
                concurrency,
            )
            .expect("远端路径 refresh policy 常量必须有效"),
            telemetry: Mutex::new(CommandSuggestionTelemetryState::default()),
        }
    }
}

fn remote_refresh_policy(capacity: usize) -> RemoteCachePolicy {
    RemoteCachePolicy::new(
        capacity,
        Duration::from_millis(1),
        Duration::from_secs(REMOTE_REFRESH_COORDINATOR_STALE_SECS),
        Duration::from_secs(REMOTE_REFRESH_BACKOFF_BASE_SECS),
        Duration::from_secs(REMOTE_REFRESH_BACKOFF_MAX_SECS),
    )
    .expect("远端建议 refresh policy 常量必须有效")
}

#[derive(Debug)]
struct RemoteProbePolicySkip {
    production_host: bool,
    production_host_policy: TerminalInlineSuggestionProductionHostPolicy,
    remote_probe_enabled: bool,
    reason: &'static str,
}
