//! 前端终端 pane 重连请求/确认协调器。
//!
//! @author kongweiguang

use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::Duration,
};

use serde::{Deserialize, Serialize};
use tokio::{sync::oneshot, time::timeout};

use crate::error::{AppError, AppResult};

/// 前端监听的终端重连事件名。
pub const TERMINAL_RECONNECT_REQUEST_EVENT: &str = "kerminal://terminal-reconnect-request";

const DEFAULT_TIMEOUT_MS: u64 = 30_000;
const MAX_TIMEOUT_MS: u64 = 60_000;
const MIN_TIMEOUT_MS: u64 = 1_000;

/// MCP 请求前端重连指定 pane 的事件 payload。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TerminalReconnectRequest {
    /// 一次请求的幂等关联 id。
    pub request_id: String,
    /// 前端 pane id。
    pub pane_id: String,
    /// 后端等待 ack 的上限，前端无需自行计时。
    pub timeout_ms: u64,
}

/// 前端对重连请求的确认 payload。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TerminalReconnectAck {
    /// 对应请求 id。
    pub request_id: String,
    /// 防止 pane 复用时错误确认另一请求。
    pub pane_id: String,
    /// 前端实际重连结果。
    pub success: bool,
    /// 失败时的用户可读原因，不应包含凭据。
    #[serde(default)]
    pub error: Option<String>,
}

/// 后端返回给 MCP 工具的稳定重连结果。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TerminalReconnectResult {
    /// 对应请求 id。
    pub request_id: String,
    /// 前端 pane id。
    pub pane_id: String,
    /// 重连是否完成。
    pub success: bool,
    /// 失败时的受控原因。
    #[serde(default)]
    pub error: Option<String>,
}

type EmitRequest = Arc<dyn Fn(&TerminalReconnectRequest) -> AppResult<()> + Send + Sync>;

struct PendingReconnect {
    pane_id: String,
    sender: oneshot::Sender<Result<(), String>>,
}

#[derive(Default)]
struct CoordinatorState {
    next_id: u64,
    pending: HashMap<String, PendingReconnect>,
    emitter: Option<EmitRequest>,
}

/// 终端重连请求协调器，负责有界等待和 request/ack 清理。
#[derive(Clone, Default)]
pub struct TerminalReconnectService {
    state: Arc<Mutex<CoordinatorState>>,
}

impl std::fmt::Debug for TerminalReconnectService {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("TerminalReconnectService")
            .field("pending", &self.pending_count())
            .finish()
    }
}

impl TerminalReconnectService {
    /// 注册 Tauri app emitter；应用启动后设置，测试可注入内存 emitter。
    pub fn set_emitter<F>(&self, emitter: F) -> AppResult<()>
    where
        F: Fn(&TerminalReconnectRequest) -> AppResult<()> + Send + Sync + 'static,
    {
        let mut state = self.lock_state()?;
        state.emitter = Some(Arc::new(emitter));
        Ok(())
    }

    /// 请求前端按 pane 当前配置执行一次 reconnect，并等待 ack。
    pub async fn request(
        &self,
        pane_id: impl Into<String>,
        timeout_ms: Option<u64>,
    ) -> AppResult<TerminalReconnectResult> {
        let pane_id = normalize_pane_id(pane_id.into())?;
        let timeout_ms = normalize_timeout(timeout_ms);
        let (request, receiver, emitter) = {
            let mut state = self.lock_state()?;
            let emitter = state.emitter.clone().ok_or_else(|| {
                AppError::InvalidInput(
                    "terminal reconnect frontend bridge is unavailable".to_owned(),
                )
            })?;
            state.next_id = state.next_id.saturating_add(1);
            let request_id = format!("trc_{}", state.next_id);
            let request = TerminalReconnectRequest {
                request_id: request_id.clone(),
                pane_id: pane_id.clone(),
                timeout_ms,
            };
            let (sender, receiver) = oneshot::channel();
            state
                .pending
                .insert(request_id, PendingReconnect { pane_id, sender });
            (request, receiver, emitter)
        };

        if let Err(error) = emitter(&request) {
            self.remove_pending(&request.request_id)?;
            return Err(AppError::InvalidInput(format!(
                "terminal reconnect request could not be delivered: {error}"
            )));
        }

        match timeout(Duration::from_millis(timeout_ms), receiver).await {
            Ok(Ok(Ok(()))) => Ok(TerminalReconnectResult {
                request_id: request.request_id,
                pane_id: request.pane_id,
                success: true,
                error: None,
            }),
            Ok(Ok(Err(error))) => Ok(TerminalReconnectResult {
                request_id: request.request_id,
                pane_id: request.pane_id,
                success: false,
                error: Some(error),
            }),
            Ok(Err(_)) => Err(AppError::InvalidInput(
                "terminal reconnect acknowledgement channel closed".to_owned(),
            )),
            Err(_) => {
                self.remove_pending(&request.request_id)?;
                Err(AppError::InvalidInput(format!(
                    "terminal reconnect timed out after {timeout_ms}ms"
                )))
            }
        }
    }

