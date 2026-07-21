/**
 * @author kongweiguang
 */

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
    onOpenWorkspaceFileTab,
    onSftpClipboardChange,
    selectedMachine,
    showLocalTransferActions,
    showTerminalDirectoryControls,
    showTransferStatusBar,
    sftpClipboard,
    transferTarget,
    transferViewScope,
  }: {
    active: boolean;
    compactHeader?: boolean;
    onCurrentPathChange?: (path: string) => void;
    onOpenWorkspaceFileTab?: (options: unknown) => void;
    onSftpClipboardChange: (clipboard: SftpClipboard | null) => void;
    selectedMachine: { id: string; name: string };
    showLocalTransferActions?: boolean;
    showTerminalDirectoryControls?: boolean;
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
        <span>
          terminal-directory-controls:{String(showTerminalDirectoryControls)}
        </span>
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
        <button
          disabled={!onOpenWorkspaceFileTab}
          onClick={() =>
            onOpenWorkspaceFileTab?.({
              access: "editable",
              path: "/srv/app.log",
              rootPath: "/srv",
              source: "sftp",
              target: { hostId: selectedMachine.id, kind: "ssh" },
            })
          }
          type="button"
        >
          打开文件 {selectedMachine.name}
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

const groupsWithCreatedHost: MachineGroup[] = [
  {
    ...groups[0],
    machines: [
      ...groups[0].machines,
      {
        description: "deploy@created.internal:22",
        id: "host-created",
        kind: "ssh",
        name: "created",
        status: "offline",
        tags: ["ssh"],
      },
    ],
  },
];

const runningTransfer: SftpTransferSummary = {
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
};const failedTransfer: SftpTransferSummary = {
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
  });

  it("starts with a local left pane and no selected remote server", () => {
    render(<SftpTransferWorkbench groups={groups} />);

    expect(screen.getByLabelText("本地目录面板")).toBeInTheDocument();
    expect(screen.getByText("右侧未选择服务器")).toBeInTheDocument();
    expect(screen.getByText("选择右侧服务器。")).toBeInTheDocument();
    expect(screen.queryByLabelText(/SFTP 面板/)).not.toBeInTheDocument();
  });

  it("loads the local directory into the left pane", async () => {
    render(<SftpTransferWorkbench groups={groups} />);

    expect(fileDialogApiMock.listLocalDirectory).toHaveBeenCalledWith(null);
    expect(await screen.findByText(".codex")).toBeInTheDocument();
    expect(screen.getByText("notes.md")).toBeInTheDocument();
    expect(screen.getByDisplayValue("C:\\Users\\24052")).toBeInTheDocument();
    expect(screen.getByText("2 项 / 1 目录 / 1 文件")).toBeInTheDocument();
    expect(screen.queryByText("左侧本地目录")).not.toBeInTheDocument();
    expect(screen.queryByText("本地目录")).not.toBeInTheDocument();
  });

  it("merges each target selector and tab strip without visible duplicate titles", () => {
    render(
      <SftpTransferWorkbench
        groups={groups}
        initialRightHostId="host-right"
      />,
    );

    expect(screen.getByLabelText("左侧目标")).toBeInTheDocument();
    expect(screen.getByLabelText("右侧服务器")).toBeInTheDocument();
    expect(screen.queryByText("左侧目标")).not.toBeInTheDocument();
    expect(screen.queryByText("右侧服务器")).not.toBeInTheDocument();
  });

  it("opens an initial right server and lets the right side add SSH hosts", async () => {
    const user = userEvent.setup();
    render(
      <SftpTransferWorkbench
        groups={groups}
        initialRightHostId="host-right"
      />,
    );

    expect(screen.getByLabelText("SFTP 面板 right")).toBeInTheDocument();
    expect(screen.getByText("目标：right:/")).toBeInTheDocument();
    expect(screen.getByText("compact:true")).toBeInTheDocument();
    expect(
      screen.getByText("terminal-directory-controls:false"),
    ).toBeInTheDocument();
    expect(screen.getByText("transfer-status:false")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByText("local-actions:false")).toBeInTheDocument(),
    );
    expect(
      screen.getByText("transfer-target:left:C:\\Users\\24052"),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("combobox", { name: "添加右侧服务器" }),
    );
    await user.click(screen.getByRole("option", { name: "backup" }));

    expect(screen.getByLabelText("SFTP 面板 backup")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "right" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "backup" })).toBeInTheDocument();

    await user.click(
      screen.getByRole("combobox", { name: "添加右侧服务器" }),
    );
    await user.click(screen.getByRole("option", { name: "right" }));

    expect(screen.getAllByRole("button", { name: "right" })).toHaveLength(2);
  });

  it("forwards the central workspace file bridge to remote host panes", async () => {
    const user = userEvent.setup();
    const onOpenWorkspaceFileTab = vi.fn();
    render(
      <SftpTransferWorkbench
        groups={groups}
        initialRightHostId="host-right"
        onOpenWorkspaceFileTab={onOpenWorkspaceFileTab}
      />,
    );

    await user.click(screen.getByRole("button", { name: "打开文件 right" }));

    expect(onOpenWorkspaceFileTab).toHaveBeenCalledWith({
      access: "editable",
      path: "/srv/app.log",
      rootPath: "/srv",
      source: "sftp",
      target: { hostId: "host-right", kind: "ssh" },
    });
  });

  it("filters the transfer host dropdown before adding an SSH host", async () => {
    const user = userEvent.setup();
    render(
      <SftpTransferWorkbench
        groups={groups}
        initialRightHostId="host-right"
      />,
    );

    const hostSearch = screen.getByRole("combobox", {
      name: "添加右侧服务器",
    });
    await user.click(hostSearch);
    await user.type(hostSearch, "backup.internal");

    expect(screen.getByRole("option", { name: "backup" })).toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: "right" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("option", { name: "backup" }));

    expect(screen.getByLabelText("SFTP 面板 backup")).toBeInTheDocument();
  });

  it("scopes transfer history to its workspace tab", async () => {
    const user = userEvent.setup();
    render(
      <SftpTransferWorkbench
        groups={groups}
        initialRightHostId="host-right"
        workspaceTabId="tab-transfer"
      />,
    );

    expect(
      await screen.findByText("transfer-scope:sftp-workbench:tab-transfer"),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("combobox", { name: "添加左侧服务器" }),
    );
    await user.click(screen.getByRole("option", { name: "left" }));

    expect(
      screen.getAllByText("transfer-scope:sftp-workbench:tab-transfer").length,
    ).toBeGreaterThanOrEqual(2);
    await waitFor(() =>
      expect(sftpApiMock.listSftpTransfers).toHaveBeenCalledWith({
        viewScope: "sftp-workbench:tab-transfer",
      }),
    );
  });

  it("requests a new SSH host from the selected workbench side", async () => {
    const user = userEvent.setup();
    const onCreateSshHost = vi.fn();
    render(
      <SftpTransferWorkbench
        groups={groups}
        onCreateSshHost={onCreateSshHost}
        workspaceTabId="tab-transfer"
      />,
    );

    await user.click(
      screen.getByRole("combobox", { name: "添加左侧服务器" }),
    );
    await user.click(screen.getByRole("option", { name: /新建 SSH 主机/ }));
    expect(onCreateSshHost).toHaveBeenCalledWith({
      side: "left",
      workspaceTabId: "tab-transfer",
    });

    await user.click(
      screen.getByRole("combobox", { name: "添加右侧服务器" }),
    );
    await user.click(screen.getByRole("option", { name: /新建 SSH 主机/ }));
    expect(onCreateSshHost).toHaveBeenLastCalledWith({
      side: "right",
      workspaceTabId: "tab-transfer",
    });
  });

  it("opens a created SSH host on the matching workbench side after groups refresh", async () => {
    const { rerender } = render(
      <SftpTransferWorkbench
        createdHostTarget={{
          hostId: "host-created",
          sequence: 1,
          side: "right",
          workspaceTabId: "tab-transfer",
        }}
        groups={groups}
        initialRightHostId="host-right"
        workspaceTabId="tab-transfer"
      />,
    );

    expect(screen.queryByLabelText("SFTP 面板 created")).not.toBeInTheDocument();

    rerender(
      <SftpTransferWorkbench
        createdHostTarget={{
          hostId: "host-created",
          sequence: 1,
          side: "right",
          workspaceTabId: "tab-transfer",
        }}
        groups={groupsWithCreatedHost}
        initialRightHostId="host-right"
        workspaceTabId="tab-transfer"
      />,
    );

    expect(await screen.findByLabelText("SFTP 面板 created")).toBeInTheDocument();
    expect(screen.getByText("目标：created:/")).toBeInTheDocument();
  });

  it("ignores created SSH host signals for another transfer workbench", () => {
    render(
      <SftpTransferWorkbench
        createdHostTarget={{
          hostId: "host-created",
          sequence: 2,
          side: "left",
          workspaceTabId: "tab-other",
        }}
        groups={groupsWithCreatedHost}
        initialRightHostId="host-right"
        workspaceTabId="tab-transfer"
      />,
    );

    expect(screen.queryByLabelText("SFTP 面板 created")).not.toBeInTheDocument();
  });

  it("lets the left side add SSH hosts and exposes the active left remote target", async () => {
    const user = userEvent.setup();
    render(
      <SftpTransferWorkbench
        groups={groups}
        initialRightHostId="host-right"
      />,
    );

    await waitFor(() =>
      expect(
        screen.getByText("transfer-target:left:C:\\Users\\24052"),
      ).toBeInTheDocument(),
    );

    await user.click(
      screen.getByRole("combobox", { name: "添加左侧服务器" }),
    );
    await user.click(screen.getByRole("option", { name: "left" }));

    expect(screen.getByLabelText("SFTP 面板 left")).toBeInTheDocument();
    expect(screen.getByText("transfer-target:right:right:/")).toBeInTheDocument();
    expect(screen.getByText("transfer-target:left:left:/")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "报告路径 left" }));

    expect(
      screen.getByText("transfer-target:left:left:/srv/left"),
    ).toBeInTheDocument();
  });

  it("restores the right transfer target when the left pane switches back to local", async () => {
    const user = userEvent.setup();
    render(
      <SftpTransferWorkbench
        groups={groups}
        initialRightHostId="host-right"
      />,
    );

    await waitFor(() =>
      expect(
        screen.getByText("transfer-target:left:C:\\Users\\24052"),
      ).toBeInTheDocument(),
    );
    await user.click(
      screen.getByRole("combobox", { name: "添加左侧服务器" }),
    );
    await user.click(screen.getByRole("option", { name: "left" }));
    expect(screen.getByText("transfer-target:left:left:/")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "本机" }));

    await waitFor(() =>
      expect(
        screen.getByText("transfer-target:left:C:\\Users\\24052"),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByLabelText("SFTP 面板 left")).not.toBeInTheDocument();
  });

  it("falls back to the local left pane after closing the active left SSH tab", async () => {
    const user = userEvent.setup();
    render(
      <SftpTransferWorkbench
        groups={groups}
        initialRightHostId="host-right"
      />,
    );

    await waitFor(() =>
      expect(
        screen.getByText("transfer-target:left:C:\\Users\\24052"),
      ).toBeInTheDocument(),
    );
    await user.click(
      screen.getByRole("combobox", { name: "添加左侧服务器" }),
    );
    await user.click(screen.getByRole("option", { name: "left" }));
    expect(screen.getByText("transfer-target:left:left:/")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "关闭 left" }));

    await waitFor(() =>
      expect(
        screen.getByText("transfer-target:left:C:\\Users\\24052"),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByLabelText("SFTP 面板 left")).not.toBeInTheDocument();
  });

  it("updates the right transfer target when the left local directory changes", async () => {
    const user = userEvent.setup();
    const deployListing = {
      ...localListing,
      parentPath: "D:\\",
      path: "D:\\deploy",
    };
    fileDialogApiMock.selectLocalDirectory.mockResolvedValue("D:\\deploy");
    fileDialogApiMock.listLocalDirectory.mockImplementation(async (path) =>
      path === "D:\\deploy" ? deployListing : localListing,
    );

    render(
      <SftpTransferWorkbench
        groups={groups}
        initialRightHostId="host-right"
      />,
    );

    await waitFor(() =>
      expect(
        screen.getByText("transfer-target:left:C:\\Users\\24052"),
      ).toBeInTheDocument(),
    );

    await user.click(screen.getByRole("button", { name: "选择本地目录" }));

    await waitFor(() =>
      expect(
        screen.getByText("transfer-target:left:D:\\deploy"),
      ).toBeInTheDocument(),
    );
    expect(screen.getByDisplayValue("D:\\deploy")).toBeInTheDocument();
  });


});
