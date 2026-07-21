//! SSH 远程终端 Tauri Commands。
//!
//! @author kongweiguang

use crate::commands::terminal::{map_terminal_command_error, TerminalCommandResult};
use crate::{
    error::AppError,
    models::terminal::{
        host_terminal_target_ref, SshTerminalCreateRequest, TerminalCommandError,
        TerminalErrorOperation, TerminalOutputEvent, TerminalSessionStatus, TerminalSessionSummary,
    },
    services::external_launch::ExternalLaunchSourceTool,
    state::AppState,
};
use std::{collections::HashMap, sync::LazyLock};
use tauri::{ipc::Channel, AppHandle, Manager};
use tokio::sync::Semaphore;

const EXTERNAL_SSH_CREATE_CONCURRENCY: usize = 4;
const EXTERNAL_SSH_CREATE_SOURCE_CONCURRENCY: usize = 2;
const EXTERNAL_SSH_CREATE_QUEUE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);
const EXTERNAL_SSH_CREATE_TOTAL_DEADLINE: std::time::Duration = std::time::Duration::from_secs(60);
static EXTERNAL_SSH_CREATE_SEMAPHORE: std::sync::OnceLock<std::sync::Arc<Semaphore>> =
    std::sync::OnceLock::new();
static EXTERNAL_SSH_CREATE_SOURCE_SEMAPHORES: LazyLock<
    HashMap<ExternalLaunchSourceTool, std::sync::Arc<Semaphore>>,
> = LazyLock::new(|| {
    [
        ExternalLaunchSourceTool::Putty,
        ExternalLaunchSourceTool::Mobaxterm,
        ExternalLaunchSourceTool::Xshell,
        ExternalLaunchSourceTool::Securecrt,
        ExternalLaunchSourceTool::Openssh,
        ExternalLaunchSourceTool::SftpClient,
        ExternalLaunchSourceTool::KerminalNative,
    ]
    .into_iter()
    .map(|source| {
        (
            source,
            std::sync::Arc::new(Semaphore::new(EXTERNAL_SSH_CREATE_SOURCE_CONCURRENCY)),
        )
    })
    .collect()
});

#[doc(hidden)]
pub mod rules {
    use super::*;

    /// 将可能等待网络超时和重试的 SSH 创建流程移出 Tauri 窗口处理线程。
    ///
    /// worker 保留原有同步 service 契约，避免改变 managed shell 自有 Tokio runtime 的生命周期。
    pub async fn run_ssh_create_task<T, F>(task: F) -> TerminalCommandResult<T>
    where
        T: Send + 'static,
        F: FnOnce() -> TerminalCommandResult<T> + Send + 'static,
    {
        tauri::async_runtime::spawn_blocking(task)
            .await
            .map_err(|error| {
                map_terminal_command_error(TerminalErrorOperation::CreateSession)(
                    AppError::Terminal(format!("SSH 终端创建后台任务失败: {error}")),
                )
            })?
    }

    /// 为外部启动 SSH 创建提供全局并发预算和有界排队时间。
    pub async fn run_bounded_ssh_create_task<T, F>(
        semaphore: std::sync::Arc<Semaphore>,
        queue_timeout: std::time::Duration,
        task: F,
    ) -> TerminalCommandResult<T>
    where
        T: Send + 'static,
        F: FnOnce() -> TerminalCommandResult<T> + Send + 'static,
    {
        let permit = tokio::time::timeout(queue_timeout, semaphore.acquire_owned())
            .await
            .map_err(|_| external_create_busy_error())?
            .map_err(|_| external_create_busy_error())?;
        let result = run_ssh_create_task(task).await;
        drop(permit);
        result
    }

    fn external_create_busy_error() -> TerminalCommandError {
        map_terminal_command_error(TerminalErrorOperation::CreateSession)(AppError::Terminal(
            "外部 SSH 连接队列繁忙，请稍后重试".to_owned(),
        ))
    }
}

/// 创建 SSH 远程终端会话。
#[tauri::command]
pub async fn ssh_create_session(
    app: AppHandle,
    output: Channel<TerminalOutputEvent>,
    request: SshTerminalCreateRequest,
) -> TerminalCommandResult<TerminalSessionSummary> {
    let launch_id =
        crate::services::external_launch::external_launch_id_from_target_id(&request.host_id)
            .map(str::to_owned);
    if let Some(launch_id) = launch_id {
        return create_external_ssh_session(app, output, request, launch_id).await;
    }
    let task = move || {
        let state = app.state::<AppState>();
        let target_ref = host_terminal_target_ref("ssh", &request.host_id);
        let summary = state
            .ssh_terminals()
            .create_session(
                state.remote_hosts(),
                state.paths(),
                state.terminals(),
                request,
                move |event| output.send(event).is_ok(),
            )
            .map_err(map_terminal_command_error(
                TerminalErrorOperation::CreateSession,
            ))?;
        set_target_ref_or_close(&state, summary, target_ref).map_err(map_terminal_command_error(
            TerminalErrorOperation::CreateSession,
        ))
    };
    rules::run_ssh_create_task(task).await
}

