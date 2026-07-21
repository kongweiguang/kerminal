// @author kongweiguang

#[test]
fn openssh_option_schema_preserves_destination_after_known_value_options() {
    let request = ExternalLaunchParserRegistry::new()
        .parse(&ExternalLaunchParseInput::direct_argv(
            ExternalLaunchSourceTool::Openssh,
            vec![
                "ssh.exe".to_owned(),
                "-E".to_owned(),
                "ssh.log".to_owned(),
                "-p2202".to_owned(),
                "-ldeploy".to_owned(),
                "example.internal".to_owned(),
            ],
        ))
        .expect("parse OpenSSH options with declared arity");

    assert_eq!(request.target.host, "example.internal");
    assert_eq!(request.target.port, 2202);
    assert_eq!(request.target.username.as_deref(), Some("deploy"));
}

#[test]
fn openssh_rejects_unknown_options_instead_of_reinterpreting_their_values() {
    let error = ExternalLaunchParserRegistry::new()
        .parse(&ExternalLaunchParseInput::direct_argv(
            ExternalLaunchSourceTool::Openssh,
            vec![
                "ssh.exe".to_owned(),
                "-Z".to_owned(),
                "option-value".to_owned(),
                "example.internal".to_owned(),
            ],
        ))
        .expect_err("unknown OpenSSH option must fail closed");

    assert!(error.to_string().contains("unsupported OpenSSH option"));
}

#[test]
fn parser_rejects_oversized_nested_command_before_persona_parsing() {
    const CANARY: &str = "KERM_OVERSIZED_REMOTE_COMMAND_CANARY";
    let oversized = format!("{CANARY}{}", "x".repeat(64 * 1024));
    let error = ExternalLaunchParserRegistry::new()
        .parse(&ExternalLaunchParseInput::direct_argv(
            ExternalLaunchSourceTool::Openssh,
            vec![
                "ssh.exe".to_owned(),
                "deploy@example.internal".to_owned(),
                oversized,
            ],
        ))
        .expect_err("oversized command must fail before parsing");

    assert!(error.to_string().contains("size limit"));
    assert!(!error.to_string().contains(CANARY));
}

#[test]
fn external_launch_debug_output_never_contains_remote_command_text() {
    const COMMAND_CANARY: &str = "KERM_REMOTE_COMMAND_CANARY_DO_NOT_LOG";
    const HOST_CANARY: &str = "debug-host-canary.example.internal";
    const USER_CANARY: &str = "debug-user-canary";
    let request = ExternalLaunchParserRegistry::new()
        .parse(&ExternalLaunchParseInput::direct_argv(
            ExternalLaunchSourceTool::Openssh,
            vec![
                "ssh.exe".to_owned(),
                format!("{USER_CANARY}@{HOST_CANARY}"),
                "echo".to_owned(),
                COMMAND_CANARY.to_owned(),
            ],
        ))
        .expect("parse remote command");

    assert_eq!(
        request.options.remote_command.as_deref(),
        Some("echo KERM_REMOTE_COMMAND_CANARY_DO_NOT_LOG")
    );
    assert!(!format!("{request:?}").contains(COMMAND_CANARY));
    assert!(!format!("{request:?}").contains(HOST_CANARY));
    assert!(!format!("{request:?}").contains(USER_CANARY));
}

