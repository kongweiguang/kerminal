//! 终端敏感输入自动响应与脱敏规则。
//!
//! @author kongweiguang

use std::io::Write;

use crate::models::terminal::{TerminalSecretInputEntry, TerminalSecretInputPlan};

use super::{text::next_char_boundary, SharedWriterHandle};

const CLEAR_CURRENT_TERMINAL_LINE: &str = "\r\x1b[2K";

pub(super) struct TerminalSecretInputResponder {
    entries: Vec<TerminalSecretInputResponderEntry>,
    held_prompt_output: String,
    held_redaction_output: String,
    marker_buffer: String,
    pending_prompt_redactions: Vec<String>,
    redact_values: Vec<String>,
}

struct TerminalSecretInputResponderEntry {
    max_responses: usize,
    prompt_markers: Vec<String>,
    response: String,
    responses_sent: usize,
}

impl TerminalSecretInputResponder {
    pub(super) fn new(config: impl Into<TerminalSecretInputPlan>) -> Self {
        let config = config.into();
        let redact_values = config.redact_values();
        let entries = config
            .entries
            .into_iter()
            .filter_map(TerminalSecretInputResponderEntry::from_entry)
            .collect();
        Self {
            entries,
            held_prompt_output: String::new(),
            held_redaction_output: String::new(),
            marker_buffer: String::new(),
            pending_prompt_redactions: Vec::new(),
            redact_values,
        }
    }

    pub(super) fn observe_and_maybe_respond(&mut self, data: &str, writer: &SharedWriterHandle) {
        if !self.entries.iter().any(|entry| entry.can_respond()) {
            return;
        }

        self.marker_buffer.push_str(&data.to_ascii_lowercase());
        trim_marker_buffer(&mut self.marker_buffer);

        let Some(entry_index) = self.best_matching_entry_index() else {
            return;
        };
        let entry = &mut self.entries[entry_index];

        if let Ok(mut writer) = writer.lock() {
            let _ = writer.write_all(entry.response.as_bytes());
            let _ = writer.write_all(b"\r");
            let _ = writer.flush();
        }
        self.pending_prompt_redactions = entry.prompt_markers.clone();
        entry.responses_sent = entry.responses_sent.saturating_add(1);
        self.marker_buffer.clear();
    }

    fn best_matching_entry_index(&self) -> Option<usize> {
        let mut best: Option<(usize, PromptMatchStrength)> = None;
        for (index, entry) in self.entries.iter().enumerate() {
            if !entry.can_respond() {
                continue;
            }
            let Some(strength) =
                secret_prompt_match_strength(&self.marker_buffer, &entry.prompt_markers)
            else {
                continue;
            };
            if best.is_none_or(|(_, best_strength)| strength > best_strength) {
                best = Some((index, strength));
            }
        }
        best.map(|(index, _)| index)
    }

    /// 对每个 PTY 输出分片进行流式脱敏，并暂存可能跨分片的敏感值前缀。
    ///
    /// PTY 不保证把回显密码放在同一个读分片中；宁可暂缓发送一个可能的前缀，也不能让
    /// 前端、快照或日志在下一分片到达前看见原文。普通提示片段仍沿用原有的单独暂存策略。
    pub(super) fn redact_output(&mut self, data: &str) -> String {
        let mut combined = std::mem::take(&mut self.held_redaction_output);
        if !self.held_prompt_output.is_empty() {
            combined.push_str(&self.held_prompt_output);
            self.held_prompt_output.clear();
        }
        combined.push_str(data);

        let mut redacted = combined;
        for value in &self.redact_values {
            redacted = redacted.replace(value, "[已脱敏]");
        }
        if let Some((safe_output, held_output)) =
            split_potential_redaction_fragment(&redacted, &self.redact_values)
        {
            redacted = safe_output;
            self.held_redaction_output = held_output;
        }
        if !self.pending_prompt_redactions.is_empty() {
            let before_prompt_redaction = redacted.clone();
            redacted = redact_prompt_markers(&redacted, &self.pending_prompt_redactions);
            if redacted == before_prompt_redaction {
                redacted.clear();
            }
            self.pending_prompt_redactions.clear();
            return format!("{CLEAR_CURRENT_TERMINAL_LINE}{redacted}");
        }

        if self.entries.iter().any(|entry| entry.can_respond()) {
            if let Some((safe_output, held_output)) =
                split_potential_prompt_fragment(&redacted, &self.active_prompt_markers())
            {
                self.held_prompt_output = held_output;
                return safe_output;
            }
        }
        redacted
    }