/// External create 的总 deadline 包含排队和连接；取消后 worker 晚到成功也必须立即关闭。
async fn create_external_ssh_session(
    app: AppHandle,
    output: Channel<TerminalOutputEvent>,
    request: SshTerminalCreateRequest,
    launch_id: String,
) -> TerminalCommandResult<TerminalSessionSummary> {
    let state = app.state::<AppState>();
    let source_tool = state
        .external_session_materializer()
        .resolve_target(&request.host_id)
        .map_err(map_terminal_command_error(
            TerminalErrorOperation::CreateSession,
        ))?
        .map(|target| target.source_tool)
        .ok_or_else(|| {
            map_terminal_command_error(TerminalErrorOperation::CreateSession)(
                crate::services::ssh_runtime::policy::external_target_not_available_error(
                    &request.host_id,
                ),
            )
        })?;
    let registry = state.external_launch_tasks().clone();
    if let Some(existing_session_id) =
        registry
            .connected_session_id(&launch_id)
            .map_err(map_terminal_command_error(
                TerminalErrorOperation::CreateSession,
            ))?
    {
        let stale = state
            .terminals()
            .session_summary(&existing_session_id)
            .map(|summary| summary.status != TerminalSessionStatus::Running)
            .unwrap_or(true);
        if stale {
            registry
                .release_connected_session(&launch_id, &existing_session_id)
                .map_err(map_terminal_command_error(
                    TerminalErrorOperation::CreateSession,
                ))?;
        }
    }
    let token = registry
        .register(&launch_id)
        .map_err(map_terminal_command_error(
            TerminalErrorOperation::CreateSession,
        ))?;
    let semaphore = EXTERNAL_SSH_CREATE_SEMAPHORE
        .get_or_init(|| std::sync::Arc::new(Semaphore::new(EXTERNAL_SSH_CREATE_CONCURRENCY)))
        .clone();
    let source_semaphore = EXTERNAL_SSH_CREATE_SOURCE_SEMAPHORES
        .get(&source_tool)
        .expect("all external launch source tools have a semaphore")
        .clone();
    let deadline = tokio::time::Instant::now() + EXTERNAL_SSH_CREATE_TOTAL_DEADLINE;
    let permit = tokio::select! {
        _ = token.cancelled() => {
            cleanup_external_launch_runtime(&app, &launch_id, None);
            registry.finish_failed(&launch_id).ok();
            return Err(external_create_cancelled_error());
        }
        _ = tokio::time::sleep_until(deadline) => {
            registry.mark_deadline(&launch_id).ok();
            cleanup_external_launch_runtime(&app, &launch_id, None);
            registry.finish_failed(&launch_id).ok();
            return Err(external_create_deadline_error());
        }
        permit = tokio::time::timeout(EXTERNAL_SSH_CREATE_QUEUE_TIMEOUT, async move {
            let source_permit = source_semaphore.acquire_owned().await;
            let global_permit = semaphore.acquire_owned().await;
            (source_permit, global_permit)
        }) => {
            match permit {
                Ok((Ok(source_permit), Ok(global_permit))) => (source_permit, global_permit),
                Ok(_) | Err(_) => {
                    registry.finish_failed(&launch_id).ok();
                    return Err(external_create_busy_error());
                }
            }
        }
    };
    let marked_in_flight = match registry.mark_in_flight(&launch_id) {
        Ok(marked) => marked,
        Err(error) => {
            drop(permit);
            cleanup_external_launch_runtime(&app, &launch_id, None);
            registry.finish_failed(&launch_id).ok();
            return Err(map_terminal_command_error(
                TerminalErrorOperation::CreateSession,
            )(error));
        }
    };
    if !marked_in_flight {
        drop(permit);
        return Err(external_create_cancelled_error());
    }

    let worker_app = app.clone();
    let output_cancel = token.clone();
    let mut worker = tauri::async_runtime::spawn_blocking(move || {
        let state = worker_app.state::<AppState>();
        let target_ref = host_terminal_target_ref("ssh", &request.host_id);
        let summary = state
            .ssh_terminals()
            .create_session(
                state.remote_hosts(),
                state.paths(),
                state.terminals(),
                request,
                move |event| {
                    let delivered = output.send(event).is_ok();
                    if !delivered {
                        output_cancel.cancel();
                    }
                    delivered
                },
            )
            .map_err(map_terminal_command_error(
                TerminalErrorOperation::CreateSession,
            ))?;
        set_target_ref_or_close(&state, summary, target_ref).map_err(map_terminal_command_error(
            TerminalErrorOperation::CreateSession,
        ))
    });

    tokio::select! {
        result = &mut worker => {
            drop(permit);
            finish_external_create_result(&app, &registry, &launch_id, token, result)
        }
        _ = token.cancelled() => {
            spawn_late_external_cleanup(app, registry, launch_id, worker, permit);
            Err(external_create_cancelled_error())
        }
        _ = tokio::time::sleep_until(deadline) => {
            token.cancel();
            registry.mark_deadline(&launch_id).ok();
            spawn_late_external_cleanup(app, registry, launch_id, worker, permit);
            Err(external_create_deadline_error())
        }
    }
}

