//! 终端关键词高亮设置契约与安全校验。
//!
//! @author kongweiguang

use std::collections::HashSet;

use regex::Regex;
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

/// 全局关键词高亮规则上限，防止单个配置制造无界扫描成本。
pub const MAX_TERMINAL_KEYWORD_HIGHLIGHT_RULES: usize = 64;
/// 单条关键词按 Unicode 标量计数的最大长度。
pub const MAX_TERMINAL_KEYWORD_HIGHLIGHT_PATTERN_CHARS: usize = 256;
/// 单条备注按 Unicode 标量计数的最大长度。
pub const MAX_TERMINAL_KEYWORD_HIGHLIGHT_NOTE_CHARS: usize = 160;

/// 关键词匹配语义。
#[derive(Debug, Clone, Copy, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TerminalKeywordHighlightMatchMode {
    /// 按原文本片段匹配。
    #[default]
    Literal,
    /// 仅当 Unicode 单词边界完整时匹配。
    WholeWord,
    /// 使用前后端共同支持的 RE2 安全子集。
    Regex,
}

/// 深浅主题自适应色板或用户自定义颜色。
#[derive(Debug, Clone, Copy, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TerminalKeywordHighlightStyle {
    Red,
    Orange,
    /// 默认黄色在终端中具有较强可发现性，同时不携带错误语义。
    #[default]
    Yellow,
    Green,
    Cyan,
    Blue,
    Purple,
    Pink,
    Custom,
}

/// 单一主题下的可选前景色与背景色；缺失的一端沿用终端 ANSI 样式。
#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TerminalKeywordHighlightColorPair {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub foreground: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub background: Option<String>,
}

/// 自定义颜色分别保存浅色和深色值，跟随系统主题时无需改写配置。
#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TerminalKeywordHighlightCustomColors {
    #[serde(default)]
    pub light: TerminalKeywordHighlightColorPair,
    #[serde(default)]
    pub dark: TerminalKeywordHighlightColorPair,
}

/// 单条全局关键词高亮规则；数组顺序就是重叠匹配优先级。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TerminalKeywordHighlightRule {
    pub id: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    pub pattern: String,
    #[serde(default)]
    pub match_mode: TerminalKeywordHighlightMatchMode,
    #[serde(default)]
    pub case_sensitive: bool,
    #[serde(default)]
    pub note: String,
    #[serde(default)]
    pub style: TerminalKeywordHighlightStyle,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub custom_colors: Option<TerminalKeywordHighlightCustomColors>,
}

/// 普通终端的全局关键词高亮设置。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TerminalKeywordHighlightSettings {
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub rules: Vec<TerminalKeywordHighlightRule>,
}

impl Default for TerminalKeywordHighlightSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            rules: Vec::new(),
        }
    }
}

impl TerminalKeywordHighlightSettings {
    /// 校验持久化边界并规范颜色大小写；不重排规则，确保数组顺序仍是权威优先级。
    pub(crate) fn validated(mut self) -> AppResult<Self> {
        if self.rules.len() > MAX_TERMINAL_KEYWORD_HIGHLIGHT_RULES {
            return Err(AppError::InvalidInput(format!(
                "关键词高亮规则不能超过 {MAX_TERMINAL_KEYWORD_HIGHLIGHT_RULES} 条"
            )));
        }

        let mut ids = HashSet::with_capacity(self.rules.len());
        for rule in &mut self.rules {
            rule.id = rule.id.trim().to_string();
            if rule.id.is_empty() {
                return Err(AppError::InvalidInput(
                    "关键词高亮规则 ID 不能为空".to_string(),
                ));
            }
            if !ids.insert(rule.id.clone()) {
                return Err(AppError::InvalidInput(format!(
                    "关键词高亮规则 ID 重复：{}",
                    rule.id
                )));
            }
            validate_rule_text(rule)?;
            if rule.match_mode == TerminalKeywordHighlightMatchMode::Regex {
                validate_safe_regex(&rule.pattern)?;
            }
            if let Some(colors) = rule.custom_colors.as_mut() {
                normalize_custom_colors(colors)?;
            }
            if rule.style == TerminalKeywordHighlightStyle::Custom && rule.custom_colors.is_none() {
                return Err(AppError::InvalidInput(format!(
                    "关键词高亮规则 {} 缺少自定义颜色",
                    rule.id
                )));
            }
        }
        Ok(self)
    }
}

