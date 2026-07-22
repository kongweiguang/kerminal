//! 公共契约 characterization 与 golden 指纹测试。
//!
//! @author kongweiguang

use kerminal_lib::services::mcp_tool_catalog_service::McpToolCatalogService;
use serde_json::{json, Value};
use std::{collections::BTreeMap, fs, path::Path};

fn repo_root() -> &'static Path {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("repository root")
}

fn inventory() -> Value {
    serde_json::from_str(
        &fs::read_to_string(
            repo_root().join("tests/fixtures/contracts/public-contract-inventory.json"),
        )
        .expect("read public contract inventory"),
    )
    .expect("parse public contract inventory")
}

#[test]
fn tauri_command_names_payloads_and_results_match_golden_fingerprint() {
    let expected = inventory();
    let registry = fs::read_to_string(repo_root().join("src-tauri/src/commands/registry.rs"))
        .expect("read command registry");
    let command_names = registry
        .lines()
        .filter_map(|line| line.trim().strip_prefix("crate::commands::"))
        .map(|line| {
            line.trim_end_matches(',')
                .rsplit("::")
                .next()
                .unwrap()
                .to_owned()
        })
        .collect::<Vec<_>>();
    assert_eq!(
        command_names.len(),
        expected["tauri"]["commandCount"].as_u64().unwrap() as usize
    );

    let mut rust_files = Vec::new();
    collect_rust_files(&repo_root().join("src-tauri/src/commands"), &mut rust_files);
    let mut signatures = BTreeMap::new();
    for path in rust_files {
        let source = fs::read_to_string(path).expect("read command source");
        for name in &command_names {
            if signatures.contains_key(name) {
                continue;
            }
            if let Some(signature) = command_signature(&source, name) {
                signatures.insert(name.clone(), signature);
            }
        }
    }
    assert_eq!(
        signatures.len(),
        command_names.len(),
        "every registered command must have a discoverable #[tauri::command] signature"
    );
    let canonical = signatures
        .into_iter()
        .map(|(name, signature)| format!("{name}|{signature}"))
        .collect::<Vec<_>>()
        .join("\n");
    assert_eq!(
        fingerprint(&canonical),
        expected["tauri"]["signatureFingerprint"].as_str().unwrap(),
        "Tauri command payload/result contract changed; review and regenerate the golden inventory"
    );
}

#[test]
fn versions_events_storage_and_sensitive_field_rejection_remain_explicit() {
    let expected = inventory();
    assert_source_contains(
        "src/features/workspace/workspaceSession.ts",
        "WORKSPACE_SESSION_VERSION = 2",
    );
    assert_source_contains(
        "src-tauri/src/storage/config_file_store.rs",
        "CONFIG_FILE_SCHEMA_VERSION: u32 = 1",
    );
    assert_source_contains(
        "src-tauri/src/storage/command_migrations.rs",
        "CURRENT_COMMAND_SCHEMA_VERSION: u32 = 3",
    );

    let all_sources =
        read_tree(&repo_root().join("src-tauri/src")) + &read_tree(&repo_root().join("src"));
    for event in expected["events"].as_array().unwrap() {
        assert!(
            all_sources.contains(event.as_str().unwrap()),
            "missing public event {event}"
        );
    }
    let migrations =
        fs::read_to_string(repo_root().join("src-tauri/src/storage/command_migrations.rs"))
            .unwrap();
    for table in expected["sqlite"]["tables"].as_array().unwrap() {
        assert!(
            migrations.contains(&format!("TABLE IF NOT EXISTS {}", table.as_str().unwrap()))
                || migrations.contains(&format!("TABLE {}", table.as_str().unwrap())),
            "missing SQLite table {table}"
        );
    }
    let config_store = read_tree(&repo_root().join("src-tauri/src/storage/config_file_store"))
        + &fs::read_to_string(repo_root().join("src-tauri/src/storage/config_file_store.rs"))
            .unwrap();
    for field in expected["config"]["prohibitedHostFields"]
        .as_array()
        .unwrap()
    {
        assert!(
            config_store.contains(field.as_str().unwrap()),
            "sensitive host field rejection disappeared for {field}"
        );
    }
}

