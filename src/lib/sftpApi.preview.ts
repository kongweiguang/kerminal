/** @author kongweiguang */

import type {
  SftpArchiveDownloadRequest,
  SftpArchiveUploadRequest,
  SftpChmodRequest,
  SftpClassifyLocalPathsRequest,
  SftpClipboardDownloadRequest,
  SftpDeleteRequest,
  SftpDirectoryListing,
  SftpEntry,
  SftpEntryKind,
  SftpFilePreview,
  SftpFileRevision,
  SftpHostKeyTrustSummary,
  SftpListDirectoryRequest,
  SftpLocalPathInfo,
  SftpManagedTransferRequest,
  SftpPathRequest,
  SftpPathStat,
  SftpPreviewRequest,
  SftpReadTextFileRequest,
  SftpReadTextFileResponse,
  SftpRemoteCopyRequest,
  SftpRenameRequest,
  SftpTransferCancelRequest,
  SftpTransferDirection,
  SftpTransferEndpoint,
  SftpTransferKind,
  SftpTransferOperation,
  SftpTransferRequest,
  SftpTransferRetryRequest,
  SftpTransferScopeRequest,
  SftpTransferSummary,
  SftpTrustHostKeyRequest,
  SftpWriteTextFileRequest,
  SftpWriteTextFileResponse,
} from "./sftpApiTypes";

export function browserPreviewListing(
  request: SftpListDirectoryRequest,
): SftpDirectoryListing {
  const path = normalizePreviewPath(request.path);

  return {
    entries: browserPreviewEntriesByPath[path] ?? [],
    hostId: request.hostId,
    parentPath: parentPreviewPath(path),
    path,
  };
}

export function browserCreateSftpDirectory(_request: SftpPathRequest) {
  return true;
}

export function browserDeleteSftpPath(_request: SftpDeleteRequest) {
  return true;
}

export function browserRenameSftpPath(_request: SftpRenameRequest) {
  return true;
}

const browserPreviewEntriesByPath: Record<string, SftpEntry[]> = {
  "/": [
    previewEntry("/", "var", "directory", "drwxr-xr-x", 4096),
    previewEntry("/", "srv", "directory", "drwxr-xr-x", 4096),
    previewEntry("/", "home", "directory", "drwxr-xr-x", 4096),
  ],
  "/var": [previewEntry("/var", "log", "directory", "drwxr-xr-x", 4096)],
  "/var/log": [
    previewEntry("/var/log", "app.log", "file", "-rw-r--r--", 524288),
    previewEntry("/var/log", "nginx", "directory", "drwxr-xr-x", 4096),
    previewEntry("/var/log", "current", "symlink", "lrwxrwxrwx", 7),
  ],
  "/srv": [previewEntry("/srv", "app", "directory", "drwxr-xr-x", 4096)],
  "/srv/app": [
    previewEntry("/srv/app", "release.sh", "file", "-rwxr-xr-x", 2048),
    previewEntry("/srv/app", "config", "directory", "drwx------", 4096),
  ],
  "/home": [previewEntry("/home", "deploy", "directory", "drwxr-xr-x", 4096)],
  "/home/deploy": [
    previewEntry("/home/deploy", ".ssh", "directory", "drwx------", 4096),
    previewEntry("/home/deploy", "README.md", "file", "-rw-r--r--", 1200),
  ],
};

const browserTextFileSeeds: Record<string, string> = {
  "/home/deploy/README.md":
    "# Kerminal 预览\n\n浏览器预览内容；桌面应用会读取真实远程文件。",
  "/srv/app/release.sh":
    "#!/usr/bin/env bash\nset -euo pipefail\nnpm run check\nsystemctl --user restart kerminal-preview",
  "/var/log/app.log": [
    "2026-06-17 18:00:00 INFO service started",
    "2026-06-17 18:01:12 WARN retrying remote task",
    "2026-06-17 18:02:20 INFO health check ok",
    "2026-06-17 18:03:44 INFO worker completed sftp preview smoke",
    "2026-06-17 18:04:09 INFO audit record persisted for browser preview",
    "2026-06-17 18:05:31 INFO release candidate remains healthy",
  ].join("\n"),
};

