//! SFTP performance settings model.
//!
//! @author kongweiguang

use serde::{Deserialize, Serialize};

/// SFTP 全局传输并发默认值。
pub const DEFAULT_SFTP_GLOBAL_TRANSFERS: usize = 4;
/// SFTP 全局传输并发最小值。
pub const MIN_SFTP_GLOBAL_TRANSFERS: usize = 1;
/// SFTP 全局传输并发最大值。
pub const MAX_SFTP_GLOBAL_TRANSFERS: usize = 16;
/// SFTP 单主机传输并发默认值。
pub const DEFAULT_SFTP_HOST_TRANSFERS: usize = 2;
/// SFTP 单主机传输并发最小值。
pub const MIN_SFTP_HOST_TRANSFERS: usize = 1;
/// SFTP 单主机传输并发最大值。
pub const MAX_SFTP_HOST_TRANSFERS: usize = 8;
/// SFTP pipelined 读写默认深度。
///
/// 与默认 256 KiB 单包组合后，单文件最多维持约 2 MiB 在途数据，兼顾高延迟链路吞吐与
/// 服务端兼容性，并与底层 SFTP 客户端的默认并发写窗口保持一致。
pub const DEFAULT_SFTP_PIPELINE_DEPTH: usize = 8;
/// SFTP pipelined 读写最小深度。
pub const MIN_SFTP_PIPELINE_DEPTH: usize = 1;
/// SFTP pipelined 读写最大深度。
pub const MAX_SFTP_PIPELINE_DEPTH: usize = 256;
/// SFTP 单包最大字节数默认值。
pub const DEFAULT_SFTP_PACKET_BYTES: u32 = 256 * 1024;
/// SFTP 单包最大字节数最小值。
pub const MIN_SFTP_PACKET_BYTES: u32 = 32 * 1024;
/// SFTP 单包最大字节数最大值。
pub const MAX_SFTP_PACKET_BYTES: u32 = 256 * 1024;
/// SFTP 后台传输连续无字节进度的默认保护秒数。
pub const DEFAULT_SFTP_IDLE_TIMEOUT_SECONDS: u16 = 180;
/// SFTP 后台传输连续无字节进度的最小保护秒数。
pub const MIN_SFTP_IDLE_TIMEOUT_SECONDS: u16 = 30;
/// SFTP 后台传输连续无字节进度的最大保护秒数。
pub const MAX_SFTP_IDLE_TIMEOUT_SECONDS: u16 = 3600;

/// SFTP 传输和连接性能设置。
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SftpPerformanceSettings {
    /// 全局同时运行的 SFTP 传输任务数量。
    #[serde(default = "default_sftp_global_transfers")]
    pub global_transfers: usize,
    /// 单个远程主机同时运行的 SFTP 传输任务数量。
    #[serde(default = "default_sftp_host_transfers")]
    pub host_transfers: usize,
    /// 单文件上传/下载 pipelined 读写深度。
    #[serde(default = "default_sftp_pipeline_depth")]
    pub pipeline_depth: usize,
    /// SFTP 协议单包最大字节数。
    #[serde(default = "default_sftp_packet_bytes")]
    pub packet_bytes: u32,
    /// 后台传输连续无字节进度的保护秒数。
    ///
    /// `timeoutSeconds` 是旧版单一超时字段的反序列化别名。连接仍由各主机
    /// `sshOptions.terminal.connectTimeoutSeconds` 控制；保存时只写新字段，避免把
    /// 大文件传输误解为总时长限制。
    #[serde(
        default = "default_sftp_idle_timeout_seconds",
        alias = "timeoutSeconds"
    )]
    pub idle_timeout_seconds: u16,
}

impl Default for SftpPerformanceSettings {
    fn default() -> Self {
        Self {
            global_transfers: DEFAULT_SFTP_GLOBAL_TRANSFERS,
            host_transfers: DEFAULT_SFTP_HOST_TRANSFERS,
            packet_bytes: DEFAULT_SFTP_PACKET_BYTES,
            pipeline_depth: DEFAULT_SFTP_PIPELINE_DEPTH,
            idle_timeout_seconds: DEFAULT_SFTP_IDLE_TIMEOUT_SECONDS,
        }
    }
}

impl SftpPerformanceSettings {
    /// 返回经过范围归一化的 SFTP 性能设置。
    pub fn normalized(mut self) -> Self {
        self.global_transfers = self
            .global_transfers
            .clamp(MIN_SFTP_GLOBAL_TRANSFERS, MAX_SFTP_GLOBAL_TRANSFERS);
        self.host_transfers = self
            .host_transfers
            .clamp(MIN_SFTP_HOST_TRANSFERS, MAX_SFTP_HOST_TRANSFERS)
            .min(self.global_transfers);
        self.pipeline_depth = self
            .pipeline_depth
            .clamp(MIN_SFTP_PIPELINE_DEPTH, MAX_SFTP_PIPELINE_DEPTH);
        self.packet_bytes = self
            .packet_bytes
            .clamp(MIN_SFTP_PACKET_BYTES, MAX_SFTP_PACKET_BYTES);
        self.idle_timeout_seconds = self
            .idle_timeout_seconds
            .clamp(MIN_SFTP_IDLE_TIMEOUT_SECONDS, MAX_SFTP_IDLE_TIMEOUT_SECONDS);
        self
    }
}

fn default_sftp_global_transfers() -> usize {
    DEFAULT_SFTP_GLOBAL_TRANSFERS
}

fn default_sftp_host_transfers() -> usize {
    DEFAULT_SFTP_HOST_TRANSFERS
}

fn default_sftp_pipeline_depth() -> usize {
    DEFAULT_SFTP_PIPELINE_DEPTH
}

fn default_sftp_packet_bytes() -> u32 {
    DEFAULT_SFTP_PACKET_BYTES
}

fn default_sftp_idle_timeout_seconds() -> u16 {
    DEFAULT_SFTP_IDLE_TIMEOUT_SECONDS
}

#[cfg(test)]
mod tests {
    use super::SftpPerformanceSettings;

    /// 验证旧设置只在读取时映射为无进度保护，下一次序列化不会继续写入误导性的总时长字段。
    #[test]
    fn legacy_timeout_seconds_reads_as_idle_timeout_and_serializes_new_field() {
        let settings: SftpPerformanceSettings = toml::from_str(
            r#"
globalTransfers = 4
hostTransfers = 2
pipelineDepth = 8
packetBytes = 262144
timeoutSeconds = 45
"#,
        )
        .expect("deserialize legacy sftp settings");

        assert_eq!(settings.idle_timeout_seconds, 45);
        let serialized = toml::to_string(&settings).expect("serialize migrated sftp settings");
        assert!(serialized.contains("idleTimeoutSeconds = 45"));
        assert!(!serialized.contains("timeoutSeconds"));
    }
}
