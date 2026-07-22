use super::*;

#[tokio::test]
async fn loopback_production_host_restricted_policy_skips_remote_probes_without_connecting() {
    let remote_root = tempdir().expect("create restricted loopback remote root");
    std_fs::create_dir_all(remote_root.path().join("srv").join("repo"))
        .expect("create restricted loopback repo directory");

    let server = start_loopback_provider_server(remote_root.path().to_path_buf()).await;
    let harness = SmokeHarness::new();
    let config = loopback_policy_config(server.addr.port());
    let remote_host = harness.create_remote_host_with_production(&config, true);
    let mut settings = harness.inline_settings();
    settings.remote_probe_enabled = true;
    settings.production_host_policy = TerminalInlineSuggestionProductionHostPolicy::Restricted;
    let inline_settings = settings;

    assert_all_remote_refreshes_skipped_without_connecting(
        &harness,
        &server,
        &remote_host,
        &config,
        inline_settings,
        ExpectedRemoteProbeSkip {
            policy: "restricted",
            production_host: "true",
            reason: "production-host-restricted",
            remote_probe_enabled: "true",
        },
    )
    .await;
}

#[tokio::test]
async fn loopback_remote_probe_disabled_policy_skips_remote_probes_without_connecting() {
    let remote_root = tempdir().expect("create disabled loopback remote root");
    std_fs::create_dir_all(remote_root.path().join("srv").join("repo"))
        .expect("create disabled loopback repo directory");

    let server = start_loopback_provider_server(remote_root.path().to_path_buf()).await;
    let harness = SmokeHarness::new();
    let config = loopback_policy_config(server.addr.port());
    let remote_host = harness.create_remote_host_with_production(&config, false);
    let mut settings = harness.inline_settings();
    settings.remote_probe_enabled = false;
    settings.production_host_policy = TerminalInlineSuggestionProductionHostPolicy::Normal;
    let inline_settings = settings;

    assert_all_remote_refreshes_skipped_without_connecting(
        &harness,
        &server,
        &remote_host,
        &config,
        inline_settings,
        ExpectedRemoteProbeSkip {
            policy: "normal",
            production_host: "false",
            reason: "remote-probe-disabled",
            remote_probe_enabled: "false",
        },
    )
    .await;
}

struct ExpectedRemoteProbeSkip {
    policy: &'static str,
    production_host: &'static str,
    reason: &'static str,
    remote_probe_enabled: &'static str,
}