const browserTextFiles = new Map<string, string>();

export function browserPreviewFile(
  request: SftpPreviewRequest,
): SftpFilePreview {
  const path = normalizePreviewPath(request.path);
  const maxBytes = normalizePreviewMaxBytes(request.maxBytes);
  const rawContent = browserTextContent(path);
  const content =
    rawContent.length > maxBytes ? rawContent.slice(0, maxBytes) : rawContent;

  return {
    bytesRead: content.length,
    content,
    encoding: "utf-8-lossy",
    hostId: request.hostId,
    maxBytes,
    path,
    truncated: rawContent.length > maxBytes,
  };
}

export function browserReadTextFile(
  request: SftpReadTextFileRequest,
): SftpReadTextFileResponse {
  const path = normalizePreviewPath(request.path);
  const maxBytes = normalizeTextFileMaxBytes(request.maxBytes);
  const rawContent = browserTextContent(path);
  const content =
    rawContent.length > maxBytes ? rawContent.slice(0, maxBytes) : rawContent;
  const truncated = rawContent.length > maxBytes;

  return {
    binary: false,
    bytesRead: content.length,
    content,
    encoding: "utf-8",
    hostId: request.hostId,
    lineEnding: browserLineEnding(content),
    maxBytes,
    path,
    readonly: truncated,
    revision: browserRevision(path, rawContent),
    truncated,
  };
}

export function browserWriteTextFile(
  request: SftpWriteTextFileRequest,
): SftpWriteTextFileResponse {
  const path = normalizePreviewPath(request.path);
  const encoding = normalizeBrowserTextEncoding(request.encoding);
  const exists = browserTextFileExists(path);
  const currentContent = browserTextContent(path);
  const currentRevision = browserRevision(path, currentContent);

  if (request.create && exists && !request.overwriteOnConflict) {
    throw new Error(`远程文件已存在: ${path}`);
  }
  if (
    !request.create &&
    !request.overwriteOnConflict &&
    !request.expectedRevision
  ) {
    throw new Error("保存远程文件必须提供 expectedRevision");
  }
  if (
    !request.create &&
    !request.overwriteOnConflict &&
    request.expectedRevision &&
    !sameBrowserRevision(currentRevision, request.expectedRevision)
  ) {
    throw new Error("远端已变更，请重载或覆盖。");
  }

  browserTextFiles.set(path, request.content);

  return {
    bytesWritten: request.content.length,
    encoding,
    hostId: request.hostId,
    lineEnding: browserLineEnding(request.content),
    path,
    revision: browserRevision(path, request.content),
  };
}

export function browserStatPath(request: SftpPathRequest): SftpPathStat {
  const path = normalizePreviewPath(request.path);
  const entry = browserFindEntry(path);
  const isDirectory = path === "/" || Boolean(browserPreviewEntriesByPath[path]);
  const isFile = browserTextFileExists(path) || entry?.kind === "file";
  const content = isFile ? browserTextContent(path) : "";

  return {
    hostId: request.hostId,
    kind: isDirectory ? "directory" : (entry?.kind ?? "file"),
    modified: entry?.modified ?? "Jun 17 18:00",
    path,
    permissions:
      entry?.permissions ?? (isDirectory ? "drwxr-xr-x" : "-rw-r--r--"),
    readonly: !isFile,
    revision: isFile ? browserRevision(path, content) : null,
    size: isDirectory ? 4096 : (entry?.size ?? content.length),
  };
}

export function browserChmodSftpPath(_request: SftpChmodRequest) {
  return true;
}

export function browserUploadSftpFile(_request: SftpTransferRequest) {
  return true;
}

export function browserUploadSftpDirectory(_request: SftpTransferRequest) {
  return true;
}

export function browserDownloadSftpFile(_request: SftpTransferRequest) {
  return true;
}

export function browserDownloadSftpDirectory(_request: SftpTransferRequest) {
  return true;
}

