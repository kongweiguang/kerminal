use kerminal_lib::{
    models::snippet::{
        SnippetCatalogListRequest, SnippetCatalogOrigin, SnippetContextBindingKind,
        SnippetCreateRequest, SnippetScope,
    },
    paths::KerminalPaths,
    services::{snippet_catalog_service, snippet_service::SnippetService},
    storage::config_file_store::ConfigFileStore,
    storage::{snippet_preferences::SnippetPreferenceOrigin, CommandSqliteStore},
};
use std::{fs, thread, time::Duration};
use tempfile::tempdir;

#[test]
fn unified_catalog_exposes_bounded_searchable_builtins() {
    let root = tempdir().expect("temp root");
    let service = SnippetService::new(ConfigFileStore::new(root.path()));
    let storage =
        CommandSqliteStore::open(&KerminalPaths::from_home_dir(root.path())).expect("store");
    let items = snippet_catalog_service::list_catalog(
        &service,
        &storage,
        SnippetCatalogListRequest {
            query: Some("docker".to_owned()),
            origin: Some(SnippetCatalogOrigin::Builtin),
            scope: None,
            limit: Some(2),
        },
    )
    .expect("catalog");
    assert_eq!(items.len(), 2);
    assert!(items
        .iter()
        .all(|item| item.origin == SnippetCatalogOrigin::Builtin));
    assert!(items.iter().all(|item| item.title.contains("Docker")));
}

#[test]
fn parameterized_catalog_items_keep_typed_variables() {
    let root = tempdir().expect("temp root");
    let service = SnippetService::new(ConfigFileStore::new(root.path()));
    let storage =
        CommandSqliteStore::open(&KerminalPaths::from_home_dir(root.path())).expect("store");
    let items = snippet_catalog_service::list_catalog(
        &service,
        &storage,
        SnippetCatalogListRequest {
            query: Some("HTTP 响应头".to_owned()),
            origin: Some(SnippetCatalogOrigin::Builtin),
            scope: None,
            limit: None,
        },
    )
    .expect("catalog");
    assert_eq!(items[0].variables[0].kind, "url");
    assert_eq!(items[0].variables[0].render_strategy, "shellArg");
}

#[test]
fn legacy_user_placeholders_project_to_raw_variables_without_rewriting_toml() {
    let root = tempdir().expect("temp root");
    let paths = KerminalPaths::from_home_dir(root.path());
    paths.ensure_directories().expect("create dirs");
    let source = r#"# 外部注释必须保持
schema_version = 1
id = "legacy-vars"
title = "旧变量片段"
command = "ssh {{ host }} -p {{port}} {{ host }}"
tags = ["legacy"]
scope = "ssh"
sort_order = 1
created_at = "1"
updated_at = "1"
future_key = "外部字段"
"#;
    let snippet_path = paths.snippets.join("legacy-vars.toml");
    fs::write(&snippet_path, source).expect("write legacy snippet");
    let service = SnippetService::new(ConfigFileStore::new(paths.root.clone()));
    let storage = CommandSqliteStore::open(&paths).expect("store");

    let items = snippet_catalog_service::list_catalog(
        &service,
        &storage,
        SnippetCatalogListRequest {
            query: None,
            origin: Some(SnippetCatalogOrigin::User),
            scope: None,
            limit: None,
        },
    )
    .expect("catalog");

    assert_eq!(items.len(), 1);
    assert_eq!(items[0].risk, "change");
    assert_eq!(
        items[0]
            .variables
            .iter()
            .map(|variable| variable.name.as_str())
            .collect::<Vec<_>>(),
        vec!["host", "port"]
    );
    assert!(items[0].variables.iter().all(|variable| {
        variable.kind == "raw"
            && variable.required
            && variable.render_strategy == "literal"
            && !variable.sensitive
    }));
    assert_eq!(
        fs::read_to_string(snippet_path).expect("read source"),
        source
    );
}

#[test]
fn typed_user_metadata_takes_priority_over_legacy_projection_defaults() {
    let root = tempdir().expect("temp root");
    let paths = KerminalPaths::from_home_dir(root.path());
    paths.ensure_directories().expect("create dirs");
    fs::write(
        paths.snippets.join("typed.toml"),
        r#"schema_version = 1
id = "typed"
title = "Typed"
command = "systemctl status {{ service }}"
tags = []
scope = "ssh"
sort_order = 1
created_at = "1"
updated_at = "1"
category = "service"
risk = "inspect"
default_action = "insert"

[[variables]]
name = "service"
label = "服务"
description = "服务名"
kind = "service"
required = true
suggestions = []
render_strategy = "validatedRaw"
sensitive = false

[[context_bindings]]
kind = "host"
target_id = "host-a"
"#,
    )
    .expect("write typed snippet");
    let service = SnippetService::new(ConfigFileStore::new(paths.root.clone()));
    let storage = CommandSqliteStore::open(&paths).expect("store");
    let items = snippet_catalog_service::list_catalog(
        &service,
        &storage,
        SnippetCatalogListRequest {
            query: None,
            origin: Some(SnippetCatalogOrigin::User),
            scope: None,
            limit: None,
        },
    )
    .expect("catalog");

    assert_eq!(items[0].category, "service");
    assert_eq!(items[0].risk, "inspect");
    assert_eq!(items[0].default_action, "insert");
    assert_eq!(items[0].variables[0].kind, "service");
    assert_eq!(
        items[0].context_bindings[0].kind,
        SnippetContextBindingKind::Host
    );
    assert_eq!(
        items[0].context_bindings[0].target_id.as_deref(),
        Some("host-a")
    );
}

