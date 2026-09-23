/** @author kongweiguang */

export type SftpEntryKind = "file" | "directory" | "symlink" | "other";

export interface SftpEntry {
  name: string;
  path: string;
  kind: SftpEntryKind;
  size?: number;
  permissions?: string;
  modified?: string;
  raw: string;
}

export interface SftpDirectoryListing {
  hostId: string;
  path: string;
  parentPath?: string;
  entries: SftpEntry[];
}

export interface SftpListDirectoryRequest {
  hostId: string;
  path: string;
}

export interface SftpPathRequest {
  hostId: string;
  path: string;
}

export interface SftpPreviewRequest extends SftpPathRequest {
  maxBytes?: number;
}

export interface SftpFilePreview {
  hostId: string;
  path: string;
  content: string;
  bytesRead: number;
  maxBytes: number;
  truncated: boolean;
  encoding: string;
}

export interface SftpFileRevision {
  size: number;
  modified?: string | null;
  permissions?: string | null;
  permissionsMode?: number | null;
  contentSha256?: string | null;
}

export interface SftpReadTextFileRequest extends SftpPathRequest {
  maxBytes?: number;
}

export interface SftpReadTextFileResponse {
  hostId: string;
  path: string;
  content: string;
  bytesRead: number;
  maxBytes: number;
  truncated: boolean;
  encoding: string;
  lineEnding: string;
  revision: SftpFileRevision;
  binary: boolean;
  readonly: boolean;
}

export interface SftpWriteTextFileRequest extends SftpPathRequest {
  content: string;
  encoding: string;
  expectedRevision?: SftpFileRevision | null;
  create: boolean;
  overwriteOnConflict: boolean;
}

export interface SftpWriteTextFileResponse {
  hostId: string;
  path: string;
  bytesWritten: number;
  encoding: string;
  lineEnding: string;
  revision: SftpFileRevision;
}

export interface SftpPathStat {
  hostId: string;
  path: string;
  kind: SftpEntryKind;
  size?: number | null;
  permissions?: string | null;
  modified?: string | null;
  revision?: SftpFileRevision | null;
  readonly: boolean;
}

export interface SftpDeleteRequest extends SftpPathRequest {
  directory: boolean;
}

export interface SftpRenameRequest {
  hostId: string;
  fromPath: string;
  toPath: string;
}

export interface SftpChmodRequest extends SftpPathRequest {
  mode: string;
}

export type SftpTransferConflictPolicy = "overwrite" | "skip" | "rename";

export interface SftpTransferRequest {
  hostId: string;
  remotePath: string;
  localPath: string;
  viewScope?: string | null;
  conflictPolicy: SftpTransferConflictPolicy;
}

export type SftpTransferDirection = "upload" | "download";
export type SftpTransferKind = "file" | "directory";
export type SftpTransferStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "canceled";
export type SftpTransferEndpoint =
  | { kind: "local"; path: string }
  | { kind: "remote"; hostId: string; hostLabel: string; path: string };
export type SftpTransferOperation =
  | "upload"
  | "download"
  | "remoteCopy"
  | "archiveDownload"
  | "archiveUpload"
  | "clipboardDownload";
type SftpTransferTransportMode =
  | "singleHostSftp"
  | "clientBridge"
  | "localStage";

export interface SftpManagedTransferRequest extends SftpTransferRequest {
  direction: SftpTransferDirection;
  kind: SftpTransferKind;
  idleTimeoutSeconds?: number;
}

export interface SftpRemoteCopyRequest {
  conflictPolicy: SftpTransferConflictPolicy;
  sourceHostId: string;
  sourceRemotePath: string;
  targetHostId: string;
  targetRemotePath: string;
  kind: SftpTransferKind;
  viewScope?: string | null;
  idleTimeoutSeconds?: number;
}

export interface SftpArchiveDownloadRequest {
  conflictPolicy: SftpTransferConflictPolicy;
  hostId: string;
  sourceRemotePath: string;
  targetLocalPath: string;
  kind: SftpTransferKind;
  viewScope?: string | null;
}

export interface SftpArchiveUploadRequest {
  conflictPolicy: SftpTransferConflictPolicy;
  hostId: string;
  sourceLocalPath: string;
  targetRemotePath: string;
  kind: SftpTransferKind;
  viewScope?: string | null;
}

export interface SftpClipboardDownloadRequest {
  hostId: string;
  sourceRemotePath: string;
  kind: SftpTransferKind;
  viewScope?: string | null;
}

export interface SftpTransferScopeRequest {
  viewScope?: string | null;
}

type SftpLocalPathKind = "file" | "directory";

export interface SftpClassifyLocalPathsRequest {
  paths: string[];
}

export interface SftpLocalPathInfo {
  path: string;
  kind: SftpLocalPathKind;
}

export interface SftpTransferCancelRequest {
  transferId: string;
  viewScope?: string | null;
}

export interface SftpTransferRetryRequest {
  transferId: string;
  viewScope?: string | null;
}

export interface SftpTransferSummary {
  id: string;
  hostId: string;
  viewScope?: string | null;
  remotePath: string;
  localPath: string;
  direction: SftpTransferDirection;
  kind: SftpTransferKind;
  conflictPolicy?: SftpTransferConflictPolicy | null;
  status: SftpTransferStatus;
  bytesTransferred: number;
  speedBytesPerSecond?: number;
  totalBytes?: number | null;
  error?: string | null;
  cancelRequested: boolean;
  /** 前端直传容器任务没有后台取消通道；缺失时沿用普通 SFTP 可取消语义。 */
  cancelable?: boolean;
  createdAt: number;
  updatedAt: number;
  operation: SftpTransferOperation;
  source: SftpTransferEndpoint;
  target: SftpTransferEndpoint;
  transportMode: SftpTransferTransportMode;
  phase?: string | null;
  currentItem?: string | null;
  /** 实际采用的保护值；旧版缓存任务可暂时缺失。 */
  idleTimeoutSeconds?: number;
  failureKind?: "idleTimeout" | "commitUnknown" | "other" | null;
  /** 最近一次获得远端确认的时间，兼容旧任务时允许缺失。 */
  lastProgressAt?: number | null;
  /** 已执行的自动恢复次数；手动重试由后端生成新的任务快照。 */
  recoveryAttempt?: number;
  /** 后端是否允许用户继续该任务。 */
  retryable?: boolean;
  /** 任务是否保留了可安全续传的断点。 */
  resumable?: boolean;
  /** 手动重试已创建的后继任务；存在时旧任务不再显示重复恢复入口。 */
  successorId?: string | null;
}

export interface SftpTrustHostKeyRequest {
  hostId: string;
}

export interface SftpHostKeyTrustSummary {
  hostId: string;
  host: string;
  port: number;
  knownHostsPath: string;
}
