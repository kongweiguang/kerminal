//! 本地 PTY 与 managed SSH 终端会话的创建编排。
//!
//! @author kongweiguang

use super::{
    io_runtime::{
        pty_output_channel, spawn_child_exit_waiter_thread, spawn_reader_thread, CleanupPathGuard,
    },
    managed_shell_channel::TERMINAL_WRITE_MAX_BYTES,
    normalize_size, normalize_target_ref,
    output_flusher::{spawn_output_flusher_thread, OutputFlusherState},
    output_state::TerminalOutputBuffer,
    pump_metrics::SharedPtyOutputPumpStats,
    transport::{create_pty_transport, spawn_managed_shell_io},
    OutputEmitter, TerminalManagedShellCreateRequest, TerminalManagedShellRuntime, TerminalSession,
    TERMINAL_TARGET_TOKEN_TTL_MS,
};
use crate::{
    error::{AppError, AppResult},
    models::terminal::{
        TerminalAgentSignalSummary, TerminalCreateRequest, TerminalPtyOutputPumpStats,
        TerminalSecretInputPlan, TerminalSessionStatus, TerminalSessionSummary,
        TerminalShellIntegrationSummary,
    },
    services::{
        pty_process_guard::{with_conpty_lifecycle_lock, PtyMasterGuard, PtyProcessGuard},
        terminal_agent_signal_detector::TerminalAgentSignalDetector,
        terminal_shell_integration::build_terminal_shell_launch,
    },
};
use portable_pty::{native_pty_system, CommandBuilder};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};
use uuid::Uuid;

const KERMINAL_AGENT_SESSION_ID_ENV: &str = "KERMINAL_AGENT_SESSION_ID";
const INHERITED_TERMINAL_COLOR_OPT_OUT_ENV_KEYS: [&str; 3] =
    ["NO_COLOR", "FORCE_COLOR", "CLICOLOR"];

/// 已完成资源构造、尚未登记到 manager registry 的终端会话。
pub(super) struct CreatedTerminalSession {
    cleanup_guard: Option<CleanupPathGuard>,
    session: TerminalSession,
    session_id: String,
    summary: TerminalSessionSummary,
}

impl CreatedTerminalSession {
    /// 登记成功后才解除 cleanup guard，保持 registry 加锁失败时的原有清理语义。
    pub(super) fn register(
        self,
        sessions: &mut HashMap<String, TerminalSession>,
    ) -> TerminalSessionSummary {
        let Self {
            cleanup_guard,
            session,
            session_id,
            summary,
        } = self;
        sessions.insert(session_id, session);
        if let Some(cleanup_guard) = cleanup_guard {
            cleanup_guard.disarm();
        }
        summary
    }
}

/// 创建 managed SSH shell 会话，返回尚未登记的完整 session aggregate。
pub(super) fn create_managed_shell_session(
    request: TerminalManagedShellCreateRequest,
    shell: TerminalManagedShellRuntime,
    target_token_signer: &super::TerminalTargetTokenSigner,
    output: OutputEmitter,
) -> AppResult<CreatedTerminalSession> {
    let size = normalize_size(request.rows, request.cols)?;
    let shell_name = normalize_shell(Some(request.shell))?;
    let cwd = normalize_display_cwd(request.cwd)?;
    let target_ref = normalize_target_ref(request.target_ref);

    let session_id = Uuid::new_v4().to_string();
    let target_token = target_ref.as_deref().map(|target_ref| {
        target_token_signer.sign_binding_register_now(
            &session_id,
            target_ref,
            TERMINAL_TARGET_TOKEN_TTL_MS,
        )
    });
    let output_buffer = Arc::new(Mutex::new(TerminalOutputBuffer::default()));
    let log_sink = Arc::new(Mutex::new(None));
    let latest_agent_signal = Arc::new(Mutex::new(None));
    let agent_detector = Arc::new(Mutex::new(TerminalAgentSignalDetector::new()));
    let (pump_sender, pump_receiver) = pty_output_channel(&session_id);
    let pump_stats: SharedPtyOutputPumpStats = Arc::new(Mutex::new(
        TerminalPtyOutputPumpStats::new(session_id.clone()),
    ));
    let flusher_state = OutputFlusherState {
        output_buffer: Arc::clone(&output_buffer),
        log_sink: Arc::clone(&log_sink),
        latest_agent_signal: Arc::clone(&latest_agent_signal),
        pump_stats: Arc::clone(&pump_stats),
    };
    spawn_output_flusher_thread(
        session_id.clone(),
        None,
        pump_receiver,
        flusher_state,
        output,
    );

    let startup_input = normalize_startup_input(request.startup_input)?;
    let (reader, writer, transport) = spawn_managed_shell_io(shell, startup_input);
    let _reader_done = spawn_reader_thread(
        reader,
        Vec::new(),
        writer,
        None,
        pump_sender,
        agent_detector,
    );
    let shell_integration = TerminalShellIntegrationSummary::disabled("managed SSH shell channel");
    let summary = TerminalSessionSummary {
        id: session_id.clone(),
        shell: shell_name.clone(),
        cwd: cwd.clone(),
        cols: size.cols,
        rows: size.rows,
        pid: None,
        status: TerminalSessionStatus::Running,
        target_ref: target_ref.clone(),
        target_token: target_token
            .as_ref()
            .map(super::TerminalTargetCapability::token),
        shell_integration: shell_integration.clone(),
        agent_session_id: None,
        agent_signal: None,
    };
    let session = TerminalSession {
        cols: size.cols,
        cwd,
        id: session_id.clone(),
        pid: None,
        rows: size.rows,
        shell: shell_name,
        shell_integration,
        target_ref,
        target_token,
        output_buffer,
        log_sink,
        latest_agent_signal,
        pump_stats,
        agent_session_id: None,
        cleanup_paths: Vec::new(),
        transport,
    };

    Ok(CreatedTerminalSession {
        cleanup_guard: None,
        session,
        session_id,
        summary,
    })
}

