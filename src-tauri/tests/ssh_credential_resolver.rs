//! SSH credential resolver tests.
//!
//! @author kongweiguang

use std::{fs, path::PathBuf};

use kerminal_lib::{
    error::AppError,
    models::remote_host::{
        build_vault_secret_ref, RemoteHost, RemoteHostAuthType, RemoteHostCredentialStatus,
        SshJumpHostOptions, SshOptions,
    },
    paths::KerminalPaths,
    services::{
        encrypted_vault_service::{write_toml_atomically, EncryptedVaultService},
        ssh_credential_resolver::{
            NativeSshAuthMaterial, NativeSshRouteMaterial, ResolvedSshAuthKind,
            ResolvedSshAuthMaterial, ResolvedSshCredentialSource, SshCredentialResolver,
            TerminalSecretInputMode,
        },
    },
};

#[test]
fn resolver_decrypts_target_password_from_vault_without_leaking_summary() {
    let fixture = Fixture::new();
    let secret_ref = fixture.store_secret(
        "ssh-host",
        "host-1",
        "target",
        "password",
        "ssh-password",
        "target-secret",
    );
    let mut host = password_host("host-1");
    host.secret_ref = Some(secret_ref.clone());

    let resolved = fixture.resolver().resolve_host(&host).expect("resolve");

    match &resolved.target.material {
        ResolvedSshAuthMaterial::Password { value, source } => {
            assert_eq!(value, "target-secret");
            assert!(matches!(source, ResolvedSshCredentialSource::Vault(_)));
        }
        other => panic!("expected password material, got {other:?}"),
    }
    assert_eq!(
        resolved.target.secret_input_plan.mode,
        TerminalSecretInputMode::Password
    );
    assert_eq!(
        resolved.summary.target.auth_kind,
        ResolvedSshAuthKind::Password
    );
    assert!(resolved.summary.target.has_secret_material);
    assert_redacted(&resolved.summary, "target-secret");
    assert_redacted(&resolved.target.material, "target-secret");
    assert_eq!(secret_ref, resolved.summary.target.source_vault_ref());
}

#[test]
fn resolver_ignores_vault_ref_in_password_credential_ref() {
    let fixture = Fixture::new();
    let secret_ref = fixture.store_secret(
        "ssh-host",
        "host-1",
        "target",
        "password",
        "ssh-password",
        "legacy-ref-secret",
    );
    let mut host = password_host("host-1");
    host.credential_ref = Some(secret_ref.clone());

    let resolved = fixture.resolver().resolve_host(&host).expect("resolve");

    match &resolved.target.material {
        ResolvedSshAuthMaterial::PromptOnly { source, reason } => {
            assert_eq!(source, &ResolvedSshCredentialSource::PromptOnly);
            assert!(reason.contains("password"));
        }
        other => panic!("expected prompt-only material, got {other:?}"),
    }
    assert_eq!(
        resolved.summary.target.source,
        ResolvedSshCredentialSource::PromptOnly
    );
    assert_redacted(&resolved, "legacy-ref-secret");
}

#[test]
fn resolver_decrypts_jump_password_and_target_agent() {
    let fixture = Fixture::new();
    let jump_ref = fixture.store_secret(
        "jump-host",
        "host-1",
        "jump-0",
        "password",
        "ssh-password",
        "jump-secret",
    );
    let mut host = agent_host("host-1");
    host.ssh_options.jump_hosts.push(SshJumpHostOptions {
        name: "bastion".to_owned(),
        host: "bastion.internal".to_owned(),
        port: 2222,
        username: "ops".to_owned(),
        auth_type: RemoteHostAuthType::Password,
        credential_ref: None,
        secret_ref: Some(jump_ref),
        key_passphrase_ref: None,
        key_passphrase_secret: None,
        credential_secret: None,
        credential_status: RemoteHostCredentialStatus::Vault,
    });

    let resolved = fixture.resolver().resolve_host(&host).expect("resolve");

    assert_eq!(resolved.jumps.len(), 1);
    assert_eq!(
        resolved.summary.target.auth_kind,
        ResolvedSshAuthKind::Agent
    );
    assert_eq!(
        resolved.summary.jumps[0].auth_kind,
        ResolvedSshAuthKind::Password
    );
    match &resolved.jumps[0].material {
        ResolvedSshAuthMaterial::Password { value, .. } => assert_eq!(value, "jump-secret"),
        other => panic!("expected jump password, got {other:?}"),
    }
    assert_redacted(&resolved, "jump-secret");
}

