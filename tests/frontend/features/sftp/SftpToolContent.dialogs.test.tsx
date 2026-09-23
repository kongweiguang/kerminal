// @author kongweiguang

import {
  fireEvent,
  render,
  screen,
  waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { act } from "react";
import { describe,
  expect,
  it } from "vitest";
import {  createSftpTransferSummary,
  desktopRuntimeMocks,
  openCurrentDirectoryContextMenu,
  sftpApiMocks,
  sshMachine,
} from "../../support/sftp/SftpToolContent.testSupport.tsx";
import { SftpToolContent } from "../../../../src/features/sftp/SftpToolContent";

const sidebarViewScope = "sftp-sidebar:prod-api";

describe("SftpToolContent events and dialogs", () => {
  it("updates transfer progress from Tauri events without waiting for polling", async () => {
    const user = userEvent.setup();
    (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ =
      {};
    sftpApiMocks.listSftpTransfers.mockResolvedValue([]);

    render(<SftpToolContent selectedMachine={sshMachine} />);

    await screen.findByText("var");
    await waitFor(() =>
      expect(desktopRuntimeMocks.listen).toHaveBeenCalledWith(
        "sftp-transfer-updated",
        expect.any(Function),
      ),
    );

    act(() => {
      desktopRuntimeMocks.transferHandler?.(
        createSftpTransferSummary({
          bytesTransferred: 512,
          cancelRequested: false,
          createdAt: 10,
          direction: "download",
          hostId: "prod-api",
          id: "event-transfer-1",
          kind: "file",
          localPath: "/Users/me/Downloads/app.log",
          remotePath: "/var/log/app.log",
          status: "running",
          totalBytes: 1024,
          updatedAt: 11,
          viewScope: sidebarViewScope,
        }),
      );
    });

    expect(await screen.findByText("SFTP 传输队列")).toBeInTheDocument();
    expect(screen.getByText("50%")).toBeInTheDocument();
    expect(
      screen.getByRole("progressbar", { name: "传输进度 app.log" }),
    ).toHaveAttribute("aria-valuenow", "50");

    act(() => {
      desktopRuntimeMocks.transferHandler?.(
        createSftpTransferSummary({
          bytesTransferred: 512,
          cancelRequested: false,
          createdAt: 10,
          direction: "download",
          error: "SSH 认证失败 password=transfer-event-secret",
          hostId: "prod-api",
          id: "event-transfer-1",
          kind: "file",
          localPath: "/Users/me/Downloads/app.log",
          remotePath: "/var/log/app.log",
          status: "failed",
          totalBytes: 1024,
          updatedAt: 12,
          viewScope: sidebarViewScope,
        }),
      );
    });

    expect(await screen.findByLabelText("失败")).toBeInTheDocument();
    expect(screen.queryByText("SSH 认证失败")).not.toBeInTheDocument();
    expect(
      screen.queryByText(/transfer-event-secret/),
    ).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "查看传输详情 app.log" }),
    );

    expect(await screen.findByText(/SSH 认证失败/)).toBeVisible();
    expect(screen.getByText(/password="\[已隐藏\]"/)).toBeVisible();
    expect(
      screen.queryByText(/transfer-event-secret/),
    ).not.toBeInTheDocument();
  });

  it("toggles hidden dot files from the context menu", async () => {
    const user = userEvent.setup();

    render(<SftpToolContent selectedMachine={sshMachine} />);

    expect(await screen.findByText(".env")).toBeInTheDocument();
    openCurrentDirectoryContextMenu();
    await user.click(screen.getByRole("menuitem", { name: "隐藏隐藏文件" }));

    expect(screen.queryByText(".env")).not.toBeInTheDocument();
    openCurrentDirectoryContextMenu();
    expect(
      screen.getByRole("menuitem", { name: "显示隐藏文件" }),
    ).toBeInTheDocument();
  });

  it("creates a remote directory from a modal", async () => {
    const user = userEvent.setup();

    render(<SftpToolContent selectedMachine={sshMachine} />);

    await screen.findByText("var");
    await user.click(screen.getByRole("button", { name: "新建目录" }));
    await user.clear(screen.getByLabelText("新目录路径"));
    await user.type(screen.getByLabelText("新目录路径"), "new-folder");
    await user.click(screen.getByRole("button", { name: "创建" }));

    expect(sftpApiMocks.createSftpDirectory).toHaveBeenCalledWith({
      hostId: "prod-api",
      path: "/new-folder",
    });
    expect(await screen.findByText(/目录已创建/)).toBeInTheDocument();
  });

  it("renames a remote file from the context menu", async () => {
    const user = userEvent.setup();

    render(<SftpToolContent selectedMachine={sshMachine} />);

    await screen.findByText("var");
    await user.dblClick(screen.getByRole("button", { name: "打开目录 log" }));
    expect(await screen.findByText("app.log")).toBeInTheDocument();
    fireEvent.contextMenu(
      screen.getByRole("button", { name: "文件 app.log" }),
      {
        clientX: 24,
        clientY: 24,
      },
    );
    await user.click(screen.getByRole("menuitem", { name: "重命名" }));

    expect(screen.getByText("所在目录")).toBeInTheDocument();
    expect(screen.getByText("/var/log")).toBeInTheDocument();
    expect(screen.getByText("原名称")).toBeInTheDocument();
    expect(screen.getAllByText("app.log").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByLabelText("新名称")).toHaveValue("app.log");
    await user.clear(screen.getByLabelText("新名称"));
    await user.type(screen.getByLabelText("新名称"), "app.old.log");
    await user.click(screen.getByRole("button", { name: "重命名" }));

    expect(sftpApiMocks.renameSftpPath).toHaveBeenCalledWith({
      fromPath: "/var/log/app.log",
      hostId: "prod-api",
      toPath: "/var/log/app.old.log",
    });
    expect(await screen.findByText(/已重命名/)).toBeInTheDocument();
  });

  it("opens the name-only rename dialog with F2 for a single selection", async () => {
    const { container } = render(<SftpToolContent selectedMachine={sshMachine} />);

    await screen.findByText("var");
    fireEvent.dblClick(screen.getByRole("button", { name: "打开目录 log" }));
    const fileButton = await screen.findByRole("button", { name: "文件 app.log" });

    fireEvent.click(fileButton);
    fireEvent.keyDown(container.querySelector("section") ?? fileButton, {
      key: "F2",
    });

    expect(screen.getByRole("dialog", { name: "重命名" })).toBeInTheDocument();
    expect(screen.getByLabelText("新名称")).toHaveValue("app.log");
  });

  it("opens a batch delete confirmation with Delete for multiple selections", async () => {
    const { container } = render(<SftpToolContent selectedMachine={sshMachine} />);

    await screen.findByText("var");
    fireEvent.dblClick(screen.getByRole("button", { name: "打开目录 log" }));
    const fileButton = await screen.findByRole("button", { name: "文件 app.log" });
    const symlinkButton = await screen.findByRole("button", {
      name: "链接 current",
    });

    fireEvent.click(fileButton);
    fireEvent.click(symlinkButton, { ctrlKey: true });
    fireEvent.keyDown(container.querySelector("section") ?? symlinkButton, {
      key: "Delete",
    });

    expect(screen.getByRole("dialog", { name: "删除 2 项" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "确认删除 2 项" }),
    ).toBeInTheDocument();
  });

  it("changes permissions from the context menu", async () => {
    const user = userEvent.setup();

    render(<SftpToolContent selectedMachine={sshMachine} />);

    await screen.findByText("var");
    await user.dblClick(screen.getByRole("button", { name: "打开目录 log" }));
    expect(await screen.findByText("app.log")).toBeInTheDocument();
    fireEvent.contextMenu(
      screen.getByRole("button", { name: "文件 app.log" }),
      {
        clientX: 24,
        clientY: 24,
      },
    );
    await user.click(screen.getByRole("menuitem", { name: "修改权限" }));

    expect(screen.getByLabelText("权限模式")).toHaveValue("644");
    await user.clear(screen.getByLabelText("权限模式"));
    await user.type(screen.getByLabelText("权限模式"), "600");
    await user.click(screen.getByRole("button", { name: "保存权限" }));

    expect(sftpApiMocks.chmodSftpPath).toHaveBeenCalledWith({
      hostId: "prod-api",
      mode: "600",
      path: "/var/log/app.log",
    });
    expect(await screen.findByText(/权限已修改/)).toBeInTheDocument();
  });

  it("requires confirmation before deleting a remote file", async () => {
    const user = userEvent.setup();

    render(<SftpToolContent selectedMachine={sshMachine} />);

    await screen.findByText("var");
    await user.dblClick(screen.getByRole("button", { name: "打开目录 log" }));
    expect(await screen.findByText("app.log")).toBeInTheDocument();
    fireEvent.contextMenu(
      screen.getByRole("button", { name: "文件 app.log" }),
      {
        clientX: 24,
        clientY: 24,
      },
    );
    await user.click(screen.getByRole("menuitem", { name: "删除" }));

    expect(screen.getByRole("dialog", { name: "删除" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "确认删除" }));

    expect(sftpApiMocks.deleteSftpPath).toHaveBeenCalledWith({
      directory: false,
      hostId: "prod-api",
      path: "/var/log/app.log",
    });
    expect(await screen.findByText(/已删除/)).toBeInTheDocument();
  });
});