export function browserTrustHostKey(
  request: SftpTrustHostKeyRequest,
): SftpHostKeyTrustSummary {
  return {
    host: request.hostId,
    hostId: request.hostId,
    knownHostsPath: "browser-preview-known-hosts",
    port: 22,
  };
}

function previewEntry(
  basePath: string,
  name: string,
  kind: SftpEntryKind,
  permissions: string,
  size: number,
): SftpEntry {
  return {
    kind,
    modified: "Jun 17 18:00",
    name,
    path: basePath === "/" ? `/${name}` : `${basePath}/${name}`,
    permissions,
    raw: `${permissions} ${size} ${name}`,
    size,
  };
}

function normalizePreviewPath(path: string) {
  const normalized = path.trim().replace(/\\/g, "/") || "/";
  return normalized.length > 1 ? normalized.replace(/\/+$/g, "") : normalized;
}

function parentPreviewPath(path: string) {
  if (path === "/") {
    return undefined;
  }
  const parent = path.slice(0, path.lastIndexOf("/"));
  return parent || "/";
}

function normalizePreviewMaxBytes(maxBytes: number | undefined) {
  if (!maxBytes || !Number.isFinite(maxBytes)) {
    return 16 * 1024;
  }
  return Math.min(Math.max(Math.trunc(maxBytes), 256), 128 * 1024);
}

function normalizeTextFileMaxBytes(maxBytes: number | undefined) {
  if (!maxBytes || !Number.isFinite(maxBytes)) {
    return 2 * 1024 * 1024;
  }
  return Math.min(Math.max(Math.trunc(maxBytes), 1024), 10 * 1024 * 1024);
}

function normalizeBrowserTextEncoding(encoding: string) {
  const normalized = encoding.trim().toLowerCase();
  if (normalized !== "utf-8") {
    throw new Error(`暂不支持保存 ${encoding} 编码的远程文件`);
  }
  return "utf-8";
}

function browserTextFileExists(path: string) {
  return (
    browserTextFiles.has(path) ||
    Object.prototype.hasOwnProperty.call(browserTextFileSeeds, path)
  );
}

function browserTextContent(path: string) {
  return (
    browserTextFiles.get(path) ??
    browserTextFileSeeds[path] ??
    `Kerminal 浏览器预览文件\n远程路径：${path}\n`
  );
}

function browserFindEntry(path: string) {
  const parent = parentPreviewPath(path);
  const listing = parent ? browserPreviewEntriesByPath[parent] : undefined;
  return listing?.find((entry) => entry.path === path);
}

function browserRevision(path: string, content: string): SftpFileRevision {
  const entry = browserFindEntry(path);
  return {
    contentSha256: browserChecksum(`${path}\n${content}`),
    modified: entry?.modified ?? "Jun 17 18:00",
    permissions: entry?.permissions ?? "-rw-r--r--",
    permissionsMode: null,
    size: content.length,
  };
}

function sameBrowserRevision(
  current: SftpFileRevision,
  expected: SftpFileRevision,
) {
  if (current.contentSha256 && expected.contentSha256) {
    return current.contentSha256 === expected.contentSha256;
  }
  return (
    current.size === expected.size &&
    current.modified === expected.modified &&
    current.permissions === expected.permissions
  );
}

function browserChecksum(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 16777619) >>> 0;
  }
  return `browser-${hash.toString(16).padStart(8, "0")}`;
}

function browserLineEnding(content: string) {
  const hasCrLf = content.includes("\r\n");
  const hasLf = /(?<!\r)\n/.test(content);
  if (hasCrLf && hasLf) {
    return "mixed";
  }
  if (hasCrLf) {
    return "crlf";
  }
  return "lf";
}

const browserTransfers: SftpTransferSummary[] = [];
const browserTransferTimers = new Map<string, ReturnType<typeof setInterval>>();
const browserTransferRetries = new Map<string, string>();
let browserTransferSeq = 0;

function browserLocalEndpoint(path: string): SftpTransferEndpoint {
  return { kind: "local", path };
}

