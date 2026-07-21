// @author kongweiguang

use kerminal_lib::services::external_launch::{
    ExternalLaunchAcceptOutcome, ExternalLaunchEntrypoint, ExternalLaunchEventKind,
    ExternalLaunchIntake, ExternalLaunchPolicy, ExternalLaunchSourceTool, ExternalSecretSlot,
};

#[test]
fn intake_noops_for_regular_kerminal_activation() {
    let intake = ExternalLaunchIntake::new();

    let outcome = intake
        .accept_args(
            vec!["C:\\Program Files\\Kerminal\\kerminal.exe".to_owned()],
            Some("C:\\Users\\alice".to_owned()),
            ExternalLaunchEntrypoint::SingleInstance,
        )
        .expect("accept no-op args");

    assert!(matches!(outcome, ExternalLaunchAcceptOutcome::Noop(_)));
    assert!(outcome.event_payload().is_none());
    let snapshot = intake.snapshot().expect("snapshot");
    assert_eq!(snapshot.pending_count, 0);
    assert_eq!(snapshot.noop_count, 1);
}

#[test]
fn intake_queues_protected_request_from_cold_start_vendor_args() {
    let intake = ExternalLaunchIntake::new();

    let outcome = intake
        .accept_args(
            vec![
                "C:\\Program Files\\Kerminal\\kerminal.exe".to_owned(),
                "-ssh".to_owned(),
                "ops@example.internal".to_owned(),
                "-P".to_owned(),
                "2202".to_owned(),
                "-pw".to_owned(),
                "KERM_FIXTURE_INTAKE_SECRET_DO_NOT_USE".to_owned(),
            ],
            None,
            ExternalLaunchEntrypoint::DirectArgv,
        )
        .expect("accept external launch args");

    let queued = match outcome {
        ExternalLaunchAcceptOutcome::Queued(queued) => queued,
        other => panic!("expected queued outcome, got {other:?}"),
    };
    assert_eq!(queued.source_tool, ExternalLaunchSourceTool::Putty);
    assert_eq!(queued.entrypoint, ExternalLaunchEntrypoint::DirectArgv);
    assert_eq!(queued.target.host, "example.internal");
    assert_eq!(queued.target.port, 2202);
    assert_eq!(queued.target.username.as_deref(), Some("ops"));
    assert_eq!(queued.pending_count, 1);

    let event = ExternalLaunchAcceptOutcome::Queued(queued.clone())
        .event_payload()
        .expect("queued event");
    assert_eq!(event.kind, ExternalLaunchEventKind::Queued);
    assert_eq!(event.launch_id.as_deref(), Some(queued.launch_id.as_str()));
    assert_eq!(event.pending_count, 1);

    let pending = intake.take_pending().expect("take pending");
    assert_eq!(pending.len(), 1);
    let request = &pending[0];
    assert_eq!(request.id, queued.launch_id);
    let password_ref = request
        .auth
        .password
        .as_ref()
        .and_then(ExternalSecretSlot::as_session_ref)
        .expect("password session ref");
    assert_eq!(
        intake
            .secret_broker()
            .resolve_secret(password_ref)
            .expect("resolve password")
            .as_deref(),
        Some("KERM_FIXTURE_INTAKE_SECRET_DO_NOT_USE")
    );
    assert!(!format!("{request:?}").contains("KERM_FIXTURE_INTAKE_SECRET_DO_NOT_USE"));
    assert_eq!(intake.snapshot().expect("snapshot").pending_count, 0);
}

#[test]
fn intake_queues_openssh_style_args_when_argv0_is_kerminal() {
    let intake = ExternalLaunchIntake::new();

    let outcome = intake
        .accept_args(
            vec![
                "C:\\Program Files\\Kerminal\\kerminal.exe".to_owned(),
                "-p".to_owned(),
                "2206".to_owned(),
                "-l".to_owned(),
                "core".to_owned(),
                "core.internal".to_owned(),
                "uptime".to_owned(),
            ],
            None,
            ExternalLaunchEntrypoint::DirectArgv,
        )
        .expect("accept OpenSSH-style external launch args");

    let queued = match outcome {
        ExternalLaunchAcceptOutcome::Queued(queued) => queued,
        other => panic!("expected queued outcome, got {other:?}"),
    };
    assert_eq!(queued.source_tool, ExternalLaunchSourceTool::Openssh);
    assert_eq!(queued.target.host, "core.internal");
    assert_eq!(queued.target.port, 2206);
    assert_eq!(queued.target.username.as_deref(), Some("core"));

    let pending = intake.take_pending().expect("take pending");
    assert_eq!(pending.len(), 1);
    assert_eq!(pending[0].options.remote_command.as_deref(), Some("uptime"));
}

