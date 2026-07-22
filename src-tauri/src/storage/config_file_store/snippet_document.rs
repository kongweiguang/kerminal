//! 用户片段 TOML 的无损读取和乐观并发更新。
//!
//! @author kongweiguang

use std::{fs, str::FromStr};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use toml_edit::{value, Array, DocumentMut, Item};

use crate::{
    models::snippet::{
        CommandSnippet, SnippetCatalogVariable, SnippetContextBinding, SnippetScope,
    },
    storage::file_store::{FileStoreError, FileStoreResult},
};

use super::{snippet_relative_path, sort_snippets, ConfigFileStore, SNIPPETS_RELATIVE_DIR};

/// 无损文档读取结果；revision 只来自文件内容，不依赖时间戳。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SnippetDocumentSnapshot {
    pub snippet: CommandSnippet,
    pub revision: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SnippetDocumentWarning {
    pub file_name: String,
    pub message: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SnippetDocumentList {
    pub snippets: Vec<CommandSnippet>,
    pub warnings: Vec<SnippetDocumentWarning>,
}

/// V2 editor 拥有的基础字段；未列出的扩展字段和注释保持原样。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SnippetDocumentPatch {
    pub expected_revision: String,
    pub title: String,
    pub description: Option<String>,
    pub command: String,
    pub tags: Vec<String>,
    pub scope: SnippetScope,
    pub sort_order: i64,
    pub updated_at: String,
    pub category: Option<String>,
    pub risk: Option<String>,
    pub default_action: Option<String>,
    #[serde(default)]
    pub variables: Vec<SnippetCatalogVariable>,
    #[serde(default)]
    pub context_bindings: Vec<SnippetContextBinding>,
    pub derived_from: Option<String>,
}

impl ConfigFileStore {
    /// V2 列表隔离单文件错误；旧 `list_snippets` 行为保持不变。
    pub fn list_snippet_documents(&self) -> FileStoreResult<SnippetDocumentList> {
        self.files.recover_pending_transactions()?;
        let directory = self.files.path_for(SNIPPETS_RELATIVE_DIR)?;
        let entries = match fs::read_dir(directory) {
            Ok(entries) => entries,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(SnippetDocumentList {
                    snippets: Vec::new(),
                    warnings: Vec::new(),
                });
            }
            Err(error) => return Err(error.into()),
        };
        let mut snippets = Vec::new();
        let mut warnings = Vec::new();
        for entry_result in entries {
            let entry = match entry_result {
                Ok(entry) => entry,
                Err(error) => {
                    warnings.push(SnippetDocumentWarning {
                        file_name: "<directory-entry>".to_owned(),
                        message: error.to_string(),
                    });
                    continue;
                }
            };
            let file_name = entry.file_name().to_string_lossy().into_owned();
            let is_file = match entry.file_type() {
                Ok(file_type) => file_type.is_file(),
                Err(error) => {
                    warnings.push(SnippetDocumentWarning {
                        file_name,
                        message: error.to_string(),
                    });
                    continue;
                }
            };
            if !is_file || entry.path().extension().and_then(|value| value.to_str()) != Some("toml")
            {
                continue;
            }
            let Some(snippet_id) = entry
                .path()
                .file_stem()
                .and_then(|value| value.to_str())
                .map(str::to_owned)
            else {
                continue;
            };
            match self.read_snippet(&snippet_id) {
                Ok(snippet) => snippets.push(snippet),
                Err(error) => warnings.push(SnippetDocumentWarning {
                    file_name,
                    message: error.to_string(),
                }),
            }
        }
        sort_snippets(&mut snippets);
        warnings.sort_by(|left, right| left.file_name.cmp(&right.file_name));
        Ok(SnippetDocumentList { snippets, warnings })
    }

    /// 读取 typed 片段和稳定 revision，不修改源文件。
    pub fn read_snippet_document(
        &self,
        snippet_id: &str,
    ) -> FileStoreResult<SnippetDocumentSnapshot> {
        self.files.recover_pending_transactions()?;
        let relative_path = snippet_relative_path(snippet_id)?;
        let source = fs::read_to_string(self.files.path_for(&relative_path)?)?;
        let snippet = self
            .read_snippet(snippet_id)
            .map_err(|error| with_document_path(error, &relative_path))?;
        Ok(SnippetDocumentSnapshot {
            snippet,
            revision: content_revision(&source),
        })
    }

    /// 在 file-store 锁内校验 revision 并只补丁已拥有字段。
    pub fn patch_snippet_document(
        &self,
        snippet_id: &str,
        patch: &SnippetDocumentPatch,
    ) -> FileStoreResult<SnippetDocumentSnapshot> {
        let relative_path = snippet_relative_path(snippet_id)?;
        let change_set_id = format!("snippet-document-{}", uuid::Uuid::new_v4());
        self.files
            .run_transaction(&change_set_id, &super::timestamp_now(), |transaction| {
                let source = transaction.read_to_string(&relative_path)?;
                if content_revision(&source) != patch.expected_revision {
                    return Err(FileStoreError::RevisionConflict(relative_path.clone()));
                }
                crate::models::snippet::validate_snippet_metadata_contract(
                    patch.risk.as_deref(),
                    patch.default_action.as_deref(),
                    &patch.variables,
                    &patch.context_bindings,
                )
                .map_err(FileStoreError::TomlEncode)?;
                let mut document = DocumentMut::from_str(&source)
                    .map_err(|error| FileStoreError::TomlEncode(error.to_string()))?;
                document["title"] = value(&patch.title);
                match patch.description.as_deref() {
                    Some(description) => document["description"] = value(description),
                    None => {
                        document.remove("description");
                    }
                }
                document["command"] = value(&patch.command);
                document["tags"] =
                    Item::Value(Array::from_iter(patch.tags.iter().map(String::as_str)).into());
                document["scope"] = value(patch.scope.as_str());
                document["sort_order"] = value(patch.sort_order);
                document["updated_at"] = value(&patch.updated_at);
                patch_owned_metadata(&mut document, patch)?;
                transaction.write(&relative_path, document.to_string().into_bytes())
            })?;
        self.read_snippet_document(snippet_id)
    }
}

