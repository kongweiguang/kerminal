// @author kongweiguang

import { describe, expect, it } from "vitest";
import {
  appendTerminalOutputHistory,
  normalizeWorkspaceSessionSnapshot,
  TERMINAL_OUTPUT_HISTORY_MAX_CHARS,
} from "../../../../src/features/workspace/workspaceSession";

describe("workspaceSession", () => {
  it("归一化空工作区时清除持久化的最近主机选择", () => {
    const session = normalizeWorkspaceSessionSnapshot({
      activeTabId: "",
      focusedPaneId: "",
      selectedMachineId: "host-prod",
      sidebarMachines: [],
      terminalPanes: [],
      terminalTabs: [],
    });

    expect(session.activeTabId).toBe("");
    expect(session.focusedPaneId).toBe("");
    expect(session.selectedMachineId).toBe("");
  });

  it("normalizes a persisted session without trusting stale focus", () => {
    const session = normalizeWorkspaceSessionSnapshot({
      activeTabId: "missing-tab",
      focusedPaneId: "pane-stale",
      selectedMachineId: "",
      terminalPanes: [
        {
          id: "pane-container-12",
          machineId: "docker:host-lab:c0ffee",
          mode: "container",
          prompt: "api:/workspace$",
          remoteHostId: "host-lab",
          status: "online",
          title: "api",
        },
        {
          id: "pane-orphan",
          machineId: "machine-orphan",
          mode: "local",
          prompt: "PS>",
          status: "online",
          title: "orphan",
        },
      ],
      terminalTabs: [
        {
          id: "tab-container-9",
          layout: { paneId: "pane-container-12", type: "pane" },
          machineId: "docker:host-lab:c0ffee",
          title: "api",
        },
      ],
    });

    expect(session.activeTabId).toBe("tab-container-9");
    expect(session.focusedPaneId).toBe("pane-container-12");
    expect(session.selectedMachineId).toBe("host-lab");
    expect(session.terminalPanes.map((pane) => pane.id)).toEqual([
      "pane-container-12",
    ]);
  });

  it("drops terminal tabs whose restored layout has no live panes", () => {
    const session = normalizeWorkspaceSessionSnapshot({
      activeTabId: "tab-broken",
      focusedPaneId: "pane-missing",
      terminalPanes: [
        {
          id: "pane-live",
          machineId: "machine-live",
          mode: "local",
          prompt: "PS>",
          status: "online",
          title: "Live",
        },
      ],
      terminalTabs: [
        {
          id: "tab-broken",
          layout: { paneId: "pane-missing", type: "pane" },
          machineId: "machine-missing",
          title: "Broken",
        },
        {
          id: "tab-live",
          layout: {
            children: [
              { paneId: "pane-missing", type: "pane" },
              { paneId: "pane-live", type: "pane" },
            ],
            direction: "horizontal",
            id: "split-4",
            type: "split",
          },
          machineId: "machine-live",
          title: "Live",
        },
      ],
    });

    expect(session.activeTabId).toBe("tab-live");
    expect(session.focusedPaneId).toBe("pane-live");
    expect(session.terminalPanes.map((pane) => pane.id)).toEqual(["pane-live"]);
    expect(session.terminalTabs).toEqual([
      {
        id: "tab-live",
        layout: { paneId: "pane-live", type: "pane" },
        machineId: "machine-live",
        title: "Live",
      },
    ]);
  });

  it("preserves remote host production flags for restored panes", () => {
    const session = normalizeWorkspaceSessionSnapshot({
      activeTabId: "tab-1",
      focusedPaneId: "pane-1",
      selectedMachineId: "",
      terminalPanes: [
        {
          id: "pane-1",
          machineId: "host-prod",
          mode: "ssh",
          prompt: "root@prod:~$",
          remoteHostId: "host-prod",
          remoteHostProduction: true,
          status: "warning",
          title: "prod",
        },
      ],
      terminalTabs: [
        {
          id: "tab-1",
          layout: { paneId: "pane-1", type: "pane" },
          machineId: "host-prod",
          title: "prod",
        },
      ],
    });

    expect(session.terminalPanes[0]?.remoteHostProduction).toBe(true);
    expect(session.selectedMachineId).toBe("host-prod");
  });

  it("preserves tmux attach metadata and SSH remote command for restored panes", () => {
    const session = normalizeWorkspaceSessionSnapshot({
      activeTabId: "tab-1",
      focusedPaneId: "pane-1",
      selectedMachineId: "",
      terminalPanes: [
        {
          id: "pane-1",
          machineId: "host-prod",
          mode: "ssh",
          prompt: "root@prod:~$",
          remoteCommand: "tmux attach-session -t $0",
          remoteHostId: "host-prod",
          status: "online",
          title: "tmux: api",
          tmuxBinding: {
            attachedAt: "1",
            sessionId: "$0",
            sessionName: "api",
            socketName: "main",
            targetRef: "ssh:host-prod",
          },
        },
      ],
      terminalTabs: [
        {
          id: "tab-1",
          layout: { paneId: "pane-1", type: "pane" },
          machineId: "host-prod",
          title: "tmux: api",
        },
      ],
    });

    expect(session.terminalPanes[0]).toMatchObject({
      remoteCommand: "tmux attach-session -t $0",
      tmuxBinding: {
        attachedAt: "1",
        sessionId: "$0",
        sessionName: "api",
        socketName: "main",
        targetRef: "ssh:host-prod",
      },
    });
  });

  it("ignores non-boolean remote host production flags from older snapshots", () => {
    const session = normalizeWorkspaceSessionSnapshot({
      activeTabId: "tab-1",
      focusedPaneId: "pane-1",
      terminalPanes: [
        {
          id: "pane-1",
          machineId: "host-prod",
          mode: "ssh",
          prompt: "root@prod:~$",
          remoteHostId: "host-prod",
          remoteHostProduction: "true",
          status: "warning",
          title: "prod",
        },
      ],
      terminalTabs: [
        {
          id: "tab-1",
          layout: { paneId: "pane-1", type: "pane" },
          machineId: "host-prod",
          title: "prod",
        },
      ],
    });

    expect(session.terminalPanes[0]?.remoteHostProduction).toBeUndefined();
  });

  it("normalizes terminal tab group preferences", () => {
    const session = normalizeWorkspaceSessionSnapshot({
      activeTabId: "tab-1",
      focusedPaneId: "pane-1",
      terminalPanes: [
        {
          id: "pane-1",
          machineId: "host-prod",
          mode: "ssh",
          prompt: "root@prod:~$",
          remoteHostId: "host-prod",
          status: "online",
          title: "prod",
        },
      ],
      terminalTabGroupPreferences: {
        "host-prod": {
          color: "pink",
          title: " 生产组 ",
        },
        "host-test": {
          color: "unsupported",
          title: "",
        },
      },
      terminalTabs: [
        {
          id: "tab-1",
          layout: { paneId: "pane-1", type: "pane" },
          machineId: "host-prod",
          title: "prod",
        },
      ],
    });

    expect(session.terminalTabGroupPreferences).toEqual({
      "host-prod": {
        color: "pink",
        title: "生产组",
      },
    });
  });

  it("normalizes persisted shell layout", () => {
    const session = normalizeWorkspaceSessionSnapshot({
      activeTabId: "",
      focusedPaneId: "",
      selectedMachineId: "",
      shellLayout: {
        collapsedMachineGroupIds: ["group-b", "", "group-a", "group-b"],
        leftPanelCollapsed: true,
        leftPanelWidth: 999,
        toolPanelWidth: 120,
      },
      terminalPanes: [],
      terminalTabs: [],
    });

    expect(session.shellLayout).toEqual({
      collapsedMachineGroupIds: ["group-a", "group-b"],
      leftPanelCollapsed: true,
      leftPanelWidth: 520,
      toolPanelWidth: 300,
    });
  });

  it("normalizes persisted terminal split sizes", () => {
    const session = normalizeWorkspaceSessionSnapshot({
      activeTabId: "tab-1",
      focusedPaneId: "pane-a",
      selectedMachineId: "machine-local",
      terminalPanes: [
        {
          id: "pane-a",
          machineId: "machine-local",
          mode: "local",
          prompt: "PS>",
          status: "online",
          title: "A",
        },
        {
          id: "pane-b",
          machineId: "machine-local",
          mode: "local",
          prompt: "PS>",
          status: "online",
          title: "B",
        },
      ],
      terminalTabs: [
        {
          id: "tab-1",
          layout: {
            children: [
              { paneId: "pane-a", type: "pane" },
              { paneId: "pane-b", type: "pane" },
            ],
            direction: "horizontal",
            id: "split-1",
            sizes: {
              "pane-a": 33.3333,
              "pane-b": 66.6666,
              "pane-stale": 1,
            },
            type: "split",
          },
          machineId: "machine-local",
          title: "Local",
        },
      ],
    });

    expect(session.terminalTabs[0]).toMatchObject({
      layout: {
        sizes: {
          "pane-a": 33.333,
          "pane-b": 66.667,
        },
      },
    });
  });

  it("preserves local sidebar machine group assignment", () => {
    const session = normalizeWorkspaceSessionSnapshot({
      activeTabId: "",
      focusedPaneId: "",
      selectedMachineId: "machine-local-1",
      sidebarMachines: [
        {
          id: "machine-local-1",
          kind: "local",
          name: "工具终端",
          remoteGroupId: "group-tools",
          status: "online",
          tags: ["local"],
        },
      ],
      terminalPanes: [],
      terminalTabs: [],
    });

    expect(session.sidebarMachines[0]).toMatchObject({
      id: "machine-local-1",
      kind: "local",
      remoteGroupId: "group-tools",
    });
  });

  it("restores SFTP transfer tabs without requiring terminal panes", () => {
    const session = normalizeWorkspaceSessionSnapshot({
      activeTabId: "tab-sftp-transfer-4",
      focusedPaneId: "pane-stale",
      selectedMachineId: "",
      terminalPanes: [],
      terminalTabs: [
        {
          id: "tab-sftp-transfer-4",
          kind: "sftpTransfer",
          leftHostId: "host-left",
          lockedLeftHostId: "host-left",
          machineId: "host-left",
          rightHostId: "host-right",
          title: "host-left 传输",
        },
      ],
    });

    expect(session.activeTabId).toBe("tab-sftp-transfer-4");
    expect(session.focusedPaneId).toBe("");
    expect(session.selectedMachineId).toBe("host-right");
    expect(session.terminalPanes).toEqual([]);
    expect(session.terminalTabs[0]).toMatchObject({
      kind: "sftpTransfer",
      leftHostId: "host-left",
      lockedLeftHostId: "host-left",
      rightHostId: "host-right",
    });
  });

  it("does not select the synthetic SFTP transfer machine id", () => {
    const session = normalizeWorkspaceSessionSnapshot({
      activeTabId: "tab-sftp-transfer-1",
      focusedPaneId: "",
      selectedMachineId: "",
      terminalPanes: [],
      terminalTabs: [
        {
          id: "tab-sftp-transfer-1",
          kind: "sftpTransfer",
          title: "SFTP 传输",
        },
      ],
    });

    expect(session.activeTabId).toBe("tab-sftp-transfer-1");
    expect(session.focusedPaneId).toBe("");
    expect(session.selectedMachineId).toBe("");
    expect(session.terminalTabs[0]).toMatchObject({
      kind: "sftpTransfer",
      machineId: "sftp-transfer",
    });
  });

  it("restores workspace file tabs without terminal panes or file content", () => {
    const session = normalizeWorkspaceSessionSnapshot({
      activeTabId: "tab-file-1",
      focusedPaneId: "pane-stale",
      selectedMachineId: "",
      terminalPanes: [],
      terminalTabs: [
        {
          access: "readonly",
          content: "must not be persisted",
          id: "tab-file-1",
          kind: "workspaceFile",
          machineId: "host-prod",
          path: " /etc//app.yaml ",
          rootPath: " /etc ",
          savedContent: "must not be persisted",
          source: "sftp",
          target: { hostId: "host-prod", kind: "ssh" },
          title: "stale title",
        },
      ],
    });

    expect(session.activeTabId).toBe("tab-file-1");
    expect(session.focusedPaneId).toBe("");
    expect(session.selectedMachineId).toBe("host-prod");
    expect(session.terminalPanes).toEqual([]);
    expect(session.terminalTabs[0]).toEqual({
      access: "readonly",
      id: "tab-file-1",
      kind: "workspaceFile",
      machineId: "host-prod",
      path: "/etc/app.yaml",
      rootPath: "/etc",
      source: "sftp",
      target: { hostId: "host-prod", kind: "ssh" },
      title: "app.yaml",
    });
  });

  it("trims restored output history without keeping a dangling surrogate", () => {
    const outputHistory = `\uD83D\uDE00${"b".repeat(
      TERMINAL_OUTPUT_HISTORY_MAX_CHARS - 1,
    )}`;
    const session = normalizeWorkspaceSessionSnapshot({
      activeTabId: "tab-1",
      focusedPaneId: "pane-1",
      terminalPanes: [
        {
          id: "pane-1",
          machineId: "machine-local",
          mode: "local",
          outputHistory,
          prompt: "PS>",
          status: "online",
          title: "Local",
        },
      ],
      terminalTabs: [
        {
          id: "tab-1",
          layout: { paneId: "pane-1", type: "pane" },
          machineId: "machine-local",
          title: "Local",
        },
      ],
    });

    expect(session.terminalPanes[0]?.outputHistory).toBe(
      "b".repeat(TERMINAL_OUTPUT_HISTORY_MAX_CHARS - 1),
    );
  });

  it("preserves restorable pane runtime fields and drops transient lines", () => {
    const session = normalizeWorkspaceSessionSnapshot({
      activeTabId: "tab-1",
      focusedPaneId: "pane-1",
      terminalPanes: [
        {
          args: ["-NoLogo"],
          currentCwd: "C:/repo/src",
          cwd: "C:/repo",
          env: { NODE_ENV: "test" },
          id: "pane-1",
          lines: ["transient render line"],
          machineId: "machine-local",
          mode: "local",
          outputHistory: "restored terminal history",
          profileId: "profile-pwsh",
          prompt: "PS>",
          shell: "pwsh",
          status: "online",
          target: { kind: "local", profileId: "profile-pwsh" },
          title: "Local",
        },
      ],
      terminalTabs: [
        {
          id: "tab-1",
          layout: { paneId: "pane-1", type: "pane" },
          machineId: "machine-local",
          title: "Local",
        },
      ],
    });

    expect(session.terminalPanes[0]).toMatchObject({
      args: ["-NoLogo"],
      currentCwd: "C:/repo/src",
      cwd: "C:/repo",
      env: { NODE_ENV: "test" },
      outputHistory: "restored terminal history",
      profileId: "profile-pwsh",
      shell: "pwsh",
      target: { kind: "local", profileId: "profile-pwsh" },
    });
    expect(session.terminalPanes[0]?.lines).toEqual([]);
  });

  it("does not derive pane targets from snapshots that omit target refs", () => {
    const session = normalizeWorkspaceSessionSnapshot({
      activeTabId: "tab-1",
      focusedPaneId: "pane-1",
      terminalPanes: [
        {
          id: "pane-1",
          machineId: "machine-local",
          mode: "local",
          profileId: "profile-pwsh",
          prompt: "PS>",
          status: "online",
          title: "Local",
        },
      ],
      terminalTabs: [
        {
          id: "tab-1",
          layout: { paneId: "pane-1", type: "pane" },
          machineId: "machine-local",
          title: "Local",
        },
      ],
    });

    expect(session.terminalPanes[0]?.target).toBeUndefined();
  });

  it("keeps append output history bounded and stable for empty chunks", () => {
    const currentHistory = "stable";

    expect(appendTerminalOutputHistory(currentHistory, "")).toBe(currentHistory);
    expect(
      appendTerminalOutputHistory(
        "a".repeat(TERMINAL_OUTPUT_HISTORY_MAX_CHARS - 1),
        "bc",
      ),
    ).toEqual(`${"a".repeat(TERMINAL_OUTPUT_HISTORY_MAX_CHARS - 2)}bc`);
    expect(
      appendTerminalOutputHistory(
        `\uD83D\uDE00${"b".repeat(TERMINAL_OUTPUT_HISTORY_MAX_CHARS - 2)}`,
        "c",
      ),
    ).toEqual(`${"b".repeat(TERMINAL_OUTPUT_HISTORY_MAX_CHARS - 2)}c`);
  });
});
