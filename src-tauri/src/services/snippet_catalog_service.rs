//! 内置与用户片段的统一只读目录投影。
//!
//! @author kongweiguang

use std::{
    collections::{HashMap, HashSet},
    sync::LazyLock,
};

use regex::Regex;

use crate::{
    error::AppResult,
    models::snippet::{
        CommandSnippet, SnippetCatalogItem, SnippetCatalogListRequest, SnippetCatalogOrigin,
        SnippetCatalogVariable, SnippetScope,
    },
    services::{
        snippet_catalog_registry::{self, StaticSnippetCatalogItem},
        snippet_service::SnippetService,
    },
    storage::{snippet_preferences::SnippetPreferenceOrigin, CommandSqliteStore},
};

const DEFAULT_LIMIT: usize = 200;
const MAX_LIMIT: usize = 2_000;
static LEGACY_PLACEHOLDER: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}")
        .expect("legacy snippet placeholder regex must compile")
});

pub fn list_catalog(
    snippets: &SnippetService,
    storage: &CommandSqliteStore,
    request: SnippetCatalogListRequest,
) -> AppResult<Vec<SnippetCatalogItem>> {
    let query = request
        .query
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_lowercase);
    let mut items = Vec::new();
    if request.origin != Some(SnippetCatalogOrigin::User) {
        items.extend(snippet_catalog_registry::all().iter().map(project_builtin));
    }
    if request.origin != Some(SnippetCatalogOrigin::Builtin) {
        items.extend(
            snippets
                .list_snippet_documents()?
                .snippets
                .into_iter()
                .map(project_user),
        );
    }
    // 收藏与使用统计是增强信息；偏好库故障不能让命令目录和用户片段一起不可用。
    let preferences = storage.list_snippet_preferences().unwrap_or_default();
    let preference_by_key = preferences
        .iter()
        .map(|preference| {
            (
                (preference.origin, preference.snippet_id.as_str()),
                preference,
            )
        })
        .collect::<HashMap<_, _>>();
    for item in &mut items {
        let expected_origin = match item.origin {
            SnippetCatalogOrigin::User => SnippetPreferenceOrigin::User,
            SnippetCatalogOrigin::Builtin => SnippetPreferenceOrigin::Builtin,
        };
        if let Some(preference) = preference_by_key.get(&(expected_origin, item.id.as_str())) {
            item.favorite = preference.favorite;
            item.use_count = preference.use_count;
            item.last_used_at_unix_ms = preference.last_used_at_unix_ms;
        }
    }
    items.retain(|item| {
        request
            .scope
            .is_none_or(|scope| item.scope == scope || item.scope == SnippetScope::Any)
            && query
                .as_ref()
                .is_none_or(|query| matches_query(item, query))
    });
    items.sort_by(|left, right| {
        pack_rank(&left.pack)
            .cmp(&pack_rank(&right.pack))
            .then_with(|| left.pack.cmp(&right.pack))
            .then_with(|| left.category.cmp(&right.category))
            .then_with(|| left.sort_order.cmp(&right.sort_order))
            .then_with(|| left.id.cmp(&right.id))
    });
    items.truncate(request.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT));
    Ok(items)
}

/// 验证收藏和使用反馈引用的来源与真实目录身份一致，拒绝孤儿或伪造偏好。
pub fn catalog_identity_exists(
    snippets: &SnippetService,
    origin: SnippetPreferenceOrigin,
    snippet_id: &str,
) -> AppResult<bool> {
    match origin {
        SnippetPreferenceOrigin::Builtin => {
            Ok(snippet_catalog_registry::by_id(snippet_id).is_some())
        }
        SnippetPreferenceOrigin::User => Ok(snippets
            .config()
            .snippet_by_id(snippet_id)
            .map_err(|error| crate::error::AppError::InvalidInput(error.to_string()))?
            .is_some()),
    }
}

fn pack_rank(pack: &str) -> u8 {
    if pack == "core" {
        0
    } else if pack == "mine" {
        1
    } else {
        2
    }
}

