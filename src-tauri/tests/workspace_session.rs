//! Workspace session file-backed command tests.
//!
//! @author kongweiguang

use std::fs;

use kerminal_lib::{
    commands::workspace_session::{workspace_session_load, workspace_session_save},
    paths::KerminalPaths,
    state::AppState,
};
use serde_json::json;
use tauri::Manager;

#[test]
fn workspace_session_load_missing_returns_none() {
    let home = tempfile::tempdir().expect("temp home");
    let (app, _paths) = mock_app(home.path());

    let loaded = workspace_session_load(app.state::<AppState>()).expect("load workspace session");

    assert_eq!(loaded, None);
}

#[test]
/// v3 写入应生成可再次读取的 workspace session 原文。
fn workspace_session_save_writes_workspace_session_json_and_loads_it_back() {
    let home = tempfile::tempdir().expect("temp home");
    let (app, paths) = mock_app(home.path());
    let session = json!({
        "version": 3,
        "activeTabId": "tab-main",
        "focusedPaneId": "pane-1"
    });

    workspace_session_save(app.state::<AppState>(), session.clone()).expect("save workspace");

    let session_path = paths.root.join("workspace").join("session.json");
    assert!(session_path.is_file());
    let raw = fs::read_to_string(&session_path).expect("session file");
    assert!(raw.ends_with('\n'));
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&raw).expect("json"),
        session
    );
    assert_eq!(
        workspace_session_load(app.state::<AppState>()).expect("load workspace"),
        Some(session)
    );
}

#[test]
fn workspace_session_save_rejects_non_object_json() {
    let home = tempfile::tempdir().expect("temp home");
    let (app, paths) = mock_app(home.path());

    let error =
        workspace_session_save(app.state::<AppState>(), json!(["not", "object"])).expect_err("err");

    assert!(error.contains("workspace session"));
    assert!(!paths.root.join("workspace").join("session.json").exists());
}

#[test]
/// 损坏或非 object 根内容必须显式暴露为 invalid，防止前端把它误判为首次启动。
fn workspace_session_load_bad_or_non_object_json_returns_invalid_marker() {
    let home = tempfile::tempdir().expect("temp home");
    let (app, paths) = mock_app(home.path());
    let session_path = paths.root.join("workspace").join("session.json");
    fs::create_dir_all(session_path.parent().expect("parent")).expect("mkdir");

    fs::write(&session_path, "not json").expect("write bad json");
    let bad_json = workspace_session_load(app.state::<AppState>())
        .expect("load bad json")
        .expect("invalid marker");
    assert_eq!(bad_json["__kerminalInvalidWorkspaceSession"], true);

    fs::write(&session_path, "[]").expect("write array json");
    let non_object = workspace_session_load(app.state::<AppState>())
        .expect("load non object")
        .expect("invalid marker");
    assert_eq!(non_object["__kerminalInvalidWorkspaceSession"], true);
}

#[test]
/// 升级旧 session 时只保留首次原文备份，后续 v3 写入不覆盖备份。
fn workspace_session_v3_save_keeps_one_pre_v3_backup() {
    let home = tempfile::tempdir().expect("temp home");
    let (app, paths) = mock_app(home.path());
    let session_path = paths.root.join("workspace").join("session.json");
    fs::create_dir_all(session_path.parent().expect("parent")).expect("mkdir");
    let legacy = json!({
        "version": 2,
        "terminalTabs": [{"id": "legacy-tab"}]
    });
    fs::write(
        &session_path,
        serde_json::to_vec(&legacy).expect("legacy json"),
    )
    .expect("write legacy");

    workspace_session_save(
        app.state::<AppState>(),
        json!({"version": 3, "terminalTabs": [], "terminalPanes": [], "sidebarMachines": []}),
    )
    .expect("save v3");
    let backup_path = paths.root.join("workspace").join("session.pre-v3.json");
    assert_eq!(
        fs::read(&backup_path).expect("backup"),
        serde_json::to_vec(&legacy).unwrap()
    );

    fs::write(
        &session_path,
        br#"{"version":3,"terminalTabs":[],"terminalPanes":[],"sidebarMachines":[]}"#,
    )
    .expect("change current");
    workspace_session_save(
        app.state::<AppState>(),
        json!({"version": 3, "terminalTabs": [], "terminalPanes": [], "sidebarMachines": []}),
    )
    .expect("save second v3");
    assert_eq!(
        fs::read(&backup_path).expect("backup"),
        serde_json::to_vec(&legacy).unwrap()
    );
}

