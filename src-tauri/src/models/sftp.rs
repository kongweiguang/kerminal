//! SFTP 文件工具 IPC 数据模型。
//!
//! @author kongweiguang

use serde::{Deserialize, Serialize};

/// 远程文件类型。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
pub enum SftpEntryKind {
    /// 普通文件。
    File,
    /// 目录。
    Directory,
    /// 符号链接。
    Symlink,
    /// 其他类型，例如设备文件或解析失败的条目。
    Other,
}

/// SFTP 目录条目。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SftpEntry {
    /// 条目名称，不包含父路径。
    pub name: String,
    /// 远程完整路径。
    pub path: String,
    /// 文件类型。
    pub kind: SftpEntryKind,
    /// 文件大小，无法解析时为空。
    pub size: Option<u64>,
    /// 权限文本，例如 `drwxr-xr-x`。
    pub permissions: Option<String>,
    /// 修改时间文本，保留远端输出格式。
    pub modified: Option<String>,
    /// 原始 `ls -la` 行，便于后续诊断解析差异。
    pub raw: String,
}

/// SFTP 目录列表响应。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SftpDirectoryListing {
    /// 远程主机 id。
    pub host_id: String,
    /// 当前远程目录路径。
    pub path: String,
    /// 上级目录，根目录为空。
    pub parent_path: Option<String>,
    /// 当前目录条目。
    pub entries: Vec<SftpEntry>,
}

/// SFTP 目录列表请求。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SftpListDirectoryRequest {
    /// 远程主机 id。
    pub host_id: String,
    /// 远程目录路径。
    pub path: String,
}

/// 单路径 SFTP 操作请求。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SftpPathRequest {
    /// 远程主机 id。
    pub host_id: String,
    /// 远程路径。
    pub path: String,
}

/// SFTP 文件预览请求。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SftpPreviewRequest {
    /// 远程主机 id。
    pub host_id: String,
    /// 远程文件路径。
    pub path: String,
    /// 最多读取字节数；为空时使用服务默认值。
    pub max_bytes: Option<usize>,
}

/// SFTP 文件预览响应。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SftpFilePreview {
    /// 远程主机 id。
    pub host_id: String,
    /// 远程文件路径。
    pub path: String,
    /// 文本预览内容。
    pub content: String,
    /// 实际返回的字节数。
    pub bytes_read: usize,
    /// 本次请求允许读取的最大字节数。
    pub max_bytes: usize,
    /// 是否因为读取上限被截断。
    pub truncated: bool,
    /// 当前预览使用的编码说明。
    pub encoding: String,
}

/// SFTP 远程文本文件 revision，用于保存前冲突检测。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SftpFileRevision {
    /// 远程文件大小，单位字节。
    pub size: u64,
    /// 远程文件修改时间，保留 SFTP 元数据文本。
    pub modified: Option<String>,
    /// 权限文本，例如 `-rw-r--r--`。
    pub permissions: Option<String>,
    /// 原始权限 mode，保存时用于尽量保留远程权限。
    pub permissions_mode: Option<u32>,
    /// 文件内容 SHA-256；为空时调用方只能退化到 size/mtime 比对。
    pub content_sha256: Option<String>,
}

/// SFTP 远程文本文件读取请求。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SftpReadTextFileRequest {
    /// 远程主机 id。
    pub host_id: String,
    /// 远程文件路径。
    pub path: String,
    /// 最大读取字节数；为空时使用编辑器默认上限。
    pub max_bytes: Option<usize>,
}

/// SFTP 远程文本文件读取响应。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SftpReadTextFileResponse {
    /// 远程主机 id。
    pub host_id: String,
    /// 远程文件路径。
    pub path: String,
    /// 文件文本内容。
    pub content: String,
    /// 实际返回字节数。
    pub bytes_read: usize,
    /// 本次读取允许的最大字节数。
    pub max_bytes: usize,
    /// 是否因为读取上限被截断。
    pub truncated: bool,
    /// 当前读取使用的编码说明。
    pub encoding: String,
    /// 检测到的行尾类型：`lf`、`crlf` 或 `mixed`。
    pub line_ending: String,
    /// 打开文件时的远程 revision。
    pub revision: SftpFileRevision,
    /// 是否检测到二进制内容。
    pub binary: bool,
    /// 是否建议前端只读展示。
    pub readonly: bool,
}

