//! 应用设置服务集成测试。
//!
//! @author kongweiguang

use kerminal_lib::{
    error::AppError,
    models::settings::{
        AppSettings, BackgroundImageFit, ExternalLaunchToolSetting, InterfaceDensity,
        InterfaceLanguage, TerminalColorScheme, TerminalCommandSuggestionPresentation,
        TerminalCommandSuggestionRemoteRefresh, TerminalCursorStyle, TerminalFontWeight,
        TerminalInlineSuggestionAcceptKey, TerminalInlineSuggestionProductionHostPolicy,
        TerminalRendererType, TerminalRightClickBehavior, ThemeMode, MAX_SFTP_GLOBAL_TRANSFERS,
        MAX_SFTP_HOST_TRANSFERS, MAX_SFTP_PACKET_BYTES, MAX_SFTP_PIPELINE_DEPTH,
        MAX_SFTP_TIMEOUT_SECONDS, MIN_SFTP_GLOBAL_TRANSFERS, MIN_SFTP_HOST_TRANSFERS,
        MIN_SFTP_PACKET_BYTES, MIN_SFTP_PIPELINE_DEPTH, MIN_SFTP_TIMEOUT_SECONDS,
    },
    paths::KerminalPaths,
    state::AppState,
};
use tempfile::tempdir;

#[test]
fn settings_service_returns_defaults_before_user_changes() {
    let home = tempdir().expect("create temp home");
    let state = AppState::initialize_with_paths(KerminalPaths::from_home_dir(home.path()))
        .expect("initialize app state");

    let settings = state
        .settings()
        .load_settings()
        .expect("load default settings");

    assert_eq!(settings.interface_density, InterfaceDensity::Compact);
    assert_eq!(settings, AppSettings::default());
}