    /// 在 PTY EOF 后以安全占位结束未决的敏感前缀。
    ///
    /// 不把无法确认完整匹配的尾部重新输出，因为它可能正是被截断的密码；代价是极少量
    /// 普通文本尾部会显示为脱敏占位，但不会把敏感片段泄露到终端事件。
    pub(super) fn finish_output(&mut self) -> String {
        self.held_prompt_output.clear();
        self.pending_prompt_redactions.clear();
        if std::mem::take(&mut self.held_redaction_output).is_empty() {
            String::new()
        } else {
            "[已脱敏]".to_owned()
        }
    }

    fn active_prompt_markers(&self) -> Vec<String> {
        self.entries
            .iter()
            .filter(|entry| entry.can_respond())
            .flat_map(|entry| entry.prompt_markers.iter().cloned())
            .collect()
    }
}

impl TerminalSecretInputResponderEntry {
    fn from_entry(entry: TerminalSecretInputEntry) -> Option<Self> {
        let prompt_markers = entry
            .prompt_markers
            .into_iter()
            .map(|marker| marker.to_ascii_lowercase())
            .filter(|marker| !marker.trim().is_empty())
            .collect::<Vec<_>>();
        if entry.response.is_empty() || entry.max_responses == 0 || prompt_markers.is_empty() {
            return None;
        }
        Some(Self {
            max_responses: entry.max_responses,
            prompt_markers,
            response: entry.response,
            responses_sent: 0,
        })
    }

    fn can_respond(&self) -> bool {
        self.responses_sent < self.max_responses
    }
}