/// SFTP 远程文本文件写入请求。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SftpWriteTextFileRequest {
    /// 远程主机 id。
    pub host_id: String,
    /// 远程文件路径。
    pub path: String,
    /// 要写入的文本内容。
    pub content: String,
    /// 文本编码，目前只接受 `utf-8` 或 `utf-8-lossy`。
    pub encoding: String,
    /// 打开文件时记录的 revision，用于保存前冲突检测。
    pub expected_revision: Option<SftpFileRevision>,
    /// 是否按新建文件处理。
    pub create: bool,
    /// 是否在 revision 冲突时显式覆盖远端内容。
    pub overwrite_on_conflict: bool,
}

/// SFTP 远程文本文件写入响应。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SftpWriteTextFileResponse {
    /// 远程主机 id。
    pub host_id: String,
    /// 远程文件路径。
    pub path: String,
    /// 写入字节数。
    pub bytes_written: usize,
    /// 保存后的编码说明。
    pub encoding: String,
    /// 保存后的行尾类型。
    pub line_ending: String,
    /// 保存完成后的新 revision。
    pub revision: SftpFileRevision,
}

/// SFTP 远程路径状态响应。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SftpPathStat {
    /// 远程主机 id。
    pub host_id: String,
    /// 远程路径。
    pub path: String,
    /// 路径类型。
    pub kind: SftpEntryKind,
    /// 文件大小。
    pub size: Option<u64>,
    /// 权限文本。
    pub permissions: Option<String>,
    /// 修改时间文本。
    pub modified: Option<String>,
    /// 文本文件 revision；非文件路径为空。
    pub revision: Option<SftpFileRevision>,
    /// 是否建议前端只读展示。
    pub readonly: bool,
}

/// SFTP 删除请求。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SftpDeleteRequest {
    /// 远程主机 id。
    pub host_id: String,
    /// 远程路径。
    pub path: String,
    /// 是否按目录递归删除。
    pub directory: bool,
}

/// SFTP 重命名请求。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SftpRenameRequest {
    /// 远程主机 id。
    pub host_id: String,
    /// 原远程路径。
    pub from_path: String,
    /// 新远程路径。
    pub to_path: String,
}

/// SFTP 修改权限请求。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SftpChmodRequest {
    /// 远程主机 id。
    pub host_id: String,
    /// 远程路径。
    pub path: String,
    /// 八进制权限模式，例如 644 或 0755。
    pub mode: String,
}

/// SFTP 上传/下载请求。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SftpTransferRequest {
    /// 远程主机 id。
    pub host_id: String,
    /// 远程路径。
    pub remote_path: String,
    /// 本地路径。
    pub local_path: String,
    /// 目标冲突处理策略。
    pub conflict_policy: SftpTransferConflictPolicy,
}

/// SFTP 传输方向。
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SftpTransferDirection {
    /// 上传本地文件或目录到远端。
    Upload,
    /// 下载远端文件或目录到本地。
    Download,
}

/// SFTP 传输对象类型。
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SftpTransferKind {
    /// 普通文件传输。
    File,
    /// 目录递归传输。
    Directory,
}

/// SFTP 传输目标冲突处理策略。
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SftpTransferConflictPolicy {
    /// 覆盖已存在目标。
    Overwrite,
    /// 目标已存在时跳过该文件。
    Skip,
    /// 目标已存在时自动生成不冲突的新名称。
    Rename,
}

/// 本地拖放路径类型。
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SftpLocalPathKind {
    /// 普通本地文件。
    File,
    /// 本地目录。
    Directory,
}

/// 本地路径分类请求。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SftpClassifyLocalPathsRequest {
    /// 需要分类的本地路径列表。
    pub paths: Vec<String>,
}

/// 本地路径分类结果。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SftpLocalPathInfo {
    /// 本地绝对路径。
    pub path: String,
    /// 路径类型。
    pub kind: SftpLocalPathKind,
}

