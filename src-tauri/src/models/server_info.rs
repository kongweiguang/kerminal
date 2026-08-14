//! 服务器信息 IPC 数据模型。
//!
//! @author kongweiguang

use serde::{Deserialize, Serialize};

use crate::models::target::RemoteTargetRef;

/// 获取服务器信息请求。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ServerInfoRequest {
    /// 远程主机 id。
    pub host_id: String,
    /// 统一目标引用。
    pub target: RemoteTargetRef,
}

/// SSH 远程主机的系统信息快照。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ServerInfoSnapshot {
    /// 远程主机 id。
    pub host_id: String,
    /// 用户可见主机名称。
    pub host_name: String,
    /// SSH 地址。
    pub host: String,
    /// SSH 端口。
    pub port: u16,
    /// SSH 用户名。
    pub username: String,
    /// 远程主机名。
    pub hostname: Option<String>,
    /// 操作系统名称。
    pub os: Option<String>,
    /// CPU 架构。
    pub architecture: Option<String>,
    /// Kernel 版本。
    pub kernel: Option<String>,
    /// 系统运行秒数。
    pub uptime_seconds: Option<u64>,
    /// 1/5/15 分钟 load average。
    pub load_average: Option<[f64; 3]>,
    /// CPU 使用率百分比。
    pub cpu_usage_percent: Option<f64>,
    /// CPU 核心数。
    pub cpu_count: Option<u64>,
    /// CPU 型号或 SoC 名称。
    pub cpu_model: Option<String>,
    /// 每个 CPU 核心的使用率百分比。
    pub cpu_core_usage_percents: Vec<f64>,
    /// 进程总数。
    pub process_count: Option<u64>,
    /// 处于运行态的进程数量。
    pub running_process_count: Option<u64>,
    /// 内存总量，单位字节。
    pub memory_total_bytes: Option<u64>,
    /// 内存已用量，单位字节。
    pub memory_used_bytes: Option<u64>,
    /// 内存可用量，单位字节。
    pub memory_available_bytes: Option<u64>,
    /// Buffer 内存，单位字节。
    pub memory_buffers_bytes: Option<u64>,
    /// Cached 内存，单位字节。
    pub memory_cached_bytes: Option<u64>,
    /// Swap 总量，单位字节。
    pub swap_total_bytes: Option<u64>,
    /// Swap 已用量，单位字节。
    pub swap_used_bytes: Option<u64>,
    /// 根分区总量，单位字节。
    pub disk_total_bytes: Option<u64>,
    /// 根分区已用量，单位字节。
    pub disk_used_bytes: Option<u64>,
    /// 根分区可用量，单位字节。
    pub disk_available_bytes: Option<u64>,
    /// 磁盘挂载点。
    pub disk_mount: Option<String>,
    /// 可见文件系统列表。
    pub disks: Vec<ServerDiskInfo>,
    /// 网络接收累计字节数。
    pub network_rx_bytes: Option<u64>,
    /// 网络发送累计字节数。
    pub network_tx_bytes: Option<u64>,
    /// 可见网络接口列表。
    pub network_interfaces: Vec<ServerNetworkInterfaceInfo>,
    /// CPU 占用最高的进程摘要。
    pub top_processes: Vec<ServerProcessInfo>,
    /// GPU 探测状态，用于解释缺失或降级来源。
    pub gpu_probe_status: Option<String>,
    /// 远程主机可识别显卡摘要。
    pub gpus: Vec<ServerGpuInfo>,
    /// NPU 探测状态，用于区分未安装工具、探测失败和未发现设备。
    pub npu_probe_status: Option<String>,
    /// 远程主机可识别的 AI 加速卡摘要。
    pub npus: Vec<ServerNpuInfo>,
    /// 采集时间，Unix 秒字符串。
    pub captured_at: String,
}

/// SSH 远程主机文件系统摘要。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ServerDiskInfo {
    /// 文件系统名称。
    pub filesystem: String,
    /// 挂载点。
    pub mount: String,
    /// 总量，单位字节。
    pub total_bytes: Option<u64>,
    /// 已用量，单位字节。
    pub used_bytes: Option<u64>,
    /// 可用量，单位字节。
    pub available_bytes: Option<u64>,
}

/// SSH 远程主机网络接口摘要。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ServerNetworkInterfaceInfo {
    /// 接口名。
    pub name: String,
    /// 接收累计字节数。
    pub rx_bytes: Option<u64>,
    /// 发送累计字节数。
    pub tx_bytes: Option<u64>,
}

/// SSH 远程主机进程摘要。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ServerProcessInfo {
    /// 进程 id。
    pub pid: u32,
    /// 进程名称。
    pub name: String,
    /// CPU 使用率百分比。
    pub cpu_usage_percent: Option<f64>,
    /// 内存占比百分比。
    pub memory_percent: Option<f64>,
    /// 常驻内存，单位字节。
    pub memory_bytes: Option<u64>,
}

/// SSH 远程主机显卡摘要。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ServerGpuInfo {
    /// 显卡名称。
    pub name: String,
    /// 显卡厂商。
    pub vendor: Option<String>,
    /// 驱动版本。
    pub driver_version: Option<String>,
    /// 显存总量，单位字节。
    pub memory_total_bytes: Option<u64>,
    /// 显存已用量，单位字节。
    pub memory_used_bytes: Option<u64>,
    /// GPU 使用率百分比。
    pub utilization_percent: Option<f64>,
    /// GPU 温度，摄氏度。
    pub temperature_celsius: Option<f64>,
}

/// SSH 远程主机 NPU 摘要。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ServerNpuInfo {
    /// npu-smi 报告的设备 id；保留原始数值以对应运维命令参数。
    pub id: u32,
    /// 单卡内芯片 id。
    pub chip_id: Option<u32>,
    /// 芯片型号，例如 Ascend 910B4。
    pub name: String,
    /// 健康状态，例如 OK、Warning 或 Critical。
    pub health: Option<String>,
    /// PCIe Bus Id。
    pub bus_id: Option<String>,
    /// AI Core 使用率百分比。
    pub utilization_percent: Option<f64>,
    /// 通用设备内存总量，单位字节。
    pub memory_total_bytes: Option<u64>,
    /// 通用设备内存已用量，单位字节。
    pub memory_used_bytes: Option<u64>,
    /// HBM 总量，单位字节。
    pub hbm_total_bytes: Option<u64>,
    /// HBM 已用量，单位字节。
    pub hbm_used_bytes: Option<u64>,
    /// 功率，单位 W。
    pub power_watts: Option<f64>,
    /// 温度，摄氏度。
    pub temperature_celsius: Option<f64>,
}