/// 文本长度按 Unicode 标量而不是 UTF-8 字节计算，避免中文与 emoji 更早触顶。
fn validate_rule_text(rule: &mut TerminalKeywordHighlightRule) -> AppResult<()> {
    if rule.pattern.trim().is_empty() {
        return Err(AppError::InvalidInput("关键词高亮内容不能为空".to_string()));
    }
    if rule.pattern.chars().count() > MAX_TERMINAL_KEYWORD_HIGHLIGHT_PATTERN_CHARS {
        return Err(AppError::InvalidInput(format!(
            "关键词高亮内容不能超过 {MAX_TERMINAL_KEYWORD_HIGHLIGHT_PATTERN_CHARS} 个字符"
        )));
    }
    rule.note = rule.note.trim().to_string();
    if rule.note.chars().count() > MAX_TERMINAL_KEYWORD_HIGHLIGHT_NOTE_CHARS {
        return Err(AppError::InvalidInput(format!(
            "关键词高亮备注不能超过 {MAX_TERMINAL_KEYWORD_HIGHLIGHT_NOTE_CHARS} 个字符"
        )));
    }
    Ok(())
}

/// 使用线性时间 regex 引擎编译共同子集，并拒绝零宽匹配与 RE2 不支持的回溯语法。
fn validate_safe_regex(pattern: &str) -> AppResult<()> {
    if contains_unsupported_group(pattern) || contains_backreference(pattern) {
        return Err(AppError::InvalidInput(
            "关键词高亮正则不支持回溯引用、前后查找或内联标志".to_string(),
        ));
    }
    let regex = Regex::new(pattern)
        .map_err(|error| AppError::InvalidInput(format!("关键词高亮正则无效：{error}")))?;
    const ZERO_WIDTH_PROBES: [&str; 8] = ["", "a", "0", "_", " ", "\n", "中", "ERROR"];
    if ZERO_WIDTH_PROBES.iter().any(|probe| {
        regex
            .find_iter(probe)
            .any(|found| found.start() == found.end())
    }) {
        return Err(AppError::InvalidInput(
            "关键词高亮正则不能产生空匹配".to_string(),
        ));
    }
    Ok(())
}

/// 只保留普通非捕获组 `(?:...)`；其它 `(?...)` 形式会在两端产生语义差异。
fn contains_unsupported_group(pattern: &str) -> bool {
    let bytes = pattern.as_bytes();
    let mut index = 0;
    while index + 1 < bytes.len() {
        if bytes[index] == b'(' && bytes[index + 1] == b'?' {
            let escaped = pattern[..index]
                .chars()
                .rev()
                .take_while(|character| *character == '\\')
                .count()
                % 2
                == 1;
            if !escaped && bytes.get(index + 2) != Some(&b':') {
                return true;
            }
        }
        index += 1;
    }
    false
}

/// 识别未被转义的 `\1` 至 `\9` 与 `\k`，双反斜杠后的数字仍视为普通文本。
fn contains_backreference(pattern: &str) -> bool {
    let bytes = pattern.as_bytes();
    for (index, byte) in bytes.iter().enumerate() {
        if !matches!(byte, b'1'..=b'9' | b'k') {
            continue;
        }
        let slash_count = bytes[..index]
            .iter()
            .rev()
            .take_while(|candidate| **candidate == b'\\')
            .count();
        if slash_count % 2 == 1 {
            return true;
        }
    }
    false
}

/// 自定义色以 `#RRGGBB` 存储；空字符串等价于未覆盖该端终端原色。
fn normalize_custom_colors(colors: &mut TerminalKeywordHighlightCustomColors) -> AppResult<()> {
    normalize_color_pair(&mut colors.light)?;
    normalize_color_pair(&mut colors.dark)?;
    if !has_color(&colors.light) || !has_color(&colors.dark) {
        return Err(AppError::InvalidInput(
            "自定义关键词高亮在浅色和深色主题下都至少需要一种颜色".to_string(),
        ));
    }
    Ok(())
}