#[test]
fn settings_service_persists_settings_in_toml() {
    let home = tempdir().expect("create temp home");
    let paths = KerminalPaths::from_home_dir(home.path());

    {
        let state = AppState::initialize_with_paths(paths.clone()).expect("initialize app state");
        let mut settings = AppSettings {
            interface_density: InterfaceDensity::Spacious,
            theme_mode: ThemeMode::Light,
            ..AppSettings::default()
        };
        settings.appearance.interface_language = InterfaceLanguage::EnUs;
        settings.appearance.background_enabled = true;
        settings.appearance.background_fit = BackgroundImageFit::Tile;
        settings.appearance.background_image_path =
            " C:\\Users\\dev\\Pictures\\bg.png ".to_string();
        settings.appearance.background_opacity = 72;
        settings.appearance.window_opacity = 68;
        settings.terminal.auto_reconnect = false;
        settings.terminal.color_scheme = TerminalColorScheme::TokyoNight;
        settings.terminal.cursor_style = TerminalCursorStyle::Bar;
        settings.terminal.dark_color_scheme = TerminalColorScheme::TokyoNight;
        settings.terminal.font_size = 16;
        settings.terminal.font_weight = TerminalFontWeight::Medium;
        settings.terminal.light_color_scheme = TerminalColorScheme::Github;
        settings.terminal.line_height = 1.5;
        settings.terminal.mac_option_is_meta = true;
        settings.terminal.renderer_type = TerminalRendererType::Gpu;
        settings.terminal.right_click_behavior = TerminalRightClickBehavior::Paste;
        settings.terminal.selection_copy = true;
        settings.terminal.show_tab_numbers = true;
        settings.terminal.confirm_close_tab = false;
        settings.terminal.inline_suggestion.enabled = false;
        settings.terminal.inline_suggestion.presentation =
            TerminalCommandSuggestionPresentation::Inline;
        settings.terminal.inline_suggestion.accept_key =
            TerminalInlineSuggestionAcceptKey::Disabled;
        settings.terminal.inline_suggestion.tab_opens_menu = true;
        settings.terminal.inline_suggestion.partial_accept = false;
        settings.terminal.inline_suggestion.remote_probe_enabled = false;
        settings.terminal.inline_suggestion.remote_refresh =
            TerminalCommandSuggestionRemoteRefresh::Off;
        settings.terminal.inline_suggestion.production_host_policy =
            TerminalInlineSuggestionProductionHostPolicy::Normal;
        settings.terminal.inline_suggestion.audit_retention_days = 14;
        settings.terminal.inline_suggestion.feedback_retention_days = 730;
        settings.terminal.inline_suggestion.providers.remote_path = false;
        settings.terminal.inline_suggestion.providers.remote_command = false;
        settings.terminal.inline_suggestion.providers.git = false;
        settings.terminal.inline_suggestion.providers.spec = false;
        settings.terminal.scrollback = 12_000;
        settings.sftp.global_transfers = 8;
        settings.sftp.host_transfers = 3;
        settings.sftp.pipeline_depth = 96;
        settings.sftp.packet_bytes = 256 * 1024;
        settings.sftp.timeout_seconds = 45;
        settings.desktop_notifications.enabled = true;
        settings.desktop_notifications.background_only = false;
        settings.desktop_notifications.important_only = true;
        settings.desktop_notifications.min_duration_ms = 25_000;
        settings.desktop_notifications.throttle_ms = 60_000;
        settings.external_launch.accept_vendor_args = false;
        settings.external_launch.auto_open_sftp = true;
        settings.external_launch.disabled_tools = vec![
            ExternalLaunchToolSetting::Putty,
            ExternalLaunchToolSetting::Putty,
            ExternalLaunchToolSetting::KerminalNative,
        ];

        let stored = state
            .settings()
            .update_settings(settings)
            .expect("save settings");

        assert_eq!(stored.theme_mode, ThemeMode::Light);
        assert_eq!(stored.interface_density, InterfaceDensity::Spacious);
        assert_eq!(
            stored.appearance.interface_language,
            InterfaceLanguage::EnUs
        );
        assert_eq!(stored.appearance.background_fit, BackgroundImageFit::Tile);
        assert_eq!(
            stored.appearance.background_image_path,
            "C:\\Users\\dev\\Pictures\\bg.png"
        );
        assert_eq!(stored.appearance.background_opacity, 72);
        assert_eq!(stored.appearance.window_opacity, 68);
        assert_eq!(
            stored.terminal.color_scheme,
            TerminalColorScheme::TokyoNight
        );
        assert_eq!(stored.terminal.font_size, 16);
        assert!(stored.desktop_notifications.enabled);
        assert!(!stored.desktop_notifications.background_only);
        assert!(stored.desktop_notifications.important_only);
        assert_eq!(stored.desktop_notifications.min_duration_ms, 25_000);
        assert_eq!(stored.desktop_notifications.throttle_ms, 60_000);
        assert!(!stored.external_launch.accept_vendor_args);
        assert!(stored.external_launch.auto_open_sftp);
        assert_eq!(
            stored.external_launch.disabled_tools,
            vec![
                ExternalLaunchToolSetting::Putty,
                ExternalLaunchToolSetting::KerminalNative,
            ]
        );
    }

    let state = AppState::initialize_with_paths(paths.clone()).expect("reopen app state");
    let settings = state.settings().load_settings().expect("reload settings");

    assert_eq!(settings.theme_mode, ThemeMode::Light);
    assert_eq!(settings.interface_density, InterfaceDensity::Spacious);
    assert_eq!(
        settings.appearance.interface_language,
        InterfaceLanguage::EnUs
    );
    assert!(settings.appearance.background_enabled);
    assert_eq!(settings.appearance.background_fit, BackgroundImageFit::Tile);
    assert_eq!(
        settings.appearance.background_image_path,
        "C:\\Users\\dev\\Pictures\\bg.png"
    );
    assert_eq!(settings.appearance.background_opacity, 72);
    assert_eq!(settings.appearance.window_opacity, 68);
    assert!(!settings.terminal.auto_reconnect);
    assert_eq!(
        settings.terminal.color_scheme,
        TerminalColorScheme::TokyoNight
    );
    assert_eq!(settings.terminal.cursor_style, TerminalCursorStyle::Bar);
    assert_eq!(
        settings.terminal.dark_color_scheme,
        TerminalColorScheme::TokyoNight
    );
    assert_eq!(
        settings.terminal.light_color_scheme,
        TerminalColorScheme::Github
    );
    assert_eq!(settings.terminal.font_size, 16);
    assert_eq!(settings.terminal.font_weight, TerminalFontWeight::Medium);
    assert_eq!(settings.terminal.line_height, 1.5);
    assert!(settings.terminal.mac_option_is_meta);
    assert_eq!(settings.terminal.renderer_type, TerminalRendererType::Gpu);
    assert_eq!(
        settings.terminal.right_click_behavior,
        TerminalRightClickBehavior::Paste
    );
    assert!(settings.terminal.selection_copy);
    assert!(settings.terminal.show_tab_numbers);
    assert!(!settings.terminal.confirm_close_tab);
    assert!(!settings.terminal.inline_suggestion.enabled);
    assert_eq!(
        settings.terminal.inline_suggestion.presentation,
        TerminalCommandSuggestionPresentation::Off
    );
    assert_eq!(
        settings.terminal.inline_suggestion.accept_key,
        TerminalInlineSuggestionAcceptKey::Disabled
    );
    assert!(!settings.terminal.inline_suggestion.remote_probe_enabled);
    assert_eq!(
        settings.terminal.inline_suggestion.remote_refresh,
        TerminalCommandSuggestionRemoteRefresh::Off
    );
    assert!(settings.terminal.inline_suggestion.tab_opens_menu);
    assert!(!settings.terminal.inline_suggestion.partial_accept);
    assert_eq!(
        settings.terminal.inline_suggestion.production_host_policy,
        TerminalInlineSuggestionProductionHostPolicy::Normal
    );
    assert_eq!(settings.terminal.inline_suggestion.audit_retention_days, 14);
    assert_eq!(
        settings.terminal.inline_suggestion.feedback_retention_days,
        730
    );
    assert!(!settings.terminal.inline_suggestion.providers.remote_path);
    assert!(!settings.terminal.inline_suggestion.providers.remote_command);
    assert!(!settings.terminal.inline_suggestion.providers.git);
    assert!(!settings.terminal.inline_suggestion.providers.spec);
    assert_eq!(settings.terminal.scrollback, 12_000);
    assert_eq!(settings.sftp.global_transfers, 8);
    assert_eq!(settings.sftp.host_transfers, 3);
    assert_eq!(settings.sftp.pipeline_depth, 96);
    assert_eq!(settings.sftp.packet_bytes, 256 * 1024);
    assert_eq!(settings.sftp.timeout_seconds, 45);
    assert!(settings.desktop_notifications.enabled);
    assert!(!settings.desktop_notifications.background_only);
    assert!(settings.desktop_notifications.important_only);
    assert_eq!(settings.desktop_notifications.min_duration_ms, 25_000);
    assert_eq!(settings.desktop_notifications.throttle_ms, 60_000);
    assert!(!settings.external_launch.accept_vendor_args);
    assert!(settings.external_launch.auto_open_sftp);
    assert_eq!(
        settings.external_launch.disabled_tools,
        vec![
            ExternalLaunchToolSetting::Putty,
            ExternalLaunchToolSetting::KerminalNative,
        ]
    );
    let settings_source =
        std::fs::read_to_string(paths.root.join("settings.toml")).expect("settings toml");
    assert!(settings_source.contains("schema_version = 1"));
    assert!(settings_source.contains("themeMode = \"light\""));
    assert!(settings_source.contains("rendererType = \"gpu\""));
    assert!(settings_source.contains("[desktopNotifications]"));
    assert!(settings_source.contains("enabled = true"));
    assert!(settings_source.contains("[externalLaunch]"));
    assert!(settings_source.contains("acceptVendorArgs = false"));
    assert!(settings_source.contains("autoOpenSftp = true"));
    let settings_toml: toml::Value = toml::from_str(&settings_source).expect("settings toml value");
    let disabled_tools = settings_toml
        .get("externalLaunch")
        .and_then(|section| section.get("disabledTools"))
        .and_then(|tools| tools.as_array())
        .expect("external launch disabled tools");
    assert_eq!(
        disabled_tools
            .iter()
            .filter_map(|tool| tool.as_str())
            .collect::<Vec<_>>(),
        vec!["putty", "kerminal-native"]
    );
    assert!(!settings_source.contains("shimBridge"));
}

