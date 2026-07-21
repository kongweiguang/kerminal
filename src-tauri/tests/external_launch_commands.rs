//! External SSH launch command DTO tests.
//!
//! @author kongweiguang

use std::fs;

use kerminal_lib::{
    commands::external_launch::{
        external_launch_snapshot_to_dto, external_ssh_launch_request_to_dto,
        ExternalLaunchMaterializeOutcomeDto,
    },
    services::external_launch::{
        ExternalLaunchEntrypoint, ExternalLaunchIntake, ExternalLaunchParseInput,
        ExternalLaunchParserRegistry, ExternalLaunchPolicy, ExternalLaunchSecretBroker,
        ExternalLaunchSourceTool, ExternalLaunchTaskSnapshot,
    },
    services::ssh_runtime::auth_broker::SshAuthPromptPlan,
};

#[test]
fn sftp_intent_and_materialize_outcome_use_camel_case_fields() {
    let request = ExternalLaunchParserRegistry::new()
        .parse(&ExternalLaunchParseInput::direct_argv(
            ExternalLaunchSourceTool::SftpClient,
            vec![
                "kerminal.exe".to_owned(),
                "sftp://deploy@example.internal/releases/artifact.zip".to_owned(),
            ],
        ))
        .expect("parse SFTP launch");
    let request_json = serde_json::to_value(external_ssh_launch_request_to_dto(request))
        .expect("serialize SFTP request dto");
    assert_eq!(request_json["intent"]["kind"], "sftpTransfer");
    assert_eq!(request_json["intent"]["remotePath"], "/releases/");
    assert_eq!(request_json["intent"]["selectedEntry"], "artifact.zip");
    assert!(request_json["intent"].get("remote_path").is_none());

    let outcome = ExternalLaunchMaterializeOutcomeDto::PromptRequired {
        prompt_plan: SshAuthPromptPlan { prompts: vec![] },
    };
    let outcome_json = serde_json::to_value(outcome).expect("serialize materialize outcome");
    assert_eq!(outcome_json["status"], "promptRequired");
    assert_eq!(outcome_json["promptPlan"]["prompts"], serde_json::json!([]));
    assert!(outcome_json.get("prompt_plan").is_none());
}
#[test]
fn command_dto_exposes_only_redacted_auth_metadata() {
    let registry = ExternalLaunchParserRegistry::new();
    let request = registry
        .parse(&ExternalLaunchParseInput::direct_argv(
            ExternalLaunchSourceTool::Putty,
            vec![
                "putty.exe".to_owned(),
                "-ssh".to_owned(),
                "ops@example.internal".to_owned(),
                "-P".to_owned(),
                "2202".to_owned(),
                "-pw".to_owned(),
                "KERM_COMMAND_DTO_SECRET_DO_NOT_USE".to_owned(),
            ],
        ))
        .expect("parse putty launch");
    let request = ExternalLaunchSecretBroker::new()
        .protect_request(request)
        .expect("protect secret");

    let dto = external_ssh_launch_request_to_dto(request);
    let json = serde_json::to_string(&dto).expect("serialize dto");

    assert_eq!(dto.target.host, "example.internal");
    assert_eq!(dto.target.username.as_deref(), Some("ops"));
    assert_eq!(dto.target.port, 2202);
    assert!(dto.auth.has_password);
    assert!(!dto.auth.has_key_passphrase);
    assert!(!dto.auth.password_file_present);
    assert!(dto.auth.identity_file.is_none());
    let diagnostics_json =
        serde_json::to_string(&dto.diagnostics).expect("serialize public diagnostics");
    assert!(!diagnostics_json.contains("example.internal"));
    assert!(!diagnostics_json.contains("ops"));
    assert!(dto
        .diagnostics
        .argv_redacted
        .iter()
        .all(|arg| matches!(arg.as_str(), "<executable>" | "<option>" | "<argument>")));
    assert!(!json.contains("KERM_COMMAND_DTO_SECRET_DO_NOT_USE"));
    assert!(!json.contains("external-secret:"));
}

#[test]
fn command_dto_does_not_expose_password_file_path() {
    let temp = tempfile::tempdir().expect("tempdir");
    let password_path = temp.path().join("external-password.txt");
    fs::write(&password_path, "KERM_COMMAND_DTO_PASSFILE_SECRET\n").expect("write password");

    let registry = ExternalLaunchParserRegistry::new();
    let request = registry
        .parse(&ExternalLaunchParseInput::direct_argv(
            ExternalLaunchSourceTool::Putty,
            vec![
                "putty.exe".to_owned(),
                "-ssh".to_owned(),
                "backup@backup.internal".to_owned(),
                "-pwfile".to_owned(),
                password_path.to_string_lossy().into_owned(),
            ],
        ))
        .expect("parse password file launch");
    let request = ExternalLaunchSecretBroker::new()
        .protect_request(request)
        .expect("protect password file");

    let dto = external_ssh_launch_request_to_dto(request);
    let json = serde_json::to_string(&dto).expect("serialize dto");

    assert!(dto.auth.has_password);
    assert!(dto.auth.password_file_present);
    assert!(!json.contains("KERM_COMMAND_DTO_PASSFILE_SECRET"));
    assert!(!json.contains("external-password.txt"));
    assert!(!json.contains("external-secret:"));
}

#[test]
fn snapshot_dto_exposes_policy_without_secret_refs() {
    let intake = ExternalLaunchIntake::with_policy(ExternalLaunchPolicy {
        disabled_tools: vec![ExternalLaunchSourceTool::Xshell],
        ..ExternalLaunchPolicy::default()
    });
    intake
        .accept_args(
            vec![
                "putty.exe".to_owned(),
                "-ssh".to_owned(),
                "ops@snapshot.example.internal".to_owned(),
                "-pw".to_owned(),
                "KERM_COMMAND_SNAPSHOT_SECRET_DO_NOT_USE".to_owned(),
            ],
            None,
            ExternalLaunchEntrypoint::DirectArgv,
        )
        .expect("accept launch");
    let claimed = intake.take_pending().expect("claim launch");
    let claimed_launch_id = claimed[0].id.clone();

    let dto = external_launch_snapshot_to_dto(
        intake.snapshot().expect("intake snapshot"),
        intake.secret_broker().snapshot().expect("secret snapshot"),
        ExternalLaunchTaskSnapshot::default(),
    );
    let json = serde_json::to_string(&dto).expect("serialize snapshot dto");

    assert_eq!(dto.intake.pending_count, 0);
    assert_eq!(dto.intake.claimed_count, 1);
    assert_eq!(dto.intake.claimed_request_hashes.len(), 1);
    assert_eq!(dto.intake.claimed_request_hashes[0].len(), 12);
    assert!(dto
        .intake
        .policy
        .disabled_tools
        .contains(&ExternalLaunchSourceTool::Xshell));
    assert_eq!(dto.secrets.active_secret_count, 1);
    assert_eq!(dto.tasks, Default::default());
    assert_eq!(
        dto.secrets.request_hashes,
        dto.intake.claimed_request_hashes
    );
    assert!(!json.contains(&claimed_launch_id));
    assert!(!json.contains("KERM_COMMAND_SNAPSHOT_SECRET_DO_NOT_USE"));
    assert!(!json.contains("external-secret:"));
}