/// SFTP 传输任务状态。
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SftpTransferStatus {
    /// 等待并发槽位。
    Queued,
    /// 正在执行。
    Running,
    /// 已成功完成。
    Succeeded,
    /// 执行失败。
    Failed,
    /// 已取消。
    Canceled,
}

/// 可供调用方稳定识别的传输失败类型。
///
/// 原始 I/O 错误继续保留在脱敏后的 error 中，而该字段只表达恢复语义，避免 Agent 或前端
/// 依赖易变的底层网络错误文本。
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SftpTransferFailureKind {
    /// 后台传输连续一段时间没有确认任何新字节。
    IdleTimeout,
    /// 非结构化或当前不需要进一步细分的失败。
    Other,
}

/// 创建可管理 SFTP 传输任务请求。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SftpManagedTransferRequest {
    /// 远程主机 id。
    pub host_id: String,
    /// 远程路径。
    pub remote_path: String,
    /// 本地路径。
    pub local_path: String,
    /// 传输方向。
    pub direction: SftpTransferDirection,
    /// 传输对象类型。
    pub kind: SftpTransferKind,
    /// 目标冲突处理策略。
    pub conflict_policy: SftpTransferConflictPolicy,
    /// 发起该传输的前端视图 scope。
    pub view_scope: Option<String>,
    /// 覆盖全局设置的连续无进度保护秒数；为空时在入队时固化全局值。
    #[serde(default)]
    pub idle_timeout_seconds: Option<u16>,
}

/// 创建远程复制或跨主机传输任务请求。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SftpRemoteCopyRequest {
    /// 源远程主机 id。
    pub source_host_id: String,
    /// 源远程路径。
    pub source_remote_path: String,
    /// 目标远程主机 id。
    pub target_host_id: String,
    /// 目标远程路径。
    pub target_remote_path: String,
    /// 传输对象类型。
    pub kind: SftpTransferKind,
    /// 目标冲突处理策略。
    pub conflict_policy: SftpTransferConflictPolicy,
    /// 发起该传输的前端视图 scope。
    pub view_scope: Option<String>,
    /// 覆盖全局设置的连续无进度保护秒数；为空时在入队时固化全局值。
    #[serde(default)]
    pub idle_timeout_seconds: Option<u16>,
}

/// 创建远程条目下载为本地 ZIP 的归档任务请求。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SftpArchiveDownloadRequest {
    /// 远程主机 id。
    pub host_id: String,
    /// 源远程路径。
    pub source_remote_path: String,
    /// 目标本地 ZIP 文件路径。
    pub target_local_path: String,
    /// 源传输对象类型。
    pub kind: SftpTransferKind,
    /// 目标冲突处理策略。
    pub conflict_policy: SftpTransferConflictPolicy,
    /// 发起该传输的前端视图 scope。
    pub view_scope: Option<String>,
}

/// 创建本地条目压缩为远程 ZIP 的归档上传任务请求。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SftpArchiveUploadRequest {
    /// 远程主机 id。
    pub host_id: String,
    /// 源本地路径。
    pub source_local_path: String,
    /// 目标远程 ZIP 文件路径。
    pub target_remote_path: String,
    /// 源传输对象类型。
    pub kind: SftpTransferKind,
    /// 目标冲突处理策略。
    pub conflict_policy: SftpTransferConflictPolicy,
    /// 发起该传输的前端视图 scope。
    pub view_scope: Option<String>,
}

/// 创建远程条目下载到本地文件剪贴板的任务请求。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SftpClipboardDownloadRequest {
    /// 远程主机 id。
    pub host_id: String,
    /// 源远程路径。
    pub source_remote_path: String,
    /// 源传输对象类型。
    pub kind: SftpTransferKind,
    /// 发起该传输的前端视图 scope。
    pub view_scope: Option<String>,
}

/// 按前端视图 scope 查询或清理传输队列；为空请求表示旧的全局语义。
#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SftpTransferScopeRequest {
    /// 前端视图 scope；`None` 表示不过滤，`Some("")` 不应由前端传入。
    pub view_scope: Option<String>,
}

