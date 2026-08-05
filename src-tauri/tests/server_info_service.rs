//! 服务器信息服务集成测试。
//!
//! @author kongweiguang

mod support;

use kerminal_lib::{
    error::AppError,
    models::{
        remote_host::{RemoteHost, RemoteHostAuthType, RemoteHostCreateRequest},
        server_info::ServerInfoRequest,
        target::{ContainerRuntime, RemoteTargetRef},
    },
    paths::KerminalPaths,
    services::{
        server_info_service::{
            build_server_info_command_request, build_server_info_command_request_for_tier,
            build_server_info_plan_for_target_with_executable,
            build_server_info_plan_with_executable, parse_proc_net_dev, parse_server_info_output,
            select_server_info_collection_tier, ServerInfoCollectionTier,
        },
        ssh_runtime::{SshAuthIdentity, SshAuthSecretKind},
    },
    state::AppState,
};
use std::sync::Arc;
use std::time::Duration;
use support::managed_ssh_runtime::{ssh_command_service_with_fake_runtime, FakeManagedSshRuntime};
use tempfile::{tempdir, TempDir};

#[tokio::test]
async fn native_snapshot_rejects_unknown_remote_host_before_opening_managed_exec() {
    let (_home, state) = test_state();

    let error = state
        .server_info()
        .snapshot_native(
            state.remote_hosts(),
            state.paths(),
            state.ssh_commands(),
            ServerInfoRequest {
                host_id: "missing-host".to_owned(),
                target: RemoteTargetRef::Ssh {
                    host_id: "missing-host".to_owned(),
                },
            },
        )
        .await
        .expect_err("reject unknown host");

    assert!(matches!(error, AppError::NotFound(_)));
}

#[tokio::test]
async fn native_snapshot_missing_external_target_does_not_read_host_toml_path() {
    let (_home, state) = test_state();

    let error = state
        .server_info()
        .snapshot_native(
            state.remote_hosts(),
            state.paths(),
            state.ssh_commands(),
            ServerInfoRequest {
                host_id: "external:missing-launch".to_owned(),
                target: RemoteTargetRef::Ssh {
                    host_id: "external:missing-launch".to_owned(),
                },
            },
        )
        .await
        .expect_err("missing external target should fail before file store");

    let message = error.to_string();
    assert!(matches!(error, AppError::NotFound(_)));
    assert!(message.contains("外部 SSH 临时目标不存在或已关闭"));
    assert!(!message.contains("invalid remote host id"));
    assert!(!message.contains("invalid file store path"));
}

#[test]
fn build_plan_uses_parameterized_openssh_args_without_old_credential_refs() {
    let plan =
        build_server_info_plan_with_executable(&remote_host(RemoteHostAuthType::Key), "ssh".into())
            .expect("build plan");

    assert_eq!(plan.executable, "ssh");
    assert!(plan.args.windows(2).any(|pair| pair == ["-p", "2222"]));
    assert!(plan
        .args
        .windows(2)
        .any(|pair| pair == ["-o", "BatchMode=yes"]));
    assert!(plan
        .args
        .contains(&"PreferredAuthentications=publickey".to_owned()));
    assert!(plan.args.windows(2).any(|pair| pair == ["sh", "-s"]));
    assert!(plan.script.contains("/proc/meminfo"));
    assert!(plan.script.contains("__KERMINAL_CPU_AFTER__"));
    assert!(plan.script.contains("cpu_core_%s_usage_percent"));
    assert!(plan.script.contains("core_index=substr(key, 4)"));
    assert!(!plan.script.contains("\n        index=substr(key, 4)"));
    assert!(plan.script.contains("process_count"));
    assert!(plan.script.contains("proc_net_dev_line_%d=%s"));
    assert!(!plan.script.contains("network_interface_%d_name"));
    assert!(!plan.script.contains("split(parts[2], fields"));
    assert!(!plan.script.contains("awk -F'[: ]+'"));
    assert!(!plan.script.contains("if ($2 == \"lo\") next"));
    assert!(plan.script.contains("disk_%d_mount"));
    assert!(plan.script.contains("nvidia-smi"));
    assert!(plan.script.contains("nvidia-smi -L"));
    assert!(plan.script.contains("gpu_probe_status=nvidia_smi_list"));
    assert!(plan.script.contains("lspci"));
    assert!(plan.script.contains("gpu_probe_status"));
    assert!(plan.script.contains("timeout \"$timeout_seconds\""));
    assert_eq!(
        plan.args
            .iter()
            .filter(|arg| arg.as_str() == "deploy@dev.internal")
            .count(),
        1
    );
    assert!(!plan.args.iter().any(|arg| arg.contains("credential:ssh")));
}