function browserRemoteEndpoint(
  hostId: string,
  path: string,
  hostLabel = hostId,
): SftpTransferEndpoint {
  return { hostId, hostLabel, kind: "remote", path };
}

function managedBrowserTransferOperation(
  direction: SftpTransferDirection,
): SftpTransferOperation {
  return direction === "upload" ? "upload" : "download";
}

function browserManagedTransferSource(
  request: SftpManagedTransferRequest,
): SftpTransferEndpoint {
  return request.direction === "upload"
    ? browserLocalEndpoint(request.localPath)
    : browserRemoteEndpoint(request.hostId, request.remotePath);
}

function browserManagedTransferTarget(
  request: SftpManagedTransferRequest,
): SftpTransferEndpoint {
  return request.direction === "upload"
    ? browserRemoteEndpoint(request.hostId, request.remotePath)
    : browserLocalEndpoint(request.localPath);
}

/**
 * 浏览器预览用同一份快照形状模拟后台队列，默认保留可观察的恢复元数据，
 * 这样预览不会把桌面端的等待、重试和进度布局误导成同步上传。
 *
 * @author kongweiguang
 */
export function browserEnqueueTransfer(
  request: SftpManagedTransferRequest,
  metadata: Partial<
    Pick<
      SftpTransferSummary,
      | "currentItem"
      | "operation"
      | "phase"
      | "source"
      | "target"
      | "transportMode"
      | "bytesTransferred"
      | "totalBytes"
      | "lastProgressAt"
      | "recoveryAttempt"
      | "retryable"
      | "resumable"
    >
  > = {},
): SftpTransferSummary {
  const now = nowSeconds();
  const totalBytes = browserTransferTotalBytes(request);
  const transfer: SftpTransferSummary = {
    ...request,
    bytesTransferred: 0,
    cancelRequested: false,
    createdAt: now,
    id: `browser-transfer-${++browserTransferSeq}`,
    status: "running",
    speedBytesPerSecond: 0,
    totalBytes,
    updatedAt: now,
    operation: managedBrowserTransferOperation(request.direction),
    viewScope: request.viewScope ?? null,
    source: browserManagedTransferSource(request),
    target: browserManagedTransferTarget(request),
    transportMode: "singleHostSftp",
    phase: "running",
    currentItem: null,
    lastProgressAt: now,
    recoveryAttempt: 0,
    retryable: true,
    resumable: request.kind === "file",
    ...metadata,
  };
  browserTransfers.unshift(transfer);
  startBrowserTransferSimulation(transfer.id);
  return { ...transfer };
}

export function browserEnqueueRemoteCopy(
  request: SftpRemoteCopyRequest,
): SftpTransferSummary {
  return browserEnqueueTransfer(
    {
      conflictPolicy: request.conflictPolicy,
      direction: "upload",
      hostId: request.targetHostId,
      kind: request.kind,
      localPath: `sftp://${request.sourceHostId}${request.sourceRemotePath}`,
      remotePath: request.targetRemotePath,
      viewScope: request.viewScope ?? null,
    },
    {
      operation: "remoteCopy",
      source: browserRemoteEndpoint(
        request.sourceHostId,
        request.sourceRemotePath,
      ),
      target: browserRemoteEndpoint(
        request.targetHostId,
        request.targetRemotePath,
      ),
      transportMode: "clientBridge",
    },
  );
}

export function browserEnqueueArchiveDownload(
  request: SftpArchiveDownloadRequest,
): SftpTransferSummary {
  return browserEnqueueTransfer(
    {
      conflictPolicy: request.conflictPolicy,
      direction: "download",
      hostId: request.hostId,
      kind: request.kind,
      localPath: request.targetLocalPath,
      remotePath: request.sourceRemotePath,
      viewScope: request.viewScope ?? null,
    },
    { operation: "archiveDownload" },
  );
}

