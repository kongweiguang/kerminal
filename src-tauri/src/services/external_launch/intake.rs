//! External launch intake queue and startup bridge model.
//!
//! @author kongweiguang

use std::{
    collections::{HashMap, VecDeque},
    fmt,
    sync::{Arc, LazyLock, Mutex},
    time::{Duration, Instant},
};

use sha2::{Digest, Sha256};
use tokio::sync::Semaphore;

use super::{
    classifier::infer_source_tool_from_args,
    model::{
        ExternalLaunchEntrypoint, ExternalLaunchParseInput, ExternalLaunchSourceTool,
        ExternalSshLaunchRequest,
    },
    parser::ExternalLaunchParserRegistry,
    secret::{prepare_request_password_file, ExternalLaunchSecretBroker},
};
use crate::error::{AppError, AppResult};

mod delivery;
mod health;
mod queue;
mod support;
mod types;
pub use health::ExternalLaunchRuntimeHealthSnapshot;
use support::*;
pub use types::*;

pub const EXTERNAL_SSH_LAUNCH_EVENT: &str = "kerminal-external-ssh-launch";
pub const EXTERNAL_LAUNCH_PENDING_CAPACITY: usize = 128;
pub const EXTERNAL_LAUNCH_CLAIM_LEASE: Duration = Duration::from_secs(30);
pub const EXTERNAL_LAUNCH_DEDUP_TTL: Duration = Duration::from_secs(10 * 60);
const EXTERNAL_LAUNCH_DELIVERY_HISTORY_CAPACITY: usize = 512;
const EXTERNAL_LAUNCH_WORKER_TIMEOUT: Duration = Duration::from_secs(5);
const EXTERNAL_LAUNCH_WORKER_QUEUE_TIMEOUT: Duration = Duration::from_millis(500);
const EXTERNAL_LAUNCH_WORKER_CAPACITY: usize = 4;
static EXTERNAL_LAUNCH_WORKERS: LazyLock<Semaphore> =
    LazyLock::new(|| Semaphore::new(EXTERNAL_LAUNCH_WORKER_CAPACITY));

/// Accepts launch argv from cold start, single-instance, shim, or future protocol entrypoints.
#[derive(Clone)]
pub struct ExternalLaunchIntake {
    inner: Arc<ExternalLaunchIntakeInner>,
}

struct ExternalLaunchIntakeInner {
    health: Mutex<health::ExternalLaunchRuntimeHealth>,
    parser: ExternalLaunchParserRegistry,
    policy: Mutex<ExternalLaunchPolicy>,
    secrets: ExternalLaunchSecretBroker,
    state: Mutex<ExternalLaunchIntakeState>,
}

#[derive(Debug, Default)]
struct ExternalLaunchIntakeState {
    pending: VecDeque<ExternalSshLaunchRequest>,
    active: HashMap<String, ExternalLaunchClaim>,
    acknowledged: HashMap<String, Instant>,
    queued_at: HashMap<String, Instant>,
    claim_sequence: u64,
    accepted_count: u64,
    rejected_count: u64,
    noop_count: u64,
    last_rejection: Option<ExternalLaunchRejected>,
}

#[derive(Debug)]
struct ExternalLaunchClaim {
    request: ExternalSshLaunchRequest,
    lease_expires_at: Instant,
    sequence: u64,
}

impl Default for ExternalLaunchIntake {
    fn default() -> Self {
        Self::new()
    }
}

impl fmt::Debug for ExternalLaunchIntake {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ExternalLaunchIntake")
            .field("snapshot", &self.snapshot().ok())
            .finish()
    }
}

