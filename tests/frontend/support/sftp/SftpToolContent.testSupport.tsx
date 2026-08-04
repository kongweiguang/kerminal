// @author kongweiguang

import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, vi } from "vitest";
import type { Machine } from "../../../../src/features/workspace/types";
import type { SftpTransferSummary } from "../../../../src/lib/sftpApi";

const sftpApiMocks = vi.hoisted(() => ({
  cancelSftpTransfer: vi.fn(),
  chmodSftpPath: vi.fn(),
  classifySftpLocalPaths: vi.fn(),
  clearCompletedSftpTransfers: vi.fn(),
  createSftpDirectory: vi.fn(),
  deleteSftpPath: vi.fn(),
  downloadSftpDirectory: vi.fn(),
  downloadSftpFile: vi.fn(),
  enqueueSftpArchiveDownload: vi.fn(),
  enqueueSftpArchiveUpload: vi.fn(),
  enqueueSftpClipboardDownload: vi.fn(),
  enqueueSftpRemoteCopy: vi.fn(),
  enqueueSftpTransfer: vi.fn(),
  listSftpDirectory: vi.fn(),
  listSftpTransfers: vi.fn(),
  previewSftpFile: vi.fn(),
  readSftpLocalFileClipboard: vi.fn(),
  renameSftpPath: vi.fn(),
  statSftpPath: vi.fn(),
  trustSftpHostKey: vi.fn(),
  uploadSftpDirectory: vi.fn(),
  uploadSftpFile: vi.fn(),
}));

const containerFilesApiMocks = vi.hoisted(() => ({
  chmodDockerContainerPath: vi.fn(),
  createDockerContainerDirectory: vi.fn(),
  deleteDockerContainerPath: vi.fn(),
  downloadDockerContainerPath: vi.fn(),
  listDockerContainerDirectory: vi.fn(),
  renameDockerContainerPath: vi.fn(),
  uploadDockerContainerPath: vi.fn(),
}));

const fileDialogMocks = vi.hoisted(() => ({
  listLocalDirectory: vi.fn(),
  selectLocalDirectory: vi.fn(),
  selectLocalFile: vi.fn(),
  selectSaveFile: vi.fn(),
}));

const localFilesApiMocks = vi.hoisted(() => ({
  statLocalPath: vi.fn(),
}));

const sshCommandApiMocks = vi.hoisted(() => ({
  executeSshCommand: vi.fn(),
}));

const desktopRuntimeMocks = vi.hoisted(() => ({
  listen: vi.fn(),
  listenToDragDrop: vi.fn(),
  transferHandler: undefined as
    | ((payload: SftpTransferSummary) => void)
    | undefined,
}));

vi.mock("../../../../src/lib/desktopRuntimeApi", () => ({
  desktopRuntime: {
    get mode() {
      return (window as Window & { __TAURI_INTERNALS__?: unknown })
        .__TAURI_INTERNALS__
        ? "desktop"
        : "preview";
    },
    listen: (...args: unknown[]) => desktopRuntimeMocks.listen(...args),
    listenToDragDrop: (...args: unknown[]) =>
      desktopRuntimeMocks.listenToDragDrop(...args),
  },
}));

vi.mock("../../../../src/features/sftp/RemoteWorkspaceEditor", () => ({
  RemoteWorkspaceEditor: ({
    onDirtyStateChange,
    openCommand,
    onStatus,
    rootPath,
    target,
  }: {
    onDirtyStateChange?: (dirty: boolean) => void;
    onStatus?: (status: {
      kind: "info" | "success" | "error";
      message: string;
    }) => void;
    openCommand?: { path: string } | null;
    rootPath: string;
    target?: { kind: string };
  }) => (
    <div data-testid="remote-workspace-editor">
      {openCommand?.path ?? rootPath}
      <span data-testid="remote-workspace-target">{target?.kind}</span>
      <button
        onClick={() =>
          onStatus?.({
            kind: "error",
            message:
              "容器操作失败: 容器文件包含二进制内容，暂不支持作为文本编辑: /bwy/server/app.jar",
          })
        }
        type="button"
      >
        触发工作区错误
      </button>
      <button onClick={() => onDirtyStateChange?.(true)} type="button">
        标记工作区未保存
      </button>
      <button onClick={() => onDirtyStateChange?.(false)} type="button">
        清除工作区未保存
      </button>
    </div>
  ),
}));