#[test]
fn registry_parses_all_external_launch_fixtures() {
    let registry = ExternalLaunchParserRegistry::new();
    for case in fixture_cases() {
        let id = required_text(&case, "id");
        let source_tool =
            ExternalLaunchSourceTool::from_external_name(required_text(&case, "sourceTool"))
                .unwrap_or_else(|error| panic!("{id}: unsupported source tool: {error}"));
        let mut argv = required_array_value(&case, "argv")
            .iter()
            .map(|value| value.as_str().expect("argv string").to_owned())
            .collect::<Vec<_>>();
        let fixture_dir = tempfile::tempdir().expect("fixture tempdir");
        materialize_sidecar_args(&case, fixture_dir.path(), &mut argv);
        let request = registry
            .parse(&fixture_parse_input(&case, source_tool, argv))
            .unwrap_or_else(|error| panic!("{id}: parse failed: {error}"));

        assert_eq!(request.source.tool, source_tool, "{id}: source tool");
        assert_expected_target(id, &request, required_object(&case, "expected"));
        assert_expected_auth(id, &request, required_object(&case, "expected"));
        assert_expected_options(id, &request, required_object(&case, "expected"));
        assert_expected_intent(id, &request, required_object(&case, "expected"));
        assert_expected_diagnostics(id, &request, required_object(&case, "expected"));
        assert_debug_redacted(id, &request, required_object(&case, "expected"));
    }
}

/// 将 fixture 中的声明式 sidecar 文件映射到本轮临时目录，避免测试依赖机器固定路径。
fn materialize_sidecar_args(case: &Value, root: &std::path::Path, argv: &mut [String]) {
    if let Some(content) = case.get("sessionFileText").and_then(Value::as_str) {
        let local_path = root.join("session.moba");
        std::fs::write(&local_path, content).expect("write MobaXterm session fixture");
        if let Some(argument) = argv
            .iter_mut()
            .find(|argument| argument.to_ascii_lowercase().ends_with(".moba"))
        {
            *argument = local_path.to_string_lossy().into_owned();
        }
    }
    let Some(files) = case.get("sidecarFiles").and_then(Value::as_object) else {
        return;
    };
    for (index, (declared_path, content)) in files.iter().enumerate() {
        let extension = std::path::Path::new(declared_path)
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("txt");
        let local_path = root.join(format!("sidecar-{index}.{extension}"));
        std::fs::write(
            &local_path,
            content.as_str().expect("sidecar content string"),
        )
        .expect("write fixture sidecar");
        for argument in argv.iter_mut() {
            if argument == declared_path {
                *argument = local_path.to_string_lossy().into_owned();
            }
        }
    }
}

#[test]
fn registry_can_infer_persona_from_argv0() {
    let registry = ExternalLaunchParserRegistry::new();
    let request = registry
        .parse(&ExternalLaunchParseInput::inferred_direct_argv(vec![
            "C:\\Program Files\\PuTTY\\putty.exe".to_owned(),
            "-ssh".to_owned(),
            "ops@example.internal".to_owned(),
            "-P".to_owned(),
            "2222".to_owned(),
        ]))
        .expect("parse inferred PuTTY argv");

    assert_eq!(request.source.tool, ExternalLaunchSourceTool::Putty);
    assert_eq!(request.target.host, "example.internal");
    assert_eq!(request.target.port, 2222);
    assert_eq!(request.target.username.as_deref(), Some("ops"));
}

#[test]
fn registry_accepts_vendor_style_args_when_argv0_is_kerminal() {
    let registry = ExternalLaunchParserRegistry::new();
    for case in fixture_cases()
        .into_iter()
        .filter(|case| required_text(case, "priority") == "P0")
        .filter(|case| required_text(case, "sourceTool") != "kerminal-native")
    {
        let id = required_text(&case, "id");
        let source_tool =
            ExternalLaunchSourceTool::from_external_name(required_text(&case, "sourceTool"))
                .unwrap_or_else(|error| panic!("{id}: unsupported source tool: {error}"));
        let mut argv = required_array_value(&case, "argv")
            .iter()
            .map(|value| value.as_str().expect("argv string").to_owned())
            .collect::<Vec<_>>();
        argv[0] = "C:\\Program Files\\Kerminal\\kerminal.exe".to_owned();

        let request = registry
            .parse(&ExternalLaunchParseInput::inferred_direct_argv(argv))
            .unwrap_or_else(|error| panic!("{id}: kerminal argv0 parse failed: {error}"));

        assert_eq!(request.source.tool, source_tool, "{id}: source tool");
        assert_eq!(
            request.source.argv0.as_deref(),
            Some("C:\\Program Files\\Kerminal\\kerminal.exe"),
            "{id}: source argv0"
        );
        assert_eq!(
            request
                .diagnostics
                .argv_redacted
                .first()
                .map(String::as_str),
            Some("C:\\Program Files\\Kerminal\\kerminal.exe"),
            "{id}: redacted argv0"
        );
        assert_expected_target(id, &request, required_object(&case, "expected"));
        assert_expected_auth(id, &request, required_object(&case, "expected"));
        assert_expected_options(id, &request, required_object(&case, "expected"));
        assert_debug_redacted(id, &request, required_object(&case, "expected"));
    }
}