#[test]
fn proc_net_dev_parser_handles_leading_whitespace_and_tx_field() {
    let fixture = include_str!("fixtures/server-info/proc-net-dev.txt");

    let snapshot = parse_proc_net_dev(fixture);

    assert_eq!(snapshot.interfaces.len(), 3);
    assert_eq!(snapshot.interfaces[0].name, "lo");
    assert_eq!(snapshot.interfaces[0].rx_bytes, Some(1_024));
    assert_eq!(snapshot.interfaces[0].tx_bytes, Some(1_024));
    assert_eq!(snapshot.interfaces[1].name, "eth0");
    assert_eq!(snapshot.interfaces[1].rx_bytes, Some(123_456_789_012));
    assert_eq!(snapshot.interfaces[1].tx_bytes, Some(9_876_543_210));
    assert_eq!(snapshot.total_rx_bytes, Some(123_456_794_132));
    assert_eq!(snapshot.total_tx_bytes, Some(9_876_546_282));
}

#[test]
fn build_command_request_uses_plaintext_password_execution_path() {
    let host = remote_host(RemoteHostAuthType::Password);
    let target = RemoteTargetRef::Ssh {
        host_id: host.id.clone(),
    };

    let request = build_server_info_command_request(&host, &target).expect("build request");

    assert_eq!(request.host_id, "host-1");
    assert_eq!(request.timeout_seconds, Some(15));
    assert_eq!(request.max_output_bytes, Some(128 * 1024));
    assert!(request.command.contains("/proc/meminfo"));
    assert!(request.command.contains("__KERMINAL_CPU_AFTER__"));
    assert!(!request.command.contains("BatchMode=yes"));
    assert!(!request.command.contains("credential:ssh"));
}

#[test]
fn collection_tier_respects_fast_slow_and_static_cache_windows() {
    assert_eq!(
        select_server_info_collection_tier(false, None, None),
        ServerInfoCollectionTier::Full
    );
    assert_eq!(
        select_server_info_collection_tier(
            true,
            Some(Duration::from_secs(2)),
            Some(Duration::from_secs(2))
        ),
        ServerInfoCollectionTier::Fast
    );
    assert_eq!(
        select_server_info_collection_tier(
            true,
            Some(Duration::from_secs(15)),
            Some(Duration::from_secs(20))
        ),
        ServerInfoCollectionTier::FastAndSlow
    );
    assert_eq!(
        select_server_info_collection_tier(
            true,
            Some(Duration::from_secs(1)),
            Some(Duration::from_secs(300))
        ),
        ServerInfoCollectionTier::Full
    );
}

#[test]
fn fast_collection_script_excludes_slow_and_static_commands() {
    let host = remote_host(RemoteHostAuthType::Password);
    let target = RemoteTargetRef::Ssh {
        host_id: host.id.clone(),
    };

    let request =
        build_server_info_command_request_for_tier(&host, &target, ServerInfoCollectionTier::Fast)
            .expect("build fast request");

    assert!(request.command.contains("/proc/stat"));
    assert!(request.command.contains("/proc/meminfo"));
    assert!(request.command.contains("/proc/net/dev"));
    assert!(!request.command.contains("df -Pk"));
    assert!(!request.command.contains("ps -eo"));
    assert!(!request.command.contains("nvidia-smi"));
    assert!(!request.command.contains("lspci"));
    assert!(!request.command.contains("/etc/os-release"));
    assert!(!request.command.contains("/proc/cpuinfo"));
}