vi.mock("../../../../src/lib/sftpApi", () => ({
  cancelSftpTransfer: (...args: unknown[]) => sftpApiMocks.cancelSftpTransfer(...args),
  chmodSftpPath: (...args: unknown[]) => sftpApiMocks.chmodSftpPath(...args),
  classifySftpLocalPaths: (...args: unknown[]) => sftpApiMocks.classifySftpLocalPaths(...args),
  clearCompletedSftpTransfers: (...args: unknown[]) => sftpApiMocks.clearCompletedSftpTransfers(...args),
  createSftpDirectory: (...args: unknown[]) => sftpApiMocks.createSftpDirectory(...args),
  deleteSftpPath: (...args: unknown[]) => sftpApiMocks.deleteSftpPath(...args),
  downloadSftpDirectory: (...args: unknown[]) => sftpApiMocks.downloadSftpDirectory(...args),
  downloadSftpFile: (...args: unknown[]) => sftpApiMocks.downloadSftpFile(...args),
  enqueueSftpArchiveDownload: (...args: unknown[]) =>
    sftpApiMocks.enqueueSftpArchiveDownload(...args),
  enqueueSftpArchiveUpload: (...args: unknown[]) =>
    sftpApiMocks.enqueueSftpArchiveUpload(...args),
  enqueueSftpClipboardDownload: (...args: unknown[]) =>
    sftpApiMocks.enqueueSftpClipboardDownload(...args),
  enqueueSftpRemoteCopy: (...args: unknown[]) =>
    sftpApiMocks.enqueueSftpRemoteCopy(...args),
  enqueueSftpTransfer: (...args: unknown[]) =>
    sftpApiMocks.enqueueSftpTransfer(...args),
  listSftpDirectory: (...args: unknown[]) => sftpApiMocks.listSftpDirectory(...args),
  listSftpTransfers: (...args: unknown[]) => sftpApiMocks.listSftpTransfers(...args),
  previewSftpFile: (...args: unknown[]) =>
    sftpApiMocks.previewSftpFile(...args),
  readSftpLocalFileClipboard: (...args: unknown[]) => sftpApiMocks.readSftpLocalFileClipboard(...args),
  renameSftpPath: (...args: unknown[]) => sftpApiMocks.renameSftpPath(...args),
  statSftpPath: (...args: unknown[]) => sftpApiMocks.statSftpPath(...args),
  trustSftpHostKey: (...args: unknown[]) =>
    sftpApiMocks.trustSftpHostKey(...args),
  uploadSftpDirectory: (...args: unknown[]) =>
    sftpApiMocks.uploadSftpDirectory(...args),
  uploadSftpFile: (...args: unknown[]) => sftpApiMocks.uploadSftpFile(...args),
}));

vi.mock("../../../../src/lib/containerFilesApi", () => ({
  chmodDockerContainerPath: (...args: unknown[]) =>
    containerFilesApiMocks.chmodDockerContainerPath(...args),
  createDockerContainerDirectory: (...args: unknown[]) =>
    containerFilesApiMocks.createDockerContainerDirectory(...args),
  deleteDockerContainerPath: (...args: unknown[]) =>
    containerFilesApiMocks.deleteDockerContainerPath(...args),
  downloadDockerContainerPath: (...args: unknown[]) =>
    containerFilesApiMocks.downloadDockerContainerPath(...args),
  listDockerContainerDirectory: (...args: unknown[]) =>
    containerFilesApiMocks.listDockerContainerDirectory(...args),
  renameDockerContainerPath: (...args: unknown[]) =>
    containerFilesApiMocks.renameDockerContainerPath(...args),
  uploadDockerContainerPath: (...args: unknown[]) =>
    containerFilesApiMocks.uploadDockerContainerPath(...args),
}));

