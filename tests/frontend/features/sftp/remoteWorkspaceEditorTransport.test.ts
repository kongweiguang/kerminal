import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MISSING_REMOTE_WORKSPACE_TARGET_MESSAGE,
  isRemoteWorkspaceBinaryFileReadError,
  listRemoteWorkspaceDirectory,
  readRemoteWorkspaceTextFile,
  writeRemoteWorkspaceTextFile,
} from "../../../../src/features/sftp/remoteWorkspaceEditorTransport";

const sftpApiMocks = vi.hoisted(() => ({
  listSftpDirectory: vi.fn(),
  readSftpTextFile: vi.fn(),
  writeSftpTextFile: vi.fn(),
}));

const containerFilesApiMocks = vi.hoisted(() => ({
  listDockerContainerDirectory: vi.fn(),
  readDockerContainerTextFile: vi.fn(),
  writeDockerContainerTextFile: vi.fn(),
}));

const localFilesApiMocks = vi.hoisted(() => ({
  readLocalTextFile: vi.fn(),
  writeLocalTextFile: vi.fn(),
}));

vi.mock("../../../../src/lib/sftpApi", () => ({
  listSftpDirectory: (...args: unknown[]) =>
    sftpApiMocks.listSftpDirectory(...args),
  readSftpTextFile: (...args: unknown[]) =>
    sftpApiMocks.readSftpTextFile(...args),
  writeSftpTextFile: (...args: unknown[]) =>
    sftpApiMocks.writeSftpTextFile(...args),
}));

vi.mock("../../../../src/lib/containerFilesApi", () => ({
  listDockerContainerDirectory: (...args: unknown[]) =>
    containerFilesApiMocks.listDockerContainerDirectory(...args),
  readDockerContainerTextFile: (...args: unknown[]) =>
    containerFilesApiMocks.readDockerContainerTextFile(...args),
  writeDockerContainerTextFile: (...args: unknown[]) =>
    containerFilesApiMocks.writeDockerContainerTextFile(...args),
}));

vi.mock("../../../../src/lib/localFilesApi", () => ({
  readLocalTextFile: (...args: unknown[]) =>
    localFilesApiMocks.readLocalTextFile(...args),
  writeLocalTextFile: (...args: unknown[]) =>
    localFilesApiMocks.writeLocalTextFile(...args),
}));