#[test]
fn intake_queues_mobaxterm_moba_session_file_when_argv0_is_kerminal() {
    let intake = ExternalLaunchIntake::new();
    let path = write_temp_moba_session_file();

    let outcome = intake
        .accept_args(
            vec![
                "C:\\Program Files\\Kerminal\\kerminal.exe".to_owned(),
                path.to_string_lossy().into_owned(),
            ],
            Some("C:\\Users\\alice".to_owned()),
            ExternalLaunchEntrypoint::SingleInstance,
        )
        .expect("accept MobaXterm .moba single-instance args");

    let _ = std::fs::remove_file(path);
    let queued = match outcome {
        ExternalLaunchAcceptOutcome::Queued(queued) => queued,
        other => panic!("expected queued outcome, got {other:?}"),
    };
    assert_eq!(queued.source_tool, ExternalLaunchSourceTool::Mobaxterm);
    assert_eq!(queued.entrypoint, ExternalLaunchEntrypoint::SingleInstance);
    assert_eq!(queued.target.host, "172.21.195.223");
    assert_eq!(queued.target.port, 222);
    assert_eq!(queued.target.username.as_deref(), Some("root"));

    let pending = intake.take_pending().expect("take pending");
    assert_eq!(pending.len(), 1);
    assert_eq!(pending[0].diagnostics.parser, "mobaxterm-moba-file");
    assert_eq!(
        pending[0].diagnostics.argv_redacted[1],
        "<moba-session-file>"
    );
}

#[test]
fn intake_queues_mobaxterm_moba_file_with_bhost_parent_when_argv0_is_kerminal() {
    let intake = ExternalLaunchIntake::new();
    let path = write_temp_moba_session_file();
    let parent_command_line = concat!(
        r#""C:\Users\Public\Documents\BHost\bhmultauth.exe" 33 "#,
        r#""C:\Program Files\Kerminal\kerminal.exe" "#,
        r#""172.21.195.223" "222" "#,
        r#""opaqueBridgeTicket_0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ" "#,
        r#""BHOST_PARENT_PASSWORD_DO_NOT_USE" "root_10.11.0.75""#
    )
    .to_owned();

    let outcome = intake
        .accept_args_with_parent_command_line(
            vec![
                "C:\\Program Files\\Kerminal\\kerminal.exe".to_owned(),
                path.to_string_lossy().into_owned(),
            ],
            Some("C:\\Users\\alice".to_owned()),
            ExternalLaunchEntrypoint::SingleInstance,
            Some(parent_command_line),
        )
        .expect("accept MobaXterm .moba args with BHost parent command line");

    let _ = std::fs::remove_file(path);
    let queued = match outcome {
        ExternalLaunchAcceptOutcome::Queued(queued) => queued,
        other => panic!("expected queued outcome, got {other:?}"),
    };
    assert_eq!(queued.source_tool, ExternalLaunchSourceTool::Mobaxterm);
    assert_eq!(queued.target.host, "172.21.195.223");
    assert_eq!(queued.target.port, 222);

    let pending = intake.take_pending().expect("take pending");
    assert_eq!(pending.len(), 1);
    assert_eq!(pending[0].diagnostics.parser, "mobaxterm-bhost-parent");
    assert_eq!(
        pending[0].target.username.as_deref(),
        Some("opaqueBridgeTicket_0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ")
    );
    assert!(pending[0].auth.has_password());
    assert!(!format!("{:?}", pending[0]).contains("BHOST_PARENT_PASSWORD_DO_NOT_USE"));
    assert_eq!(
        pending[0].diagnostics.argv_redacted[1],
        "<moba-session-file>"
    );
}