#[test]
fn registry_keeps_kerminal_argv0_native_flags_native() {
    let registry = ExternalLaunchParserRegistry::new();
    let request = registry
        .parse(&ExternalLaunchParseInput::inferred_direct_argv(vec![
            "C:\\Program Files\\Kerminal\\kerminal.exe".to_owned(),
            "--external-ssh".to_owned(),
            "--host".to_owned(),
            "native.internal".to_owned(),
            "--port".to_owned(),
            "2244".to_owned(),
            "--user".to_owned(),
            "native".to_owned(),
        ]))
        .expect("parse Kerminal native argv");

    assert_eq!(
        request.source.tool,
        ExternalLaunchSourceTool::KerminalNative
    );
    assert_eq!(request.target.host, "native.internal");
    assert_eq!(request.target.port, 2244);
    assert_eq!(request.target.username.as_deref(), Some("native"));
}

#[test]
fn mobaxterm_nested_ssh_preserves_windows_identity_path() {
    let registry = ExternalLaunchParserRegistry::new();
    let request = registry
        .parse(&ExternalLaunchParseInput::direct_argv(
            ExternalLaunchSourceTool::Mobaxterm,
            vec![
                "MobaXterm.exe".to_owned(),
                "-newtab".to_owned(),
                "ssh -p 2200 -i C:\\Users\\alice\\.ssh\\id_ed25519 dev@devbox.internal".to_owned(),
            ],
        ))
        .expect("parse MobaXterm nested SSH command");

    assert_eq!(
        request.auth.identity_file.as_deref(),
        Some("C:\\Users\\alice\\.ssh\\id_ed25519")
    );
    assert_eq!(
        request.diagnostics.argv_redacted[2],
        "ssh -p 2200 -i <path:fingerprint> dev@devbox.internal"
    );
}

#[test]
fn mobaxterm_newtab_accepts_split_ssh_arguments() {
    let registry = ExternalLaunchParserRegistry::new();
    let request = registry
        .parse(&ExternalLaunchParseInput::direct_argv(
            ExternalLaunchSourceTool::Mobaxterm,
            vec![
                "MobaXterm.exe".to_owned(),
                "-newtab".to_owned(),
                "ssh".to_owned(),
                "-p".to_owned(),
                "2200".to_owned(),
                "-i".to_owned(),
                "C:\\Users\\alice\\.ssh\\id_ed25519".to_owned(),
                "dev@devbox.internal".to_owned(),
            ],
        ))
        .expect("parse MobaXterm split SSH command");

    assert_eq!(request.target.host, "devbox.internal");
    assert_eq!(request.target.port, 2200);
    assert_eq!(request.target.username.as_deref(), Some("dev"));
    assert_eq!(
        request.auth.identity_file.as_deref(),
        Some("C:\\Users\\alice\\.ssh\\id_ed25519")
    );
    assert_eq!(
        request.diagnostics.argv_redacted[2],
        "ssh -p 2200 -i <path:fingerprint> dev@devbox.internal"
    );
}

