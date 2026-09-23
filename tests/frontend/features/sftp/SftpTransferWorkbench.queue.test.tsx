// @author kongweiguang

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SftpTransferWorkbench } from "../../../../src/features/sftp/SftpTransferWorkbench";
import type { MachineGroup } from "../../../../src/features/workspace/types";
import type { SftpClipboard } from "../../../../src/features/sftp/SftpToolContent";
import type { SftpTransferTarget } from "../../../../src/features/sftp/sftp-tool-content/types";
import type { SftpTransferSummary } from "../../../../src/lib/sftpApi";

const sftpApiMock = vi.hoisted(() => ({
  cancelSftpTransfer: vi.fn(),
  clearCompletedSftpTransfers: vi.fn(),
  enqueueSftpTransfer: vi.fn(),
  listSftpTransfers: vi.fn(),
  retrySftpTransfer: vi.fn(),
}));

const fileDialogApiMock = vi.hoisted(() => ({
  listLocalDirectory: vi.fn(),
  openLocalDirectory: vi.fn(),
  selectLocalDirectory: vi.fn(),
}));

vi.mock("../../../../src/lib/sftpApi", () => ({
  cancelSftpTransfer: sftpApiMock.cancelSftpTransfer,
  clearCompletedSftpTransfers: sftpApiMock.clearCompletedSftpTransfers,
  enqueueSftpTransfer: sftpApiMock.enqueueSftpTransfer,
  listSftpTransfers: sftpApiMock.listSftpTransfers,
  retrySftpTransfer: sftpApiMock.retrySftpTransfer,
}));

vi.mock("../../../../src/lib/fileDialogApi", () => ({
  listLocalDirectory: fileDialogApiMock.listLocalDirectory,
  openLocalDirectory: fileDialogApiMock.openLocalDirectory,
  selectLocalDirectory: fileDialogApiMock.selectLocalDirectory,
}));

vi.mock("../../../../src/features/sftp/SftpToolContent", () => ({
  SftpToolContent: ({
    active,
    compactHeader,
    onCurrentPathChange,
    onSftpClipboardChange,
    selectedMachine,
    showLocalTransferActions,
    showTransferStatusBar,
    sftpClipboard,
    transferTarget,
    transferViewScope,
  }: {
    active: boolean;
    compactHeader?: boolean;
    onCurrentPathChange?: (path: string) => void;
    onSftpClipboardChange: (clipboard: SftpClipboard | null) => void;
    selectedMachine: { id: string; name: string };
    showLocalTransferActions?: boolean;
    showTransferStatusBar?: boolean;
    sftpClipboard: SftpClipboard | null;
    transferTarget?: SftpTransferTarget;
    transferViewScope?: string | null;
  }) => {
    const transferTargetLabel =
      transferTarget?.kind === "local"
        ? `${transferTarget.side}:${transferTarget.localPath}`
        : transferTarget?.kind === "remote"
          ? `${transferTarget.side}:${transferTarget.hostLabel}:${transferTarget.remotePath}`
          : "none";

    return (
      <div aria-label={`SFTP 面板 ${selectedMachine.name}`}>
        <span>active:{String(active)}</span>
        <span>compact:{String(compactHeader)}</span>
        <span>local-actions:{String(showLocalTransferActions)}</span>
        <span>transfer-status:{String(showTransferStatusBar)}</span>
        <span>transfer-scope:{transferViewScope ?? "none"}</span>
        <span>transfer-target:{transferTargetLabel}</span>
        <span>clipboard:{sftpClipboard?.sourceHostId ?? "empty"}</span>
        <button
          onClick={() =>
            onSftpClipboardChange({
              copiedAt: 1,
              entries: [{ kind: "file", name: "app.log", path: "/tmp/app.log" }],
              sourceHostId: selectedMachine.id,
              sourceHostLabel: selectedMachine.name,
            })
          }
          type="button"
        >
          复制 {selectedMachine.name}
        </button>
        <button
          onClick={() => onCurrentPathChange?.(`/srv/${selectedMachine.name}`)}
          type="button"
        >
          报告路径 {selectedMachine.name}
        </button>
      </div>
    );
  },
}));

const groups: MachineGroup[] = [
  {
    id: "group-main",
    machines: [
      {
        description: "root@left.internal:22",
        id: "host-left",
        kind: "ssh",
        name: "left",
        status: "offline",
        tags: ["ssh"],
      },
      {
        description: "root@right.internal:22",
        id: "host-right",
        kind: "ssh",
        name: "right",
        status: "offline",
        tags: ["ssh"],
      },
      {
        description: "root@backup.internal:22",
        id: "host-backup",
        kind: "ssh",
        name: "backup",
        status: "offline",
        tags: ["ssh"],
      },
    ],
    title: "主机",
  },
];

