//! SFTP 传输运行时状态、事件和进度跟踪。
//!
//! @author kongweiguang

use std::{
    collections::HashMap,
    fmt, io,
    pin::Pin,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    task::{Context, Poll},
    time::Duration,
};

use tauri::{Emitter, Window};
use tokio::{
    io::{AsyncRead, AsyncWrite, ReadBuf},
    sync::Notify,
};

use crate::{
    error::{AppError, AppResult},
    models::sftp::{SftpTransferStatus, SftpTransferSummary},
};

use super::unix_timestamp_millis;
use super::{unix_timestamp, SftpRuntimeSettings};

const SFTP_TRANSFER_UPDATED_EVENT: &str = "sftp-transfer-updated";
const SFTP_TRANSFER_PROGRESS_EMIT_INTERVAL_MS: u64 = 200;

#[derive(Debug, Clone)]
pub(super) struct TransferTask {
    pub(super) summary: SftpTransferSummary,
    pub(super) cancel_requested: Arc<AtomicBool>,
    pub(super) speed: TransferSpeedTracker,
}

#[derive(Debug, Clone)]
pub(super) struct TransferSpeedTracker {
    last_sample_at_ms: u64,
    last_sample_bytes: u64,
    speed_bytes_per_second: u64,
}

impl TransferSpeedTracker {
    pub(super) fn new(started_at_ms: u64) -> Self {
        Self {
            last_sample_at_ms: started_at_ms,
            last_sample_bytes: 0,
            speed_bytes_per_second: 0,
        }
    }

    fn update(&mut self, transferred_bytes: u64, now_ms: u64) -> u64 {
        let elapsed_ms = now_ms.saturating_sub(self.last_sample_at_ms);
        if elapsed_ms < SFTP_TRANSFER_PROGRESS_EMIT_INTERVAL_MS {
            return self.speed_bytes_per_second;
        }
        let delta_bytes = transferred_bytes.saturating_sub(self.last_sample_bytes);
        self.speed_bytes_per_second = delta_bytes.saturating_mul(1000) / elapsed_ms.max(1);
        self.last_sample_at_ms = now_ms;
        self.last_sample_bytes = transferred_bytes;
        self.speed_bytes_per_second
    }

    fn reset(&mut self, transferred_bytes: u64, now_ms: u64) {
        self.last_sample_at_ms = now_ms;
        self.last_sample_bytes = transferred_bytes;
        self.speed_bytes_per_second = 0;
    }
}

#[derive(Clone)]
pub(super) struct TransferEventEmitter {
    state: Arc<Mutex<TransferEventEmitterState>>,
    window: Window,
}

impl fmt::Debug for TransferEventEmitter {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("TransferEventEmitter")
            .field("event", &SFTP_TRANSFER_UPDATED_EVENT)
            .finish()
    }
}

#[derive(Debug, Default)]
struct TransferEventEmitterState {
    last_emit_ms: u64,
}

impl TransferEventEmitter {
    pub(super) fn new(window: Window) -> Self {
        Self {
            state: Arc::new(Mutex::new(TransferEventEmitterState::default())),
            window,
        }
    }

    pub(super) fn emit(&self, summary: &SftpTransferSummary, force: bool) {
        let now_ms = unix_timestamp_millis();
        let should_emit = if force {
            true
        } else if let Ok(mut state) = self.state.lock() {
            let due = now_ms.saturating_sub(state.last_emit_ms)
                >= SFTP_TRANSFER_PROGRESS_EMIT_INTERVAL_MS;
            if due {
                state.last_emit_ms = now_ms;
            }
            due
        } else {
            true
        };

        if should_emit {
            if let Ok(mut state) = self.state.lock() {
                state.last_emit_ms = now_ms;
            }
            let _ = self
                .window
                .emit(SFTP_TRANSFER_UPDATED_EVENT, summary.clone());
        }
    }
}

#[derive(Debug, Default)]
pub(super) struct TransferLimiter {
    state: Mutex<TransferLimiterState>,
    notify: Notify,
}

