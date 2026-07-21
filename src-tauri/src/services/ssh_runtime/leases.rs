//! Managed SSH session handles and channel leases.
//!
//! @author kongweiguang

use std::{fmt, sync::Arc, time::Duration};

use tokio::sync::OwnedSemaphorePermit;

use crate::error::{AppError, AppResult};

use super::{
    release_channel, ManagedSshSessionManager, ManagedSshSessionManagerInner, SshChannelKind,
    SshRuntimeDynamicForwardRequest, SshRuntimeExecOutput, SshRuntimeExecRequest,
    SshRuntimeForwardTask, SshRuntimeLocalForwardRequest, SshRuntimeRemoteDynamicForwardRequest,
    SshRuntimeRemoteForwardRequest, SshRuntimeSftpStream, SshRuntimeShellEvent,
    SshRuntimeShellRequest, SshRuntimeShellSession, SshRuntimeStreamingExecExit,
    SshRuntimeStreamingExecReader, SshRuntimeStreamingExecRequest, SshRuntimeStreamingExecSession,
    SshRuntimeStreamingExecWriter, SshSessionKey,
};

/// Handle representing one logical user of a managed SSH session.
pub struct ManagedSshSessionHandle {
    pub(super) inner: Arc<ManagedSshSessionManagerInner>,
    pub(super) key: SshSessionKey,
    pub(super) session_id: String,
}

impl fmt::Debug for ManagedSshSessionHandle {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ManagedSshSessionHandle")
            .field("session_id", &self.session_id)
            .finish_non_exhaustive()
    }
}

impl ManagedSshSessionHandle {
    pub fn session_id(&self) -> &str {
        &self.session_id
    }

    pub fn open_channel(&self, kind: SshChannelKind) -> AppResult<ManagedSshChannel> {
        ManagedSshSessionManager::open_channel(&self.inner, &self.key, &self.session_id, kind)
    }

    pub async fn execute_exec(
        &self,
        request: SshRuntimeExecRequest,
    ) -> AppResult<SshRuntimeExecOutput> {
        ManagedSshSessionManager::execute_exec(&self.inner, &self.key, &self.session_id, request)
            .await
    }

    pub async fn open_streaming_exec(
        &self,
        request: SshRuntimeStreamingExecRequest,
    ) -> AppResult<ManagedSshStreamingExecSession> {
        ManagedSshSessionManager::open_streaming_exec(
            &self.inner,
            &self.key,
            &self.session_id,
            request,
        )
        .await
    }

    pub async fn open_shell(
        &self,
        request: SshRuntimeShellRequest,
    ) -> AppResult<ManagedSshShellSession> {
        ManagedSshSessionManager::open_shell(&self.inner, &self.key, &self.session_id, request)
            .await
    }

    pub async fn open_sftp(&self) -> AppResult<ManagedSshSftpChannel> {
        ManagedSshSessionManager::open_sftp(&self.inner, &self.key, &self.session_id).await
    }

    pub fn start_local_forward(
        &self,
        request: SshRuntimeLocalForwardRequest,
    ) -> AppResult<ManagedSshForwardTunnel> {
        ManagedSshSessionManager::start_local_forward(
            &self.inner,
            &self.key,
            &self.session_id,
            request,
        )
    }

    pub fn start_dynamic_forward(
        &self,
        request: SshRuntimeDynamicForwardRequest,
    ) -> AppResult<ManagedSshForwardTunnel> {
        ManagedSshSessionManager::start_dynamic_forward(
            &self.inner,
            &self.key,
            &self.session_id,
            request,
        )
    }

    pub fn start_remote_forward(
        &self,
        request: SshRuntimeRemoteForwardRequest,
    ) -> AppResult<ManagedSshForwardTunnel> {
        ManagedSshSessionManager::start_remote_forward(
            &self.inner,
            &self.key,
            &self.session_id,
            request,
        )
    }

    pub fn start_remote_dynamic_forward(
        &self,
        request: SshRuntimeRemoteDynamicForwardRequest,
    ) -> AppResult<ManagedSshForwardTunnel> {
        ManagedSshSessionManager::start_remote_dynamic_forward(
            &self.inner,
            &self.key,
            &self.session_id,
            request,
        )
    }
}

impl Drop for ManagedSshSessionHandle {
    fn drop(&mut self) {
        ManagedSshSessionManager::release_session(&self.inner, &self.key, &self.session_id);
    }
}

