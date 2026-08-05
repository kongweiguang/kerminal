//! Tauri 安全配置与窗口/CSP/能力契约集成测试。
//!
//! @author kongweiguang

use serde_json::Value;
use std::{fs, path::PathBuf};

fn manifest_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn read_json(path: impl Into<PathBuf>) -> Value {
    let path = path.into();
    let content = fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("failed to read {}: {error}", path.display()));
    serde_json::from_str(&content)
        .unwrap_or_else(|error| panic!("failed to parse {}: {error}", path.display()))
}

fn read_text(path: impl Into<PathBuf>) -> String {
    let path = path.into();
    fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("failed to read {}: {error}", path.display()))
        .replace("\r\n", "\n")
}

#[test]
fn tauri_config_enables_strict_production_csp_and_dev_csp() {
    let config = read_json(manifest_dir().join("tauri.conf.json"));
    let security = &config["app"]["security"];

    let csp = security["csp"]
        .as_str()
        .expect("production CSP must be a string");
    assert!(csp.contains("default-src 'self'"));
    assert!(csp.contains("connect-src 'self' ipc: http://ipc.localhost"));
    assert!(csp.contains("object-src 'none'"));
    assert!(csp.contains("frame-ancestors 'none'"));
    assert!(!csp.contains("localhost:1425"));
    assert!(!csp.contains("ws://"));
    assert!(!csp.contains("'unsafe-eval'"));

    let dev_csp = security["devCsp"]
        .as_str()
        .expect("development CSP must be a string");
    assert!(dev_csp.contains("http://localhost:1425"));
    assert!(dev_csp.contains("ws://localhost:1425"));
    assert!(dev_csp.contains("http://127.0.0.1:1425"));
    assert!(dev_csp.contains("ws://127.0.0.1:1425"));
    assert!(dev_csp.contains("'unsafe-eval'"));

    // Keep this disabled until the WebView/xterm startup path is verified with
    // prototype freezing enabled. The production CSP still carries the primary
    // hardening guarantees checked above.
    assert_eq!(security["freezePrototype"], false);
    assert_eq!(security["capabilities"], serde_json::json!(["default"]));
}

#[test]
fn default_capability_grants_window_access_native_plugin_and_updater_permissions_to_main_window() {
    let capability = read_json(manifest_dir().join("capabilities/default.json"));

    assert_eq!(capability["identifier"], "default");
    assert_eq!(capability["windows"], serde_json::json!(["main"]));
    assert_eq!(
        capability["permissions"],
        serde_json::json!([
            "core:default",
            "dialog:default",
            {
                "identifier": "opener:allow-open-url",
                "allow": [
                    {
                        "url": "https://github.com/kongweiguang/kerminal"
                    }
                ]
            },
            "notification:default",
            "log:default",
            "clipboard-manager:allow-read-text",
            "clipboard-manager:allow-write-text",
            "process:default",
            "updater:default",
            "core:window:allow-start-dragging",
            "core:window:allow-minimize",
            "core:window:allow-toggle-maximize",
            "core:window:allow-close"
        ])
    );

    let permissions = capability["permissions"]
        .as_array()
        .expect("permissions must be an array");
    let forbidden_prefixes = ["fs:", "shell:", "http:"];
    for permission_value in permissions {
        let Some(permission) = permission_value.as_str() else {
            assert_eq!(permission_value["identifier"], "opener:allow-open-url");
            assert_eq!(
                permission_value["allow"],
                serde_json::json!([{ "url": "https://github.com/kongweiguang/kerminal" }])
            );
            continue;
        };
        if permission.starts_with("dialog:") {
            assert_eq!(
                permission, "dialog:default",
                "dialog permission must stay limited to the default scope"
            );
        }
        assert!(
            !forbidden_prefixes
                .iter()
                .any(|prefix| permission.starts_with(prefix)),
            "unexpected high-risk permission in default capability: {permission}",
        );
    }
}

