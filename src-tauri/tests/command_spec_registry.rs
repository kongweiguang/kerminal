//! 命令建议声明式 spec registry 集成测试。
//!
//! @author kongweiguang

use std::{
    fs,
    path::{Path, PathBuf},
};

use tempfile::tempdir;

#[path = "../build_support/command_spec_registry.rs"]
mod compiler;

const MAX_ARTIFACT_BYTES: usize = 4 * 1024 * 1024;

#[test]
fn production_registry_compiles_to_stable_static_tables() {
    let source_root = production_source_root();
    let first = compiler::compile_registry_bytes(&source_root).expect("compile registry");
    let second = compiler::compile_registry_bytes(&source_root).expect("compile registry again");

    assert_eq!(first, second);
    assert!(first.len() <= MAX_ARTIFACT_BYTES);

    let generated = String::from_utf8(first).expect("generated Rust is UTF-8");
    let golden = production_golden();
    assert_eq!(
        generated_items(&generated, "ROOT_ITEMS"),
        golden
            .iter()
            .map(|entry| entry.command.clone())
            .collect::<Vec<_>>()
    );
    assert!(generated.contains("StaticSpecSensitivity::Normal"));
    assert!(generated.contains("StaticSpecSensitivity::Dangerous"));
    assert!(generated.contains("allow_inline: true"));
    assert!(generated.contains("allow_inline: false"));
    assert!(generated.contains(r#"description: "Switch branches or restore files""#));
}

#[test]
fn production_registry_matches_maintained_golden_candidates() {
    let generated = String::from_utf8(
        compiler::compile_registry_bytes(&production_source_root()).expect("compile registry"),
    )
    .expect("generated Rust is UTF-8");

    for entry in production_golden() {
        assert_bucket_contains(&generated, &entry.command, &[], "Option", &entry.option);
        if let Some(subcommand) = entry.subcommand {
            assert_bucket_contains(&generated, &entry.command, &[], "Subcommand", &subcommand);
        }
    }
}

#[test]
fn production_registry_preserves_maintenance_metadata_and_explicit_root_safety() {
    let generated = String::from_utf8(
        compiler::compile_registry_bytes(&production_source_root()).expect("compile registry"),
    )
    .expect("generated Rust is UTF-8");

    for entry in production_golden() {
        let source = source_for_command(&entry.command);
        for field in [
            "schema_version",
            "description",
            "tested_version",
            "owner",
            "updated_at",
        ] {
            assert!(
                source.contains(&format!("{field} = ")),
                "{} is missing {field}",
                entry.command
            );
        }
        assert!(
            source.contains("[source]") && source.contains("url = "),
            "{} is missing source metadata",
            entry.command
        );
        assert!(
            source.contains("[safety]"),
            "{} must declare root safety explicitly",
            entry.command
        );

        let command_block = generated_command_block(&generated, &entry.command);
        for field in [
            "source_name:",
            "source_url:",
            "tested_version:",
            "owner:",
            "updated_at:",
        ] {
            assert!(
                command_block.contains(field),
                "{} generated metadata is missing {field}",
                entry.command
            );
        }
    }
}

#[test]
fn production_registry_marks_destructive_candidates_as_menu_only() {
    let generated = String::from_utf8(
        compiler::compile_registry_bytes(&production_source_root()).expect("compile registry"),
    )
    .expect("generated Rust is UTF-8");

    for (command, path, kind, item) in [
        ("docker", &[][..], "Option", "--volumes"),
        ("find", &[][..], "Option", "-delete"),
        ("git", &[][..], "Option", "--hard"),
        ("kubectl", &[][..], "Subcommand", "delete"),
        ("rm", &[][..], "Option", "--recursive"),
        ("rsync", &[][..], "Option", "--delete"),
        ("systemctl", &[][..], "Subcommand", "stop"),
        ("terraform", &[][..], "Subcommand", "destroy"),
    ] {
        let item_array = bucket_item_array(&generated, command, path, kind);
        let block = generated_item_block(&generated, &item_array, item);
        assert!(
            block.contains("sensitivity: StaticSpecSensitivity::Dangerous")
                && block.contains("allow_inline: false"),
            "{command} {item} must be dangerous and menu-only"
        );
    }
}

#[test]
fn source_enumeration_order_does_not_change_generated_bytes() {
    let source_root = production_source_root();
    let mut paths = toml_paths(&source_root);
    let forward = compiler::compile_registry_paths(&source_root, paths.clone())
        .expect("compile forward paths");
    paths.reverse();
    let reverse =
        compiler::compile_registry_paths(&source_root, paths).expect("compile reverse paths");

    assert_eq!(forward, reverse);
}

#[test]
fn production_registry_preserves_the_seven_legacy_candidate_sets() {
    let generated = String::from_utf8(
        compiler::compile_registry_bytes(&production_source_root()).expect("compile registry"),
    )
    .expect("generated Rust is UTF-8");

    assert_bucket(
        &generated,
        "cargo",
        &[],
        "Subcommand",
        &[
            "add", "build", "check", "clean", "clippy", "doc", "fmt", "install", "run", "test",
            "update",
        ],
    );
    assert_bucket(
        &generated,
        "cargo",
        &[],
        "Option",
        &[
            "--all-features",
            "--bin",
            "--features",
            "--locked",
            "--manifest-path",
            "--package",
            "--release",
            "--target",
            "--workspace",
        ],
    );
    assert_bucket(
        &generated,
        "docker",
        &[],
        "Subcommand",
        &[
            "build", "compose", "exec", "images", "inspect", "logs", "network", "ps", "pull",
            "push", "run", "stop", "volume",
        ],
    );
    assert_bucket(
        &generated,
        "docker",
        &["compose"],
        "Subcommand",
        &[
            "build", "config", "down", "exec", "logs", "ps", "pull", "restart", "run", "stop", "up",
        ],
    );
    assert_bucket(
        &generated,
        "docker",
        &[],
        "Option",
        &[
            "--build",
            "--detach",
            "--file",
            "--follow",
            "--force-recreate",
            "--name",
            "--no-cache",
            "--platform",
            "--pull",
            "--rm",
            "--tag",
            "--volumes",
        ],
    );
    assert_bucket(
        &generated,
        "git",
        &[],
        "Subcommand",
        &[
            "add",
            "branch",
            "checkout",
            "cherry-pick",
            "clone",
            "commit",
            "diff",
            "fetch",
            "log",
            "merge",
            "pull",
            "push",
            "rebase",
            "remote",
            "restore",
            "show",
            "stash",
            "status",
            "switch",
            "tag",
        ],
    );
    assert_bucket(
        &generated,
        "git",
        &[],
        "Option",
        &[
            "--all",
            "--amend",
            "--cached",
            "--force-with-lease",
            "--global",
            "--hard",
            "--message",
            "--oneline",
            "--patch",
            "--quiet",
            "--rebase",
            "--set-upstream",
        ],
    );
    assert_bucket(
        &generated,
        "kubectl",
        &[],
        "Subcommand",
        &[
            "apply",
            "config",
            "create",
            "delete",
            "describe",
            "exec",
            "get",
            "logs",
            "port-forward",
            "rollout",
            "scale",
            "top",
        ],
    );
    for path in ["delete", "describe", "exec", "get", "logs"] {
        assert_bucket(
            &generated,
            "kubectl",
            &[path],
            "Subcommand",
            &[
                "configmaps",
                "cronjobs",
                "deployments",
                "events",
                "ingress",
                "jobs",
                "namespaces",
                "nodes",
                "pods",
                "replicasets",
                "secrets",
                "services",
                "statefulsets",
            ],
        );
    }
    assert_bucket(
        &generated,
        "kubectl",
        &[],
        "Option",
        &[
            "--all-namespaces",
            "--container",
            "--context",
            "--dry-run",
            "--filename",
            "--follow",
            "--namespace",
            "--output",
            "--selector",
            "--watch",
        ],
    );
    assert_bucket(
        &generated,
        "npm",
        &[],
        "Subcommand",
        &[
            "ci", "install", "link", "login", "outdated", "publish", "run", "test", "update",
            "version",
        ],
    );
    assert_bucket(
        &generated,
        "npm",
        &[],
        "Option",
        &[
            "--dry-run",
            "--global",
            "--if-present",
            "--legacy-peer-deps",
            "--omit",
            "--prefix",
            "--save-dev",
            "--workspace",
        ],
    );
    assert_bucket(
        &generated,
        "ssh",
        &[],
        "Option",
        &[
            "-A", "-F", "-i", "-J", "-L", "-N", "-o", "-p", "-R", "-T", "-v",
        ],
    );
    assert_bucket(
        &generated,
        "systemctl",
        &[],
        "Subcommand",
        &[
            "daemon-reload",
            "disable",
            "enable",
            "is-active",
            "restart",
            "start",
            "status",
            "stop",
        ],
    );
    assert_bucket(
        &generated,
        "systemctl",
        &[],
        "Option",
        &["--failed", "--global", "--no-pager", "--now", "--user"],
    );
}

#[test]
fn compiler_writes_only_the_generated_artifact_to_the_output_directory() {
    let output = tempdir().expect("output directory");
    let result = compiler::compile_registry(&production_source_root(), output.path())
        .expect("compile registry");

    assert_eq!(result.command_count, production_golden().len());
    assert!(result.artifact_bytes <= MAX_ARTIFACT_BYTES);
    assert_eq!(
        result
            .artifact_path
            .file_name()
            .and_then(|name| name.to_str()),
        Some(compiler::GENERATED_FILE_NAME)
    );
    assert_eq!(
        fs::read_dir(output.path())
            .expect("read output directory")
            .count(),
        1
    );
}

#[test]
fn validator_rejects_unknown_fields_with_relative_field_path() {
    assert_fixture_error("unknown-field", "invalid.toml: unexpected: 未知字段");
}

#[test]
fn validator_rejects_missing_description_and_source() {
    assert_fixture_error("missing-description", "invalid.toml: description: 不能为空");
    assert_fixture_error("missing-source", "invalid.toml: source.name: 不能为空");
}

#[test]
fn validator_rejects_calendar_invalid_updated_at() {
    assert_fixture_error(
        "invalid-date",
        "invalid.toml: updated_at: 必须是有效的 YYYY-MM-DD 日期",
    );
}

#[test]
fn validator_rejects_duplicates_and_command_alias_conflicts() {
    assert_fixture_error(
        "duplicate-option",
        "invalid.toml: options[1].name: 同一路径下 option/alias 冲突",
    );
    assert_fixture_error(
        "alias-conflict",
        "beta.toml: command: 命令或 alias 与 alpha.toml: aliases[0] 冲突",
    );
}

#[test]
fn validator_rejects_illegal_relationships() {
    assert_fixture_error(
        "illegal-relation",
        "invalid.toml: options[0].relationships.requires[0]: 关系目标不存在或路径不可见",
    );
}

#[test]
fn validator_rejects_dangerous_items_that_allow_inline() {
    assert_fixture_error(
        "dangerous-inline",
        "invalid.toml: options[0].safety.allow_inline: 危险或敏感项不得进入 inline",
    );
}

#[test]
fn valid_dangerous_items_compile_as_menu_only_metadata() {
    let generated = String::from_utf8(
        compiler::compile_registry_bytes(&fixture_root("valid-dangerous"))
            .expect("compile dangerous fixture"),
    )
    .expect("generated Rust is UTF-8");

    assert!(generated.contains("sensitivity: StaticSpecSensitivity::Dangerous"));
    assert!(generated.contains("allow_inline: false"));
}

fn assert_fixture_error(name: &str, expected: &str) {
    let root = fixture_root(name);
    let error = compiler::compile_registry_bytes(&root).expect_err("fixture must fail");
    let message = error.to_string();
    assert!(message.contains(expected), "unexpected error: {message}");
    assert!(
        !message.contains(&root.to_string_lossy().to_string()),
        "error leaked absolute source root: {message}"
    );
}

fn assert_bucket(generated: &str, command: &str, path: &[&str], kind: &str, expected: &[&str]) {
    let item_array = bucket_item_array(generated, command, path, kind);
    assert_eq!(generated_items(generated, &item_array), strings(expected));
}

fn assert_bucket_contains(generated: &str, command: &str, path: &[&str], kind: &str, item: &str) {
    let item_array = bucket_item_array(generated, command, path, kind);
    assert!(
        generated_items(generated, &item_array).contains(&item.to_owned()),
        "missing {command} {kind} candidate {item}"
    );
}

fn bucket_item_array(generated: &str, command: &str, path: &[&str], kind: &str) -> String {
    let command_line = format!("command: {command:?},");
    let path_values = path
        .iter()
        .map(|item| (*item).to_owned())
        .collect::<Vec<_>>();
    let path_line = format!("path: &{path_values:?},");
    let kind_line = format!("kind: StaticSpecBucketKind::{kind},");
    for block in generated.split("StaticSpecBucket {").skip(1) {
        let block = block.split("},").next().unwrap_or(block);
        if block.contains(&command_line) && block.contains(&path_line) && block.contains(&kind_line)
        {
            return block
                .lines()
                .find_map(|line| line.trim().strip_prefix("items: "))
                .and_then(|value| value.strip_suffix(','))
                .expect("bucket item array")
                .to_owned();
        }
    }
    panic!("missing bucket command={command} path={path:?} kind={kind}");
}

fn generated_items(generated: &str, array_name: &str) -> Vec<String> {
    let marker = format!("static {array_name}: &[StaticSpecItem] = &[");
    let body = generated
        .split_once(&marker)
        .unwrap_or_else(|| panic!("missing generated array {array_name}"))
        .1
        .split_once("];")
        .expect("generated array terminator")
        .0;
    body.lines()
        .filter_map(|line| line.trim().strip_prefix("name: "))
        .filter_map(|value| value.strip_suffix(','))
        .map(|literal| literal.trim_matches('"').to_owned())
        .collect()
}

fn strings(values: &[&str]) -> Vec<String> {
    values.iter().map(|value| (*value).to_owned()).collect()
}

#[derive(Debug)]
struct GoldenEntry {
    command: String,
    subcommand: Option<String>,
    option: String,
}

fn production_golden() -> Vec<GoldenEntry> {
    include_str!("fixtures/command_spec_registry/production-golden.txt")
        .lines()
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .map(|line| {
            let mut fields = line.split('|');
            let command = fields.next().expect("golden command").to_owned();
            let subcommand = match fields.next().expect("golden subcommand") {
                "-" => None,
                value => Some(value.to_owned()),
            };
            let option = fields.next().expect("golden option").to_owned();
            assert!(fields.next().is_none(), "invalid golden line: {line}");
            GoldenEntry {
                command,
                subcommand,
                option,
            }
        })
        .collect()
}

fn source_for_command(command: &str) -> String {
    let path = toml_paths(&production_source_root())
        .into_iter()
        .find(|path| {
            fs::read_to_string(path)
                .is_ok_and(|source| source.contains(&format!("command = {command:?}")))
        })
        .unwrap_or_else(|| panic!("missing source spec for {command}"));
    fs::read_to_string(path).expect("read command spec")
}

fn generated_command_block<'a>(generated: &'a str, command: &str) -> &'a str {
    let marker = format!("name: {command:?},");
    generated
        .split("StaticCommandSpec {")
        .skip(1)
        .find(|block| block.contains(&marker))
        .and_then(|block| block.split_once("},").map(|(value, _)| value))
        .unwrap_or_else(|| panic!("missing generated command block for {command}"))
}