#[test]
fn resolver_supports_private_key_path_with_vault_passphrase() {
    let fixture = Fixture::new();
    let passphrase_ref = fixture.store_secret(
        "ssh-host",
        "host-1",
        "target",
        "key-passphrase",
        "ssh-key-passphrase",
        "key-passphrase-secret",
    );
    let mut host = key_path_host("host-1", "/home/deploy/.ssh/id_ed25519");
    host.key_passphrase_ref = Some(passphrase_ref);

    let resolved = fixture.resolver().resolve_host(&host).expect("resolve");

    match &resolved.target.material {
        ResolvedSshAuthMaterial::PrivateKeyPath {
            path, passphrase, ..
        } => {
            assert_eq!(path, &PathBuf::from("/home/deploy/.ssh/id_ed25519"));
            assert_eq!(
                passphrase.as_ref().expect("passphrase").value,
                "key-passphrase-secret"
            );
        }
        other => panic!("expected key path material, got {other:?}"),
    }
    assert_eq!(
        resolved.summary.target.auth_kind,
        ResolvedSshAuthKind::PrivateKeyPath
    );
    assert!(resolved.summary.target.has_key_passphrase);
    assert_redacted(&resolved, "key-passphrase-secret");
}

#[test]
fn resolver_materializes_key_passphrases_for_target_and_jump_runtime_hosts() {
    let fixture = Fixture::new();
    let target_passphrase_ref = fixture.store_secret(
        "ssh-host",
        "host-1",
        "target",
        "key-passphrase",
        "ssh-key-passphrase",
        "target-passphrase-secret",
    );
    let jump_passphrase_ref = fixture.store_secret(
        "jump-host",
        "host-1",
        "jump-0",
        "key-passphrase",
        "ssh-key-passphrase",
        "jump-passphrase-secret",
    );
    let mut host = key_path_host("host-1", "/home/deploy/.ssh/id_ed25519");
    host.key_passphrase_ref = Some(target_passphrase_ref);
    host.ssh_options.jump_hosts.push(SshJumpHostOptions {
        name: "bastion".to_owned(),
        host: "bastion.internal".to_owned(),
        port: 2222,
        username: "ops".to_owned(),
        auth_type: RemoteHostAuthType::Key,
        credential_ref: Some("/home/ops/.ssh/id_ed25519".to_owned()),
        secret_ref: None,
        key_passphrase_ref: Some(jump_passphrase_ref),
        key_passphrase_secret: None,
        credential_secret: None,
        credential_status: RemoteHostCredentialStatus::Vault,
    });

    let resolved = fixture.resolver().resolve_host(&host).expect("resolve");
    let runtime_host = SshCredentialResolver::materialize_runtime_host_from_auth(&host, &resolved);

    assert_eq!(
        runtime_host.key_passphrase_secret.as_deref(),
        Some("target-passphrase-secret")
    );
    assert_eq!(
        runtime_host.ssh_options.jump_hosts[0]
            .key_passphrase_secret
            .as_deref(),
        Some("jump-passphrase-secret")
    );
}

