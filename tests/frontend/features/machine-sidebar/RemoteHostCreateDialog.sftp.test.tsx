// @author kongweiguang

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RemoteHostCreateDialog } from "../../../../src/features/machine-sidebar/RemoteHostCreateDialog";
import { testRemoteConnection } from "../../../../src/lib/connectionApi";
import {
  createDefaultSshOptions,
  revealRemoteHostCredential,
  type RemoteHost,
} from "../../../../src/lib/remoteHostApi";
import {
  chooseSelectOption,
  groups,
} from "../../support/machine-sidebar/RemoteHostCreateDialog.testSupport";

vi.mock("../../../../src/lib/connectionApi", () => ({
  testRemoteConnection: vi.fn(),
}));

vi.mock("../../../../src/lib/fileDialogApi", () => ({
  selectLocalDirectory: vi.fn(async () => null),
  selectLocalFile: vi.fn(async () => null),
}));

vi.mock("../../../../src/lib/remoteHostApi", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../../src/lib/remoteHostApi")>();
  return {
    ...actual,
    revealRemoteHostCredential: vi.fn(),
  };
});

describe("RemoteHostCreateDialog SFTP host", () => {
  beforeEach(() => {
    vi.mocked(testRemoteConnection).mockReset();
    vi.mocked(revealRemoteHostCredential).mockReset();
  });

  it("creates a file-only SFTP host without terminal or tunnel settings", async () => {
    const user = userEvent.setup();
    const savedHost: RemoteHost = {
      authType: "agent",
      createdAt: "now",
      groupId: "group-dev",
      host: "files.internal",
      id: "sftp-1",
      name: "files-only",
      port: 22,
      production: true,
      protocol: "sftp",
      sortOrder: 10,
      sshOptions: createDefaultSshOptions(),
      tags: ["files"],
      updatedAt: "now",
      username: "upload",
    };
    const onCreateHost = vi.fn().mockResolvedValue(savedHost);

    render(
      <RemoteHostCreateDialog
        defaultGroupId="group-dev"
        defaultMode="sftp"
        groups={groups}
        onClose={vi.fn()}
        onCreateHost={onCreateHost}
        open
      />,
    );

    expect(screen.getByText(/仅用于文件浏览与传输/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "终端" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "隧道" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "传输" })).toBeVisible();

    await user.type(screen.getByLabelText("名称"), "files-only");
    await user.type(screen.getByLabelText("主机"), "files.internal");
    await user.type(screen.getByLabelText("用户名"), "upload");
    await user.type(screen.getByLabelText("标签"), "files");
    await chooseSelectOption(user, "认证方式", "SSH Agent");
    await user.click(screen.getByLabelText("生产主机"));
    await user.click(screen.getByRole("button", { name: "确认" }));

    expect(onCreateHost).toHaveBeenCalledWith({
      authType: "agent",
      credentialRef: undefined,
      credentialSecret: undefined,
      groupId: "group-dev",
      host: "files.internal",
      name: "files-only",
      port: 22,
      production: true,
      protocol: "sftp",
      sshOptions: createDefaultSshOptions(),
      tags: ["files"],
      username: "upload",
    });
  });

  it("tests the SFTP subsystem instead of an SSH terminal", async () => {
    const user = userEvent.setup();
    vi.mocked(testRemoteConnection).mockResolvedValue({
      connected: true,
      latencyMs: 15,
      message: "SFTP 连接测试通过",
      mode: "sftp",
    });

    render(
      <RemoteHostCreateDialog
        defaultMode="sftp"
        groups={groups}
        onClose={vi.fn()}
        onCreateHost={vi.fn()}
        open
      />,
    );
    await user.type(screen.getByLabelText("名称"), "files-only");
    await user.type(screen.getByLabelText("主机"), "files.internal");
    await user.type(screen.getByLabelText("用户名"), "upload");
    await chooseSelectOption(user, "认证方式", "SSH Agent");
    await user.click(screen.getByRole("button", { name: "测试连接" }));

    await waitFor(() => expect(testRemoteConnection).toHaveBeenCalled());
    expect(vi.mocked(testRemoteConnection).mock.calls[0]?.[0]).toMatchObject({
      host: { protocol: "sftp" },
      mode: "sftp",
    });
  });
});