export function browserEnqueueArchiveUpload(
  request: SftpArchiveUploadRequest,
): SftpTransferSummary {
  return browserEnqueueTransfer(
    {
      conflictPolicy: request.conflictPolicy,
      direction: "upload",
      hostId: request.hostId,
      kind: "file",
      localPath: request.sourceLocalPath,
      remotePath: request.targetRemotePath,
      viewScope: request.viewScope ?? null,
    },
    { operation: "archiveUpload" },
  );
}

export function browserEnqueueClipboardDownload(
  request: SftpClipboardDownloadRequest,
): SftpTransferSummary {
  return browserEnqueueTransfer(
    {
      conflictPolicy: "overwrite",
      direction: "download",
      hostId: request.hostId,
      kind: request.kind,
      localPath: `~/Downloads/${browserRemoteFileName(request.sourceRemotePath, request.kind)}`,
      remotePath: request.sourceRemotePath,
      viewScope: request.viewScope ?? null,
    },
    { operation: "clipboardDownload" },
  );
}

export function browserListTransfers(
  request: SftpTransferScopeRequest = {},
): SftpTransferSummary[] {
  return browserTransfers
    .filter((transfer) => transferMatchesViewScope(transfer, request.viewScope))
    .map((transfer) => ({ ...transfer }));
}

/**
 * 预览端立即落为取消终态，桌面端则由真实通道异步确认；两者都停止进度模拟并释放定时器。
 *
 * @author kongweiguang
 */
export function browserCancelTransfer(
  request: SftpTransferCancelRequest,
): SftpTransferSummary {
  const transfer = browserTransfers.find(
    (item) => item.id === request.transferId,
  );
  if (!transfer) {
    throw new Error(`SFTP 传输任务不存在: ${request.transferId}`);
  }
  if (!transferMatchesViewScope(transfer, request.viewScope)) {
    throw new Error(`SFTP 传输任务不属于当前视图: ${request.transferId}`);
  }
  transfer.cancelRequested = true;
  transfer.status = "canceled";
  transfer.phase = "canceled";
  transfer.speedBytesPerSecond = 0;
  transfer.updatedAt = nowSeconds();
  stopBrowserTransferSimulation(transfer.id);
  return { ...transfer };
}

/**
 * 浏览器预览按旧任务 ID 幂等创建后继任务，避免重复点击生成多个模拟上传。
 * 真实桌面端由 Rust 保证断点校验和同目标互斥，预览只复现调用与展示契约。
 *
 * @author kongweiguang
 */
export function browserRetryTransfer(
  request: SftpTransferRetryRequest,
): SftpTransferSummary {
  const transfer = browserTransfers.find(
    (item) => item.id === request.transferId,
  );
  if (!transfer) {
    throw new Error(`SFTP 传输任务不存在: ${request.transferId}`);
  }
  if (!transferMatchesViewScope(transfer, request.viewScope)) {
    throw new Error(`SFTP 传输任务不属于当前视图: ${request.transferId}`);
  }
  if (transfer.status !== "failed" && transfer.status !== "canceled") {
    throw new Error("只有失败或已取消的传输任务可以重试。");
  }
  if (transfer.retryable === false || transfer.failureKind === "commitUnknown") {
    throw new Error("该传输任务当前不可重试。");
  }
  if (
    transfer.operation !== "upload" &&
    transfer.operation !== "download"
  ) {
    throw new Error("该传输类型暂不支持安全重试。");
  }
  if (transfer.transportMode !== "singleHostSftp") {
    throw new Error("该传输方式暂不支持安全重试。");
  }

  const existingRetryId = browserTransferRetries.get(transfer.id);
  if (existingRetryId) {
    const existingRetry = browserTransfers.find(
      (item) => item.id === existingRetryId,
    );
    if (existingRetry) {
      return { ...existingRetry };
    }
    browserTransferRetries.delete(transfer.id);
  }

  const resumable = transfer.resumable !== false;
  const resumedBytes = resumable
    ? Math.min(transfer.bytesTransferred, transfer.totalBytes ?? transfer.bytesTransferred)
    : 0;
  const retry = browserEnqueueTransfer(
    {
      conflictPolicy: transfer.conflictPolicy ?? "overwrite",
      direction: transfer.direction,
      hostId: transfer.hostId,
      kind: transfer.kind,
      localPath: transfer.localPath,
      remotePath: transfer.remotePath,
      viewScope: transfer.viewScope ?? null,
      idleTimeoutSeconds: transfer.idleTimeoutSeconds,
    },
    {
      bytesTransferred: resumedBytes,
      lastProgressAt: nowSeconds(),
      recoveryAttempt: (transfer.recoveryAttempt ?? 0) + 1,
      resumable,
      retryable: true,
      totalBytes: transfer.totalBytes ?? undefined,
    },
  );
  browserTransferRetries.set(transfer.id, retry.id);
  transfer.successorId = retry.id;
  return { ...retry };
}

