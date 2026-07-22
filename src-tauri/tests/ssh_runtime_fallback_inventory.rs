use regex::Regex;
use serde::Deserialize;
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::{Path, PathBuf},
};

#[derive(Debug, Deserialize)]
struct Inventory {
    watched_files: Vec<String>,
    capabilities: Vec<Capability>,
    fallback_markers: Vec<FallbackMarker>,
}

#[derive(Debug, Deserialize)]
struct Capability {
    id: String,
    entrypoint: String,
    managed_path: String,
    allowed_fallback: String,
    forbidden_fallback: String,
    diagnostics_evidence: String,
    test_evidence: String,
}

#[derive(Debug, Deserialize)]
struct FallbackMarker {
    capability: String,
    file: String,
    marker: String,
    allowed_reason: String,
    diagnostics_evidence: String,
}

fn manifest_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn read_text(path: impl AsRef<Path>) -> String {
    let path = path.as_ref();
    fs::read_to_string(path).unwrap_or_else(|error| {
        panic!("failed to read {}: {error}", path.display());
    })
}

fn read_inventory() -> Inventory {
    let source =
        read_text(manifest_dir().join("tests/fixtures/ssh_runtime_fallback_inventory.toml"));
    toml::from_str(&source).expect("fallback inventory fixture must parse")
}

fn source_path(relative_path: &str) -> PathBuf {
    manifest_dir().join(relative_path)
}

fn source_for(relative_path: &str) -> String {
    read_text(source_path(relative_path))
}

fn registered_marker_keys(inventory: &Inventory) -> BTreeSet<(String, String)> {
    inventory
        .fallback_markers
        .iter()
        .map(|marker| (marker.file.clone(), marker.marker.clone()))
        .collect()
}

fn literal_fallback_markers() -> &'static [&'static str] {
    &[
        "connect_native_ssh_chain(",
        "spawn_forward_process(",
        "spawn_forward_pty(",
        "Command::new(ssh)",
        "OpenSshProcess",
        "OpenSshPty",
    ]
}

fn discovered_fallback_markers(relative_path: &str, source: &str) -> BTreeSet<(String, String)> {
    let mut markers = BTreeSet::new();
    let legacy_constant = Regex::new(r"LEGACY_FALLBACK_[A-Z0-9_]+").expect("valid regex");
    for matched in legacy_constant.find_iter(source) {
        markers.insert((relative_path.to_owned(), matched.as_str().to_owned()));
    }
    for marker in literal_fallback_markers() {
        if source.contains(marker) {
            markers.insert((relative_path.to_owned(), (*marker).to_owned()));
        }
    }
    markers
}

#[test]
fn runtime_inventory_covers_required_ssh_capabilities() {
    let inventory = read_inventory();
    let capabilities = inventory
        .capabilities
        .iter()
        .map(|capability| capability.id.as_str())
        .collect::<BTreeSet<_>>();

    for required in [
        "terminal.shell",
        "exec.bounded",
        "exec.streaming",
        "sftp.interactive",
        "sftp.directory_exec",
        "port_forward",
        "container.files",
    ] {
        assert!(
            capabilities.contains(required),
            "runtime/fallback inventory must cover {required}"
        );
    }

    for capability in &inventory.capabilities {
        assert!(
            source_path(&capability.entrypoint).exists(),
            "capability {} entrypoint must exist: {}",
            capability.id,
            capability.entrypoint
        );
        assert!(
            !capability.managed_path.trim().is_empty()
                && !capability.allowed_fallback.trim().is_empty()
                && !capability.forbidden_fallback.trim().is_empty()
                && !capability.diagnostics_evidence.trim().is_empty()
                && !capability.test_evidence.trim().is_empty(),
            "capability {} must document managed path, fallback rules, diagnostics, and tests",
            capability.id
        );
    }
}

#[test]
fn registered_fallback_markers_exist_and_name_diagnostics_evidence() {
    let inventory = read_inventory();
    let capabilities = inventory
        .capabilities
        .iter()
        .map(|capability| capability.id.as_str())
        .collect::<BTreeSet<_>>();

    for marker in &inventory.fallback_markers {
        assert!(
            capabilities.contains(marker.capability.as_str()),
            "fallback marker {} references unknown capability {}",
            marker.marker,
            marker.capability
        );
        assert!(
            !marker.allowed_reason.trim().is_empty(),
            "fallback marker {} must document the allowed reason",
            marker.marker
        );
        let source = source_for(&marker.file);
        assert!(
            source.contains(&marker.marker),
            "registered fallback marker {} must exist in {}",
            marker.marker,
            marker.file
        );
        assert!(
            source.contains(&marker.diagnostics_evidence),
            "registered fallback marker {} in {} must have nearby or file-level diagnostics evidence token {}",
            marker.marker,
            marker.file,
            marker.diagnostics_evidence
        );
    }
}

#[test]
fn ssh_runtime_fallback_markers_cannot_be_added_without_inventory_entry() {
    let inventory = read_inventory();
    let registered = registered_marker_keys(&inventory);
    let mut missing = BTreeMap::new();

    for relative_path in &inventory.watched_files {
        let source = source_for(relative_path);
        for marker in discovered_fallback_markers(relative_path, &source) {
            if !registered.contains(&marker) {
                missing.insert(marker.0, marker.1);
            }
        }
    }

    assert!(
        missing.is_empty(),
        "SSH runtime fallback markers must be registered in tests/fixtures/ssh_runtime_fallback_inventory.toml: {missing:#?}"
    );
}