#[test]
fn main_window_uses_app_drawn_titlebar_with_file_drop_events_for_sftp() {
    let config = read_json(manifest_dir().join("tauri.conf.json"));
    let windows = config["app"]["windows"]
        .as_array()
        .expect("windows must be an array");
    let main_window = windows.first().expect("main window must be configured");

    assert_eq!(config["version"], env!("CARGO_PKG_VERSION"));
    assert_eq!(main_window["title"], "Kerminal");
    assert_eq!(main_window["width"], 1600);
    assert_eq!(main_window["height"], 960);
    assert_eq!(main_window["minWidth"], 1180);
    assert_eq!(main_window["minHeight"], 720);
    assert_eq!(main_window["decorations"], false);
    assert_eq!(main_window["transparent"], true);
    assert_eq!(main_window["dragDropEnabled"], true);
    assert_eq!(main_window["visible"], false);
}

#[test]
fn macos_window_override_is_complete_and_uses_native_titlebar_chrome() {
    let config = read_json(manifest_dir().join("tauri.macos.conf.json"));
    let windows = config["app"]["windows"]
        .as_array()
        .expect("macOS windows must be an array");

    assert_eq!(
        windows.len(),
        1,
        "macOS must configure exactly one main window"
    );
    assert_eq!(
        windows[0],
        serde_json::json!({
            "label": "main",
            "title": "Kerminal",
            "width": 1600,
            "height": 960,
            "minWidth": 1180,
            "minHeight": 720,
            "resizable": true,
            "decorations": true,
            "transparent": false,
            "dragDropEnabled": true,
            "visible": false,
            "titleBarStyle": "Overlay",
            "hiddenTitle": true,
            "acceptFirstMouse": true
        })
    );
    assert!(
        config.get("bundle").is_none() && config.get("plugins").is_none(),
        "macOS window override must not introduce signing, notarization, or updater changes"
    );
    assert_eq!(
        windows[0]["acceptFirstMouse"],
        serde_json::json!(true),
        "macOS main window must accept the first mouse click so modal close/cancel buttons respond when the WebView is otherwise inactive"
    );
}

#[test]
fn configured_bundle_icons_exist() {
    let manifest = manifest_dir();
    let config = read_json(manifest.join("tauri.conf.json"));
    let icons = config["bundle"]["icon"]
        .as_array()
        .expect("bundle icons must be an array");

    assert!(
        !icons.is_empty(),
        "at least one bundle icon must be configured"
    );
    assert!(
        icons.iter().any(|icon| icon == "icons/icon.ico"),
        "Windows taskbar/app executable icon must be configured"
    );
    for icon in icons {
        let icon = icon
            .as_str()
            .expect("bundle icon entries must be string paths");
        let path = manifest.join(icon);
        assert!(path.exists(), "configured bundle icon must exist: {icon}");
        assert!(
            fs::metadata(&path)
                .unwrap_or_else(|error| panic!("failed to stat {}: {error}", path.display()))
                .len()
                > 0,
            "configured bundle icon must not be empty: {icon}",
        );
    }
}

#[test]
fn opener_plugin_is_registered_with_limited_github_scope() {
    let manifest = manifest_dir();
    let cargo_toml = read_text(manifest.join("Cargo.toml"));
    let lib_rs = read_text(manifest.join("src/lib.rs"));
    let desktop_plugins_rs = read_text(manifest.join("src/desktop_plugins.rs"));
    let package_json = read_text(manifest.join("../package.json"));

    assert!(cargo_toml.contains("tauri-plugin-opener"));
    assert!(lib_rs.contains("desktop_plugins::apply_desktop_plugins(builder, desktop_log_dir)"));
    assert!(desktop_plugins_rs.contains("tauri_plugin_opener::init()"));
    assert!(package_json.contains("@tauri-apps/plugin-opener"));
}

