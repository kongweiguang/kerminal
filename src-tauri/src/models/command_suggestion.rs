//! 命令建议 IPC 数据模型。
//!
//! @author kongweiguang

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::models::command_history::CommandHistoryTarget;

/// 产生建议的 provider 类型。
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum SuggestionProviderKind {
    /// 本地命令历史 provider。
    History,
    /// 远端路径 provider。
    RemotePath,
    /// 远端命令/PATH provider。
    RemoteCommand,
    /// Git refs provider。
    Git,
    /// 离线 CLI specs provider。
    Spec,
    /// 用户维护的命令片段 provider。
    Snippet,
}

impl SuggestionProviderKind {
    /// 返回数据库和前端共享的稳定 provider 标识。
    pub fn as_str(self) -> &'static str {
        match self {
            Self::History => "history",
            Self::RemotePath => "remotePath",
            Self::RemoteCommand => "remoteCommand",
            Self::Git => "git",
            Self::Spec => "spec",
            Self::Snippet => "snippet",
        }
    }
}

impl TryFrom<&str> for SuggestionProviderKind {
    type Error = String;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        match value {
            "history" => Ok(Self::History),
            "remotePath" => Ok(Self::RemotePath),
            "remoteCommand" => Ok(Self::RemoteCommand),
            "git" => Ok(Self::Git),
            "spec" => Ok(Self::Spec),
            "snippet" => Ok(Self::Snippet),
            _ => Err(format!("未知命令建议 provider: {value}")),
        }
    }
}

/// 候选表达的业务对象类型。
#[derive(Debug, Default, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum CommandSuggestionCandidateKind {
    /// 普通命令候选；旧候选默认按此处理。
    #[default]
    Command,
    /// 来自片段目录的可复用命令。
    Snippet,
}

/// 接受候选后由前端执行的动作。
#[derive(Debug, Default, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum CommandSuggestionActivation {
    /// 只插入终端输入缓冲区，不执行命令。
    #[default]
    Insert,
    /// 打开并聚焦右栏片段参数面板。
    OpenSnippetPanel,
}

/// 建议的敏感度。
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum CommandSuggestionSensitivity {
    /// 普通建议。
    Normal,
    /// 命中敏感模式，默认不应展示。
    Sensitive,
    /// 危险命令建议，需要 UI 或策略降权。
    Dangerous,
}

/// 用户对建议的显式/保守反馈。
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum CommandSuggestionFeedbackAction {
    /// 用户接受了建议。
    Accepted,
    /// 用户提交了不同命令，忽略了当前建议。
    Dismissed,
}

impl CommandSuggestionFeedbackAction {
    /// 返回数据库中保存的稳定文本。
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Accepted => "accepted",
            Self::Dismissed => "dismissed",
        }
    }
}

impl TryFrom<&str> for CommandSuggestionFeedbackAction {
    type Error = String;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        match value {
            "accepted" => Ok(Self::Accepted),
            "dismissed" => Ok(Self::Dismissed),
            _ => Err(format!("未知命令建议反馈动作: {value}")),
        }
    }
}

/// 命令建议审计事件类型。
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum CommandSuggestionAuditEventKind {
    /// 远端只读探测被调度或跳过。
    RemoteProbeSchedule,
    /// 远端只读探测刷新完成。
    RemoteProbeRefresh,
    /// 用户反馈被记录或跳过。
    Feedback,
}

impl CommandSuggestionAuditEventKind {
    /// 返回数据库中保存的稳定文本。
    pub fn as_str(self) -> &'static str {
        match self {
            Self::RemoteProbeSchedule => "remoteProbeSchedule",
            Self::RemoteProbeRefresh => "remoteProbeRefresh",
            Self::Feedback => "feedback",
        }
    }
}

impl TryFrom<&str> for CommandSuggestionAuditEventKind {
    type Error = String;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        match value {
            "remoteProbeSchedule" => Ok(Self::RemoteProbeSchedule),
            "remoteProbeRefresh" => Ok(Self::RemoteProbeRefresh),
            "feedback" => Ok(Self::Feedback),
            _ => Err(format!("未知命令建议审计事件类型: {value}")),
        }
    }
}

/// 命令建议审计决策结果。
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum CommandSuggestionAuditDecision {
    /// 已允许继续执行。
    Allowed,
    /// 已跳过，不执行远端探测或反馈持久化。
    Skipped,
    /// 操作成功。
    Succeeded,
    /// 操作失败。
    Failed,
    /// 事件已记录。
    Recorded,
}