vi.mock("../../../../src/lib/fileDialogApi", () => ({
  listLocalDirectory: (...args: unknown[]) =>
    fileDialogMocks.listLocalDirectory(...args),
  selectLocalDirectory: (...args: unknown[]) =>
    fileDialogMocks.selectLocalDirectory(...args),
  selectLocalFile: (...args: unknown[]) =>
    fileDialogMocks.selectLocalFile(...args),
  selectSaveFile: (...args: unknown[]) =>
    fileDialogMocks.selectSaveFile(...args),
}));

vi.mock("../../../../src/lib/localFilesApi", () => ({
  statLocalPath: (...args: unknown[]) =>
    localFilesApiMocks.statLocalPath(...args),
}));

vi.mock("../../../../src/lib/sshCommandApi", () => ({
  executeSshCommand: (...args: unknown[]) =>
    sshCommandApiMocks.executeSshCommand(...args),
}));

export const sshMachine: Machine = {
  authType: "key",
  credentialRef: "C:/keys/prod_ed25519",
  description: "deploy@prod.internal:22",
  host: "prod.internal",
  id: "prod-api",
  kind: "ssh",
  name: "prod api",
  port: 22,
  status: "warning",
  tags: ["ssh", "prod"],
  username: "deploy",
};

export const sftpMachine: Machine = {
  ...sshMachine,
  description: "upload@files.internal:22",
  host: "files.internal",
  id: "prod-files",
  kind: "sftp",
  name: "prod files",
  username: "upload",
};

export const localMachine: Machine = {
  description: "默认本地配置",
  id: "local-powershell",
  kind: "local",
  latencyMs: 1,
  name: "PowerShell",
  status: "online",
  tags: ["local", "dev"],
};

export const stageSshMachine: Machine = {
  ...sshMachine,
  description: "deploy@stage.internal:22",
  host: "stage.internal",
  id: "stage-api",
  name: "stage api",
  status: "online",
};

export const containerMachine: Machine = {
  containerId: "container-api",
  containerName: "api",
  description: "api on prod api",
  id: "container-api",
  kind: "dockerContainer",
  name: "api",
  parentMachineId: "prod-api",
  runtime: "docker",
  status: "online",
  tags: ["docker"],
  target: {
    containerId: "container-api",
    containerName: "api",
    hostId: "prod-api",
    kind: "dockerContainer",
    runtime: "docker",
    workdir: "/app",
  },
  workdir: "/app",
};

export function createDragDataTransfer() {
  const store = new Map<string, string>();
  return {
    dropEffect: "none",
    effectAllowed: "all",
    clearData: vi.fn((type?: string) => {
      if (type) {
        store.delete(type);
        return;
      }
      store.clear();
    }),
    getData: vi.fn((type: string) => store.get(type) ?? ""),
    setData: vi.fn((type: string, value: string) => {
      store.set(type, value);
    }),
    setDragImage: vi.fn(),
  } as unknown as DataTransfer;
}

export function openCurrentDirectoryContextMenu() {
  fireEvent.contextMenu(screen.getByTestId("sftp-drop-zone"), {
    clientX: 24,
    clientY: 24,
  });
}

