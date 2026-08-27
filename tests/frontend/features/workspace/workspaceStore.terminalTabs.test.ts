// @author kongweiguang

import { beforeEach, describe, expect, it } from "vitest";
import { collectPaneIds } from "../../../../src/features/workspace/workspaceLayout";
import { useWorkspaceStore } from "../../../../src/features/workspace/workspaceStore";
import {
  apiContainer,
  remoteHostTree,
  resetWorkspaceStore,
  remoteHostTreeWithTerminalTransports,
} from "../../support/workspace/workspaceStore.testSupport";
import {
  isSftpTransferWorkspaceTab,
  isTerminalSessionTab,
  type TerminalPane,
  type TerminalSessionTab,
  type TerminalTab,
} from "../../../../src/features/workspace/types";

function requireTerminalSessionTab(
  tab: TerminalTab | undefined,
): TerminalSessionTab {
  if (!isTerminalSessionTab(tab)) {
    throw new Error("Expected a terminal session tab.");
  }
  return tab;
}

function requireFocusedPane(): TerminalPane {
  const state = useWorkspaceStore.getState();
  const pane = state.terminalPanes.find((item) => item.id === state.focusedPaneId);
  if (!pane) {
    throw new Error("Expected a focused terminal pane.");
  }
  return pane;
}

function requireMachineId(kind: string): string {
  const machine = useWorkspaceStore
    .getState()
    .machineGroups.flatMap((group) => group.machines)
    .find((candidate) => candidate.kind === kind);
  if (!machine) {
    throw new Error(`Expected a ${kind} machine.`);
  }
  return machine.id;
}

