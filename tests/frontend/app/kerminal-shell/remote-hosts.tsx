// @author kongweiguang

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import {
  mockElementFromPoint,
  rdpRemoteHostTree,
  remoteHostTreeWithPinnedTargetGroup,
  remoteHostTreeWithTargetGroup,
  testSshOptions,
} from "../../support/app/KerminalShell.testSupport.tsx";
import { KerminalShell } from "../../../../src/app/KerminalShell";
import {
  findExpandedSidebarMachine,
  mocks,
} from "./setup";

export function registerRemoteHostTests() {
  it("opens a saved SSH host directly from the tab-bar create menu", async () => {
    const user = userEvent.setup();

    render(<KerminalShell />);

    await findExpandedSidebarMachine(/172\.16\.41\.60/);
    fireEvent.contextMenu(
      screen.getByRole("button", { name: "新建临时终端" }),
      { clientX: 240, clientY: 36 },
    );
    const createPanel = screen.getByRole("dialog", { name: "新建终端" });
    const createMenu = within(createPanel).getByRole("menu", {
      name: "终端目标",
    });
    await user.click(
      within(createMenu).getByRole("menuitem", {
        name: /172\.16\.41\.60.*ubuntu@172\.16\.41\.60:22/,
      }),
    );

    await waitFor(() => {
      expect(mocks.terminalApi.createSshTerminalSession).toHaveBeenCalledWith(
        {
          cols: 80,
          hostId: "db980b17-2ed0-44e5-b72a-6ecadf788439",
          rows: 24,
        },
        expect.any(Function),
      );
    });
    expect(
      await findExpandedSidebarMachine(/172\.16\.41\.60/),
    ).toBeInTheDocument();
  });

  it("opens an SSH host and then renders the remote system panel", async () => {
    const user = userEvent.setup();

    render(<KerminalShell />);

    const hostButton = await findExpandedSidebarMachine(/172\.16\.41\.60/);
    fireEvent.doubleClick(hostButton);

    await waitFor(() => {
      expect(mocks.terminalApi.createSshTerminalSession).toHaveBeenCalledWith(
        {
          cols: 80,
          hostId: "db980b17-2ed0-44e5-b72a-6ecadf788439",
          rows: 24,
        },
        expect.any(Function),
      );
    });

    await user.click(screen.getByRole("button", { name: "打开 系统" }));

    expect(await screen.findByText("bwy-host")).toBeInTheDocument();
    expect(mocks.serverInfoApi.getServerInfoSnapshot).toHaveBeenCalledWith({
      hostId: "db980b17-2ed0-44e5-b72a-6ecadf788439",
      target: {
        hostId: "db980b17-2ed0-44e5-b72a-6ecadf788439",
        kind: "ssh",
      },
    });
    expect(screen.queryByText("终端分屏渲染异常")).not.toBeInTheDocument();
    expect(
      screen.queryByText("应用启动失败，请打开开发者工具查看错误。"),
    ).not.toBeInTheDocument();
  });

  it("shows saved RDP launch progress and ignores repeated double clicks", async () => {
    let resolveRdpLaunch:
      | ((result: { launched: boolean; message: string }) => void)
      | undefined;
    mocks.remoteHostApi.listRemoteHostTree.mockResolvedValue(rdpRemoteHostTree);
    mocks.connectionApi.openSavedRdpConnection.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRdpLaunch = resolve;
        }),
    );

    render(<KerminalShell />);

    const hostButton = await findExpandedSidebarMachine(/office-rdp/);
    fireEvent.doubleClick(hostButton);

    await waitFor(() => {
      expect(hostButton).toHaveAttribute("aria-busy", "true");
      expect(hostButton).toHaveTextContent("正在打开远程桌面...");
      expect(mocks.connectionApi.openSavedRdpConnection).toHaveBeenCalledWith(
        "rdp-office",
      );
    });

    fireEvent.doubleClick(hostButton);
    expect(mocks.connectionApi.openSavedRdpConnection).toHaveBeenCalledTimes(1);
    expect(mocks.terminalApi.createSshTerminalSession).not.toHaveBeenCalled();

    await act(async () => {
      resolveRdpLaunch?.({ launched: true, message: "RDP launched" });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(hostButton).not.toHaveAttribute("aria-busy");
      expect(hostButton).not.toHaveTextContent("正在打开远程桌面...");
    });
  });

  it("restores the saved RDP row after launch failure", async () => {
    mocks.remoteHostApi.listRemoteHostTree.mockResolvedValue(rdpRemoteHostTree);
    mocks.connectionApi.openSavedRdpConnection.mockRejectedValueOnce(
      new Error("mstsc unavailable"),
    );

    render(<KerminalShell />);

    const hostButton = await findExpandedSidebarMachine(/office-rdp/);
    fireEvent.doubleClick(hostButton);

    expect(
      await screen.findByText(
        "RDP 连接未打开，请检查主机地址和系统远程桌面设置后重试。",
      ),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(hostButton).not.toHaveAttribute("aria-busy");
      expect(hostButton).not.toHaveTextContent("正在打开远程桌面...");
    });
  });

  it("creates a real default group when saving an SSH host without selecting a group", async () => {
    const user = userEvent.setup();
    mocks.remoteHostApi.listRemoteHostTree.mockResolvedValue([]);
    mocks.remoteHostApi.createRemoteHostGroup.mockResolvedValue({
      createdAt: "test",
      id: "group-default",
      name: "默认分组",
      sortOrder: 10,
      updatedAt: "test",
    });
    mocks.remoteHostApi.createRemoteHost.mockResolvedValue({
      authType: "agent",
      createdAt: "test",
      groupId: "group-default",
      host: "10.0.0.8",
      id: "host-default",
      name: "default-dev",
      port: 22,
      sortOrder: 10,
      tags: ["ssh"],
      updatedAt: "test",
      username: "ubuntu",
    });

    render(<KerminalShell />);

    fireEvent.contextMenu(
      await screen.findByRole("complementary", { name: "主机侧边栏" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "添加连接" }));
    await user.click(await screen.findByRole("button", { name: "SSH" }));

    await user.type(screen.getByLabelText("名称"), "default-dev");
    await user.type(screen.getByLabelText("主机"), "10.0.0.8");
    await user.type(screen.getByLabelText("用户名"), "ubuntu");
    await user.click(screen.getByRole("combobox", { name: "认证方式" }));
    await user.click(screen.getByRole("option", { name: /SSH Agent/ }));
    await user.click(screen.getByRole("button", { name: "确认" }));

    await waitFor(() => {
      expect(mocks.remoteHostApi.createRemoteHostGroup).toHaveBeenCalledWith({
        name: "默认分组",
      });
      expect(mocks.remoteHostApi.createRemoteHost).toHaveBeenCalledWith(
        expect.objectContaining({
          groupId: "group-default",
          host: "10.0.0.8",
          name: "default-dev",
          username: "ubuntu",
        }),
      );
    });
  });

  it("edits a profile-backed local terminal from the sidebar context menu", async () => {
    const user = userEvent.setup();
    const profile = {
      args: ["-NoLogo"],
      createdAt: "test",
      cwd: "C:\\dev",
      env: { TERM: "xterm-256color" },
      id: "profile-pwsh",
      isDefault: true,
      name: "PowerShell 7",
      shell: "pwsh.exe",
      sidebarGroupId: "group-default",
      sortOrder: 10,
      updatedAt: "test",
    };
    mocks.profileApi.listProfiles.mockResolvedValue([profile]);

    render(<KerminalShell />);
    await waitFor(() =>
      expect(mocks.profileApi.listProfiles).toHaveBeenCalled(),
    );

    const localButton = await findExpandedSidebarMachine(/PowerShell 7/);
    fireEvent.contextMenu(localButton);
    await user.click(screen.getByRole("menuitem", { name: "编辑连接配置" }));

    expect(
      await screen.findByRole("dialog", { name: "编辑连接配置" }),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("会话名称"), {
      target: { value: "Renamed PowerShell" },
    });
    await user.click(screen.getByRole("button", { name: "确认" }));

    await waitFor(() => {
      expect(mocks.profileApi.updateProfile).toHaveBeenCalledWith(
        expect.objectContaining({
          args: ["-NoLogo"],
          cwd: "C:\\dev",
          env: { TERM: "xterm-256color" },
          id: "profile-pwsh",
          name: "Renamed PowerShell",
          shell: "pwsh.exe",
          sortOrder: 10,
        }),
      );
    });
    expect(
      await findExpandedSidebarMachine(/Renamed PowerShell/),
    ).toBeInTheDocument();
  });

  it("duplicates an SSH host from the sidebar context menu", async () => {
    const user = userEvent.setup();

    render(<KerminalShell />);

    const hostButton = await findExpandedSidebarMachine(/172\.16\.41\.60/);
    fireEvent.contextMenu(hostButton);
    await user.click(screen.getByRole("menuitem", { name: "复制主机" }));

    await waitFor(() => {
      expect(mocks.remoteHostApi.createRemoteHost).toHaveBeenCalledWith({
        authType: "agent",
        credentialRef: undefined,
        credentialSecret: undefined,
        groupId: "30fbc381-2884-4b75-9f88-0e28f31ca8b0",
        host: "172.16.41.60",
        name: "172.16.41.60 副本",
        port: 22,
        protocol: "ssh",
        sshOptions: testSshOptions,
        tags: ["ssh", "bbb"],
        username: "ubuntu",
      });
    });
  });

  it("moves an SSH host to another group through drag and drop", async () => {
    mocks.remoteHostApi.listRemoteHostTree.mockResolvedValue(
      remoteHostTreeWithTargetGroup,
    );

    render(<KerminalShell />);

    const hostButton = await findExpandedSidebarMachine(/172\.16\.41\.60/);
    const targetSection = (await screen.findByText("工具")).closest("section");
    expect(targetSection).toBeInTheDocument();
    const restoreElementFromPoint = mockElementFromPoint(targetSection!);

    try {
      fireEvent.pointerDown(hostButton, {
        button: 0,
        clientX: 12,
        clientY: 12,
        pointerId: 1,
      });
      fireEvent.pointerMove(window, {
        clientX: 16,
        clientY: 28,
        pointerId: 1,
      });
      fireEvent.pointerUp(window, {
        clientX: 16,
        clientY: 28,
        pointerId: 1,
      });
    } finally {
      restoreElementFromPoint();
    }

    await waitFor(() => {
      expect(mocks.remoteHostApi.updateRemoteHost).toHaveBeenCalledWith({
        authType: "agent",
        credentialRef: undefined,
        groupId: "group-tools",
        host: "172.16.41.60",
        id: "db980b17-2ed0-44e5-b72a-6ecadf788439",
        name: "172.16.41.60",
        port: 22,
        protocol: "ssh",
        sortOrder: 10,
        sshOptions: testSshOptions,
        tags: ["ssh", "bbb"],
        username: "ubuntu",
      });
    });
  });

  it("pins a remote host group from the sidebar context menu", async () => {
    const user = userEvent.setup();
    mocks.remoteHostApi.listRemoteHostTree.mockResolvedValue(
      remoteHostTreeWithTargetGroup,
    );

    render(<KerminalShell />);

    const targetGroupButton = await screen.findByRole("button", {
      name: /工具/,
    });
    fireEvent.contextMenu(targetGroupButton);
    await user.click(screen.getByRole("menuitem", { name: "置顶分组" }));

    await waitFor(() => {
      expect(mocks.remoteHostApi.updateRemoteHostGroup).toHaveBeenCalledWith({
        id: "group-tools",
        name: "工具",
        sortOrder: -10,
      });
    });
  });

  it("unpins a pinned remote host group from the sidebar context menu", async () => {
    const user = userEvent.setup();
    mocks.remoteHostApi.listRemoteHostTree.mockResolvedValue(
      remoteHostTreeWithPinnedTargetGroup,
    );

    render(<KerminalShell />);

    const targetGroupButton = await screen.findByRole("button", {
      name: /工具/,
    });
    expect(screen.getByText("置顶")).toBeInTheDocument();
    fireEvent.contextMenu(targetGroupButton);
    await user.click(screen.getByRole("menuitem", { name: "取消置顶" }));

    await waitFor(() => {
      expect(mocks.remoteHostApi.updateRemoteHostGroup).toHaveBeenCalledWith({
        id: "group-tools",
        name: "工具",
        sortOrder: 40,
      });
    });
  });

  it("duplicates a profile-backed local terminal from the sidebar context menu", async () => {
    const user = userEvent.setup();
    const profile = {
      args: ["-NoLogo"],
      createdAt: "test",
      cwd: "C:\\dev",
      env: { TERM: "xterm-256color" },
      id: "profile-pwsh",
      isDefault: true,
      name: "PowerShell 7",
      shell: "pwsh.exe",
      sidebarGroupId: "group-default",
      sortOrder: 10,
      updatedAt: "test",
    };
    mocks.profileApi.listProfiles.mockResolvedValue([profile]);
    mocks.profileApi.createProfile.mockResolvedValue({
      ...profile,
      id: "profile-copy",
      isDefault: false,
      name: "PowerShell 7 副本",
      sortOrder: 20,
      updatedAt: "created",
    });

    render(<KerminalShell />);
    await waitFor(() =>
      expect(mocks.profileApi.listProfiles).toHaveBeenCalled(),
    );

    const localButton = await findExpandedSidebarMachine(/PowerShell 7/);
    fireEvent.contextMenu(localButton);
    await user.click(screen.getByRole("menuitem", { name: "复制主机" }));

    await waitFor(() => {
      expect(mocks.profileApi.createProfile).toHaveBeenCalledWith({
        args: ["-NoLogo"],
        cwd: "C:\\dev",
        env: { TERM: "xterm-256color" },
        name: "PowerShell 7 副本",
        setDefault: false,
        shell: "pwsh.exe",
        sidebarGroupId: "group-default",
      });
    });
    expect(
      await findExpandedSidebarMachine(/PowerShell 7 副本/),
    ).toBeInTheDocument();
  });
}