/// 对一组前景/背景色应用同一契约，避免主题分支出现不一致的容错行为。
fn normalize_color_pair(pair: &mut TerminalKeywordHighlightColorPair) -> AppResult<()> {
    normalize_hex_color(&mut pair.foreground)?;
    normalize_hex_color(&mut pair.background)?;
    Ok(())
}

/// 颜色在存储层统一大写，减少主题热更新时由等价字符串触发的无效重扫。
fn normalize_hex_color(color: &mut Option<String>) -> AppResult<()> {
    let Some(value) = color.as_mut() else {
        return Ok(());
    };
    *value = value.trim().to_uppercase();
    if value.is_empty() {
        *color = None;
        return Ok(());
    }
    let valid = value.len() == 7
        && value.starts_with('#')
        && value[1..].bytes().all(|byte| byte.is_ascii_hexdigit());
    if !valid {
        return Err(AppError::InvalidInput(
            "关键词高亮颜色必须使用 #RRGGBB".to_string(),
        ));
    }
    Ok(())
}

/** 自定义主题只有配置了前景或背景时才具有可见效果。 */
fn has_color(pair: &TerminalKeywordHighlightColorPair) -> bool {
    pair.foreground.is_some() || pair.background.is_some()
}

/// serde 默认函数放在子模块内，避免扩大父设置模型的公开辅助函数表面。
fn default_true() -> bool {
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 构造最小有效规则，测试仅覆盖被修改的边界字段。
    fn rule(
        pattern: &str,
        match_mode: TerminalKeywordHighlightMatchMode,
    ) -> TerminalKeywordHighlightRule {
        TerminalKeywordHighlightRule {
            id: "rule-1".to_string(),
            enabled: true,
            pattern: pattern.to_string(),
            match_mode,
            case_sensitive: false,
            note: String::new(),
            style: TerminalKeywordHighlightStyle::Yellow,
            custom_colors: None,
        }
    }

    #[test]
    fn validates_literal_whole_word_and_safe_regex_modes() {
        for (pattern, match_mode) in [
            ("错误", TerminalKeywordHighlightMatchMode::Literal),
            ("server", TerminalKeywordHighlightMatchMode::WholeWord),
            (
                r"error|warn(?:ing)?",
                TerminalKeywordHighlightMatchMode::Regex,
            ),
        ] {
            TerminalKeywordHighlightSettings {
                enabled: true,
                rules: vec![rule(pattern, match_mode)],
            }
            .validated()
            .expect("valid highlight rule");
        }
    }

    #[test]
    fn rejects_unsafe_or_zero_width_regex() {
        for pattern in [r"(a)\1", r"(?=error)", r"(?<=error)x", r"a*"] {
            let error = TerminalKeywordHighlightSettings {
                enabled: true,
                rules: vec![rule(pattern, TerminalKeywordHighlightMatchMode::Regex)],
            }
            .validated()
            .expect_err("unsafe regex should fail");
            assert!(error.to_string().contains("关键词高亮"));
        }
    }

    #[test]
    fn rejects_duplicate_ids_and_invalid_custom_colors() {
        let mut custom = rule("warn", TerminalKeywordHighlightMatchMode::Literal);
        custom.style = TerminalKeywordHighlightStyle::Custom;
        custom.custom_colors = Some(TerminalKeywordHighlightCustomColors {
            light: TerminalKeywordHighlightColorPair {
                foreground: Some("#123456".to_string()),
                background: None,
            },
            dark: TerminalKeywordHighlightColorPair::default(),
        });
        assert!(TerminalKeywordHighlightSettings {
            enabled: true,
            rules: vec![custom],
        }
        .validated()
        .is_err());

        let duplicate = rule("warn", TerminalKeywordHighlightMatchMode::Literal);
        assert!(TerminalKeywordHighlightSettings {
            enabled: true,
            rules: vec![duplicate.clone(), duplicate],
        }
        .validated()
        .is_err());
    }
}
