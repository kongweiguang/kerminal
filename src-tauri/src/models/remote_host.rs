//! 远程主机 IPC 数据模型。
//!
//! @author kongweiguang

use std::fmt;

use serde::{Deserialize, Serialize};

/// 保存主机的协议语义；SFTP 使用 SSH transport，但不具备 shell 能力。
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum RemoteHostProtocol {
    /// SSH 终端与 SSH 派生能力。
    #[default]
    Ssh,
    /// 仅 SFTP 文件能力。
    Sftp,
    /// 系统 RDP 客户端连接。
    Rdp,
    /// Telnet 终端连接。
    Telnet,
    /// 本地串口连接。
    Serial,
}

impl RemoteHostProtocol {
    /// 是否允许 SFTP 文件能力。
    pub fn supports_sftp(self) -> bool {
        matches!(self, Self::Ssh | Self::Sftp)
    }

    /// 是否允许 shell、远程命令、端口转发及其派生能力。
    pub fn supports_shell(self) -> bool {
        matches!(self, Self::Ssh)
    }
}

/// SSH 认证方式。
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum RemoteHostAuthType {
    /// 用户密码认证，密码保存到 encrypted vault。
    Password,
    /// 私钥认证，私钥路径公开保存，内联私钥内容保存到 encrypted vault。
    Key,
    /// 使用系统 SSH agent。
    #[default]
    Agent,
}

/// 远程主机凭据状态摘要，不包含明文。
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum RemoteHostCredentialStatus {
    /// 没有保存凭据，需要交互输入或使用 agent/key path。
    #[default]
    Missing,
    /// 凭据引用 encrypted vault。
    Vault,
    /// 使用 SSH agent。
    Agent,
}

impl RemoteHostAuthType {
    /// 返回数据库中保存的稳定文本。
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Password => "password",
            Self::Key => "key",
            Self::Agent => "agent",
        }
    }
}

impl TryFrom<&str> for RemoteHostAuthType {
    type Error = String;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        match value {
            "password" => Ok(Self::Password),
            "key" => Ok(Self::Key),
            "agent" => Ok(Self::Agent),
            _ => Err(format!("未知 SSH 认证方式: {value}")),
        }
    }
}

/// SSH 连接附加选项。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct SshOptions {
    /// 代理配置。
    #[serde(default)]
    pub proxy: SshProxyOptions,
    /// SSH 端口转发配置。
    #[serde(default)]
    pub tunnels: Vec<SshTunnelOptions>,
    /// ProxyJump / 跳板链配置。
    #[serde(default)]
    pub jump_hosts: Vec<SshJumpHostOptions>,
    /// 登录后的终端行为。
    #[serde(default)]
    pub terminal: SshTerminalOptions,
    /// SFTP / 传输行为。
    #[serde(default)]
    pub transfer: SshTransferOptions,
}

/// SSH 代理协议。
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum SshProxyProtocol {
    /// 不使用代理。
    #[default]
    None,
    /// HTTP CONNECT 代理。
    Http,
    /// SOCKS5 代理。
    Socks5,
}

/// SSH 代理配置。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct SshProxyOptions {
    /// 代理协议。
    #[serde(default)]
    pub protocol: SshProxyProtocol,
    /// 代理主机。
    #[serde(default)]
    pub host: Option<String>,
    /// 代理端口。
    #[serde(default)]
    pub port: Option<u16>,
    /// 代理用户名。
    #[serde(default)]
    pub username: Option<String>,
    /// 代理密码引用；当前 SSH 主机连接不使用该字段。
    #[serde(default)]
    pub credential_ref: Option<String>,
}

/// SSH 端口转发类型。
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum SshTunnelKind {
    /// 本地监听并转发到远端。
    #[default]
    Local,
    /// 远端监听并转发到本地。
    Remote,
    /// 本地 SOCKS 动态转发。
    Dynamic,
}

