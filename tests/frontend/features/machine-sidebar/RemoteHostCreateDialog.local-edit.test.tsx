import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDefaultSshOptions,
  revealRemoteHostCredential,
  type RemoteHost,
} from "../../../../src/lib/remoteHostApi";
import { testRemoteConnection } from "../../../../src/lib/connectionApi";
import { RemoteHostCreateDialog } from "../../../../src/features/machine-sidebar/RemoteHostCreateDialog";
import {
  chooseSelectOption,
  createdHost,
  groups,
  groupsWithSsh,
} from "../../support/machine-sidebar/RemoteHostCreateDialog.testSupport";

const fileDialogApiMock = vi.hoisted(() => ({
  selectLocalDirectory: vi.fn(),
  selectLocalFile: vi.fn(),
}));

vi.mock("../../../../src/lib/connectionApi", () => ({
  testRemoteConnection: vi.fn(),
}));

vi.mock("../../../../src/lib/fileDialogApi", () => ({
  selectLocalDirectory: fileDialogApiMock.selectLocalDirectory,
  selectLocalFile: fileDialogApiMock.selectLocalFile,
}));

vi.mock("../../../../src/lib/remoteHostApi", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../../src/lib/remoteHostApi")>();
  return {
    ...actual,
    revealRemoteHostCredential: vi.fn(),
  };
});