export function createSftpTransferSummary(
  overrides: Partial<SftpTransferSummary> = {},
): SftpTransferSummary {
  const direction = overrides.direction ?? "download";
  const hostId = overrides.hostId ?? "prod-api";
  const kind = overrides.kind ?? "file";
  const localPath = overrides.localPath ?? "/Users/me/Downloads/app.log";
  const remotePath = overrides.remotePath ?? "/var/log/app.log";
  const operation =
    overrides.operation ?? (direction === "upload" ? "upload" : "download");
  const source =
    overrides.source ??
    (direction === "upload"
      ? ({ kind: "local", path: localPath } as const)
      : ({
          hostId,
          hostLabel: hostId,
          kind: "remote",
          path: remotePath,
        } as const));
  const target =
    overrides.target ??
    (direction === "upload"
      ? ({
          hostId,
          hostLabel: hostId,
          kind: "remote",
          path: remotePath,
        } as const)
      : ({ kind: "local", path: localPath } as const));

  return {
    bytesTransferred: 0,
    cancelRequested: false,
    conflictPolicy: "overwrite",
    createdAt: 1,
    currentItem: null,
    direction,
    error: null,
    hostId,
    id: "transfer-1",
    kind,
    localPath,
    operation,
    phase: null,
    remotePath,
    source,
    status: "queued",
    target,
    totalBytes: null,
    transportMode: "singleHostSftp",
    updatedAt: 1,
    viewScope: null,
    ...overrides,
  };
}