fn project_builtin(item: &StaticSnippetCatalogItem) -> SnippetCatalogItem {
    SnippetCatalogItem {
        id: item.id.to_owned(),
        origin: SnippetCatalogOrigin::Builtin,
        title: item.title.to_owned(),
        description: item.description.to_owned(),
        template: item.template.to_owned(),
        category: item.category.to_owned(),
        pack: item.pack.to_owned(),
        tags: strings(item.tags),
        scope: SnippetScope::try_from(item.scope).unwrap_or_default(),
        platforms: mask_values(
            item.platform_mask,
            &[(1, "windows"), (2, "macos"), (4, "linux")],
        ),
        shells: mask_values(
            item.shell_mask,
            &[
                (1, "bash"),
                (2, "zsh"),
                (4, "fish"),
                (8, "powerShell"),
                (16, "cmd"),
            ],
        ),
        capabilities: strings(item.capabilities),
        risk: item.risk.to_owned(),
        sensitive: item.sensitive,
        duration: item.duration.to_owned(),
        default_action: item.default_action.to_owned(),
        variables: item
            .variables
            .iter()
            .map(|variable| SnippetCatalogVariable {
                name: variable.name.to_owned(),
                label: variable.label.to_owned(),
                description: variable.description.to_owned(),
                kind: variable.kind.to_owned(),
                required: variable.required,
                default_value: variable.default_value.map(str::to_owned),
                suggestions: strings(variable.suggestions),
                validation: variable.validation.map(str::to_owned),
                render_strategy: match variable.render_strategy {
                    "shell_arg" => "shellArg",
                    "validated_raw" => "validatedRaw",
                    value => value,
                }
                .to_owned(),
                sensitive: variable.sensitive,
            })
            .collect(),
        context_bindings: Vec::new(),
        catalog_version: Some(item.catalog_version.to_owned()),
        source_name: Some(item.source_name.to_owned()),
        source_url: Some(item.source_url.to_owned()),
        deprecated: item.deprecated,
        favorite: false,
        use_count: 0,
        last_used_at_unix_ms: None,
        sort_order: item.sort_order,
        updated_at: item.updated_at.to_owned(),
    }
}

fn project_user(item: CommandSnippet) -> SnippetCatalogItem {
    let variables = if item.variables.is_empty() {
        legacy_raw_variables(&item.command)
    } else {
        item.variables
    };
    let sensitive = variables
        .iter()
        .any(|variable| variable.sensitive || variable.kind == "secret");
    let risk = item.risk.unwrap_or_else(|| {
        if variables.iter().any(|variable| variable.kind == "raw") {
            "change".to_owned()
        } else {
            "unknown".to_owned()
        }
    });
    SnippetCatalogItem {
        id: item.id,
        origin: SnippetCatalogOrigin::User,
        title: item.title,
        description: item.description.unwrap_or_default(),
        template: item.command,
        category: item.category.unwrap_or_else(|| "user".to_owned()),
        pack: "mine".to_owned(),
        tags: item.tags,
        scope: item.scope,
        platforms: Vec::new(),
        shells: Vec::new(),
        capabilities: Vec::new(),
        risk,
        sensitive,
        duration: "instant".to_owned(),
        default_action: item.default_action.unwrap_or_else(|| "insert".to_owned()),
        variables,
        context_bindings: item.context_bindings,
        catalog_version: None,
        source_name: None,
        source_url: None,
        deprecated: false,
        favorite: false,
        use_count: 0,
        last_used_at_unix_ms: None,
        sort_order: item.sort_order,
        updated_at: item.updated_at,
    }
}

/// 旧 v1 文件没有变量声明；投影为显式 raw 合同，避免 UI 把模板误判为无参数命令。
fn legacy_raw_variables(template: &str) -> Vec<SnippetCatalogVariable> {
    let mut seen = HashSet::new();
    LEGACY_PLACEHOLDER
        .captures_iter(template)
        .filter_map(|captures| captures.get(1).map(|name| name.as_str()))
        .filter(|name| seen.insert((*name).to_owned()))
        .map(|name| SnippetCatalogVariable {
            name: name.to_owned(),
            label: name.to_owned(),
            description: "旧片段兼容变量，将按原始文本插入".to_owned(),
            kind: "raw".to_owned(),
            required: true,
            default_value: None,
            suggestions: Vec::new(),
            validation: None,
            render_strategy: "literal".to_owned(),
            sensitive: false,
        })
        .collect()
}

fn matches_query(item: &SnippetCatalogItem, query: &str) -> bool {
    item.title.to_lowercase().contains(query)
        || item.description.to_lowercase().contains(query)
        || item.template.to_lowercase().contains(query)
        || item.category.to_lowercase().contains(query)
        || item
            .tags
            .iter()
            .any(|tag| tag.to_lowercase().contains(query))
        || item
            .capabilities
            .iter()
            .any(|capability| capability.to_lowercase().contains(query))
}

fn strings(values: &[&str]) -> Vec<String> {
    values.iter().map(|value| (*value).to_owned()).collect()
}

fn mask_values(mask: u8, values: &[(u8, &str)]) -> Vec<String> {
    values
        .iter()
        .filter(|(bit, _)| mask & bit != 0)
        .map(|(_, value)| (*value).to_owned())
        .collect()
}