/// SSH 端口转发配置。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct SshTunnelOptions {
    /// 用户可见名称。
    #[serde(default)]
    pub name: String,
    /// 转发类型。
    #[serde(default)]
    pub kind: SshTunnelKind,
    /// 监听地址。
    #[serde(default)]
    pub bind_host: String,
    /// 监听端口。
    #[serde(default)]
    pub bind_port: Option<u16>,
    /// 目标地址；动态转发时可为空。
    #[serde(default)]
    pub target_host: String,
    /// 目标端口；动态转发时可为空。
    #[serde(default)]
    pub target_port: Option<u16>,
}

/// SSH 跳板配置。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SshJumpHostOptions {
    /// 用户可见名称。
    #[serde(default)]
    pub name: String,
    /// 跳板主机。
    pub host: String,
    /// 跳板 SSH 端口。
    #[serde(default = "default_ssh_port")]
    pub port: u16,
    /// 跳板用户名。
    #[serde(default)]
    pub username: String,
    /// 跳板认证方式。
    #[serde(default)]
    pub auth_type: RemoteHostAuthType,
    /// 跳板私钥路径；密码和内联私钥通过保存链路写入 encrypted vault。
    #[serde(default)]
    pub credential_ref: Option<String>,
    /// 跳板密码或内联私钥 encrypted vault 引用。
    #[serde(default)]
    pub secret_ref: Option<String>,
    /// 跳板私钥 passphrase encrypted vault 引用。
    #[serde(default)]
    pub key_passphrase_ref: Option<String>,
    /// 跳板私钥 passphrase，仅作为运行态瞬时材料。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub key_passphrase_secret: Option<String>,
    /// 跳板密码或内联私钥内容，仅作为保存请求的瞬时输入。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub credential_secret: Option<String>,
    /// 跳板凭据状态摘要。
    #[serde(default)]
    pub credential_status: RemoteHostCredentialStatus,
}

/// SSH 终端选项。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SshTerminalOptions {
    /// 字符编码。
    #[serde(default = "default_terminal_encoding")]
    pub encoding: String,
    /// TERM 环境值。
    #[serde(default = "default_terminal_type")]
    pub terminal_type: String,
    /// 键盘高亮方案。
    #[serde(default = "default_keyboard_profile")]
    pub keyboard_profile: String,
    /// Alt 键修饰行为。
    #[serde(default = "default_alt_modifier")]
    pub alt_modifier: String,
    /// 退格键发送序列。
    #[serde(default = "default_backspace_key")]
    pub backspace_key: String,
    /// Delete 键发送序列。
    #[serde(default = "default_delete_key")]
    pub delete_key: String,
    /// 连接超时秒数。
    #[serde(default = "default_connect_timeout_seconds")]
    pub connect_timeout_seconds: u16,
    /// 心跳间隔秒数；0 表示关闭。
    #[serde(default = "default_keepalive_seconds")]
    pub keepalive_seconds: u16,
    /// 登录后启动命令。
    #[serde(default)]
    pub startup_command: String,
    /// 远端环境变量，KEY=value，每行一项。
    #[serde(default)]
    pub environment: String,
    /// 登录脚本，按行保存。
    #[serde(default)]
    pub login_script: String,
}

impl Default for SshTerminalOptions {
    fn default() -> Self {
        Self {
            encoding: default_terminal_encoding(),
            terminal_type: default_terminal_type(),
            keyboard_profile: default_keyboard_profile(),
            alt_modifier: default_alt_modifier(),
            backspace_key: default_backspace_key(),
            delete_key: default_delete_key(),
            connect_timeout_seconds: default_connect_timeout_seconds(),
            keepalive_seconds: default_keepalive_seconds(),
            startup_command: String::new(),
            environment: String::new(),
            login_script: String::new(),
        }
    }
}

/// SFTP / 传输选项。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SshTransferOptions {
    /// 是否启用 SFTP。
    #[serde(default = "default_true")]
    pub enabled: bool,
    /// 远端默认目录。
    #[serde(default)]
    pub remote_start_directory: String,
    /// 本地默认目录。
    #[serde(default)]
    pub local_start_directory: String,
    /// 是否保留文件时间戳。
    #[serde(default = "default_true")]
    pub preserve_timestamps: bool,
    /// 是否跟随符号链接。
    #[serde(default)]
    pub follow_symlinks: bool,
    /// 同时传输数量。
    #[serde(default = "default_max_concurrent_transfers")]
    pub max_concurrent_transfers: u8,
}