#[test]
fn resolver_materializes_password_and_inline_key_for_runtime_hosts() {
    let fixture = Fixture::new();
    let target_key_ref = fixture.store_secret(
        "ssh-host",
        "host-1",
        "target",
        "private-key",
        "ssh-private-key",
        "-----BEGIN OPENSSH PRIVATE KEY-----\ntarget-key\n",
    );
    let jump_password_ref = fixture.store_secret(
        "jump-host",
        "host-1",
        "jump-0",
        "password",
        "ssh-password",
        "jump-password-secret",
    );
    let mut host = key_path_host("host-1", "");
    host.secret_ref = Some(target_key_ref);
    host.ssh_options.jump_hosts.push(SshJumpHostOptions {
        name: "bastion".to_owned(),
        host: "bastion.internal".to_owned(),
        port: 2222,
        username: "ops".to_owned(),
        auth_type: RemoteHostAuthType::Password,
        credential_ref: None,
        secret_ref: Some(jump_password_ref),
        key_passphrase_ref: None,
        key_passphrase_secret: None,
        credential_secret: None,
        credential_status: RemoteHostCredentialStatus::Vault,
    });

    let resolved = fixture.resolver().resolve_host(&host).expect("resolve");
    let runtime_host = SshCredentialResolver::materialize_runtime_host_from_auth(&host, &resolved);

    assert_eq!(runtime_host.credential_ref, None);
    assert_eq!(
        runtime_host.credential_secret.as_deref(),
        Some("-----BEGIN OPENSSH PRIVATE KEY-----\ntarget-key\n")
    );
    assert_eq!(runtime_host.ssh_options.jump_hosts[0].credential_ref, None);
    assert_eq!(
        runtime_host.ssh_options.jump_hosts[0]
            .credential_secret
            .as_deref(),
        Some("jump-password-secret")
    );
    assert_eq!(
        runtime_host.ssh_options.jump_hosts[0]
            .key_passphrase_secret
            .as_deref(),
        None
    );
}

#[test]
fn resolver_builds_native_route_material_without_runtime_host_secret_bridge() {
    let fixture = Fixture::new();
    let target_key_ref = fixture.store_secret(
        "ssh-host",
        "host-1",
        "target",
        "private-key",
        "ssh-private-key",
        "-----BEGIN OPENSSH PRIVATE KEY-----\ntarget-key\n",
    );
    let target_passphrase_ref = fixture.store_secret(
        "ssh-host",
        "host-1",
        "target",
        "key-passphrase",
        "ssh-key-passphrase",
        "target-passphrase-secret",
    );
    let jump_password_ref = fixture.store_secret(
        "jump-host",
        "host-1",
        "jump-0",
        "password",
        "ssh-password",
        "jump-password-secret",
    );
    let mut host = key_path_host("host-1", "");
    host.secret_ref = Some(target_key_ref);
    host.key_passphrase_ref = Some(target_passphrase_ref);
    host.ssh_options.jump_hosts.push(SshJumpHostOptions {
        name: "bastion".to_owned(),
        host: "bastion.internal".to_owned(),
        port: 2222,
        username: "ops".to_owned(),
        auth_type: RemoteHostAuthType::Password,
        credential_ref: None,
        secret_ref: Some(jump_password_ref),
        key_passphrase_ref: None,
        key_passphrase_secret: None,
        credential_secret: None,
        credential_status: RemoteHostCredentialStatus::Vault,
    });

    let resolved = fixture.resolver().resolve_host(&host).expect("resolve");
    let native_material =
        NativeSshRouteMaterial::from_resolved_auth(&resolved).expect("native material");

    match &native_material.target.auth {
        NativeSshAuthMaterial::PrivateKeyPem {
            content,
            passphrase,
            ..
        } => {
            assert!(content.contains("target-key"));
            assert_eq!(
                passphrase.as_ref().expect("passphrase").value,
                "target-passphrase-secret"
            );
        }
        other => panic!("expected native target inline key, got {other:?}"),
    }
    match &native_material.jumps[0].auth {
        NativeSshAuthMaterial::Password { value, .. } => {
            assert_eq!(value, "jump-password-secret");
        }
        other => panic!("expected native jump password, got {other:?}"),
    }
    assert_redacted(&native_material, "target-key");
    assert_redacted(&native_material, "target-passphrase-secret");
    assert_redacted(&native_material, "jump-password-secret");
}

