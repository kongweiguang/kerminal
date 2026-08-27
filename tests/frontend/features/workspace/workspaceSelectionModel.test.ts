// @author kongweiguang

import { describe, expect, it } from "vitest";
import {
  restoredSelectedMachineId,
  sanitizeRestoredSftpTransferTabs,
  selectedMachineIdForUpdatedGroups,
  selectedMachineIdFromWorkspaceTab,
} from "../../../../src/features/workspace/workspaceSelectionModel";
import type {
  MachineGroup,
  TerminalTab,
} from "../../../../src/features/workspace/types";

const machineGroups: MachineGroup[] = [
  {
    id: "group-prod",
    title: "Production",
    machines: [
      {
        description: "SSH host",
        id: "host-prod",
        kind: "ssh",
        name: "prod",
        status: "online",
        tags: [],
      },
      {
        description: "Local profile",
        id: "local-pwsh",
        kind: "local",
        name: "PowerShell",
        status: "online",
        tags: [],
      },
    ],
  },
];

const terminalTab: TerminalTab = {
  id: "tab-ssh-pending",
  layout: { paneId: "pane-ssh-pending", type: "pane" },
  machineId: "host-pending",
  title: "pending",
};

describe("workspaceSelectionModel", () => {
  it("sanitizes restored SFTP transfer tabs against current SSH hosts", () => {
    const [tab] = sanitizeRestoredSftpTransferTabs(
      [
        {
          id: "tab-sftp",
          kind: "sftpTransfer",
          leftHostId: "local-pwsh",
          lockedLeftHostId: "missing-host",
          machineId: "host-prod",
          rightHostId: "host-prod",
          title: "Transfer",
        },
      ],
      machineGroups,
    );

    expect(tab).toMatchObject({
      id: "tab-sftp",
      kind: "sftpTransfer",
      leftHostId: "host-prod",
      lockedLeftHostId: undefined,
      machineId: "host-prod",
      rightHostId: "host-prod",
    });
  });

  it("keeps a restored active remote tab selected while hosts are pending", () => {
    expect(
      restoredSelectedMachineId({
        activeTabId: terminalTab.id,
        fallbackSelectedMachineId: "local-pwsh",
        machineGroups: [],
        selectedMachineId: "missing-selected",
        terminalPanes: [],
        terminalTabs: [terminalTab],
      }),
    ).toBe("host-pending");
  });

  it("恢复空工作区时不保留最近选择的主机", () => {
    expect(
      restoredSelectedMachineId({
        activeTabId: "",
        fallbackSelectedMachineId: "local-pwsh",
        machineGroups,
        selectedMachineId: "host-prod",
        terminalPanes: [],
        terminalTabs: [],
      }),
    ).toBe("");
  });

  it("only keeps pending active tab selection when the caller allows it", () => {
    const options = {
      activeTabId: terminalTab.id,
      fallbackSelectedMachineId: "",
      machineGroups: [],
      terminalPanes: [],
      terminalTabs: [terminalTab],
    };

    expect(
      selectedMachineIdForUpdatedGroups({
        ...options,
        allowPendingActiveTabSelection: true,
      }),
    ).toBe("host-pending");
    expect(
      selectedMachineIdForUpdatedGroups({
        ...options,
        allowPendingActiveTabSelection: false,
      }),
    ).toBe("");
  });

  it("selects the current host from an SFTP workspace tab", () => {
    expect(
      selectedMachineIdFromWorkspaceTab(
        {
          id: "tab-sftp",
          kind: "sftpTransfer",
          leftHostId: "local-pwsh",
          lockedLeftHostId: "missing-host",
          machineId: "sftp-transfer",
          rightHostId: "host-prod",
          title: "Transfer",
        },
        machineGroups,
        [],
      ),
    ).toBe("host-prod");
  });

  it("selects the target host from a workspace file tab", () => {
    expect(
      selectedMachineIdFromWorkspaceTab(
        {
          access: "readonly",
          id: "tab-file",
          kind: "workspaceFile",
          machineId: "host-prod",
          path: "/etc/app.yaml",
          source: "sftp",
          target: { hostId: "host-prod", kind: "ssh" },
          title: "app.yaml",
        },
        machineGroups,
        [],
      ),
    ).toBe("host-prod");
  });

  it("selects a workspace-scoped local terminal without a sidebar machine", () => {
    const tab: TerminalTab = {
      id: "tab-local-1",
      layout: { paneId: "pane-local-1", type: "pane" },
      machineId: "machine-local-1",
      title: "Git Bash",
    };
    const panes = [
      {
        id: "pane-local-1",
        lines: [],
        localMachineScope: "workspace" as const,
        machineId: "machine-local-1",
        mode: "local" as const,
        prompt: "PS>",
        status: "online" as const,
        title: "Git Bash",
      },
    ];

    expect(selectedMachineIdFromWorkspaceTab(tab, [], panes)).toBe(
      "machine-local-1",
    );
    expect(
      selectedMachineIdForUpdatedGroups({
        activeTabId: tab.id,
        allowPendingActiveTabSelection: false,
        fallbackSelectedMachineId: "",
        machineGroups: [],
        terminalPanes: panes,
        terminalTabs: [tab],
      }),
    ).toBe("machine-local-1");
  });
});
