// @author kongweiguang

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { testRemoteConnection } from "../../../../src/lib/connectionApi";
import {
  createDefaultSshOptions,
  revealRemoteHostCredential,
} from "../../../../src/lib/remoteHostApi";
import { RemoteHostCreateDialog } from "../../../../src/features/machine-sidebar/RemoteHostCreateDialog";
import {
  chooseSelectOption,
  createdHost,
  groups,
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
  const actual = await importOriginal<typeof import("../../../../src/lib/remoteHostApi")>();
  return {
    ...actual,
    revealRemoteHostCredential: vi.fn(),
  };
});

describe("RemoteHostCreateDialog SSH terminal settings", () => {
  beforeEach(() => {
    fileDialogApiMock.selectLocalDirectory.mockReset();
    fileDialogApiMock.selectLocalFile.mockReset();
    vi.mocked(testRemoteConnection).mockReset();
    vi.mocked(revealRemoteHostCredential).mockReset();
  });

  it("exposes only effective terminal settings and saves them", async () => {
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

    await user.type(screen.getByLabelText("名称"), "keepalive-dev");
    await user.type(screen.getByLabelText("主机"), "127.0.0.1");
    await user.type(screen.getByLabelText("用户名"), "root");
    await chooseSelectOption(user, "认证方式", "SSH Agent");

    expect(screen.getByRole("button", { name: "属性" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "代理" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "跳板机" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "终端" }));

    expect(screen.getByLabelText("SSH TERM")).toBeInTheDocument();
    expect(screen.getByLabelText("连接超时时间")).toHaveValue("30");
    expect(screen.getByLabelText("心跳间隔")).toHaveValue("60");
    expect(screen.getByLabelText("SSH 默认目录")).toBeInTheDocument();
    expect(screen.queryByLabelText("SSH 编码")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("SSH 键盘方案")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Alt 键修饰")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("SSH 退格键")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("SSH Delete 键")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("SSH 启动命令")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("SSH 环境变量")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("SSH 登录脚本")).not.toBeInTheDocument();

    await chooseSelectOption(user, "SSH TERM", "vt100");
    const timeoutInput = screen.getByLabelText("连接超时时间");
    await user.clear(timeoutInput);
    await user.type(timeoutInput, "45");
    const keepaliveInput = screen.getByLabelText("心跳间隔");
    await user.clear(keepaliveInput);
    await user.type(keepaliveInput, "20");
    await user.type(screen.getByLabelText("SSH 默认目录"), "/srv/app");
    await user.click(screen.getByRole("button", { name: "确认" }));

    await waitFor(() => expect(onCreateHost).toHaveBeenCalledWith({
      authType: "agent",
      credentialRef: undefined,
      credentialSecret: undefined,
      groupId: undefined,
      host: "127.0.0.1",
      name: "keepalive-dev",
      port: 22,
      protocol: "ssh",
      sshOptions: {
        ...createDefaultSshOptions(),
        terminal: {
          ...createDefaultSshOptions().terminal,
          connectTimeoutSeconds: 45,
          keepaliveSeconds: 20,
          startupCommand: "/srv/app",
          terminalType: "vt100",
        },
      },
      tags: [],
      username: "root",
    }));
  });
});