#[test]
fn intake_queues_xshell_bridge_url_when_argv0_is_kerminal() {
    let intake = ExternalLaunchIntake::new();
    let payload =
        "anVtcDpLRVJNX0ZJWFRVUkVfWFNIRUxMX0I2NF9QQVNTV09SRF9ET19OT1RfVVNFQHJvb3RAMTAuMTEuMC43NToyMjpTU0gy";
    let raw_url =
        format!("ssh://b64%3E%3E{payload}:KERMINAL_FIXTURE_BRIDGE_TOKEN@172.21.195.223:222");

    let outcome = intake
        .accept_args(
            vec![
                "C:\\Program Files\\Kerminal\\kerminal.exe".to_owned(),
                "-url".to_owned(),
                raw_url,
                "-newtab".to_owned(),
                "root@10.11.0.75".to_owned(),
            ],
            Some("C:\\Users\\alice".to_owned()),
            ExternalLaunchEntrypoint::SingleInstance,
        )
        .expect("accept Xshell bridge URL single-instance args");

    let queued = match outcome {
        ExternalLaunchAcceptOutcome::Queued(queued) => queued,
        other => panic!("expected queued outcome, got {other:?}"),
    };
    assert_eq!(queued.source_tool, ExternalLaunchSourceTool::Xshell);
    assert_eq!(queued.target.host, "172.21.195.223");
    assert_eq!(queued.target.port, 222);

    let pending = intake.take_pending().expect("take pending");
    assert_eq!(pending.len(), 1);
    assert_eq!(pending[0].diagnostics.parser, "xshell-bhost-url");
    assert!(pending[0]
        .target
        .username
        .as_deref()
        .is_some_and(|username| username.starts_with("b64>>")));
    assert!(pending[0].auth.has_password());
    assert!(!format!("{:?}", pending[0]).contains(payload));
    assert!(!format!("{:?}", pending[0]).contains("KERMINAL_FIXTURE_BRIDGE_TOKEN"));
}

#[test]
fn intake_queues_generic_bridge_url_without_b64_when_argv0_is_kerminal() {
    let intake = ExternalLaunchIntake::new();
    let bridge_user = "opaqueBridgeTicket_0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    let raw_url =
        format!("ssh://{bridge_user}:KERMINAL_FIXTURE_GENERIC_BRIDGE_TOKEN@172.21.195.223:222");

    let outcome = intake
        .accept_args(
            vec![
                "C:\\Program Files\\Kerminal\\kerminal.exe".to_owned(),
                raw_url,
                "-newtab".to_owned(),
                "root@10.11.0.75".to_owned(),
            ],
            Some("C:\\Users\\alice".to_owned()),
            ExternalLaunchEntrypoint::SingleInstance,
        )
        .expect("accept generic bridge URL single-instance args");

    let queued = match outcome {
        ExternalLaunchAcceptOutcome::Queued(queued) => queued,
        other => panic!("expected queued outcome, got {other:?}"),
    };
    assert_eq!(queued.source_tool, ExternalLaunchSourceTool::Xshell);
    assert_eq!(queued.target.host, "172.21.195.223");
    assert_eq!(queued.target.port, 222);

    let pending = intake.take_pending().expect("take pending");
    assert_eq!(pending.len(), 1);
    assert_eq!(pending[0].diagnostics.parser, "xshell-bhost-url");
    assert_eq!(pending[0].target.username.as_deref(), Some(bridge_user));
    assert!(pending[0].auth.has_password());
    let debug = format!("{:?}", pending[0]);
    assert!(!debug.contains(bridge_user));
    assert!(!debug.contains("KERMINAL_FIXTURE_GENERIC_BRIDGE_TOKEN"));
}