/// 创建本地 PTY 会话，并保持 reader、child waiter 与 cleanup guard 的原有启动顺序。
pub(super) fn create_pty_session(
    request: TerminalCreateRequest,
    secret_input_plan: Option<TerminalSecretInputPlan>,
    shell_integration_cache: &Path,
    output: OutputEmitter,
) -> AppResult<CreatedTerminalSession> {
    let TerminalCreateRequest {
        shell,
        args,
        cwd,
        cols,
        rows,
        env,
        cleanup_paths,
    } = request;
    let cleanup_guard = CleanupPathGuard::new(cleanup_paths.clone());
    let size = normalize_size(rows, cols)?;
    let shell = normalize_shell(shell)?;
    let cwd = normalize_cwd(cwd)?;
    let cwd_summary = cwd.as_ref().map(|path| path.to_string_lossy().into_owned());
    let agent_session_id = normalize_agent_session_id(env.get(KERMINAL_AGENT_SESSION_ID_ENV));
    let launch_plan = build_terminal_shell_launch(&shell, &args, &env, shell_integration_cache);

    let mut command = CommandBuilder::new(&launch_plan.shell);
    // GUI/开发宿主设置的无色变量不应污染新 PTY；profile 显式值会在下方重新写入。
    for key in INHERITED_TERMINAL_COLOR_OPT_OUT_ENV_KEYS {
        command.env_remove(key);
    }
    command.args(launch_plan.args.iter().map(String::as_str));
    if let Some(cwd) = &cwd {
        command.cwd(cwd.as_os_str());
    }
    for (key, value) in &launch_plan.env {
        command.env(key, value);
    }

    let (pair, child) = with_conpty_lifecycle_lock(|| {
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(size)
            .map_err(|error| AppError::Terminal(error.to_string()))?;
        let child = pair
            .slave
            .spawn_command(command)
            .map_err(|error| AppError::Terminal(error.to_string()))?;
        Ok::<_, AppError>((pair, child))
    })?;
    let process_guard = PtyProcessGuard::new(child);
    let pid = process_guard.pid();
    let process_child = process_guard.shared_child();
    let master = PtyMasterGuard::new(pair.master);
    let reader = master.try_clone_reader().map_err(AppError::Terminal)?;
    let writer = master.take_writer().map_err(AppError::Terminal)?;
    let (writer, transport) = create_pty_transport(process_guard, master, writer);

    let session_id = Uuid::new_v4().to_string();
    let output_buffer = Arc::new(Mutex::new(TerminalOutputBuffer::default()));
    let log_sink = Arc::new(Mutex::new(None));
    let latest_agent_signal: Arc<Mutex<Option<TerminalAgentSignalSummary>>> =
        Arc::new(Mutex::new(None));
    let agent_detector = Arc::new(Mutex::new(TerminalAgentSignalDetector::new()));
    let (pump_sender, pump_receiver) = pty_output_channel(&session_id);
    let pump_stats: SharedPtyOutputPumpStats = Arc::new(Mutex::new(
        TerminalPtyOutputPumpStats::new(session_id.clone()),
    ));
    let flusher_state = OutputFlusherState {
        output_buffer: Arc::clone(&output_buffer),
        log_sink: Arc::clone(&log_sink),
        latest_agent_signal: Arc::clone(&latest_agent_signal),
        pump_stats: Arc::clone(&pump_stats),
    };
    spawn_output_flusher_thread(
        session_id.clone(),
        agent_session_id.clone(),
        pump_receiver,
        flusher_state,
        output,
    );
    let reader_done = spawn_reader_thread(
        reader,
        cleanup_paths.clone(),
        Arc::clone(&writer),
        secret_input_plan,
        pump_sender.clone(),
        Arc::clone(&agent_detector),
    );
    spawn_child_exit_waiter_thread(
        session_id.clone(),
        process_child,
        pump_sender,
        reader_done,
        cleanup_paths.clone(),
        agent_detector,
    );

    let summary = TerminalSessionSummary {
        id: session_id.clone(),
        shell,
        cwd: cwd_summary.clone(),
        cols: size.cols,
        rows: size.rows,
        pid,
        status: TerminalSessionStatus::Running,
        target_ref: None,
        target_token: None,
        shell_integration: launch_plan.integration.clone(),
        agent_session_id: agent_session_id.clone(),
        agent_signal: None,
    };
    let session = TerminalSession {
        cols: size.cols,
        cwd: cwd_summary,
        id: session_id.clone(),
        pid,
        rows: size.rows,
        shell: summary.shell.clone(),
        shell_integration: summary.shell_integration.clone(),
        target_ref: None,
        target_token: None,
        output_buffer,
        log_sink,
        latest_agent_signal,
        pump_stats,
        agent_session_id,
        cleanup_paths,
        transport,
    };

    Ok(CreatedTerminalSession {
        cleanup_guard: Some(cleanup_guard),
        session,
        session_id,
        summary,
    })
}

