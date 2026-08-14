//! SSH 服务器信息采集服务。
//!
//! @author kongweiguang

use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tokio::sync::Mutex as AsyncMutex;

mod parsing;

pub use parsing::{parse_proc_net_dev, parse_server_info_output, ProcNetDevSnapshot};

use crate::{
    error::{AppError, AppResult},
    models::{
        remote_host::{RemoteHost, RemoteHostAuthType},
        server_info::{ServerInfoRequest, ServerInfoSnapshot},
        ssh_command::SshCommandRequest,
        target::RemoteTargetRef,
    },
    paths::KerminalPaths,
    services::{
        docker_host_service::build_container_exec_script, remote_host_service::RemoteHostService,
        ssh_command_service::SshCommandService,
    },
};

const SERVER_INFO_TIMEOUT: Duration = Duration::from_secs(15);
const SERVER_INFO_OUTPUT_BYTES: usize = 128 * 1024;
const SERVER_INFO_SINGLE_FLIGHT_WINDOW: Duration = Duration::from_millis(750);
const SERVER_INFO_SLOW_REFRESH_INTERVAL: Duration = Duration::from_secs(15);
const SERVER_INFO_STATIC_REFRESH_INTERVAL: Duration = Duration::from_secs(300);

/// 服务器信息采集业务入口。
#[derive(Debug, Default)]
pub struct ServerInfoService {
    targets: Mutex<HashMap<String, Arc<AsyncMutex<ServerInfoTargetCache>>>>,
}

#[derive(Debug, Default)]
struct ServerInfoTargetCache {
    snapshot: Option<ServerInfoSnapshot>,
    collected_at: Option<Instant>,
    slow_collected_at: Option<Instant>,
    static_collected_at: Option<Instant>,
}

/// 系统信息脚本的采集层级。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ServerInfoCollectionTier {
    /// 仅采集高频变化的 CPU、内存、负载与网络计数。
    Fast,
    /// 在高频指标之外刷新磁盘、进程与 GPU。
    FastAndSlow,
    /// 首次或静态缓存到期时采集完整系统信息。
    Full,
}

impl ServerInfoService {
    /// 创建服务器信息服务。
    pub fn new() -> Self {
        Self::default()
    }

    /// 使用远程主机记录里的 SSH 认证信息采集 SSH 主机或容器目标的系统信息快照。
    pub async fn snapshot_native(
        &self,
        _remote_hosts: &RemoteHostService,
        paths: &KerminalPaths,
        ssh_commands: &SshCommandService,
        request: ServerInfoRequest,
    ) -> AppResult<ServerInfoSnapshot> {
        let target = Self::target_from_request(request)?;
        let target_key = server_info_target_key(&target);
        let target_cache = {
            let mut targets = self
                .targets
                .lock()
                .unwrap_or_else(|error| error.into_inner());
            Arc::clone(
                targets
                    .entry(target_key)
                    .or_insert_with(|| Arc::new(AsyncMutex::new(ServerInfoTargetCache::default()))),
            )
        };
        let mut target_cache = target_cache.lock().await;
        let now = Instant::now();
        if target_cache.collected_at.is_some_and(|collected_at| {
            now.duration_since(collected_at) < SERVER_INFO_SINGLE_FLIGHT_WINDOW
        }) {
            if let Some(snapshot) = target_cache.snapshot.clone() {
                return Ok(snapshot);
            }
        }
        let tier = select_server_info_collection_tier(
            target_cache.snapshot.is_some(),
            target_cache
                .slow_collected_at
                .map(|value| now.duration_since(value)),
            target_cache
                .static_collected_at
                .map(|value| now.duration_since(value)),
        );
        let host_id = target.host_id().ok_or_else(|| {
            AppError::InvalidInput("服务器信息目标必须是 SSH 主机或容器".to_owned())
        })?;
        let host = ssh_commands
            .resolve_native_runtime_host_metadata(paths, host_id)
            .map_err(server_info_transport_error)?;
        let command_request = build_server_info_command_request_for_tier(&host, &target, tier)?;
        let output = ssh_commands
            .execute_native(paths, command_request)
            .await
            .map_err(server_info_transport_error)?;

        if !output.success {
            return Err(server_info_command_failure(&output.stdout, &output.stderr));
        }

        let partial = parse_server_info_output(&host, &output.stdout, unix_timestamp());
        let mut snapshot = match target_cache.snapshot.as_ref() {
            Some(cached) => merge_server_info_snapshot(cached, partial, tier),
            None => partial,
        };
        apply_target_metadata(&mut snapshot, &target);
        target_cache.snapshot = Some(snapshot.clone());
        target_cache.collected_at = Some(now);
        if matches!(
            tier,
            ServerInfoCollectionTier::FastAndSlow | ServerInfoCollectionTier::Full
        ) {
            target_cache.slow_collected_at = Some(now);
        }
        if tier == ServerInfoCollectionTier::Full {
            target_cache.static_collected_at = Some(now);
        }

        Ok(snapshot)
    }