impl CommandSuggestionAuditDecision {
    /// 返回数据库中保存的稳定文本。
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Allowed => "allowed",
            Self::Skipped => "skipped",
            Self::Succeeded => "succeeded",
            Self::Failed => "failed",
            Self::Recorded => "recorded",
        }
    }
}

impl TryFrom<&str> for CommandSuggestionAuditDecision {
    type Error = String;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        match value {
            "allowed" => Ok(Self::Allowed),
            "skipped" => Ok(Self::Skipped),
            "succeeded" => Ok(Self::Succeeded),
            "failed" => Ok(Self::Failed),
            "recorded" => Ok(Self::Recorded),
            _ => Err(format!("未知命令建议审计决策: {value}")),
        }
    }
}

/// 替换当前命令行的字符范围。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommandSuggestionReplacementRange {
    /// 起始 Unicode 标量值偏移，不是 UTF-8 字节偏移。
    pub start: usize,
    /// 结束 Unicode 标量值偏移，不是 UTF-8 字节偏移。
    pub end: usize,
}

/// 命令建议查询的展示模式。
#[derive(Debug, Default, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SuggestionQueryMode {
    /// 查询用于低干扰的行内建议。
    #[default]
    Inline,
    /// 查询用于主动打开的候选菜单。
    Menu,
}

/// 命令建议允许进入的展示位置。
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SuggestionPresentation {
    /// 允许作为行内 ghost text 展示。
    Inline,
    /// 允许在候选菜单中展示。
    Menu,
}

/// 命令建议请求。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommandSuggestionRequest {
    /// 当前命令行文本。
    pub input: String,
    /// 光标字符偏移。
    pub cursor: usize,
    /// 目标类型。
    #[serde(default)]
    pub target: CommandHistoryTarget,
    /// 当前终端 session id。
    pub session_id: Option<String>,
    /// 前端 pane id。
    pub pane_id: Option<String>,
    /// 本地 profile id。
    pub profile_id: Option<String>,
    /// SSH 主机 id。
    pub remote_host_id: Option<String>,
    /// 当前工作目录。
    pub cwd: Option<String>,
    /// shell 标识。
    pub shell: Option<String>,
    /// provider 白名单；为空时使用默认 provider。
    pub providers: Option<Vec<SuggestionProviderKind>>,
    /// 返回数量上限。
    pub limit: Option<usize>,
    /// 查询展示模式；旧请求缺少该字段时保持 inline 行为。
    #[serde(default)]
    pub mode: SuggestionQueryMode,
    /// 前端请求代次，仅用于关联诊断和丢弃过期响应。
    pub generation: Option<u64>,
    /// 前端计算的非敏感上下文键；后端不得把它当作安全边界。
    pub context_key: Option<String>,
}

/// 刷新远端路径建议缓存的请求。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommandSuggestionRemotePathRefreshRequest {
    /// 远程主机 id。
    pub host_id: String,
    /// 要预热的远程目录路径。
    pub path: String,
    /// 缓存有效期秒数。
    pub ttl_seconds: Option<u64>,
    /// 单目录缓存的最大条目数。
    pub max_entries: Option<usize>,
}

/// 远端路径建议缓存刷新结果。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommandSuggestionRemotePathRefreshResult {
    /// 远程主机 id。
    pub host_id: String,
    /// 已缓存的远程目录路径。
    pub path: String,
    /// 已缓存条目数。
    pub entry_count: usize,
    /// 缓存写入时间，Unix 毫秒。
    pub cached_at_unix_ms: u128,
    /// 实际使用的 TTL 秒数。
    pub ttl_seconds: u64,
}

/// 刷新远端命令建议缓存的请求。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommandSuggestionRemoteCommandRefreshRequest {
    /// 远程主机 id。
    pub host_id: String,
    /// 缓存有效期秒数。
    pub ttl_seconds: Option<u64>,
    /// 单主机缓存的最大命令数。
    pub max_entries: Option<usize>,
}

/// 远端命令建议缓存刷新结果。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommandSuggestionRemoteCommandRefreshResult {
    /// 远程主机 id。
    pub host_id: String,
    /// 已缓存命令数。
    pub command_count: usize,
    /// 缓存写入时间，Unix 毫秒。
    pub cached_at_unix_ms: u128,
    /// 实际使用的 TTL 秒数。
    pub ttl_seconds: u64,
}