#[derive(Debug, Default)]
struct TransferLimiterState {
    global_running: usize,
    host_running: HashMap<String, usize>,
}

impl TransferLimiter {
    pub(super) async fn acquire(
        self: &Arc<Self>,
        host_id: String,
        settings: SftpRuntimeSettings,
        progress: TransferProgress,
    ) -> AppResult<TransferLimitPermit> {
        loop {
            progress.ensure_not_cancelled()?;
            {
                let mut state = self
                    .state
                    .lock()
                    .map_err(|_| AppError::StateLockPoisoned("sftp transfer limits"))?;
                if state.can_start(&host_id, settings) {
                    state.global_running = state.global_running.saturating_add(1);
                    *state.host_running.entry(host_id.clone()).or_insert(0) += 1;
                    return Ok(TransferLimitPermit {
                        limiter: self.clone(),
                        host_id,
                    });
                }
            }

            tokio::select! {
                _ = self.notify.notified() => {}
                _ = tokio::time::sleep(Duration::from_millis(50)) => {}
            }
        }
    }

    pub(super) async fn acquire_many(
        self: &Arc<Self>,
        host_ids: Vec<String>,
        settings: SftpRuntimeSettings,
        progress: TransferProgress,
    ) -> AppResult<Vec<TransferLimitPermit>> {
        let mut required_by_host = HashMap::<String, usize>::new();
        for host_id in &host_ids {
            *required_by_host.entry(host_id.clone()).or_insert(0) += 1;
        }
        let required_global = host_ids.len();

        loop {
            progress.ensure_not_cancelled()?;
            {
                let mut state = self
                    .state
                    .lock()
                    .map_err(|_| AppError::StateLockPoisoned("sftp transfer limits"))?;
                if state.can_start_many(&required_by_host, required_global, settings) {
                    state.global_running = state.global_running.saturating_add(required_global);
                    for (host_id, count) in &required_by_host {
                        *state.host_running.entry(host_id.clone()).or_insert(0) += count;
                    }
                    return Ok(host_ids
                        .into_iter()
                        .map(|host_id| TransferLimitPermit {
                            limiter: self.clone(),
                            host_id,
                        })
                        .collect());
                }
            }

            tokio::select! {
                _ = self.notify.notified() => {}
                _ = tokio::time::sleep(Duration::from_millis(50)) => {}
            }
        }
    }
}

impl TransferLimiterState {
    fn can_start(&self, host_id: &str, settings: SftpRuntimeSettings) -> bool {
        let host_running = self.host_running.get(host_id).copied().unwrap_or(0);
        self.global_running < settings.global_transfers && host_running < settings.host_transfers
    }

    fn can_start_many(
        &self,
        required_by_host: &HashMap<String, usize>,
        required_global: usize,
        settings: SftpRuntimeSettings,
    ) -> bool {
        if self.global_running.saturating_add(required_global) > settings.global_transfers {
            return false;
        }
        required_by_host.iter().all(|(host_id, required)| {
            self.host_running
                .get(host_id)
                .copied()
                .unwrap_or(0)
                .saturating_add(*required)
                <= settings.host_transfers
        })
    }
}

#[derive(Debug)]
pub(super) struct TransferLimitPermit {
    limiter: Arc<TransferLimiter>,
    host_id: String,
}

impl Drop for TransferLimitPermit {
    fn drop(&mut self) {
        if let Ok(mut state) = self.limiter.state.lock() {
            state.global_running = state.global_running.saturating_sub(1);
            if let Some(host_running) = state.host_running.get_mut(&self.host_id) {
                *host_running = host_running.saturating_sub(1);
                if *host_running == 0 {
                    state.host_running.remove(&self.host_id);
                }
            }
        }
        self.limiter.notify.notify_waiters();
    }
}

#[derive(Clone)]
pub(super) struct TransferProgress {
    transfer_id: Option<String>,
    transfers: Option<Arc<Mutex<HashMap<String, TransferTask>>>>,
    pub(super) cancel_requested: Arc<AtomicBool>,
    event_emitter: Option<TransferEventEmitter>,
}

