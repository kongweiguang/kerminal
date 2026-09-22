//! @author kongweiguang

use crate::{
    error::AppResult,
    models::settings::SftpPerformanceSettings,
    paths::KerminalPaths,
    services::{
        sftp_service::backend::SftpEndpoint,
        ssh_runtime::{facade::SshRuntimeSessionLane, policy::is_external_runtime_target_id},
    },
    storage::config_file_store::ConfigFileStore,
};

use super::errors::config_file_error;

const EXTERNAL_BULK_TRANSFER_PIPELINE_DEPTH: usize = 8;
const EXTERNAL_BULK_TRANSFER_PACKET_BYTES: u32 = 64 * 1024;
const SFTP_BROWSER_REQUEST_TIMEOUT_SECONDS: u64 = 30;

#[derive(Debug, Clone, Copy)]
pub(super) enum SftpManagedSessionLane {
    Browser,
    BulkTransfer,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct SftpRuntimeSettings {
    pub(crate) global_transfers: usize,
    pub(crate) host_transfers: usize,
    pub(crate) pipeline_depth: usize,
    pub(crate) packet_bytes: u32,
    /// 浏览文件工具仍使用短请求保护；它不参与后台队列传输生命周期。
    pub(crate) browser_request_timeout_seconds: u64,
    /// 后台传输连续无进度保护；运行时 watchdog 以此判断，而非限制总时长。
    pub(crate) idle_timeout_seconds: u64,
}

impl Default for SftpRuntimeSettings {
    fn default() -> Self {
        Self::from(SftpPerformanceSettings::default())
    }
}

impl SftpManagedSessionLane {
    pub(super) fn runtime_lane(self) -> SshRuntimeSessionLane {
        match self {
            Self::Browser => SshRuntimeSessionLane::Capability,
            Self::BulkTransfer => SshRuntimeSessionLane::BulkTransfer,
        }
    }
}

impl From<SftpPerformanceSettings> for SftpRuntimeSettings {
    fn from(settings: SftpPerformanceSettings) -> Self {
        let settings = settings.normalized();
        Self {
            global_transfers: settings.global_transfers,
            host_transfers: settings.host_transfers,
            pipeline_depth: settings.pipeline_depth,
            packet_bytes: settings.packet_bytes,
            browser_request_timeout_seconds: SFTP_BROWSER_REQUEST_TIMEOUT_SECONDS,
            idle_timeout_seconds: u64::from(settings.idle_timeout_seconds),
        }
    }
}

impl SftpRuntimeSettings {
    /// 为单个已入队任务固化无进度保护。
    ///
    /// 任务创建后不再读取全局 settings，确保用户修改默认值不会改变正在传输或重试任务的
    /// 恢复边界；调用方已在 MCP/IPC 入口校验范围。
    pub(crate) fn with_idle_timeout_seconds(mut self, seconds: u16) -> Self {
        self.idle_timeout_seconds = u64::from(seconds);
        self
    }

    pub(crate) fn for_bulk_transfer_target(self, endpoint: &SftpEndpoint) -> Self {
        if is_external_runtime_target_id(&endpoint.host.id) {
            return self.for_external_bulk_transfer();
        }
        self
    }

    pub(crate) fn for_external_bulk_transfer(mut self) -> Self {
        self.host_transfers = 1;
        self.pipeline_depth = self
            .pipeline_depth
            .min(EXTERNAL_BULK_TRANSFER_PIPELINE_DEPTH);
        self.packet_bytes = self.packet_bytes.min(EXTERNAL_BULK_TRANSFER_PACKET_BYTES);
        self
    }

    /// 返回当前 session lane 的协议请求保护值。
    ///
    /// 浏览器读目录仍应快速失败；bulk lane 则让队列 watchdog 先把无进度失败投影为
    /// 稳定的可续传错误，因此协议层必须略晚于 idle 阈值而不能沿用旧的 30 秒总称超时。
    pub(super) fn request_timeout_seconds(self, lane: SftpManagedSessionLane) -> u64 {
        match lane {
            SftpManagedSessionLane::Browser => self.browser_request_timeout_seconds,
            SftpManagedSessionLane::BulkTransfer => self.idle_timeout_seconds.saturating_add(1),
        }
    }
}

pub(crate) fn load_sftp_runtime_settings(paths: &KerminalPaths) -> AppResult<SftpRuntimeSettings> {
    let settings = ConfigFileStore::new(paths.root.clone())
        .read_settings_or_default()
        .map_err(config_file_error)?;
    Ok(SftpRuntimeSettings::from(settings.sftp))
}