async fn assert_all_remote_refreshes_skipped_without_connecting(
    harness: &SmokeHarness,
    server: &LoopbackProviderServer,
    remote_host: &RemoteHost,
    config: &SmokeConfig,
    inline_settings: TerminalInlineSuggestionSettings,
    expected: ExpectedRemoteProbeSkip,
) {
    let command_refresh = harness
        .suggestions
        .refresh_remote_commands(
            &harness.storage,
            &harness.paths,
            &harness.ssh_commands,
            inline_settings.clone(),
            CommandSuggestionRemoteCommandRefreshRequest {
                host_id: remote_host.id.clone(),
                max_entries: Some(64),
                ttl_seconds: Some(300),
            },
        )
        .await
        .expect("skip remote command refresh by policy");
    assert_eq!(command_refresh.command_count, 0);

    let history_refresh = harness
        .suggestions
        .refresh_remote_history(
            &harness.storage,
            &harness.paths,
            &harness.ssh_commands,
            inline_settings.clone(),
            CommandSuggestionRemoteHistoryRefreshRequest {
                host_id: remote_host.id.clone(),
                max_entries: Some(64),
                ttl_seconds: Some(300),
            },
        )
        .await
        .expect("skip remote history refresh by policy");
    assert_eq!(history_refresh.command_count, 0);

    let path_refresh = harness
        .suggestions
        .refresh_remote_paths(
            &harness.storage,
            &harness.paths,
            &harness.sftp,
            inline_settings.clone(),
            CommandSuggestionRemotePathRefreshRequest {
                host_id: remote_host.id.clone(),
                max_entries: Some(64),
                path: config.path.clone(),
                ttl_seconds: Some(300),
            },
        )
        .await
        .expect("skip remote path refresh by policy");
    assert_eq!(path_refresh.entry_count, 0);
    assert_eq!(path_refresh.path, config.path);

    let git_refresh = harness
        .suggestions
        .refresh_git_refs(
            &harness.storage,
            &harness.paths,
            &harness.ssh_commands,
            inline_settings,
            CommandSuggestionGitRefreshRequest {
                cwd: config.cwd.clone(),
                host_id: remote_host.id.clone(),
                max_entries: Some(64),
                ttl_seconds: Some(300),
            },
        )
        .await
        .expect("skip git refresh by policy");
    assert_eq!(git_refresh.entry_count, 0);
    assert!(git_refresh.repo_root.is_none());

    assert_eq!(server.counters.connections.load(Ordering::SeqCst), 0);
    assert_eq!(server.counters.exec_requests.load(Ordering::SeqCst), 0);
    assert_eq!(server.counters.sftp_subsystems.load(Ordering::SeqCst), 0);

    for (provider, input) in [
        (
            SuggestionProviderKind::RemoteCommand,
            config.command_prefix.as_str(),
        ),
        (SuggestionProviderKind::History, "deploy --dry"),
        (
            SuggestionProviderKind::RemotePath,
            config.path_prefix.as_str(),
        ),
        (SuggestionProviderKind::Git, config.git_prefix.as_str()),
    ] {
        let candidates = harness.list(&remote_host.id, &config.cwd, input, provider);
        assert!(
            candidates.is_empty(),
            "skipped {provider:?} refresh must not seed cache: {candidates:?}"
        );
    }

    let export = harness
        .suggestions
        .telemetry_export(&harness.storage)
        .expect("export skipped policy telemetry");
    for provider in [
        SuggestionProviderKind::History,
        SuggestionProviderKind::RemoteCommand,
        SuggestionProviderKind::RemotePath,
        SuggestionProviderKind::Git,
    ] {
        let event = export
            .audit_events
            .iter()
            .find(|event| {
                event.event_kind == CommandSuggestionAuditEventKind::RemoteProbeSchedule
                    && event.provider == Some(provider)
                    && event.decision == CommandSuggestionAuditDecision::Skipped
                    && event.reason.as_deref() == Some(expected.reason)
            })
            .unwrap_or_else(|| {
                panic!(
                    "expected skipped policy audit event for {provider:?}: {:?}",
                    export.audit_events
                )
            });
        assert_eq!(
            event.remote_host_id.as_deref(),
            Some(remote_host.id.as_str())
        );
        assert_eq!(
            event.metadata.get("productionHost").map(String::as_str),
            Some(expected.production_host)
        );
        assert_eq!(
            event.metadata.get("remoteProbeEnabled").map(String::as_str),
            Some(expected.remote_probe_enabled)
        );
        assert_eq!(
            event
                .metadata
                .get("productionHostPolicy")
                .map(String::as_str),
            Some(expected.policy)
        );
        assert_eq!(
            event.metadata.get("maxEntries").map(String::as_str),
            Some("64")
        );
        assert_eq!(
            event.metadata.get("ttlSeconds").map(String::as_str),
            Some("300")
        );
        if provider == SuggestionProviderKind::RemotePath {
            assert_eq!(event.path.as_deref(), Some(config.path.as_str()));
        }
        if provider == SuggestionProviderKind::Git {
            assert_eq!(event.cwd.as_deref(), Some(config.cwd.as_str()));
        }
    }
}

fn loopback_policy_config(port: u16) -> SmokeConfig {
    SmokeConfig {
        auth_type: RemoteHostAuthType::Password,
        builtin_command: "umask".to_owned(),
        builtin_prefix: "c".to_owned(),
        command_prefix: "ku".to_owned(),
        credential_ref: None,
        credential_secret: Some("secret".to_owned()),
        cwd: "/srv/repo".to_owned(),
        git_prefix: "git checkout fe".to_owned(),
        history_prefix: Some("deploy --dry".to_owned()),
        host: "127.0.0.1".to_owned(),
        path: "/srv/repo".to_owned(),
        path_prefix: "ls app".to_owned(),
        port,
        username: "deploy".to_owned(),
    }
}