impl Default for SshTransferOptions {
    fn default() -> Self {
        Self {
            enabled: true,
            remote_start_directory: String::new(),
            local_start_directory: String::new(),
            preserve_timestamps: true,
            follow_symlinks: false,
            max_concurrent_transfers: default_max_concurrent_transfers(),
        }
    }
}

fn default_ssh_port() -> u16 {
    22
}

fn default_terminal_encoding() -> String {
    "UTF-8".to_owned()
}

fn default_terminal_type() -> String {
    "xterm-256color".to_owned()
}

fn default_keyboard_profile() -> String {
    "default".to_owned()
}

fn default_alt_modifier() -> String {
    "8bit".to_owned()
}

fn default_backspace_key() -> String {
    "ascii-delete".to_owned()
}

fn default_delete_key() -> String {
    "delete-sequence".to_owned()
}

fn default_connect_timeout_seconds() -> u16 {
    30
}

fn default_keepalive_seconds() -> u16 {
    60
}

fn default_true() -> bool {
    true
}

fn default_max_concurrent_transfers() -> u8 {
    4
}

/// 远程主机分组。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteHostGroup {
    /// 稳定分组 id。
    pub id: String,
    /// 用户可见分组名称。
    pub name: String,
    /// 列表排序字段。
    pub sort_order: i64,
    /// 创建时间。
    pub created_at: String,
    /// 更新时间。
    pub updated_at: String,
}

/// 带主机列表的分组树。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteHostGroupWithHosts {
    /// 稳定分组 id。
    pub id: String,
    /// 用户可见分组名称。
    pub name: String,
    /// 列表排序字段。
    pub sort_order: i64,
    /// 创建时间。
    pub created_at: String,
    /// 更新时间。
    pub updated_at: String,
    /// 该分组下的远程主机。
    pub hosts: Vec<RemoteHost>,
}

/// SSH 远程主机配置。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteHost {
    /// 稳定主机 id。
    pub id: String,
    /// 所属分组 id；为空表示未分组。
    pub group_id: Option<String>,
    /// 用户可见名称。
    pub name: String,
    /// SSH host，可为域名或 IP。
    pub host: String,
    /// SSH 端口。
    pub port: u16,
    /// SSH 用户名。
    pub username: String,
    /// 显式主机协议；保存的 host schema 不允许从标签推断。
    pub protocol: RemoteHostProtocol,
    /// 认证方式。
    pub auth_type: RemoteHostAuthType,
    /// 私钥路径；密码和内联私钥通过保存链路写入 encrypted vault。
    pub credential_ref: Option<String>,
    /// SSH 密码或内联私钥 encrypted vault 引用。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub secret_ref: Option<String>,
    /// SSH 私钥 passphrase encrypted vault 引用。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub key_passphrase_ref: Option<String>,
    /// SSH 私钥 passphrase，仅作为保存请求或运行态材料的瞬时值。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub key_passphrase_secret: Option<String>,
    /// SSH 密码或内联私钥内容，仅作为保存请求或运行态材料的瞬时值。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub credential_secret: Option<String>,
    /// 凭据状态摘要。
    #[serde(default)]
    pub credential_status: RemoteHostCredentialStatus,
    /// 用户标签。
    pub tags: Vec<String>,
    /// 是否生产主机；后续用于确认策略。
    pub production: bool,
    /// SSH 附加连接选项。
    #[serde(default)]
    pub ssh_options: SshOptions,
    /// 列表排序字段。
    pub sort_order: i64,
    /// 创建时间。
    pub created_at: String,
    /// 更新时间。
    pub updated_at: String,
}

