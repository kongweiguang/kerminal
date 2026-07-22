//! 脚本片段 IPC 数据模型。
//!
//! @author kongweiguang

use serde::{Deserialize, Serialize};

/// 脚本片段适用范围。
#[derive(Debug, Clone, Copy, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SnippetScope {
    /// 通用于本地和 SSH 终端。
    #[default]
    Any,
    /// 仅建议用于本地终端。
    Local,
    /// 仅建议用于 SSH 远程终端。
    Ssh,
}

impl SnippetScope {
    /// 返回数据库中保存的稳定文本。
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Any => "any",
            Self::Local => "local",
            Self::Ssh => "ssh",
        }
    }
}

impl TryFrom<&str> for SnippetScope {
    type Error = String;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        match value {
            "any" => Ok(Self::Any),
            "local" => Ok(Self::Local),
            "ssh" => Ok(Self::Ssh),
            _ => Err(format!("未知脚本片段作用域: {value}")),
        }
    }
}

/// 可复用命令或脚本片段。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommandSnippet {
    /// 稳定片段 id。
    pub id: String,
    /// 用户可见标题。
    pub title: String,
    /// 可选说明。
    pub description: Option<String>,
    /// 片段命令内容；不会在创建后自动执行。
    pub command: String,
    /// 标签，用于搜索和分组。
    pub tags: Vec<String>,
    /// 适用范围。
    pub scope: SnippetScope,
    /// 列表排序字段。
    pub sort_order: i64,
    /// 创建时间。
    pub created_at: String,
    /// 更新时间。
    pub updated_at: String,
    /// 用户分类；旧 v1 文件缺省时不推断。
    pub category: Option<String>,
    /// 风险标注；旧 v1 文件缺省时由统一投影计算。
    pub risk: Option<String>,
    /// 默认动作；缺省时保持只插入的兼容策略。
    pub default_action: Option<String>,
    /// 显式变量声明；旧 v1 文件缺省为空。
    #[serde(default)]
    pub variables: Vec<SnippetCatalogVariable>,
    /// 可用上下文绑定；旧 v1 文件缺省为空。
    #[serde(default)]
    pub context_bindings: Vec<SnippetContextBinding>,
    /// 从内置片段复制时记录的稳定来源 id。
    pub derived_from: Option<String>,
}

/// 用户片段可用上下文的绑定类型。
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SnippetContextBindingKind {
    Global,
    Workspace,
    Host,
    HostGroup,
}

/// 用户片段的可用上下文绑定。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SnippetContextBinding {
    pub kind: SnippetContextBindingKind,
    pub target_id: Option<String>,
}

/// 脚本片段列表过滤请求。
#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SnippetListRequest {
    /// 搜索关键词，会匹配标题、说明、命令和标签。
    pub query: Option<String>,
    /// 可选作用域过滤。
    pub scope: Option<SnippetScope>,
    /// 可选标签过滤。
    pub tag: Option<String>,
}

/// 创建脚本片段请求。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SnippetCreateRequest {
    /// 用户可见标题。
    pub title: String,
    /// 片段命令内容。
    pub command: String,
    /// 可选说明。
    pub description: Option<String>,
    /// 标签。
    #[serde(default)]
    pub tags: Vec<String>,
    /// 适用范围，默认通用。
    #[serde(default)]
    pub scope: SnippetScope,
}

/// 更新脚本片段请求。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SnippetUpdateRequest {
    /// 需要更新的片段 id。
    pub id: String,
    /// 用户可见标题。
    pub title: String,
    /// 片段命令内容。
    pub command: String,
    /// 可选说明。
    pub description: Option<String>,
    /// 标签。
    #[serde(default)]
    pub tags: Vec<String>,
    /// 适用范围。
    #[serde(default)]
    pub scope: SnippetScope,
    /// 列表排序字段。
    pub sort_order: i64,
}