#[test]
fn build_plan_wraps_server_info_script_for_container_target() {
    let target = RemoteTargetRef::DockerContainer {
        host_id: "host-1".to_owned(),
        container_id: "api-container".to_owned(),
        runtime: ContainerRuntime::Podman,
        container_name: Some("api".to_owned()),
        user: None,
        workdir: None,
    };

    let plan = build_server_info_plan_for_target_with_executable(
        &remote_host(RemoteHostAuthType::Key),
        &target,
        "ssh".into(),
    )
    .expect("build container plan");

    assert!(plan.args.windows(2).any(|pair| pair == ["sh", "-s"]));
    assert!(plan.script.contains("runtime='podman'"));
    assert!(plan.script.contains("container='api-container'"));
    assert!(plan
        .script
        .contains("\"$runtime\" exec \"$container\" sh -lc"));
    assert!(plan.script.contains("/proc/meminfo"));
    assert!(plan.script.contains("__KERMINAL_CPU_AFTER__"));
    assert!(!plan.script.contains("credential:ssh"));
}

#[test]
fn build_plan_rejects_container_target_for_different_host() {
    let target = RemoteTargetRef::DockerContainer {
        host_id: "other-host".to_owned(),
        container_id: "api-container".to_owned(),
        runtime: ContainerRuntime::Docker,
        container_name: Some("api".to_owned()),
        user: None,
        workdir: None,
    };

    let error = build_server_info_plan_for_target_with_executable(
        &remote_host(RemoteHostAuthType::Key),
        &target,
        "ssh".into(),
    )
    .expect_err("reject mismatched host");

    assert!(matches!(error, AppError::InvalidInput(_)));
}

#[test]
fn parser_handles_partial_linux_snapshot() {
    let snapshot = parse_server_info_output(
        &remote_host(RemoteHostAuthType::Agent),
        r#"
hostname=dev-api
os=Linux
architecture=x86_64
kernel=6.8.0
uptime_seconds=86461.22
load_average=0.12 0.20 0.31
cpu_count=8
cpu_model=AMD EPYC 7B13
cpu_usage_percent=13.45
cpu_core_0_usage_percent=9.50
cpu_core_1_usage_percent=17.25
cpu_core_2_usage_percent=0.00
process_count=154
running_process_count=3
memory_total_bytes=8589934592
memory_used_bytes=3221225472
memory_available_bytes=5368709120
memory_buffers_bytes=268435456
memory_cached_bytes=1879048192
swap_total_bytes=2147483648
swap_used_bytes=0
disk_total_bytes=68719476736
disk_used_bytes=17179869184
disk_available_bytes=51539607552
disk_mount=/
disk_0_filesystem=/dev/sda1
disk_0_total_bytes=68719476736
disk_0_used_bytes=17179869184
disk_0_available_bytes=51539607552
disk_0_mount=/
disk_1_filesystem=/dev/sdb1
disk_1_total_bytes=137438953472
disk_1_used_bytes=34359738368
disk_1_available_bytes=103079215104
disk_1_mount=/data
network_rx_bytes=123456
network_tx_bytes=654321
network_interface_0_name=eth0
network_interface_0_rx_bytes=120000
network_interface_0_tx_bytes=640000
network_interface_1_name=tailscale0
network_interface_1_rx_bytes=3456
network_interface_1_tx_bytes=14321
network_interface_2_name=lo
network_interface_2_rx_bytes=512
network_interface_2_tx_bytes=512
process_0_pid=101
process_0_name=kerminal-agent
process_0_cpu_usage_percent=8.2
process_0_memory_percent=1.4
process_0_memory_bytes=73400320
process_1_pid=202
process_1_name=sshd
process_1_cpu_usage_percent=1.1
process_1_memory_percent=0.3
process_1_memory_bytes=15728640
gpu_probe_status=nvidia_smi
gpu_count=1
gpu_0_name=NVIDIA RTX 4090
gpu_0_vendor=NVIDIA
gpu_0_driver_version=555.42
gpu_0_memory_total_bytes=25769803776
gpu_0_memory_used_bytes=6442450944
gpu_0_utilization_percent=36.5
gpu_0_temperature_celsius=54
"#,
        "100".to_owned(),
    );

    assert_eq!(snapshot.host_id, "host-1");
    assert_eq!(snapshot.hostname.as_deref(), Some("dev-api"));
    assert_eq!(snapshot.uptime_seconds, Some(86461));
    assert_eq!(snapshot.load_average, Some([0.12, 0.20, 0.31]));
    assert_eq!(snapshot.cpu_model.as_deref(), Some("AMD EPYC 7B13"));
    assert_eq!(snapshot.cpu_usage_percent, Some(13.45));
    assert_eq!(snapshot.cpu_core_usage_percents, vec![9.50, 17.25, 0.00]);
    assert_eq!(snapshot.process_count, Some(154));
    assert_eq!(snapshot.running_process_count, Some(3));
    assert_eq!(snapshot.memory_total_bytes, Some(8_589_934_592));
    assert_eq!(snapshot.memory_available_bytes, Some(5_368_709_120));
    assert_eq!(snapshot.memory_buffers_bytes, Some(268_435_456));
    assert_eq!(snapshot.memory_cached_bytes, Some(1_879_048_192));
    assert_eq!(snapshot.disk_mount.as_deref(), Some("/"));
    assert_eq!(snapshot.disk_available_bytes, Some(51_539_607_552));
    assert_eq!(snapshot.disks.len(), 2);
    assert_eq!(snapshot.disks[1].mount, "/data");
    assert_eq!(snapshot.disks[1].available_bytes, Some(103_079_215_104));
    assert_eq!(snapshot.network_tx_bytes, Some(654_321));
    assert_eq!(snapshot.network_interfaces.len(), 3);
    assert_eq!(snapshot.network_interfaces[0].name, "eth0");
    assert_eq!(snapshot.network_interfaces[1].tx_bytes, Some(14_321));
    assert_eq!(snapshot.network_interfaces[2].name, "lo");
    assert_eq!(snapshot.top_processes.len(), 2);
    assert_eq!(snapshot.top_processes[0].pid, 101);
    assert_eq!(snapshot.top_processes[0].name, "kerminal-agent");
    assert_eq!(snapshot.top_processes[0].memory_bytes, Some(73_400_320));
    assert_eq!(snapshot.gpu_probe_status.as_deref(), Some("nvidia_smi"));
    assert_eq!(snapshot.gpus.len(), 1);
    assert_eq!(snapshot.gpus[0].name, "NVIDIA RTX 4090");
    assert_eq!(snapshot.gpus[0].memory_used_bytes, Some(6_442_450_944));
    assert_eq!(snapshot.gpus[0].utilization_percent, Some(36.5));
}