#[test]
fn intake_queues_generic_host_flags_without_external_marker() {
    let intake = ExternalLaunchIntake::new();

    let outcome = intake
        .accept_args(
            vec![
                "C:\\Program Files\\Kerminal\\kerminal.exe".to_owned(),
                "--host".to_owned(),
                "field-generic.internal".to_owned(),
                "--port".to_owned(),
                "2248".to_owned(),
                "--user".to_owned(),
                "fieldops".to_owned(),
            ],
            None,
            ExternalLaunchEntrypoint::SingleInstance,
        )
        .expect("accept generic host/user/port args");

    let queued = match outcome {
        ExternalLaunchAcceptOutcome::Queued(queued) => queued,
        other => panic!("expected queued outcome, got {other:?}"),
    };
    assert_eq!(queued.source_tool, ExternalLaunchSourceTool::KerminalNative);
    assert_eq!(queued.target.host, "field-generic.internal");
    assert_eq!(queued.target.port, 2248);
    assert_eq!(queued.target.username.as_deref(), Some("fieldops"));
}

#[test]
fn intake_queues_bare_user_at_host_without_ssh_argv0() {
    let intake = ExternalLaunchIntake::new();

    let outcome = intake
        .accept_args(
            vec![
                "C:\\Program Files\\Kerminal\\kerminal.exe".to_owned(),
                "deploy@generic-openssh.internal".to_owned(),
            ],
            None,
            ExternalLaunchEntrypoint::SingleInstance,
        )
        .expect("accept generic user@host args");

    let queued = match outcome {
        ExternalLaunchAcceptOutcome::Queued(queued) => queued,
        other => panic!("expected queued outcome, got {other:?}"),
    };
    assert_eq!(queued.source_tool, ExternalLaunchSourceTool::Openssh);
    assert_eq!(queued.target.host, "generic-openssh.internal");
    assert_eq!(queued.target.port, 22);
    assert_eq!(queued.target.username.as_deref(), Some("deploy"));
}

#[test]
fn intake_noops_for_regular_kerminal_runtime_args() {
    let intake = ExternalLaunchIntake::new();

    let outcome = intake
        .accept_args(
            vec![
                "C:\\Program Files\\Kerminal\\kerminal.exe".to_owned(),
                "--no-sandbox".to_owned(),
                "--".to_owned(),
                "window-state".to_owned(),
            ],
            None,
            ExternalLaunchEntrypoint::SingleInstance,
        )
        .expect("accept regular runtime args");

    assert!(matches!(outcome, ExternalLaunchAcceptOutcome::Noop(_)));
    let snapshot = intake.snapshot().expect("snapshot");
    assert_eq!(snapshot.noop_count, 1);
    assert_eq!(snapshot.pending_count, 0);
}

#[test]
fn intake_noops_for_random_file_path_arg() {
    let intake = ExternalLaunchIntake::new();

    let outcome = intake
        .accept_args(
            vec![
                "C:\\Program Files\\Kerminal\\kerminal.exe".to_owned(),
                "C:\\Users\\alice\\Desktop\\notes.txt".to_owned(),
            ],
            Some("C:\\Users\\alice".to_owned()),
            ExternalLaunchEntrypoint::SingleInstance,
        )
        .expect("accept unrelated file path args");

    assert!(matches!(outcome, ExternalLaunchAcceptOutcome::Noop(_)));
    let snapshot = intake.snapshot().expect("snapshot");
    assert_eq!(snapshot.noop_count, 1);
    assert_eq!(snapshot.pending_count, 0);
}

#[test]
fn intake_queues_sftp_url_with_literal_vendor_wrapper_quotes() {
    let intake = ExternalLaunchIntake::new();

    let outcome = intake
        .accept_args(
            vec![
                "kerminal.exe".to_owned(),
                "  \"sftp://ops@example.internal/releases/\"  ".to_owned(),
            ],
            None,
            ExternalLaunchEntrypoint::SingleInstance,
        )
        .expect("accept quoted vendor SFTP URL");

    assert!(matches!(outcome, ExternalLaunchAcceptOutcome::Queued(_)));
    let pending = intake.take_pending().expect("take quoted SFTP request");
    assert_eq!(pending.len(), 1);
    assert_eq!(pending[0].source.tool, ExternalLaunchSourceTool::SftpClient);
    assert_eq!(pending[0].target.host, "example.internal");
}