/// 刷新远端 shell history 建议缓存的请求。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommandSuggestionRemoteHistoryRefreshRequest {
    /// 远程主机 id。
    pub host_id: String,
    /// 缓存有效期秒数。
    pub ttl_seconds: Option<u64>,
    /// 单主机缓存的最大历史命令数。
    pub max_entries: Option<usize>,
}

/// 远端 shell history 建议缓存刷新结果。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommandSuggestionRemoteHistoryRefreshResult {
    /// 远程主机 id。
    pub host_id: String,
    /// 已缓存历史命令数。
    pub command_count: usize,
    /// 缓存写入时间，Unix 毫秒。
    pub cached_at_unix_ms: u128,
    /// 实际使用的 TTL 秒数。
    pub ttl_seconds: u64,
}

/// 刷新 Git refs 建议缓存的请求。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommandSuggestionGitRefreshRequest {
    /// 远程主机 id。
    pub host_id: String,
    /// 远端当前工作目录。
    pub cwd: String,
    /// 缓存有效期秒数。
    pub ttl_seconds: Option<u64>,
    /// 单仓库缓存的最大条目数。
    pub max_entries: Option<usize>,
}

/// Git refs 建议缓存刷新结果。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommandSuggestionGitRefreshResult {
    /// 远程主机 id。
    pub host_id: String,
    /// 远端当前工作目录。
    pub cwd: String,
    /// Git 仓库根目录；非 Git 目录时为空。
    pub repo_root: Option<String>,
    /// 已缓存 refs/remote 条目数。
    pub entry_count: usize,
    /// 缓存写入时间，Unix 毫秒。
    pub cached_at_unix_ms: u128,
    /// 实际使用的 TTL 秒数。
    pub ttl_seconds: u64,
}

/// 记录命令建议反馈的请求。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommandSuggestionFeedbackRecordRequest {
    /// 反馈动作。
    pub action: CommandSuggestionFeedbackAction,
    /// 候选来源 provider。
    pub provider: SuggestionProviderKind,
    /// 接受建议会写入的完整替换文本。
    pub replacement_text: String,
    /// 触发反馈时的输入文本。
    pub input: String,
    /// 目标类型。
    #[serde(default)]
    pub target: CommandHistoryTarget,
    /// 上游记录 id。
    pub source_id: Option<String>,
    /// 当前终端 session id。
    pub session_id: Option<String>,
    /// 前端 pane id。
    pub pane_id: Option<String>,
    /// 本地 profile id。
    pub profile_id: Option<String>,
    /// SSH 主机 id。
    pub remote_host_id: Option<String>,
    /// 当前工作目录。
    pub cwd: Option<String>,
    /// shell 标识。
    pub shell: Option<String>,
}

/// 记录命令建议反馈后的结果。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommandSuggestionFeedbackRecordResult {
    /// 是否写入了反馈。
    pub recorded: bool,
    /// 新反馈 id。
    pub id: Option<String>,
    /// 未写入原因。
    pub skip_reason: Option<String>,
}

/// 命令建议 provider 的运行期观测指标。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CommandSuggestionProviderTelemetry {
    /// 产生指标的 provider。
    pub provider: SuggestionProviderKind,
    /// provider 被查询的次数。
    pub query_count: u64,
    /// provider 查询产生的候选总数。
    pub candidate_count: u64,
    /// provider 查询累计耗时，毫秒。
    pub total_elapsed_ms: u64,
    /// provider 查询平均耗时，毫秒。
    pub average_elapsed_ms: f64,
    /// 远端 provider 缓存命中次数。
    pub cache_hit_count: u64,
    /// 远端 provider 缓存未命中次数。
    pub cache_miss_count: u64,
    /// 后台刷新成功次数。
    pub refresh_success_count: u64,
    /// 后台刷新失败次数。
    pub refresh_failure_count: u64,
    /// 已接受反馈次数。
    pub feedback_accepted_count: u64,
    /// 已忽略反馈次数。
    pub feedback_dismissed_count: u64,
    /// 因安全或输入原因跳过的反馈次数。
    pub feedback_skipped_count: u64,
    /// 最近一次事件时间，Unix 毫秒。
    pub last_event_unix_ms: Option<u128>,
    /// 最近一次错误文本。
    pub last_error: Option<String>,
}

