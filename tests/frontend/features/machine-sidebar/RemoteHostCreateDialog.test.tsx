// @author kongweiguang

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

  it("creates an SSH host from the form", async () => {
    const user = userEvent.setup();
    const onCreateHost = vi.fn().mockResolvedValue(createdHost);
    const onCreated = vi.fn();

    render(
      <RemoteHostCreateDialog
        defaultGroupId="group-dev"
        defaultMode="ssh"
        groups={groups}
        onClose={vi.fn()}
        onCreateHost={onCreateHost}
        onCreated={onCreated}
        open
      />,
    );

    await user.type(screen.getByLabelText("名称"), "ubuntu-dev");
    await user.type(screen.getByLabelText("主机"), "172.16.41.60");
    await user.type(screen.getByLabelText("用户名"), "ubuntu");
    await user.clear(screen.getByLabelText("标签"));
    await user.type(screen.getByLabelText("标签"), "ssh, ubuntu");
    await chooseSelectOption(user, "认证方式", "密钥");
    fireEvent.change(screen.getByLabelText("私钥路径"), {
      target: { value: "/home/ubuntu/.ssh/id_ed25519" },
    });
    await user.click(screen.getByRole("button", { name: "确认" }));

    expect(onCreateHost).toHaveBeenCalledWith({
      authType: "key",
      credentialRef: "/home/ubuntu/.ssh/id_ed25519",
      credentialSecret: undefined,
      groupId: "group-dev",
      host: "172.16.41.60",
      name: "ubuntu-dev",
      port: 22,
      production: false,
      protocol: "ssh",
      sshOptions: createDefaultSshOptions(),
      tags: ["ssh", "ubuntu"],
      username: "ubuntu",
    });
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(createdHost));
  });

  it("saves and tests an encrypted SSH private key with its passphrase", async () => {
    const user = userEvent.setup();
    const onCreateHost = vi.fn().mockResolvedValue(createdHost);

    render(
      <RemoteHostCreateDialog
        defaultMode="ssh"
        groups={groups}
        onClose={vi.fn()}
        onCreateHost={onCreateHost}
        open
      />,
    );

    await user.type(screen.getByLabelText("名称"), "encrypted-key-host");
    await user.type(screen.getByLabelText("主机"), "10.0.0.20");
    await user.type(screen.getByLabelText("用户名"), "deploy");
    await chooseSelectOption(user, "认证方式", "密钥");
    await user.type(screen.getByLabelText("私钥路径"), "/home/deploy/.ssh/id_ed25519");

    const passphraseInput = screen.getByLabelText("私钥口令");
    expect(passphraseInput).toHaveAttribute("type", "password");
    await user.type(passphraseInput, " key passphrase ");
    await user.click(screen.getByRole("button", { name: "显示私钥口令" }));
    expect(passphraseInput).toHaveAttribute("type", "text");

    await user.click(screen.getByRole("button", { name: "测试连接" }));
    await waitFor(() =>
      expect(testRemoteConnection).toHaveBeenCalledWith({
        host: expect.objectContaining({
          authType: "key",
          keyPassphraseSecret: " key passphrase ",
        }),
        mode: "ssh",
      }),
    );

    await user.click(screen.getByRole("button", { name: "确认" }));
    expect(onCreateHost).toHaveBeenCalledWith(
      expect.objectContaining({
        authType: "key",
        credentialRef: "/home/deploy/.ssh/id_ed25519",
        keyPassphraseSecret: " key passphrase ",
      }),
    );
  });

  it("fills the SSH private key path from the local file picker", async () => {
    const user = userEvent.setup();
    fileDialogApiMock.selectLocalFile.mockResolvedValueOnce(
      "C:\\Users\\dev\\.ssh\\id_ed25519",
    );

    render(
      <RemoteHostCreateDialog
        defaultMode="ssh"
        groups={groups}
        onClose={vi.fn()}
        onCreateHost={vi.fn()}
        open
      />,
    );

    await chooseSelectOption(user, "认证方式", "密钥");
    fireEvent.change(screen.getByLabelText("私钥内容"), {
      target: { value: "-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n" },
    });

    await user.click(
      screen.getByRole("button", { name: "Choose private key file" }),
    );

    await waitFor(() => {
      expect(fileDialogApiMock.selectLocalFile).toHaveBeenCalledTimes(1);
      expect(screen.getByLabelText("私钥路径")).toHaveValue(
        "C:\\Users\\dev\\.ssh\\id_ed25519",
      );
    });
    expect(screen.getByLabelText("私钥内容")).toHaveValue("");
  });

  it("does not expose private key picker failures", async () => {
    const user = userEvent.setup();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    fileDialogApiMock.selectLocalFile.mockRejectedValueOnce(
      new Error("private_key_dialog_failed token=private-key-picker-secret"),
    );

    render(
      <RemoteHostCreateDialog
        defaultMode="ssh"
        groups={groups}
        onClose={vi.fn()}
        onCreateHost={vi.fn()}
        open
      />,
    );

    await chooseSelectOption(user, "认证方式", "密钥");
    await user.click(
      screen.getByRole("button", { name: "Choose private key file" }),
    );

    expect(await screen.findByText("无法选择私钥文件，请重试。")).toBeVisible();
    expect(screen.queryByText(/private_key_dialog_failed/)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/private-key-picker-secret/),
    ).not.toBeInTheDocument();
    expect(warning).toHaveBeenCalled();
    warning.mockRestore();
  });

  it("shows SSH authentication methods as password, key, then SSH agent", async () => {
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

    const authSelect = screen.getByRole("combobox", { name: "认证方式" });
    expect(authSelect).toHaveAttribute("data-value", "password");
    expect(authSelect).toHaveTextContent("密码");

    await user.click(authSelect);
    const options = screen.getAllByRole("option");

    expect(options).toHaveLength(3);
    expect(options[0]).toHaveTextContent(/^密码/);
    expect(options[1]).toHaveTextContent(/^密钥/);
    expect(options[2]).toHaveTextContent(/^SSH Agent/);
  });

  it("shows validation errors instead of saving incomplete hosts", async () => {
    const user = userEvent.setup();
    const onCreateHost = vi.fn();

    render(
      <RemoteHostCreateDialog
        defaultMode="ssh"
        groups={groups}
        onClose={vi.fn()}
        onCreateHost={onCreateHost}
        open
      />,
    );

    await user.click(screen.getByRole("button", { name: "确认" }));

    const validationMessage = screen.getByText("请输入主机名称。");
    expect(validationMessage).toBeInTheDocument();
    expect(validationMessage.closest("footer")).not.toBeNull();
    expect(onCreateHost).not.toHaveBeenCalled();
  });

  it("runs a backend connection test for the current SSH form", async () => {
    const user = userEvent.setup();
    const onCreateHost = vi.fn();

    render(
      <RemoteHostCreateDialog
        defaultMode="ssh"
        groups={groups}
        onClose={vi.fn()}
        onCreateHost={onCreateHost}
        open
      />,
    );

    await user.type(screen.getByLabelText("名称"), "test-dev");
    await user.type(screen.getByLabelText("主机"), "127.0.0.1");
    await user.type(screen.getByLabelText("用户名"), "root");
    await chooseSelectOption(user, "认证方式", "SSH Agent");
    await user.click(screen.getByRole("button", { name: "测试连接" }));

    await waitFor(() => {
      expect(testRemoteConnection).toHaveBeenCalledWith({
        host: {
          authType: "agent",
          credentialRef: undefined,
          credentialSecret: undefined,
          groupId: undefined,
          host: "127.0.0.1",
          name: "test-dev",
          port: 22,
          production: false,
          protocol: "ssh",
          sshOptions: createDefaultSshOptions(),
          tags: [],
          username: "root",
        },
        mode: "ssh",
      });
    });
    const successMessage = await screen.findByText(
      "SSH 连接测试通过：root@127.0.0.1:22（12 ms）",
    );
    expect(successMessage).toBeInTheDocument();
    expect(successMessage.closest("footer")).not.toBeNull();
    expect(onCreateHost).not.toHaveBeenCalled();
  });

  it("keeps raw connection failures collapsed behind a recovery message", async () => {
    const user = userEvent.setup();
    vi.mocked(testRemoteConnection).mockRejectedValueOnce(
      new Error(
        "ssh_channel_open_failed credential_broker token=host-internal-secret",
      ),
    );

    render(
      <RemoteHostCreateDialog
        defaultMode="ssh"
        groups={groups}
        onClose={vi.fn()}
        onCreateHost={vi.fn()}
        open
      />,
    );

    await user.type(screen.getByLabelText("名称"), "test-dev");
    await user.type(screen.getByLabelText("主机"), "127.0.0.1");
    await user.type(screen.getByLabelText("用户名"), "root");
    await chooseSelectOption(user, "认证方式", "SSH Agent");
    await user.click(screen.getByRole("button", { name: "测试连接" }));

    expect(await screen.findByText("连接测试失败")).toBeVisible();
    expect(
      screen.getByText("请检查地址、网络和认证信息后重试。"),
    ).toBeVisible();
    const technicalDetail = screen.getByText(/ssh_channel_open_failed/);
    expect(technicalDetail.closest("details")).not.toHaveAttribute("open");
    expect(screen.queryByText(/host-internal-secret/)).not.toBeInTheDocument();

    await user.click(screen.getByText("技术详情"));

    expect(technicalDetail.closest("details")).toHaveAttribute("open");
  });

  it("passes plaintext password secrets for SSH authentication", async () => {
    const user = userEvent.setup();
    const onCreateHost = vi.fn().mockResolvedValue({
      ...createdHost,
      authType: "password",
      credentialSecret: "s3cr3t",
    } satisfies RemoteHost);

    render(
      <RemoteHostCreateDialog
        defaultMode="ssh"
        groups={groups}
        onClose={vi.fn()}
        onCreateHost={onCreateHost}
        open
      />,
    );

    await user.type(screen.getByLabelText("名称"), "password-dev");
    await user.type(screen.getByLabelText("主机"), "10.0.0.9");
    await user.type(screen.getByLabelText("用户名"), "deploy");
    await chooseSelectOption(user, "认证方式", "密码");
    expect(screen.queryByLabelText("SSH 密码凭据引用")).not.toBeInTheDocument();
    const passwordInput = screen.getByLabelText("SSH 密码");
    expect(passwordInput).toHaveAttribute("type", "password");
    await user.click(screen.getByRole("button", { name: "显示 SSH 密码" }));
    expect(passwordInput).toHaveAttribute("type", "text");
    await user.click(screen.getByRole("button", { name: "隐藏 SSH 密码" }));
    expect(passwordInput).toHaveAttribute("type", "password");
    await user.type(passwordInput, "s3cr3t");
    await user.click(screen.getByRole("button", { name: "确认" }));

    expect(onCreateHost).toHaveBeenCalledWith({
      authType: "password",
      credentialRef: undefined,
      credentialSecret: "s3cr3t",
      groupId: undefined,
      host: "10.0.0.9",
      name: "password-dev",
      port: 22,
      production: false,
      protocol: "ssh",
      sshOptions: createDefaultSshOptions(),
      tags: [],
      username: "deploy",
    });
  });

  it("creates an SSH host without a group when no real group is available", async () => {
    const user = userEvent.setup();
    const onCreateHost = vi.fn().mockResolvedValue({
      ...createdHost,
      groupId: undefined,
    });

    render(
      <RemoteHostCreateDialog
        defaultMode="ssh"
        groups={[]}
        onClose={vi.fn()}
        onCreateHost={onCreateHost}
        open
      />,
    );

    expect(screen.getByRole("combobox", { name: "分组" })).toHaveAttribute(
      "data-value",
      "",
    );

    await user.type(screen.getByLabelText("名称"), "ungrouped-dev");
    await user.type(screen.getByLabelText("主机"), "10.0.0.8");
    await user.type(screen.getByLabelText("用户名"), "ubuntu");
    await chooseSelectOption(user, "认证方式", "SSH Agent");
    await user.click(screen.getByRole("button", { name: "确认" }));

    expect(onCreateHost).toHaveBeenCalledWith({
      authType: "agent",
      credentialRef: undefined,
      credentialSecret: undefined,
      groupId: undefined,
      host: "10.0.0.8",
      name: "ungrouped-dev",
      port: 22,
      production: false,
      protocol: "ssh",
      sshOptions: createDefaultSshOptions(),
      tags: [],
      username: "ubuntu",
    });
  });

  it("saves production-grade SSH proxy and jump options", async () => {
    const user = userEvent.setup();
    const onCreateHost = vi.fn().mockResolvedValue(createdHost);
    const defaultSshOptions = createDefaultSshOptions();

    render(
      <RemoteHostCreateDialog
        defaultGroupId="group-dev"
        defaultMode="ssh"
        groups={groups}
        onClose={vi.fn()}
        onCreateHost={onCreateHost}
        open
      />,
    );

    await user.type(screen.getByLabelText("名称"), "prod-edge");
    await user.type(screen.getByLabelText("主机"), "10.1.2.3");
    await user.type(screen.getByLabelText("用户名"), "deploy");
    await chooseSelectOption(user, "认证方式", "SSH Agent");

    await user.click(screen.getByRole("button", { name: "代理" }));
    await chooseSelectOption(user, "代理协议", "SOCKS5");
    await user.type(screen.getByLabelText("代理主机"), "proxy.internal");
    fireEvent.change(screen.getByLabelText("代理端口"), {
      target: { value: "1080" },
    });
    await user.type(screen.getByLabelText("代理用户名"), "proxy-user");
    await user.click(screen.getByRole("button", { name: "跳板机" }));
    await user.type(screen.getByLabelText("跳板机名称"), "bastion");
    await user.type(screen.getByLabelText("跳板机主机"), "bastion.internal");
    await user.type(screen.getByLabelText("跳板机用户名"), "ops");
    expect(screen.queryByLabelText("跳板机凭据引用")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "添加跳板机" }));

    await user.click(screen.getByRole("button", { name: "确认" }));

    expect(onCreateHost).toHaveBeenCalledWith({
      authType: "agent",
      credentialRef: undefined,
      credentialSecret: undefined,
      groupId: "group-dev",
      host: "10.1.2.3",
      name: "prod-edge",
      port: 22,
      production: false,
      protocol: "ssh",
      sshOptions: {
        ...defaultSshOptions,
        jumpHosts: [
          {
            authType: "agent",
            credentialRef: undefined,
            credentialSecret: undefined,
            host: "bastion.internal",
            name: "bastion",
            port: 22,
            username: "ops",
          },
        ],
        proxy: {
          credentialRef: undefined,
          host: "proxy.internal",
          port: 1080,
          protocol: "socks5",
          username: "proxy-user",
        },
        transfer: defaultSshOptions.transfer,
        tunnels: [],
      },
      tags: [],
      username: "deploy",
    });
  });

  it("fills a jump host from an existing SSH host", async () => {
    const user = userEvent.setup();
    const onCreateHost = vi.fn().mockResolvedValue(createdHost);

    render(
      <RemoteHostCreateDialog
        defaultGroupId="group-dev"
        defaultMode="ssh"
        groups={groupsWithSsh}
        onClose={vi.fn()}
        onCreateHost={onCreateHost}
        open
      />,
    );

    await user.type(screen.getByLabelText("名称"), "app-prod");
    await user.type(screen.getByLabelText("主机"), "10.2.3.4");
    await user.type(screen.getByLabelText("用户名"), "deploy");
    await chooseSelectOption(user, "认证方式", "SSH Agent");

    await user.click(screen.getByRole("button", { name: "跳板机" }));
    const jumpHostSearch = screen.getByRole("combobox", {
      name: "已有跳板机主机",
    });
    await user.type(jumpHostSearch, "10.0.0.8");
    expect(screen.queryByRole("option", { name: /ubuntu-dev/ })).toBeNull();
    await user.click(screen.getByRole("option", { name: /db-prod/ }));

    expect(screen.getByLabelText("跳板机名称")).toHaveValue("db-prod");
    expect(screen.getByLabelText("跳板机主机")).toHaveValue("10.0.0.8");
    expect(screen.getByLabelText("跳板机端口")).toHaveValue("22");
    expect(screen.getByLabelText("跳板机用户名")).toHaveValue("root");
    expect(
      screen.getByRole("combobox", { name: "跳板机认证方式" }),
    ).toHaveAttribute("data-value", "agent");

    await chooseSelectOption(user, "跳板机认证方式", "密码");
    const jumpPasswordInput = screen.getByLabelText("跳板机密码");
    expect(jumpPasswordInput).toHaveAttribute("type", "password");
    await user.type(jumpPasswordInput, "jump-secret");
    await user.click(
      screen.getByRole("button", { name: "显示跳板机密码" }),
    );
    expect(jumpPasswordInput).toHaveAttribute("type", "text");
    await chooseSelectOption(user, "跳板机认证方式", "SSH Agent");

    await user.click(screen.getByRole("button", { name: "添加跳板机" }));
    await user.click(screen.getByRole("button", { name: "确认" }));

    expect(onCreateHost).toHaveBeenCalledWith({
      authType: "agent",
      credentialRef: undefined,
      credentialSecret: undefined,
      groupId: "group-dev",
      host: "10.2.3.4",
      name: "app-prod",
      port: 22,
      production: false,
      protocol: "ssh",
      sshOptions: {
        ...createDefaultSshOptions(),
        jumpHosts: [
          {
            authType: "agent",
            credentialRef: undefined,
            credentialSecret: undefined,
            host: "10.0.0.8",
            name: "db-prod",
            port: 22,
            username: "root",
          },
        ],
      },
      tags: [],
      username: "deploy",
    });
  });


});