/// 批量导入片段的文件字段；ID、排序和时间由服务端统一生成。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SnippetImportCandidate {
    pub title: String,
    pub command: String,
    pub description: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub scope: SnippetScope,
    pub category: Option<String>,
    pub risk: Option<String>,
    pub default_action: Option<String>,
    #[serde(default)]
    pub variables: Vec<SnippetCatalogVariable>,
    #[serde(default)]
    pub context_bindings: Vec<SnippetContextBinding>,
    pub derived_from: Option<String>,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SnippetCatalogOrigin {
    User,
    Builtin,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SnippetCatalogVariable {
    pub name: String,
    pub label: String,
    pub description: String,
    pub kind: String,
    pub required: bool,
    pub default_value: Option<String>,
    pub suggestions: Vec<String>,
    pub validation: Option<String>,
    pub render_strategy: String,
    pub sensitive: bool,
}

/// 校验用户文件和编辑器补丁共享的片段元数据合同，阻止未知字符串越过 IPC 边界。
pub fn validate_snippet_metadata_contract(
    risk: Option<&str>,
    default_action: Option<&str>,
    variables: &[SnippetCatalogVariable],
    context_bindings: &[SnippetContextBinding],
) -> Result<(), String> {
    if risk.is_some_and(|value| !matches!(value, "inspect" | "change" | "destructive" | "unknown"))
    {
        return Err("risk 必须是 inspect/change/destructive/unknown".to_owned());
    }
    if default_action.is_some_and(|value| !matches!(value, "insert" | "run")) {
        return Err("default_action 必须是 insert/run".to_owned());
    }
    for variable in variables {
        if variable.name.trim().is_empty() || variable.label.trim().is_empty() {
            return Err("变量 name 和 label 不能为空".to_owned());
        }
        if !matches!(
            variable.kind.as_str(),
            "text"
                | "path"
                | "port"
                | "integer"
                | "host"
                | "url"
                | "service"
                | "container"
                | "enum"
                | "secret"
                | "raw"
        ) {
            return Err(format!("未知变量类型: {}", variable.kind));
        }
        if !matches!(
            variable.render_strategy.as_str(),
            "shellArg" | "validatedRaw" | "literal"
        ) {
            return Err(format!("未知变量渲染策略: {}", variable.render_strategy));
        }
        if variable.render_strategy == "validatedRaw"
            && !matches!(
                variable.kind.as_str(),
                "port" | "integer" | "host" | "service" | "container" | "enum"
            )
        {
            return Err("validatedRaw 只能用于受控白名单变量类型".to_owned());
        }
        if (variable.kind == "secret" || variable.sensitive)
            && (variable
                .default_value
                .as_deref()
                .is_some_and(|value| !value.is_empty())
                || !variable.suggestions.is_empty())
        {
            return Err("敏感变量禁止保存 default_value 或 suggestions".to_owned());
        }
        if variable.validation.as_deref().is_some_and(|pattern| {
            pattern.len() > 128
                || pattern
                    .chars()
                    .any(|value| matches!(value, '(' | ')' | '{' | '}' | '|' | '\r' | '\n'))
                || pattern.contains("(?")
                || (1..=9).any(|digit| pattern.contains(&format!("\\{digit}")))
        }) {
            return Err("validation 只能使用无分组、无分支和无反向引用的短正则".to_owned());
        }
    }
    if context_bindings.iter().any(|binding| {
        binding.kind != SnippetContextBindingKind::Global
            && binding
                .target_id
                .as_deref()
                .is_none_or(|value| value.trim().is_empty())
    }) {
        return Err("非 global 上下文绑定必须提供 target_id".to_owned());
    }
    Ok(())
}

/// 右栏、Quick Open 和命令提示共享的目录投影。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SnippetCatalogItem {
    pub id: String,
    pub origin: SnippetCatalogOrigin,
    pub title: String,
    pub description: String,
    pub template: String,
    pub category: String,
    pub pack: String,
    pub tags: Vec<String>,
    pub scope: SnippetScope,
    pub platforms: Vec<String>,
    pub shells: Vec<String>,
    pub capabilities: Vec<String>,
    pub risk: String,
    pub sensitive: bool,
    pub duration: String,
    pub default_action: String,
    pub variables: Vec<SnippetCatalogVariable>,
    pub context_bindings: Vec<SnippetContextBinding>,
    pub catalog_version: Option<String>,
    pub source_name: Option<String>,
    pub source_url: Option<String>,
    pub deprecated: bool,
    pub favorite: bool,
    pub use_count: u64,
    pub last_used_at_unix_ms: Option<i64>,
    pub sort_order: i64,
    pub updated_at: String,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SnippetCatalogListRequest {
    pub query: Option<String>,
    pub origin: Option<SnippetCatalogOrigin>,
    pub scope: Option<SnippetScope>,
    pub limit: Option<usize>,
}