#[test]
fn mobaxterm_accepts_openssh_args_without_newtab_exec() {
    let registry = ExternalLaunchParserRegistry::new();
    let request = registry
        .parse(&ExternalLaunchParseInput::direct_argv(
            ExternalLaunchSourceTool::Mobaxterm,
            vec![
                "MobaXterm.exe".to_owned(),
                "-p".to_owned(),
                "2201".to_owned(),
                "ops@moba-direct.internal".to_owned(),
            ],
        ))
        .expect("parse MobaXterm direct OpenSSH args");

    assert_eq!(request.target.host, "moba-direct.internal");
    assert_eq!(request.target.port, 2201);
    assert_eq!(request.target.username.as_deref(), Some("ops"));
    assert_eq!(request.diagnostics.parser, "mobaxterm-argv");
}

#[test]
fn mobaxterm_accepts_direct_ssh_command_without_newtab_exec() {
    let registry = ExternalLaunchParserRegistry::new();
    let request = registry
        .parse(&ExternalLaunchParseInput::direct_argv(
            ExternalLaunchSourceTool::Mobaxterm,
            vec![
                "MobaXterm.exe".to_owned(),
                "ssh".to_owned(),
                "-p".to_owned(),
                "2202".to_owned(),
                "ops@moba-ssh.internal".to_owned(),
            ],
        ))
        .expect("parse MobaXterm direct ssh command");

    assert_eq!(request.target.host, "moba-ssh.internal");
    assert_eq!(request.target.port, 2202);
    assert_eq!(request.target.username.as_deref(), Some("ops"));
    assert_eq!(request.diagnostics.parser, "mobaxterm-argv");
}

#[test]
fn mobaxterm_accepts_field_style_ssh_arguments() {
    let registry = ExternalLaunchParserRegistry::new();
    let request = registry
        .parse(&ExternalLaunchParseInput::direct_argv(
            ExternalLaunchSourceTool::Mobaxterm,
            vec![
                "MobaXterm.exe".to_owned(),
                "-newtab".to_owned(),
                "-ssh".to_owned(),
                "-remotehost".to_owned(),
                "10.11.0.75".to_owned(),
                "-username".to_owned(),
                "root".to_owned(),
                "-port".to_owned(),
                "22".to_owned(),
            ],
        ))
        .expect("parse MobaXterm field-style SSH args");

    assert_eq!(request.target.host, "10.11.0.75");
    assert_eq!(request.target.port, 22);
    assert_eq!(request.target.username.as_deref(), Some("root"));
    assert_eq!(request.diagnostics.parser, "mobaxterm-fields");
}

#[test]
fn mobaxterm_accepts_ssh_url_destination() {
    let registry = ExternalLaunchParserRegistry::new();
    let request = registry
        .parse(&ExternalLaunchParseInput::direct_argv(
            ExternalLaunchSourceTool::Mobaxterm,
            vec![
                "MobaXterm.exe".to_owned(),
                "-newtab".to_owned(),
                "ssh".to_owned(),
                "ssh://ops@moba-url.internal:2203".to_owned(),
            ],
        ))
        .expect("parse MobaXterm ssh URL destination");

    assert_eq!(request.target.host, "moba-url.internal");
    assert_eq!(request.target.port, 2203);
    assert_eq!(request.target.username.as_deref(), Some("ops"));
}

#[test]
fn mobaxterm_accepts_moba_session_file() {
    let registry = ExternalLaunchParserRegistry::new();
    let path = write_temp_moba_session_file();
    let request = registry
        .parse(&ExternalLaunchParseInput::direct_argv(
            ExternalLaunchSourceTool::Mobaxterm,
            vec![
                "MobaXterm.exe".to_owned(),
                path.to_string_lossy().into_owned(),
            ],
        ))
        .expect("parse MobaXterm .moba session file");

    let _ = std::fs::remove_file(path);
    assert_eq!(request.target.host, "172.21.195.223");
    assert_eq!(request.target.port, 222);
    assert_eq!(request.target.username.as_deref(), Some("root"));
    assert_eq!(request.diagnostics.parser, "mobaxterm-moba-file");
    assert_eq!(request.diagnostics.argv_redacted[1], "<moba-session-file>");
}

