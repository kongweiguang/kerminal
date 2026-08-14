//! Server information output parsing.
//!
//! @author kongweiguang

use std::collections::HashMap;

use crate::models::{
    remote_host::RemoteHost,
    server_info::{
        ServerDiskInfo, ServerGpuInfo, ServerInfoSnapshot, ServerNetworkInterfaceInfo,
        ServerNpuInfo, ServerProcessInfo,
    },
};

/// 解析远端 key=value 输出为服务器信息快照。
pub fn parse_server_info_output(
    host: &RemoteHost,
    stdout: &str,
    captured_at: String,
) -> ServerInfoSnapshot {
    let values = key_value_lines(stdout);
    let proc_net_dev = parse_proc_net_dev_values(&values);
    let (network_rx_bytes, network_tx_bytes, network_interfaces) = proc_net_dev
        .map(|snapshot| {
            (
                snapshot.total_rx_bytes,
                snapshot.total_tx_bytes,
                snapshot.interfaces,
            )
        })
        .unwrap_or_else(|| {
            (
                parse_u64(&values, "network_rx_bytes"),
                parse_u64(&values, "network_tx_bytes"),
                parse_network_interfaces(&values),
            )
        });

    ServerInfoSnapshot {
        host_id: host.id.clone(),
        host_name: host.name.clone(),
        host: host.host.clone(),
        port: host.port,
        username: host.username.clone(),
        hostname: optional_text(&values, "hostname"),
        os: optional_text(&values, "os"),
        architecture: optional_text(&values, "architecture"),
        kernel: optional_text(&values, "kernel"),
        uptime_seconds: parse_u64(&values, "uptime_seconds"),
        load_average: parse_load_average(&values),
        cpu_usage_percent: parse_f64(&values, "cpu_usage_percent"),
        cpu_count: parse_u64(&values, "cpu_count"),
        cpu_model: optional_text(&values, "cpu_model"),
        cpu_core_usage_percents: parse_cpu_core_usage_percents(&values),
        process_count: parse_u64(&values, "process_count"),
        running_process_count: parse_u64(&values, "running_process_count"),
        memory_total_bytes: parse_u64(&values, "memory_total_bytes"),
        memory_used_bytes: parse_u64(&values, "memory_used_bytes"),
        memory_available_bytes: parse_u64(&values, "memory_available_bytes"),
        memory_buffers_bytes: parse_u64(&values, "memory_buffers_bytes"),
        memory_cached_bytes: parse_u64(&values, "memory_cached_bytes"),
        swap_total_bytes: parse_u64(&values, "swap_total_bytes"),
        swap_used_bytes: parse_u64(&values, "swap_used_bytes"),
        disk_total_bytes: parse_u64(&values, "disk_total_bytes"),
        disk_used_bytes: parse_u64(&values, "disk_used_bytes"),
        disk_available_bytes: parse_u64(&values, "disk_available_bytes"),
        disk_mount: optional_text(&values, "disk_mount"),
        disks: parse_server_disks(&values),
        network_rx_bytes,
        network_tx_bytes,
        network_interfaces,
        top_processes: parse_server_processes(&values),
        gpu_probe_status: optional_text(&values, "gpu_probe_status"),
        gpus: parse_server_gpus(&values),
        npu_probe_status: optional_text(&values, "npu_probe_status"),
        npus: parse_server_npus(&values),
        captured_at,
    }
}

/// `/proc/net/dev` 的解析结果。
#[derive(Debug, Clone, PartialEq)]
pub struct ProcNetDevSnapshot {
    /// 所有有效接口的接收累计字节数。
    pub total_rx_bytes: Option<u64>,
    /// 所有有效接口的发送累计字节数。
    pub total_tx_bytes: Option<u64>,
    /// 成功解析的网络接口。
    pub interfaces: Vec<ServerNetworkInterfaceInfo>,
}

/// 按 Linux `/proc/net/dev` 字段定义解析网络接口累计计数。
pub fn parse_proc_net_dev(content: &str) -> ProcNetDevSnapshot {
    let interfaces = content
        .lines()
        .filter_map(|line| {
            let (name, counters) = line.split_once(':')?;
            let name = name.trim();
            if name.is_empty() {
                return None;
            }

            let fields = counters.split_whitespace().collect::<Vec<_>>();
            if fields.len() < 9 {
                return None;
            }

            Some(ServerNetworkInterfaceInfo {
                name: name.to_owned(),
                rx_bytes: fields[0].parse().ok(),
                tx_bytes: fields[8].parse().ok(),
            })
        })
        .filter(|interface| interface.rx_bytes.is_some() && interface.tx_bytes.is_some())
        .collect::<Vec<_>>();

    let total_rx_bytes = interfaces.iter().try_fold(0_u64, |total, interface| {
        total.checked_add(interface.rx_bytes?)
    });
    let total_tx_bytes = interfaces.iter().try_fold(0_u64, |total, interface| {
        total.checked_add(interface.tx_bytes?)
    });

    ProcNetDevSnapshot {
        total_rx_bytes: (!interfaces.is_empty()).then_some(total_rx_bytes).flatten(),
        total_tx_bytes: (!interfaces.is_empty()).then_some(total_tx_bytes).flatten(),
        interfaces,
    }
}