/// target binding 失败时关闭刚创建的 session，避免错误路径遗留不可达终端。
fn set_target_ref_or_close(
    state: &AppState,
    summary: TerminalSessionSummary,
    target_ref: String,
) -> crate::error::AppResult<TerminalSessionSummary> {
    match state.terminals().set_target_ref(&summary.id, target_ref) {
        Ok(bound) => Ok(bound),
        Err(error) => {
            let _ = state.terminals().close(&summary.id);
            Err(error)
        }
    }
}

fn finish_external_create_result(
    app: &AppHandle,
    registry: &crate::services::external_launch::ExternalLaunchTaskRegistry,
    launch_id: &str,
    token: tokio_util::sync::CancellationToken,
    result: Result<TerminalCommandResult<TerminalSessionSummary>, tauri::Error>,
) -> TerminalCommandResult<TerminalSessionSummary> {
    let result = match result {
        Ok(result) => result,
        Err(error) => {
            registry.finish_failed(launch_id).ok();
            return Err(map_terminal_command_error(
                TerminalErrorOperation::CreateSession,
            )(AppError::Terminal(format!(
                "SSH 终端创建后台任务失败: {error}"
            ))));
        }
    };
    match result {
        Ok(summary)
            if !token.is_cancelled()
                && registry.complete(launch_id, &summary.id).unwrap_or(false) =>
        {
            spawn_connected_external_cleanup_watcher(
                app.clone(),
                registry.clone(),
                launch_id.to_owned(),
                summary.id.clone(),
                token,
            );
            Ok(summary)
        }
        Ok(summary) => {
            cleanup_external_launch_runtime(app, launch_id, Some(&summary.id));
            registry.finish_failed(launch_id).ok();
            registry.record_late_cleanup().ok();
            Err(external_create_cancelled_error())
        }
        Err(error) => {
            registry.finish_failed(launch_id).ok();
            Err(error)
        }
    }
}

/// WebView/output channel 丢失后主动回收 connected session，避免旧连接阻塞页面恢复。
fn spawn_connected_external_cleanup_watcher(
    app: AppHandle,
    registry: crate::services::external_launch::ExternalLaunchTaskRegistry,
    launch_id: String,
    session_id: String,
    token: tokio_util::sync::CancellationToken,
) {
    tauri::async_runtime::spawn(async move {
        token.cancelled().await;
        if registry
            .release_connected_session(&launch_id, &session_id)
            .unwrap_or(false)
        {
            cleanup_external_launch_runtime(&app, &launch_id, Some(&session_id));
        }
    });
}

fn spawn_late_external_cleanup(
    app: AppHandle,
    registry: crate::services::external_launch::ExternalLaunchTaskRegistry,
    launch_id: String,
    worker: tauri::async_runtime::JoinHandle<TerminalCommandResult<TerminalSessionSummary>>,
    permit: (
        tokio::sync::OwnedSemaphorePermit,
        tokio::sync::OwnedSemaphorePermit,
    ),
) {
    tauri::async_runtime::spawn(async move {
        let result = worker.await;
        drop(permit);
        let session_id = result.ok().and_then(Result::ok).map(|summary| summary.id);
        cleanup_external_launch_runtime(&app, &launch_id, session_id.as_deref());
        registry.finish_failed(&launch_id).ok();
        registry.record_late_cleanup().ok();
    });
}

pub(crate) fn cleanup_external_launch_runtime(
    app: &AppHandle,
    launch_id: &str,
    session_id: Option<&str>,
) {
    let state = app.state::<AppState>();
    if let Some(session_id) = session_id {
        let _ = state.terminals().close(session_id);
    }
    let _ = state
        .external_session_materializer()
        .forget_launch(launch_id);
    let _ = state
        .external_launch_intake()
        .secret_broker()
        .cancel_launch(launch_id);
}

fn external_create_busy_error() -> TerminalCommandError {
    map_terminal_command_error(TerminalErrorOperation::CreateSession)(AppError::Terminal(
        "外部 SSH 连接队列繁忙，请稍后重试".to_owned(),
    ))
}

fn external_create_cancelled_error() -> TerminalCommandError {
    map_terminal_command_error(TerminalErrorOperation::CreateSession)(AppError::Terminal(
        "外部 SSH 连接已取消".to_owned(),
    ))
}

fn external_create_deadline_error() -> TerminalCommandError {
    map_terminal_command_error(TerminalErrorOperation::CreateSession)(AppError::Terminal(
        "外部 SSH 连接超过总时限，已取消".to_owned(),
    ))
}