/// 单个主机编辑时的受控凭据 reveal 结果。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteHostCredentialReveal {
    /// 主机 id。
    pub host_id: String,
    /// 当前主机认证方式。
    pub auth_type: RemoteHostAuthType,
    /// reveal 状态，不包含 secret。
    pub status: RemoteHostCredentialRevealStatus,
    /// 仅在 `status = available` 时返回给编辑表单的明文凭据。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub credential_secret: Option<String>,
    /// 仅在当前 key 主机已保存口令时返回给受信编辑表单。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub key_passphrase_secret: Option<String>,
    /// 可展示的非敏感说明。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

/// 单个主机编辑 reveal 状态。
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum RemoteHostCredentialRevealStatus {
    /// 已解密并可回填。
    Available,
    /// 使用 SSH agent，无需 reveal。
    Agent,
    /// 使用公开私钥路径，无需 reveal。
    ConfigPath,
    /// 没有可 reveal 的保存凭据。
    Missing,
    /// 当前认证材料不支持在编辑框回显。
    Unsupported,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedVaultSecretRef {
    pub kind: String,
    pub host_id: String,
    pub scope: String,
    pub material: String,
}

impl ParsedVaultSecretRef {
    pub fn entry_id(&self) -> String {
        build_vault_secret_ref(&self.kind, &self.host_id, &self.scope, &self.material)
    }
}

pub fn build_vault_secret_ref(kind: &str, host_id: &str, scope: &str, material: &str) -> String {
    format!(
        "credential:kerminal:{}:{}:{}:{}:v1",
        kind.trim(),
        host_id.trim(),
        scope.trim(),
        material.trim()
    )
}

pub fn parse_vault_secret_ref(value: &str) -> Result<ParsedVaultSecretRef, String> {
    let parts = value.trim().split(':').collect::<Vec<_>>();
    if parts.len() != 7 || parts[0] != "credential" || parts[1] != "kerminal" || parts[6] != "v1" {
        return Err("invalid Kerminal vault secret ref".to_owned());
    }
    let kind = non_empty_ref_part("kind", parts[2])?;
    let host_id = non_empty_ref_part("host_id", parts[3])?;
    let scope = non_empty_ref_part("scope", parts[4])?;
    let material = non_empty_ref_part("material", parts[5])?;
    Ok(ParsedVaultSecretRef {
        kind,
        host_id,
        scope,
        material,
    })
}

fn non_empty_ref_part(label: &str, value: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() {
        return Err(format!("vault secret ref {label} is empty"));
    }
    Ok(value.to_owned())
}

/// 创建远程主机分组请求。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteHostGroupCreateRequest {
    /// 用户可见分组名称。
    pub name: String,
}

/// 更新远程主机分组请求。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteHostGroupUpdateRequest {
    /// 需要更新的分组 id。
    pub id: String,
    /// 用户可见分组名称。
    pub name: String,
    /// 列表排序字段。
    pub sort_order: i64,
}

/// 创建远程主机请求。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteHostCreateRequest {
    /// 所属分组 id；为空表示未分组。
    #[serde(default)]
    pub group_id: Option<String>,
    /// 用户可见名称。
    pub name: String,
    /// SSH host，可为域名或 IP。
    pub host: String,
    /// SSH 端口。
    pub port: u16,
    /// SSH 用户名。
    pub username: String,
    /// 主机协议；调用方必须显式提供。
    pub protocol: RemoteHostProtocol,
    /// 认证方式。
    pub auth_type: RemoteHostAuthType,
    /// 私钥路径；密码和内联私钥通过保存链路写入 encrypted vault。
    pub credential_ref: Option<String>,
    /// SSH 密码或内联私钥内容，仅作为保存请求的瞬时输入。
    #[serde(default)]
    pub credential_secret: Option<String>,
    /// 用户标签。
    #[serde(default)]
    pub tags: Vec<String>,
    /// 是否生产主机。
    #[serde(default)]
    pub production: bool,
    /// SSH 附加连接选项。
    #[serde(default)]
    pub ssh_options: SshOptions,
}

/// 受信 UI/IPC 可提交的私钥口令上限，限制异常 payload 的内存占用。
pub const SSH_KEY_PASSPHRASE_MAX_BYTES: usize = 16 * 1024;