#[test]
fn parser_handles_static_nvidia_smi_gpu_list_snapshot() {
    let snapshot = parse_server_info_output(
        &remote_host(RemoteHostAuthType::Agent),
        r#"
hostname=dev-api
gpu_probe_status=nvidia_smi_list
gpu_count=1
gpu_0_name=NVIDIA RTX 4500 Ada Generation
gpu_0_vendor=NVIDIA
"#,
        "100".to_owned(),
    );

    assert_eq!(
        snapshot.gpu_probe_status.as_deref(),
        Some("nvidia_smi_list")
    );
    assert_eq!(snapshot.gpus.len(), 1);
    assert_eq!(snapshot.gpus[0].name, "NVIDIA RTX 4500 Ada Generation");
    assert_eq!(snapshot.gpus[0].vendor.as_deref(), Some("NVIDIA"));
    assert_eq!(snapshot.gpus[0].utilization_percent, None);
    assert_eq!(snapshot.gpus[0].memory_used_bytes, None);
}

#[test]
fn parser_ignores_nvidia_smi_failure_text_as_gpu_name() {
    let snapshot = parse_server_info_output(
        &remote_host(RemoteHostAuthType::Agent),
        r#"
hostname=dev-api
gpu_probe_status=nvidia_smi
gpu_count=1
gpu_0_name=NVIDIA-SMI has failed because it couldn't communicate with the NVIDIA driver.
gpu_0_vendor=NVIDIA
"#,
        "100".to_owned(),
    );

    assert_eq!(snapshot.gpu_probe_status.as_deref(), Some("nvidia_smi"));
    assert!(snapshot.gpus.is_empty());
}