    /// 从 IPC 请求解析有效目标。
    pub fn target_from_request(request: ServerInfoRequest) -> AppResult<RemoteTargetRef> {
        let request_host_id = normalize_plain_text("远程主机 id", &request.host_id)?;
        let target = request.target;
        target.validate()?;
        let target_host_id = target.host_id().ok_or_else(|| {
            AppError::InvalidInput("服务器信息目标必须是 SSH 主机或容器".to_owned())
        })?;
        if target_host_id != request_host_id {
            return Err(AppError::InvalidInput(
                "服务器信息目标主机和请求主机不一致".to_owned(),
            ));
        }
        Ok(target)
    }
}

/// 根据缓存年龄选择下一次采集层级。
pub fn select_server_info_collection_tier(
    has_snapshot: bool,
    slow_age: Option<Duration>,
    static_age: Option<Duration>,
) -> ServerInfoCollectionTier {
    if !has_snapshot
        || static_age.is_none()
        || static_age.is_some_and(|age| age >= SERVER_INFO_STATIC_REFRESH_INTERVAL)
    {
        ServerInfoCollectionTier::Full
    } else if slow_age.is_none()
        || slow_age.is_some_and(|age| age >= SERVER_INFO_SLOW_REFRESH_INTERVAL)
    {
        ServerInfoCollectionTier::FastAndSlow
    } else {
        ServerInfoCollectionTier::Fast
    }
}

/// 受控 SSH 命令计划。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServerInfoCommandPlan {
    /// SSH 可执行文件。
    pub executable: String,
    /// SSH 参数。
    pub args: Vec<String>,
    /// 远端执行脚本，通过 stdin 传入 `sh -s`。
    pub script: String,
}

/// 使用指定 SSH 可执行文件构建服务器信息采集计划。
pub fn build_server_info_plan_with_executable(
    host: &RemoteHost,
    executable: String,
) -> AppResult<ServerInfoCommandPlan> {
    build_server_info_plan_for_target_with_executable(
        host,
        &RemoteTargetRef::Ssh {
            host_id: host.id.clone(),
        },
        executable,
    )
}

/// 构建服务器信息采集用的带凭据 SSH 命令请求。
pub fn build_server_info_command_request(
    host: &RemoteHost,
    target: &RemoteTargetRef,
) -> AppResult<SshCommandRequest> {
    build_server_info_command_request_for_tier(host, target, ServerInfoCollectionTier::Full)
}

/// 按采集层级构建服务器信息命令请求。
pub fn build_server_info_command_request_for_tier(
    host: &RemoteHost,
    target: &RemoteTargetRef,
    tier: ServerInfoCollectionTier,
) -> AppResult<SshCommandRequest> {
    Ok(SshCommandRequest {
        host_id: host.id.clone(),
        command: build_server_info_script_for_target_tier(host, target, tier)?,
        timeout_seconds: Some(SERVER_INFO_TIMEOUT.as_secs()),
        max_output_bytes: Some(SERVER_INFO_OUTPUT_BYTES),
    })
}

/// 使用指定 SSH 可执行文件构建目标系统信息采集计划。
pub fn build_server_info_plan_for_target_with_executable(
    host: &RemoteHost,
    target: &RemoteTargetRef,
    executable: String,
) -> AppResult<ServerInfoCommandPlan> {
    ensure_target_matches_host(host, target)?;
    let mut args = vec![
        "-p".to_owned(),
        host.port.to_string(),
        "-o".to_owned(),
        "BatchMode=yes".to_owned(),
        "-o".to_owned(),
        "ConnectTimeout=10".to_owned(),
        "-o".to_owned(),
        "ServerAliveInterval=30".to_owned(),
        "-o".to_owned(),
        "ServerAliveCountMax=3".to_owned(),
    ];
    args.extend(auth_args(host.auth_type));
    args.push(format!("{}@{}", host.username, host.host));
    args.push("sh".to_owned());
    args.push("-s".to_owned());
    let script = build_server_info_script_for_target(host, target)?;

    Ok(ServerInfoCommandPlan {
        executable,
        args,
        script,
    })
}

