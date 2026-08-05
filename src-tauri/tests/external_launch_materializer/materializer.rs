// @author kongweiguang

use super::support::*;

#[test]
fn materializer_returns_structured_prompt_required_without_creating_target() {
    let fixture = materializer_fixture();
    let launch_id = queued_launch_id(
        fixture
            .intake
            .accept_args(
                vec![
                    "kerminal.exe".to_owned(),
                    "sftp://deploy@example.internal/".to_owned(),
                ],
                None,
                ExternalLaunchEntrypoint::DirectArgv,
            )
            .expect("queue prompt-only launch"),
    );
    let _ = fixture.intake.take_pending().expect("take pending");

    let outcome = fixture
        .materializer
        .materialize_outcome(&fixture.paths, &launch_id, None)
        .expect("resolve structured materialize outcome");

    let ExternalMaterializeOutcome::PromptRequired(prompt_plan) = outcome else {
        panic!("missing credentials must request a prompt");
    };
    assert_eq!(prompt_plan.prompts.len(), 1);
    assert!(fixture
        .materializer
        .snapshot()
        .expect("materializer snapshot")
        .target_ids
        .is_empty());
}

#[test]
fn materializer_preserves_drained_launches_as_active_requests() {
    let fixture = materializer_fixture();
    let launch_id = queue_putty_password_launch(&fixture.intake, Some("deploy"));

    let pending = fixture.intake.take_pending().expect("take pending");

    assert_eq!(pending.len(), 1);
    assert_eq!(pending[0].id, launch_id);
    assert_eq!(
        fixture.intake.snapshot().expect("snapshot").pending_count,
        0
    );
    assert_eq!(
        fixture
            .intake
            .active_request(&launch_id)
            .expect("active request")
            .as_ref()
            .map(|request| request.target.host.as_str()),
        Some("example.internal")
    );
}

#[test]
fn materializer_moves_password_to_auth_broker_and_keeps_external_target_after_ack() {
    let fixture = materializer_fixture();
    let launch_id = queue_putty_password_launch(&fixture.intake, Some("deploy"));
    let _ = fixture.intake.take_pending().expect("take pending");

    let target = fixture
        .materializer
        .materialize(&fixture.paths, &launch_id, None)
        .expect("materialize external launch");

    assert_eq!(target.launch_id, launch_id);
    assert_eq!(target.host_id, external_target_id(&launch_id));
    assert_eq!(target.host.auth_type, RemoteHostAuthType::Password);
    assert_eq!(target.host.host, "example.internal");
    assert_eq!(target.host.port, 2202);
    assert_eq!(target.host.username, "deploy");
    assert_eq!(target.safety, ExternalTargetSafety::RestrictedUnknown);
    assert_eq!(
        fixture
            .auth_broker
            .snapshot()
            .expect("auth broker snapshot")
            .session_only_secret_count,
        1
    );

    let debug = format!("{target:?}");
    assert!(!debug.contains(PASSWORD_SECRET));
    assert!(!debug.contains("external-secret:"));
    assert!(!debug.contains(&launch_id));
    assert!(debug.contains("request_hash"));

    assert_eq!(
        fixture
            .intake
            .secret_broker()
            .ack_launch(&launch_id)
            .expect("ack external secret"),
        1
    );
    assert_eq!(
        fixture
            .intake
            .secret_broker()
            .snapshot()
            .expect("external secret snapshot")
            .active_secret_count,
        0
    );
    assert!(fixture
        .materializer
        .resolve_target(&target.host_id)
        .expect("resolve materialized target")
        .is_some());

    assert!(fixture
        .materializer
        .forget_launch(&launch_id)
        .expect("forget launch"));
    assert!(fixture
        .materializer
        .resolve_target(&target.host_id)
        .expect("resolve after forget")
        .is_none());
    assert_eq!(
        fixture
            .auth_broker
            .snapshot()
            .expect("auth broker after forget")
            .session_only_secret_count,
        0
    );
}

#[test]
fn external_target_safety_marks_only_an_exact_saved_host_as_known() {
    let fixture = materializer_fixture();
    let launch_id = queue_putty_password_launch(&fixture.intake, Some("deploy"));
    let _ = fixture.intake.take_pending().expect("take pending");
    let request = fixture
        .intake
        .active_request(&launch_id)
        .expect("active request")
        .expect("queued request");
    let target = fixture
        .materializer
        .materialize(&fixture.paths, &launch_id, None)
        .expect("materialize restricted target");

    let mut saved = target.host.clone();
    saved.id = "saved-host".to_owned();
    saved.host = "EXAMPLE.INTERNAL.".to_owned();
    assert_eq!(
        external_target_safety_for_saved_hosts(&request, "deploy", &[saved.clone()]),
        ExternalTargetSafety::Known
    );

    saved.port += 1;
    assert_eq!(
        external_target_safety_for_saved_hosts(&request, "deploy", &[saved]),
        ExternalTargetSafety::RestrictedUnknown
    );
}