#[derive(Serialize)]
#[serde(rename_all = "snake_case")]
struct OwnedMetadata<'a> {
    category: &'a Option<String>,
    risk: &'a Option<String>,
    default_action: &'a Option<String>,
    variables: Vec<OwnedVariable<'a>>,
    context_bindings: Vec<OwnedContextBinding<'a>>,
    derived_from: &'a Option<String>,
}

#[derive(Serialize)]
struct OwnedVariable<'a> {
    name: &'a str,
    label: &'a str,
    description: &'a str,
    kind: &'a str,
    required: bool,
    default_value: &'a Option<String>,
    suggestions: &'a [String],
    validation: &'a Option<String>,
    render_strategy: &'a str,
    sensitive: bool,
}

#[derive(Serialize)]
struct OwnedContextBinding<'a> {
    kind: crate::models::snippet::SnippetContextBindingKind,
    target_id: &'a Option<String>,
}

fn patch_owned_metadata(
    document: &mut DocumentMut,
    patch: &SnippetDocumentPatch,
) -> FileStoreResult<()> {
    let encoded = toml::to_string(&OwnedMetadata {
        category: &patch.category,
        risk: &patch.risk,
        default_action: &patch.default_action,
        variables: patch
            .variables
            .iter()
            .map(|variable| OwnedVariable {
                name: &variable.name,
                label: &variable.label,
                description: &variable.description,
                kind: &variable.kind,
                required: variable.required,
                default_value: &variable.default_value,
                suggestions: &variable.suggestions,
                validation: &variable.validation,
                render_strategy: &variable.render_strategy,
                sensitive: variable.sensitive,
            })
            .collect(),
        context_bindings: patch
            .context_bindings
            .iter()
            .map(|binding| OwnedContextBinding {
                kind: binding.kind,
                target_id: &binding.target_id,
            })
            .collect(),
        derived_from: &patch.derived_from,
    })
    .map_err(|error| FileStoreError::TomlEncode(error.to_string()))?;
    let metadata = DocumentMut::from_str(&encoded)
        .map_err(|error| FileStoreError::TomlEncode(error.to_string()))?;
    for key in [
        "category",
        "risk",
        "default_action",
        "variables",
        "context_bindings",
        "derived_from",
    ] {
        document.remove(key);
        if let Some(item) = metadata.get(key) {
            document[key] = item.clone();
        }
    }
    Ok(())
}

fn content_revision(source: &str) -> String {
    format!("sha256:{:x}", Sha256::digest(source.as_bytes()))
}

fn with_document_path(error: FileStoreError, _path: &std::path::Path) -> FileStoreError {
    error
}