fn build_server_info_script_for_target(
    host: &RemoteHost,
    target: &RemoteTargetRef,
) -> AppResult<String> {
    build_server_info_script_for_target_tier(host, target, ServerInfoCollectionTier::Full)
}

fn build_server_info_script_for_target_tier(
    host: &RemoteHost,
    target: &RemoteTargetRef,
    tier: ServerInfoCollectionTier,
) -> AppResult<String> {
    ensure_target_matches_host(host, target)?;
    let script = server_info_script_for_tier(tier);
    match target {
        RemoteTargetRef::Ssh { .. } => Ok(script),
        RemoteTargetRef::DockerContainer {
            container_id,
            runtime,
            ..
        } => {
            let container_id = normalize_plain_text("容器 id", container_id)?;
            Ok(build_container_exec_script(
                *runtime,
                &container_id,
                &script,
                &[],
            ))
        }
        RemoteTargetRef::Local { .. }
        | RemoteTargetRef::Telnet { .. }
        | RemoteTargetRef::Serial { .. } => Err(AppError::InvalidInput(
            "服务器信息目标必须是 SSH 主机或容器".to_owned(),
        )),
    }
}

fn server_info_target_key(target: &RemoteTargetRef) -> String {
    target.stable_id()
}

fn merge_server_info_snapshot(
    cached: &ServerInfoSnapshot,
    mut fresh: ServerInfoSnapshot,
    tier: ServerInfoCollectionTier,
) -> ServerInfoSnapshot {
    if tier != ServerInfoCollectionTier::Full {
        fresh.hostname = cached.hostname.clone();
        fresh.os = cached.os.clone();
        fresh.architecture = cached.architecture.clone();
        fresh.kernel = cached.kernel.clone();
        fresh.cpu_count = cached.cpu_count;
        fresh.cpu_model = cached.cpu_model.clone();
    }
    if tier == ServerInfoCollectionTier::Fast {
        fresh.disk_total_bytes = cached.disk_total_bytes;
        fresh.disk_used_bytes = cached.disk_used_bytes;
        fresh.disk_available_bytes = cached.disk_available_bytes;
        fresh.disk_mount = cached.disk_mount.clone();
        fresh.disks = cached.disks.clone();
        fresh.process_count = cached.process_count;
        fresh.running_process_count = cached.running_process_count;
        fresh.top_processes = cached.top_processes.clone();
        fresh.gpu_probe_status = cached.gpu_probe_status.clone();
        fresh.gpus = cached.gpus.clone();
        fresh.npu_probe_status = cached.npu_probe_status.clone();
        fresh.npus = cached.npus.clone();
    }
    fresh
}

fn ensure_target_matches_host(host: &RemoteHost, target: &RemoteTargetRef) -> AppResult<()> {
    target.validate()?;
    let target_host_id = target
        .host_id()
        .ok_or_else(|| AppError::InvalidInput("服务器信息目标必须是 SSH 主机或容器".to_owned()))?;
    if target_host_id != host.id {
        return Err(AppError::InvalidInput(
            "服务器信息目标主机和 SSH 主机不一致".to_owned(),
        ));
    }
    Ok(())
}

fn apply_target_metadata(snapshot: &mut ServerInfoSnapshot, target: &RemoteTargetRef) {
    if let RemoteTargetRef::DockerContainer {
        container_id,
        container_name,
        ..
    } = target
    {
        snapshot.host_name = container_name
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
            .unwrap_or_else(|| short_target_label(container_id));
    }
}

fn short_target_label(value: &str) -> String {
    let trimmed = value.trim();
    let shortened: String = trimmed.chars().take(12).collect();
    if shortened.is_empty() {
        "container".to_owned()
    } else {
        shortened
    }
}

fn normalize_plain_text(field: &str, value: &str) -> AppResult<String> {
    let value = value.trim();
    if value.is_empty() {
        return Err(AppError::InvalidInput(format!("{field}不能为空")));
    }
    if value.contains('\0') || value.contains('\n') || value.contains('\r') {
        return Err(AppError::InvalidInput(format!("{field}不能包含控制字符")));
    }
    Ok(value.to_owned())
}