/// Managed interactive shell with an active diagnostics channel lease.
pub struct ManagedSshShellSession {
    pub(super) inner: Arc<ManagedSshSessionManagerInner>,
    pub(super) key: SshSessionKey,
    pub(super) released: bool,
    pub(super) session_id: String,
    pub(super) shell: Option<Box<dyn SshRuntimeShellSession>>,
}

impl fmt::Debug for ManagedSshShellSession {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ManagedSshShellSession")
            .field("released", &self.released)
            .field("session_id", &self.session_id)
            .finish_non_exhaustive()
    }
}

impl ManagedSshShellSession {
    pub fn session_id(&self) -> &str {
        &self.session_id
    }

    pub async fn read_event(&self) -> AppResult<SshRuntimeShellEvent> {
        self.shell()?.read_event().await
    }

    pub async fn write(&self, data: Vec<u8>) -> AppResult<()> {
        self.shell()?.write(data).await
    }

    pub async fn resize(&self, cols: u16, rows: u16) -> AppResult<()> {
        self.shell()?.resize(cols, rows).await
    }

    pub async fn close(&mut self) -> AppResult<()> {
        if self.released {
            return Ok(());
        }
        let result = match self.shell.take() {
            Some(shell) => {
                match tokio::time::timeout(Duration::from_secs(2), shell.close()).await {
                    Ok(result) => result,
                    Err(_) => Err(AppError::SshCommand(
                        "SSH shell 关闭超时，已释放本地 channel lease".to_owned(),
                    )),
                }
            }
            None => Ok(()),
        };
        self.release(result.as_ref().err().map(ToString::to_string));
        result
    }

    fn shell(&self) -> AppResult<&dyn SshRuntimeShellSession> {
        self.shell
            .as_deref()
            .ok_or_else(|| AppError::SshCommand("managed SSH shell channel is closed".to_owned()))
    }

    fn release(&mut self, error: Option<String>) {
        if self.released {
            return;
        }
        self.released = true;
        release_channel(&self.inner, &self.key, &self.session_id, error);
    }
}

impl Drop for ManagedSshShellSession {
    fn drop(&mut self) {
        self.shell = None;
        self.release(None);
    }
}

/// Managed streaming exec channel with an active diagnostics lease.
pub struct ManagedSshStreamingExecSession {
    pub(super) inner: Arc<ManagedSshSessionManagerInner>,
    pub(super) key: SshSessionKey,
    pub(super) permit: Option<OwnedSemaphorePermit>,
    pub(super) released: bool,
    pub(super) session: Option<Box<dyn SshRuntimeStreamingExecSession>>,
    pub(super) session_id: String,
    pub(super) timeout: Duration,
}

impl fmt::Debug for ManagedSshStreamingExecSession {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ManagedSshStreamingExecSession")
            .field("released", &self.released)
            .field("session_id", &self.session_id)
            .finish_non_exhaustive()
    }
}

impl ManagedSshStreamingExecSession {
    pub fn session_id(&self) -> &str {
        &self.session_id
    }

    pub fn take_stdin(&mut self) -> AppResult<Box<dyn SshRuntimeStreamingExecWriter>> {
        self.session_mut()?.take_stdin()
    }

    pub fn take_stdout(&mut self) -> AppResult<Box<dyn SshRuntimeStreamingExecReader>> {
        self.session_mut()?.take_stdout()
    }

    pub fn take_stderr(&mut self) -> AppResult<Box<dyn SshRuntimeStreamingExecReader>> {
        self.session_mut()?.take_stderr()
    }

    pub fn close_stdin(&mut self) -> AppResult<()> {
        self.session_mut()?.close_stdin()
    }

    pub fn wait(&mut self) -> AppResult<SshRuntimeStreamingExecExit> {
        let timeout = self.timeout;
        let result = self.session_mut()?.wait(timeout);
        if result.is_ok() {
            self.session = None;
        }
        self.release(result.as_ref().err().map(ToString::to_string));
        result
    }

    pub fn kill(&mut self) -> AppResult<()> {
        self.session_mut()?.kill()
    }

    fn session_mut(&mut self) -> AppResult<&mut (dyn SshRuntimeStreamingExecSession + '_)> {
        match self.session.as_mut() {
            Some(session) => Ok(session.as_mut()),
            None => Err(AppError::SshCommand(
                "managed SSH streaming exec channel is closed".to_owned(),
            )),
        }
    }

    fn release(&mut self, error: Option<String>) {
        if self.released {
            return;
        }
        self.released = true;
        self.permit = None;
        release_channel(&self.inner, &self.key, &self.session_id, error);
    }
}

impl Drop for ManagedSshStreamingExecSession {
    fn drop(&mut self) {
        if let Some(session) = self.session.as_mut() {
            let _ = session.kill();
        }
        self.session = None;
        self.release(None);
    }
}