#[test]
/// 保存边界拒绝缺失或旧版本号，防止旧客户端绕过迁移保护。
fn workspace_session_save_rejects_non_v3_payload() {
    let home = tempfile::tempdir().expect("temp home");
    let (app, paths) = mock_app(home.path());

    let error = workspace_session_save(
        app.state::<AppState>(),
        json!({"version": 2, "terminalTabs": [], "terminalPanes": [], "sidebarMachines": []}),
    )
    .expect_err("legacy payload must be rejected");

    assert!(error.contains("只接受 v3"));
    assert!(!paths.root.join("workspace").join("session.json").exists());
}

#[test]
/// 现有损坏字节不能被 v3 自动保存覆盖。
fn workspace_session_save_preserves_corrupt_existing_bytes() {
    let home = tempfile::tempdir().expect("temp home");
    let (app, paths) = mock_app(home.path());
    let session_path = paths.root.join("workspace").join("session.json");
    fs::create_dir_all(session_path.parent().expect("parent")).expect("mkdir");
    let corrupt = b"{not-json";
    fs::write(&session_path, corrupt).expect("write corrupt session");

    let result = workspace_session_save(
        app.state::<AppState>(),
        json!({"version": 3, "terminalTabs": [], "terminalPanes": [], "sidebarMachines": []}),
    );

    assert!(result.is_err());
    assert_eq!(fs::read(&session_path).expect("session"), corrupt);
    assert!(!paths
        .root
        .join("workspace")
        .join("session.pre-v3.json")
        .exists());
}

#[test]
/// 现有未来版本字节不能被当前版本降级覆盖。
fn workspace_session_save_preserves_future_existing_bytes() {
    let home = tempfile::tempdir().expect("temp home");
    let (app, paths) = mock_app(home.path());
    let session_path = paths.root.join("workspace").join("session.json");
    fs::create_dir_all(session_path.parent().expect("parent")).expect("mkdir");
    let future = br#"{"version":4,"terminalTabs":[]}"#;
    fs::write(&session_path, future).expect("write future session");

    let result = workspace_session_save(
        app.state::<AppState>(),
        json!({"version": 3, "terminalTabs": [], "terminalPanes": [], "sidebarMachines": []}),
    );

    assert!(result.is_err());
    assert_eq!(fs::read(&session_path).expect("session"), future);
}

#[test]
/// 现有非 object 根节点同样视为损坏，不能被自动保存替换。
fn workspace_session_save_preserves_invalid_root_bytes() {
    let home = tempfile::tempdir().expect("temp home");
    let (app, paths) = mock_app(home.path());
    let session_path = paths.root.join("workspace").join("session.json");
    fs::create_dir_all(session_path.parent().expect("parent")).expect("mkdir");
    let invalid_root = br#"["legacy"]"#;
    fs::write(&session_path, invalid_root).expect("write invalid root");

    let result = workspace_session_save(
        app.state::<AppState>(),
        json!({"version": 3, "terminalTabs": [], "terminalPanes": [], "sidebarMachines": []}),
    );

    assert!(result.is_err());
    assert_eq!(fs::read(&session_path).expect("session"), invalid_root);
}

#[test]
/// 备份目标失败时当前旧 session 仍保持原样。
fn workspace_session_save_preserves_existing_bytes_when_backup_fails() {
    let home = tempfile::tempdir().expect("temp home");
    let (app, paths) = mock_app(home.path());
    let workspace_dir = paths.root.join("workspace");
    let session_path = workspace_dir.join("session.json");
    fs::create_dir_all(&workspace_dir).expect("mkdir");
    let legacy = br#"{"version":2,"terminalTabs":[]}"#;
    fs::write(&session_path, legacy).expect("write legacy session");
    // A directory at the backup target makes the atomic backup fail before the
    // current session can be replaced.
    fs::create_dir(workspace_dir.join("session.pre-v3.json")).expect("backup directory");

    let result = workspace_session_save(
        app.state::<AppState>(),
        json!({"version": 3, "terminalTabs": [], "terminalPanes": [], "sidebarMachines": []}),
    );

    assert!(result.is_err());
    assert_eq!(fs::read(&session_path).expect("session"), legacy);
}

fn mock_app(home: &std::path::Path) -> (tauri::App<tauri::test::MockRuntime>, KerminalPaths) {
    let paths = KerminalPaths::from_home_dir(home);
    let state = AppState::initialize_with_paths(paths.clone()).expect("initialize app state");
    let app = tauri::test::mock_builder()
        .manage(state)
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("build mock app");
    (app, paths)
}