#[test]
fn mobaxterm_moba_session_file_infers_when_argv0_is_kerminal() {
    let registry = ExternalLaunchParserRegistry::new();
    let path = write_temp_moba_session_file();
    let request = registry
        .parse(&ExternalLaunchParseInput::from_args(
            ExternalLaunchEntrypoint::SingleInstance,
            None,
            None,
            vec![
                "C:\\dev\\rust\\kerminal\\src-tauri\\target\\debug\\kerminal.exe".to_owned(),
                path.to_string_lossy().into_owned(),
            ],
        ))
        .expect("infer MobaXterm .moba file from Kerminal single-instance argv");

    let _ = std::fs::remove_file(path);
    assert_eq!(request.source.tool, ExternalLaunchSourceTool::Mobaxterm);
    assert_eq!(request.target.host, "172.21.195.223");
    assert_eq!(request.target.port, 222);
    assert_eq!(request.target.username.as_deref(), Some("root"));
    assert_eq!(request.diagnostics.parser, "mobaxterm-moba-file");
}

#[test]
fn mobaxterm_moba_session_file_uses_bhost_parent_b64_target() {
    let registry = ExternalLaunchParserRegistry::new();
    let path = write_temp_moba_session_file();
    let input = ExternalLaunchParseInput::from_args_with_parent_command_line(
        ExternalLaunchEntrypoint::DirectArgv,
        Some(ExternalLaunchSourceTool::Mobaxterm),
        Some(ExternalLaunchSourceTool::Mobaxterm.as_str().to_owned()),
        vec![
            "MobaXterm.exe".to_owned(),
            "-newtab".to_owned(),
            path.to_string_lossy().into_owned(),
        ],
        Some(
            "\"C:\\Users\\Public\\Documents\\BHost\\bhmultauth.exe\" 33 \"C:/Program Files/Kerminal/kerminal.exe\" \"172.21.195.223\" \"222\" \"b64>>d2VuOjMwMTI1OTY5NDQ4OTVAcm9vdEAxMC4xMS4wLjc1OjIyOlNTSDI=\" \"en::6d49b3b3fb5721e430d82ae005431d2a\" \"root_10.11.0.75\"".to_owned(),
        ),
    );
    let request = registry
        .parse(&input)
        .expect("parse MobaXterm BHost parent command line");

    let _ = std::fs::remove_file(path);
    assert_eq!(request.target.host, "172.21.195.223");
    assert_eq!(request.target.port, 222);
    assert_eq!(
        request.target.username.as_deref(),
        Some("b64>>d2VuOjMwMTI1OTY5NDQ4OTVAcm9vdEAxMC4xMS4wLjc1OjIyOlNTSDI=")
    );
    assert!(request.auth.has_password());
    assert_eq!(request.diagnostics.parser, "mobaxterm-bhost-parent");
    assert_eq!(
        request.options.display_name.as_deref(),
        Some("root_10.11.0.75")
    );
    assert!(!format!("{request:?}").contains("3012596944895"));
}

#[test]
fn xshell_url_decodes_percent_encoded_userinfo_and_b64_payload() {
    let registry = ExternalLaunchParserRegistry::new();
    let payload = "anVtcDpLRVJNX0ZJWFRVUkVfWFNIRUxMX0I2NF9QQVNTV09SRF9ET19OT1RfVVNFQHJvb3RAMTAuMTEuMC43NToyMjpTU0gy";
    let raw_url = format!("ssh://b64%3E%3E{payload}@172.21.195.223:222");
    let request = registry
        .parse(&ExternalLaunchParseInput::direct_argv(
            ExternalLaunchSourceTool::Xshell,
            vec!["Xshell.exe".to_owned(), "-url".to_owned(), raw_url],
        ))
        .expect("parse Xshell URL with b64 payload in userinfo");

    assert_eq!(request.target.host, "10.11.0.75");
    assert_eq!(request.target.port, 22);
    assert_eq!(request.target.username.as_deref(), Some("root"));
    assert!(request.auth.has_password());
    assert_eq!(request.diagnostics.parser, "xshell-b64");
    assert_eq!(
        request.diagnostics.argv_redacted[2],
        "ssh://b64>><redacted>@172.21.195.223:222"
    );
    let debug = format!("{request:?}");
    assert!(!debug.contains(payload));
    assert!(!debug.contains("KERM_FIXTURE_XSHELL_B64_PASSWORD_DO_NOT_USE"));
}