#[tokio::test]
async fn native_snapshot_uses_managed_exec_runtime_for_ssh_target() {
    let (_home, state) = test_state();
    let host_id = create_saved_password_host(&state);
    let backend = Arc::new(FakeManagedSshRuntime::with_stdout(
        r#"
hostname=managed-api
os=Linux
architecture=x86_64
cpu_count=2
memory_total_bytes=4096
"#,
    ));
    let ssh_commands = ssh_command_service_with_fake_runtime(&state, Arc::clone(&backend));

    let snapshot = state
        .server_info()
        .snapshot_native(
            state.remote_hosts(),
            state.paths(),
            &ssh_commands,
            ServerInfoRequest {
                host_id: host_id.clone(),
                target: RemoteTargetRef::Ssh {
                    host_id: host_id.clone(),
                },
            },
        )
        .await
        .expect("collect server info through managed exec");

    assert_eq!(snapshot.hostname.as_deref(), Some("managed-api"));
    assert_eq!(snapshot.cpu_count, Some(2));
    assert_eq!(backend.connect_count(), 1);
    assert_eq!(backend.exec_count(), 1);
    assert_eq!(backend.channel_count(), 0);
    let script = backend.last_exec_script().expect("managed exec script");
    assert!(script.contains("/proc/meminfo"));
    assert!(script.contains("__KERMINAL_CPU_AFTER__"));
    let key = backend.last_key().expect("managed session key");
    assert_eq!(key.target.host, "dev.internal");
    assert!(matches!(
        key.target.auth,
        SshAuthIdentity::VaultRef {
            secret_kind: SshAuthSecretKind::Password,
            ..
        }
    ));
    assert!(!format!("{key:?}").contains("correct horse"));
}

#[tokio::test]
async fn native_snapshot_coalesces_same_target_requests_inside_single_flight_window() {
    let (_home, state) = test_state();
    let host_id = create_saved_password_host(&state);
    let backend = Arc::new(FakeManagedSshRuntime::with_stdout(
        "hostname=managed-api\ncpu_usage_percent=12\n",
    ));
    let ssh_commands = ssh_command_service_with_fake_runtime(&state, Arc::clone(&backend));
    let request = ServerInfoRequest {
        host_id: host_id.clone(),
        target: RemoteTargetRef::Ssh {
            host_id: host_id.clone(),
        },
    };

    let first = state
        .server_info()
        .snapshot_native(
            state.remote_hosts(),
            state.paths(),
            &ssh_commands,
            request.clone(),
        )
        .await
        .expect("first snapshot");
    let second = state
        .server_info()
        .snapshot_native(state.remote_hosts(), state.paths(), &ssh_commands, request)
        .await
        .expect("coalesced snapshot");

    assert_eq!(first, second);
    assert_eq!(backend.exec_count(), 1);
}

fn remote_host(auth_type: RemoteHostAuthType) -> RemoteHost {
    let (credential_ref, credential_secret) = match auth_type {
        RemoteHostAuthType::Agent => (None, None),
        RemoteHostAuthType::Password => (None, Some("correct horse battery staple".to_owned())),
        RemoteHostAuthType::Key => (Some("C:/keys/dev.key".to_owned()), None),
    };

    RemoteHost {
        id: "host-1".to_owned(),
        group_id: Some("group-1".to_owned()),
        name: "dev".to_owned(),
        host: "dev.internal".to_owned(),
        port: 2222,
        username: "deploy".to_owned(),
        protocol: Default::default(),
        auth_type,
        credential_ref,
        secret_ref: None,
        key_passphrase_ref: None,
        key_passphrase_secret: None,
        credential_secret,
        credential_status: Default::default(),
        tags: vec!["dev".to_owned()],
        ssh_options: Default::default(),
        sort_order: 10,
        created_at: "now".to_owned(),
        updated_at: "now".to_owned(),
    }
}

fn test_state() -> (TempDir, AppState) {
    let home = tempdir().expect("create temp home");
    let paths = KerminalPaths::from_home_dir(home.path());
    let state = AppState::initialize_with_paths(paths).expect("initialize app state");
    (home, state)
}

fn create_saved_password_host(state: &AppState) -> String {
    state
        .remote_hosts()
        .create_host(RemoteHostCreateRequest {
            auth_type: RemoteHostAuthType::Password,
            credential_ref: None,
            credential_secret: Some("correct horse battery staple".to_owned()),
            group_id: None,
            host: "dev.internal".to_owned(),
            name: "dev".to_owned(),
            port: 2222,
            ssh_options: Default::default(),
            tags: vec!["dev".to_owned()],
            username: "deploy".to_owned(),
            protocol: Default::default(),
        })
        .expect("create saved password host")
        .id
}