beforeEach(() => {
  sftpApiMocks.cancelSftpTransfer.mockReset();
  sftpApiMocks.chmodSftpPath.mockReset();
  sftpApiMocks.classifySftpLocalPaths.mockReset();
  sftpApiMocks.clearCompletedSftpTransfers.mockReset();
  sftpApiMocks.createSftpDirectory.mockReset();
  sftpApiMocks.deleteSftpPath.mockReset();
  sftpApiMocks.downloadSftpDirectory.mockReset();
  sftpApiMocks.downloadSftpFile.mockReset();
  sftpApiMocks.enqueueSftpArchiveDownload.mockReset();
  sftpApiMocks.enqueueSftpArchiveUpload.mockReset();
  sftpApiMocks.enqueueSftpClipboardDownload.mockReset();
  sftpApiMocks.enqueueSftpRemoteCopy.mockReset();
  sftpApiMocks.enqueueSftpTransfer.mockReset();
  sftpApiMocks.listSftpDirectory.mockReset();
  sftpApiMocks.listSftpTransfers.mockReset();
  sftpApiMocks.previewSftpFile.mockReset();
  sftpApiMocks.readSftpLocalFileClipboard.mockReset();
  sftpApiMocks.renameSftpPath.mockReset();
  sftpApiMocks.statSftpPath.mockReset();
  sftpApiMocks.trustSftpHostKey.mockReset();
  sftpApiMocks.uploadSftpDirectory.mockReset();
  sftpApiMocks.uploadSftpFile.mockReset();
  containerFilesApiMocks.chmodDockerContainerPath.mockReset();
  containerFilesApiMocks.createDockerContainerDirectory.mockReset();
  containerFilesApiMocks.deleteDockerContainerPath.mockReset();
  containerFilesApiMocks.downloadDockerContainerPath.mockReset();
  containerFilesApiMocks.listDockerContainerDirectory.mockReset();
  containerFilesApiMocks.renameDockerContainerPath.mockReset();
  containerFilesApiMocks.uploadDockerContainerPath.mockReset();
  fileDialogMocks.selectLocalDirectory.mockReset();
  fileDialogMocks.listLocalDirectory.mockReset();
  fileDialogMocks.selectLocalFile.mockReset();
  fileDialogMocks.selectSaveFile.mockReset();
  localFilesApiMocks.statLocalPath.mockReset();
  sshCommandApiMocks.executeSshCommand.mockReset();
  desktopRuntimeMocks.listen.mockReset();
  desktopRuntimeMocks.listenToDragDrop.mockReset();
  desktopRuntimeMocks.transferHandler = undefined;
  Reflect.deleteProperty(
    window as Window & { __TAURI_INTERNALS__?: unknown },
    "__TAURI_INTERNALS__",
  );

  sftpApiMocks.chmodSftpPath.mockResolvedValue(true);
  sftpApiMocks.classifySftpLocalPaths.mockImplementation(
    async (request: { paths: string[] }) =>
      request.paths.map((path) => ({
        kind: path.endsWith("dist") ? "directory" : "file",
        path,
      })),
  );
  sftpApiMocks.cancelSftpTransfer.mockImplementation(
    async ({ transferId }) =>
      createSftpTransferSummary({
      bytesTransferred: 512,
      cancelRequested: true,
      createdAt: 1,
      direction: "download",
      hostId: "prod-api",
      id: transferId,
      kind: "file",
      localPath: "/Users/me/Downloads/app.log",
      remotePath: "/var/log/app.log",
      status: "canceled",
      totalBytes: 1024,
      updatedAt: 2,
    }),
  );
  sftpApiMocks.createSftpDirectory.mockResolvedValue(true);
  sftpApiMocks.deleteSftpPath.mockResolvedValue(true);
  sftpApiMocks.downloadSftpDirectory.mockResolvedValue(true);
  sftpApiMocks.downloadSftpFile.mockResolvedValue(true);
  sftpApiMocks.statSftpPath.mockRejectedValue(new Error("not found"));
  localFilesApiMocks.statLocalPath.mockResolvedValue({
    exists: false,
    path: "/Users/me/Downloads/missing",
    readonly: false,
  });
  sftpApiMocks.enqueueSftpArchiveDownload.mockImplementation(
    async (request) =>
      createSftpTransferSummary({
      direction: "download",
      hostId: request.hostId,
      id: "archive-download-1",
      kind: request.kind,
      localPath: request.targetLocalPath,
      operation: "archiveDownload",
      remotePath: request.sourceRemotePath,
      source: {
        hostId: request.hostId,
        hostLabel: request.hostId,
        kind: "remote",
        path: request.sourceRemotePath,
      },
      target: { kind: "local", path: request.targetLocalPath },
    }),
  );
  sftpApiMocks.enqueueSftpArchiveUpload.mockImplementation(
    async (request) =>
      createSftpTransferSummary({
      direction: "upload",
      hostId: request.hostId,
      id: "archive-upload-1",
      kind: "file",
      localPath: request.sourceLocalPath,
      operation: "archiveUpload",
      remotePath: request.targetRemotePath,
      source: { kind: "local", path: request.sourceLocalPath },
      target: {
        hostId: request.hostId,
        hostLabel: request.hostId,
        kind: "remote",
        path: request.targetRemotePath,
      },
    }),
  );
  sftpApiMocks.enqueueSftpClipboardDownload.mockImplementation(
    async (request) =>
      createSftpTransferSummary({
      direction: "download",
      hostId: request.hostId,
      id: "clipboard-download-1",
      kind: request.kind,
      localPath: "/Users/me/Downloads/app.log",
      operation: "clipboardDownload",
      remotePath: request.sourceRemotePath,
      source: {
        hostId: request.hostId,
        hostLabel: request.hostId,
        kind: "remote",
        path: request.sourceRemotePath,
      },
      target: { kind: "local", path: "/Users/me/Downloads/app.log" },
    }),
  );
  sftpApiMocks.enqueueSftpRemoteCopy.mockImplementation((request) =>
    Promise.resolve(createSftpTransferSummary({
    direction: "upload",
    hostId: request.targetHostId,
    id: "remote-copy-1",
    kind: request.kind,
    localPath: `sftp://${request.sourceHostId}${request.sourceRemotePath}`,
    operation: "remoteCopy",
    remotePath: request.targetRemotePath,
    source: {
      hostId: request.sourceHostId,
      hostLabel: request.sourceHostId,
      kind: "remote",
      path: request.sourceRemotePath,
    },
    target: {
      hostId: request.targetHostId,
      hostLabel: request.targetHostId,
      kind: "remote",
      path: request.targetRemotePath,
    },
    transportMode: "clientBridge",
  })),
  );
  sftpApiMocks.enqueueSftpTransfer.mockImplementation((request) =>
    Promise.resolve(createSftpTransferSummary({
    direction: request.direction,
    hostId: request.hostId,
    id: "transfer-1",
    kind: request.kind,
    localPath: request.localPath,
    remotePath: request.remotePath,
    source:
      request.direction === "upload"
        ? { kind: "local", path: request.localPath }
        : {
            hostId: request.hostId,
            hostLabel: request.hostId,
            kind: "remote",
            path: request.remotePath,
          },
    target:
      request.direction === "upload"
        ? {
            hostId: request.hostId,
            hostLabel: request.hostId,
            kind: "remote",
            path: request.remotePath,
          }
        : { kind: "local", path: request.localPath },
    totalBytes: request.direction === "upload" ? 1024 : undefined,
  })),
  );
  sftpApiMocks.listSftpTransfers.mockResolvedValue([]);
  desktopRuntimeMocks.listen.mockImplementation(async (_eventName, handler) => {
    desktopRuntimeMocks.transferHandler =
      handler as typeof desktopRuntimeMocks.transferHandler;
    return vi.fn();
  });
  sftpApiMocks.readSftpLocalFileClipboard.mockResolvedValue([]);
  sftpApiMocks.clearCompletedSftpTransfers.mockResolvedValue([]);
  sftpApiMocks.renameSftpPath.mockResolvedValue(true);
  sftpApiMocks.trustSftpHostKey.mockResolvedValue({
    host: "prod.internal",
    hostId: "prod-api",
    knownHostsPath: "known_hosts",
    port: 22,
  });
  sftpApiMocks.uploadSftpDirectory.mockResolvedValue(true);
  sftpApiMocks.uploadSftpFile.mockResolvedValue(true);
  containerFilesApiMocks.chmodDockerContainerPath.mockResolvedValue(true);
  containerFilesApiMocks.createDockerContainerDirectory.mockResolvedValue(true);
  containerFilesApiMocks.deleteDockerContainerPath.mockResolvedValue(true);
  containerFilesApiMocks.downloadDockerContainerPath.mockResolvedValue(true);
  containerFilesApiMocks.renameDockerContainerPath.mockResolvedValue(true);
  containerFilesApiMocks.uploadDockerContainerPath.mockResolvedValue(true);
  containerFilesApiMocks.listDockerContainerDirectory.mockImplementation(
    async ({ path }: { path: string }) => {
      if (path === "/app/logs") {
        return {
          containerId: "container-api",
          entries: [
            {
              kind: "file",
              modified: "Jun 18 17:00",
              name: "server.log",
              path: "/app/logs/server.log",
              permissions: "-rw-r--r--",
              raw: "-rw-r--r-- server.log",
              size: 4096,
            },
          ],
          hostId: "prod-api",
          parentPath: "/app",
          path: "/app/logs",
        };
      }

      return {
        containerId: "container-api",
        entries: [
          {
            kind: "file",
            modified: "Jun 18 16:00",
            name: "package.json",
            path: "/app/package.json",
            permissions: "-rw-r--r--",
            raw: "-rw-r--r-- package.json",
            size: 1460,
          },
          {
            kind: "directory",
            modified: "Jun 18 15:00",
            name: "logs",
            path: "/app/logs",
            permissions: "drwxr-xr-x",
            raw: "drwxr-xr-x logs",
            size: 4096,
          },
        ],
        hostId: "prod-api",
        parentPath: "/",
        path: "/app",
      };
    },
  );
  desktopRuntimeMocks.listenToDragDrop.mockResolvedValue(() => undefined);
  fileDialogMocks.selectLocalDirectory.mockResolvedValue(
    "/Users/me/Downloads",
  );
  fileDialogMocks.listLocalDirectory.mockImplementation(
    async (path?: string | null) => {
      const currentPath = path?.trim() || "/Users/me";
      if (currentPath === "/repo") {
        return {
          entries: [
            {
              hidden: false,
              kind: "file",
              modified: "1771351200",
              name: "package.json",
              path: "/repo/package.json",
              raw: "file /repo/package.json",
              size: 1024,
            },
          ],
          parentPath: "/",
          path: "/repo",
        };
      }
      return {
        entries: [
          {
            hidden: false,
            kind: "directory",
            modified: "1771351200",
            name: "repo",
            path: "/repo",
            raw: "directory /repo",
            size: null,
          },
          {
            hidden: false,
            kind: "file",
            modified: "1771351200",
            name: "notes.md",
            path: `${currentPath}/notes.md`,
            raw: `file ${currentPath}/notes.md`,
            size: 2048,
          },
        ],
        parentPath: "/",
        path: currentPath,
      };
    },
  );
  fileDialogMocks.selectLocalFile.mockResolvedValue("/Users/me/release.tgz");
  fileDialogMocks.selectSaveFile.mockResolvedValue(
    "/Users/me/Downloads/app.log",
  );
  sshCommandApiMocks.executeSshCommand.mockResolvedValue({
    durationMs: 18,
    exitCode: 0,
    host: "prod.internal",
    hostId: "prod-api",
    hostName: "prod api",
    maxOutputBytes: 4096,
    port: 22,
    stderr: "",
    stderrBytes: 0,
    stderrTruncated: false,
    stdout: "configured: /home/deploy/.bashrc",
    stdoutBytes: 32,
    stdoutTruncated: false,
    success: true,
    username: "deploy",
  });
  sftpApiMocks.previewSftpFile.mockResolvedValue({
    bytesRead: 112,
    content:
      "2026-06-17 18:00:00 INFO service started\n2026-06-17 18:01:12 WARN retrying remote task",
    encoding: "utf-8-lossy",
    hostId: "prod-api",
    maxBytes: 4096,
    path: "/var/log/app.log",
    truncated: false,
  });
  sftpApiMocks.listSftpDirectory.mockImplementation(
    async ({ path }: { path: string }) => {
      if (path === "/var") {
        return {
          entries: [
            {
              kind: "directory",
              modified: "Jun 18 15:00",
              name: "log",
              path: "/var/log",
              permissions: "drwxr-xr-x",
              raw: "drwxr-xr-x log",
              size: 4096,
            },
          ],
          hostId: "prod-api",
          parentPath: "/",
          path: "/var",
        };
      }

      if (path === "/var/log") {
        return {
          entries: [
            {
              kind: "file",
              modified: "Jun 18 16:00",
              name: "app.log",
              path: "/var/log/app.log",
              permissions: "-rw-r--r--",
              raw: "-rw-r--r-- app.log",
              size: 2048,
            },
            {
              kind: "symlink",
              modified: "Jun 18 16:00",
              name: "current",
              path: "/var/log/current",
              permissions: "lrwxrwxrwx",
              raw: "lrwxrwxrwx current",
              size: 7,
            },
          ],
          hostId: "prod-api",
          parentPath: "/var",
          path: "/var/log",
        };
      }

      if (path === "/srv/app") {
        return {
          entries: [
            {
              kind: "file",
              modified: "Jun 18 16:20",
              name: "release.sh",
              path: "/srv/app/release.sh",
              permissions: "-rwxr-xr-x",
              raw: "-rwxr-xr-x release.sh",
              size: 2048,
            },
          ],
          hostId: "prod-api",
          parentPath: "/srv",
          path: "/srv/app",
        };
      }

      return {
        entries: [
          {
            kind: "directory",
            modified: "Jun 18 15:00",
            name: "var",
            path: "/var",
            permissions: "drwxr-xr-x",
            raw: "drwxr-xr-x var",
            size: 4096,
          },
          {
            kind: "directory",
            modified: "Jun 18 15:00",
            name: "log",
            path: "/var/log",
            permissions: "drwxr-xr-x",
            raw: "drwxr-xr-x log",
            size: 4096,
          },
          {
            kind: "file",
            modified: "Jun 18 15:00",
            name: ".env",
            path: "/.env",
            permissions: "-rw-------",
            raw: "-rw------- .env",
            size: 96,
          },
        ],
        hostId: "prod-api",
        path: "/",
      };
    },
  );
});

export {
  containerFilesApiMocks,
  desktopRuntimeMocks,
  fileDialogMocks,
  sftpApiMocks,
  sshCommandApiMocks,
};