fn server_info_transport_error(error: AppError) -> AppError {
    match error {
        AppError::Credential(message) | AppError::SshCommand(message) => {
            AppError::ServerInfo(message)
        }
        other => other,
    }
}

fn server_info_command_failure(stdout: &str, stderr: &str) -> AppError {
    let stderr = stderr.trim();
    let stdout = stdout.trim();
    let detail = if stderr.is_empty() { stdout } else { stderr };
    AppError::ServerInfo(if detail.is_empty() {
        "远端采集脚本未成功退出".to_owned()
    } else {
        detail.to_owned()
    })
}

fn auth_args(auth_type: RemoteHostAuthType) -> Vec<String> {
    let preferred = match auth_type {
        RemoteHostAuthType::Password => "password,keyboard-interactive",
        RemoteHostAuthType::Key => "publickey",
        RemoteHostAuthType::Agent => "publickey,keyboard-interactive,password",
    };

    vec![
        "-o".to_owned(),
        format!("PreferredAuthentications={preferred}"),
    ]
}

fn unix_timestamp() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_owned())
}

fn server_info_script_for_tier(tier: ServerInfoCollectionTier) -> String {
    let mut active_tier = None;
    SERVER_INFO_SCRIPT
        .lines()
        .filter(|line| match line.trim() {
            "# KERMINAL_TIER_STATIC_BEGIN" => {
                active_tier = Some(ServerInfoCollectionTier::Full);
                false
            }
            "# KERMINAL_TIER_FAST_BEGIN" => {
                active_tier = Some(ServerInfoCollectionTier::Fast);
                false
            }
            "# KERMINAL_TIER_SLOW_BEGIN" => {
                active_tier = Some(ServerInfoCollectionTier::FastAndSlow);
                false
            }
            "# KERMINAL_TIER_END" => {
                active_tier = None;
                false
            }
            _ => match (tier, active_tier) {
                (ServerInfoCollectionTier::Full, _) => true,
                (ServerInfoCollectionTier::FastAndSlow, Some(section)) => {
                    section != ServerInfoCollectionTier::Full
                }
                (ServerInfoCollectionTier::Fast, Some(section)) => {
                    section == ServerInfoCollectionTier::Fast
                }
                (_, None) => line.trim().is_empty(),
            },
        })
        .collect::<Vec<_>>()
        .join("\n")
}

const SERVER_INFO_SCRIPT: &str = r#"
# KERMINAL_TIER_STATIC_BEGIN
printf 'hostname=%s\n' "$(hostname 2>/dev/null)"
if [ -r /etc/os-release ]; then
  os_pretty="$(awk -F= '/^PRETTY_NAME=/ {
    value=$2
    gsub(/^"/, "", value)
    gsub(/"$/, "", value)
    print value
    exit
  }' /etc/os-release 2>/dev/null)"
fi
if [ -n "$os_pretty" ]; then
  printf 'os=%s\n' "$os_pretty"
else
  printf 'os=%s\n' "$(uname -s 2>/dev/null)"
fi
printf 'architecture=%s\n' "$(uname -m 2>/dev/null)"
printf 'kernel=%s\n' "$(uname -r 2>/dev/null)"
# KERMINAL_TIER_END

# KERMINAL_TIER_FAST_BEGIN
if [ -r /proc/uptime ]; then
  awk '{ printf "uptime_seconds=%s\n", $1 }' /proc/uptime
fi

if [ -r /proc/loadavg ]; then
  awk '{ printf "load_average=%s %s %s\n", $1, $2, $3 }' /proc/loadavg
fi
# KERMINAL_TIER_END

# KERMINAL_TIER_STATIC_BEGIN
cpu_count="$(getconf _NPROCESSORS_ONLN 2>/dev/null || nproc 2>/dev/null)"
if [ -n "$cpu_count" ]; then
  printf 'cpu_count=%s\n' "$cpu_count"
fi

if [ -r /proc/cpuinfo ]; then
  awk -F: '
    /^(model name|Hardware|Processor)[[:space:]]*:/ {
      value=$2
      sub(/^[[:space:]]+/, "", value)
      if (value != "") {
        printf "cpu_model=%s\n", value
        exit
      }
    }
  ' /proc/cpuinfo
fi
# KERMINAL_TIER_END

# KERMINAL_TIER_FAST_BEGIN
if [ -r /proc/stat ]; then
  read_cpu_snapshot() {
    awk '/^cpu[0-9]* / {
      total=0
      for (i=2; i<=NF; i++) total += $i
      idle=$5 + $6
      printf "%s %s %s\n", $1, idle, total
    }' /proc/stat
  }
  {
    read_cpu_snapshot
    printf "__KERMINAL_CPU_AFTER__\n"
    sleep 0.12 2>/dev/null || sleep 1
    read_cpu_snapshot
  } | awk '
    $1 == "__KERMINAL_CPU_AFTER__" {
      after=1
      next
    }
    after != 1 {
      if ($1 != "") {
        before_idle[$1]=$2
        before_total[$1]=$3
      }
      next
    }
    {
      key=$1
      if (key == "" || !(key in before_total)) next
      idle=$2-before_idle[key]
      total=$3-before_total[key]
      if (total <= 0) next
      usage=(total-idle)*100/total
      if (key == "cpu") {
        printf "cpu_usage_percent=%.2f\n", usage
      } else if (key ~ /^cpu[0-9]+$/) {
        core_index=substr(key, 4)
        printf "cpu_core_%s_usage_percent=%.2f\n", core_index, usage
      }
    }
  '
