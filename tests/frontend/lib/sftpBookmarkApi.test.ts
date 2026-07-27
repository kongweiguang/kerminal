/**
 * @author kongweiguang
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
const isTauriMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  isTauri: () => isTauriMock(),
}));

describe("sftpBookmarkApi", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    isTauriMock.mockReset();
    vi.resetModules();
  });

  it("maps list and set requests to the Tauri bookmark commands", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValue([
      { createdAtUnixMs: 42, path: "/srv/app" },
    ]);
    const { listSftpBookmarks, setSftpBookmark } = await import(
      "../../../src/lib/sftpBookmarkApi"
    );
    const target = { hostId: "host-a", kind: "ssh" } as const;

    await expect(listSftpBookmarks(target)).resolves.toEqual([
      { createdAtUnixMs: 42, path: "/srv/app" },
    ]);
    await expect(
      setSftpBookmark({ bookmarked: true, path: "/srv/app", target }),
    ).resolves.toEqual([{ createdAtUnixMs: 42, path: "/srv/app" }]);

    expect(invokeMock).toHaveBeenCalledWith("sftp_bookmark_list", {
      request: { target },
    });
    expect(invokeMock).toHaveBeenCalledWith("sftp_bookmark_set", {
      request: { bookmarked: true, path: "/srv/app", target },
    });
  });

  it("keeps browser-preview bookmarks isolated by target and normalized path", async () => {
    isTauriMock.mockReturnValue(false);
    const { listSftpBookmarks, setSftpBookmark } = await import(
      "../../../src/lib/sftpBookmarkApi"
    );
    const ssh = { hostId: "host-a", kind: "ssh" } as const;
    const container = {
      containerId: "container-a",
      hostId: "host-a",
      kind: "dockerContainer",
      runtime: "docker",
    } as const;

    await setSftpBookmark({ bookmarked: true, path: "srv//app/", target: ssh });
    await setSftpBookmark({ bookmarked: true, path: "/workspace", target: container });
    await setSftpBookmark({ bookmarked: true, path: "/srv/app", target: ssh });

    await expect(listSftpBookmarks(ssh)).resolves.toMatchObject([
      { path: "/srv/app" },
    ]);
    await expect(listSftpBookmarks(container)).resolves.toMatchObject([
      { path: "/workspace" },
    ]);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("removes browser-preview bookmarks without changing other paths", async () => {
    isTauriMock.mockReturnValue(false);
    const { listSftpBookmarks, setSftpBookmark } = await import(
      "../../../src/lib/sftpBookmarkApi"
    );
    const target = { hostId: "host-a", kind: "ssh" } as const;

    await setSftpBookmark({ bookmarked: true, path: "/srv/app", target });
    await setSftpBookmark({ bookmarked: true, path: "/srv/logs", target });
    await setSftpBookmark({ bookmarked: false, path: "/srv/app", target });

    await expect(listSftpBookmarks(target)).resolves.toMatchObject([
      { path: "/srv/logs" },
    ]);
  });

  it("rejects control characters before using the preview store", async () => {
    isTauriMock.mockReturnValue(false);
    const { normalizeSftpBookmarkPath } = await import(
      "../../../src/lib/sftpBookmarkApi"
    );

    expect(() => normalizeSftpBookmarkPath("/srv/\napp")).toThrow("控制字符");
  });
});
