/**
 * @author kongweiguang
 */

import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SftpBookmark, SftpBookmarkTarget } from "../../../../../src/lib/sftpBookmarkApi";
import { SftpBookmarkControl } from "../../../../../src/features/sftp/sftp-bookmark/SftpBookmarkControl";
import type { SftpFileTarget } from "../../../../../src/features/sftp/sftp-tool-content/types";

const listSftpBookmarksMock = vi.fn();
const setSftpBookmarkMock = vi.fn();

vi.mock("../../../../../src/lib/sftpBookmarkApi", () => ({
  listSftpBookmarks: (target: SftpBookmarkTarget) =>
    listSftpBookmarksMock(target),
  normalizeSftpBookmarkPath: (path: string) => {
    const normalized = path.trim().replace(/\\/g, "/").replace(/\/{2,}/g, "/");
    const rooted = normalized.startsWith("/") ? normalized : `/${normalized}`;
    return rooted.length > 1 ? rooted.replace(/\/+$/g, "") : rooted;
  },
  setSftpBookmark: (request: unknown) => setSftpBookmarkMock(request),
}));

describe("SftpBookmarkControl", () => {
  beforeEach(() => {
    listSftpBookmarksMock.mockReset().mockResolvedValue([]);
    setSftpBookmarkMock.mockReset().mockResolvedValue([]);
  });

  it("收藏当前路径并以实心书签反映最新状态", async () => {
    const user = userEvent.setup();
    const loadDirectory = vi.fn().mockResolvedValue(undefined);
    setSftpBookmarkMock.mockResolvedValue([bookmark("/srv/app")]);

    render(
      <SftpBookmarkControl
        currentPath="/srv/app"
        fileTarget={sshFileTarget("host-a")}
        loadDirectory={loadDirectory}
      />,
    );

    await waitFor(() => expect(listSftpBookmarksMock).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: "收藏当前远程路径" }));

    await waitFor(() =>
      expect(setSftpBookmarkMock).toHaveBeenCalledWith({
        bookmarked: true,
        path: "/srv/app",
        target: { hostId: "host-a", kind: "ssh" },
      }),
    );
    expect(
      screen.getByRole("button", { name: "取消收藏当前远程路径" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(loadDirectory).not.toHaveBeenCalled();
  });

  it("从下拉菜单跳转路径，并允许删除而不触发跳转", async () => {
    const user = userEvent.setup();
    const loadDirectory = vi.fn().mockResolvedValue(undefined);
    listSftpBookmarksMock.mockResolvedValue([
      bookmark("/srv/app"),
      bookmark("/var/log"),
    ]);
    setSftpBookmarkMock.mockResolvedValue([bookmark("/var/log")]);

    render(
      <SftpBookmarkControl
        currentPath="/"
        fileTarget={sshFileTarget("host-a")}
        loadDirectory={loadDirectory}
      />,
    );

    await user.click(
      await screen.findByRole("button", { name: "打开 SFTP 路径书签" }),
    );
    const menu = await screen.findByRole("menu", { name: "SFTP 路径书签" });
    expect(menu).toHaveClass("kerminal-floating-surface");
    await user.click(screen.getByRole("menuitem", { name: "/srv/app" }));
    expect(loadDirectory).toHaveBeenCalledWith("/srv/app");

    await user.click(screen.getByRole("button", { name: "打开 SFTP 路径书签" }));
    await user.click(screen.getByRole("menuitem", { name: "删除书签 /srv/app" }));
    await waitFor(() =>
      expect(setSftpBookmarkMock).toHaveBeenCalledWith({
        bookmarked: false,
        path: "/srv/app",
        target: { hostId: "host-a", kind: "ssh" },
      }),
    );
    expect(loadDirectory).toHaveBeenCalledTimes(1);
  });

  it("在目标切换后忽略旧目标迟到的加载结果", async () => {
    const user = userEvent.setup();
    const first = deferred<SftpBookmark[]>();
    const second = deferred<SftpBookmark[]>();
    listSftpBookmarksMock.mockImplementation((target: SftpBookmarkTarget) =>
      target.kind === "ssh" && target.hostId === "host-a"
        ? first.promise
        : second.promise,
    );
    const loadDirectory = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(
      <SftpBookmarkControl
        currentPath="/"
        fileTarget={sshFileTarget("host-a")}
        loadDirectory={loadDirectory}
      />,
    );

    await waitFor(() => expect(listSftpBookmarksMock).toHaveBeenCalledTimes(1));
    rerender(
      <SftpBookmarkControl
        currentPath="/"
        fileTarget={sshFileTarget("host-b")}
        loadDirectory={loadDirectory}
      />,
    );
    second.resolve([bookmark("/new-target")]);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "打开 SFTP 路径书签" })).toBeEnabled(),
    );
    await user.click(screen.getByRole("button", { name: "打开 SFTP 路径书签" }));
    expect(screen.getByRole("menuitem", { name: "/new-target" })).toBeInTheDocument();

    first.resolve([bookmark("/stale-target")]);
    await waitFor(() =>
      expect(screen.queryByRole("menuitem", { name: "/stale-target" })).not.toBeInTheDocument(),
    );
  });

  it("支持 Escape 和外部点击关闭菜单", async () => {
    const user = userEvent.setup();
    render(
      <SftpBookmarkControl
        currentPath="/"
        fileTarget={sshFileTarget("host-a")}
        loadDirectory={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    await user.click(
      await screen.findByRole("button", { name: "打开 SFTP 路径书签" }),
    );
    expect(screen.getByRole("menu", { name: "SFTP 路径书签" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("menu", { name: "SFTP 路径书签" })).not.toBeInTheDocument(),
    );

    await user.click(screen.getByRole("button", { name: "打开 SFTP 路径书签" }));
    fireEvent.pointerDown(document.body);
    await waitFor(() =>
      expect(screen.queryByRole("menu", { name: "SFTP 路径书签" })).not.toBeInTheDocument(),
    );
  });

  it("打开菜单后把焦点移入并支持方向键导航", async () => {
    const user = userEvent.setup();
    listSftpBookmarksMock.mockResolvedValue([
      bookmark("/srv"),
      bookmark("/var"),
    ]);
    render(
      <SftpBookmarkControl
        currentPath="/"
        fileTarget={sshFileTarget("host-a")}
        loadDirectory={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    const trigger = await screen.findByRole("button", {
      name: "打开 SFTP 路径书签",
    });
    await user.click(trigger);
    const firstItem = await screen.findByRole("menuitem", { name: "/srv" });
    expect(document.activeElement).toBe(firstItem);

    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toHaveAttribute("aria-label", "删除书签 /srv");
    await user.keyboard("{ArrowUp}");
    expect(document.activeElement).toBe(firstItem);
    await user.keyboard("{Escape}");
    expect(document.activeElement).toBe(trigger);
  });
});

function bookmark(path: string): SftpBookmark {
  return { createdAtUnixMs: 1, path };
}

function sshFileTarget(hostId: string): SftpFileTarget {
  return {
    hostId,
    initialPath: "/",
    kind: "ssh",
    protocol: "sftp://",
    summary: hostId,
  };
}

function deferred<T>() {
  let reject: (reason?: unknown) => void = () => undefined;
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, reject, resolve };
}