fn parse_proc_net_dev_values(values: &HashMap<String, String>) -> Option<ProcNetDevSnapshot> {
    let mut lines = values
        .iter()
        .filter_map(|(key, value)| {
            let index = key
                .strip_prefix("proc_net_dev_line_")?
                .parse::<usize>()
                .ok()?;
            Some((index, value.as_str()))
        })
        .collect::<Vec<_>>();
    if lines.is_empty() {
        return None;
    }
    lines.sort_unstable_by_key(|(index, _)| *index);

    Some(parse_proc_net_dev(
        &lines
            .into_iter()
            .map(|(_, line)| line)
            .collect::<Vec<_>>()
            .join("\n"),
    ))
}

fn key_value_lines(stdout: &str) -> HashMap<String, String> {
    stdout
        .lines()
        .filter_map(|line| line.split_once('='))
        .map(|(key, value)| (key.trim().to_owned(), value.trim().to_owned()))
        .filter(|(key, _)| !key.is_empty())
        .collect()
}

fn optional_text(values: &HashMap<String, String>, key: &str) -> Option<String> {
    values
        .get(key)
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
}

fn parse_u64(values: &HashMap<String, String>, key: &str) -> Option<u64> {
    values
        .get(key)?
        .split_once('.')
        .map(|(integer, _)| integer)
        .unwrap_or_else(|| values.get(key).expect("checked above"))
        .parse()
        .ok()
}

fn parse_u32(values: &HashMap<String, String>, key: &str) -> Option<u32> {
    parse_u64(values, key).and_then(|value| u32::try_from(value).ok())
}

fn parse_f64(values: &HashMap<String, String>, key: &str) -> Option<f64> {
    values.get(key)?.parse().ok()
}

fn parse_load_average(values: &HashMap<String, String>) -> Option<[f64; 3]> {
    let parts = values
        .get("load_average")?
        .split_whitespace()
        .filter_map(|part| part.parse::<f64>().ok())
        .collect::<Vec<_>>();
    if parts.len() < 3 {
        return None;
    }
    Some([parts[0], parts[1], parts[2]])
}

fn parse_cpu_core_usage_percents(values: &HashMap<String, String>) -> Vec<f64> {
    let mut entries = values
        .keys()
        .filter_map(|key| {
            let rest = key.strip_prefix("cpu_core_")?;
            let index = rest.strip_suffix("_usage_percent")?;
            index.parse::<usize>().ok().map(|index| (index, key))
        })
        .collect::<Vec<_>>();
    entries.sort_by_key(|(index, _)| *index);

    entries
        .into_iter()
        .filter_map(|(_, key)| values.get(key)?.parse::<f64>().ok())
        .collect()
}

fn parse_server_disks(values: &HashMap<String, String>) -> Vec<ServerDiskInfo> {
    let mut indices = values
        .keys()
        .filter_map(|key| {
            let rest = key.strip_prefix("disk_")?;
            let (index, field) = rest.split_once('_')?;
            if field == "mount" {
                index.parse::<usize>().ok()
            } else {
                None
            }
        })
        .collect::<Vec<_>>();
    indices.sort_unstable();
    indices.dedup();

    indices
        .into_iter()
        .filter_map(|index| {
            let prefix = format!("disk_{index}_");
            let mount = optional_text(values, &format!("{prefix}mount"))?;
            let filesystem = optional_text(values, &format!("{prefix}filesystem"))
                .unwrap_or_else(|| "-".to_owned());
            Some(ServerDiskInfo {
                available_bytes: parse_u64(values, &format!("{prefix}available_bytes")),
                filesystem,
                mount,
                total_bytes: parse_u64(values, &format!("{prefix}total_bytes")),
                used_bytes: parse_u64(values, &format!("{prefix}used_bytes")),
            })
        })
        .collect()
}

fn parse_network_interfaces(values: &HashMap<String, String>) -> Vec<ServerNetworkInterfaceInfo> {
    let mut indices = values
        .keys()
        .filter_map(|key| {
            let rest = key.strip_prefix("network_interface_")?;
            let (index, field) = rest.split_once('_')?;
            if field == "name" {
                index.parse::<usize>().ok()
            } else {
                None
            }
        })
        .collect::<Vec<_>>();
    indices.sort_unstable();
    indices.dedup();

    indices
        .into_iter()
        .filter_map(|index| {
            let prefix = format!("network_interface_{index}_");
            Some(ServerNetworkInterfaceInfo {
                name: optional_text(values, &format!("{prefix}name"))?,
                rx_bytes: parse_u64(values, &format!("{prefix}rx_bytes")),
                tx_bytes: parse_u64(values, &format!("{prefix}tx_bytes")),
            })
        })
        .collect()
}