/// 创建远程主机的受信 IPC 输入；私钥口令与公开/主凭据字段保持独立。
#[derive(Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteHostCreateInput {
    /// 既有主机创建字段以扁平 wire shape 保持兼容。
    #[serde(flatten)]
    pub request: RemoteHostCreateRequest,
    /// 私钥口令，仅作为本次连接测试或保存的瞬时输入。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub key_passphrase_secret: Option<String>,
    /// 新建请求不应清空口令；保留字段用于统一前端 wire shape 和边界校验。
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub clear_key_passphrase: bool,
}

impl From<RemoteHostCreateRequest> for RemoteHostCreateInput {
    fn from(request: RemoteHostCreateRequest) -> Self {
        Self {
            request,
            key_passphrase_secret: None,
            clear_key_passphrase: false,
        }
    }
}

impl fmt::Debug for RemoteHostCreateInput {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("RemoteHostCreateInput")
            .field("protocol", &self.request.protocol)
            .field("auth_type", &self.request.auth_type)
            .field("has_credential_ref", &self.request.credential_ref.is_some())
            .field(
                "has_credential_secret",
                &self.request.credential_secret.is_some(),
            )
            .field(
                "key_passphrase_secret",
                &self.key_passphrase_secret.as_ref().map(|_| "<redacted>"),
            )
            .field("clear_key_passphrase", &self.clear_key_passphrase)
            .finish()
    }
}

/// 更新远程主机请求。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteHostUpdateRequest {
    /// 需要更新的主机 id。
    pub id: String,
    /// 所属分组 id；为空表示未分组。
    #[serde(default)]
    pub group_id: Option<String>,
    /// 用户可见名称。
    pub name: String,
    /// SSH host，可为域名或 IP。
    pub host: String,
    /// SSH 端口。
    pub port: u16,
    /// SSH 用户名。
    pub username: String,
    /// 主机协议；编辑保存时不得改变已有协议。
    pub protocol: RemoteHostProtocol,
    /// 认证方式。
    pub auth_type: RemoteHostAuthType,
    /// 私钥路径；密码和内联私钥通过保存链路写入 encrypted vault。
    pub credential_ref: Option<String>,
    /// SSH 密码或内联私钥内容，仅作为保存请求输入，持久化时写入 encrypted vault。
    #[serde(default)]
    pub credential_secret: Option<String>,
    /// 用户标签。
    #[serde(default)]
    pub tags: Vec<String>,
    /// 是否生产主机。
    #[serde(default)]
    pub production: bool,
    /// SSH 附加连接选项。
    #[serde(default)]
    pub ssh_options: SshOptions,
    /// 列表排序字段。
    pub sort_order: i64,
}

/// 更新远程主机的受信 IPC 输入，显式区分保留、替换与清空私钥口令。
#[derive(Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteHostUpdateInput {
    /// 既有主机更新字段以扁平 wire shape 保持兼容。
    #[serde(flatten)]
    pub request: RemoteHostUpdateRequest,
    /// 非空时替换 encrypted vault 中的私钥口令。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub key_passphrase_secret: Option<String>,
    /// 为 true 时删除既有口令引用和对应 vault 条目。
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub clear_key_passphrase: bool,
}

impl From<RemoteHostUpdateRequest> for RemoteHostUpdateInput {
    fn from(request: RemoteHostUpdateRequest) -> Self {
        Self {
            request,
            key_passphrase_secret: None,
            clear_key_passphrase: false,
        }
    }
}

impl fmt::Debug for RemoteHostUpdateInput {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("RemoteHostUpdateInput")
            .field("id", &self.request.id)
            .field("protocol", &self.request.protocol)
            .field("auth_type", &self.request.auth_type)
            .field("has_credential_ref", &self.request.credential_ref.is_some())
            .field(
                "has_credential_secret",
                &self.request.credential_secret.is_some(),
            )
            .field(
                "key_passphrase_secret",
                &self.key_passphrase_secret.as_ref().map(|_| "<redacted>"),
            )
            .field("clear_key_passphrase", &self.clear_key_passphrase)
            .finish()
    }
}