#[test]
fn xshell_b64_url_with_bridge_password_preserves_bastion_endpoint() {
    let registry = ExternalLaunchParserRegistry::new();
    let payload =
        "anVtcDpLRVJNX0ZJWFRVUkVfWFNIRUxMX0I2NF9QQVNTV09SRF9ET19OT1RfVVNFQHJvb3RAMTAuMTEuMC43NToyMjpTU0gy";
    let raw_url =
        format!("ssh://b64%3E%3E{payload}:KERMINAL_FIXTURE_BRIDGE_TOKEN@172.21.195.223:222");
    let request = registry
        .parse(&ExternalLaunchParseInput::from_args(
            ExternalLaunchEntrypoint::SingleInstance,
            None,
            None,
            vec![
                "C:\\dev\\rust\\kerminal\\src-tauri\\target\\debug\\kerminal.exe".to_owned(),
                "-url".to_owned(),
                raw_url,
                "-newtab".to_owned(),
                "root@10.11.0.75".to_owned(),
            ],
        ))
        .expect("parse Xshell bridge URL without decoding away bastion endpoint");

    assert_eq!(request.source.tool, ExternalLaunchSourceTool::Xshell);
    assert_eq!(request.target.host, "172.21.195.223");
    assert_eq!(request.target.port, 222);
    assert!(request
        .target
        .username
        .as_deref()
        .is_some_and(|username| username.starts_with("b64>>")));
    assert!(request.auth.has_password());
    assert_eq!(request.diagnostics.parser, "xshell-bhost-url");
    assert_eq!(
        request.options.display_name.as_deref(),
        Some("root@10.11.0.75")
    );
    let debug = format!("{request:?}");
    assert!(!debug.contains(payload));
    assert!(!debug.contains("KERMINAL_FIXTURE_BRIDGE_TOKEN"));
}

#[test]
fn xshell_bridge_url_without_b64_preserves_endpoint_and_redacts_token() {
    let registry = ExternalLaunchParserRegistry::new();
    let bridge_user = "opaqueBridgeTicket_0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    let raw_url =
        format!("ssh://{bridge_user}:KERMINAL_FIXTURE_GENERIC_BRIDGE_TOKEN@172.21.195.223:222");
    let request = registry
        .parse(&ExternalLaunchParseInput::from_args(
            ExternalLaunchEntrypoint::SingleInstance,
            None,
            None,
            vec![
                "C:\\dev\\rust\\kerminal\\src-tauri\\target\\debug\\kerminal.exe".to_owned(),
                raw_url,
                "-newtab".to_owned(),
                "root@10.11.0.75".to_owned(),
            ],
        ))
        .expect("parse generic third-party bridge URL without b64 prefix");

    assert_eq!(request.source.tool, ExternalLaunchSourceTool::Xshell);
    assert_eq!(request.target.host, "172.21.195.223");
    assert_eq!(request.target.port, 222);
    assert_eq!(request.target.username.as_deref(), Some(bridge_user));
    assert!(request.auth.has_password());
    assert_eq!(request.diagnostics.parser, "xshell-bhost-url");
    assert_eq!(
        request.options.display_name.as_deref(),
        Some("root@10.11.0.75")
    );
    assert_eq!(
        request.diagnostics.argv_redacted[1],
        "ssh://<redacted-external-user>@172.21.195.223:222"
    );
    let debug = format!("{request:?}");
    assert!(!debug.contains(bridge_user));
    assert!(!debug.contains("KERMINAL_FIXTURE_GENERIC_BRIDGE_TOKEN"));
}

