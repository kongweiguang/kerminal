// @author kongweiguang

import { beforeEach, describe, expect, it } from "vitest";
import { defaultAppSettings } from "../../../../src/features/settings/settingsModel";
import { browserPreviewProfiles } from "../../../../src/lib/profileApi";
import { dockerContainerTarget } from "../../../../src/lib/targetModel";
import {
  localMachineIdForProfile,
  useWorkspaceStore,
} from "../../../../src/features/workspace/workspaceStore";
import {
  apiContainer,
  bashProfile,
  pwshProfile,
  resetWorkspaceStore,
  remoteHostTree,
  remoteHostTreeWithRdp,
  remoteHostTreeWithTerminalTransports,
  remoteHostTreeWithTools,
  unorderedRemoteHostTree,
} from "../../support/workspace/workspaceStore.testSupport";

describe("workspaceStore", () => {
  beforeEach(() => {
    resetWorkspaceStore();
  });

  it("tracks selected machine, focused pane and active tool independently", () => {
    useWorkspaceStore.getState().addTerminalTab({ title: "本地 PowerShell" });
    useWorkspaceStore.getState().selectMachine("local-powershell");
    useWorkspaceStore.getState().focusPane("pane-local-1");
    useWorkspaceStore.getState().setActiveTool("sftp");

    expect(useWorkspaceStore.getState().selectedMachineId).toBe("local-powershell");
    expect(useWorkspaceStore.getState().focusedPaneId).toBe("pane-local-1");
    expect(useWorkspaceStore.getState().activeTool).toBe("sftp");
  });

  it("keeps right-panel selection bound to each tab until that tab closes", () => {
    useWorkspaceStore.getState().addTerminalTab({ title: "tab A" });
    const tabA = useWorkspaceStore.getState().activeTabId;
    useWorkspaceStore.getState().setActiveTool("agentLauncher");

    useWorkspaceStore.getState().addTerminalTab({ title: "tab B" });
    const tabB = useWorkspaceStore.getState().activeTabId;
    expect(useWorkspaceStore.getState().activeTool).toBe("agentLauncher");
    expect(useWorkspaceStore.getState().activeToolByTabId).toMatchObject({
      [tabA]: "agentLauncher",
      [tabB]: "agentLauncher",
    });
    useWorkspaceStore.getState().setActiveTool(null);
    useWorkspaceStore.getState().selectTab(tabA);
    expect(useWorkspaceStore.getState().activeTool).toBe("agentLauncher");
    useWorkspaceStore.getState().selectTab(tabB);
    expect(useWorkspaceStore.getState().activeTool).toBeNull();
    useWorkspaceStore.getState().setActiveTool("sftp");

    useWorkspaceStore.getState().selectTab(tabA);
    expect(useWorkspaceStore.getState().activeTool).toBe("agentLauncher");

    useWorkspaceStore.getState().selectTab(tabB);
    expect(useWorkspaceStore.getState().activeTool).toBe("sftp");
    useWorkspaceStore.getState().closeTerminalTab(tabB);

    expect(useWorkspaceStore.getState().activeTabId).toBe(tabA);
    expect(useWorkspaceStore.getState().activeTool).toBe("agentLauncher");
    expect(useWorkspaceStore.getState().activeToolByTabId).toEqual({
      [tabA]: "agentLauncher",
    });
  });

  it("tracks sidebar search and broadcast drafts", () => {
    useWorkspaceStore.getState().setMachineSearch("prod");
    useWorkspaceStore.getState().setBroadcastDraft("uptime");

    expect(useWorkspaceStore.getState().machineSearch).toBe("prod");
    expect(useWorkspaceStore.getState().broadcastDraft).toBe("uptime");
  });

  it("updates a pane runtime cwd without changing its startup cwd", () => {
    useWorkspaceStore.getState().setRemoteHostTree(remoteHostTree);
    useWorkspaceStore.getState().openSshTerminal("host-lab");
    const pane = useWorkspaceStore
      .getState()
      .terminalPanes.find((candidate) => candidate.remoteHostId === "host-lab");

    expect(pane).toBeDefined();
    expect(pane?.remoteHostProduction).toBe(true);
    useWorkspaceStore
      .getState()
      .updatePaneCurrentCwd(pane?.id ?? "", "/var/log");

    const updatedPane = useWorkspaceStore
      .getState()
      .terminalPanes.find((candidate) => candidate.id === pane?.id);
    expect(updatedPane?.currentCwd).toBe("/var/log");
    expect(updatedPane?.cwd).toBeUndefined();
  });

  it("moves terminal panes by updating layout without replacing pane runtime data", () => {
    useWorkspaceStore.getState().restoreWorkspaceSession({
      activeTabId: "tab-local-1",
      focusedPaneId: "pane-local-1",
      selectedMachineId: "local-powershell",
      sidebarMachines: [],
      terminalPanes: [
        {
          id: "pane-local-1",
          lines: ["left"],
          machineId: "local-powershell",
          mode: "local",
          prompt: "$",
          status: "online",
          title: "left",
        },
        {
          id: "pane-local-2",
          lines: ["right"],
          machineId: "local-powershell",
          mode: "local",
          prompt: "$",
          status: "online",
          title: "right",
        },
      ],
      terminalTabs: [
        {
          id: "tab-local-1",
          layout: {
            children: [
              { paneId: "pane-local-1", type: "pane" },
              { paneId: "pane-local-2", type: "pane" },
            ],
            direction: "horizontal",
            id: "split-1",
            type: "split",
          },
          machineId: "local-powershell",
          title: "local",
        },
      ],
    });
    const panesBefore = useWorkspaceStore.getState().terminalPanes;

    useWorkspaceStore
      .getState()
      .moveTerminalPane("pane-local-1", "pane-local-2", "right");

    const state = useWorkspaceStore.getState();
    expect(state.focusedPaneId).toBe("pane-local-1");
    expect(state.terminalPanes).toBe(panesBefore);
    expect(state.terminalTabs[0]).toMatchObject({
      layout: {
        children: [
          { paneId: "pane-local-2", type: "pane" },
          { paneId: "pane-local-1", type: "pane" },
        ],
        direction: "horizontal",
        type: "split",
      },
    });
  });

  it("skips unchanged pane runtime updates to avoid redundant store notifications", () => {
    useWorkspaceStore.getState().addTerminalTab({ title: "本地 PowerShell" });
    let notificationCount = 0;
    const unsubscribe = useWorkspaceStore.subscribe(() => {
      notificationCount += 1;
    });
    const initialPanes = useWorkspaceStore.getState().terminalPanes;

    useWorkspaceStore.getState().updatePaneOutputHistory("missing-pane", "output");
    useWorkspaceStore.getState().updatePaneOutputHistory("pane-local-1", undefined);
    useWorkspaceStore.getState().updatePaneCurrentCwd("pane-local-1", "");

    expect(notificationCount).toBe(1);
    expect(useWorkspaceStore.getState().terminalPanes).not.toBe(initialPanes);

    const updatedPanes = useWorkspaceStore.getState().terminalPanes;
    useWorkspaceStore.getState().updatePaneCurrentCwd("pane-local-1", "");
    useWorkspaceStore.getState().updatePaneOutputHistory("pane-local-1", undefined);

    expect(notificationCount).toBe(1);
    expect(useWorkspaceStore.getState().terminalPanes).toBe(updatedPanes);

    const runtimePanes = useWorkspaceStore.getState().terminalPanes;
    useWorkspaceStore
      .getState()
      .updatePaneOutputHistory("pane-local-1", "latest output");
    expect(notificationCount).toBe(2);

    const outputPanes = useWorkspaceStore.getState().terminalPanes;
    useWorkspaceStore
      .getState()
      .updatePaneOutputHistory("pane-local-1", "latest output");
    expect(notificationCount).toBe(2);
    expect(useWorkspaceStore.getState().terminalPanes).toBe(outputPanes);
    expect(outputPanes).not.toBe(runtimePanes);

    unsubscribe();
  });

  it("syncs restored pane production flags when remote hosts refresh", () => {
    useWorkspaceStore.getState().restoreWorkspaceSession({
      activeTabId: "tab-ssh-1",
      focusedPaneId: "pane-ssh-1",
      selectedMachineId: "host-lab",
      sidebarMachines: [],
      terminalPanes: [
        {
          id: "pane-ssh-1",
          machineId: "host-lab",
          mode: "ssh",
          prompt: "root@192.168.1.253:~$",
          remoteHostId: "host-lab",
          status: "offline",
          title: "lab server",
          lines: [],
        },
      ],
      terminalTabs: [
        {
          id: "tab-ssh-1",
          layout: { paneId: "pane-ssh-1", type: "pane" },
          machineId: "host-lab",
          title: "lab server",
        },
      ],
    });

    expect(
      useWorkspaceStore.getState().terminalPanes[0]?.remoteHostProduction,
    ).toBeUndefined();

    useWorkspaceStore.getState().setRemoteHostTree(remoteHostTree);

    expect(useWorkspaceStore.getState().terminalPanes[0]).toMatchObject({
      remoteHostId: "host-lab",
      remoteHostProduction: true,
    });
  });

  it("keeps the restored active remote tab selected while profiles and hosts load", () => {
    useWorkspaceStore.getState().restoreWorkspaceSession({
      activeTabId: "tab-ssh-1",
      focusedPaneId: "pane-ssh-1",
      selectedMachineId: localMachineIdForProfile("profile-pwsh"),
      sidebarMachines: [
        {
          id: localMachineIdForProfile("profile-pwsh"),
          kind: "local",
          name: "PowerShell 7",
          profileId: "profile-pwsh",
          remoteGroupId: "__ungrouped__",
          status: "online",
          tags: ["local"],
          description: "pwsh.exe",
        },
      ],
      terminalPanes: [
        {
          id: "pane-ssh-1",
          machineId: "host-lab",
          mode: "ssh",
          prompt: "root@192.168.1.253:~$",
          remoteHostId: "host-lab",
          status: "offline",
          title: "lab server",
          lines: [],
        },
      ],
      terminalTabs: [
        {
          id: "tab-ssh-1",
          layout: { paneId: "pane-ssh-1", type: "pane" },
          machineId: "host-lab",
          title: "lab server",
        },
      ],
    });

    expect(useWorkspaceStore.getState().selectedMachineId).toBe("host-lab");

    useWorkspaceStore.getState().setProfiles([pwshProfile, bashProfile]);
    expect(useWorkspaceStore.getState().selectedMachineId).toBe("host-lab");

    useWorkspaceStore.getState().setRemoteHostTree(remoteHostTree);
    const state = useWorkspaceStore.getState();
    expect(state.selectedMachineId).toBe("host-lab");
    expect(state.machineGroups[0].machines[0]).toMatchObject({
      id: localMachineIdForProfile("profile-pwsh"),
      status: "offline",
    });
  });

  it("clears a restored sidebar-only SSH selection for an empty workspace", () => {
    useWorkspaceStore.getState().restoreWorkspaceSession({
      activeTabId: "",
      focusedPaneId: "",
      selectedMachineId: "host-lab",
      sidebarMachines: [],
      terminalPanes: [],
      terminalTabs: [],
    });

    expect(useWorkspaceStore.getState().selectedMachineId).toBe("");

    useWorkspaceStore.getState().setProfiles([pwshProfile, bashProfile]);
    expect(useWorkspaceStore.getState().selectedMachineId).toBe("");

    useWorkspaceStore.getState().setRemoteHostTree(remoteHostTree);
    expect(useWorkspaceStore.getState().selectedMachineId).toBe("");
  });

  it("stores normalized app settings", () => {
    useWorkspaceStore.getState().setSettings({
      ...defaultAppSettings,
      terminal: {
        ...defaultAppSettings.terminal,
        fontSize: 99,
        lineHeight: 0.2,
      },
      themeMode: "light",
    });

    expect(useWorkspaceStore.getState().settings).toMatchObject({
      terminal: {
        fontSize: 24,
        lineHeight: 1,
      },
      themeMode: "light",
    });
  });

  it("starts with the browser preview profile as the fallback terminal config", () => {
    const state = useWorkspaceStore.getState();

    expect(state.profiles).toEqual(browserPreviewProfiles);
    expect(state.activeProfileId).toBe(browserPreviewProfiles[0].id);
  });

  it("starts without an implicit terminal tab", () => {
    const state = useWorkspaceStore.getState();

    expect(state.terminalTabs).toEqual([]);
    expect(state.terminalPanes).toEqual([]);
    expect(state.activeTabId).toBe("");
    expect(state.focusedPaneId).toBe("");
  });

  it("loads remote host groups without seeded local sidebar entries", () => {
    useWorkspaceStore.getState().setRemoteHostTree(remoteHostTree);

    const state = useWorkspaceStore.getState();
    expect(state.machineGroups.map((group) => group.title)).toEqual(["实验室"]);
    expect(state.machineGroups[0].machines[0]).toMatchObject({
      authType: "key",
      description: "root@192.168.1.253:2222",
      host: "192.168.1.253",
      id: "host-lab",
      production: true,
      status: "warning",
    });
  });

  it("orders remote groups and hosts by sort order when loading the tree", () => {
    useWorkspaceStore.getState().setRemoteHostTree(unorderedRemoteHostTree);

    const state = useWorkspaceStore.getState();
    expect(state.machineGroups.map((group) => group.id)).toEqual([
      "group-a",
      "group-z",
    ]);
    expect(state.machineGroups[1].machines.map((machine) => machine.id)).toEqual(
      ["host-z-1", "host-z-2"],
    );
  });

  it("maps Telnet and Serial hosts to terminal-only machines and opens panes", () => {
    useWorkspaceStore
      .getState()
      .setRemoteHostTree(remoteHostTreeWithTerminalTransports);

    const state = useWorkspaceStore.getState();
    expect(state.machineGroups[0].machines).toMatchObject([
      {
        description: "lab.internal:2323",
        id: "telnet-lab",
        kind: "telnet",
        target: { hostId: "telnet-lab", kind: "telnet" },
      },
      {
        description: "COM9 · 115200 bps",
        id: "serial-console",
        kind: "serial",
        target: { hostId: "serial-console", kind: "serial" },
      },
    ]);

    useWorkspaceStore.getState().openTelnetTerminal("telnet-lab");
    useWorkspaceStore.getState().openSerialTerminal("serial-console");

    expect(useWorkspaceStore.getState().terminalPanes).toMatchObject([
      {
        machineId: "telnet-lab",
        mode: "telnet",
        prompt: "lab.internal:2323>",
        target: { hostId: "telnet-lab", kind: "telnet" },
      },
      {
        machineId: "serial-console",
        mode: "serial",
        prompt: "COM9>",
        target: { hostId: "serial-console", kind: "serial" },
      },
    ]);
  });

  it("maps RDP-tagged remote hosts as RDP sidebar machines", () => {
    useWorkspaceStore.getState().setRemoteHostTree(remoteHostTreeWithRdp);

    const state = useWorkspaceStore.getState();
    const rdpMachine = state.machineGroups[0].machines[0];

    expect(rdpMachine).toMatchObject({
      authType: "password",
      credentialRef: "credential:rdp/rdp-office/password",
      description: "administrator@rdp.internal:3389",
      host: "rdp.internal",
      id: "rdp-office",
      kind: "rdp",
      name: "office-rdp",
      port: 3389,
      username: "administrator",
    });
    expect(rdpMachine.target).toBeUndefined();
  });

  it("adds a Docker container under its SSH host and opens it with enter options", () => {
    useWorkspaceStore.getState().setRemoteHostTree(remoteHostTree);
    useWorkspaceStore.getState().addDockerContainer(apiContainer, {
      shell: "exec bash -l",
      user: "root",
      workdir: "/workspace",
    });

    const afterAdd = useWorkspaceStore.getState();
    expect(afterAdd.selectedMachineId).toBe("docker:host-lab:c0ffee1234567890");
    expect(afterAdd.machineGroups[0].machines.map((machine) => machine.id)).toEqual([
      "host-lab",
      "docker:host-lab:c0ffee1234567890",
    ]);
    expect(afterAdd.machineGroups[0].machines[1]).toMatchObject({
      kind: "dockerContainer",
      name: "api",
      parentMachineId: "host-lab",
      shell: "exec bash -l",
      user: "root",
      workdir: "/workspace",
    });

    useWorkspaceStore
      .getState()
      .openContainerTerminal("docker:host-lab:c0ffee1234567890");

    const pane = useWorkspaceStore.getState().terminalPanes[0];
    expect(pane).toMatchObject({
      machineId: "docker:host-lab:c0ffee1234567890",
      mode: "container",
      remoteHostId: "host-lab",
      remoteHostProduction: true,
      shell: "exec bash -l",
      target: {
        containerId: "c0ffee1234567890",
        hostId: "host-lab",
        kind: "dockerContainer",
        user: "root",
        workdir: "/workspace",
      },
    });

    useWorkspaceStore
      .getState()
      .openContainerTerminal("docker:host-lab:c0ffee1234567890");
    expect(useWorkspaceStore.getState().terminalTabs).toHaveLength(1);
    expect(useWorkspaceStore.getState().terminalPanes).toHaveLength(1);
  });

  it("syncs refreshed Docker container metadata without replacing live pane runtime state", () => {
    useWorkspaceStore.getState().setRemoteHostTree(remoteHostTree);
    useWorkspaceStore.getState().addDockerContainer(apiContainer, {
      shell: "exec bash -l",
      user: "root",
      workdir: "/workspace",
    });
    useWorkspaceStore
      .getState()
      .openContainerTerminal("docker:host-lab:c0ffee1234567890");
    useWorkspaceStore
      .getState()
      .updatePaneCurrentCwd("pane-container-1", "/runtime-cwd");
    useWorkspaceStore
      .getState()
      .updatePaneOutputHistory("pane-container-1", "tail output");
    useWorkspaceStore
      .getState()
      .renameTerminalTab("tab-container-1", "Pinned container");

    useWorkspaceStore.getState().addDockerContainer(
      {
        ...apiContainer,
        image: "kerminal/api:v2",
        name: "api-renamed",
        status: "exited",
        statusText: "Exited (1) 4 seconds ago",
        target: dockerContainerTarget({
          containerId: apiContainer.id,
          containerName: "api-renamed",
          hostId: apiContainer.hostId,
          runtime: apiContainer.runtime,
        }),
      },
      {
        shell: "exec sh",
        user: "app",
        workdir: "/srv",
      },
    );

    const state = useWorkspaceStore.getState();
    const machine = state.machineGroups[0].machines[1];
    expect(machine).toMatchObject({
      description: "kerminal/api:v2 · Exited (1) 4 seconds ago",
      name: "api-renamed",
      shell: "exec sh",
      status: "warning",
      target: {
        containerName: "api-renamed",
        user: "app",
        workdir: "/srv",
      },
    });
    expect(state.terminalTabs).toHaveLength(1);
    expect(state.terminalTabs[0]).toMatchObject({
      id: "tab-container-1",
      title: "Pinned container",
    });
    expect(state.terminalPanes).toHaveLength(1);
    expect(state.terminalPanes[0]).toMatchObject({
      currentCwd: "/runtime-cwd",
      outputHistory: "tail output",
      prompt: "api-renamed:/$",
      shell: "exec bash -l",
      status: "warning",
      title: "api-renamed",
      target: {
        containerName: "api-renamed",
        user: "root",
        workdir: "/workspace",
      },
    });
  });

  it("adds a local terminal tab to the selected machine group", () => {
    useWorkspaceStore.getState().setRemoteHostTree(remoteHostTree);
    useWorkspaceStore.getState().addTerminalTab({
      groupId: "group-lab",
      title: "工具终端",
    });

    const group = useWorkspaceStore.getState().machineGroups[0];
    expect(group.id).toBe("group-lab");
    expect(group.machines.map((machine) => machine.id)).toEqual([
      "machine-local-1",
      "host-lab",
    ]);
    expect(group.machines[0]).toMatchObject({
      kind: "local",
      name: "工具终端",
      remoteGroupId: "group-lab",
    });
  });

  it("selects the sidebar machine for the active terminal tab", () => {
    useWorkspaceStore.getState().setRemoteHostTree(remoteHostTree);
    useWorkspaceStore.getState().openSshTerminal("host-lab");
    useWorkspaceStore.getState().addTerminalTab({ title: "本地 PowerShell" });

    expect(useWorkspaceStore.getState().selectedMachineId).toBe("machine-local-2");

    useWorkspaceStore.getState().selectTab("tab-ssh-1");

    expect(useWorkspaceStore.getState().activeTabId).toBe("tab-ssh-1");
    expect(useWorkspaceStore.getState().focusedPaneId).toBe("pane-ssh-1");
    expect(useWorkspaceStore.getState().selectedMachineId).toBe("host-lab");
  });

  it("adds a copied local profile card to the requested group", () => {
    useWorkspaceStore.getState().setRemoteHostTree(remoteHostTreeWithTools);

    useWorkspaceStore
      .getState()
      .addLocalProfileMachine(pwshProfile, "group-tools");

    const state = useWorkspaceStore.getState();
    const toolsGroup = state.machineGroups.find(
      (group) => group.id === "group-tools",
    );
    expect(state.selectedMachineId).toBe(localMachineIdForProfile("profile-pwsh"));
    expect(toolsGroup?.machines[0]).toMatchObject({
      id: localMachineIdForProfile("profile-pwsh"),
      kind: "local",
      name: "PowerShell 7",
      remoteGroupId: "group-tools",
      shell: "pwsh.exe",
    });
  });

  it("restores profile-backed local machines from profile sidebar group metadata", () => {
    useWorkspaceStore.getState().setRemoteHostTree(remoteHostTreeWithTools);
    useWorkspaceStore.getState().restoreWorkspaceSession({
      activeTabId: "",
      focusedPaneId: "",
      selectedMachineId: "",
      sidebarMachines: [],
      terminalPanes: [],
      terminalTabs: [],
    });

    useWorkspaceStore.getState().setProfiles([
      bashProfile,
      {
        ...pwshProfile,
        sidebarGroupId: "group-tools",
      },
    ]);

    const state = useWorkspaceStore.getState();
    const toolsGroup = state.machineGroups.find(
      (group) => group.id === "group-tools",
    );
    expect(toolsGroup?.machines[0]).toMatchObject({
      id: localMachineIdForProfile("profile-pwsh"),
      kind: "local",
      name: "PowerShell 7",
      remoteGroupId: "group-tools",
      shell: "pwsh.exe",
    });
    expect(
      state.machineGroups
        .find((group) => group.id === "group-lab")
        ?.machines.some(
          (machine) => machine.id === localMachineIdForProfile("profile-pwsh"),
      ),
    ).toBe(false);
  });


});