#[test]
fn resolver_supports_inline_private_key_from_vault() {
    let fixture = Fixture::new();
    let key_ref = fixture.store_secret(
        "ssh-host",
        "host-1",
        "target",
        "private-key",
        "ssh-private-key",
        "-----BEGIN OPENSSH PRIVATE KEY-----\nsecret-key\n",
    );
    let mut host = key_path_host("host-1", "");
    host.credential_ref = None;
    host.secret_ref = Some(key_ref);

    let resolved = fixture.resolver().resolve_host(&host).expect("resolve");

    match &resolved.target.material {
        ResolvedSshAuthMaterial::PrivateKeyPem { content, .. } => {
            assert!(content.contains("secret-key"));
        }
        other => panic!("expected inline key material, got {other:?}"),
    }
    assert_eq!(
        resolved.summary.target.auth_kind,
        ResolvedSshAuthKind::PrivateKeyPem
    );
    assert_redacted(&resolved.target.material, "secret-key");
}

#[test]
fn resolver_uses_session_only_plaintext_without_vault_ref() {
    let fixture = Fixture::new();
    let mut host = password_host("host-1");
    host.credential_secret = Some("transient-secret".to_owned());

    let resolved = fixture.resolver().resolve_host(&host).expect("resolve");

    match &resolved.target.material {
        ResolvedSshAuthMaterial::Password { source, .. } => {
            assert!(matches!(
                source,
                ResolvedSshCredentialSource::SessionOnly { .. }
            ));
        }
        other => panic!("expected session-only password material, got {other:?}"),
    }
    assert!(matches!(
        resolved.summary.target.source,
        ResolvedSshCredentialSource::SessionOnly { .. }
    ));
    assert_redacted(&resolved, "transient-secret");
}

#[test]
fn resolver_returns_prompt_only_when_password_is_not_stored() {
    let fixture = Fixture::new();
    let host = password_host("host-1");

    let resolved = fixture.resolver().resolve_host(&host).expect("resolve");

    match &resolved.target.material {
        ResolvedSshAuthMaterial::PromptOnly { reason, .. } => {
            assert!(reason.contains("password"));
        }
        other => panic!("expected prompt-only material, got {other:?}"),
    }
    assert_eq!(
        resolved.target.secret_input_plan.mode,
        TerminalSecretInputMode::PromptOnly
    );
    assert!(resolved.summary.target.prompt_required);
}

#[test]
fn resolver_reports_missing_vault_key_without_plaintext() {
    let temp = tempfile::tempdir().expect("tempdir");
    let paths = KerminalPaths::from_root(temp.path());
    fs::create_dir_all(&paths.secrets).expect("secrets");
    fs::write(paths.vault_file(), "schema_version = 1\nentries = []\n").expect("vault");
    let resolver = SshCredentialResolver::new(EncryptedVaultService::new(paths));
    let mut host = password_host("host-1");
    host.secret_ref = Some(build_vault_secret_ref(
        "ssh-host", "host-1", "target", "password",
    ));

    let error = resolver.resolve_host(&host).expect_err("missing key");

    assert!(matches!(error, AppError::Credential(_)));
    assert!(error.to_string().contains("vault key"));
    assert_redacted(&error, "target-secret");
}

#[test]
fn resolver_reports_missing_vault_entry() {
    let fixture = Fixture::new();
    let mut host = password_host("host-1");
    host.secret_ref = Some(build_vault_secret_ref(
        "ssh-host", "host-1", "target", "password",
    ));

    let error = fixture
        .resolver()
        .resolve_host(&host)
        .expect_err("missing entry");

    assert!(matches!(error, AppError::Credential(_)));
    assert!(error.to_string().contains("vault entry is missing"));
}

