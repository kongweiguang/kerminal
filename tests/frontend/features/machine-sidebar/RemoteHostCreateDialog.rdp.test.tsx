// @author kongweiguang

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultSshOptions, revealRemoteHostCredential, type RemoteHost } from "../../../../src/lib/remoteHostApi";
import { testRemoteConnection } from "../../../../src/lib/connectionApi";
import { RemoteHostCreateDialog } from "../../../../src/features/machine-sidebar/RemoteHostCreateDialog";
import { groups } from "../../support/machine-sidebar/RemoteHostCreateDialog.testSupport";

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

  it("saves an RDP connection to the host list with password metadata", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const savedRdpHost: RemoteHost = {
      authType: "password",
      createdAt: "now",
      groupId: "group-dev",
      host: "rdp.internal",
      id: "rdp-1",
      name: "office-rdp",
      port: 3389,
      protocol: "rdp",
      production: false,
      sshOptions: createDefaultSshOptions(),
      sortOrder: 10,
      tags: ["rdp"],
      updatedAt: "now",
      username: "administrator",
    };
    const onCreateHost = vi.fn().mockResolvedValue(savedRdpHost);
    const onCreated = vi.fn();

    render(
      <RemoteHostCreateDialog
        defaultGroupId="group-dev"
        defaultMode="rdp"
        groups={groups}
        onClose={onClose}
        onCreateHost={onCreateHost}
        onCreated={onCreated}
        open
      />,
    );

    expect(screen.getByRole("combobox", { name: "分组" })).toHaveAttribute(
      "data-value",
      "group-dev",
    );
    await user.type(screen.getByLabelText("名称"), "office-rdp");
    await user.type(screen.getByLabelText("主机"), "rdp.internal");
    await user.type(screen.getByLabelText("用户名"), "administrator");
    await user.type(screen.getByLabelText("密码"), "rdp-secret");
    await user.click(screen.getByRole("button", { name: "确认" }));

    expect(onCreateHost).toHaveBeenCalledWith({
      authType: "password",
      credentialRef: undefined,
      credentialSecret: "rdp-secret",
      groupId: "group-dev",
      host: "rdp.internal",
      name: "office-rdp",
      port: 3389,
      protocol: "rdp",
      production: false,
      tags: ["rdp"],
      username: "administrator",
    });
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(savedRdpHost));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("reveals and updates saved RDP password when editing", async () => {
    const user = userEvent.setup();
    const editingHost: RemoteHost = {
      authType: "password",
      createdAt: "now",
      credentialRef: undefined,
      secretRef: "credential:kerminal:rdp-host:rdp-1:target:password:v1",
      groupId: "group-dev",
      host: "rdp.internal",
      id: "rdp-1",
      name: "office-rdp",
      port: 3389,
      protocol: "rdp",
      production: false,
      sshOptions: createDefaultSshOptions(),
      sortOrder: 10,
      tags: ["rdp"],
      updatedAt: "now",
      username: "administrator",
    };
    const updatedHost: RemoteHost = {
      ...editingHost,
      updatedAt: "later",
    };
    const onUpdateHost = vi.fn().mockResolvedValue(updatedHost);
    const onCreated = vi.fn();
    vi.mocked(revealRemoteHostCredential).mockResolvedValueOnce({
      authType: "password",
      credentialSecret: "visible-rdp-secret",
      hostId: "rdp-1",
      status: "available",
    });

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

    const passwordInput = screen.getByLabelText("密码");
    expect(passwordInput).toHaveAttribute("type", "password");
    await waitFor(() =>
      expect(passwordInput).toHaveValue("visible-rdp-secret"),
    );
    await user.click(screen.getByRole("button", { name: "显示密码" }));
    expect(passwordInput).toHaveAttribute("type", "text");

    await user.clear(passwordInput);
    await user.type(passwordInput, "next-rdp-secret");
    await user.click(screen.getByRole("button", { name: "确认" }));

    expect(onUpdateHost).toHaveBeenCalledWith({
      authType: "password",
      credentialRef: undefined,
      credentialSecret: "next-rdp-secret",
      groupId: "group-dev",
      host: "rdp.internal",
      id: "rdp-1",
      name: "office-rdp",
      port: 3389,
      protocol: "rdp",
      production: false,
      sortOrder: 10,
      tags: ["rdp"],
      username: "administrator",
    });
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(updatedHost));
  });

  it("keeps existing RDP password auth when saving before reveal finishes", async () => {
    const user = userEvent.setup();
    const editingHost: RemoteHost = {
      authType: "password",
      createdAt: "now",
      groupId: "group-dev",
      host: "rdp.internal",
      id: "rdp-1",
      name: "office-rdp",
      port: 3389,
      protocol: "rdp",
      production: false,
      secretRef: "credential:kerminal:rdp-host:rdp-1:target:password:v1",
      sshOptions: createDefaultSshOptions(),
      sortOrder: 10,
      tags: ["rdp"],
      updatedAt: "now",
      username: "administrator",
    };
    const onUpdateHost = vi.fn().mockResolvedValue(editingHost);
    vi.mocked(revealRemoteHostCredential).mockImplementationOnce(
      () => new Promise(() => {}),
    );

    render(
      <RemoteHostCreateDialog
        editingHost={editingHost}
        groups={groups}
        onClose={vi.fn()}
        onCreateHost={vi.fn()}
        onUpdateHost={onUpdateHost}
        open
      />,
    );

    expect(screen.getByLabelText("密码")).toHaveValue("");
    await user.click(screen.getByRole("button", { name: "确认" }));

    expect(onUpdateHost).toHaveBeenCalledWith({
      authType: "password",
      credentialRef: undefined,
      credentialSecret: undefined,
      groupId: "group-dev",
      host: "rdp.internal",
      id: "rdp-1",
      name: "office-rdp",
      port: 3389,
      protocol: "rdp",
      production: false,
      sortOrder: 10,
      tags: ["rdp"],
      username: "administrator",
    });
  });

  it("does not expose file picker failures in the local connection dialog", async () => {
    const user = userEvent.setup();
    const warning = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    fileDialogApiMock.selectLocalDirectory.mockRejectedValueOnce(
      new Error("dialog_backend_failed token=local-picker-secret"),
    );

    render(
      <RemoteHostCreateDialog
        defaultMode="local"
        groups={groups}
        onClose={vi.fn()}
        onCreateHost={vi.fn()}
        onCreateLocal={vi.fn()}
        open
      />,
    );

    await user.click(screen.getByRole("button", { name: "选择工作目录" }));

    expect(await screen.findByText("无法选择工作目录，请重试。")).toBeVisible();
    expect(screen.queryByText(/dialog_backend_failed/)).not.toBeInTheDocument();
    expect(screen.queryByText(/local-picker-secret/)).not.toBeInTheDocument();
    expect(warning).toHaveBeenCalled();
    warning.mockRestore();
  });

  it("creates a group from the RDP form and keeps the form values", async () => {
    const user = userEvent.setup();
    const createdGroup = {
      createdAt: "now",
      id: "group-rdp",
      name: "远程桌面",
      sortOrder: 20,
      updatedAt: "now",
    };
    const onCreateGroup = vi.fn().mockResolvedValue(createdGroup);
    let currentDefaultGroupId: string | undefined;
    let currentGroups = groups;
    let rerenderDialog = () => {};
    const onGroupCreated = vi.fn(async () => {
      currentDefaultGroupId = createdGroup.id;
      currentGroups = [
        ...groups,
        {
          id: createdGroup.id,
          machines: [],
          title: createdGroup.name,
        },
      ];
      rerenderDialog();
    });
    const onCreateHost = vi.fn().mockResolvedValue({
      authType: "password",
      createdAt: "now",
      groupId: "group-rdp",
      host: "rdp.internal",
      id: "rdp-1",
      name: "office-rdp",
      port: 3389,
      protocol: "rdp",
      production: false,
      sshOptions: createDefaultSshOptions(),
      sortOrder: 10,
      tags: ["rdp"],
      updatedAt: "now",
      username: "administrator",
    } satisfies RemoteHost);

    const renderDialog = () => (
      <RemoteHostCreateDialog
        defaultGroupId={currentDefaultGroupId}
        defaultMode="rdp"
        groups={currentGroups}
        onClose={vi.fn()}
        onCreateGroup={onCreateGroup}
        onCreateHost={onCreateHost}
        onGroupCreated={onGroupCreated}
        open
      />
    );
    const { rerender } = render(renderDialog());
    rerenderDialog = () => rerender(renderDialog());

    await user.type(screen.getByLabelText("名称"), "office-rdp");
    await user.click(screen.getByRole("button", { name: "新建分组" }));
    expect(
      screen.getByRole("dialog", { name: "新建分组" }),
    ).toBeInTheDocument();
    await user.type(screen.getByLabelText("分组名称"), "远程桌面");
    await user.click(screen.getByRole("button", { name: "创建分组" }));

    await waitFor(() => {
      expect(onCreateGroup).toHaveBeenCalledWith({ name: "远程桌面" });
    });
    await waitFor(() => {
      expect(onGroupCreated).toHaveBeenCalledWith(createdGroup);
    });
    expect(screen.getByLabelText("名称")).toHaveValue("office-rdp");

    await user.type(screen.getByLabelText("主机"), "rdp.internal");
    await user.type(screen.getByLabelText("用户名"), "administrator");
    await user.type(screen.getByLabelText("密码"), "rdp-secret");
    await user.click(screen.getByRole("button", { name: "确认" }));

    expect(onCreateHost).toHaveBeenCalledWith({
      authType: "password",
      credentialRef: undefined,
      credentialSecret: "rdp-secret",
      groupId: "group-rdp",
      host: "rdp.internal",
      name: "office-rdp",
      port: 3389,
      production: false,
      protocol: "rdp",
      tags: ["rdp"],
      username: "administrator",
    });
  });

  it("validates RDP display options without opening the system client", async () => {
    const user = userEvent.setup();
    const onCreateHost = vi.fn();

    render(
      <RemoteHostCreateDialog
        defaultMode="rdp"
        groups={groups}
        onClose={vi.fn()}
        onCreateHost={onCreateHost}
        open
      />,
    );

    await user.type(screen.getByLabelText("名称"), "office-windowed");
    await user.type(screen.getByLabelText("主机"), "rdp.internal");
    await user.type(screen.getByLabelText("用户名"), "administrator");
    await user.click(screen.getByRole("button", { name: "显示" }));
    await user.click(screen.getByLabelText("全屏"));
    await user.clear(screen.getByLabelText("RDP 宽度"));
    await user.type(screen.getByLabelText("RDP 宽度"), "320");
    await user.clear(screen.getByLabelText("RDP 高度"));
    await user.type(screen.getByLabelText("RDP 高度"), "720");
    await user.click(screen.getByRole("button", { name: "测试连接" }));

    const validationMessage = screen.getByText(
      "RDP 窗口尺寸不能小于 640x480。",
    );
    expect(validationMessage).toBeInTheDocument();
    expect(validationMessage.closest("footer")).not.toBeNull();
    expect(testRemoteConnection).not.toHaveBeenCalled();
    expect(onCreateHost).not.toHaveBeenCalled();
  });

});
