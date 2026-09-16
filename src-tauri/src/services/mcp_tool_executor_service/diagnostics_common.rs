//! MCP 诊断类工具共享 helper。
//!
//! @author kongweiguang

use super::tool_examples::example_arguments_for;
use super::*;
use serde::Serialize;

pub(super) fn exposed_tool_definitions(tools: &[ToolDefinition]) -> Vec<&ToolDefinition> {
    tools
        .iter()
        .filter(|tool| tool.enabled && tool.exposed_to_mcp)
        .collect()
}

/// 构造可公开给 MCP host 的运行态诊断。
///
/// 底层错误可能包含路径、终端正文、Prompt、凭据或外部进程输出，因此这里只接受
/// 调用点定义的稳定代码，并返回固定脱敏摘要。
pub(super) fn runtime_snapshot_diagnostic<E: ?Sized>(
    source: &str,
    code: &str,
    _error: &E,
) -> Value {
    json!({
        "source": source,
        "code": code,
        "status": "degraded",
        "severity": "warning",
        "summary": "运行态子系统暂时不可用，详细信息仅保留在本地诊断中。"
    })
}

pub(super) fn serialized_name<T: Serialize + ?Sized>(value: &T) -> String {
    serde_json::to_value(value)
        .ok()
        .and_then(|value| value.as_str().map(ToOwned::to_owned))
        .unwrap_or_else(|| "unknown".to_owned())
}

pub(super) fn tool_references(tools: &[&ToolDefinition], tool_ids: &[&str]) -> Vec<Value> {
    tool_ids
        .iter()
        .filter_map(|tool_id| {
            tools
                .iter()
                .find(|tool| tool.id.as_str() == *tool_id)
                .map(|tool| {
                    json!({
                        "id": tool.id.as_str(),
                        "title": tool.title.as_str(),
                        "description": tool.description.as_str(),
                        "category": tool.category.clone(),
                        "categoryLabel": tool.category.label(),
                        "annotations": {
                            "readOnlyHint": tool.annotations.read_only_hint,
                            "destructiveHint": tool.annotations.destructive_hint,
                            "idempotentHint": tool.annotations.idempotent_hint,
                            "openWorldHint": tool.annotations.open_world_hint
                        },
                        "inputSchema": tool.input_schema.clone(),
                        "exampleArguments": ToolId::parse(tool.id.as_str()).and_then(example_arguments_for)
                    })
                })
        })
        .collect()
}

pub(super) fn available_tool_ids<'a>(
    tools: &[&ToolDefinition],
    candidate_tool_ids: &[&'a str],
) -> Vec<&'a str> {
    candidate_tool_ids
        .iter()
        .copied()
        .filter(|candidate| tools.iter().any(|tool| tool.id.as_str() == *candidate))
        .collect()
}

pub(super) fn missing_tool_ids<'a>(
    tools: &[&ToolDefinition],
    candidate_tool_ids: &[&'a str],
) -> Vec<&'a str> {
    candidate_tool_ids
        .iter()
        .copied()
        .filter(|candidate| tools.iter().all(|tool| tool.id.as_str() != *candidate))
        .collect()
}

pub(super) fn absent_tool_families() -> Vec<&'static str> {
    vec![
        "settings.*",
        "external_launch.*",
        "profile.*",
        "remote_host.*",
        "snippet.*",
        "workflow.*",
        "workspace.*",
        "terminal.resolve_current",
        "history.record",
        "history.delete",
        "history.clear",
        "pending/confirm/approval/audit queues",
    ]
}

#[cfg(test)]
mod tests {
    use super::runtime_snapshot_diagnostic;

    #[test]
    fn runtime_snapshot_diagnostic_never_serializes_source_error_body() {
        let canary = "KERM_RUNTIME_ERROR_CANARY C:\\Users\\alice\\secret.txt terminal-output";
        let diagnostic =
            runtime_snapshot_diagnostic("terminal.list", "runtimeSourceUnavailable", canary);
        let serialized = diagnostic.to_string();

        assert_eq!(diagnostic["source"], "terminal.list");
        assert_eq!(diagnostic["code"], "runtimeSourceUnavailable");
        assert_eq!(diagnostic["status"], "degraded");
        assert_eq!(
            diagnostic["summary"],
            "运行态子系统暂时不可用，详细信息仅保留在本地诊断中。"
        );
        assert!(!serialized.contains(canary));
        assert!(!serialized.contains("secret.txt"));
        assert!(!serialized.contains("terminal-output"));
    }
}