#[doc(hidden)]
pub mod rules {
    /// 判断终端输出缓冲区当前行是否匹配敏感输入提示。
    pub fn secret_prompt_matches(buffer: &str, prompt_markers: &[String]) -> bool {
        super::secret_prompt_match_strength(buffer, prompt_markers).is_some()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum PromptMatchStrength {
    GenericFallback,
    Specific,
}

fn secret_prompt_match_strength(
    buffer: &str,
    prompt_markers: &[String],
) -> Option<PromptMatchStrength> {
    let visible_buffer = strip_terminal_controls(buffer);
    let prompt_line = visible_buffer
        .rsplit(['\r', '\n'])
        .next()
        .unwrap_or(visible_buffer.as_str())
        .trim_end();
    if prompt_line.is_empty() {
        return None;
    }

    prompt_markers
        .iter()
        .filter_map(|marker| prompt_line_match_strength(prompt_line, marker))
        .max()
}

fn prompt_line_match_strength(prompt_line: &str, marker: &str) -> Option<PromptMatchStrength> {
    let marker = marker.trim();
    if marker.is_empty() {
        return None;
    }
    if looks_like_password_history_line(prompt_line) {
        return None;
    }
    if marker == "password:" {
        return generic_password_prompt_line(prompt_line)
            .then_some(PromptMatchStrength::GenericFallback);
    }
    (prompt_line == marker).then_some(PromptMatchStrength::Specific)
}

fn looks_like_password_history_line(prompt_line: &str) -> bool {
    const FALSE_POSITIVE_FRAGMENTS: &[&str] = &[
        "accepted password",
        "bad password",
        "failed password",
        "failure password",
        "invalid password",
        "last failed",
        "password changed",
        "password expired",
    ];

    FALSE_POSITIVE_FRAGMENTS
        .iter()
        .any(|fragment| prompt_line.contains(fragment))
}

fn generic_password_prompt_line(prompt_line: &str) -> bool {
    prompt_line == "password:"
        || prompt_line.ends_with("'s password:")
        || prompt_line.starts_with("enter password")
        || prompt_line.starts_with("password for ")
}

fn strip_terminal_controls(input: &str) -> String {
    let mut output = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();

    while let Some(character) = chars.next() {
        if character == '\u{1b}' {
            consume_escape_sequence(&mut chars);
            continue;
        }
        if character == '\u{7}' {
            continue;
        }
        if character.is_control() && character != '\r' && character != '\n' && character != '\t' {
            continue;
        }
        output.push(character);
    }

    output
}

fn consume_escape_sequence<I>(chars: &mut std::iter::Peekable<I>)
where
    I: Iterator<Item = char>,
{
    match chars.peek().copied() {
        Some(']') => {
            let _ = chars.next();
            consume_osc_sequence(chars);
        }
        Some('[') => {
            let _ = chars.next();
            consume_csi_sequence(chars);
        }
        Some(_) => {
            let _ = chars.next();
        }
        None => {}
    }
}

fn consume_osc_sequence<I>(chars: &mut std::iter::Peekable<I>)
where
    I: Iterator<Item = char>,
{
    while let Some(character) = chars.next() {
        if character == '\u{7}' {
            break;
        }
        if character == '\u{1b}' && chars.peek().copied() == Some('\\') {
            let _ = chars.next();
            break;
        }
    }
}

fn consume_csi_sequence<I>(chars: &mut std::iter::Peekable<I>)
where
    I: Iterator<Item = char>,
{
    for character in chars.by_ref() {
        if ('@'..='~').contains(&character) {
            break;
        }
    }
}

fn trim_marker_buffer(buffer: &mut String) {
    const MAX_MARKER_BUFFER_BYTES: usize = 1024;
    if buffer.len() <= MAX_MARKER_BUFFER_BYTES {
        return;
    }

    let drain_end = next_char_boundary(buffer, buffer.len() - MAX_MARKER_BUFFER_BYTES);
    buffer.drain(..drain_end);
}

fn redact_prompt_markers(data: &str, prompt_markers: &[String]) -> String {
    let lowered = data.to_ascii_lowercase();
    let mut ranges = Vec::<(usize, usize)>::new();

    for marker in prompt_markers
        .iter()
        .map(|marker| marker.trim())
        .filter(|marker| !marker.is_empty())
    {
        let mut search_start = 0;
        while let Some(relative_index) = lowered[search_start..].find(marker) {
            let start = search_start + relative_index;
            let mut end = start + marker.len();
            while end < lowered.len() {
                let Some(character) = lowered[end..].chars().next() else {
                    break;
                };
                if character != ' ' && character != '\t' {
                    break;
                }
                end += character.len_utf8();
            }
            let line_start = lowered[..start]
                .rfind(['\r', '\n'])
                .map(|index| index + 1)
                .unwrap_or(0);
            ranges.push((line_start, end));
            search_start = end;
        }
    }

    if ranges.is_empty() {
        return data.to_owned();
    }

    ranges.sort_unstable_by_key(|(start, end)| (*start, *end));
    let mut merged = Vec::<(usize, usize)>::new();
    for (start, end) in ranges {
        if let Some((_, previous_end)) = merged.last_mut() {
            if start <= *previous_end {
                *previous_end = (*previous_end).max(end);
                continue;
            }
        }
        merged.push((start, end));
    }

    let mut result = String::with_capacity(data.len());
    let mut cursor = 0;
    for (start, end) in merged {
        result.push_str(&data[cursor..start]);
        cursor = end;
    }
    result.push_str(&data[cursor..]);
    result
}

fn split_potential_prompt_fragment(
    data: &str,
    prompt_markers: &[String],
) -> Option<(String, String)> {
    let tail_start = data.rfind(['\r', '\n']).map(|index| index + 1).unwrap_or(0);
    let tail = &data[tail_start..];
    if !looks_like_prompt_fragment(tail, prompt_markers) {
        return None;
    }

    Some((data[..tail_start].to_owned(), tail.to_owned()))
}

/// 从输出尾部提取任一敏感值的非完整前缀，留待下一分片后再决定是否展示。
///
/// 仅保存严格小于完整敏感值的前缀：完整匹配已经在调用方替换，空值和单字节值不需要
/// 暂存。按 UTF-8 边界切分，避免中文凭据或本地化输出产生无效字符串。
fn split_potential_redaction_fragment(
    data: &str,
    redact_values: &[String],
) -> Option<(String, String)> {
    let held_length = redact_values
        .iter()
        .filter(|value| value.len() > 1)
        .flat_map(|value| {
            value
                .char_indices()
                .skip(1)
                .map(|(prefix_end, _)| &value[..prefix_end])
        })
        .filter(|prefix| data.ends_with(*prefix))
        .map(str::len)
        .max()?;

    let split_at = data.len().saturating_sub(held_length);
    Some((data[..split_at].to_owned(), data[split_at..].to_owned()))
}

fn looks_like_prompt_fragment(fragment: &str, prompt_markers: &[String]) -> bool {
    let visible_fragment = strip_terminal_controls(fragment);
    let visible_fragment = visible_fragment.trim_end().to_ascii_lowercase();
    if visible_fragment.len() < 8 {
        return false;
    }
    if prompt_markers
        .iter()
        .any(|marker| marker.trim().eq_ignore_ascii_case("password:"))
        && generic_password_prompt_fragment(&visible_fragment)
    {
        return true;
    }

    prompt_markers
        .iter()
        .map(|marker| marker.trim().to_ascii_lowercase())
        .filter(|marker| marker.len() > visible_fragment.len())
        .any(|marker| marker.starts_with(&visible_fragment))
}

fn generic_password_prompt_fragment(fragment: &str) -> bool {
    if looks_like_password_history_line(fragment) {
        return false;
    }
    fragment == "password"
        || fragment == "password:"
        || fragment.starts_with("enter password")
        || fragment.starts_with("password for ")
        || generic_owner_password_prompt_fragment(fragment)
        || fragment.ends_with("'s pass")
        || fragment.ends_with("'s password")
        || fragment.ends_with("'s password:")
}

fn generic_owner_password_prompt_fragment(fragment: &str) -> bool {
    let Some(owner_suffix_start) = fragment.rfind("'s ") else {
        return false;
    };
    let suffix = &fragment[owner_suffix_start + "'s ".len()..];
    "password:".starts_with(suffix)
}

#[cfg(test)]
mod tests {
    use super::TerminalSecretInputResponder;
    use crate::models::terminal::{TerminalSecretInputEntry, TerminalSecretInputPlan};

    /// 验证密码回显被 PTY 拆到相邻分片时，前端只会收到脱敏占位而不是可拼接的原文。
    #[test]
    fn redacts_sensitive_value_split_across_adjacent_output_chunks() {
        let secret = "s3cr3tPtyPassword123";
        let mut responder = responder_with_secret(secret);

        assert_eq!(responder.redact_output("echoed s3cr3t"), "echoed ");
        assert_eq!(
            responder.redact_output("PtyPassword123 auth-ok\\r\\n"),
            "[已脱敏] auth-ok\\r\\n"
        );
    }

    /// 验证流结束在敏感值中间时宁可显示占位，也不释放能够泄露部分凭据的缓存尾部。
    #[test]
    fn masks_unfinished_sensitive_prefix_at_output_end() {
        let mut responder = responder_with_secret("terminalSecret456");

        assert_eq!(responder.redact_output("echoed terminalSec"), "echoed ");
        assert_eq!(responder.finish_output(), "[已脱敏]");
    }

    /// 为跨分片脱敏测试构造最小响应计划，避免测试依赖任何 PTY 或主机环境。
    fn responder_with_secret(secret: &str) -> TerminalSecretInputResponder {
        TerminalSecretInputResponder::new(TerminalSecretInputPlan {
            entries: vec![TerminalSecretInputEntry {
                id: "test".to_owned(),
                label: "test".to_owned(),
                prompt_markers: vec!["password:".to_owned()],
                response: secret.to_owned(),
                redact_values: vec![secret.to_owned()],
                max_responses: 1,
            }],
        })
    }
}