fi

if [ -r /proc/meminfo ]; then
  awk '
    /^MemTotal:/ { mem_total=$2*1024 }
    /^MemAvailable:/ { mem_available=$2*1024 }
    /^Buffers:/ { mem_buffers=$2*1024 }
    /^Cached:/ { mem_cached=$2*1024 }
    /^SwapTotal:/ { swap_total=$2*1024 }
    /^SwapFree:/ { swap_free=$2*1024 }
    END {
      if (mem_total > 0) {
        printf "memory_total_bytes=%.0f\n", mem_total
        printf "memory_used_bytes=%.0f\n", mem_total-mem_available
        printf "memory_available_bytes=%.0f\n", mem_available
        printf "memory_buffers_bytes=%.0f\n", mem_buffers
        printf "memory_cached_bytes=%.0f\n", mem_cached
      }
      if (swap_total >= 0) {
        printf "swap_total_bytes=%.0f\n", swap_total
        printf "swap_used_bytes=%.0f\n", swap_total-swap_free
      }
    }
  ' /proc/meminfo
fi
# KERMINAL_TIER_END

# KERMINAL_TIER_SLOW_BEGIN
df -Pk / 2>/dev/null | awk 'NR==2 {
  printf "disk_total_bytes=%.0f\n", $2*1024
  printf "disk_used_bytes=%.0f\n", $3*1024
  printf "disk_available_bytes=%.0f\n", $4*1024
  printf "disk_mount=%s\n", $6
}'

df -Pk 2>/dev/null | awk 'NR > 1 {
  if ($1 == "tmpfs" || $1 == "devtmpfs") next
  printf "disk_%d_filesystem=%s\n", idx, $1
  printf "disk_%d_total_bytes=%.0f\n", idx, $2*1024
  printf "disk_%d_used_bytes=%.0f\n", idx, $3*1024
  printf "disk_%d_available_bytes=%.0f\n", idx, $4*1024
  printf "disk_%d_mount=%s\n", idx, $6
  idx++
}'
# KERMINAL_TIER_END

# KERMINAL_TIER_FAST_BEGIN
if [ -r /proc/net/dev ]; then
  awk 'NR > 2 {
    printf "proc_net_dev_line_%d=%s\n", idx, $0
    idx++
  }' /proc/net/dev
fi
# KERMINAL_TIER_END

# KERMINAL_TIER_SLOW_BEGIN
if command -v ps >/dev/null 2>&1; then
  ps -eo stat= 2>/dev/null | awk '{
    count++
    if ($1 ~ /^R/) running++
  } END {
    if (count > 0) {
      printf "process_count=%d\n", count
      printf "running_process_count=%d\n", running
    }
  }'
  ps -eo pid=,comm=,pcpu=,pmem=,rss= 2>/dev/null | sort -k3 -nr 2>/dev/null | awk 'NF >= 5 {
    printf "process_%d_pid=%s\n", idx, $1
    printf "process_%d_name=%s\n", idx, $2
    printf "process_%d_cpu_usage_percent=%s\n", idx, $3
    printf "process_%d_memory_percent=%s\n", idx, $4
    printf "process_%d_memory_bytes=%.0f\n", idx, $5*1024
    idx++
    if (idx >= 5) exit
  }'
