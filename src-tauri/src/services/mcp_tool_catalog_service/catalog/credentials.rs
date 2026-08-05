//! Saved host credential tools.
//!
//! @author kongweiguang

use crate::{
    models::mcp_server::ToolCategory,
    services::mcp_tool_catalog_service::{ToolDescriptor, ToolId},
};

use super::super::schema::{
    enum_field, number_field, object_schema, string_field, tool, ToolEffect,
};

pub(super) fn credential_tools() -> Vec<ToolDescriptor> {
    vec![
        tool(
            ToolId::KerminalHostUpsertWithCredential,
            "保存主机和凭据",
            "创建或更新 SSH password 主机，并把明文密码写入 Kerminal encrypted vault；公开 hosts/*.toml 只保存 secret_ref。调用前确认由 MCP host 负责。",
            ToolCategory::Ssh,
            ToolEffect::Write,
            object_schema(vec![
                string_field("id", "可选主机 id；传入时更新该主机。", false),
                string_field("groupId", "可选主机分组 id。", false),
                string_field("name", "主机名称。", true),
                string_field("host", "SSH 主机名或 IP。", true),
                number_field("port", "SSH 端口；默认 22。", false),
                string_field("username", "SSH 用户名。", true),
                string_field("password", "本次保存的 SSH 明文密码；只写入 encrypted vault。", true),
            ]),
        ),
        tool(
            ToolId::KerminalVaultEncryptSecret,
            "加密保存凭据",
            "把授权提供的明文凭据加密写入 Kerminal encrypted vault，并返回可写入 host metadata 的 secret_ref。",
            ToolCategory::Ssh,
            ToolEffect::Write,
            object_schema(vec![
                enum_field(
                    "kind",
                    "secret 类型。",
                    true,
                    vec!["ssh-host", "jump-host", "rdp-host"],
                ),
                string_field("hostId", "关联的 host id。", true),
                string_field("scope", "secret 作用域，例如 target 或 jump-0。", true),
                enum_field(
                    "material",
                    "凭据材料类型。",
                    true,
                    vec!["password", "private-key", "key-passphrase"],
                ),
                string_field("plaintext", "授权提供的明文凭据；只写入 encrypted vault。", true),
            ]),
        ),
    ]
}