#[test]
fn intake_queues_bastion_sftp_url_without_trailing_slash() {
    let intake = ExternalLaunchIntake::new();

    let outcome = intake
        .accept_args(
            vec![
                "kerminal.exe".to_owned(),
                "sftp://ops:session-token@example.internal:2222".to_owned(),
            ],
            None,
            ExternalLaunchEntrypoint::SingleInstance,
        )
        .expect("accept bastion SFTP URL without trailing slash");

    assert!(matches!(outcome, ExternalLaunchAcceptOutcome::Queued(_)));
    let pending = intake.take_pending().expect("take root SFTP request");
    assert_eq!(pending.len(), 1);
    assert!(matches!(
        pending[0].intent,
        kerminal_lib::services::external_launch::ExternalLaunchIntent::SftpTransfer {
            ref remote_path,
            selected_entry: None,
            ..
        } if remote_path.as_deref() == Some("/")
    ));
}

#[test]
fn parse_failure_records_redacted_error_without_queuing() {
    let intake = ExternalLaunchIntake::new();

    let outcome = intake
        .accept_args(
            vec![
                "putty.exe".to_owned(),
                "-ssh".to_owned(),
                "ops@example.internal".to_owned(),
                "-P".to_owned(),
                "not-a-port".to_owned(),
                "-pw".to_owned(),
                "KERM_FIXTURE_REJECTED_SECRET_DO_NOT_USE".to_owned(),
            ],
            Some("C:\\Users\\alice".to_owned()),
            ExternalLaunchEntrypoint::SingleInstance,
        )
        .expect("accept rejected args");

    let rejected = match outcome {
        ExternalLaunchAcceptOutcome::Rejected(rejected) => rejected,
        other => panic!("expected rejected outcome, got {other:?}"),
    };
    assert_eq!(rejected.source_tool, Some(ExternalLaunchSourceTool::Putty));
    assert_eq!(rejected.arg_count, 7);
    assert!(rejected.cwd_present);
    assert_eq!(rejected.raw_hash.len(), 64);
    assert!(!format!("{rejected:?}").contains("KERM_FIXTURE_REJECTED_SECRET_DO_NOT_USE"));
    let event = ExternalLaunchAcceptOutcome::Rejected(rejected)
        .event_payload()
        .expect("rejected event");
    assert_eq!(event.kind, ExternalLaunchEventKind::Rejected);
    assert!(event.launch_id.is_none());
    assert_eq!(intake.take_pending().expect("take pending").len(), 0);

    let snapshot = intake.snapshot().expect("snapshot");
    assert_eq!(snapshot.pending_count, 0);
    assert_eq!(snapshot.rejected_count, 1);
    assert!(!format!("{snapshot:?}").contains("KERM_FIXTURE_REJECTED_SECRET_DO_NOT_USE"));
}

#[test]
fn protect_failure_records_rejection_without_aborting_startup() {
    let intake = ExternalLaunchIntake::new();

    let outcome = intake
        .accept_args(
            vec![
                "putty.exe".to_owned(),
                "-ssh".to_owned(),
                "ops@example.internal".to_owned(),
                "-pwfile".to_owned(),
                "C:\\missing\\KERM_FIXTURE_SECRET_PATH_DO_NOT_USE.txt".to_owned(),
            ],
            None,
            ExternalLaunchEntrypoint::DirectArgv,
        )
        .expect("protect failure should be captured as rejection");

    let rejected = match outcome {
        ExternalLaunchAcceptOutcome::Rejected(rejected) => rejected,
        other => panic!("expected rejected outcome, got {other:?}"),
    };
    assert_eq!(rejected.source_tool, Some(ExternalLaunchSourceTool::Putty));
    assert_eq!(rejected.message, "external SSH launch rejected");
    assert_eq!(intake.take_pending().expect("take pending").len(), 0);
    assert!(!format!("{rejected:?}").contains("KERM_FIXTURE_SECRET_PATH_DO_NOT_USE"));
    assert!(!format!("{intake:?}").contains("KERM_FIXTURE_SECRET_PATH_DO_NOT_USE"));
}