const groupsWithoutRightHost: MachineGroup[] = [
  {
    id: "group-main",
    machines: [
      {
        description: "root@left.internal:22",
        id: "host-left",
        kind: "ssh",
        name: "left",
        status: "offline",
        tags: ["ssh"],
      },
      {
        description: "local profile using a stale host id",
        id: "host-right",
        kind: "local",
        name: "stale local right",
        status: "offline",
        tags: ["local"],
      },
      {
        description: "root@backup.internal:22",
        id: "host-backup",
        kind: "ssh",
        name: "backup",
        status: "offline",
        tags: ["ssh"],
      },
    ],
    title: "主机",
  },
];

const groupsWithoutSshHosts: MachineGroup[] = [
  {
    id: "group-local",
    machines: [
      {
        description: "local profile using a stale host id",
        id: "host-right",
        kind: "local",
        name: "stale local right",
        status: "offline",
        tags: ["local"],
      },
    ],
    title: "本地",
  },
];const runningTransfer: SftpTransferSummary = {
  bytesTransferred: 512,
  cancelRequested: false,
  createdAt: 20,
  direction: "upload",
  hostId: "host-right",
  id: "transfer-running",
  kind: "file",
  localPath: "sftp://host-left/tmp/app.log",
  operation: "remoteCopy",
  remotePath: "/var/log/app.log",
  source: {
    hostId: "host-left",
    hostLabel: "left",
    kind: "remote",
    path: "/tmp/app.log",
  },
  status: "running",
  target: {
    hostId: "host-right",
    hostLabel: "right",
    kind: "remote",
    path: "/var/log/app.log",
  },
  totalBytes: 1024,
  transportMode: "clientBridge",
  updatedAt: 21,
};

const succeededTransfer: SftpTransferSummary = {
  ...runningTransfer,
  bytesTransferred: 1024,
  id: "transfer-succeeded",
  localPath: "sftp://host-left/tmp/done.log",
  remotePath: "/var/log/done.log",
  source: {
    hostId: "host-left",
    hostLabel: "left",
    kind: "remote",
    path: "/tmp/done.log",
  },
  status: "succeeded",
  target: {
    hostId: "host-right",
    hostLabel: "right",
    kind: "remote",
    path: "/var/log/done.log",
  },
  updatedAt: 22,
};

const failedTransfer: SftpTransferSummary = {
  ...runningTransfer,
  conflictPolicy: "overwrite",
  direction: "download",
  id: "transfer-failed",
  localPath: "C:\\\\Downloads\\\\failed.log",
  operation: "download",
  remotePath: "/var/log/failed.log",
  source: {
    hostId: "host-right",
    hostLabel: "right",
    kind: "remote",
    path: "/var/log/failed.log",
  },
  status: "failed",
  target: {
    kind: "local",
    path: "C:\\\\Downloads\\\\failed.log",
  },
  transportMode: "singleHostSftp",
};

const localListing = {
  entries: [
    {
      kind: "directory" as const,
      modified: "1771351200",
      name: ".codex",
      path: "C:\\Users\\24052\\.codex",
      raw: "directory C:\\Users\\24052\\.codex",
    },
    {
      kind: "file" as const,
      modified: "1771351200",
      name: "notes.md",
      path: "C:\\Users\\24052\\notes.md",
      raw: "file C:\\Users\\24052\\notes.md",
      size: 2048,
    },
  ],
  parentPath: "C:\\Users",
  path: "C:\\Users\\24052",
};