#[test]
fn resolver_reports_decrypt_failure_without_plaintext() {
    let fixture = Fixture::new();
    let secret_ref = fixture.store_secret(
        "ssh-host",
        "host-1",
        "target",
        "password",
        "ssh-password",
        "target-secret",
    );
    let mut vault = fixture.vault.read_vault().expect("vault");
    vault.entries[0].nonce = "short".to_owned();
    write_toml_atomically(&fixture.paths.vault_file(), &vault).expect("tamper vault");
    let mut host = password_host("host-1");
    host.secret_ref = Some(secret_ref);

    let error = fixture
        .resolver()
        .resolve_host(&host)
        .expect_err("tampered vault");

    assert!(matches!(error, AppError::Credential(_)));
    assert!(error.to_string().contains("cannot be decrypted"));
    assert_redacted(&error, "target-secret");
}

struct Fixture {
    paths: KerminalPaths,
    vault: EncryptedVaultService,
}

impl Fixture {
    fn new() -> Self {
        let temp = tempfile::tempdir().expect("tempdir");
        let paths = KerminalPaths::from_root(temp.keep());
        let vault = EncryptedVaultService::new(paths.clone());
        vault.create_workspace_key().expect("workspace key");
        Self { paths, vault }
    }

    fn resolver(&self) -> SshCredentialResolver {
        SshCredentialResolver::new(self.vault.clone())
    }

    fn store_secret(
        &self,
        kind: &str,
        host_id: &str,
        scope: &str,
        material: &str,
        entry_kind: &str,
        plaintext: &str,
    ) -> String {
        let secret_ref = build_vault_secret_ref(kind, host_id, scope, material);
        self.vault
            .upsert_secret(
                &secret_ref,
                entry_kind,
                secret_ref.as_bytes(),
                plaintext.as_bytes(),
            )
            .expect("store vault secret");
        secret_ref
    }
}

trait SummarySourceExt {
    fn source_vault_ref(&self) -> String;
}

impl SummarySourceExt for kerminal_lib::services::ssh_credential_resolver::ResolvedSshAuthSummary {
    fn source_vault_ref(&self) -> String {
        match &self.source {
            ResolvedSshCredentialSource::Vault(source) => source.secret_ref.clone(),
            other => panic!("expected vault source, got {other:?}"),
        }
    }
}

fn password_host(id: &str) -> RemoteHost {
    base_host(id, RemoteHostAuthType::Password)
}

fn agent_host(id: &str) -> RemoteHost {
    base_host(id, RemoteHostAuthType::Agent)
}

fn key_path_host(id: &str, path: &str) -> RemoteHost {
    let mut host = base_host(id, RemoteHostAuthType::Key);
    host.credential_ref = (!path.trim().is_empty()).then(|| path.to_owned());
    host
}

fn base_host(id: &str, auth_type: RemoteHostAuthType) -> RemoteHost {
    RemoteHost {
        id: id.to_owned(),
        group_id: None,
        name: "host".to_owned(),
        host: "target.internal".to_owned(),
        port: 22,
        username: "deploy".to_owned(),
        protocol: Default::default(),
        auth_type,
        credential_ref: None,
        secret_ref: None,
        key_passphrase_ref: None,
        key_passphrase_secret: None,
        credential_secret: None,
        credential_status: RemoteHostCredentialStatus::Missing,
        tags: Vec::new(),
        production: false,
        ssh_options: SshOptions::default(),
        sort_order: 0,
        created_at: "1".to_owned(),
        updated_at: "1".to_owned(),
    }
}

fn assert_redacted(value: &impl std::fmt::Debug, secret: &str) {
    assert!(
        !format!("{value:?}").contains(secret),
        "debug output leaked secret"
    );
}