#[test]
fn multiple_launches_preserve_order_and_take_pending_drains() {
    let intake = ExternalLaunchIntake::new();

    intake
        .accept_args(
            vec![
                "ssh.exe".to_owned(),
                "-p".to_owned(),
                "2022".to_owned(),
                "first@one.internal".to_owned(),
            ],
            None,
            ExternalLaunchEntrypoint::DirectArgv,
        )
        .expect("accept first");
    intake
        .accept_args(
            vec![
                "Xshell.exe".to_owned(),
                "-url".to_owned(),
                "ssh://second@two.internal:2200".to_owned(),
            ],
            None,
            ExternalLaunchEntrypoint::SingleInstance,
        )
        .expect("accept second");

    let pending = intake.take_pending().expect("take pending");
    assert_eq!(pending.len(), 2);
    assert_eq!(pending[0].target.host, "one.internal");
    assert_eq!(pending[0].target.username.as_deref(), Some("first"));
    assert_eq!(pending[1].target.host, "two.internal");
    assert_eq!(pending[1].target.username.as_deref(), Some("second"));
    assert_eq!(intake.take_pending().expect("take pending again").len(), 0);
    assert_eq!(intake.snapshot().expect("snapshot").accepted_count, 2);
}

#[test]
fn policy_rejects_vendor_args_without_secret_leak() {
    let intake = ExternalLaunchIntake::with_policy(ExternalLaunchPolicy {
        accept_vendor_args: false,
        ..ExternalLaunchPolicy::default()
    });

    let outcome = intake
        .accept_args(
            vec![
                "putty.exe".to_owned(),
                "-ssh".to_owned(),
                "ops@policy.example.internal".to_owned(),
                "-pw".to_owned(),
                "KERM_POLICY_VENDOR_SECRET_DO_NOT_USE".to_owned(),
            ],
            None,
            ExternalLaunchEntrypoint::DirectArgv,
        )
        .expect("accept policy rejected args");

    let rejected = match outcome {
        ExternalLaunchAcceptOutcome::Rejected(rejected) => rejected,
        other => panic!("expected rejected outcome, got {other:?}"),
    };
    assert_eq!(rejected.source_tool, Some(ExternalLaunchSourceTool::Putty));
    assert_eq!(
        rejected.message,
        "external SSH vendor argument launch disabled by policy"
    );
    assert_eq!(intake.take_pending().expect("take pending").len(), 0);

    let snapshot = intake.snapshot().expect("snapshot");
    assert_eq!(snapshot.rejected_count, 1);
    assert!(!snapshot.policy.accept_vendor_args);
    assert!(!format!("{snapshot:?}").contains("KERM_POLICY_VENDOR_SECRET_DO_NOT_USE"));
}

#[test]
fn policy_auto_open_sftp_marks_accepted_requests() {
    let intake = ExternalLaunchIntake::with_policy(ExternalLaunchPolicy {
        auto_open_sftp: true,
        ..ExternalLaunchPolicy::default()
    });

    let outcome = intake
        .accept_args(
            vec![
                "ssh.exe".to_owned(),
                "-p".to_owned(),
                "2206".to_owned(),
                "ops@auto-sftp.example.internal".to_owned(),
            ],
            None,
            ExternalLaunchEntrypoint::DirectArgv,
        )
        .expect("accept auto sftp request");

    assert!(matches!(outcome, ExternalLaunchAcceptOutcome::Queued(_)));
    let pending = intake.take_pending().expect("take pending");
    assert_eq!(pending.len(), 1);
    assert!(pending[0].options.open_sftp);
    assert!(intake.snapshot().expect("snapshot").policy.auto_open_sftp);
}

fn write_temp_moba_session_file() -> std::path::PathBuf {
    let path = std::env::temp_dir().join(format!(
        "kerminal-intake-mobaxterm-{}-{}.moba",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system clock should be after epoch")
            .as_nanos()
    ));
    std::fs::write(
        &path,
        "root_10.11.0.75 =  #109#0%172.21.195.223%222%%%-1%-1%%%%%0%-1%0%%%0%0%0%0%%1080%%0%0%1#MobaFont%10%0%0%-1%15%236,236,236%30,30,30%180,180,192%0%-1%0%%xterm%-1%-1%_Std_Colors_0_%80%24%0%1%-1%<none>%%0%0%-1#0# #-1",
    )
    .expect("temp .moba session file should be written");
    path
}