describe("remoteWorkspaceEditorTransport", () => {
  beforeEach(() => {
    sftpApiMocks.listSftpDirectory.mockReset();
    sftpApiMocks.readSftpTextFile.mockReset();
    sftpApiMocks.writeSftpTextFile.mockReset();
    containerFilesApiMocks.listDockerContainerDirectory.mockReset();
    containerFilesApiMocks.readDockerContainerTextFile.mockReset();
    containerFilesApiMocks.writeDockerContainerTextFile.mockReset();
    localFilesApiMocks.readLocalTextFile.mockReset();
    localFilesApiMocks.writeLocalTextFile.mockReset();
  });

  it("routes SSH workspace operations to SFTP APIs", async () => {
    sftpApiMocks.listSftpDirectory.mockResolvedValue({ entries: [] });
    sftpApiMocks.readSftpTextFile.mockResolvedValue({ content: "ssh" });
    sftpApiMocks.writeSftpTextFile.mockResolvedValue({ bytesWritten: 3 });

    const target = { hostId: "host-1", kind: "ssh" as const };
    const revision = { size: 3 };

    await listRemoteWorkspaceDirectory(target, "/etc");
    await readRemoteWorkspaceTextFile({
      maxBytes: 1024,
      path: "/etc/app.conf",
      target,
    });
    await writeRemoteWorkspaceTextFile({
      content: "abc",
      expectedRevision: revision,
      overwriteOnConflict: true,
      path: "/etc/app.conf",
      target,
    });

    expect(sftpApiMocks.listSftpDirectory).toHaveBeenCalledWith({
      hostId: "host-1",
      path: "/etc",
    });
    expect(sftpApiMocks.readSftpTextFile).toHaveBeenCalledWith({
      hostId: "host-1",
      maxBytes: 1024,
      path: "/etc/app.conf",
    });
    expect(sftpApiMocks.writeSftpTextFile).toHaveBeenCalledWith({
      content: "abc",
      create: false,
      encoding: "utf-8",
      expectedRevision: revision,
      hostId: "host-1",
      overwriteOnConflict: true,
      path: "/etc/app.conf",
    });
    expect(
      containerFilesApiMocks.listDockerContainerDirectory,
    ).not.toHaveBeenCalled();
  });

  it("routes Docker container workspace operations to container file APIs", async () => {
    containerFilesApiMocks.listDockerContainerDirectory.mockResolvedValue({
      entries: [],
    });
    containerFilesApiMocks.readDockerContainerTextFile.mockResolvedValue({
      content: "container",
    });
    containerFilesApiMocks.writeDockerContainerTextFile.mockResolvedValue({
      bytesWritten: 9,
    });

    const target = {
      containerId: "container-1",
      hostId: "host-1",
      kind: "dockerContainer" as const,
      runtime: "podman" as const,
    };
    const revision = { contentSha256: "sha-a", size: 9 };

    await listRemoteWorkspaceDirectory(target, "/app");
    await readRemoteWorkspaceTextFile({
      maxBytes: 2048,
      path: "/app/package.json",
      target,
    });
    await writeRemoteWorkspaceTextFile({
      content: "{}\n",
      expectedRevision: revision,
      overwriteOnConflict: false,
      path: "/app/package.json",
      target,
    });

    expect(
      containerFilesApiMocks.listDockerContainerDirectory,
    ).toHaveBeenCalledWith({
      containerId: "container-1",
      hostId: "host-1",
      path: "/app",
      runtime: "podman",
    });
    expect(
      containerFilesApiMocks.readDockerContainerTextFile,
    ).toHaveBeenCalledWith({
      containerId: "container-1",
      hostId: "host-1",
      maxBytes: 2048,
      path: "/app/package.json",
      runtime: "podman",
    });
    expect(
      containerFilesApiMocks.writeDockerContainerTextFile,
    ).toHaveBeenCalledWith({
      containerId: "container-1",
      content: "{}\n",
      create: false,
      encoding: "utf-8",
      expectedRevision: revision,
      hostId: "host-1",
      overwriteOnConflict: false,
      path: "/app/package.json",
      runtime: "podman",
    });
    expect(sftpApiMocks.listSftpDirectory).not.toHaveBeenCalled();
  });

  it("routes local workspace file read and write operations to local file APIs", async () => {
    localFilesApiMocks.readLocalTextFile.mockResolvedValue({
      content: "local",
    });
    localFilesApiMocks.writeLocalTextFile.mockResolvedValue({
      bytesWritten: 5,
    });
    const target = { kind: "local" as const };
    const revision = { contentSha256: "sha-a", size: 5 };

    await readRemoteWorkspaceTextFile({
      maxBytes: 4096,
      path: "C:/repo/notes.md",
      target,
    });
    await writeRemoteWorkspaceTextFile({
      content: "local",
      expectedRevision: revision,
      overwriteOnConflict: false,
      path: "C:/repo/notes.md",
      target,
    });

    expect(localFilesApiMocks.readLocalTextFile).toHaveBeenCalledWith({
      maxBytes: 4096,
      path: "C:/repo/notes.md",
    });
    expect(localFilesApiMocks.writeLocalTextFile).toHaveBeenCalledWith({
      content: "local",
      create: false,
      encoding: "utf-8",
      expectedRevision: revision,
      overwriteOnConflict: false,
      path: "C:/repo/notes.md",
    });
  });

  it("rejects unsupported workspace targets with the editor message", async () => {
    await expect(
      listRemoteWorkspaceDirectory({ kind: "local" }, "/"),
    ).rejects.toThrow(MISSING_REMOTE_WORKSPACE_TARGET_MESSAGE);
    await expect(
      readRemoteWorkspaceTextFile({
        maxBytes: 100,
        path: "/README.md",
        target: undefined,
      }),
    ).rejects.toThrow(MISSING_REMOTE_WORKSPACE_TARGET_MESSAGE);
  });

  it("only classifies the stable binary marker as an unsupported preview", () => {
    expect(
      isRemoteWorkspaceBinaryFileReadError(
        new Error("远程文件包含二进制内容，暂不支持作为文本编辑"),
      ),
    ).toBe(true);
    expect(
      isRemoteWorkspaceBinaryFileReadError(
        "容器文件包含二进制内容，暂不支持作为文本编辑",
      ),
    ).toBe(true);
    expect(
      isRemoteWorkspaceBinaryFileReadError(
        new Error("permission denied while reading remote file"),
      ),
    ).toBe(false);
    expect(
      isRemoteWorkspaceBinaryFileReadError({ message: "文件包含二进制内容" }),
    ).toBe(false);
  });
});