#[test]
fn materializer_requires_username_or_trusted_override() {
    let fixture = materializer_fixture();
    let launch_id = queue_putty_password_launch(&fixture.intake, None);
    let _ = fixture.intake.take_pending().expect("take pending");

    let error = fixture
        .materializer
        .materialize(&fixture.paths, &launch_id, None)
        .expect_err("missing username should fail");
    assert!(error.to_string().contains("username is required"));

    let target = fixture
        .materializer
        .materialize(&fixture.paths, &launch_id, Some("ops".to_owned()))
        .expect("materialize with username override");
    assert_eq!(target.host.username, "ops");
}

#[test]
fn materializer_reports_expired_password_secret_without_leaking_refs() {
    let fixture = materializer_fixture();
    let launch_id = queue_putty_password_launch(&fixture.intake, Some("deploy"));
    let _ = fixture.intake.take_pending().expect("take pending");

    assert_eq!(
        fixture
            .intake
            .secret_broker()
            .ack_launch(&launch_id)
            .expect("expire external password"),
        1
    );

    let error = fixture
        .materializer
        .materialize(&fixture.paths, &launch_id, None)
        .expect_err("expired password should fail");
    let message = error.to_string();

    assert!(message.contains("外部 SSH 启动凭据已过期或不可用"));
    assert_hashed_launch_id(&message, &launch_id);
    assert!(message.contains("secret_kind=password"));
    assert!(!message.contains(PASSWORD_SECRET));
    assert!(!message.contains("external-secret:"));
}

#[test]
fn materializer_reports_expired_key_passphrase_without_leaking_refs() {
    let fixture = materializer_fixture();
    let launch_id = queue_kerminal_native_key_passphrase_launch(&fixture.intake);
    let _ = fixture.intake.take_pending().expect("take pending");

    assert_eq!(
        fixture
            .intake
            .secret_broker()
            .ack_launch(&launch_id)
            .expect("expire external key passphrase"),
        1
    );

    let error = fixture
        .materializer
        .materialize(&fixture.paths, &launch_id, None)
        .expect_err("expired key passphrase should fail");
    let message = error.to_string();

    assert!(message.contains("外部 SSH 启动凭据已过期或不可用"));
    assert_hashed_launch_id(&message, &launch_id);
    assert!(message.contains("secret_kind=key-passphrase"));
    assert!(!message.contains(PASSPHRASE_SECRET));
    assert!(!message.contains("external-secret:"));
}

#[test]
fn materializer_reports_stale_launch_id_as_not_found() {
    let fixture = materializer_fixture();
    let error = fixture
        .materializer
        .materialize(&fixture.paths, "stale-launch-id", None)
        .expect_err("stale launch id should fail");

    let message = error.to_string();
    assert_hashed_launch_id(&message, "stale-launch-id");
}

#[test]
fn materializer_moves_external_key_passphrase_to_runtime_host_and_auth_broker() {
    let fixture = materializer_fixture();
    let launch_id = queue_kerminal_native_key_passphrase_launch(&fixture.intake);
    let _ = fixture.intake.take_pending().expect("take pending");
    let request = fixture
        .intake
        .active_request(&launch_id)
        .expect("active request")
        .expect("launch remains active");
    let request_debug = format!("{request:?}");
    assert!(!request_debug.contains(PASSPHRASE_SECRET));
    assert!(!request_debug.contains("id_ed25519"));
    assert!(!request_debug.contains(&launch_id));
    assert!(request_debug.contains("request_hash"));

    let target = fixture
        .materializer
        .materialize(&fixture.paths, &launch_id, None)
        .expect("materialize key passphrase launch");

    assert_eq!(target.host.auth_type, RemoteHostAuthType::Key);
    assert_eq!(
        target.host.key_passphrase_secret.as_deref(),
        Some(PASSPHRASE_SECRET)
    );
    assert_eq!(
        fixture
            .auth_broker
            .snapshot()
            .expect("auth broker snapshot")
            .session_only_secret_count,
        1
    );
    let debug = format!("{target:?}");
    assert!(!debug.contains(PASSPHRASE_SECRET));
    assert!(!debug.contains("id_ed25519"));
    assert!(!debug.contains(&launch_id));

    fixture
        .intake
        .secret_broker()
        .ack_launch(&launch_id)
        .expect("ack external secret");
    assert!(fixture
        .materializer
        .forget_launch(&launch_id)
        .expect("forget launch"));
    assert_eq!(
        fixture
            .auth_broker
            .snapshot()
            .expect("auth broker after forget")
            .session_only_secret_count,
        0
    );
}