    /// 接收前端 ack；request id 和 pane id 必须同时匹配。
    pub fn acknowledge(&self, ack: TerminalReconnectAck) -> AppResult<()> {
        let request_id = normalize_request_id(ack.request_id)?;
        let pane_id = normalize_pane_id(ack.pane_id)?;
        let pending = {
            let mut state = self.lock_state()?;
            let pending = state.pending.get(&request_id).ok_or_else(|| {
                AppError::InvalidInput(
                    "terminal reconnect request is not pending or already expired".to_owned(),
                )
            })?;
            if pending.pane_id != pane_id {
                return Err(AppError::InvalidInput(
                    "terminal reconnect acknowledgement paneId mismatch".to_owned(),
                ));
            }
            state
                .pending
                .remove(&request_id)
                .expect("pending entry was checked while holding the same lock")
        };
        let result = if ack.success {
            Ok(())
        } else {
            Err(ack
                .error
                .and_then(normalize_optional_error)
                .unwrap_or_else(|| "前端重连失败".to_owned()))
        };
        pending.sender.send(result).map_err(|_| {
            AppError::InvalidInput("terminal reconnect waiter already closed".to_owned())
        })
    }

    /// 当前等待中的请求数量，仅用于诊断和测试。
    pub fn pending_count(&self) -> usize {
        self.state
            .lock()
            .map(|state| state.pending.len())
            .unwrap_or(0)
    }

    fn remove_pending(&self, request_id: &str) -> AppResult<()> {
        self.lock_state()?.pending.remove(request_id);
        Ok(())
    }

    fn lock_state(&self) -> AppResult<std::sync::MutexGuard<'_, CoordinatorState>> {
        self.state
            .lock()
            .map_err(|_| AppError::StateLockPoisoned("terminal_reconnect_service"))
    }
}

/// 限制 pane id，避免把事件转发成任意路径或未界定的全局操作。
fn normalize_pane_id(value: String) -> AppResult<String> {
    let value = value.trim();
    if value.is_empty() || value.len() > 256 {
        return Err(AppError::InvalidInput(
            "terminal reconnect paneId 不能为空且长度不能超过 256".to_owned(),
        ));
    }
    Ok(value.to_owned())
}

/// 将前端提供的超时限制在可恢复的有界区间内。
fn normalize_timeout(timeout_ms: Option<u64>) -> u64 {
    timeout_ms
        .unwrap_or(DEFAULT_TIMEOUT_MS)
        .clamp(MIN_TIMEOUT_MS, MAX_TIMEOUT_MS)
}

/// 校验 ack request id，并拒绝空值或超长输入。
fn normalize_request_id(value: String) -> AppResult<String> {
    let value = value.trim();
    if value.is_empty() || value.len() > 128 {
        return Err(AppError::InvalidInput(
            "terminal reconnect requestId 不合法".to_owned(),
        ));
    }
    Ok(value.to_owned())
}

/// 限制前端失败原因长度，避免把整段终端输出带回 MCP。
fn normalize_optional_error(value: String) -> Option<String> {
    let value = value.trim();
    if value.is_empty() {
        return None;
    }
    Some(value.chars().take(1024).collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::sync::mpsc;

    #[tokio::test]
    async fn request_ack_success_cleans_pending() {
        let service = TerminalReconnectService::default();
        let (sender, mut receiver) = mpsc::unbounded_channel();
        service
            .set_emitter(move |request| {
                sender.send(request.clone()).expect("request");
                Ok(())
            })
            .expect("emitter");
        let task = tokio::spawn({
            let service = service.clone();
            async move { service.request("pane-a", Some(1_000)).await }
        });
        let request = receiver.recv().await.expect("request emitted");
        service
            .acknowledge(TerminalReconnectAck {
                request_id: request.request_id,
                pane_id: request.pane_id,
                success: true,
                error: None,
            })
            .expect("ack");
        let result = task.await.expect("join").expect("success");
        assert!(result.success);
        assert_eq!(service.pending_count(), 0);
    }

    #[tokio::test]
    async fn request_timeout_cleans_pending() {
        let service = TerminalReconnectService::default();
        service.set_emitter(|_| Ok(())).expect("emitter");
        let error = service
            .request("pane-timeout", Some(MIN_TIMEOUT_MS))
            .await
            .expect_err("timeout");
        assert!(error.to_string().contains("timed out"));
        assert_eq!(service.pending_count(), 0);
    }

    #[tokio::test]
    async fn mismatched_pane_ack_does_not_cancel_the_legitimate_request() {
        let service = TerminalReconnectService::default();
        let (sender, mut receiver) = mpsc::unbounded_channel();
        service
            .set_emitter(move |request| {
                sender.send(request.clone()).expect("request");
                Ok(())
            })
            .expect("emitter");
        let task = tokio::spawn({
            let service = service.clone();
            async move { service.request("pane-a", Some(1_000)).await }
        });
        let request = receiver.recv().await.expect("request emitted");

        let error = service
            .acknowledge(TerminalReconnectAck {
                request_id: request.request_id.clone(),
                pane_id: "pane-b".to_owned(),
                success: true,
                error: None,
            })
            .expect_err("wrong pane must be rejected");
        assert!(error.to_string().contains("paneId mismatch"));
        assert_eq!(service.pending_count(), 1);

        service
            .acknowledge(TerminalReconnectAck {
                request_id: request.request_id,
                pane_id: request.pane_id,
                success: true,
                error: None,
            })
            .expect("legitimate ack");
        assert!(task.await.expect("join").expect("success").success);
        assert_eq!(service.pending_count(), 0);
    }
}
