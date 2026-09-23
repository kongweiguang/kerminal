// @author kongweiguang

import {
  fireEvent,
  render,
  screen,
  waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe,
  expect,
  it } from "vitest";
import {  createDragDataTransfer,
  createSftpTransferSummary,
  fileDialogMocks,
  openCurrentDirectoryContextMenu,
  sftpApiMocks,
  sshMachine,
  stageSshMachine,
} from "../../support/sftp/SftpToolContent.testSupport.tsx";
import { SftpToolContent } from "../../../../src/features/sftp/SftpToolContent";

describe("SftpToolContent clipboard and selection", () => {
  it("copies a selected remote item to the local file clipboard with Ctrl+C", async () => {
    const user = userEvent.setup();

    render(<SftpToolContent selectedMachine={sshMachine} />);

    await screen.findByText("var");
    await user.dblClick(screen.getByRole("button", { name: "打开目录 log" }));
    const fileButton = await screen.findByRole("button", {
      name: "文件 app.log",
    });
    await user.click(fileButton);

    fireEvent.keyDown(fileButton, { ctrlKey: true, key: "c" });
    await waitFor(() =>
      expect(sftpApiMocks.enqueueSftpClipboardDownload).toHaveBeenCalledWith({
        hostId: "prod-api",
        kind: "file",
        sourceRemotePath: "/var/log/app.log",
      }),
    );
    expect(sftpApiMocks.enqueueSftpRemoteCopy).not.toHaveBeenCalled();
  });

  it("copies and pastes multiple selected remote items with keyboard shortcuts", async () => {
    const user = userEvent.setup();

    render(<SftpToolContent selectedMachine={sshMachine} />);

    await screen.findByText("var");
    await user.dblClick(screen.getByRole("button", { name: "打开目录 log" }));
    const fileButton = await screen.findByRole("button", {
      name: "文件 app.log",
    });
    const symlinkButton = await screen.findByRole("button", {
      name: "链接 current",
    });
    await user.click(fileButton);
    fireEvent.click(symlinkButton, { ctrlKey: true });

    fireEvent.keyDown(symlinkButton, { ctrlKey: true, key: "c" });
    expect(
      await screen.findByText(/已复制到 SFTP 剪贴板：2 个远程项目/),
    ).toBeInTheDocument();

    fireEvent.keyDown(symlinkButton, { ctrlKey: true, key: "v" });
    await waitFor(() =>
      expect(sftpApiMocks.enqueueSftpRemoteCopy).toHaveBeenCalledWith({
        conflictPolicy: "overwrite",
        kind: "file",
        sourceHostId: "prod-api",
        sourceRemotePath: "/var/log/app.log",
        targetHostId: "prod-api",
        targetRemotePath: "/var/log/app.copy.log",
      }),
    );
    expect(sftpApiMocks.enqueueSftpRemoteCopy).toHaveBeenCalledWith({
      conflictPolicy: "overwrite",
      kind: "file",
      sourceHostId: "prod-api",
      sourceRemotePath: "/var/log/current",
      targetHostId: "prod-api",
      targetRemotePath: "/var/log/current.copy",
    });
    expect(screen.queryByText(/已加入.*队列/)).not.toBeInTheDocument();
  });

  it("selects a visible range with Shift without opening directories", async () => {
    const user = userEvent.setup();

    render(<SftpToolContent selectedMachine={sshMachine} />);

    await screen.findByText("var");
    const envButton = screen.getByRole("button", { name: "文件 .env" });
    const varButton = screen.getByRole("button", { name: "打开目录 var" });
    await user.click(envButton);
    fireEvent.click(varButton, { shiftKey: true });

    expect(
      sftpApiMocks.listSftpDirectory,
    ).not.toHaveBeenCalledWith({
      hostId: "prod-api",
      path: "/var",
    });
    expect(screen.getByText(/已选 3/)).toBeInTheDocument();

    fireEvent.keyDown(varButton, { ctrlKey: true, key: "c" });
    expect(
      await screen.findByText(/已复制到 SFTP 剪贴板：3 个远程项目/),
    ).toBeInTheDocument();
  });

  it("downloads multiple selected remote items into one local directory", async () => {
    const user = userEvent.setup();

    render(<SftpToolContent selectedMachine={sshMachine} />);

    await screen.findByText("var");
    await user.dblClick(screen.getByRole("button", { name: "打开目录 log" }));
    const fileButton = await screen.findByRole("button", {
      name: "文件 app.log",
    });
    const symlinkButton = await screen.findByRole("button", {
      name: "链接 current",
    });
    await user.click(fileButton);
    fireEvent.click(symlinkButton, { ctrlKey: true });
    await user.click(screen.getByRole("button", { name: "下载选中项目" }));

    await waitFor(() =>
      expect(fileDialogMocks.selectLocalDirectory).toHaveBeenCalled(),
    );
    expect(sftpApiMocks.enqueueSftpTransfer).toHaveBeenCalledWith({
      conflictPolicy: "overwrite",
      direction: "download",
      hostId: "prod-api",
      kind: "file",
      localPath: "/Users/me/Downloads/app.log",
      remotePath: "/var/log/app.log",
    });
    expect(sftpApiMocks.enqueueSftpTransfer).toHaveBeenCalledWith({
      conflictPolicy: "overwrite",
      direction: "download",
      hostId: "prod-api",
      kind: "file",
      localPath: "/Users/me/Downloads/current",
      remotePath: "/var/log/current",
    });
    expect(screen.queryByText(/已加入批量下载队列：2 个远程项目/)).not.toBeInTheDocument();
  });

  it("downloads selected remote items when they are dragged onto the panel", async () => {
    const user = userEvent.setup();

    render(<SftpToolContent selectedMachine={sshMachine} />);

    await screen.findByText("var");
    await user.dblClick(screen.getByRole("button", { name: "打开目录 log" }));
    const fileButton = await screen.findByRole("button", {
      name: "文件 app.log",
    });
    const symlinkButton = await screen.findByRole("button", {
      name: "链接 current",
    });
    await user.click(fileButton);
    fireEvent.click(symlinkButton, { ctrlKey: true });

    const fileRow = fileButton.closest("[data-sftp-entry-row]");
    expect(fileRow).toBeInstanceOf(HTMLElement);
    const dataTransfer = createDragDataTransfer();
    fireEvent.dragStart(fileRow as HTMLElement, { dataTransfer });

    expect(await screen.findByText("拖到下方列表复制 2 项")).toBeInTheDocument();
    fireEvent.dragOver(screen.getByTestId("sftp-drop-zone"), { dataTransfer });
    fireEvent.drop(screen.getByTestId("sftp-drop-zone"), { dataTransfer });

    await waitFor(() =>
      expect(fileDialogMocks.selectLocalDirectory).toHaveBeenCalled(),
    );
    expect(sftpApiMocks.enqueueSftpTransfer).toHaveBeenCalledWith({
      conflictPolicy: "overwrite",
      direction: "download",
      hostId: "prod-api",
      kind: "file",
      localPath: "/Users/me/Downloads/app.log",
      remotePath: "/var/log/app.log",
    });
    expect(sftpApiMocks.enqueueSftpTransfer).toHaveBeenCalledWith({
      conflictPolicy: "overwrite",
      direction: "download",
      hostId: "prod-api",
      kind: "file",
      localPath: "/Users/me/Downloads/current",
      remotePath: "/var/log/current",
    });
    expect(screen.queryByText(/已加入批量下载队列：2 个远程项目/)).not.toBeInTheDocument();
  });

  it("uploads system clipboard files with Ctrl+V when the SFTP clipboard is empty", async () => {
    sftpApiMocks.readSftpLocalFileClipboard.mockResolvedValue([
      { kind: "file", path: "/Users/me/release.tgz" },
      { kind: "directory", path: "/Users/me/dist" },
    ]);

    render(<SftpToolContent selectedMachine={sshMachine} />);

    await screen.findByText("var");
    fireEvent.keyDown(screen.getByTestId("sftp-drop-zone"), {
      ctrlKey: true,
      key: "v",
    });

    await waitFor(() =>
      expect(sftpApiMocks.readSftpLocalFileClipboard).toHaveBeenCalled(),
    );
    expect(sftpApiMocks.enqueueSftpTransfer).toHaveBeenCalledWith({
      conflictPolicy: "overwrite",
      direction: "upload",
      hostId: "prod-api",
      kind: "file",
      localPath: "/Users/me/release.tgz",
      remotePath: "/release.tgz",
    });
    expect(sftpApiMocks.enqueueSftpTransfer).toHaveBeenCalledWith({
      conflictPolicy: "overwrite",
      direction: "upload",
      hostId: "prod-api",
      kind: "directory",
      localPath: "/Users/me/dist",
      remotePath: "/dist",
    });
    expect(
      screen.queryByText(/已加入剪贴板上传队列：2 个本地项目/),
    ).not.toBeInTheDocument();
  });

  it("shows an empty clipboard message when Ctrl+V finds no SFTP or system files", async () => {
    render(<SftpToolContent selectedMachine={sshMachine} />);

    await screen.findByText("var");
    fireEvent.keyDown(screen.getByTestId("sftp-drop-zone"), {
      ctrlKey: true,
      key: "v",
    });

    expect(
      await screen.findByText(/系统剪贴板也没有本地文件/),
    ).toBeInTheDocument();
    expect(sftpApiMocks.enqueueSftpTransfer).not.toHaveBeenCalled();
  });

  it("keeps the SFTP clipboard available when switching to another SSH host", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <SftpToolContent selectedMachine={sshMachine} />,
    );

    await screen.findByText("var");
    await user.dblClick(screen.getByRole("button", { name: "打开目录 log" }));
    const fileButton = await screen.findByRole("button", {
      name: "文件 app.log",
    });
    await user.click(fileButton);
    fireEvent.contextMenu(fileButton, {
      clientX: 24,
      clientY: 24,
    });
    await user.click(screen.getByRole("menuitem", { name: "复制项目" }));
    expect(await screen.findByText(/已复制到 SFTP 剪贴板/)).toBeInTheDocument();

    rerender(<SftpToolContent selectedMachine={stageSshMachine} />);
    expect(await screen.findByText(/stage.internal:22/)).toBeInTheDocument();
    openCurrentDirectoryContextMenu();
    await user.click(
      screen.getByRole("menuitem", { name: "粘贴 SFTP 剪贴板" }),
    );

    await waitFor(() =>
      expect(sftpApiMocks.enqueueSftpRemoteCopy).toHaveBeenCalledWith({
        conflictPolicy: "overwrite",
        kind: "file",
        sourceHostId: "prod-api",
        sourceRemotePath: "/var/log/app.log",
        targetHostId: "stage-api",
        targetRemotePath: "/app.log",
      }),
    );
    expect(screen.queryByText(/已加入跨主机传输队列/)).not.toBeInTheDocument();
  });

  it("shows transfer progress and cancels a running transfer", async () => {
    const user = userEvent.setup();
    sftpApiMocks.listSftpTransfers.mockResolvedValue([
      createSftpTransferSummary({
        bytesTransferred: 512,
        cancelRequested: false,
        createdAt: 1,
        direction: "download",
        hostId: "prod-api",
        id: "transfer-running",
        kind: "file",
        localPath: "/Users/me/Downloads/app.log",
        remotePath: "/var/log/app.log",
        status: "running",
        totalBytes: 1024,
        updatedAt: 1,
      }),
    ]);

    render(<SftpToolContent selectedMachine={sshMachine} />);

    expect(
      await screen.findByRole("status", { name: "SFTP 传输状态" }),
    ).toBeInTheDocument();
    expect(screen.getByText("SFTP 传输队列")).toBeInTheDocument();
    expect(await screen.findByText("app.log")).toBeInTheDocument();
    expect(screen.getByLabelText("传输中")).toBeInTheDocument();
    expect(screen.getByText("1 活动")).toBeInTheDocument();
    expect(screen.getByText("50%")).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "查看传输详情 app.log" }),
    );
    expect(screen.getByText("512 B / 1.0 KB")).toBeInTheDocument();
    expect(
      screen.getByRole("progressbar", { name: "传输进度 app.log" }),
    ).toHaveAttribute("aria-valuenow", "50");

    await user.click(screen.getByRole("button", { name: "取消传输 app.log" }));

    await waitFor(() =>
      expect(sftpApiMocks.cancelSftpTransfer).toHaveBeenCalledWith({
        transferId: "transfer-running",
      }),
    );
    expect(await screen.findByText("已请求取消传输。")).toBeInTheDocument();
  });

});
