// @author kongweiguang

import { describe, expect, it } from "vitest";
import {
  createContainerTerminalOpenState,
  createLocalTerminalOpenState,
  createSerialTerminalOpenState,
  createSshTerminalOpenState,
  createTelnetTerminalOpenState,
  focusExistingMachineTabState,
  syncContainerTerminalOpenState,
  type TerminalOpenStateSlice,
} from "../../../../src/features/workspace/workspaceTerminalOpenState";
import { dockerContainerTarget } from "../../../../src/lib/targetModel";
import type { Machine } from "../../../../src/features/workspace/types";
import {
  buildMachineGroups,
  containerToMachine,
  localMachineIdForProfile,
} from "../../../../src/features/workspace/workspaceMachineModel";
import {
  apiContainer,
  pwshProfile,
  remoteHostTree,
  remoteHostTreeWithTerminalTransports,
} from "../../support/workspace/workspaceStore.testSupport";

function openState(
  overrides: Partial<TerminalOpenStateSlice> = {},
): TerminalOpenStateSlice {
  return {
    activeTabId: "",
    focusedPaneId: "",
    machineGroups: [],
    selectedMachineId: "",
    terminalPanes: [],
    terminalTabs: [],
    ...overrides,
  };
}

describe("workspaceTerminalOpenState", () => {
  it("returns no state patch for missing or mismatched open targets", () => {
    const localMachine: Machine = {
      description: "Local",
      id: "machine-local",
      kind: "local",
      name: "Local",
      status: "online",
      tags: ["local"],
    };

    expect(
      createSshTerminalOpenState(openState(), undefined, {
        paneId: "pane-ssh-1",
        tabId: "tab-ssh-1",
      }),
    ).toEqual({});
    expect(
      createSshTerminalOpenState(openState(), localMachine, {
        paneId: "pane-ssh-1",
        tabId: "tab-ssh-1",
      }),
    ).toEqual({});
    expect(focusExistingMachineTabState(openState(), "missing")).toBeUndefined();
  });

  it("builds a profile-backed local terminal without losing launch config", () => {
    const machineId = localMachineIdForProfile(pwshProfile.id);
    const patch = createLocalTerminalOpenState(openState(), {
      groupId: "group-tools",
      machineId,
      paneId: "pane-local-1",
      profile: pwshProfile,
      tabId: "tab-local-1",
      title: pwshProfile.name,
    });

    expect(patch).toMatchObject({
      activeTabId: "tab-local-1",
      focusedPaneId: "pane-local-1",
      selectedMachineId: machineId,
    });
    expect(patch.terminalTabs).toMatchObject([
      {
        id: "tab-local-1",
        machineId,
        title: "PowerShell 7",
      },
    ]);
    expect(patch.terminalPanes).toMatchObject([
      {
        args: ["-NoLogo"],
        cwd: "C:\\dev",
        env: { TERM: "xterm-256color" },
        machineId,
        profileId: "profile-pwsh",
        shell: "pwsh.exe",
        target: { kind: "local", profileId: "profile-pwsh" },
      },
    ]);
    expect(patch.machineGroups?.[0]?.machines[0]).toMatchObject({
      args: ["-NoLogo"],
      cwd: "C:\\dev",
      env: { TERM: "xterm-256color" },
      id: machineId,
      kind: "local",
      profileId: "profile-pwsh",
      remoteGroupId: "group-tools",
      shell: "pwsh.exe",
      target: { kind: "local", profileId: "profile-pwsh" },
    });
  });

  it("preserves remote prompts and targets", () => {
    const sshMachine = buildMachineGroups(remoteHostTree)[0].machines[0];
    const [telnetMachine, serialMachine] = buildMachineGroups(
      remoteHostTreeWithTerminalTransports,
    )[0].machines;

    const sshPatch = createSshTerminalOpenState(openState(), sshMachine, {
      paneId: "pane-ssh-3",
      tabId: "tab-ssh-2",
    });
    const telnetPatch = createTelnetTerminalOpenState(
      openState(),
      telnetMachine,
      {
        paneId: "pane-telnet-4",
        tabId: "tab-telnet-3",
      },
    );
    const serialPatch = createSerialTerminalOpenState(
      openState(),
      serialMachine,
      {
        paneId: "pane-serial-5",
        tabId: "tab-serial-4",
      },
    );

    expect(sshPatch.terminalPanes?.[0]).toMatchObject({
      id: "pane-ssh-3",
      mode: "ssh",
      prompt: "root@192.168.1.253:~$",
      remoteHostId: "host-lab",
      target: { hostId: "host-lab", kind: "ssh" },
    });
    expect(telnetPatch.terminalPanes?.[0]).toMatchObject({
      id: "pane-telnet-4",
      mode: "telnet",
      prompt: "lab.internal:2323>",
      target: { hostId: "telnet-lab", kind: "telnet" },
    });
    expect(serialPatch.terminalPanes?.[0]).toMatchObject({
      id: "pane-serial-5",
      mode: "serial",
      prompt: "COM9>",
      target: { hostId: "serial-console", kind: "serial" },
    });
  });

  it("focuses an already-open machine tab without returning duplicate panes", () => {
    const hostMachine = buildMachineGroups(remoteHostTree)[0].machines[0];
    const containerMachine = containerToMachine(apiContainer, hostMachine, {
      shell: "exec bash -l",
      user: "root",
      workdir: "/workspace",
    });
    const opened = createContainerTerminalOpenState(
      openState(),
      containerMachine,
      {
        paneId: "pane-container-5",
        tabId: "tab-container-4",
      },
    );
    const focusPatch = focusExistingMachineTabState(
      openState({
        activeTabId: "tab-local-1",
        focusedPaneId: "pane-local-1",
        terminalPanes: opened.terminalPanes ?? [],
        terminalTabs: opened.terminalTabs ?? [],
      }),
      containerMachine.id,
    );

    expect(focusPatch).toEqual({
      activeTabId: "tab-container-4",
      focusedPaneId: "pane-container-5",
      selectedMachineId: "docker:host-lab:c0ffee1234567890",
    });
    expect(focusPatch).not.toHaveProperty("terminalPanes");
    expect(focusPatch).not.toHaveProperty("terminalTabs");
  });

  it("syncs refreshed container metadata without overwriting live runtime fields", () => {
    const hostMachine = buildMachineGroups(remoteHostTree)[0].machines[0];
    const containerMachine = containerToMachine(apiContainer, hostMachine, {
      shell: "exec bash -l",
      user: "root",
      workdir: "/workspace",
    });
    const opened = createContainerTerminalOpenState(
      openState(),
      containerMachine,
      {
        paneId: "pane-container-5",
        tabId: "tab-container-4",
      },
    );
    const openedState = openState({
      activeTabId: "tab-container-4",
      focusedPaneId: "pane-container-5",
      terminalPanes: (opened.terminalPanes ?? []).map((pane) => ({
        ...pane,
        currentCwd: "/runtime-cwd",
        lines: ["runtime output"],
        outputHistory: "tail output",
      })),
      terminalTabs: opened.terminalTabs ?? [],
    });
    const refreshedMachine = containerToMachine(
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
      hostMachine,
      {
        shell: "exec sh",
        user: "app",
        workdir: "/srv",
      },
    );

    const patch = syncContainerTerminalOpenState(openedState, refreshedMachine);

    expect(patch).not.toBe(openedState);
    expect(patch.terminalTabs?.[0]).toMatchObject({
      id: "tab-container-4",
      title: "api-renamed",
    });
    expect(patch.terminalPanes?.[0]).toMatchObject({
      currentCwd: "/runtime-cwd",
      lines: ["runtime output"],
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
});