/// Managed SFTP subsystem stream with an active diagnostics channel lease.
pub struct ManagedSshSftpChannel {
    pub(super) inner: Arc<ManagedSshSessionManagerInner>,
    pub(super) key: SshSessionKey,
    pub(super) released: bool,
    pub(super) session_id: String,
    pub(super) stream: Option<Box<dyn SshRuntimeSftpStream>>,
}

impl fmt::Debug for ManagedSshSftpChannel {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ManagedSshSftpChannel")
            .field("released", &self.released)
            .field("session_id", &self.session_id)
            .field("stream_taken", &self.stream.is_none())
            .finish_non_exhaustive()
    }
}

impl ManagedSshSftpChannel {
    pub fn session_id(&self) -> &str {
        &self.session_id
    }

    pub fn take_stream(&mut self) -> AppResult<Box<dyn SshRuntimeSftpStream>> {
        self.stream
            .take()
            .ok_or_else(|| AppError::Sftp("managed SSH SFTP stream is already taken".to_owned()))
    }

    fn release(&mut self, error: Option<String>) {
        if self.released {
            return;
        }
        self.released = true;
        release_channel(&self.inner, &self.key, &self.session_id, error);
    }
}

impl Drop for ManagedSshSftpChannel {
    fn drop(&mut self) {
        self.stream = None;
        self.release(None);
    }
}

/// Lease for one channel opened on a managed SSH session.
pub struct ManagedSshChannel {
    pub(super) channel_id: String,
    pub(super) inner: Arc<ManagedSshSessionManagerInner>,
    pub(super) key: SshSessionKey,
    pub(super) kind: SshChannelKind,
    pub(super) session_id: String,
}

impl fmt::Debug for ManagedSshChannel {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ManagedSshChannel")
            .field("channel_id", &self.channel_id)
            .field("kind", &self.kind)
            .field("session_id", &self.session_id)
            .finish()
    }
}

impl ManagedSshChannel {
    pub fn channel_id(&self) -> &str {
        &self.channel_id
    }

    pub fn kind(&self) -> SshChannelKind {
        self.kind
    }

    pub fn session_id(&self) -> &str {
        &self.session_id
    }
}

impl Drop for ManagedSshChannel {
    fn drop(&mut self) {
        release_channel(&self.inner, &self.key, &self.session_id, None);
    }
}

/// Managed local forwarding tunnel with an active diagnostics channel lease.
pub struct ManagedSshForwardTunnel {
    pub(super) inner: Arc<ManagedSshSessionManagerInner>,
    pub(super) key: SshSessionKey,
    pub(super) kind: SshChannelKind,
    pub(super) session_id: String,
    pub(super) task: Option<Box<dyn SshRuntimeForwardTask>>,
}

impl fmt::Debug for ManagedSshForwardTunnel {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ManagedSshForwardTunnel")
            .field("kind", &self.kind)
            .field("session_id", &self.session_id)
            .field("task", &self.task.as_ref().map(|task| task.id()))
            .finish()
    }
}

impl ManagedSshForwardTunnel {
    pub fn id(&self) -> Option<String> {
        self.task.as_ref().and_then(|task| task.id())
    }

    pub fn kind(&self) -> SshChannelKind {
        self.kind
    }

    pub fn session_id(&self) -> &str {
        &self.session_id
    }

    pub fn try_wait(&mut self) -> AppResult<Option<String>> {
        let Some(task) = self.task.as_mut() else {
            return Ok(Some("managed SSH forward task already stopped".to_owned()));
        };
        match task.try_wait()? {
            Some(status) => {
                task.wait();
                self.task = None;
                Ok(Some(status))
            }
            None => Ok(None),
        }
    }

    pub fn take_recent_failure(&mut self) -> AppResult<Option<String>> {
        let Some(task) = self.task.as_mut() else {
            return Ok(None);
        };
        task.take_recent_failure()
    }

    pub fn kill(&mut self) -> AppResult<()> {
        if let Some(task) = self.task.as_mut() {
            task.kill()?;
        }
        Ok(())
    }

    pub fn wait(&mut self) {
        if let Some(mut task) = self.task.take() {
            task.wait();
        }
    }
}

impl Drop for ManagedSshForwardTunnel {
    fn drop(&mut self) {
        if let Some(task) = self.task.as_mut() {
            let _ = task.kill();
            task.wait();
        }
        self.task = None;
        release_channel(&self.inner, &self.key, &self.session_id, None);
    }
}
