// @author kongweiguang

import { describe, expect, it } from "vitest";
import type {
  MachineGroup,
  TerminalPane,
  TerminalTab,
} from "../../../src/features/workspace/types";
import type { WorkspaceState } from "../../../src/features/workspace/workspaceStore";
import {
  buildOpenMachineIdsSnapshot,
  buildTerminalWorkspaceSnapshot,
  buildToolPanelWorkspaceContext,
  buildToolPanelWorkspaceSnapshot,
  parseTerminalWorkspaceSnapshot,
} from "../../../src/app/KerminalShell.workspaceSelectors.ts";

const tab: TerminalTab = {
  id: "tab-local-1",
  layout: { paneId: "pane-local-1", type: "pane" },
  machineId: "local-pwsh",
  title: "PowerShell",
};

const pane: TerminalPane = {
  currentCwd: "C:/dev/rust/kerminal",
  id: "pane-local-1",
  lines: ["old"],
  machineId: "local-pwsh",
  mode: "local",
  outputHistory: "old output",
  prompt: ">",
  status: "online",
  title: "PowerShell",
};

function workspaceState(overrides: Partial<WorkspaceState> = {}) {
  return {
    activeTabId: tab.id,
    focusedPaneId: pane.id,
    selectedMachineId: "local-pwsh",
    terminalPanes: [pane],
    terminalTabs: [tab],
    ...overrides,
  } as WorkspaceState;
}