impl fmt::Debug for TransferProgress {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("TransferProgress")
            .field("transfer_id", &self.transfer_id)
            .field(
                "cancel_requested",
                &self.cancel_requested.load(Ordering::SeqCst),
            )
            .field("event_emitter", &self.event_emitter.is_some())
            .finish()
    }
}

impl TransferProgress {
    pub(super) fn detached() -> Self {
        Self {
            transfer_id: None,
            transfers: None,
            cancel_requested: Arc::new(AtomicBool::new(false)),
            event_emitter: None,
        }
    }

    pub(super) fn detached_with_cancel(cancel_requested: Arc<AtomicBool>) -> Self {
        Self {
            transfer_id: None,
            transfers: None,
            cancel_requested,
            event_emitter: None,
        }
    }

    pub(super) fn tracked(
        transfer_id: String,
        transfers: Arc<Mutex<HashMap<String, TransferTask>>>,
        cancel_requested: Arc<AtomicBool>,
        event_emitter: Option<TransferEventEmitter>,
    ) -> Self {
        Self {
            transfer_id: Some(transfer_id),
            transfers: Some(transfers),
            cancel_requested,
            event_emitter,
        }
    }

    pub(super) fn is_cancelled(&self) -> bool {
        self.cancel_requested.load(Ordering::SeqCst)
    }

    pub(super) fn ensure_not_cancelled(&self) -> AppResult<()> {
        if self.is_cancelled() {
            return Err(AppError::Sftp("传输已取消".to_owned()));
        }
        Ok(())
    }

    pub(super) fn mark_running(&self) {
        self.update_summary(true, |summary| {
            summary.status = SftpTransferStatus::Running;
            summary.phase = Some("running".to_owned());
            summary.updated_at = unix_timestamp();
        });
    }

    pub(super) fn mark_phase(&self, phase: impl Into<String>, current_item: Option<String>) {
        self.update_summary(true, |summary| {
            summary.status = SftpTransferStatus::Running;
            summary.phase = Some(phase.into());
            summary.current_item = current_item;
            summary.updated_at = unix_timestamp();
        });
    }

    pub(super) fn set_total_bytes(&self, total_bytes: u64) {
        self.update_summary(true, |summary| {
            summary.total_bytes = Some(total_bytes);
            summary.updated_at = unix_timestamp();
        });
    }

    pub(super) fn add_total_bytes(&self, bytes: u64) {
        self.update_summary(false, |summary| {
            summary.total_bytes = Some(summary.total_bytes.unwrap_or(0).saturating_add(bytes));
            summary.updated_at = unix_timestamp();
        });
    }

    pub(super) fn add_bytes(&self, bytes: u64) {
        let now_ms = unix_timestamp_millis();
        self.update_task(false, |task| {
            task.summary.bytes_transferred = task.summary.bytes_transferred.saturating_add(bytes);
            task.summary.speed_bytes_per_second =
                task.speed.update(task.summary.bytes_transferred, now_ms);
            task.summary.updated_at = unix_timestamp();
        });
    }

    pub(super) fn succeed(&self) {
        self.update_summary(true, |summary| {
            summary.status = SftpTransferStatus::Succeeded;
            summary.error = None;
            summary.phase = Some("done".to_owned());
            summary.current_item = None;
            summary.speed_bytes_per_second = 0;
            summary.updated_at = unix_timestamp();
        });
    }

    pub(super) fn cancel(&self) {
        self.update_summary(true, |summary| {
            summary.status = SftpTransferStatus::Canceled;
            summary.cancel_requested = true;
            summary.phase = Some("canceled".to_owned());
            summary.current_item = None;
            summary.speed_bytes_per_second = 0;
            summary.updated_at = unix_timestamp();
        });
    }

    pub(super) fn cancel_with_message(&self, error: &AppError) {
        self.update_summary(true, |summary| {
            summary.status = SftpTransferStatus::Canceled;
            summary.cancel_requested = true;
            summary.error = Some(error.to_string());
            summary.phase = Some("canceled".to_owned());
            summary.current_item = None;
            summary.speed_bytes_per_second = 0;
            summary.updated_at = unix_timestamp();
        });
    }