fn generated_item_block<'a>(generated: &'a str, array_name: &str, item: &str) -> &'a str {
    let marker = format!("static {array_name}: &[StaticSpecItem] = &[");
    let array = generated
        .split_once(&marker)
        .unwrap_or_else(|| panic!("missing generated array {array_name}"))
        .1
        .split_once("];")
        .expect("generated array terminator")
        .0;
    let item_marker = format!("name: {item:?},");
    array
        .split("StaticSpecItem {")
        .skip(1)
        .find(|block| block.contains(&item_marker))
        .and_then(|block| block.split_once("},").map(|(value, _)| value))
        .unwrap_or_else(|| panic!("missing generated item {item} in {array_name}"))
}

fn toml_paths(root: &Path) -> Vec<PathBuf> {
    fn visit(directory: &Path, paths: &mut Vec<PathBuf>) {
        for entry in fs::read_dir(directory).expect("read spec directory") {
            let path = entry.expect("directory entry").path();
            if path.is_dir() {
                visit(&path, paths);
            } else if path.extension().and_then(|value| value.to_str()) == Some("toml") {
                paths.push(path);
            }
        }
    }
    let mut paths = Vec::new();
    visit(root, &mut paths);
    paths
}

fn production_source_root() -> PathBuf {
    manifest_root().join("command-specs/v1")
}

fn fixture_root(name: &str) -> PathBuf {
    manifest_root()
        .join("tests/fixtures/command_spec_registry")
        .join(name)
}

fn manifest_root() -> PathBuf {
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    if manifest.join("command-specs").is_dir() {
        return manifest;
    }
    manifest
        .ancestors()
        .find(|ancestor| ancestor.join("command-specs").is_dir())
        .expect("locate src-tauri manifest root")
        .to_path_buf()
}