pub(super) fn terminal_target_ref_log_label(target_ref: Option<&str>) -> String {
    let Some(target_ref) = target_ref else {
        return "<none>".to_owned();
    };
    let Some(launch_id) = target_ref.strip_prefix("ssh:external:") else {
        return target_ref.to_owned();
    };
    format!(
        "ssh:external:request_hash={}",
        crate::services::external_launch::redaction::opaque_id_hash(launch_id)
    )
}

fn normalize_shell(shell: Option<String>) -> AppResult<String> {
    let shell = shell.unwrap_or_else(default_shell);
    let shell = shell.trim().to_owned();
    if shell.is_empty() {
        return Err(AppError::InvalidInput("shell 不能为空".to_owned()));
    }
    Ok(shell)
}

fn normalize_display_cwd(cwd: Option<String>) -> AppResult<Option<String>> {
    cwd.map(|value| {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            return Err(AppError::InvalidInput("工作目录不能为空".to_owned()));
        }
        Ok(trimmed.to_owned())
    })
    .transpose()
}

fn normalize_startup_input(input: Option<String>) -> AppResult<Option<String>> {
    input
        .map(|value| {
            if value.is_empty() {
                return Err(AppError::InvalidInput(
                    "managed SSH shell startup input cannot be empty".to_owned(),
                ));
            }
            if value.contains('\0') {
                return Err(AppError::InvalidInput(
                    "managed SSH shell startup input cannot contain NUL".to_owned(),
                ));
            }
            if value.len() > TERMINAL_WRITE_MAX_BYTES {
                return Err(AppError::InvalidInput(format!(
                    "managed SSH shell startup input exceeds per-write limit: {} bytes > {} bytes",
                    value.len(),
                    TERMINAL_WRITE_MAX_BYTES
                )));
            }
            Ok(value)
        })
        .transpose()
}

fn normalize_agent_session_id(value: Option<&String>) -> Option<String> {
    value
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
}

fn normalize_cwd(cwd: Option<String>) -> AppResult<Option<PathBuf>> {
    cwd.map(|value| {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            return Err(AppError::InvalidInput("工作目录不能为空".to_owned()));
        }
        let path = PathBuf::from(trimmed);
        if !path.exists() {
            return Err(AppError::InvalidInput("工作目录不存在".to_owned()));
        }
        if !path.is_dir() {
            return Err(AppError::InvalidInput("工作目录必须是文件夹".to_owned()));
        }
        Ok(path)
    })
    .transpose()
}

fn default_shell() -> String {
    #[cfg(target_os = "windows")]
    {
        "powershell.exe".to_owned()
    }

    #[cfg(not(target_os = "windows"))]
    {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_owned())
    }
}