fi

run_with_timeout() {
  timeout_seconds="$1"
  shift
  if command -v timeout >/dev/null 2>&1; then
    timeout "$timeout_seconds" "$@"
  else
    "$@"
  fi
}

if command -v npu-smi >/dev/null 2>&1; then
  npu_output="$(run_with_timeout 4 npu-smi info 2>/dev/null)"
  npu_exit="$?"
  npu_rows="$(printf '%s\n' "$npu_output" | awk -F'|' '
    BEGIN { pending=-1; npu_index=0 }
    function trim(value) {
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
      return value
    }
    /^\|/ {
      left=trim($2)
      middle=trim($3)
      right=trim($4)
      if (middle ~ /^(OK|Warning|Alarm|Critical|UNKNOWN)$/) {
        identity_count=split(left, identity, /[[:space:]]+/)
        if (identity_count < 2 || identity[1] !~ /^[0-9]+$/) next
        name=identity[2]
        for (part=3; part<=identity_count; part++) name=name " " identity[part]
        pending=npu_index
        printf "npu_%d_id=%s\n", npu_index, identity[1]
        printf "npu_%d_name=%s\n", npu_index, name
        printf "npu_%d_health=%s\n", npu_index, middle
        stat_count=split(right, stats, /[[:space:]]+/)
        if (stat_count >= 1 && stats[1] ~ /^[0-9.]+$/) printf "npu_%d_power_watts=%s\n", npu_index, stats[1]
        if (stat_count >= 2 && stats[2] ~ /^[0-9.]+$/) printf "npu_%d_temperature_celsius=%s\n", npu_index, stats[2]
        npu_index++
        next
      }
      if (pending >= 0 && left ~ /^[0-9]+$/ && middle != "") {
        printf "npu_%d_chip_id=%s\n", pending, left
        printf "npu_%d_bus_id=%s\n", pending, middle
        usage_count=split(right, usage, /[[:space:]]+/)
        if (usage_count >= 1 && usage[1] ~ /^[0-9.]+$/) printf "npu_%d_utilization_percent=%s\n", pending, usage[1]
        if (usage_count >= 4 && usage[2] ~ /^[0-9.]+$/ && usage[4] ~ /^[0-9.]+$/) {
          printf "npu_%d_memory_used_bytes=%.0f\n", pending, usage[2]*1048576
          printf "npu_%d_memory_total_bytes=%.0f\n", pending, usage[4]*1048576
        }
        if (usage_count >= 7 && usage[5] ~ /^[0-9.]+$/ && usage[7] ~ /^[0-9.]+$/) {
          printf "npu_%d_hbm_used_bytes=%.0f\n", pending, usage[5]*1048576
          printf "npu_%d_hbm_total_bytes=%.0f\n", pending, usage[7]*1048576
        }
        pending=-1
      }
    }
  ')"
  if printf '%s\n' "$npu_rows" | grep -q '^npu_0_name='; then
    printf 'npu_probe_status=npu_smi\n'
    printf '%s\n' "$npu_rows"
  elif [ "$npu_exit" -eq 0 ] 2>/dev/null; then
    printf 'npu_probe_status=npu_smi_no_devices\n'
  else
    printf 'npu_probe_status=npu_smi_failed\n'
  fi
else
  printf 'npu_probe_status=no_probe_command\n'
fi

