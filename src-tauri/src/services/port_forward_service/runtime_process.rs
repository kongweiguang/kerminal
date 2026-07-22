//! Managed SSH 端口转发运行时所有权。
//!
//! @author kongweiguang

use crate::{
    error::AppResult,
    models::port_forward::PortForwardSummary,
    services::{ssh_command_plan::CleanupPathOwner, ssh_runtime::ManagedSshForwardTunnel},
};

#[derive(Debug)]
pub(super) struct PortForwardSession {
    pub(super) process: ManagedForwardProcess,
    pub(super) cleanup_paths: CleanupPathOwner,
    pub(super) summary: PortForwardSummary,
}

pub(super) struct ManagedForwardProcess(pub(super) Option<ManagedSshForwardTunnel>);

impl std::fmt::Debug for ManagedForwardProcess {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("Managed")
            .field("id", &self.0.as_ref().and_then(ManagedSshForwardTunnel::id))
            .finish()
    }
}

impl ManagedForwardProcess {
    pub(super) fn id(&self) -> Option<u32> {
        None
    }

    pub(super) fn try_wait(&mut self) -> AppResult<Option<String>> {
        let Some(tunnel) = self.0.as_mut() else {
            return Ok(Some("受管 SSH 端口转发已退出".to_owned()));
        };
        match tunnel.try_wait()? {
            Some(status) => {
                self.0 = None;
                Ok(Some(status))
            }
            None => Ok(None),
        }
    }

    pub(super) fn take_recent_failure(&mut self) -> AppResult<Option<String>> {
        match self.0.as_mut() {
            Some(tunnel) => tunnel.take_recent_failure(),
            None => Ok(None),
        }
    }

    pub(super) fn terminate(&mut self) -> AppResult<()> {
        if let Some(mut tunnel) = self.0.take() {
            tunnel.kill()?;
            tunnel.wait();
        }
        Ok(())
    }
}

impl Drop for PortForwardSession {
    fn drop(&mut self) {
        let _ = self.process.terminate();
        self.cleanup_paths.cleanup_now();
    }
}