#[test]
fn settings_service_migrates_legacy_command_suggestion_switches() {
    let home = tempdir().expect("create temp home");
    let paths = KerminalPaths::from_home_dir(home.path());

    {
        AppState::initialize_with_paths(paths.clone()).expect("initialize app state");
    }

    let settings_path = paths.root.join("settings.toml");
    let source = std::fs::read_to_string(&settings_path).expect("read generated settings toml");
    let mut document: toml::Value = toml::from_str(&source).expect("parse generated settings toml");
    let inline_suggestion = document
        .get_mut("terminal")
        .and_then(|terminal| terminal.get_mut("inlineSuggestion"))
        .and_then(toml::Value::as_table_mut)
        .expect("terminal inline suggestion table");
    inline_suggestion.insert("enabled".to_string(), toml::Value::Boolean(false));
    inline_suggestion.insert(
        "remoteProbeEnabled".to_string(),
        toml::Value::Boolean(false),
    );
    for key in [
        "presentation",
        "menuShortcut",
        "tabOpensMenu",
        "partialAccept",
        "remoteRefresh",
    ] {
        inline_suggestion.remove(key);
    }
    std::fs::write(
        &settings_path,
        toml::to_string_pretty(&document).expect("serialize legacy settings toml"),
    )
    .expect("write legacy settings toml");

    let state = AppState::initialize_with_paths(paths).expect("reopen legacy app state");
    let settings = state
        .settings()
        .load_settings()
        .expect("load migrated legacy settings");

    assert!(!settings.terminal.inline_suggestion.enabled);
    assert_eq!(
        settings.terminal.inline_suggestion.presentation,
        TerminalCommandSuggestionPresentation::Off
    );
    assert!(!settings.terminal.inline_suggestion.remote_probe_enabled);
    assert_eq!(
        settings.terminal.inline_suggestion.remote_refresh,
        TerminalCommandSuggestionRemoteRefresh::Off
    );
    assert!(!settings.terminal.inline_suggestion.tab_opens_menu);
    assert!(settings.terminal.inline_suggestion.partial_accept);
}