#[test]
fn xshell_accepts_newwin_and_direct_url_forms() {
    let registry = ExternalLaunchParserRegistry::new();
    let newwin = registry
        .parse(&ExternalLaunchParseInput::direct_argv(
            ExternalLaunchSourceTool::Xshell,
            vec![
                "Xshell.exe".to_owned(),
                "-newwin".to_owned(),
                "ssh://root@10.11.0.75:22".to_owned(),
            ],
        ))
        .expect("parse Xshell -newwin URL");
    assert_eq!(newwin.target.host, "10.11.0.75");
    assert_eq!(newwin.target.port, 22);
    assert_eq!(newwin.target.username.as_deref(), Some("root"));

    let direct = registry
        .parse(&ExternalLaunchParseInput::direct_argv(
            ExternalLaunchSourceTool::Xshell,
            vec![
                "Xshell.exe".to_owned(),
                "ssh://deploy@direct-xshell.internal:2022".to_owned(),
            ],
        ))
        .expect("parse Xshell direct URL");
    assert_eq!(direct.target.host, "direct-xshell.internal");
    assert_eq!(direct.target.port, 2022);
    assert_eq!(direct.target.username.as_deref(), Some("deploy"));
}

#[test]
fn xshell_url_percent_decodes_regular_user_and_password() {
    let registry = ExternalLaunchParserRegistry::new();
    let request = registry
        .parse(&ExternalLaunchParseInput::direct_argv(
            ExternalLaunchSourceTool::Xshell,
            vec![
                "Xshell.exe".to_owned(),
                "-url".to_owned(),
                "ssh://ops%2Badmin:KERM_FIXTURE_XSHELL%2520URL_SECRET@db.internal:2201".to_owned(),
            ],
        ))
        .expect("parse percent-encoded Xshell URL");

    assert_eq!(request.target.host, "db.internal");
    assert_eq!(request.target.port, 2201);
    assert_eq!(request.target.username.as_deref(), Some("ops+admin"));
    assert!(request.auth.has_password());
    assert!(!format!("{request:?}").contains("KERM_FIXTURE_XSHELL%20URL_SECRET"));
}

#[test]
fn registry_accepts_generic_field_args_when_argv0_is_kerminal() {
    let registry = ExternalLaunchParserRegistry::new();
    let request = registry
        .parse(&ExternalLaunchParseInput::inferred_direct_argv(vec![
            "C:\\Program Files\\Kerminal\\kerminal.exe".to_owned(),
            "--host".to_owned(),
            "field-generic.internal".to_owned(),
            "--port".to_owned(),
            "2248".to_owned(),
            "--user".to_owned(),
            "fieldops".to_owned(),
        ]))
        .expect("parse generic host/user/port args without external marker");

    assert_eq!(
        request.source.tool,
        ExternalLaunchSourceTool::KerminalNative
    );
    assert_eq!(request.target.host, "field-generic.internal");
    assert_eq!(request.target.port, 2248);
    assert_eq!(request.target.username.as_deref(), Some("fieldops"));
    assert_eq!(request.diagnostics.parser, "kerminal-native-flags");
}

#[test]
fn registry_accepts_bare_user_at_host_when_argv0_is_kerminal() {
    let registry = ExternalLaunchParserRegistry::new();
    let request = registry
        .parse(&ExternalLaunchParseInput::inferred_direct_argv(vec![
            "C:\\Program Files\\Kerminal\\kerminal.exe".to_owned(),
            "deploy@generic-openssh.internal".to_owned(),
        ]))
        .expect("parse generic user@host args without ssh.exe argv0");

    assert_eq!(request.source.tool, ExternalLaunchSourceTool::Openssh);
    assert_eq!(request.target.host, "generic-openssh.internal");
    assert_eq!(request.target.port, 22);
    assert_eq!(request.target.username.as_deref(), Some("deploy"));
    assert_eq!(request.diagnostics.parser, "openssh");
}

