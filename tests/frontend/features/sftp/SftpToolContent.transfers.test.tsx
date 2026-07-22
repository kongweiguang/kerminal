// @author kongweiguang

import {
  fireEvent,
  render,
  screen,
  waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe,
  expect,
  it,
  vi } from "vitest";
import {  containerFilesApiMocks,
  desktopRuntimeMocks,
  fileDialogMocks,
  openCurrentDirectoryContextMenu,
  sftpApiMocks,
  sftpMachine,
  sshMachine,
  containerMachine,
} from "../../support/sftp/SftpToolContent.testSupport.tsx";
import { SftpToolContent } from "../../../../src/features/sftp/SftpToolContent";

describe("SftpToolContent transfers and containers", () => {
  it("downloads a selected file from the context menu", async () => {
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
    await user.click(screen.getByRole("menuitem", { name: "下载" }));

    await waitFor(() =>
      expect(fileDialogMocks.selectSaveFile).toHaveBeenCalledWith("app.log"),
    );
    expect(sftpApiMocks.enqueueSftpTransfer).toHaveBeenCalledWith({
      conflictPolicy: "overwrite",
      direction: "download",
      hostId: "prod-api",
      kind: "file",
      localPath: "/Users/me/Downloads/app.log",
      remotePath: "/var/log/app.log",
    });
    expect(screen.queryByText(/已加入下载队列/)).not.toBeInTheDocument();
  });

  it("downloads a directory from the context menu", async () => {
    const user = userEvent.setup();

    render(<SftpToolContent selectedMachine={sshMachine} />);

    expect(await screen.findByText("var")).toBeInTheDocument();
    fireEvent.contextMenu(
      screen.getByRole("button", { name: "打开目录 var" }),
      {
        clientX: 24,
        clientY: 24,
      },
    );
    await user.click(screen.getByRole("menuitem", { name: "下载文件夹" }));

    await waitFor(() =>
      expect(fileDialogMocks.selectLocalDirectory).toHaveBeenCalled(),
    );
    expect(sftpApiMocks.enqueueSftpTransfer).toHaveBeenCalledWith({
      conflictPolicy: "overwrite",
      direction: "download",
      hostId: "prod-api",
      kind: "directory",
      localPath: "/Users/me/Downloads/var",
      remotePath: "/var",
    });
    expect(screen.queryByText(/已加入文件夹下载队列/)).not.toBeInTheDocument();
  });

  it("does not offer ZIP archive download for remote files in the context menu", async () => {
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
    expect(
      screen.queryByRole("menuitem", { name: "下载为 ZIP" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "下载到剪贴板" }),
    ).toBeInTheDocument();
    expect(sftpApiMocks.enqueueSftpArchiveDownload).not.toHaveBeenCalled();
  });

  it("does not offer ZIP archive download for remote directories in the context menu", async () => {
    render(<SftpToolContent selectedMachine={sshMachine} />);

    expect(await screen.findByText("var")).toBeInTheDocument();
    fireEvent.contextMenu(
      screen.getByRole("button", { name: "打开目录 var" }),
      {
        clientX: 24,
        clientY: 24,
      },
    );

    expect(
      screen.queryByRole("menuitem", { name: "下载为 ZIP" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "下载到剪贴板" }),
    ).toBeInTheDocument();
    expect(sftpApiMocks.enqueueSftpArchiveDownload).not.toHaveBeenCalled();
  });

  it("does not offer ZIP archive uploads from the current-directory context menu", async () => {
    render(<SftpToolContent selectedMachine={sshMachine} />);

    await screen.findByText("var");
    openCurrentDirectoryContextMenu();

    expect(
      screen.queryByRole("menuitem", { name: "上传文件为 ZIP" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: "上传文件夹为 ZIP" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "粘贴 SFTP 剪贴板" }),
    ).toBeInTheDocument();
    expect(fileDialogMocks.selectLocalDirectory).not.toHaveBeenCalled();
    expect(sftpApiMocks.enqueueSftpArchiveUpload).not.toHaveBeenCalled();
  });

  it("downloads a selected remote file to the local file clipboard", async () => {
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
    await user.click(screen.getByRole("menuitem", { name: "下载到剪贴板" }));

    await waitFor(() =>
      expect(sftpApiMocks.enqueueSftpClipboardDownload).toHaveBeenCalledWith({
        hostId: "prod-api",
        kind: "file",
        sourceRemotePath: "/var/log/app.log",
      }),
    );
    expect(
      screen.queryByText(/已加入本地剪贴板下载队列/),
    ).not.toBeInTheDocument();
  });

  it("downloads a remote directory to the local file clipboard from the context menu", async () => {
    const user = userEvent.setup();
    sftpApiMocks.enqueueSftpClipboardDownload.mockImplementationOnce(
      async (request) => ({
        bytesTransferred: 0,
        cancelRequested: false,
        createdAt: 1,
        direction: "download",
        hostId: request.hostId,
        id: "clipboard-download-1",
        kind: request.kind,
        localPath: "/Users/me/Downloads/var",
        remotePath: request.sourceRemotePath,
        status: "queued",
        totalBytes: undefined,
        updatedAt: 1,
      }),
    );

    render(<SftpToolContent selectedMachine={sshMachine} />);

    expect(await screen.findByText("var")).toBeInTheDocument();
    fireEvent.contextMenu(
      screen.getByRole("button", { name: "打开目录 var" }),
      {
        clientX: 24,
        clientY: 24,
      },
    );
    await user.click(screen.getByRole("menuitem", { name: "下载到剪贴板" }));

    await waitFor(() =>
      expect(sftpApiMocks.enqueueSftpClipboardDownload).toHaveBeenCalledWith({
        hostId: "prod-api",
        kind: "directory",
        sourceRemotePath: "/var",
      }),
    );
  });

  it("uploads a local file from the toolbar upload menu and refreshes the current directory", async () => {
    const user = userEvent.setup();

    render(<SftpToolContent selectedMachine={sshMachine} />);

    await screen.findByText("var");
    await user.click(screen.getByRole("button", { name: "上传" }));
    await user.click(screen.getByRole("menuitem", { name: "上传文件" }));

    await waitFor(() =>
      expect(fileDialogMocks.selectLocalFile).toHaveBeenCalled(),
    );
    expect(sftpApiMocks.enqueueSftpTransfer).toHaveBeenCalledWith({
      conflictPolicy: "overwrite",
      direction: "upload",
      hostId: "prod-api",
      kind: "file",
      localPath: "/Users/me/release.tgz",
      remotePath: "/release.tgz",
    });
    expect(screen.queryByText(/已加入上传队列/)).not.toBeInTheDocument();
  });

  it("keeps the toolbar upload menu above the remote directory list", async () => {
    const user = userEvent.setup();

    render(<SftpToolContent selectedMachine={sshMachine} />);

    await screen.findByText("var");
    await user.click(screen.getByRole("button", { name: "上传" }));

    const uploadMenu = screen.getByRole("menu", { name: "上传菜单" });
    expect(uploadMenu).toHaveAttribute("data-sftp-upload-menu", "true");
    expect(uploadMenu).toHaveClass("fixed");
    expect(uploadMenu).toHaveClass("kerminal-layer-popover");
    expect(uploadMenu).toHaveClass("bg-[var(--surface-overlay)]");
    expect(document.body).toContainElement(uploadMenu);
  });

  it("asks for a conflict policy before uploading over an existing remote file", async () => {
    const user = userEvent.setup();
    sftpApiMocks.statSftpPath.mockResolvedValue({
      hostId: "prod-api",
      kind: "file",
      path: "/release.tgz",
      readonly: false,
    });

    render(<SftpToolContent selectedMachine={sshMachine} />);

    await screen.findByText("var");
    await user.click(screen.getByRole("button", { name: "上传" }));
    await user.click(screen.getByRole("menuitem", { name: "上传文件" }));

    expect(await screen.findByText("处理传输冲突")).toBeInTheDocument();
    expect(sftpApiMocks.enqueueSftpTransfer).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /自动重命名/ }));

    await waitFor(() =>
      expect(sftpApiMocks.enqueueSftpTransfer).toHaveBeenCalledWith({
        conflictPolicy: "rename",
        direction: "upload",
        hostId: "prod-api",
        kind: "file",
        localPath: "/Users/me/release.tgz",
        remotePath: "/release.tgz",
      }),
    );
  });

  it("uploads a local directory from the toolbar upload menu", async () => {
    const user = userEvent.setup();
    fileDialogMocks.selectLocalDirectory.mockResolvedValue("/Users/me/dist");

    render(<SftpToolContent selectedMachine={sshMachine} />);

    await screen.findByText("var");
    await user.click(screen.getByRole("button", { name: "上传" }));
    await user.click(screen.getByRole("menuitem", { name: "上传文件夹" }));

    await waitFor(() =>
      expect(fileDialogMocks.selectLocalDirectory).toHaveBeenCalled(),
    );
    expect(sftpApiMocks.enqueueSftpTransfer).toHaveBeenCalledWith({
      conflictPolicy: "overwrite",
      direction: "upload",
      hostId: "prod-api",
      kind: "directory",
      localPath: "/Users/me/dist",
      remotePath: "/dist",
    });
    expect(screen.queryByText(/已加入文件夹上传队列/)).not.toBeInTheDocument();
  });

  it("loads container files through the unified file panel", async () => {
    render(<SftpToolContent selectedMachine={containerMachine} />);

    expect(await screen.findByText("package.json")).toBeInTheDocument();
    expect(screen.getByText("docker:prod-api:api")).toBeInTheDocument();
    expect(containerFilesApiMocks.listDockerContainerDirectory).toHaveBeenCalledWith({
      containerId: "container-api",
      hostId: "prod-api",
      path: "/app",
      runtime: "docker",
    });
    expect(sftpApiMocks.listSftpDirectory).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: "上传文件为 ZIP" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "粘贴 SFTP 剪贴板" }),
    ).not.toBeInTheDocument();
  });

  it("uploads a local file into a container from the shared toolbar", async () => {
    const user = userEvent.setup();

    render(<SftpToolContent selectedMachine={containerMachine} />);

    expect(await screen.findByText("package.json")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "上传" }));
    await user.click(screen.getByRole("menuitem", { name: "上传文件" }));

    await waitFor(() =>
      expect(fileDialogMocks.selectLocalFile).toHaveBeenCalled(),
    );
    expect(containerFilesApiMocks.uploadDockerContainerPath).toHaveBeenCalledWith({
      containerId: "container-api",
      hostId: "prod-api",
      kind: "file",
      localPath: "/Users/me/release.tgz",
      remotePath: "/app/release.tgz",
      runtime: "docker",
    });
    await waitFor(() =>
      expect(
        containerFilesApiMocks.listDockerContainerDirectory.mock.calls.length,
      ).toBeGreaterThanOrEqual(2),
    );
    expect(sftpApiMocks.enqueueSftpTransfer).not.toHaveBeenCalled();
    expect(await screen.findByText("SFTP 传输队列")).toBeInTheDocument();
    expect(
      screen.getByRole("group", { name: "SFTP 上传 release.tgz" }),
    ).toBeInTheDocument();
    expect(screen.getByText("完成")).toBeInTheDocument();
  });

  it("downloads a container file from the shared context menu", async () => {
    const user = userEvent.setup();

    render(<SftpToolContent selectedMachine={containerMachine} />);

    expect(await screen.findByText("package.json")).toBeInTheDocument();
    fireEvent.contextMenu(
      screen.getByRole("button", { name: "文件 package.json" }),
      {
        clientX: 24,
        clientY: 24,
      },
    );

    expect(screen.getByRole("menuitem", { name: "下载" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "下载为 ZIP" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: "下载" }));

    await waitFor(() =>
      expect(fileDialogMocks.selectSaveFile).toHaveBeenCalledWith(
        "package.json",
      ),
    );
    expect(containerFilesApiMocks.downloadDockerContainerPath).toHaveBeenCalledWith({
      containerId: "container-api",
      hostId: "prod-api",
      kind: "file",
      localPath: "/Users/me/Downloads/app.log",
      remotePath: "/app/package.json",
      runtime: "docker",
    });
    expect(sftpApiMocks.enqueueSftpTransfer).not.toHaveBeenCalled();
    expect(await screen.findByText("SFTP 传输队列")).toBeInTheDocument();
    expect(
      screen.getByRole("group", { name: "SFTP 下载 package.json" }),
    ).toBeInTheDocument();
    expect(screen.getByText("完成")).toBeInTheDocument();
  });

  it("opens a container file in the central workspace tab", async () => {
    const user = userEvent.setup();
    const onOpenWorkspaceFileTab = vi.fn();

    render(
      <SftpToolContent
        onOpenWorkspaceFileTab={onOpenWorkspaceFileTab}
        selectedMachine={containerMachine}
      />,
    );

    expect(await screen.findByText("package.json")).toBeInTheDocument();
    await user.dblClick(
      screen.getByRole("button", { name: "文件 package.json" }),
    );

    await waitFor(() =>
      expect(onOpenWorkspaceFileTab).toHaveBeenCalledWith({
        access: "editable",
        path: "/app/package.json",
        rootPath: "/app",
        source: "container",
        target: {
          containerId: "container-api",
          containerName: "api",
          hostId: "prod-api",
          kind: "dockerContainer",
          runtime: "docker",
          workdir: "/app",
        },
      }),
    );
  });

  it("shows a missing workspace tab bridge error", async () => {
    render(<SftpToolContent selectedMachine={containerMachine} />);

    expect(await screen.findByText("package.json")).toBeInTheDocument();
    fireEvent.doubleClick(
      screen.getByRole("button", { name: "文件 package.json" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "中间文件 Tab 尚未接入",
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "中间文件 Tab 尚未接入",
    );
  });

  it("uploads dropped local paths into the current SFTP directory", async () => {
    const dragDropHandlers: Array<(payload: unknown) => void> = [];
    (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ =
      {};
    desktopRuntimeMocks.listenToDragDrop.mockImplementation(
      async (handler: (payload: unknown) => void) => {
        dragDropHandlers.push(handler);
        return () => undefined;
      },
    );

    render(<SftpToolContent selectedMachine={sftpMachine} />);

    await screen.findByText("var");
    await waitFor(() =>
      expect(desktopRuntimeMocks.listenToDragDrop).toHaveBeenCalled(),
    );
    const dropZone = screen.getByTestId("sftp-drop-zone");
    dropZone.getBoundingClientRect = () =>
      ({
        bottom: 240,
        height: 220,
        left: 10,
        right: 430,
        top: 20,
        width: 420,
        x: 10,
        y: 20,
        toJSON: () => ({}),
      }) as DOMRect;

    dragDropHandlers[0]({
      paths: ["/Users/me/release.tgz", "/Users/me/dist"],
      position: { x: 24, y: 48 },
      type: "drop",
    });

    await waitFor(() =>
      expect(sftpApiMocks.classifySftpLocalPaths).toHaveBeenCalledWith({
        paths: ["/Users/me/release.tgz", "/Users/me/dist"],
      }),
    );
    expect(sftpApiMocks.enqueueSftpTransfer).toHaveBeenCalledWith({
      conflictPolicy: "overwrite",
      direction: "upload",
      hostId: "prod-files",
      kind: "file",
      localPath: "/Users/me/release.tgz",
      remotePath: "/release.tgz",
    });
    expect(sftpApiMocks.enqueueSftpTransfer).toHaveBeenCalledWith({
      conflictPolicy: "overwrite",
      direction: "upload",
      hostId: "prod-files",
      kind: "directory",
      localPath: "/Users/me/dist",
      remotePath: "/dist",
    });
    expect(
      screen.queryByText(/已加入拖拽上传队列：2 个本地项目/),
    ).not.toBeInTheDocument();
  });

});