#[test]
fn app_state_syncs_external_launch_policy_from_settings() {
    let home = tempdir().expect("create temp home");
    let paths = KerminalPaths::from_home_dir(home.path());

    {
        let state = AppState::initialize_with_paths(paths.clone()).expect("initialize app state");
        let mut settings = AppSettings::default();
        settings.external_launch.enabled = false;
        settings.external_launch.accept_vendor_args = false;
        settings.external_launch.auto_open_sftp = true;
        settings.external_launch.disabled_tools = vec![ExternalLaunchToolSetting::Putty];

        state
            .update_settings(settings)
            .expect("update app settings and runtime policy");

        let policy = state
            .external_launch_intake()
            .policy_snapshot()
            .expect("external launch policy");
        assert!(!policy.enabled);
        assert!(!policy.accept_vendor_args);
        assert!(policy.auto_open_sftp);
        assert_eq!(
            serde_json::to_value(&policy.disabled_tools).expect("disabled tools"),
            serde_json::json!(["putty"])
        );
    }

    let state = AppState::initialize_with_paths(paths).expect("reopen app state");
    let policy = state
        .external_launch_intake()
        .policy_snapshot()
        .expect("reloaded external launch policy");
    assert!(!policy.enabled);
    assert!(!policy.accept_vendor_args);
    assert!(policy.auto_open_sftp);
    assert_eq!(
        serde_json::to_value(&policy.disabled_tools).expect("disabled tools"),
        serde_json::json!(["putty"])
    );
}