describe("workspaceStore terminal tabs", () => {
  beforeEach(() => {
    resetWorkspaceStore();
  });

  it("selects a tab and focuses its first pane", () => {
    useWorkspaceStore.getState().addTerminalTab({ title: "第一本地终端" });
    useWorkspaceStore.getState().addTerminalTab({ title: "第二本地终端" });
    useWorkspaceStore.getState().selectTab("tab-local-1");

    expect(useWorkspaceStore.getState().activeTabId).toBe("tab-local-1");
    expect(useWorkspaceStore.getState().focusedPaneId).toBe("pane-local-1");
  });

  it("renames a terminal tab title", () => {
    useWorkspaceStore.getState().addTerminalTab({ title: "本地 PowerShell" });
    useWorkspaceStore.getState().renameTerminalTab("tab-local-1", "生产日志");

    expect(useWorkspaceStore.getState().terminalTabs[0].title).toBe("生产日志");
    expect(useWorkspaceStore.getState().terminalPanes[0].title).toBe(
      "本地 PowerShell",
    );
  });

  it("stores and clears terminal tab group display preferences", () => {
    useWorkspaceStore.getState().updateTerminalTabGroupPreference("host-dev", {
      color: "pink",
      title: " 生产组 ",
    });

    expect(useWorkspaceStore.getState().terminalTabGroupPreferences).toEqual({
      "host-dev": {
        color: "pink",
        title: "生产组",
      },
    });

    useWorkspaceStore
      .getState()
      .updateTerminalTabGroupPreference("host-dev", {});

    expect(useWorkspaceStore.getState().terminalTabGroupPreferences).toEqual({});
  });

  it("ignores unknown tab selection requests", () => {
    const before = useWorkspaceStore.getState();

    useWorkspaceStore.getState().selectTab("missing-tab");

    const after = useWorkspaceStore.getState();
    expect(after.activeTabId).toBe(before.activeTabId);
    expect(after.focusedPaneId).toBe(before.focusedPaneId);
  });

  it("adds a local terminal tab and focuses its pane", () => {
    useWorkspaceStore.getState().addTerminalTab();

    const state = useWorkspaceStore.getState();
    expect(state.terminalTabs).toHaveLength(1);
    expect(state.terminalPanes).toHaveLength(1);
    expect(state.activeTabId).toBe("tab-local-1");
    expect(state.focusedPaneId).toBe("pane-local-1");
    expect(state.selectedMachineId).toBe("machine-local-1");
    expect(state.machineGroups[0]).toMatchObject({
      id: "__ungrouped__",
      title: "默认分组",
    });
  });

  it("opens a saved SSH host in a new terminal tab", () => {
    useWorkspaceStore.getState().setRemoteHostTree(remoteHostTree);
    useWorkspaceStore.getState().openSshTerminal("host-lab");

    const state = useWorkspaceStore.getState();
    const pane = state.terminalPanes[state.terminalPanes.length - 1];
    const tab = state.terminalTabs[state.terminalTabs.length - 1];

    expect(state.activeTabId).toBe("tab-ssh-1");
    expect(state.focusedPaneId).toBe("pane-ssh-1");
    expect(state.selectedMachineId).toBe("host-lab");
    expect(tab).toMatchObject({
      id: "tab-ssh-1",
      machineId: "host-lab",
      title: "lab server",
    });
    expect(pane).toMatchObject({
      id: "pane-ssh-1",
      machineId: "host-lab",
      mode: "ssh",
      prompt: "root@192.168.1.253:~$",
      remoteHostId: "host-lab",
      title: "lab server",
    });
  });

  it("splits the focused pane in the active tab", () => {
    useWorkspaceStore.getState().addTerminalTab({ title: "本地 PowerShell" });
    useWorkspaceStore.getState().splitFocusedPane("horizontal");

    const state = useWorkspaceStore.getState();
    const activeTab = requireTerminalSessionTab(
      state.terminalTabs.find((tab) => tab.id === state.activeTabId),
    );

    expect(state.terminalPanes).toHaveLength(2);
    expect(state.focusedPaneId).toBe("pane-local-2");
    expect(activeTab.layout).toMatchObject({
      type: "split",
      direction: "horizontal",
    });
    expect(collectPaneIds(activeTab.layout)).toEqual([
      "pane-local-1",
      "pane-local-2",
    ]);
  });

  const focusedPaneSplitTargetCases: Array<{
    name: string;
    openFocusedPane: () => void;
    expectedPaneIdPrefix: string;
  }> = [
    {
      expectedPaneIdPrefix: "pane-ssh-",
      name: "SSH",
      openFocusedPane: () => {
        useWorkspaceStore.getState().setRemoteHostTree(remoteHostTree);
        useWorkspaceStore.getState().openSshTerminal("host-lab");
      },
    },
    {
      expectedPaneIdPrefix: "pane-telnet-",
      name: "Telnet",
      openFocusedPane: () => {
        useWorkspaceStore
          .getState()
          .setRemoteHostTree(remoteHostTreeWithTerminalTransports);
        useWorkspaceStore.getState().openTelnetTerminal("telnet-lab");
      },
    },
    {
      expectedPaneIdPrefix: "pane-serial-",
      name: "Serial",
      openFocusedPane: () => {
        useWorkspaceStore
          .getState()
          .setRemoteHostTree(remoteHostTreeWithTerminalTransports);
        useWorkspaceStore.getState().openSerialTerminal("serial-console");
      },
    },
    {
      expectedPaneIdPrefix: "pane-container-",
      name: "Container",
      openFocusedPane: () => {
        useWorkspaceStore.getState().setRemoteHostTree(remoteHostTree);
        useWorkspaceStore.getState().addDockerContainer(apiContainer, {
          user: "node",
          workdir: "/srv/api",
        });
        useWorkspaceStore
          .getState()
          .openContainerTerminal(requireMachineId("dockerContainer"));
      },
    },
  ];

  for (const testCase of focusedPaneSplitTargetCases) {
    it(`copies the focused ${testCase.name} pane target when splitting`, () => {
      testCase.openFocusedPane();
      const sourcePane = requireFocusedPane();

      useWorkspaceStore.getState().splitFocusedPane("horizontal");

      const splitPane = requireFocusedPane();
      expect(splitPane.id.startsWith(testCase.expectedPaneIdPrefix)).toBe(true);
      expect(splitPane.machineId).toBe(sourcePane.machineId);
      expect(splitPane.mode).toBe(sourcePane.mode);
      expect(splitPane.remoteHostId).toBe(sourcePane.remoteHostId);
      expect(splitPane.containerId).toBe(sourcePane.containerId);
      expect(splitPane.target).toEqual(sourcePane.target);
    });
  }

  const explicitSplitTargetCases: Array<{
    name: string;
    prepareTargetMachine: () => string;
    expectedMode: TerminalPane["mode"];
    expectedPaneIdPrefix: string;
    expectedTarget: unknown;
    expectedRemoteHostId?: string;
    expectedContainerId?: string;
  }> = [
    {
      expectedMode: "ssh",
      expectedPaneIdPrefix: "pane-ssh-",
      expectedRemoteHostId: "host-lab",
      expectedTarget: { hostId: "host-lab", kind: "ssh" },
      name: "SSH",
      prepareTargetMachine: () => {
        useWorkspaceStore.getState().setRemoteHostTree(remoteHostTree);
        return "host-lab";
      },
    },
    {
      expectedMode: "telnet",
      expectedPaneIdPrefix: "pane-telnet-",
      expectedTarget: { hostId: "telnet-lab", kind: "telnet" },
      name: "Telnet",
      prepareTargetMachine: () => {
        useWorkspaceStore
          .getState()
          .setRemoteHostTree(remoteHostTreeWithTerminalTransports);
        return "telnet-lab";
      },
    },
    {
      expectedMode: "serial",
      expectedPaneIdPrefix: "pane-serial-",
      expectedTarget: { hostId: "serial-console", kind: "serial" },
      name: "Serial",
      prepareTargetMachine: () => {
        useWorkspaceStore
          .getState()
          .setRemoteHostTree(remoteHostTreeWithTerminalTransports);
        return "serial-console";
      },
    },
    {
      expectedContainerId: "c0ffee1234567890",
      expectedMode: "container",
      expectedPaneIdPrefix: "pane-container-",
      expectedRemoteHostId: "host-lab",
      expectedTarget: {
        containerId: "c0ffee1234567890",
        containerName: "api",
        hostId: "host-lab",
        kind: "dockerContainer",
        runtime: "docker",
        user: "node",
        workdir: "/srv/api",
      },
      name: "Container",
      prepareTargetMachine: () => {
        useWorkspaceStore.getState().setRemoteHostTree(remoteHostTree);
        useWorkspaceStore.getState().addDockerContainer(apiContainer, {
          user: "node",
          workdir: "/srv/api",
        });
        return requireMachineId("dockerContainer");
      },
    },
  ];

  for (const testCase of explicitSplitTargetCases) {
    it(`splits the active tab to an existing ${testCase.name} machine target`, () => {
      const targetMachineId = testCase.prepareTargetMachine();
      useWorkspaceStore.getState().addTerminalTab({ title: "本地源终端" });
      const sourcePaneId = useWorkspaceStore.getState().focusedPaneId;

      useWorkspaceStore
        .getState()
        .splitFocusedPane("horizontal", { targetMachineId });

      const state = useWorkspaceStore.getState();
      const activeTab = requireTerminalSessionTab(
        state.terminalTabs.find((tab) => tab.id === state.activeTabId),
      );
      const splitPane = requireFocusedPane();

      expect(collectPaneIds(activeTab.layout)).toEqual([
        sourcePaneId,
        splitPane.id,
      ]);
      expect(state.selectedMachineId).toBe(targetMachineId);
      expect(splitPane.id.startsWith(testCase.expectedPaneIdPrefix)).toBe(true);
      expect(splitPane.machineId).toBe(targetMachineId);
      expect(splitPane.mode).toBe(testCase.expectedMode);
      expect(splitPane.remoteHostId).toBe(testCase.expectedRemoteHostId);
      expect(splitPane.containerId).toBe(testCase.expectedContainerId);
      expect(splitPane.target).toEqual(testCase.expectedTarget);
    });
  }

  it("splits from the requested source pane without refreshing that pane", () => {
    useWorkspaceStore.getState().setRemoteHostTree(remoteHostTree);
    useWorkspaceStore.getState().addTerminalTab({
      cwd: "C:\\dev",
      title: "本地源终端",
    });
    useWorkspaceStore.getState().updatePaneCurrentCwd("pane-local-1", "C:\\repo");
    useWorkspaceStore.getState().splitFocusedPane("horizontal");
    useWorkspaceStore
      .getState()
      .updatePaneCurrentCwd("pane-local-2", "C:\\other");
    useWorkspaceStore.getState().focusPane("pane-local-2");
    const sourcePaneBefore = useWorkspaceStore
      .getState()
      .terminalPanes.find((pane) => pane.id === "pane-local-1");

    useWorkspaceStore.getState().splitFocusedPane("vertical", {
      sourcePaneId: "pane-local-1",
      targetMachineId: "host-lab",
    });

    const state = useWorkspaceStore.getState();
    const activeTab = requireTerminalSessionTab(
      state.terminalTabs.find((tab) => tab.id === state.activeTabId),
    );
    const sourcePaneAfter = state.terminalPanes.find(
      (pane) => pane.id === "pane-local-1",
    );
    const splitPane = requireFocusedPane();

    expect(sourcePaneAfter).toBe(sourcePaneBefore);
    expect(collectPaneIds(activeTab.layout)).toEqual([
      "pane-local-1",
      splitPane.id,
      "pane-local-2",
    ]);
    expect(splitPane).toMatchObject({
      machineId: "host-lab",
      mode: "ssh",
      remoteHostId: "host-lab",
    });
    expect(splitPane.cwd).toBeUndefined();
    expect(splitPane.currentCwd).toBeUndefined();
    expect(state.selectedMachineId).toBe("host-lab");
  });

  it("starts a split pane with the source cwd but without source history", () => {
    useWorkspaceStore.getState().setRemoteHostTree(remoteHostTree);
    useWorkspaceStore.getState().openSshTerminal("host-lab");
    useWorkspaceStore.getState().updatePaneCurrentCwd("pane-ssh-1", "/dev");
    useWorkspaceStore
      .getState()
      .updatePaneOutputHistory("pane-ssh-1", "ls\r\nold output\r\n");

    useWorkspaceStore.getState().splitFocusedPane("horizontal");

    const state = useWorkspaceStore.getState();
    const sourcePane = state.terminalPanes.find(
      (pane) => pane.id === "pane-ssh-1",
    );
    const splitPane = requireFocusedPane();

    expect(sourcePane?.outputHistory).toBe("ls\r\nold output\r\n");
    expect(splitPane).toMatchObject({
      currentCwd: "/dev",
      cwd: "/dev",
      id: "pane-ssh-2",
      lines: [],
      mode: "ssh",
      remoteHostId: "host-lab",
    });
    expect(splitPane.outputHistory).toBeUndefined();
  });

  it("ignores focus requests outside the active tab layout", () => {
    useWorkspaceStore.getState().addTerminalTab({ title: "第一本地终端" });
    useWorkspaceStore.getState().addTerminalTab({ title: "第二本地终端" });
    useWorkspaceStore.getState().focusPane("pane-local-1");

    expect(useWorkspaceStore.getState().focusedPaneId).toBe("pane-local-2");

    useWorkspaceStore.getState().splitFocusedPane("vertical");
    useWorkspaceStore.getState().addTerminalTab({ title: "第三本地终端" });

    const state = useWorkspaceStore.getState();
    const secondTab = requireTerminalSessionTab(
      state.terminalTabs.find((tab) => tab.id === "tab-local-2"),
    );
    expect(collectPaneIds(secondTab.layout)).toEqual([
      "pane-local-2",
      "pane-local-3",
    ]);
    expect(state.terminalPanes.map((pane) => pane.id)).toEqual([
      "pane-local-1",
      "pane-local-2",
      "pane-local-3",
      "pane-local-4",
    ]);
    expect(state.focusedPaneId).toBe("pane-local-4");
  });

  it("does not close panes outside the active tab layout", () => {
    useWorkspaceStore.getState().addTerminalTab({ title: "第一本地终端" });
    useWorkspaceStore.getState().addTerminalTab({ title: "第二本地终端" });
    useWorkspaceStore.getState().splitFocusedPane("horizontal");

    useWorkspaceStore.getState().closePane("pane-local-1");

    const state = useWorkspaceStore.getState();
    const firstTab = requireTerminalSessionTab(
      state.terminalTabs.find((tab) => tab.id === "tab-local-1"),
    );
    const secondTab = requireTerminalSessionTab(
      state.terminalTabs.find((tab) => tab.id === "tab-local-2"),
    );
    expect(state.activeTabId).toBe("tab-local-2");
    expect(state.focusedPaneId).toBe("pane-local-3");
    expect(state.terminalPanes.map((pane) => pane.id)).toEqual([
      "pane-local-1",
      "pane-local-2",
      "pane-local-3",
    ]);
    expect(collectPaneIds(firstTab.layout)).toEqual(["pane-local-1"]);
    expect(collectPaneIds(secondTab.layout)).toEqual([
      "pane-local-2",
      "pane-local-3",
    ]);
  });

  it("keeps the last pane in a tab when closePane is requested", () => {
    useWorkspaceStore.getState().addTerminalTab({ title: "本地 PowerShell" });
    useWorkspaceStore.getState().closePane("pane-local-1");

    const state = useWorkspaceStore.getState();
    expect(state.terminalPanes).toHaveLength(1);
    expect(state.focusedPaneId).toBe("pane-local-1");
    expect(requireTerminalSessionTab(state.terminalTabs[0]).layout).toEqual({
      type: "pane",
      paneId: "pane-local-1",
    });
  });

  it("closes a pane from a split tab and focuses the remaining pane", () => {
    useWorkspaceStore.getState().addTerminalTab({ title: "本地 PowerShell" });
    useWorkspaceStore.getState().splitFocusedPane("horizontal");
    useWorkspaceStore.getState().closePane("pane-local-1");

    const state = useWorkspaceStore.getState();
    const activeTab = requireTerminalSessionTab(
      state.terminalTabs.find((tab) => tab.id === state.activeTabId),
    );

    expect(state.terminalPanes.map((pane) => pane.id)).not.toContain(
      "pane-local-1",
    );
    expect(state.focusedPaneId).toBe("pane-local-2");
    expect(activeTab.layout).toEqual({
      type: "pane",
      paneId: "pane-local-2",
    });
  });

  it("closes a tab and removes its panes when multiple tabs exist", () => {
    useWorkspaceStore.getState().addTerminalTab({ title: "第一本地终端" });
    useWorkspaceStore.getState().addTerminalTab({ title: "第二本地终端" });
    useWorkspaceStore.getState().closeTerminalTab("tab-local-2");

    const state = useWorkspaceStore.getState();
    expect(state.terminalTabs.map((tab) => tab.id)).toEqual(["tab-local-1"]);
    expect(state.terminalPanes.map((pane) => pane.id)).toEqual(["pane-local-1"]);
    expect(state.activeTabId).toBe("tab-local-1");
    expect(state.focusedPaneId).toBe("pane-local-1");
  });

  it("keeps the focused pane in the active tab when closing an inactive tab", () => {
    useWorkspaceStore.getState().addTerminalTab({ title: "第一本地终端" });
    useWorkspaceStore.getState().splitFocusedPane("horizontal");
    useWorkspaceStore.getState().addTerminalTab({ title: "第二本地终端" });
    useWorkspaceStore.getState().selectTab("tab-local-1");
    useWorkspaceStore.getState().focusPane("pane-local-2");

    useWorkspaceStore.getState().closeTerminalTab("tab-local-2");

    const state = useWorkspaceStore.getState();
    expect(state.terminalTabs.map((tab) => tab.id)).toEqual(["tab-local-1"]);
    expect(state.terminalPanes.map((pane) => pane.id)).toEqual([
      "pane-local-1",
      "pane-local-2",
    ]);
    expect(state.activeTabId).toBe("tab-local-1");
    expect(state.focusedPaneId).toBe("pane-local-2");
  });

  it("closes the last terminal tab and leaves an empty workspace", () => {
    useWorkspaceStore.getState().addTerminalTab({ title: "本地 PowerShell" });
    useWorkspaceStore.getState().closeTerminalTab("tab-local-1");

    const state = useWorkspaceStore.getState();
    expect(state.terminalTabs).toEqual([]);
    expect(state.terminalPanes).toEqual([]);
    expect(state.activeTabId).toBe("");
    expect(state.focusedPaneId).toBe("");
  });

  it("opens an SFTP transfer tab without creating a terminal pane", () => {
    useWorkspaceStore.getState().setRemoteHostTree(remoteHostTree);
    useWorkspaceStore.getState().openSftpTransferTab({
      rightHostId: "host-lab",
    });

    const state = useWorkspaceStore.getState();
    const tab = state.terminalTabs.find((candidate) =>
      candidate.id.startsWith("tab-sftp-transfer-"),
    );

    expect(tab && isSftpTransferWorkspaceTab(tab)).toBe(true);
    expect(tab).toMatchObject({
      kind: "sftpTransfer",
      rightHostId: "host-lab",
      machineId: "host-lab",
      title: "lab server 传输",
    });
    expect(state.terminalPanes).toEqual([]);
    expect(state.focusedPaneId).toBe("");
    expect(state.activeTabId).toBe(tab?.id);
  });

  it("does not consume pane ids when splitting an active transfer tab", () => {
    useWorkspaceStore.getState().setRemoteHostTree(remoteHostTree);
    useWorkspaceStore.getState().openSftpTransferTab({
      rightHostId: "host-lab",
    });

    useWorkspaceStore.getState().splitFocusedPane("horizontal");
    useWorkspaceStore.getState().addTerminalTab({ title: "本地 PowerShell" });

    const state = useWorkspaceStore.getState();
    expect(state.terminalPanes.map((pane) => pane.id)).toEqual(["pane-local-1"]);
    expect(state.focusedPaneId).toBe("pane-local-1");
  });

  it("keeps transfer tabs when closing terminal tabs", () => {
    useWorkspaceStore.getState().setRemoteHostTree(remoteHostTree);
    useWorkspaceStore.getState().addTerminalTab({ title: "本地 PowerShell" });
    useWorkspaceStore.getState().openSftpTransferTab({
      rightHostId: "host-lab",
    });
    useWorkspaceStore.getState().closeTerminalTab("tab-local-1");

    const state = useWorkspaceStore.getState();
    expect(state.terminalPanes).toEqual([]);
    expect(state.terminalTabs).toHaveLength(1);
    expect(isSftpTransferWorkspaceTab(state.terminalTabs[0])).toBe(true);
    expect(state.activeTabId).toBe(state.terminalTabs[0].id);
    expect(state.focusedPaneId).toBe("");
  });

  it("closes the active transfer tab and restores focus to the terminal tab", () => {
    useWorkspaceStore.getState().setRemoteHostTree(remoteHostTree);
    useWorkspaceStore.getState().addTerminalTab({ title: "本地 PowerShell" });
    const terminalTabId = useWorkspaceStore.getState().activeTabId;
    useWorkspaceStore.getState().openSftpTransferTab({
      rightHostId: "host-lab",
    });
    const transferTabId = useWorkspaceStore.getState().activeTabId;

    useWorkspaceStore.getState().closeTerminalTab(transferTabId);

    const state = useWorkspaceStore.getState();
    expect(state.terminalTabs.map((tab) => tab.id)).toEqual([terminalTabId]);
    expect(state.terminalPanes.map((pane) => pane.id)).toEqual(["pane-local-1"]);
    expect(state.activeTabId).toBe(terminalTabId);
    expect(state.focusedPaneId).toBe("pane-local-1");
  });

  it("restores a saved terminal session and avoids generated id collisions", () => {
    useWorkspaceStore.getState().restoreWorkspaceSession({
      activeTabId: "tab-local-7",
      focusedPaneId: "pane-local-8",
      selectedMachineId: "machine-local-7",
      sidebarMachines: [],
      terminalPanes: [
        {
          cwd: "C:\\\\restored",
          id: "pane-local-8",
          lines: ["old output"],
          machineId: "machine-local-7",
          mode: "local",
          prompt: "PS>",
          shell: "pwsh.exe",
          status: "online",
          title: "恢复会话",
        },
      ],
      terminalTabs: [
        {
          id: "tab-local-7",
          layout: { type: "pane", paneId: "pane-local-8" },
          machineId: "machine-local-7",
          title: "恢复会话",
        },
      ],
    });
    useWorkspaceStore.getState().addTerminalTab({ title: "新会话" });

    const state = useWorkspaceStore.getState();
    expect(state.terminalPanes[0].lines).toEqual([]);
    expect(state.terminalTabs.map((tab) => tab.id)).toEqual([
      "tab-local-7",
      "tab-local-8",
    ]);
    expect(state.terminalPanes.map((pane) => pane.id)).toEqual([
      "pane-local-8",
      "pane-local-9",
    ]);
  });

  it("continues the tab group counter after restoring a v3 session", () => {
    useWorkspaceStore.getState().restoreWorkspaceSession({
      activeTabId: "tab-local-7",
      focusedPaneId: "pane-local-7",
      selectedMachineId: "machine-local-7",
      sidebarMachines: [],
      terminalPanes: [
        {
          id: "pane-local-7",
          lines: [],
          machineId: "machine-local-7",
          mode: "local",
          prompt: "PS>",
          shell: "pwsh.exe",
          status: "online",
          title: "恢复会话",
        },
      ],
      terminalTabGroups: {
        "tab-group-7": { collapsed: false, title: "恢复分组" },
      },
      terminalTabs: [
        {
          id: "tab-local-7",
          layout: { type: "pane", paneId: "pane-local-7" },
          machineId: "machine-local-7",
          tabGroupId: "tab-group-7",
          title: "恢复会话",
        },
      ],
    });

    expect(
      useWorkspaceStore
        .getState()
        .createTerminalTabGroup("tab-local-7", { title: "新分组" }),
    ).toBe("tab-group-8");
  });
});