#[test]
fn kerminal_protocol_url_rejects_secret_and_local_file_parameters() {
    let registry = ExternalLaunchParserRegistry::new();
    let error = registry
        .parse(&ExternalLaunchParseInput::direct_argv(
            ExternalLaunchSourceTool::KerminalNative,
            vec![
                "kerminal.exe".to_owned(),
                "kerminal://ssh?host=proto.internal&port=2201&user=proto&password=KERM_FIXTURE_PROTOCOL_PASSWORD_DO_NOT_USE&identityFile=C%3A%5CUsers%5Calice%5C.ssh%5Cproto.key&keyPassphrase=KERM_FIXTURE_PROTOCOL_PASSPHRASE_DO_NOT_USE&openSftp=true".to_owned(),
            ],
        ))
        .expect_err("protocol URL secrets must fail closed");

    assert!(error
        .to_string()
        .contains("unsupported or unsafe Kerminal protocol parameter"));
    assert!(!error
        .to_string()
        .contains("KERM_FIXTURE_PROTOCOL_PASSWORD_DO_NOT_USE"));
}

#[test]
fn mobaxterm_session_file_rejects_unsafe_and_oversized_paths() {
    let registry = ExternalLaunchParserRegistry::new();
    let unsafe_error = registry
        .parse(&ExternalLaunchParseInput::direct_argv(
            ExternalLaunchSourceTool::Mobaxterm,
            vec![
                "MobaXterm.exe".to_owned(),
                r"\\server\share\unsafe.moba".to_owned(),
            ],
        ))
        .expect_err("UNC session file must fail closed");
    assert!(unsafe_error.to_string().contains("UNC"));

    let temp = tempfile::tempdir().expect("tempdir");
    let oversized = temp.path().join("oversized.moba");
    std::fs::write(&oversized, vec![b'x'; 64 * 1024 + 1]).expect("write oversized fixture");
    let oversized_error = registry
        .parse(&ExternalLaunchParseInput::direct_argv(
            ExternalLaunchSourceTool::Mobaxterm,
            vec![
                "MobaXterm.exe".to_owned(),
                oversized.to_string_lossy().into_owned(),
            ],
        ))
        .expect_err("oversized session file must fail closed");
    assert!(oversized_error.to_string().contains("64 KiB"));
}

#[test]
fn kerminal_protocol_url_accepts_only_connection_preview_fields() {
    let request = ExternalLaunchParserRegistry::new()
        .parse(&ExternalLaunchParseInput::from_args(
            ExternalLaunchEntrypoint::Protocol,
            Some(ExternalLaunchSourceTool::KerminalNative),
            Some("kerminal-native".to_owned()),
            vec![
                "kerminal.exe".to_owned(),
                "kerminal://ssh?host=proto.internal&port=2201&user=proto&displayName=Production%20preview&openSftp=true".to_owned(),
            ],
        ))
        .expect("parse allowlisted Kerminal protocol URL");

    assert_eq!(
        request.source.tool,
        ExternalLaunchSourceTool::KerminalNative
    );
    assert_eq!(request.target.host, "proto.internal");
    assert_eq!(request.target.port, 2201);
    assert_eq!(request.target.username.as_deref(), Some("proto"));
    assert!(!request.auth.has_secret_material());
    assert!(request.auth.identity_file.is_none());
    assert!(request.options.open_sftp);
    assert_eq!(
        request.options.display_name.as_deref(),
        Some("Production preview")
    );
    assert_eq!(request.diagnostics.parser, "kerminal-native-protocol");
}

#[test]
fn parser_rejects_missing_destination() {
    let registry = ExternalLaunchParserRegistry::new();
    let error = registry
        .parse(&ExternalLaunchParseInput::direct_argv(
            ExternalLaunchSourceTool::Openssh,
            vec!["ssh".to_owned(), "-p".to_owned(), "22".to_owned()],
        ))
        .expect_err("missing destination should fail");

    assert!(error.to_string().contains("destination is required"));
}