#[test]
fn settings_service_rejects_invalid_terminal_appearance() {
    let home = tempdir().expect("create temp home");
    let state = AppState::initialize_with_paths(KerminalPaths::from_home_dir(home.path()))
        .expect("initialize app state");
    let mut settings = AppSettings::default();
    settings.terminal.font_size = 4;

    let error = state
        .settings()
        .update_settings(settings)
        .expect_err("reject invalid font size");

    assert!(matches!(error, AppError::InvalidInput(message) if message.contains("字号")));
}

#[test]
fn settings_service_uses_toml_without_legacy_sqlite_table() {
    let home = tempdir().expect("create temp home");
    let paths = KerminalPaths::from_home_dir(home.path());

    {
        AppState::initialize_with_paths(paths.clone()).expect("initialize app state");
    }

    assert!(!paths.root.join("kerminal.db").exists());

    let state = AppState::initialize_with_paths(paths.clone()).expect("reopen app state");
    let settings = state
        .settings()
        .load_settings()
        .expect("load settings from TOML");

    assert_eq!(settings, AppSettings::default());
    assert!(paths.root.join("settings.toml").is_file());
}

#[test]
fn settings_service_clamps_sftp_performance_settings() {
    let home = tempdir().expect("create temp home");
    let state = AppState::initialize_with_paths(KerminalPaths::from_home_dir(home.path()))
        .expect("initialize app state");

    let mut too_small = AppSettings::default();
    too_small.sftp.global_transfers = 0;
    too_small.sftp.host_transfers = 0;
    too_small.sftp.pipeline_depth = 0;
    too_small.sftp.packet_bytes = 1;
    too_small.sftp.timeout_seconds = 1;
    let stored = state
        .settings()
        .update_settings(too_small)
        .expect("save too small sftp settings");
    assert_eq!(stored.sftp.global_transfers, MIN_SFTP_GLOBAL_TRANSFERS);
    assert_eq!(stored.sftp.host_transfers, MIN_SFTP_HOST_TRANSFERS);
    assert_eq!(stored.sftp.pipeline_depth, MIN_SFTP_PIPELINE_DEPTH);
    assert_eq!(stored.sftp.packet_bytes, MIN_SFTP_PACKET_BYTES);
    assert_eq!(stored.sftp.timeout_seconds, MIN_SFTP_TIMEOUT_SECONDS);

    let mut too_large = AppSettings::default();
    too_large.sftp.global_transfers = usize::MAX;
    too_large.sftp.host_transfers = usize::MAX;
    too_large.sftp.pipeline_depth = usize::MAX;
    too_large.sftp.packet_bytes = u32::MAX;
    too_large.sftp.timeout_seconds = u16::MAX;
    let stored = state
        .settings()
        .update_settings(too_large)
        .expect("save too large sftp settings");
    assert_eq!(stored.sftp.global_transfers, MAX_SFTP_GLOBAL_TRANSFERS);
    assert_eq!(stored.sftp.host_transfers, MAX_SFTP_HOST_TRANSFERS);
    assert_eq!(stored.sftp.pipeline_depth, MAX_SFTP_PIPELINE_DEPTH);
    assert_eq!(stored.sftp.packet_bytes, MAX_SFTP_PACKET_BYTES);
    assert_eq!(stored.sftp.timeout_seconds, MAX_SFTP_TIMEOUT_SECONDS);

    let mut host_above_global = AppSettings::default();
    host_above_global.sftp.global_transfers = 2;
    host_above_global.sftp.host_transfers = 8;
    let stored = state
        .settings()
        .update_settings(host_above_global)
        .expect("save host above global sftp settings");
    assert_eq!(stored.sftp.global_transfers, 2);
    assert_eq!(stored.sftp.host_transfers, 2);
}