#[test]
fn mcp_ids_schemas_annotations_and_absent_families_match_golden() {
    let expected = inventory();
    let mut tools = McpToolCatalogService::new().list_tools();
    tools.sort_by(|left, right| left.id.cmp(&right.id));
    assert_eq!(
        tools.len(),
        expected["mcp"]["toolCount"].as_u64().unwrap() as usize
    );
    let canonical = tools
        .iter()
        .map(|tool| {
            assert_eq!(
                tool.input_schema["additionalProperties"],
                json!(false),
                "{} must reject unknown input fields",
                tool.id
            );
            serde_json::to_string(&json!({
                "id": tool.id,
                "inputSchema": tool.input_schema,
                "annotations": tool.annotations,
                "enabled": tool.enabled,
                "exposedToMcp": tool.exposed_to_mcp,
            }))
            .unwrap()
        })
        .collect::<Vec<_>>()
        .join("\n");
    assert_eq!(fingerprint(&canonical), expected["mcp"]["contractFingerprint"].as_str().unwrap(), "MCP public contract changed; review tool ids, schemas and annotations before updating golden");
    for family in expected["mcp"]["deliberatelyAbsentFamilies"]
        .as_array()
        .unwrap()
    {
        let family = family.as_str().unwrap();
        assert!(
            !tools.iter().any(|tool| tool.id.starts_with(family)),
            "deliberately absent MCP family was exposed: {family}"
        );
    }
}

fn collect_rust_files(directory: &Path, files: &mut Vec<std::path::PathBuf>) {
    for entry in fs::read_dir(directory).expect("read Rust source directory") {
        let path = entry.expect("read directory entry").path();
        if path.is_dir() {
            collect_rust_files(&path, files);
        } else if path.extension().and_then(|value| value.to_str()) == Some("rs") {
            files.push(path);
        }
    }
}

fn command_signature(source: &str, name: &str) -> Option<String> {
    let marker = format!("fn {name}");
    let function_offset = source.find(&marker)?;
    let prefix = &source[..function_offset];
    let attribute_offset = prefix.rfind("#[tauri::command")?;
    if function_offset - attribute_offset > 512 {
        return None;
    }
    let signature_start =
        source[attribute_offset..function_offset].rfind("pub")? + attribute_offset;
    let signature_end = source[function_offset..].find('{')? + function_offset;
    Some(
        source[signature_start..signature_end]
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" "),
    )
}

fn fingerprint(value: &str) -> String {
    let mut hash = 0xcbf29ce484222325_u64;
    for byte in value.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("fnv1a64:{hash:016x}")
}

fn assert_source_contains(path: &str, expected: &str) {
    let source = fs::read_to_string(repo_root().join(path)).expect("read contract source");
    assert!(
        source.contains(expected),
        "{path} no longer contains {expected}"
    );
}

fn read_tree(directory: &Path) -> String {
    let mut files = Vec::new();
    collect_rust_and_typescript_files(directory, &mut files);
    files
        .into_iter()
        .map(|path| fs::read_to_string(path).unwrap())
        .collect::<Vec<_>>()
        .join("\n")
}

fn collect_rust_and_typescript_files(directory: &Path, files: &mut Vec<std::path::PathBuf>) {
    for entry in fs::read_dir(directory).expect("read source directory") {
        let path = entry.expect("read directory entry").path();
        if path.is_dir() {
            collect_rust_and_typescript_files(&path, files);
        } else if matches!(
            path.extension().and_then(|value| value.to_str()),
            Some("rs" | "ts" | "tsx")
        ) {
            files.push(path);
        }
    }
}
