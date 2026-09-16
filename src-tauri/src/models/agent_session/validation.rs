//! Agent session 基础文本校验。
//!
//! @author kongweiguang

use serde::{Serialize, Serializer};

use super::AgentSessionScope;

/// 会话 ID 只允许路径安全的 ASCII 字符，避免它被用于目录穿越或平台相关路径。
pub(super) fn is_valid_agent_session_id(value: &str) -> bool {
    let value = value.trim();
    !value.is_empty()
        && value.len() <= 128
        && value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-'))
}

/// 可选文本在模型边界统一 trim，空白值收敛为 None 以保持序列化稳定。
pub(super) fn normalize_optional_text(value: String) -> Option<String> {
    let value = value.trim();
    if value.is_empty() {
        None
    } else {
        Some(value.to_owned())
    }
}

/// 将兼容保留的 scope 字段规范化为 global，避免旧 Tab metadata 让 Agent 自行
/// 误判授权范围；Option 形态仍保留以便反序列化旧 session 文件。
pub(super) fn serialize_global_agent_scope<S>(
    _scope: &Option<AgentSessionScope>,
    serializer: S,
) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    AgentSessionScope::Global.serialize(serializer)
}