fn parse_server_processes(values: &HashMap<String, String>) -> Vec<ServerProcessInfo> {
    let mut indices = values
        .keys()
        .filter_map(|key| {
            let rest = key.strip_prefix("process_")?;
            let (index, field) = rest.split_once('_')?;
            if field == "pid" {
                index.parse::<usize>().ok()
            } else {
                None
            }
        })
        .collect::<Vec<_>>();
    indices.sort_unstable();
    indices.dedup();

    indices
        .into_iter()
        .filter_map(|index| {
            let prefix = format!("process_{index}_");
            Some(ServerProcessInfo {
                cpu_usage_percent: parse_f64(values, &format!("{prefix}cpu_usage_percent")),
                memory_bytes: parse_u64(values, &format!("{prefix}memory_bytes")),
                memory_percent: parse_f64(values, &format!("{prefix}memory_percent")),
                name: optional_text(values, &format!("{prefix}name"))?,
                pid: parse_u32(values, &format!("{prefix}pid"))?,
            })
        })
        .collect()
}

fn parse_server_gpus(values: &HashMap<String, String>) -> Vec<ServerGpuInfo> {
    let mut indices = values
        .keys()
        .filter_map(|key| {
            let rest = key.strip_prefix("gpu_")?;
            let (index, field) = rest.split_once('_')?;
            if field == "name" {
                index.parse::<usize>().ok()
            } else {
                None
            }
        })
        .collect::<Vec<_>>();
    indices.sort_unstable();
    indices.dedup();

    indices
        .into_iter()
        .filter_map(|index| {
            let prefix = format!("gpu_{index}_");
            let name = optional_text(values, &format!("{prefix}name"))?;
            if is_gpu_probe_error_name(&name) {
                return None;
            }
            Some(ServerGpuInfo {
                driver_version: optional_text(values, &format!("{prefix}driver_version")),
                memory_total_bytes: parse_u64(values, &format!("{prefix}memory_total_bytes")),
                memory_used_bytes: parse_u64(values, &format!("{prefix}memory_used_bytes")),
                name,
                temperature_celsius: parse_f64(values, &format!("{prefix}temperature_celsius")),
                utilization_percent: parse_f64(values, &format!("{prefix}utilization_percent")),
                vendor: optional_text(values, &format!("{prefix}vendor")),
            })
        })
        .collect()
}

fn is_gpu_probe_error_name(name: &str) -> bool {
    let normalized = name.trim().to_ascii_lowercase();
    normalized.starts_with("nvidia-smi has failed")
        || normalized.starts_with("failed to initialize nvml")
        || normalized == "no devices were found"
}

/// 仅从已标准化的 key=value 行组装 NPU，避免 Rust 端绑定厂商表格的空格布局。
fn parse_server_npus(values: &HashMap<String, String>) -> Vec<ServerNpuInfo> {
    let mut indices = values
        .keys()
        .filter_map(|key| {
            let rest = key.strip_prefix("npu_")?;
            let (index, field) = rest.split_once('_')?;
            if field == "name" {
                index.parse::<usize>().ok()
            } else {
                None
            }
        })
        .collect::<Vec<_>>();
    indices.sort_unstable();
    indices.dedup();

    indices
        .into_iter()
        .filter_map(|index| {
            let prefix = format!("npu_{index}_");
            Some(ServerNpuInfo {
                id: parse_u32(values, &format!("{prefix}id"))?,
                chip_id: parse_u32(values, &format!("{prefix}chip_id")),
                name: optional_text(values, &format!("{prefix}name"))?,
                health: optional_text(values, &format!("{prefix}health")),
                bus_id: optional_text(values, &format!("{prefix}bus_id")),
                utilization_percent: parse_f64(values, &format!("{prefix}utilization_percent")),
                memory_total_bytes: parse_u64(values, &format!("{prefix}memory_total_bytes")),
                memory_used_bytes: parse_u64(values, &format!("{prefix}memory_used_bytes")),
                hbm_total_bytes: parse_u64(values, &format!("{prefix}hbm_total_bytes")),
                hbm_used_bytes: parse_u64(values, &format!("{prefix}hbm_used_bytes")),
                power_watts: parse_f64(values, &format!("{prefix}power_watts")),
                temperature_celsius: parse_f64(values, &format!("{prefix}temperature_celsius")),
            })
        })
        .collect()
}
