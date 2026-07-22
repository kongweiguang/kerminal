//! 端口转发子进程与临时认证制品的统一所有权。
//!
//! @author kongweiguang

use std::process::Child;

use portable_pty::{Child as PtyChild, MasterPty};

use crate::{
    error::{AppError, AppResult},
    models::port_forward::PortForwardSummary,
    services::{ssh_command_plan::CleanupPathOwner, ssh_runtime::ManagedSshForwardTunnel},
};

pub(super) type PtyChildHandle = Box<dyn PtyChild + Send + Sync>;
pub(super) type PtyMasterHandle = Box<dyn MasterPty + Send>;

#[derive(Debug)]
pub(super) struct PortForwardSession {
    pub(super) process: ManagedForwardProcess,
    pub(super) cleanup_paths: CleanupPathOwner,
    pub(super) summary: PortForwardSummary,
}

pub(super) enum ManagedForwardProcess {
    Managed(Box<Option<ManagedSshForwardTunnel>>),
    Process(Box<Child>),
    Pty(Box<PtyForwardProcess>),
}

pub(super) struct PtyForwardProcess {
    pub(super) child: PtyChildHandle,
    pub(super) _master: PtyMasterHandle,
    pub(super) pid: Option<u32>,
}

impl std::fmt::Debug for ManagedForwardProcess {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Managed(tunnel) => formatter
                .debug_struct("Managed")
                .field(
                    "id",
                    &tunnel.as_ref().as_ref().and_then(|tunnel| tunnel.id()),
                )
                .finish(),
            Self::Process(child) => formatter
                .debug_struct("Process")
                .field("pid", &child.id())
                .finish(),
            Self::Pty(process) => formatter
                .debug_struct("Pty")
                .field("pid", &process.pid)
                .finish(),
        }
    }
}

impl ManagedForwardProcess {
    pub(super) fn id(&self) -> Option<u32> {
        match self {
            Self::Managed(_) => None,
            Self::Process(child) => Some(child.id()),
            Self::Pty(process) => process.pid,
        }
    }

    pub(super) fn try_wait(&mut self) -> AppResult<Option<String>> {
        match self {
            Self::Managed(tunnel) => {
                let Some(tunnel) = tunnel.as_mut() else {
                    return Ok(Some("受管 SSH 端口转发已退出".to_owned()));
                };
                match tunnel.try_wait()? {
                    Some(status) => {
                        *self = Self::Managed(Box::new(None));
                        Ok(Some(status))
                    }
                    None => Ok(None),
                }
            }
            Self::Process(child) => child
                .try_wait()
                .map(|status| status.map(|status| status.to_string()))
                .map_err(|error| AppError::PortForward(format!("无法读取端口转发状态: {error}"))),
            Self::Pty(process) => process
                .child
                .try_wait()
                .map(|status| {
                    status.map(|status| match status.signal() {
                        Some(signal) => format!("signal {signal}"),
                        None => format!("exit code {}", status.exit_code()),
                    })
                })
                .map_err(|error| AppError::PortForward(format!("无法读取端口转发状态: {error}"))),
        }
    }

    pub(super) fn take_recent_failure(&mut self) -> AppResult<Option<String>> {
        match self {
            Self::Managed(tunnel) => match tunnel.as_mut() {
                Some(tunnel) => tunnel.take_recent_failure(),
                None => Ok(None),
            },
            Self::Process(_) | Self::Pty(_) => Ok(None),
        }
    }

    pub(super) fn kill(&mut self) -> AppResult<()> {
        match self {
            Self::Managed(tunnel) => {
                if let Some(tunnel) = tunnel.as_mut() {
                    tunnel.kill()?;
                }
                Ok(())
            }
            Self::Process(child) => child
                .kill()
                .map_err(|error| AppError::PortForward(format!("无法停止端口转发: {error}"))),
            Self::Pty(process) => process
                .child
                .kill()
                .map_err(|error| AppError::PortForward(format!("无法停止端口转发: {error}"))),
        }
    }

    pub(super) fn wait(&mut self) {
        match self {
            Self::Managed(tunnel) => {
                if let Some(mut tunnel) = tunnel.take() {
                    tunnel.wait();
                }
            }
            Self::Process(child) => {
                let _ = child.wait();
            }
            Self::Pty(process) => {
                let _ = process.child.wait();
            }
        }
    }

    /// 结束并回收子进程；即使 kill 失败也必须执行 wait，避免僵尸进程。
    pub(super) fn terminate(&mut self) -> AppResult<()> {
        let kill_result = match self.try_wait() {
            Ok(Some(_)) => Ok(()),
            Ok(None) => self.kill(),
            Err(error) => {
                let _ = self.kill();
                Err(error)
            }
        };
        self.wait();
        kill_result
    }
}

impl Drop for PortForwardSession {
    fn drop(&mut self) {
        let _ = self.process.terminate();
        self.cleanup_paths.cleanup_now();
    }
}
