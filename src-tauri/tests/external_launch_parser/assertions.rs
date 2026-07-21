// @author kongweiguang

fn write_temp_moba_session_file() -> std::path::PathBuf {
    let path = std::env::temp_dir().join(format!(
        "kerminal-mobaxterm-{}-{}.moba",
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

fn fixture_parse_input(
    case: &Value,
    source_tool: ExternalLaunchSourceTool,
    argv: Vec<String>,
) -> ExternalLaunchParseInput {
    let entrypoint = match case.get("entrypoint").and_then(Value::as_str) {
        Some("protocol") => ExternalLaunchEntrypoint::Protocol,
        Some("session-file") => ExternalLaunchEntrypoint::SessionFile,
        Some("single-instance") => ExternalLaunchEntrypoint::SingleInstance,
        _ => ExternalLaunchEntrypoint::DirectArgv,
    };
    ExternalLaunchParseInput::from_args(
        entrypoint,
        Some(source_tool),
        Some(source_tool.as_str().to_owned()),
        argv,
    )
}

fn assert_expected_target(
    id: &str,
    request: &ExternalSshLaunchRequest,
    expected: &serde_json::Map<String, Value>,
) {
    let target = required_object_map(expected, "target", id);
    assert_eq!(request.target.host, required_text_map(target, "host", id));
    assert_eq!(
        u64::from(request.target.port),
        required_u64_map(target, "port", id)
    );
    let expected_username = target.get("username").and_then(Value::as_str);
    assert_eq!(
        request.target.username.as_deref(),
        expected_username,
        "{id}: username"
    );
}

fn assert_expected_auth(
    id: &str,
    request: &ExternalSshLaunchRequest,
    expected: &serde_json::Map<String, Value>,
) {
    let auth = required_object_map(expected, "auth", id);
    let expect_password = auth
        .get("passwordRef")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    assert_eq!(
        request.auth.has_password(),
        expect_password,
        "{id}: password"
    );
    let expected_identity = auth.get("identityFile").and_then(Value::as_str);
    assert_eq!(
        request.auth.identity_file.as_deref(),
        expected_identity,
        "{id}: identity file"
    );
}

fn assert_expected_options(
    id: &str,
    request: &ExternalSshLaunchRequest,
    expected: &serde_json::Map<String, Value>,
) {
    let options = required_object_map(expected, "options", id);
    let expected_display_name = options.get("displayName").and_then(Value::as_str);
    assert_eq!(
        request.options.display_name.as_deref(),
        expected_display_name,
        "{id}: display name"
    );
    let expected_remote_command = options.get("remoteCommand").and_then(Value::as_str);
    assert_eq!(
        request.options.remote_command.as_deref(),
        expected_remote_command,
        "{id}: remote command"
    );
    let expected_open_sftp = options
        .get("openSftp")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    assert_eq!(
        request.options.open_sftp, expected_open_sftp,
        "{id}: open SFTP"
    );
}

fn assert_expected_intent(
    id: &str,
    request: &ExternalSshLaunchRequest,
    expected: &serde_json::Map<String, Value>,
) {
    let Some(intent) = expected.get("intent").and_then(Value::as_object) else {
        return;
    };
    match required_text_map(intent, "kind", id) {
        "sftpTransfer" => match &request.intent {
            kerminal_lib::services::external_launch::ExternalLaunchIntent::SftpTransfer {
                remote_path,
                selected_entry,
                ..
            } => {
                assert_eq!(
                    remote_path.as_deref(),
                    intent.get("remotePath").and_then(Value::as_str),
                    "{id}: remote path"
                );
                assert_eq!(
                    selected_entry.as_deref(),
                    intent.get("selectedEntry").and_then(Value::as_str),
                    "{id}: selected entry"
                );
            }
            other => panic!("{id}: expected SFTP transfer intent, got {other:?}"),
        },
        other => panic!("{id}: unsupported fixture intent: {other}"),
    }
}

fn assert_expected_diagnostics(
    id: &str,
    request: &ExternalSshLaunchRequest,
    expected: &serde_json::Map<String, Value>,
) {
    let diagnostics = required_object_map(expected, "diagnostics", id);
    let expected_redacted = required_array_map(diagnostics, "redactedArgv", id)
        .iter()
        .map(|value| value.as_str().expect("redacted argv string").to_owned())
        .collect::<Vec<_>>();
    assert_eq!(
        request.diagnostics.argv_redacted, expected_redacted,
        "{id}: redacted argv"
    );
    assert_eq!(request.diagnostics.raw_hash.len(), 64, "{id}: raw hash");
}

fn assert_debug_redacted(
    id: &str,
    request: &ExternalSshLaunchRequest,
    expected: &serde_json::Map<String, Value>,
) {
    let diagnostics = required_object_map(expected, "diagnostics", id);
    let debug = format!("{request:?}");
    for forbidden in required_array_map(diagnostics, "redactedNotContains", id) {
        let forbidden = forbidden.as_str().expect("forbidden string");
        assert!(
            !debug.contains(forbidden),
            "{id}: debug output leaked forbidden value"
        );
    }
}

fn fixture_cases() -> Vec<Value> {
    CASES_JSON
        .iter()
        .flat_map(|source| {
            let root: Value = serde_json::from_str(source).expect("parse external launch fixtures");
            root.as_array()
                .expect("fixture root must be an array")
                .to_vec()
        })
        .collect()
}

fn required_text<'a>(value: &'a Value, key: &str) -> &'a str {
    value
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or_else(|| panic!("{key} must be a string"))
}

fn required_array_value<'a>(value: &'a Value, key: &str) -> &'a Vec<Value> {
    value
        .get(key)
        .and_then(Value::as_array)
        .unwrap_or_else(|| panic!("{key} must be an array"))
}

fn required_object<'a>(value: &'a Value, key: &str) -> &'a serde_json::Map<String, Value> {
    value
        .get(key)
        .and_then(Value::as_object)
        .unwrap_or_else(|| panic!("{key} must be an object"))
}

fn required_object_map<'a>(
    value: &'a serde_json::Map<String, Value>,
    key: &str,
    id: &str,
) -> &'a serde_json::Map<String, Value> {
    value
        .get(key)
        .and_then(Value::as_object)
        .unwrap_or_else(|| panic!("{id}: {key} must be an object"))
}

fn required_text_map<'a>(
    value: &'a serde_json::Map<String, Value>,
    key: &str,
    id: &str,
) -> &'a str {
    value
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or_else(|| panic!("{id}: {key} must be a string"))
}

fn required_u64_map(value: &serde_json::Map<String, Value>, key: &str, id: &str) -> u64 {
    value
        .get(key)
        .and_then(Value::as_u64)
        .unwrap_or_else(|| panic!("{id}: {key} must be an unsigned integer"))
}

fn required_array_map<'a>(
    value: &'a serde_json::Map<String, Value>,
    key: &str,
    id: &str,
) -> &'a Vec<Value> {
    value
        .get(key)
        .and_then(Value::as_array)
        .unwrap_or_else(|| panic!("{id}: {key} must be an array"))
}
