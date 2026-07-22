//! 真实 SSH/SFTP 命令建议 smoke 测试。
//!
//! @author kongweiguang

use std::{
    collections::HashMap,
    env, fs as std_fs, io,
    net::SocketAddr,
    path::PathBuf,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    },
    time::Duration,
};

use kerminal_lib::{
    models::{
        command_history::CommandHistoryTarget,
        command_suggestion::{
            CommandSuggestionAuditDecision, CommandSuggestionAuditEventKind,
            CommandSuggestionGitRefreshRequest, CommandSuggestionRemoteCommandRefreshRequest,
            CommandSuggestionRemoteHistoryRefreshRequest,
            CommandSuggestionRemotePathRefreshRequest, CommandSuggestionRequest,
            SuggestionProviderKind,
        },
        remote_host::{RemoteHost, RemoteHostAuthType, RemoteHostCreateRequest},
        settings::{
            TerminalInlineSuggestionProductionHostPolicy, TerminalInlineSuggestionSettings,
        },
        sftp::SftpTrustHostKeyRequest,
    },
    paths::KerminalPaths,
    services::{
        command_history_service::CommandHistoryService,
        command_suggestion_service::CommandSuggestionService,
        remote_host_service::RemoteHostService, sftp_service::SftpService,
        ssh_command_service::SshCommandService,
    },
    storage::{config_file_store::ConfigFileStore, CommandSqliteStore},
};
use russh::{
    keys::{self, PrivateKey, PublicKey},
    server::{Auth, Msg, Server as _, Session},
    Channel, ChannelId,
};
use russh_sftp::protocol::{
    Attrs, File as ProtocolFile, FileAttributes, Handle, Name, Status, StatusCode,
};
use tempfile::{tempdir, TempDir};
use tokio::{fs as async_fs, net::TcpListener, time::sleep};

const RUN_FLAG: &str = "RUN_KERMINAL_SSH_SMOKE";

#[path = "command_suggestion_ssh_smoke/cache_limits.rs"]
mod cache_limits;
#[path = "command_suggestion_ssh_smoke/loopback_provider_chain.rs"]
mod loopback_provider_chain;
#[path = "command_suggestion_ssh_smoke/loopback_server.rs"]
mod loopback_server;
#[path = "command_suggestion_ssh_smoke/policy.rs"]
mod policy;
#[path = "command_suggestion_ssh_smoke/real_smoke.rs"]
mod real_smoke;
#[path = "command_suggestion_ssh_smoke/smoke_harness.rs"]
mod smoke_harness;

use self::{
    loopback_server::{
        start_loopback_provider_server, start_loopback_provider_server_with_profile,
        LoopbackProviderProfile, LoopbackProviderServer,
    },
    smoke_harness::{SmokeConfig, SmokeHarness},
};