export function browserClearCompletedTransfers(
  request: SftpTransferScopeRequest = {},
): SftpTransferSummary[] {
  for (let index = browserTransfers.length - 1; index >= 0; index -= 1) {
    const transfer = browserTransfers[index];
    if (
      transferMatchesViewScope(transfer, request.viewScope) &&
      (transfer.status === "succeeded" ||
        transfer.status === "failed" ||
        transfer.status === "canceled")
    ) {
      stopBrowserTransferSimulation(transfer.id);
      browserTransfers.splice(index, 1);
    }
  }
  return browserListTransfers(request);
}

function transferMatchesViewScope(
  transfer: SftpTransferSummary,
  viewScope: string | null | undefined,
) {
  return viewScope === undefined
    ? true
    : (transfer.viewScope ?? null) === viewScope;
}

export function browserClassifyLocalPaths(
  request: SftpClassifyLocalPathsRequest,
): SftpLocalPathInfo[] {
  return request.paths.map((path) => ({
    kind: path.endsWith("/") || path.endsWith("\\") ? "directory" : "file",
    path,
  }));
}

export function browserReadSftpLocalFileClipboard(): SftpLocalPathInfo[] {
  return [];
}

/**
 * 预览计时器按确认块推进 lastProgressAt，供等待响应与恢复 UI 在无真实网络时保持可测。
 *
 * @author kongweiguang
 */
function startBrowserTransferSimulation(transferId: string) {
  stopBrowserTransferSimulation(transferId);
  const timer = setInterval(() => {
    const transfer = browserTransfers.find((item) => item.id === transferId);
    if (!transfer || transfer.status !== "running") {
      stopBrowserTransferSimulation(transferId);
      return;
    }
    const totalBytes = transfer.totalBytes ?? 512 * 1024;
    const chunk = Math.max(32 * 1024, Math.ceil(totalBytes / 6));
    const nextBytesTransferred = Math.min(
      totalBytes,
      transfer.bytesTransferred + chunk,
    );
    transfer.speedBytesPerSecond = Math.round(
      ((nextBytesTransferred - transfer.bytesTransferred) * 1000) / 220,
    );
    transfer.bytesTransferred = Math.min(
      totalBytes,
      nextBytesTransferred,
    );
    transfer.updatedAt = nowSeconds();
    transfer.lastProgressAt = transfer.updatedAt;
    if (transfer.bytesTransferred >= totalBytes) {
      transfer.status = "succeeded";
      transfer.phase = "done";
      transfer.speedBytesPerSecond = 0;
      stopBrowserTransferSimulation(transferId);
    }
  }, 220);
  browserTransferTimers.set(transferId, timer);
}

function stopBrowserTransferSimulation(transferId: string) {
  const timer = browserTransferTimers.get(transferId);
  if (timer) {
    clearInterval(timer);
    browserTransferTimers.delete(transferId);
  }
}

function browserTransferTotalBytes(request: SftpManagedTransferRequest) {
  return request.kind === "directory" ? 4 * 1024 * 1024 : 768 * 1024;
}

function browserRemoteFileName(path: string, kind: SftpTransferKind) {
  const fallback = kind === "directory" ? "remote-directory" : "remote-file";
  return (
    path
      .replace(/\\/g, "/")
      .replace(/\/+$/g, "")
      .split("/")
      .filter(Boolean)
      .pop() || fallback
  );
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}