impl ExternalLaunchIntake {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(ExternalLaunchIntakeInner {
                health: Mutex::new(health::ExternalLaunchRuntimeHealth::default()),
                parser: ExternalLaunchParserRegistry::new(),
                policy: Mutex::new(ExternalLaunchPolicy::default()),
                secrets: ExternalLaunchSecretBroker::new(),
                state: Mutex::new(ExternalLaunchIntakeState::default()),
            }),
        }
    }

    pub fn with_policy(policy: ExternalLaunchPolicy) -> Self {
        Self {
            inner: Arc::new(ExternalLaunchIntakeInner {
                health: Mutex::new(health::ExternalLaunchRuntimeHealth::default()),
                parser: ExternalLaunchParserRegistry::new(),
                policy: Mutex::new(policy),
                secrets: ExternalLaunchSecretBroker::new(),
                state: Mutex::new(ExternalLaunchIntakeState::default()),
            }),
        }
    }

    pub fn secret_broker(&self) -> &ExternalLaunchSecretBroker {
        &self.inner.secrets
    }

    pub fn configure_policy(&self, policy: ExternalLaunchPolicy) -> AppResult<()> {
        *self.policy()? = policy;
        Ok(())
    }

    pub fn policy_snapshot(&self) -> AppResult<ExternalLaunchPolicy> {
        Ok(self.policy()?.clone())
    }

    pub fn accept_args(
        &self,
        argv: Vec<String>,
        cwd: Option<String>,
        entrypoint: ExternalLaunchEntrypoint,
    ) -> AppResult<ExternalLaunchAcceptOutcome> {
        self.accept_args_with_parent_command_line(argv, cwd, entrypoint, None)
    }

    pub fn accept_args_with_parent_command_line(
        &self,
        argv: Vec<String>,
        cwd: Option<String>,
        entrypoint: ExternalLaunchEntrypoint,
        parent_command_line: Option<String>,
    ) -> AppResult<ExternalLaunchAcceptOutcome> {
        let summary = ExternalLaunchArgSummary::new(&argv, cwd.as_deref());
        let source_tool = infer_source_tool_from_args(&argv);
        log_external_launch_args(entrypoint, "direct", source_tool, &summary);
        let Some(source_tool) = source_tool else {
            let outcome = ExternalLaunchAcceptOutcome::Noop(ExternalLaunchNoop {
                entrypoint,
                reason: "no external SSH launch arguments detected".to_owned(),
                arg_count: argv.len(),
                cwd_present: cwd.as_ref().is_some_and(|value| !value.trim().is_empty()),
            });
            self.state()?.noop_count += 1;
            log_external_launch_noop(entrypoint, &summary);
            return Ok(outcome);
        };
        let policy = self.policy_snapshot()?;
        if let Some(message) = policy_rejection_message(&policy, source_tool) {
            let rejected =
                self.record_policy_rejection(entrypoint, Some(source_tool), message, summary)?;
            return Ok(ExternalLaunchAcceptOutcome::Rejected(rejected));
        }

        let input = ExternalLaunchParseInput::from_args(
            entrypoint,
            Some(source_tool),
            Some(source_tool.as_str().to_owned()),
            argv,
        );
        let input = ExternalLaunchParseInput::from_args_with_parent_command_line(
            input.entrypoint,
            input.source_tool,
            input.persona,
            input.argv,
            parent_command_line,
        );
        match self.inner.parser.parse(&input) {
            Ok(mut request) => {
                apply_policy_options(&policy, &mut request);
                let request = match self.inner.secrets.protect_request(request) {
                    Ok(request) => request,
                    Err(error) => {
                        let rejected =
                            self.record_rejection(entrypoint, Some(source_tool), error, summary)?;
                        return Ok(ExternalLaunchAcceptOutcome::Rejected(rejected));
                    }
                };
                log_external_launch_queued(entrypoint, &request);
                self.enqueue_request(request, entrypoint, summary)
            }
            Err(error) => {
                log_external_launch_rejected(entrypoint, source_tool, &summary, &error);
                let rejected =
                    self.record_rejection(entrypoint, Some(source_tool), error, summary)?;
                Ok(ExternalLaunchAcceptOutcome::Rejected(rejected))
            }
        }
    }

    /// 在有界 blocking worker 中完成父进程发现、parser 和文件读取，避免阻塞窗口线程。
    pub async fn accept_args_bounded(
        &self,
        argv: Vec<String>,
        cwd: Option<String>,
        entrypoint: ExternalLaunchEntrypoint,
    ) -> AppResult<ExternalLaunchAcceptOutcome> {
        let parent_command_line =
            super::parent_process::direct_parent_command_line_for_args_bounded(argv.clone()).await;
        self.accept_args_with_parent_command_line_bounded(
            argv,
            cwd,
            entrypoint,
            parent_command_line,
        )
        .await
    }

    /// 接收调用方已捕获的父进程命令行，其余潜在阻塞工作仍在有界 worker 中执行。
    pub async fn accept_args_with_parent_command_line_bounded(
        &self,
        argv: Vec<String>,
        cwd: Option<String>,
        entrypoint: ExternalLaunchEntrypoint,
        parent_command_line: Option<String>,
    ) -> AppResult<ExternalLaunchAcceptOutcome> {
        let intake_started_at = Instant::now();
        let summary = ExternalLaunchArgSummary::new(&argv, cwd.as_deref());
        let source_tool = infer_source_tool_from_args(&argv);
        log_external_launch_args(entrypoint, "direct", source_tool, &summary);
        let Some(source_tool) = source_tool else {
            let outcome = ExternalLaunchAcceptOutcome::Noop(ExternalLaunchNoop {
                entrypoint,
                reason: "no external SSH launch arguments detected".to_owned(),
                arg_count: argv.len(),
                cwd_present: cwd.as_ref().is_some_and(|value| !value.trim().is_empty()),
            });
            self.state()?.noop_count += 1;
            log_external_launch_noop(entrypoint, &summary);
            return Ok(outcome);
        };
        let policy = self.policy_snapshot()?;
        if let Some(message) = policy_rejection_message(&policy, source_tool) {
            let rejected =
                self.record_policy_rejection(entrypoint, Some(source_tool), message, summary)?;
            return Ok(ExternalLaunchAcceptOutcome::Rejected(rejected));
        }
        let input = ExternalLaunchParseInput::from_args_with_parent_command_line(
            entrypoint,
            Some(source_tool),
            Some(source_tool.as_str().to_owned()),
            argv,
            parent_command_line,
        );
        let request = match parse_request_bounded(input).await {
            Ok(request) => request,
            Err(error) => {
                log_external_launch_rejected(entrypoint, source_tool, &summary, &error);
                let rejected =
                    self.record_rejection(entrypoint, Some(source_tool), error, summary)?;
                return Ok(ExternalLaunchAcceptOutcome::Rejected(rejected));
            }
        };
        let outcome = self.finish_prepared_request(request, policy, entrypoint, summary);
        self.record_intake_latency(intake_started_at);
        outcome
    }
}