describe("KerminalShell workspace selector snapshots", () => {
  it("keeps side chrome snapshots stable when only pane output history changes", () => {
    const base = workspaceState();
    const outputOnlyChange = workspaceState({
      terminalPanes: [
        {
          ...pane,
          lines: ["new visible line"],
          outputHistory: "new output",
        },
      ],
    });

    expect(buildOpenMachineIdsSnapshot(outputOnlyChange)).toBe(
      buildOpenMachineIdsSnapshot(base),
    );
    expect(buildToolPanelWorkspaceSnapshot(outputOnlyChange)).toBe(
      buildToolPanelWorkspaceSnapshot(base),
    );
    expect(buildTerminalWorkspaceSnapshot(outputOnlyChange)).toBe(
      buildTerminalWorkspaceSnapshot(base),
    );
  });

  it("strips high-frequency pane output from terminal workspace snapshots", () => {
    const snapshot = parseTerminalWorkspaceSnapshot(
      buildTerminalWorkspaceSnapshot(workspaceState()),
    );

    expect(snapshot.terminalPanes[0]).toMatchObject({
      currentCwd: "C:/dev/rust/kerminal",
      id: pane.id,
      lines: [],
      machineId: pane.machineId,
      mode: pane.mode,
    });
    expect(snapshot.terminalPanes[0]?.outputHistory).toBeUndefined();
  });

  it("reuses stable terminal panes when only focus changes", () => {
    const first = parseTerminalWorkspaceSnapshot(
      buildTerminalWorkspaceSnapshot(workspaceState()),
    );
    const second = parseTerminalWorkspaceSnapshot(
      buildTerminalWorkspaceSnapshot(
        workspaceState({
          activeTabId: "tab-local-2",
          focusedPaneId: "pane-local-2",
        }),
      ),
    );

    expect(second).not.toBe(first);
    expect(second.terminalPanes).toBe(first.terminalPanes);
    expect(second.terminalTabs).toBe(first.terminalTabs);
  });

  it("does not count SFTP transfer tabs as open terminal sessions", () => {
    const transferTab: TerminalTab = {
      id: "tab-sftp-transfer-1",
      kind: "sftpTransfer",
      machineId: "host-lab",
      rightHostId: "host-lab",
      title: "lab server 传输",
    };

    expect(
      buildOpenMachineIdsSnapshot(
        workspaceState({
          activeTabId: transferTab.id,
          focusedPaneId: "",
          selectedMachineId: "host-lab",
          terminalPanes: [],
          terminalTabs: [transferTab],
        }),
      ),
    ).toBe("[]");
  });

  it("updates the tool panel snapshot when focused pane cwd changes", () => {
    const base = workspaceState();
    const cwdChange = workspaceState({
      terminalPanes: [
        {
          ...pane,
          currentCwd: "C:/dev/rust/kerminal/src",
        },
      ],
    });

    expect(buildToolPanelWorkspaceSnapshot(cwdChange)).not.toBe(
      buildToolPanelWorkspaceSnapshot(base),
    );
  });

  it("keeps the sidebar selection separate from the active tool panel target", () => {
    const machineGroups: MachineGroup[] = [
      {
        id: "local",
        title: "Local",
        machines: [
          {
            description: "Local shell",
            host: "localhost",
            id: "local-pwsh",
            kind: "local",
            name: "PowerShell",
            status: "online",
            tags: [],
          },
        ],
      },
      {
        id: "remote",
        title: "Remote",
        machines: [
          {
            authType: "agent",
            description: "Lab server",
            host: "lab.example.test",
            id: "host-lab",
            kind: "ssh",
            name: "Lab",
            port: 22,
            remoteGroupId: "remote",
            status: "online",
            tags: [],
            username: "ops",
          },
        ],
      },
    ];

    const context = buildToolPanelWorkspaceContext(
      workspaceState({ selectedMachineId: "host-lab" }),
      machineGroups,
    );

    expect(context.focusedPane?.id).toBe("pane-local-1");
    expect(context.activeMachine?.id).toBe("local-pwsh");
    expect(context.selectedMachine?.id).toBe("host-lab");
  });

  it("uses the focused container pane target for the active tool panel target", () => {
    const containerTab: TerminalTab = {
      id: "tab-container-api",
      layout: { paneId: "pane-container-api", type: "pane" },
      machineId: "docker:host-lab:c0ffee1234567890",
      title: "api",
    };
    const containerPane: TerminalPane = {
      containerId: "c0ffee1234567890",
      currentCwd: "/srv/api",
      id: "pane-container-api",
      lines: [],
      machineId: "docker:host-lab:c0ffee1234567890",
      mode: "container",
      prompt: "api:/$",
      remoteHostId: "host-lab",
      status: "online",
      target: {
        containerId: "c0ffee1234567890",
        containerName: "api",
        hostId: "host-lab",
        kind: "dockerContainer",
        runtime: "docker",
      },
      title: "api",
    };
    const machineGroups: MachineGroup[] = [
      {
        id: "remote",
        title: "Remote",
        machines: [
          {
            authType: "agent",
            description: "Lab server",
            host: "lab.example.test",
            id: "host-lab",
            kind: "ssh",
            name: "Lab",
            port: 22,
            remoteGroupId: "remote",
            status: "online",
            tags: [],
            username: "ops",
          },
        ],
      },
    ];

    const context = buildToolPanelWorkspaceContext(
      workspaceState({
        activeTabId: containerTab.id,
        focusedPaneId: containerPane.id,
        selectedMachineId: containerPane.machineId,
        terminalPanes: [containerPane],
        terminalTabs: [containerTab],
      }),
      machineGroups,
    );

    expect(context.activeMachine).toMatchObject({
      host: "lab.example.test",
      id: "docker:host-lab:c0ffee1234567890",
      kind: "dockerContainer",
      name: "api",
      parentMachineId: "host-lab",
      username: "ops",
      workdir: "/srv/api",
    });
    expect(context.activeMachine?.target).toMatchObject({
      containerId: "c0ffee1234567890",
      containerName: "api",
      hostId: "host-lab",
      kind: "dockerContainer",
      runtime: "docker",
      workdir: "/srv/api",
    });
    expect(context.selectedMachine?.id).toBe(context.activeMachine?.id);
  });

  it("does not fall back to the sidebar selection for the active tool panel target", () => {
    const machineGroups: MachineGroup[] = [
      {
        id: "remote",
        title: "Remote",
        machines: [
          {
            authType: "agent",
            description: "Lab server",
            host: "lab.example.test",
            id: "host-lab",
            kind: "ssh",
            name: "Lab",
            port: 22,
            remoteGroupId: "remote",
            status: "online",
            tags: [],
            username: "ops",
          },
        ],
      },
    ];

    const context = buildToolPanelWorkspaceContext(
      workspaceState({
        activeTabId: "",
        focusedPaneId: "",
        selectedMachineId: "host-lab",
        terminalPanes: [],
        terminalTabs: [],
      }),
      machineGroups,
    );

    expect(context.activeMachine).toBeUndefined();
    expect(context.selectedMachine?.id).toBe("host-lab");
  });
});