if command -v nvidia-smi >/dev/null 2>&1; then
  gpu_lines="$(run_with_timeout 4 nvidia-smi --query-gpu=name,driver_version,memory.total,memory.used,utilization.gpu,temperature.gpu --format=csv,noheader,nounits 2>/dev/null || true)"
  gpu_lines="$(printf '%s\n' "$gpu_lines" | awk -F, 'NF >= 6 { print }')"
  gpu_count="$(printf '%s\n' "$gpu_lines" | awk 'NF { count++ } END { print count+0 }')"
  if [ "$gpu_count" -gt 0 ] 2>/dev/null; then
    printf 'gpu_probe_status=nvidia_smi\n'
    printf 'gpu_count=%s\n' "$gpu_count"
    gpu_index=0
    printf '%s\n' "$gpu_lines" | while IFS=, read -r gpu_name gpu_driver gpu_mem_total gpu_mem_used gpu_util gpu_temp; do
      gpu_name="$(printf '%s' "$gpu_name" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
      gpu_driver="$(printf '%s' "$gpu_driver" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
      gpu_mem_total="$(printf '%s' "$gpu_mem_total" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
      gpu_mem_used="$(printf '%s' "$gpu_mem_used" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
      gpu_util="$(printf '%s' "$gpu_util" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
      gpu_temp="$(printf '%s' "$gpu_temp" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
      if [ -z "$gpu_name" ]; then
        continue
      fi
      printf 'gpu_%s_name=%s\n' "$gpu_index" "$gpu_name"
      printf 'gpu_%s_vendor=NVIDIA\n' "$gpu_index"
      if [ -n "$gpu_driver" ] && [ "$gpu_driver" != "N/A" ]; then
        printf 'gpu_%s_driver_version=%s\n' "$gpu_index" "$gpu_driver"
      fi
      gpu_mem_total_bytes="$(awk -v mib="$gpu_mem_total" 'BEGIN { if (mib ~ /^[0-9.]+$/) printf "%.0f", mib*1048576 }')"
      gpu_mem_used_bytes="$(awk -v mib="$gpu_mem_used" 'BEGIN { if (mib ~ /^[0-9.]+$/) printf "%.0f", mib*1048576 }')"
      if [ -n "$gpu_mem_total_bytes" ]; then
        printf 'gpu_%s_memory_total_bytes=%s\n' "$gpu_index" "$gpu_mem_total_bytes"
      fi
      if [ -n "$gpu_mem_used_bytes" ]; then
        printf 'gpu_%s_memory_used_bytes=%s\n' "$gpu_index" "$gpu_mem_used_bytes"
      fi
      if printf '%s' "$gpu_util" | awk '{ exit !($1 ~ /^[0-9.]+$/) }'; then
        printf 'gpu_%s_utilization_percent=%s\n' "$gpu_index" "$gpu_util"
      fi
      if printf '%s' "$gpu_temp" | awk '{ exit !($1 ~ /^[0-9.]+$/) }'; then
        printf 'gpu_%s_temperature_celsius=%s\n' "$gpu_index" "$gpu_temp"
      fi
      gpu_index=$((gpu_index + 1))
    done
  else
    gpu_lines="$(run_with_timeout 3 nvidia-smi -L 2>/dev/null | sed -n 's/^GPU [0-9][0-9]*: //p' | sed 's/ (UUID:.*$//' || true)"
    gpu_count="$(printf '%s\n' "$gpu_lines" | awk 'NF { count++ } END { print count+0 }')"
    if [ "$gpu_count" -gt 0 ] 2>/dev/null; then
      printf 'gpu_probe_status=nvidia_smi_list\n'
      printf 'gpu_count=%s\n' "$gpu_count"
      gpu_index=0
      printf '%s\n' "$gpu_lines" | while IFS= read -r gpu_name; do
        gpu_name="$(printf '%s' "$gpu_name" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
        if [ -z "$gpu_name" ]; then
          continue
        fi
        printf 'gpu_%s_name=%s\n' "$gpu_index" "$gpu_name"
        printf 'gpu_%s_vendor=NVIDIA\n' "$gpu_index"
        gpu_index=$((gpu_index + 1))
      done
    else
      printf 'gpu_probe_status=nvidia_smi_no_devices\n'
    fi
  fi
elif command -v lspci >/dev/null 2>&1; then
  gpu_lines="$(run_with_timeout 2 lspci 2>/dev/null | awk -F': ' '/(VGA compatible controller|3D controller|Display controller)/ { print $2 }')"
  gpu_count="$(printf '%s\n' "$gpu_lines" | awk 'NF { count++ } END { print count+0 }')"
  if [ "$gpu_count" -gt 0 ] 2>/dev/null; then
    printf 'gpu_probe_status=lspci\n'
    gpu_index=0
    printf '%s\n' "$gpu_lines" | while IFS= read -r gpu_name; do
      gpu_name="$(printf '%s' "$gpu_name" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
      if [ -z "$gpu_name" ]; then
        continue
      fi
      printf 'gpu_%s_name=%s\n' "$gpu_index" "$gpu_name"
      gpu_index=$((gpu_index + 1))
    done
  else
    printf 'gpu_probe_status=lspci_no_devices\n'
  fi
else
  printf 'gpu_probe_status=no_probe_command\n'
fi
# KERMINAL_TIER_END
"#;