#[test]
fn desktop_plugins_are_registered_with_minimal_frontend_permissions() {
    let manifest = manifest_dir();
    let cargo_toml = read_text(manifest.join("Cargo.toml"));
    let app_tray_rs = read_text(manifest.join("src/app_tray.rs"));
    let lib_rs = read_text(manifest.join("src/lib.rs"));
    let desktop_plugins_rs = read_text(manifest.join("src/desktop_plugins.rs"));
    let package_json = read_text(manifest.join("../package.json"));
    let capability = read_json(manifest.join("capabilities/default.json"));

    for crate_name in [
        "tauri-plugin-clipboard-manager",
        "tauri-plugin-window-state",
        "tauri-plugin-single-instance",
        "tauri-plugin-notification",
        "tauri-plugin-log",
    ] {
        assert!(
            cargo_toml.contains(crate_name),
            "Cargo.toml must include {crate_name}"
        );
    }

    for package_name in [
        "@tauri-apps/plugin-clipboard-manager",
        "@tauri-apps/plugin-window-state",
        "@tauri-apps/plugin-notification",
        "@tauri-apps/plugin-log",
    ] {
        assert!(
            package_json.contains(package_name),
            "package.json must include {package_name}"
        );
    }
    assert!(
        !package_json.contains("@tauri-apps/plugin-single-instance"),
        "single-instance is Rust-only and must not add a frontend package"
    );

    assert!(lib_rs.contains("mod desktop_plugins;"));
    assert!(lib_rs.contains("desktop_plugins::apply_desktop_plugins(builder, desktop_log_dir)"));
    assert!(lib_rs.contains("KerminalPaths::from_environment_or_current_home()"));
    assert!(desktop_plugins_rs.contains("app_tray::show_main_window(app)"));
    assert!(
        lib_rs.contains("app.manage(app_state)"),
        "AppState must be managed inside setup after single-instance has run"
    );
    assert!(
        !lib_rs.contains(".manage(app_state)\n        .setup"),
        "builder-level AppState management runs before single-instance can stop a second process"
    );

    let desktop_plugins_position = lib_rs
        .find("desktop_plugins::apply_desktop_plugins(builder, desktop_log_dir)")
        .expect("desktop plugins must be applied");
    let app_state_initialize_position = lib_rs
        .find("AppState::initialize()")
        .expect("AppState must still be initialized");
    assert!(
        desktop_plugins_position < app_state_initialize_position,
        "single-instance plugin registration must happen before AppState initialization"
    );

    let single_instance_position = desktop_plugins_rs
        .find("tauri_plugin_single_instance::init")
        .expect("single-instance plugin must be registered");
    let log_position = desktop_plugins_rs
        .find("build_log_plugin(log_dir)")
        .expect("log plugin must be registered");
    let window_state_position = desktop_plugins_rs
        .find("build_window_state_plugin()")
        .expect("window-state plugin must be registered");
    let notification_position = desktop_plugins_rs
        .find("tauri_plugin_notification::init()")
        .expect("notification plugin must be registered");
    let clipboard_position = desktop_plugins_rs
        .find("tauri_plugin_clipboard_manager::init()")
        .expect("clipboard-manager plugin must be registered");
    let opener_position = desktop_plugins_rs
        .find("tauri_plugin_opener::init()")
        .expect("opener plugin must be registered");

    assert!(
        single_instance_position < log_position,
        "single-instance must be registered before log"
    );
    assert!(
        log_position < window_state_position,
        "log must be registered before window-state"
    );
    assert!(
        window_state_position < notification_position,
        "window-state must be registered before notification"
    );
    assert!(
        notification_position < clipboard_position,
        "notification must be registered before clipboard-manager"
    );
    assert!(
        clipboard_position < opener_position,
        "clipboard-manager must be registered before opener"
    );

    let permissions = capability["permissions"]
        .as_array()
        .expect("permissions must be an array");
    assert!(
        permissions
            .iter()
            .any(|permission| permission == "notification:default"),
        "notification frontend permission must be explicit"
    );
    assert!(
        permissions
            .iter()
            .any(|permission| permission == "log:default"),
        "WebView logs must use the explicit log frontend permission"
    );
    assert!(
        permissions
            .iter()
            .any(|permission| permission == "clipboard-manager:allow-read-text"),
        "clipboard-manager must only expose explicit text read permission"
    );
    assert!(
        permissions
            .iter()
            .any(|permission| permission == "clipboard-manager:allow-write-text"),
        "clipboard-manager must only expose explicit text write permission"
    );
    for forbidden_permission in [
        "clipboard-manager:default",
        "clipboard-manager:allow-read-image",
        "clipboard-manager:allow-write-image",
        "clipboard-manager:allow-write-html",
        "clipboard-manager:allow-clear",
    ] {
        assert!(
            !permissions
                .iter()
                .any(|permission| permission == forbidden_permission),
            "clipboard-manager must not expose broad or non-text permission: {forbidden_permission}"
        );
    }
    assert!(
        !permissions.iter().any(|permission| {
            permission
                .as_str()
                .is_some_and(|value| value.starts_with("window-state:"))
        }),
        "window-state is Rust-managed in this slice and must not expose frontend permission"
    );
    assert!(
        !permissions.iter().any(|permission| {
            permission
                .as_str()
                .is_some_and(|value| value.starts_with("single-instance:"))
        }),
        "single-instance is Rust-only and must not expose frontend permission"
    );

    assert!(
        desktop_plugins_rs
            .contains("RotationStrategy::KeepSome(\n            APP_LOG_ROTATION_KEEP_FILES")
            || desktop_plugins_rs
                .contains("RotationStrategy::KeepSome(APP_LOG_ROTATION_KEEP_FILES"),
        "log plugin must keep a bounded number of rotated files"
    );
    assert!(
        desktop_plugins_rs.contains(".max_file_size(APP_LOG_MAX_FILE_SIZE_BYTES.into())"),
        "log plugin must cap each log file size"
    );
    assert!(
        desktop_plugins_rs.contains("TargetKind::Folder"),
        "log plugin must write to the Kerminal-managed log directory"
    );
    assert!(
        desktop_plugins_rs.contains("path: log_dir"),
        "log plugin must receive the resolved Kerminal log directory"
    );
    assert!(
        desktop_plugins_rs.contains("file_name: Some(APP_LOG_FILE_STEM.into())"),
        "log plugin must use a stable Kerminal log file prefix"
    );
    for source in [&desktop_plugins_rs, &app_tray_rs, &lib_rs] {
        assert!(
            source.contains("target: \"desktop.lifecycle\"")
                || source.contains("target: \"desktop.window\""),
            "desktop lifecycle/window changes must use structured log targets"
        );
    }
    assert!(
        desktop_plugins_rs.contains("single-instance activation requested; focusing main window"),
        "single-instance callback must log a sanitized lifecycle event"
    );
    assert!(
        !desktop_plugins_rs.contains("target: \"desktop.lifecycle\",\n                _args")
            && !desktop_plugins_rs.contains("target: \"desktop.lifecycle\",\n                _cwd"),
        "single-instance logging must not include raw args or cwd"
    );
    assert!(
        !desktop_plugins_rs.contains("{_args") && !desktop_plugins_rs.contains("{_cwd"),
        "single-instance logging must not interpolate raw args or cwd"
    );
    assert!(
        lib_rs.contains("config watcher failed to start")
            && !lib_rs.contains("target: \"desktop.lifecycle\",\n                \"config watcher failed to start: {error}\""),
        "config watcher logs must avoid full path-bearing error details"
    );
    assert!(
        desktop_plugins_rs
            .contains("StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED"),
        "window-state must only persist size, position and maximized state"
    );
    for forbidden_flag in [
        "StateFlags::VISIBLE",
        "StateFlags::FULLSCREEN",
        "StateFlags::DECORATIONS",
    ] {
        assert!(
            !desktop_plugins_rs.contains(forbidden_flag),
            "window-state must not persist {forbidden_flag}"
        );
    }

    let terminal_commands_rs = read_text(manifest.join("src/commands/terminal.rs"));
    let command_registry_rs = read_text(manifest.join("src/commands/registry.rs"));
    assert!(
        !terminal_commands_rs.contains("terminal_read_clipboard_text")
            && !command_registry_rs.contains("terminal_read_clipboard_text"),
        "terminal text clipboard reads must use clipboard-manager instead of a Windows-only command"
    );
}