/// 取消 SFTP 传输任务请求。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SftpTransferCancelRequest {
    /// 传输任务 id。
    pub transfer_id: String,
    /// 可选视图 scope；存在时只允许取消当前视图拥有的任务。
    pub view_scope: Option<String>,
}

/// SFTP 传输端点，用于在队列中明确展示来源和目标。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SftpTransferEndpoint {
    /// 本地文件系统路径。
    #[serde(rename_all = "camelCase")]
    Local {
        /// 本地绝对路径。
        path: String,
    },
    /// 远程 SSH/SFTP 主机路径。
    #[serde(rename_all = "camelCase")]
    Remote {
        /// 远程主机 id。
        host_id: String,
        /// 用户可见主机名称。
        host_label: String,
        /// 远程路径。
        path: String,
    },
}

/// SFTP 传输操作类型。
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SftpTransferOperation {
    /// 本地上传到远程。
    Upload,
    /// 远程下载到本地。
    Download,
    /// 远程主机之间复制。
    RemoteCopy,
    /// 远程压缩下载。
    ArchiveDownload,
    /// 本地压缩上传。
    ArchiveUpload,
    /// 远程下载到系统文件剪贴板。
    ClipboardDownload,
}

/// SFTP 传输执行方式。
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SftpTransferTransportMode {
    /// 单远程主机普通 SFTP 上传/下载。
    SingleHostSftp,
    /// Kerminal 本机同时连接源和目标并流式桥接。
    ClientBridge,
    /// Kerminal 本机临时目录中转。
    LocalStage,
}

/// SFTP 传输任务摘要。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SftpTransferSummary {
    /// 传输任务 id。
    pub id: String,
    /// 远程主机 id。
    pub host_id: String,
    /// 发起该传输的前端视图 scope；为空表示不绑定特定视图。
    pub view_scope: Option<String>,
    /// 远程路径。
    pub remote_path: String,
    /// 本地路径。
    pub local_path: String,
    /// 传输方向。
    pub direction: SftpTransferDirection,
    /// 传输对象类型。
    pub kind: SftpTransferKind,
    /// 原始目标冲突处理策略；没有安全复用策略的任务为空。
    pub conflict_policy: Option<SftpTransferConflictPolicy>,
    /// 当前状态。
    pub status: SftpTransferStatus,
    /// 已传输字节数；无法实时统计时在完成后更新。
    pub bytes_transferred: u64,
    /// 当前传输速度，单位字节/秒；非运行态或暂不可计算时为 0。
    #[serde(default)]
    pub speed_bytes_per_second: u64,
    /// 总字节数；未知时为空。
    pub total_bytes: Option<u64>,
    /// 用户可见错误信息。
    pub error: Option<String>,
    /// 是否已经请求取消。
    pub cancel_requested: bool,
    /// 创建时间，Unix 秒。
    pub created_at: u64,
    /// 最近更新时间，Unix 秒。
    pub updated_at: u64,
    /// 结构化操作类型。
    pub operation: SftpTransferOperation,
    /// 结构化来源端点。
    pub source: SftpTransferEndpoint,
    /// 结构化目标端点。
    pub target: SftpTransferEndpoint,
    /// 结构化传输方式。
    pub transport_mode: SftpTransferTransportMode,
    /// 当前阶段，例如排队、桥接、临时中转。
    pub phase: Option<String>,
    /// 当前正在处理的文件或目录。
    pub current_item: Option<String>,
    /// 入队时实际采用的连续无进度保护秒数；重试必须继承该值而不是重新读取全局设置。
    #[serde(default)]
    pub idle_timeout_seconds: u16,
    /// 结构化失败原因；成功、排队、运行和取消时为空。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub failure_kind: Option<SftpTransferFailureKind>,
}

/// 显式信任 SSH/SFTP 主机密钥请求。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SftpTrustHostKeyRequest {
    /// 远程主机 id。
    pub host_id: String,
}

/// SSH/SFTP 主机密钥信任结果。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SftpHostKeyTrustSummary {
    /// 远程主机 id。
    pub host_id: String,
    /// 远程主机名或地址。
    pub host: String,
    /// SSH 端口。
    pub port: u16,
    /// 写入的 known_hosts 文件路径。
    pub known_hosts_path: String,
}