/// 命令建议运行期观测汇总。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CommandSuggestionTelemetrySummary {
    /// telemetry 开始统计的时间，Unix 毫秒。
    pub started_at_unix_ms: u128,
    /// 本次汇总生成时间，Unix 毫秒。
    pub generated_at_unix_ms: u128,
    /// 所有 provider 查询次数。
    pub total_query_count: u64,
    /// 所有 provider 候选数量。
    pub total_candidate_count: u64,
    /// 各 provider 指标。
    pub providers: Vec<CommandSuggestionProviderTelemetry>,
}

/// 命令建议 telemetry 导出结果。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CommandSuggestionTelemetryExport {
    /// 本次导出生成时间，Unix 毫秒。
    pub generated_at_unix_ms: u128,
    /// 当前进程内运行期指标。
    pub runtime: CommandSuggestionTelemetrySummary,
    /// SQLite 持久化聚合指标，可跨应用重启保留。
    pub persisted: CommandSuggestionTelemetrySummary,
    /// 最近的命令建议审计事件。
    pub audit_events: Vec<CommandSuggestionAuditEvent>,
}

/// 命令建议诊断数据清理请求。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommandSuggestionDiagnosticsCleanupRequest {
    /// 是否按保留周期裁剪审计事件。
    pub prune_audit_events: Option<bool>,
    /// 是否按保留周期裁剪反馈记录。
    pub prune_feedback: Option<bool>,
    /// 审计事件保留天数。
    pub audit_retention_days: Option<u32>,
    /// 用户反馈保留天数。
    pub feedback_retention_days: Option<u32>,
    /// 是否删除已经过期的 provider cache。
    #[serde(default)]
    pub prune_expired_provider_cache: bool,
    /// 是否重置持久化 telemetry 聚合计数。
    #[serde(default)]
    pub reset_persisted_telemetry: bool,
}

/// 命令建议诊断数据清理结果。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommandSuggestionDiagnosticsCleanupResult {
    /// 本次清理生成时间，Unix 毫秒。
    pub generated_at_unix_ms: u128,
    /// 审计事件裁剪截止时间，Unix 毫秒。
    pub audit_cutoff_unix_ms: Option<u128>,
    /// 反馈裁剪截止时间，Unix 毫秒。
    pub feedback_cutoff_unix_ms: Option<u128>,
    /// 删除的审计事件数量。
    pub audit_events_deleted: u64,
    /// 删除的用户反馈数量。
    pub feedback_deleted: u64,
    /// 删除的过期 provider cache 数量。
    pub provider_cache_deleted: u64,
    /// 删除的持久化 telemetry 聚合行数量。
    pub telemetry_rows_deleted: u64,
}

/// 命令建议审计事件。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommandSuggestionAuditEvent {
    /// 事件 id。
    pub id: String,
    /// 事件类型。
    pub event_kind: CommandSuggestionAuditEventKind,
    /// 关联 provider；生产策略跳过等事件可能为空。
    pub provider: Option<SuggestionProviderKind>,
    /// 目标类型。
    pub target: CommandHistoryTarget,
    /// 审计决策。
    pub decision: CommandSuggestionAuditDecision,
    /// 稳定原因码。
    pub reason: Option<String>,
    /// SSH 主机 id。
    pub remote_host_id: Option<String>,
    /// 当前工作目录。
    pub cwd: Option<String>,
    /// 远端目录。
    pub path: Option<String>,
    /// 前端 pane id。
    pub pane_id: Option<String>,
    /// 终端 session id。
    pub session_id: Option<String>,
    /// 受限元数据，不保存命令正文、stderr 或凭据。
    pub metadata: BTreeMap<String, String>,
    /// 创建时间，Unix 毫秒。
    pub created_at_unix_ms: u128,
}

/// 命令建议审计事件写入请求。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommandSuggestionAuditRecordRequest {
    /// 事件类型。
    pub event_kind: CommandSuggestionAuditEventKind,
    /// 关联 provider。
    pub provider: Option<SuggestionProviderKind>,
    /// 目标类型。
    #[serde(default)]
    pub target: CommandHistoryTarget,
    /// 审计决策。
    pub decision: CommandSuggestionAuditDecision,
    /// 稳定原因码。
    pub reason: Option<String>,
    /// SSH 主机 id。
    pub remote_host_id: Option<String>,
    /// 当前工作目录。
    pub cwd: Option<String>,
    /// 远端目录。
    pub path: Option<String>,
    /// 前端 pane id。
    pub pane_id: Option<String>,
    /// 终端 session id。
    pub session_id: Option<String>,
    /// 受限元数据，不保存命令正文、stderr 或凭据。
    #[serde(default)]
    pub metadata: BTreeMap<String, String>,
}