describe("RemoteHostCreateDialog", () => {
  beforeEach(() => {
    window.localStorage.clear();
    fileDialogApiMock.selectLocalDirectory.mockReset();
    fileDialogApiMock.selectLocalFile.mockReset();
    fileDialogApiMock.selectLocalDirectory.mockResolvedValue(null);
    fileDialogApiMock.selectLocalFile.mockResolvedValue(null);
    vi.mocked(testRemoteConnection).mockReset();
    vi.mocked(revealRemoteHostCredential).mockReset();
    vi.mocked(revealRemoteHostCredential).mockResolvedValue({
      authType: "password",
      hostId: "host-1",
      message: "没有可回显的保存凭据。",
      status: "missing",
    });
    vi.mocked(testRemoteConnection).mockResolvedValue({
      connected: true,
      latencyMs: 12,
      message: "SSH 连接测试通过：root@127.0.0.1:22（12 ms）",
      mode: "ssh",
    });
  });

  it("shows protocol-specific configuration sections", async () => {
    const user = userEvent.setup();

    render(
      <RemoteHostCreateDialog
        defaultMode="ssh"
        groups={groups}
        onClose={vi.fn()}
        onCreateHost={vi.fn()}
        open
      />,
    );

    expect(screen.getByRole("button", { name: "SSH" })).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "认证方式" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "代理" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "跳板机" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "认证" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "隧道" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "终端" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "传输" }),
    ).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText("root")).toBe(
      screen.getByLabelText("用户名"),
    );
    expect(
      screen.queryByText("SSH 密码和内联私钥会保存在主机记录里。"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("新增本地、SSH、RDP、Telnet 或 Serial 连接。"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("密码明文保存，编辑时显示。"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("密码保存在凭据保险箱中，编辑时可回显。"),
    ).toBeInTheDocument();
    const protocolBar = screen.getByRole("button", {
      name: "SSH",
    }).parentElement;
    expect(
      Array.from(protocolBar?.children ?? []).map((child) =>
        child.textContent?.trim(),
      ),
    ).toEqual(["SSH", "SFTP", "Local", "RDP", "Telnet", "Serial"]);
    expect(screen.getByLabelText("标签")).toHaveValue("");
    expect(
      screen.queryByText("多个标签可用逗号或空格分隔。"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("保存后显示在左侧。")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("生产保护")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Telnet" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Serial" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Local" }));

    expect(screen.getByRole("button", { name: "属性" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "终端" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "测试连接" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "WSL" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("combobox", { name: "Shell" }));
    expect(screen.getByRole("option", { name: "WSL" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "认证" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "RDP" }));

    expect(screen.getByRole("button", { name: "显示" })).toBeInTheDocument();
    expect(
      screen.getByText("密码保存在凭据保险箱中，编辑时可回显。"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "网关" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "本地资源" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "认证" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Telnet" }));
    expect(screen.getByRole("button", { name: "属性" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "代理" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "终端" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "测试连接" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Serial" }));
    expect(screen.getByRole("button", { name: "属性" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "串口" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "终端" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "测试连接" }),
    ).toBeInTheDocument();
  });

  it("creates a local terminal from local mode", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onCreateLocal = vi.fn();

    render(
      <RemoteHostCreateDialog
        defaultMode="local"
        groups={groups}
        onClose={onClose}
        onCreateHost={vi.fn()}
        onCreateLocal={onCreateLocal}
        open
      />,
    );

    expect(
      screen.getByRole("dialog", { name: "新建主机" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "确认" }));

    expect(onCreateLocal).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("creates a local terminal with startup overrides", async () => {
    const user = userEvent.setup();
    const onCreateLocal = vi.fn();

    render(
      <RemoteHostCreateDialog
        defaultGroupId="group-dev"
        defaultMode="local"
        groups={groups}
        onClose={vi.fn()}
        onCreateHost={vi.fn()}
        onCreateLocal={onCreateLocal}
        open
      />,
    );

    await user.type(screen.getByLabelText("会话名称"), "Dev shell");
    await chooseSelectOption(user, "Shell", "PowerShell 7");
    await user.type(
      screen.getByLabelText("工作目录"),
      "C:\\dev\\rust\\kerminal",
    );
    await user.type(screen.getByLabelText("启动参数"), "-NoLogo\n-NoExit");
    await user.click(screen.getByRole("button", { name: "终端" }));
    await user.type(
      screen.getByLabelText("环境变量"),
      "NODE_ENV=development\nKERM=test",
    );
    await user.click(screen.getByRole("button", { name: "确认" }));

    expect(onCreateLocal).toHaveBeenCalledWith({
      args: ["-NoLogo", "-NoExit"],
      cwd: "C:\\dev\\rust\\kerminal",
      env: {
        KERM: "test",
        NODE_ENV: "development",
      },
      groupId: "group-dev",
      shell: "pwsh.exe",
      title: "Dev shell",
    });
  });

  it("updates a local terminal from edit mode", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onUpdateLocal = vi.fn();

    render(
      <RemoteHostCreateDialog
        editingLocalMachine={{
          args: ["-NoLogo"],
          cwd: "C:\\dev",
          description: "pwsh.exe -NoLogo · C:\\dev",
          env: { TERM: "xterm-256color" },
          id: "profile:profile-pwsh",
          kind: "local",
          name: "Dev shell",
          profileId: "profile-pwsh",
          remoteGroupId: "group-dev",
          shell: "pwsh.exe",
          status: "offline",
          tags: ["local"],
        }}
        groups={groups}
        onClose={onClose}
        onCreateHost={vi.fn()}
        onUpdateLocal={onUpdateLocal}
        open
      />,
    );

    expect(
      screen.getByRole("dialog", { name: "编辑连接配置" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("会话名称")).toHaveValue("Dev shell");

    fireEvent.change(screen.getByLabelText("会话名称"), {
      target: { value: "Renamed local" },
    });
    fireEvent.change(screen.getByLabelText("工作目录"), {
      target: { value: "C:\\work" },
    });
    await user.click(screen.getByRole("button", { name: "终端" }));
    fireEvent.change(screen.getByLabelText("环境变量"), {
      target: { value: "NODE_ENV=test" },
    });
    await user.click(screen.getByRole("button", { name: "确认" }));

    expect(onUpdateLocal).toHaveBeenCalledWith("profile:profile-pwsh", {
      args: ["-NoLogo"],
      cwd: "C:\\work",
      env: { NODE_ENV: "test" },
      groupId: "group-dev",
      shell: "pwsh.exe",
      title: "Renamed local",
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not expose Docker as a primary add-connection protocol", () => {
    render(
      <RemoteHostCreateDialog
        defaultMode="ssh"
        groups={groupsWithSsh}
        onClose={vi.fn()}
        onCreateHost={vi.fn()}
        open
      />,
    );

    expect(
      screen.queryByRole("button", { name: "Docker" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("选择后加入侧栏。")).not.toBeInTheDocument();
  });

  it("prefills plaintext SSH password and inline private key when editing", () => {
    const passwordHost: RemoteHost = {
      ...createdHost,
      authType: "password",
      credentialRef: undefined,
      credentialSecret: "visible-password",
    };
    const { unmount } = render(
      <RemoteHostCreateDialog
        editingHost={passwordHost}
        groups={groups}
        onClose={vi.fn()}
        onCreateHost={vi.fn()}
        onUpdateHost={vi.fn()}
        open
      />,
    );

    expect(screen.getByLabelText("SSH 密码")).toHaveAttribute("type", "text");
    expect(screen.getByLabelText("SSH 密码")).toHaveValue("visible-password");

    unmount();

    render(
      <RemoteHostCreateDialog
        editingHost={{
          ...createdHost,
          authType: "key",
          credentialRef: undefined,
          credentialSecret: "-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n",
        }}
        groups={groups}
        onClose={vi.fn()}
        onCreateHost={vi.fn()}
        onUpdateHost={vi.fn()}
        open
      />,
    );

    expect(screen.getByLabelText("私钥内容")).toHaveValue(
      "-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n",
    );
  });

  it("reveals a saved vault SSH password when editing", async () => {
    vi.mocked(revealRemoteHostCredential).mockResolvedValueOnce({
      authType: "password",
      credentialSecret: "vault-visible-password",
      hostId: "host-1",
      status: "available",
    });
    const passwordHost: RemoteHost = {
      ...createdHost,
      authType: "password",
      credentialRef: undefined,
      credentialSecret: undefined,
      credentialStatus: "vault",
      secretRef: "credential:kerminal:ssh-host:host-1:target:password:v1",
    };

    render(
      <RemoteHostCreateDialog
        editingHost={passwordHost}
        groups={groups}
        onClose={vi.fn()}
        onCreateHost={vi.fn()}
        onUpdateHost={vi.fn()}
        open
      />,
    );

    expect(revealRemoteHostCredential).toHaveBeenCalledWith("host-1");
    await waitFor(() =>
      expect(screen.getByLabelText("SSH 密码")).toHaveValue(
        "vault-visible-password",
      ),
    );
  });

  it("updates an existing SSH host from the same dialog", async () => {
    const user = userEvent.setup();
    const editingHost: RemoteHost = {
      ...createdHost,
      production: true,
    };
    const updatedHost: RemoteHost = {
      ...editingHost,
      name: "ubuntu-prod",
      updatedAt: "later",
    };
    const onUpdateHost = vi.fn().mockResolvedValue(updatedHost);
    const onCreated = vi.fn();

    render(
      <RemoteHostCreateDialog
        editingHost={editingHost}
        groups={groups}
        onClose={vi.fn()}
        onCreateHost={vi.fn()}
        onCreated={onCreated}
        onUpdateHost={onUpdateHost}
        open
      />,
    );

    expect(
      screen.getByRole("dialog", { name: "编辑连接配置" }),
    ).toBeInTheDocument();

    await user.clear(screen.getByLabelText("名称"));
    await user.type(screen.getByLabelText("名称"), "ubuntu-prod");
    await user.click(screen.getByRole("button", { name: "确认" }));

    expect(onUpdateHost).toHaveBeenCalledWith({
      authType: "key",
      credentialRef: "/home/ubuntu/.ssh/id_ed25519",
      credentialSecret: undefined,
      groupId: "group-dev",
      host: "172.16.41.60",
      id: "host-1",
      name: "ubuntu-prod",
      port: 22,
      production: true,
      protocol: "ssh",
      sshOptions: createDefaultSshOptions(),
      sortOrder: 10,
      tags: ["ssh", "ubuntu"],
      username: "ubuntu",
    });
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(updatedHost));
  });

  it("keeps the edit draft and blocks saving after an external host change", async () => {
    const user = userEvent.setup();
    const editingHost: RemoteHost = {
      ...createdHost,
      updatedAt: "1",
    };
    const onUpdateHost = vi.fn();
    const conflictMessage = "cfg: host changed externally; close + reopen";
    const { rerender } = render(
      <RemoteHostCreateDialog
        editingHost={editingHost}
        groups={groupsWithSsh}
        onClose={vi.fn()}
        onCreateHost={vi.fn()}
        onUpdateHost={onUpdateHost}
        open
      />,
    );

    await user.clear(screen.getByLabelText("名称"));
    await user.type(screen.getByLabelText("名称"), "draft-name");

    rerender(
      <RemoteHostCreateDialog
        editingHost={editingHost}
        externalConfigConflict={conflictMessage}
        groups={[
          groupsWithSsh[0],
          {
            ...groupsWithSsh[1],
            machines: groupsWithSsh[1].machines.map((machine) =>
              machine.id === editingHost.id
                ? { ...machine, name: "external-name", updatedAt: "2" }
                : machine,
            ),
          },
        ]}
        onClose={vi.fn()}
        onCreateHost={vi.fn()}
        onUpdateHost={onUpdateHost}
        open
      />,
    );

    expect(screen.getByLabelText("名称")).toHaveValue("draft-name");
    const conflictNotice = screen.getByRole("status");
    expect(conflictNotice).toHaveTextContent("连接配置已在外部更新");
    const technicalDetail = screen.getByText(conflictMessage);
    expect(technicalDetail.closest("details")).not.toHaveAttribute("open");
    expect(conflictNotice.closest("footer")).not.toBeNull();
    expect(screen.getByRole("button", { name: "确认" })).toBeDisabled();
    expect(onUpdateHost).not.toHaveBeenCalled();
  });


});