    pub(super) fn fail(&self, error: impl Into<String>) {
        self.update_summary(true, |summary| {
            summary.status = SftpTransferStatus::Failed;
            summary.error = Some(error.into());
            summary.phase = Some("failed".to_owned());
            summary.speed_bytes_per_second = 0;
            summary.updated_at = unix_timestamp();
        });
    }

    fn update_summary(&self, force_event: bool, update: impl FnOnce(&mut SftpTransferSummary)) {
        self.update_task(force_event, |task| update(&mut task.summary));
    }

    fn update_task(&self, force_event: bool, update: impl FnOnce(&mut TransferTask)) {
        let (Some(transfer_id), Some(transfers)) = (&self.transfer_id, &self.transfers) else {
            return;
        };
        let next_summary = if let Ok(mut transfers) = transfers.lock() {
            let next_summary = if let Some(task) = transfers.get_mut(transfer_id) {
                update(task);
                if super::transfer_registry::is_completed_transfer_status(task.summary.status) {
                    task.summary.speed_bytes_per_second = 0;
                    task.speed
                        .reset(task.summary.bytes_transferred, unix_timestamp_millis());
                }
                Some(task.summary.clone())
            } else {
                None
            };
            if next_summary.as_ref().is_some_and(|summary| {
                super::transfer_registry::is_completed_transfer_status(summary.status)
            }) {
                super::transfer_registry::prune_completed_transfers(
                    &mut transfers,
                    unix_timestamp(),
                );
            }
            next_summary
        } else {
            None
        };
        if let (Some(summary), Some(emitter)) = (next_summary, &self.event_emitter) {
            emitter.emit(&summary, force_event);
        }
    }
}

pub(super) struct CancellationReader<R> {
    inner: R,
    progress: TransferProgress,
}

impl<R> CancellationReader<R> {
    pub(super) fn new(inner: R, progress: TransferProgress) -> Self {
        Self { inner, progress }
    }
}

impl<R: AsyncRead + Unpin> AsyncRead for CancellationReader<R> {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        if self.progress.is_cancelled() {
            return Poll::Ready(Err(io::Error::new(
                io::ErrorKind::Interrupted,
                "transfer canceled",
            )));
        }
        Pin::new(&mut self.inner).poll_read(cx, buf)
    }
}

pub(super) struct ProgressWriter<W> {
    inner: W,
    progress: TransferProgress,
}

impl<W> ProgressWriter<W> {
    pub(super) fn new(inner: W, progress: TransferProgress) -> Self {
        Self { inner, progress }
    }
}

impl<W: AsyncWrite + Unpin> AsyncWrite for ProgressWriter<W> {
    fn poll_write(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<io::Result<usize>> {
        if self.progress.is_cancelled() {
            return Poll::Ready(Err(io::Error::new(
                io::ErrorKind::Interrupted,
                "transfer canceled",
            )));
        }
        let poll = Pin::new(&mut self.inner).poll_write(cx, buf);
        if let Poll::Ready(Ok(bytes)) = poll {
            self.progress.add_bytes(bytes as u64);
            return Poll::Ready(Ok(bytes));
        }
        poll
    }

    fn poll_flush(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.inner).poll_flush(cx)
    }

    fn poll_shutdown(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.inner).poll_shutdown(cx)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transfer_speed_tracker_samples_bytes_per_second() {
        let mut tracker = TransferSpeedTracker::new(1_000);

        assert_eq!(tracker.update(10_000, 1_100), 0);
        assert_eq!(tracker.update(20_000, 1_250), 80_000);
        assert_eq!(tracker.update(30_000, 1_300), 80_000);
        assert_eq!(tracker.update(50_000, 1_500), 120_000);

        tracker.reset(50_000, 1_500);
        assert_eq!(tracker.update(60_000, 1_750), 40_000);
    }
}