/// 命令建议审计事件记录结果。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommandSuggestionAuditRecordResult {
    /// 是否写入成功。
    pub recorded: bool,
    /// 写入后的事件 id。
    pub event_id: String,
}

/// 一条命令建议候选。
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CommandSuggestionCandidate {
    /// 稳定候选 id。
    pub id: String,
    /// 候选来源 provider。
    pub provider: SuggestionProviderKind,
    /// 候选的业务对象类型。
    pub candidate_kind: CommandSuggestionCandidateKind,
    /// 接受候选后的交互动作。
    pub activation: CommandSuggestionActivation,
    /// UI 展示文本。
    pub display_text: String,
    /// 接受建议后写入的替换文本。
    pub replacement_text: String,
    /// 替换范围。
    pub replacement_range: CommandSuggestionReplacementRange,
    /// 用于 inline ghost text 的后缀。
    pub suffix: String,
    /// 归一化评分。
    pub score: f64,
    /// 敏感度。
    pub sensitivity: CommandSuggestionSensitivity,
    /// 来源解释。
    pub description: Option<String>,
    /// 对候选来源的稳定解释，供合并来源后的 UI 展示。
    pub source_explanation: Option<String>,
    /// 去重合并后保留的其它来源解释。
    pub merged_source_explanations: Vec<String>,
    /// 上游记录 id。
    pub source_id: Option<String>,
    /// 轻量元数据。
    pub metadata: Option<BTreeMap<String, String>>,
    /// 候选允许进入的展示位置。
    pub allowed_presentations: Vec<SuggestionPresentation>,
    /// 相对 replacement_text 的 Unicode 标量值结束偏移；为空时只允许整条接受。
    pub accept_boundaries: Vec<usize>,
    /// 产生候选时使用的非敏感上下文键。
    pub context_key: Option<String>,
}

impl CommandSuggestionCandidate {
    /// 返回新候选按敏感度应使用的安全展示位置。
    pub fn presentations_for(
        sensitivity: CommandSuggestionSensitivity,
    ) -> Vec<SuggestionPresentation> {
        match sensitivity {
            CommandSuggestionSensitivity::Normal => {
                vec![SuggestionPresentation::Inline, SuggestionPresentation::Menu]
            }
            CommandSuggestionSensitivity::Sensitive => Vec::new(),
            CommandSuggestionSensitivity::Dangerous => vec![SuggestionPresentation::Menu],
        }
    }
}

impl<'de> Deserialize<'de> for CommandSuggestionCandidate {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct CandidatePayload {
            id: String,
            provider: SuggestionProviderKind,
            #[serde(default)]
            candidate_kind: CommandSuggestionCandidateKind,
            #[serde(default)]
            activation: CommandSuggestionActivation,
            display_text: String,
            replacement_text: String,
            replacement_range: CommandSuggestionReplacementRange,
            suffix: String,
            score: f64,
            sensitivity: CommandSuggestionSensitivity,
            description: Option<String>,
            source_explanation: Option<String>,
            #[serde(default)]
            merged_source_explanations: Vec<String>,
            source_id: Option<String>,
            metadata: Option<BTreeMap<String, String>>,
            allowed_presentations: Option<Vec<SuggestionPresentation>>,
            #[serde(default)]
            accept_boundaries: Vec<usize>,
            context_key: Option<String>,
        }

        let payload = CandidatePayload::deserialize(deserializer)?;
        let allowed_presentations = match payload.allowed_presentations {
            Some(presentations) => presentations,
            None => match payload.sensitivity {
                CommandSuggestionSensitivity::Normal => vec![SuggestionPresentation::Inline],
                CommandSuggestionSensitivity::Sensitive => Vec::new(),
                CommandSuggestionSensitivity::Dangerous => vec![SuggestionPresentation::Menu],
            },
        };

        Ok(Self {
            id: payload.id,
            provider: payload.provider,
            candidate_kind: payload.candidate_kind,
            activation: payload.activation,
            display_text: payload.display_text,
            replacement_text: payload.replacement_text,
            replacement_range: payload.replacement_range,
            suffix: payload.suffix,
            score: payload.score,
            sensitivity: payload.sensitivity,
            description: payload.description,
            source_explanation: payload.source_explanation,
            merged_source_explanations: payload.merged_source_explanations,
            source_id: payload.source_id,
            metadata: payload.metadata,
            allowed_presentations,
            accept_boundaries: payload.accept_boundaries,
            context_key: payload.context_key,
        })
    }
}
