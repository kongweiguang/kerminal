/** @author kongweiguang */

import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
const isTauriMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  isTauri: () => isTauriMock(),
}));

describe("sftpApi", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    isTauriMock.mockReset();
  });

  it("lists a remote directory through the Tauri SFTP command", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValue({
      entries: [],
      hostId: "host-lab",
      path: "/var/log",
    });
    const { listSftpDirectory } = await import("../../../src/lib/sftpApi");

    const listing = await listSftpDirectory({
      hostId: "host-lab",
      path: "/var/log",
    });

    expect(listing.path).toBe("/var/log");
    expect(invokeMock).toHaveBeenCalledWith("sftp_list_directory", {
      request: { hostId: "host-lab", path: "/var/log" },
    });
  });

  it("provides a Chinese browser preview directory tree outside Tauri", async () => {
    isTauriMock.mockReturnValue(false);
    const { listSftpDirectory } = await import("../../../src/lib/sftpApi");

    const root = await listSftpDirectory({ hostId: "host-lab", path: "/" });
    const varLog = await listSftpDirectory({
      hostId: "host-lab",
      path: "/var/log",
    });

    expect(invokeMock).not.toHaveBeenCalled();
    expect(root.entries.map((entry) => entry.name)).toContain("var");
    expect(varLog.parentPath).toBe("/var");
    expect(varLog.entries.map((entry) => entry.name)).toContain("app.log");
  });

  it("selects the SFTP transport at call time", async () => {
    isTauriMock.mockReturnValue(false);
    const { listSftpDirectory } = await import("../../../src/lib/sftpApi");

    const preview = await listSftpDirectory({ hostId: "host-lab", path: "/" });
    expect(preview.entries.map((entry) => entry.name)).toContain("var");
    expect(invokeMock).not.toHaveBeenCalled();

    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValue({
      entries: [],
      hostId: "host-lab",
      path: "/srv",
    });

    const native = await listSftpDirectory({
      hostId: "host-lab",
      path: "/srv",
    });

    expect(native.path).toBe("/srv");
    expect(invokeMock).toHaveBeenCalledWith("sftp_list_directory", {
      request: { hostId: "host-lab", path: "/srv" },
    });
  });

  it("maps file operations to separate SFTP commands", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValue(true);
    const {
      chmodSftpPath,
      createSftpDirectory,
      deleteSftpPath,
      downloadSftpDirectory,
      downloadSftpFile,
      renameSftpPath,
      uploadSftpDirectory,
      uploadSftpFile,
    } = await import("../../../src/lib/sftpApi");

    await createSftpDirectory({ hostId: "host-lab", path: "/tmp/new" });
    await deleteSftpPath({
      directory: false,
      hostId: "host-lab",
      path: "/tmp/old.log",
    });
    await renameSftpPath({
      fromPath: "/tmp/a",
      hostId: "host-lab",
      toPath: "/tmp/b",
    });
    await chmodSftpPath({
      hostId: "host-lab",
      mode: "644",
      path: "/tmp/a",
    });
    await uploadSftpFile({
      conflictPolicy: "overwrite",
      hostId: "host-lab",
      localPath: "C:\\tmp\\a.log",
      remotePath: "/tmp/a.log",
    });
    await uploadSftpDirectory({
      conflictPolicy: "overwrite",
      hostId: "host-lab",
      localPath: "C:\\tmp\\dist",
      remotePath: "/tmp/dist",
    });
    await downloadSftpFile({
      conflictPolicy: "overwrite",
      hostId: "host-lab",
      localPath: "C:\\tmp\\a.log",
      remotePath: "/tmp/a.log",
    });
    await downloadSftpDirectory({
      conflictPolicy: "overwrite",
      hostId: "host-lab",
      localPath: "C:\\tmp\\dist",
      remotePath: "/tmp/dist",
    });

    expect(invokeMock).toHaveBeenCalledWith("sftp_create_directory", {
      request: { hostId: "host-lab", path: "/tmp/new" },
    });
    expect(invokeMock).toHaveBeenCalledWith("sftp_delete", {
      request: {
        directory: false,
        hostId: "host-lab",
        path: "/tmp/old.log",
      },
    });
    expect(invokeMock).toHaveBeenCalledWith("sftp_rename", {
      request: {
        fromPath: "/tmp/a",
        hostId: "host-lab",
        toPath: "/tmp/b",
      },
    });
    expect(invokeMock).toHaveBeenCalledWith("sftp_chmod", {
      request: {
        hostId: "host-lab",
        mode: "644",
        path: "/tmp/a",
      },
    });
    expect(invokeMock).toHaveBeenCalledWith("sftp_upload", {
      request: {
        conflictPolicy: "overwrite",
        hostId: "host-lab",
        localPath: "C:\\tmp\\a.log",
        remotePath: "/tmp/a.log",
      },
    });
    expect(invokeMock).toHaveBeenCalledWith("sftp_upload_directory", {
      request: {
        conflictPolicy: "overwrite",
        hostId: "host-lab",
        localPath: "C:\\tmp\\dist",
        remotePath: "/tmp/dist",
      },
    });
    expect(invokeMock).toHaveBeenCalledWith("sftp_download", {
      request: {
        conflictPolicy: "overwrite",
        hostId: "host-lab",
        localPath: "C:\\tmp\\a.log",
        remotePath: "/tmp/a.log",
      },
    });
    expect(invokeMock).toHaveBeenCalledWith("sftp_download_directory", {
      request: {
        conflictPolicy: "overwrite",
        hostId: "host-lab",
        localPath: "C:\\tmp\\dist",
        remotePath: "/tmp/dist",
      },
    });
  });

  it("uses simple browser fallbacks for file operations outside Tauri", async () => {
    isTauriMock.mockReturnValue(false);
    const {
      chmodSftpPath,
      createSftpDirectory,
      deleteSftpPath,
      downloadSftpDirectory,
      downloadSftpFile,
      readSftpLocalFileClipboard,
      renameSftpPath,
      uploadSftpDirectory,
      uploadSftpFile,
    } = await import("../../../src/lib/sftpApi");

    await expect(
      createSftpDirectory({ hostId: "host-lab", path: "/tmp/new" }),
    ).resolves.toBe(true);
    await expect(
      deleteSftpPath({
        directory: false,
        hostId: "host-lab",
        path: "/tmp/old.log",
      }),
    ).resolves.toBe(true);
    await expect(
      renameSftpPath({
        fromPath: "/tmp/a",
        hostId: "host-lab",
        toPath: "/tmp/b",
      }),
    ).resolves.toBe(true);
    await expect(
      chmodSftpPath({ hostId: "host-lab", mode: "644", path: "/tmp/a" }),
    ).resolves.toBe(true);
    await expect(
      uploadSftpFile({
        conflictPolicy: "overwrite",
        hostId: "host-lab",
        localPath: "C:\\tmp\\a.log",
        remotePath: "/tmp/a.log",
      }),
    ).resolves.toBe(true);
    await expect(
      uploadSftpDirectory({
        conflictPolicy: "overwrite",
        hostId: "host-lab",
        localPath: "C:\\tmp\\dist",
        remotePath: "/tmp/dist",
      }),
    ).resolves.toBe(true);
    await expect(
      downloadSftpFile({
        conflictPolicy: "overwrite",
        hostId: "host-lab",
        localPath: "C:\\tmp\\a.log",
        remotePath: "/tmp/a.log",
      }),
    ).resolves.toBe(true);
    await expect(
      downloadSftpDirectory({
        conflictPolicy: "overwrite",
        hostId: "host-lab",
        localPath: "C:\\tmp\\dist",
        remotePath: "/tmp/dist",
      }),
    ).resolves.toBe(true);
    await expect(readSftpLocalFileClipboard()).resolves.toEqual([]);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("maps managed transfer operations to SFTP queue commands", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValue({
      bytesTransferred: 0,
      cancelRequested: false,
      createdAt: 1,
      direction: "upload",
      hostId: "host-lab",
      id: "transfer-1",
      kind: "file",
      localPath: "C:\\tmp\\a.log",
      remotePath: "/tmp/a.log",
      status: "queued",
      totalBytes: 128,
      updatedAt: 1,
    });
    const {
      cancelSftpTransfer,
      classifySftpLocalPaths,
      clearCompletedSftpTransfers,
      enqueueSftpArchiveDownload,
      enqueueSftpArchiveUpload,
      enqueueSftpClipboardDownload,
      enqueueSftpRemoteCopy,
      enqueueSftpTransfer,
      listSftpTransfers,
      readSftpLocalFileClipboard,
      retrySftpTransfer,
      trustSftpHostKey,
    } = await import("../../../src/lib/sftpApi");

    await enqueueSftpTransfer({
      conflictPolicy: "rename",
      direction: "upload",
      hostId: "host-lab",
      kind: "file",
      localPath: "C:\\tmp\\a.log",
      remotePath: "/tmp/a.log",
    });
    await enqueueSftpRemoteCopy({
      conflictPolicy: "overwrite",
      kind: "file",
      sourceHostId: "host-a",
      sourceRemotePath: "/var/log/app.log",
      targetHostId: "host-b",
      targetRemotePath: "/srv/app/app.log",
    });
    await enqueueSftpArchiveDownload({
      conflictPolicy: "overwrite",
      hostId: "host-lab",
      kind: "directory",
      sourceRemotePath: "/var/log",
      targetLocalPath: "C:\\tmp\\var-log.zip",
    });
    await enqueueSftpArchiveUpload({
      conflictPolicy: "overwrite",
      hostId: "host-lab",
      kind: "directory",
      sourceLocalPath: "C:\\tmp\\dist",
      targetRemotePath: "/srv/app/dist.zip",
    });
    await enqueueSftpClipboardDownload({
      hostId: "host-lab",
      kind: "file",
      sourceRemotePath: "/var/log/app.log",
    });
    await listSftpTransfers();
    await listSftpTransfers({ viewScope: "sftp-workbench:tab-a" });
    await cancelSftpTransfer({ transferId: "transfer-1" });
    await cancelSftpTransfer({
      transferId: "transfer-1",
      viewScope: "sftp-workbench:tab-a",
    });
    await retrySftpTransfer({ transferId: "transfer-1" });
    await clearCompletedSftpTransfers();
    await clearCompletedSftpTransfers({ viewScope: "sftp-workbench:tab-a" });
    await classifySftpLocalPaths({ paths: ["C:\\\\tmp\\\\a.log"] });
    await readSftpLocalFileClipboard();
    await trustSftpHostKey({ hostId: "host-lab" });

    expect(invokeMock).toHaveBeenCalledWith("sftp_enqueue_transfer", {
      request: {
        conflictPolicy: "rename",
        direction: "upload",
        hostId: "host-lab",
        kind: "file",
        localPath: "C:\\tmp\\a.log",
        remotePath: "/tmp/a.log",
      },
    });
    expect(invokeMock).toHaveBeenCalledWith("sftp_retry_transfer", {
      transferId: "transfer-1",
    });
    expect(invokeMock).toHaveBeenCalledWith("sftp_enqueue_remote_copy", {
      request: {
        conflictPolicy: "overwrite",
        kind: "file",
        sourceHostId: "host-a",
        sourceRemotePath: "/var/log/app.log",
        targetHostId: "host-b",
        targetRemotePath: "/srv/app/app.log",
      },
    });
    expect(invokeMock).toHaveBeenCalledWith("sftp_enqueue_archive_download", {
      request: {
        conflictPolicy: "overwrite",
        hostId: "host-lab",
        kind: "directory",
        sourceRemotePath: "/var/log",
        targetLocalPath: "C:\\tmp\\var-log.zip",
      },
    });
    expect(invokeMock).toHaveBeenCalledWith("sftp_enqueue_archive_upload", {
      request: {
        conflictPolicy: "overwrite",
        hostId: "host-lab",
        kind: "directory",
        sourceLocalPath: "C:\\tmp\\dist",
        targetRemotePath: "/srv/app/dist.zip",
      },
    });
    expect(invokeMock).toHaveBeenCalledWith("sftp_enqueue_clipboard_download", {
      request: {
        hostId: "host-lab",
        kind: "file",
        sourceRemotePath: "/var/log/app.log",
      },
    });
    expect(invokeMock).toHaveBeenCalledWith("sftp_list_transfers");
    expect(invokeMock).toHaveBeenCalledWith("sftp_list_transfers", {
      request: { viewScope: "sftp-workbench:tab-a" },
    });
    expect(invokeMock).toHaveBeenCalledWith("sftp_cancel_transfer", {
      request: { transferId: "transfer-1" },
    });
    expect(invokeMock).toHaveBeenCalledWith("sftp_cancel_transfer", {
      request: {
        transferId: "transfer-1",
        viewScope: "sftp-workbench:tab-a",
      },
    });
    expect(invokeMock).toHaveBeenCalledWith("sftp_clear_completed_transfers");
    expect(invokeMock).toHaveBeenCalledWith("sftp_clear_completed_transfers", {
      request: { viewScope: "sftp-workbench:tab-a" },
    });
    expect(invokeMock).toHaveBeenCalledWith("sftp_classify_local_paths", {
      request: { paths: ["C:\\\\tmp\\\\a.log"] },
    });
    expect(invokeMock).toHaveBeenCalledWith("sftp_read_local_file_clipboard");
    expect(invokeMock).toHaveBeenCalledWith("sftp_trust_host_key", {
      request: { hostId: "host-lab" },
    });
    expect(
      invokeMock.mock.calls.find(([command]) => command === "sftp_list_transfers"),
    ).toEqual(["sftp_list_transfers"]);
    expect(
      invokeMock.mock.calls.find(
        ([command]) => command === "sftp_clear_completed_transfers",
      ),
    ).toEqual(["sftp_clear_completed_transfers"]);
    expect(
      invokeMock.mock.calls.find(
        ([command]) => command === "sftp_read_local_file_clipboard",
      ),
    ).toEqual(["sftp_read_local_file_clipboard"]);
  });

  it("simulates managed transfer progress outside Tauri", async () => {
    isTauriMock.mockReturnValue(false);
    const {
      cancelSftpTransfer,
      clearCompletedSftpTransfers,
      enqueueSftpTransfer,
      listSftpTransfers,
    } = await import("../../../src/lib/sftpApi");

    const transfer = await enqueueSftpTransfer({
      conflictPolicy: "overwrite",
      direction: "download",
      hostId: "host-lab",
      kind: "file",
      localPath: "/Users/me/app.log",
      remotePath: "/var/log/app.log",
    });
    const running = await listSftpTransfers();
    const canceled = await cancelSftpTransfer({ transferId: transfer.id });
    const remaining = await clearCompletedSftpTransfers();

    expect(invokeMock).not.toHaveBeenCalled();
    expect(running.some((item) => item.id === transfer.id)).toBe(true);
    expect(canceled.status).toBe("canceled");
    expect(remaining.some((item) => item.id === transfer.id)).toBe(false);
  });

  it("simulates remote copy transfer progress outside Tauri", async () => {
    isTauriMock.mockReturnValue(false);
    const { enqueueSftpRemoteCopy, listSftpTransfers } =
      await import("../../../src/lib/sftpApi");

    const transfer = await enqueueSftpRemoteCopy({
      conflictPolicy: "overwrite",
      kind: "file",
      sourceHostId: "host-a",
      sourceRemotePath: "/var/log/app.log",
      targetHostId: "host-b",
      targetRemotePath: "/srv/app/app.log",
    });
    const running = await listSftpTransfers();

    expect(invokeMock).not.toHaveBeenCalled();
    expect(transfer.hostId).toBe("host-b");
    expect(transfer.localPath).toBe("sftp://host-a/var/log/app.log");
    expect(running.some((item) => item.id === transfer.id)).toBe(true);
  });

  it("simulates archive download transfer progress outside Tauri", async () => {
    isTauriMock.mockReturnValue(false);
    const { enqueueSftpArchiveDownload, listSftpTransfers } =
      await import("../../../src/lib/sftpApi");

    const transfer = await enqueueSftpArchiveDownload({
      conflictPolicy: "overwrite",
      hostId: "host-lab",
      kind: "directory",
      sourceRemotePath: "/var/log",
      targetLocalPath: "/Users/me/Downloads/var-log.zip",
    });
    const running = await listSftpTransfers();

    expect(invokeMock).not.toHaveBeenCalled();
    expect(transfer.direction).toBe("download");
    expect(transfer.remotePath).toBe("/var/log");
    expect(transfer.localPath).toBe("/Users/me/Downloads/var-log.zip");
    expect(running.some((item) => item.id === transfer.id)).toBe(true);
  });

  it("simulates archive upload transfer progress outside Tauri", async () => {
    isTauriMock.mockReturnValue(false);
    const { enqueueSftpArchiveUpload, listSftpTransfers } =
      await import("../../../src/lib/sftpApi");

    const transfer = await enqueueSftpArchiveUpload({
      conflictPolicy: "overwrite",
      hostId: "host-lab",
      kind: "directory",
      sourceLocalPath: "/Users/me/dist",
      targetRemotePath: "/srv/app/dist.zip",
    });
    const running = await listSftpTransfers();

    expect(invokeMock).not.toHaveBeenCalled();
    expect(transfer.direction).toBe("upload");
    expect(transfer.kind).toBe("file");
    expect(transfer.remotePath).toBe("/srv/app/dist.zip");
    expect(transfer.localPath).toBe("/Users/me/dist");
    expect(running.some((item) => item.id === transfer.id)).toBe(true);
  });

  it("simulates clipboard download transfer progress outside Tauri", async () => {
    isTauriMock.mockReturnValue(false);
    const { enqueueSftpClipboardDownload, listSftpTransfers } =
      await import("../../../src/lib/sftpApi");

    const transfer = await enqueueSftpClipboardDownload({
      hostId: "host-lab",
      kind: "file",
      sourceRemotePath: "/var/log/app.log",
    });
    const running = await listSftpTransfers();

    expect(invokeMock).not.toHaveBeenCalled();
    expect(transfer.direction).toBe("download");
    expect(transfer.remotePath).toBe("/var/log/app.log");
    expect(transfer.localPath).toBe("~/Downloads/app.log");
    expect(running.some((item) => item.id === transfer.id)).toBe(true);
  });

  it("classifies preview local paths outside Tauri", async () => {
    isTauriMock.mockReturnValue(false);
    const { classifySftpLocalPaths } = await import("../../../src/lib/sftpApi");

    const paths = await classifySftpLocalPaths({
      paths: ["/Users/me/release.tgz", "/Users/me/dist/"],
    });

    expect(invokeMock).not.toHaveBeenCalled();
    expect(paths).toEqual([
      { kind: "file", path: "/Users/me/release.tgz" },
      { kind: "directory", path: "/Users/me/dist/" },
    ]);
  });

  it("returns an empty local file clipboard outside Tauri", async () => {
    isTauriMock.mockReturnValue(false);
    const { readSftpLocalFileClipboard } = await import("../../../src/lib/sftpApi");

    const paths = await readSftpLocalFileClipboard();

    expect(invokeMock).not.toHaveBeenCalled();
    expect(paths).toEqual([]);
  });

  it("previews a remote file through the Tauri SFTP command", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValue({
      bytesRead: 64,
      content: "hello",
      encoding: "utf-8-lossy",
      hostId: "host-lab",
      maxBytes: 4096,
      path: "/var/log/app.log",
      truncated: false,
    });
    const { previewSftpFile } = await import("../../../src/lib/sftpApi");

    const preview = await previewSftpFile({
      hostId: "host-lab",
      maxBytes: 4096,
      path: "/var/log/app.log",
    });

    expect(preview.content).toBe("hello");
    expect(invokeMock).toHaveBeenCalledWith("sftp_preview_file", {
      request: {
        hostId: "host-lab",
        maxBytes: 4096,
        path: "/var/log/app.log",
      },
    });
  });

  it("maps editor text operations to dedicated SFTP commands", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockImplementation((command: string) => {
      if (command === "sftp_read_text_file") {
        return Promise.resolve({
          binary: false,
          bytesRead: 12,
          content: "hello world\n",
          encoding: "utf-8",
          hostId: "host-lab",
          lineEnding: "lf",
          maxBytes: 4096,
          path: "/srv/app/config/app.toml",
          readonly: false,
          revision: {
            contentSha256: "sha-a",
            modified: "Jun 17 18:00",
            permissions: "-rw-r--r--",
            permissionsMode: 420,
            size: 12,
          },
          truncated: false,
        });
      }
      if (command === "sftp_write_text_file") {
        return Promise.resolve({
          bytesWritten: 13,
          encoding: "utf-8",
          hostId: "host-lab",
          lineEnding: "lf",
          path: "/srv/app/config/app.toml",
          revision: {
            contentSha256: "sha-b",
            modified: "Jun 17 18:01",
            permissions: "-rw-r--r--",
            permissionsMode: 420,
            size: 13,
          },
        });
      }
      if (command === "sftp_stat_path") {
        return Promise.resolve({
          hostId: "host-lab",
          kind: "file",
          modified: "Jun 17 18:01",
          path: "/srv/app/config/app.toml",
          permissions: "-rw-r--r--",
          readonly: false,
          revision: {
            contentSha256: "sha-b",
            modified: "Jun 17 18:01",
            permissions: "-rw-r--r--",
            permissionsMode: 420,
            size: 13,
          },
          size: 13,
        });
      }
      return Promise.reject(new Error(`Unexpected command: ${command}`));
    });
    const { readSftpTextFile, statSftpPath, writeSftpTextFile } = await import(
      "../../../src/lib/sftpApi"
    );

    const opened = await readSftpTextFile({
      hostId: "host-lab",
      maxBytes: 4096,
      path: "/srv/app/config/app.toml",
    });
    const saved = await writeSftpTextFile({
      content: "hello world!\n",
      create: false,
      encoding: "utf-8",
      expectedRevision: opened.revision,
      hostId: "host-lab",
      overwriteOnConflict: false,
      path: "/srv/app/config/app.toml",
    });
    const stat = await statSftpPath({
      hostId: "host-lab",
      path: "/srv/app/config/app.toml",
    });

    expect(saved.revision.contentSha256).toBe("sha-b");
    expect(stat.kind).toBe("file");
    expect(invokeMock).toHaveBeenCalledWith("sftp_read_text_file", {
      request: {
        hostId: "host-lab",
        maxBytes: 4096,
        path: "/srv/app/config/app.toml",
      },
    });
    expect(invokeMock).toHaveBeenCalledWith("sftp_write_text_file", {
      request: {
        content: "hello world!\n",
        create: false,
        encoding: "utf-8",
        expectedRevision: opened.revision,
        hostId: "host-lab",
        overwriteOnConflict: false,
        path: "/srv/app/config/app.toml",
      },
    });
    expect(invokeMock).toHaveBeenCalledWith("sftp_stat_path", {
      request: {
        hostId: "host-lab",
        path: "/srv/app/config/app.toml",
      },
    });
  });

  it("provides browser preview file content with bounded truncation outside Tauri", async () => {
    isTauriMock.mockReturnValue(false);
    const { previewSftpFile } = await import("../../../src/lib/sftpApi");

    const readme = await previewSftpFile({
      hostId: "host-lab",
      path: "/home/deploy/README.md",
    });
    const log = await previewSftpFile({
      hostId: "host-lab",
      maxBytes: 16,
      path: "/var/log/app.log",
    });

    expect(invokeMock).not.toHaveBeenCalled();
    expect(readme.content).toContain("浏览器预览内容；桌面应用会读取真实远程文件。");
    expect(log.maxBytes).toBe(256);
    expect(log.truncated).toBe(true);
    expect(log.content.length).toBe(256);
  });

  it("simulates editor read, save, and conflict detection outside Tauri", async () => {
    isTauriMock.mockReturnValue(false);
    const { readSftpTextFile, statSftpPath, writeSftpTextFile } = await import(
      "../../../src/lib/sftpApi"
    );

    const opened = await readSftpTextFile({
      hostId: "host-lab",
      path: "/tmp/browser-editor.txt",
    });
    const saved = await writeSftpTextFile({
      content: "first save\n",
      create: false,
      encoding: "utf-8",
      expectedRevision: opened.revision,
      hostId: "host-lab",
      overwriteOnConflict: false,
      path: "/tmp/browser-editor.txt",
    });
    const reopened = await readSftpTextFile({
      hostId: "host-lab",
      path: "/tmp/browser-editor.txt",
    });
    const stat = await statSftpPath({
      hostId: "host-lab",
      path: "/tmp/browser-editor.txt",
    });

    expect(invokeMock).not.toHaveBeenCalled();
    expect(saved.bytesWritten).toBe(11);
    expect(reopened.content).toBe("first save\n");
    expect(stat.revision?.contentSha256).toBe(saved.revision.contentSha256);
    await expect(
      writeSftpTextFile({
        content: "stale save\n",
        create: false,
        encoding: "utf-8",
        expectedRevision: opened.revision,
        hostId: "host-lab",
        overwriteOnConflict: false,
        path: "/tmp/browser-editor.txt",
      }),
    ).rejects.toThrow("远端已变更，请重载或覆盖。");
  });
});