#[test]
fn secret_kind_cannot_be_downgraded_by_false_sensitive_flag() {
    let root = tempdir().expect("temp root");
    let paths = KerminalPaths::from_home_dir(root.path());
    paths.ensure_directories().expect("create dirs");
    fs::write(
        paths.snippets.join("secret-kind.toml"),
        r#"schema_version = 1
id = "secret-kind"
title = "Secret Kind"
command = "login {{ token }}"
tags = []
scope = "local"
sort_order = 1
created_at = "1"
updated_at = "1"
risk = "inspect"

[[variables]]
name = "token"
label = "令牌"
description = "认证令牌"
kind = "secret"
required = true
suggestions = []
render_strategy = "shellArg"
sensitive = false
"#,
    )
    .expect("write secret snippet");
    let service = SnippetService::new(ConfigFileStore::new(paths.root.clone()));
    let storage = CommandSqliteStore::open(&paths).expect("store");
    let items = snippet_catalog_service::list_catalog(
        &service,
        &storage,
        SnippetCatalogListRequest {
            query: None,
            origin: Some(SnippetCatalogOrigin::User),
            scope: None,
            limit: None,
        },
    )
    .expect("catalog");

    assert!(items[0].sensitive);
}

#[test]
fn malformed_user_file_does_not_hide_valid_catalog_items() {
    let root = tempdir().expect("temp root");
    let paths = KerminalPaths::from_home_dir(root.path());
    paths.ensure_directories().expect("create dirs");
    fs::write(
        paths.snippets.join("valid.toml"),
        r#"schema_version = 1
id = "valid"
title = "有效片段"
command = "uptime"
tags = []
scope = "ssh"
sort_order = 1
created_at = "1"
updated_at = "1"
"#,
    )
    .expect("valid snippet");
    fs::write(paths.snippets.join("broken.toml"), "title = [").expect("broken snippet");
    let service = SnippetService::new(ConfigFileStore::new(paths.root.clone()));
    let storage = CommandSqliteStore::open(&paths).expect("store");

    let items = snippet_catalog_service::list_catalog(
        &service,
        &storage,
        SnippetCatalogListRequest {
            origin: Some(SnippetCatalogOrigin::User),
            ..SnippetCatalogListRequest::default()
        },
    )
    .expect("partial catalog");

    assert_eq!(items.len(), 1);
    assert_eq!(items[0].id, "valid");
}

#[test]
fn catalog_cache_is_invalidated_by_app_writes_and_expires_for_external_edits() {
    let root = tempdir().expect("temp root");
    let paths = KerminalPaths::from_home_dir(root.path());
    paths.ensure_directories().expect("create dirs");
    let service = SnippetService::new(ConfigFileStore::new(paths.root.clone()));

    assert!(service
        .list_snippet_documents()
        .expect("prime empty cache")
        .snippets
        .is_empty());
    let created = service
        .create_snippet(SnippetCreateRequest {
            title: "缓存写入".to_owned(),
            command: "echo cached".to_owned(),
            description: None,
            tags: Vec::new(),
            scope: SnippetScope::Any,
        })
        .expect("create snippet");
    assert_eq!(
        service
            .list_snippet_documents()
            .expect("cache after app write")
            .snippets[0]
            .title,
        "缓存写入"
    );

    let path = paths.snippets.join(format!("{}.toml", created.id));
    let source = fs::read_to_string(&path)
        .expect("read snippet")
        .replace("title = \"缓存写入\"", "title = \"外部更新\"");
    fs::write(path, source).expect("external edit");
    assert_eq!(
        service
            .list_snippet_documents()
            .expect("still warm")
            .snippets[0]
            .title,
        "缓存写入"
    );
    thread::sleep(Duration::from_millis(1_050));
    assert_eq!(
        service
            .list_snippet_documents()
            .expect("expired cache")
            .snippets[0]
            .title,
        "外部更新"
    );
}

#[test]
fn preference_identity_requires_matching_origin_and_existing_id() {
    let root = tempdir().expect("temp root");
    let service = SnippetService::new(ConfigFileStore::new(root.path()));
    let created = service
        .create_snippet(SnippetCreateRequest {
            title: "Identity".to_owned(),
            command: "uptime".to_owned(),
            description: None,
            tags: Vec::new(),
            scope: SnippetScope::Any,
        })
        .expect("create user snippet");

    assert!(snippet_catalog_service::catalog_identity_exists(
        &service,
        SnippetPreferenceOrigin::User,
        &created.id,
    )
    .expect("user identity"));
    assert!(!snippet_catalog_service::catalog_identity_exists(
        &service,
        SnippetPreferenceOrigin::Builtin,
        &created.id,
    )
    .expect("wrong origin"));
    assert!(!snippet_catalog_service::catalog_identity_exists(
        &service,
        SnippetPreferenceOrigin::User,
        "missing",
    )
    .expect("unknown identity"));
    assert!(snippet_catalog_service::catalog_identity_exists(
        &service,
        SnippetPreferenceOrigin::Builtin,
        "snippet.builtin.core.system_overview",
    )
    .expect("builtin identity"));
}