describe("SftpTransferWorkbench", () => {
  beforeEach(() => {
    sftpApiMock.cancelSftpTransfer.mockReset();
    sftpApiMock.clearCompletedSftpTransfers.mockReset();
    sftpApiMock.enqueueSftpTransfer.mockReset();
    sftpApiMock.listSftpTransfers.mockReset();
    sftpApiMock.retrySftpTransfer.mockReset();
    fileDialogApiMock.listLocalDirectory.mockReset();
    fileDialogApiMock.openLocalDirectory.mockReset();
    fileDialogApiMock.selectLocalDirectory.mockReset();
    sftpApiMock.listSftpTransfers.mockResolvedValue([]);
    fileDialogApiMock.listLocalDirectory.mockResolvedValue(localListing);
    sftpApiMock.cancelSftpTransfer.mockResolvedValue({
      ...runningTransfer,
      cancelRequested: true,
      status: "canceled",
    });
    sftpApiMock.clearCompletedSftpTransfers.mockResolvedValue([]);
    sftpApiMock.enqueueSftpTransfer.mockResolvedValue({
      ...failedTransfer,
      id: "transfer-retried",
      status: "queued",
    });
    sftpApiMock.retrySftpTransfer.mockResolvedValue({
      ...failedTransfer,
      id: "transfer-retried",
      status: "queued",
    });
  });

  it("keeps a locked source host tab while activating the initial right host", () => {
    render(
      <SftpTransferWorkbench
        groups={groups}
        initialRightHostId="host-right"
        lockedLeftHostId="host-left"
      />,
    );

    expect(screen.getByLabelText("SFTP 面板 right")).toBeInTheDocument();
    expect(screen.getByText("目标：right:/")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /left.*固定/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "right" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("reconciles removed and non-SSH host tabs to the remaining SSH tab", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <SftpTransferWorkbench
        groups={groups}
        initialRightHostId="host-right"
      />,
    );

    await user.click(
      screen.getByRole("combobox", { name: "添加右侧服务器" }),
    );
    await user.click(screen.getByRole("option", { name: "backup" }));
    await user.click(screen.getByRole("button", { name: "right" }));

    rerender(
      <SftpTransferWorkbench
        groups={groupsWithoutRightHost}
        initialRightHostId="host-right"
      />,
    );

    await waitFor(() =>
      expect(screen.getByLabelText("SFTP 面板 backup")).toBeInTheDocument(),
    );
    expect(screen.queryByLabelText("SFTP 面板 right")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "stale local right" })).not.toBeInTheDocument();
    expect(screen.getByText("目标：backup:/")).toBeInTheDocument();
  });

  it("keeps reported remote paths scoped to the active host tab", async () => {
    const user = userEvent.setup();
    render(
      <SftpTransferWorkbench
        groups={groups}
        initialRightHostId="host-right"
      />,
    );

    await user.click(screen.getByRole("button", { name: "报告路径 right" }));
    expect(screen.getByText("目标：right:/srv/right")).toBeInTheDocument();

    await user.click(
      screen.getByRole("combobox", { name: "添加右侧服务器" }),
    );
    await user.click(screen.getByRole("option", { name: "backup" }));
    expect(screen.getByText("目标：backup:/")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "报告路径 backup" }));
    expect(screen.getByText("目标：backup:/srv/backup")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "right" }));
    expect(screen.getByText("目标：right:/srv/right")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "backup" }));
    expect(screen.getByText("目标：backup:/srv/backup")).toBeInTheDocument();
  });

  it("does not activate a stale or non-SSH host when no SSH hosts are available", async () => {
    const { rerender } = render(
      <SftpTransferWorkbench
        groups={groups}
        initialRightHostId="host-right"
      />,
    );

    rerender(
      <SftpTransferWorkbench
        groups={groupsWithoutSshHosts}
        initialRightHostId="host-right"
      />,
    );

    await waitFor(() =>
      expect(screen.queryByLabelText(/SFTP 面板/)).not.toBeInTheDocument(),
    );
    expect(screen.getByText("没有可用于 SFTP 的 SSH 服务器。")).toBeInTheDocument();
    expect(screen.getByText("右侧未选择服务器")).toBeInTheDocument();
  });

  it("shows queue failures as a recoverable summary with collapsed details", async () => {
    const user = userEvent.setup();
    sftpApiMock.listSftpTransfers.mockRejectedValueOnce(
      new Error(
        "offline password=workbench-secret path=C:\\runtime\\queue.json",
      ),
    );

    render(
      <SftpTransferWorkbench
        groups={groups}
        initialRightHostId="host-right"
      />,
    );

    expect(
      await screen.findByText("无法同步传输队列"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("检查连接后刷新传输队列。"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/workbench-secret/)).not.toBeInTheDocument();
    expect(screen.getByText(/C:\\runtime\\queue\.json/)).not.toBeVisible();

    await user.click(screen.getByText("技术详情"));

    expect(screen.getByText(/password="\[已隐藏\]"/)).toBeVisible();
    expect(screen.queryByText(/workbench-secret/)).not.toBeInTheDocument();
  });

  it("shows queue progress and delegates cancel and clear actions", async () => {
    const user = userEvent.setup();
    sftpApiMock.listSftpTransfers.mockResolvedValue([
      runningTransfer,
      succeededTransfer,
    ]);
    sftpApiMock.clearCompletedSftpTransfers.mockResolvedValue([runningTransfer]);

    render(
      <SftpTransferWorkbench
        groups={groups}
        initialRightHostId="host-right"
      />,
    );

    expect(await screen.findByText("app.log")).toBeInTheDocument();
    expect(screen.getByText("50%")).toBeInTheDocument();
    expect(screen.getByText("1 活动 · 1 历史")).toBeInTheDocument();
    expect(screen.queryByText("本机桥接")).not.toBeInTheDocument();
    expect(
      screen.queryByText("left:/tmp/app.log -> right:/var/log/app.log"),
    ).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "查看传输详情 app.log" }),
    );
    expect(screen.getByText("本机桥接")).toBeInTheDocument();
    expect(
      screen.getByText("left:/tmp/app.log -> right:/var/log/app.log"),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "取消传输 app.log" }),
    );
    expect(sftpApiMock.cancelSftpTransfer).toHaveBeenCalledWith(
      expect.objectContaining({
        transferId: "transfer-running",
        viewScope: expect.stringMatching(/^sftp-workbench:/),
      }),
    );

    await user.click(
      screen.getByRole("button", { name: "清理完成的传输" }),
    );
    await waitFor(() =>
      expect(sftpApiMock.clearCompletedSftpTransfers).toHaveBeenCalledWith({
        viewScope: expect.stringMatching(/^sftp-workbench:/),
      }),
    );
  });

  it("retries a failed managed transfer from the compact queue row", async () => {
    const user = userEvent.setup();
    sftpApiMock.listSftpTransfers.mockResolvedValue([failedTransfer]);

    render(
      <SftpTransferWorkbench
        groups={groups}
        initialRightHostId="host-right"
      />,
    );

    await user.click(
      await screen.findByRole("button", {
        name: "重新传输 failed.log",
      }),
    );

    expect(sftpApiMock.retrySftpTransfer).toHaveBeenCalledWith({
      transferId: "transfer-failed",
      viewScope: expect.stringMatching(/^sftp-workbench:/),
    });
    expect(sftpApiMock.enqueueSftpTransfer).not.toHaveBeenCalled();
  });

  it("keeps long transfer history collapsed and scrollable when expanded", async () => {
    const user = userEvent.setup();
    sftpApiMock.listSftpTransfers.mockResolvedValue(
      Array.from({ length: 10 }, (_, index) => ({
        ...runningTransfer,
        bytesTransferred: index,
        createdAt: index,
        id: `transfer-${index}`,
        localPath: `sftp://host-left/tmp/log-${index}.txt`,
        remotePath: `/var/log/log-${index}.txt`,
        source: {
          hostId: "host-left",
          hostLabel: "left",
          kind: "remote" as const,
          path: `/tmp/log-${index}.txt`,
        },
        target: {
          hostId: "host-right",
          hostLabel: "right",
          kind: "remote" as const,
          path: `/var/log/log-${index}.txt`,
        },
        totalBytes: 100,
        updatedAt: index,
      })),
    );

    render(
      <SftpTransferWorkbench groups={groups} initialRightHostId="host-right" />,
    );

    const history = await screen.findByLabelText("SFTP 后台传输历史");

    expect(history).toHaveClass("max-h-44", "overflow-hidden");
    expect(screen.getByText("log-9.txt")).toBeInTheDocument();
    expect(screen.getByText("log-8.txt")).toBeInTheDocument();
    expect(screen.getByText("log-7.txt")).toBeInTheDocument();
    expect(screen.queryByText("log-0.txt")).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "展开传输历史，查看其余 7 项" }),
    );

    expect(history).toHaveClass("max-h-72", "overflow-y-auto");
    expect(screen.getByText("log-0.txt")).toBeInTheDocument();
  });

  it("does not offer cancel again after a transfer already requested cancellation", async () => {
    sftpApiMock.listSftpTransfers.mockResolvedValue([
      {
        ...runningTransfer,
        cancelRequested: true,
      },
    ]);

    render(
      <SftpTransferWorkbench groups={groups} initialRightHostId="host-right" />,
    );

    expect(await screen.findByText("app.log")).toBeInTheDocument();
    expect(screen.getByLabelText("正在取消")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "取消传输 app.log" }),
    ).toBeDisabled();
    expect(sftpApiMock.cancelSftpTransfer).not.toHaveBeenCalled();
  });

  it("does not poll the transfer queue while inactive", () => {
    render(
      <SftpTransferWorkbench
        active={false}
        groups={groups}
        initialRightHostId="host-right"
      />,
    );

    expect(sftpApiMock.listSftpTransfers).not.toHaveBeenCalled();
    expect(fileDialogApiMock.listLocalDirectory).not.toHaveBeenCalled();
  });

});
