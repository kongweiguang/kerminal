// @author kongweiguang

import { describe, expect, it } from "vitest";
import {
  updateRemoteHostTreeState,
  updateWorkspaceProfilesState,
} from "../../../../src/features/workspace/workspaceSidebarState";
import { localMachineIdForProfile } from "../../../../src/features/workspace/workspaceMachineModel";
import {
  bashProfile,
  pwshProfile,
  remoteHostTree,
} from "../../support/workspace/workspaceStore.testSupport";
import type {
  MachineGroup,
  TerminalTab,
} from "../../../../src/features/workspace/types";

describe("workspaceSidebarState", () => {
  it("selects the default profile without creating implicit sidebar machines", () => {
    const patch = updateWorkspaceProfilesState(
      {
        activeProfileId: "missing-profile",
        activeTabId: "",
        machineGroups: [],
        removedSidebarMachineIds: [],
        selectedMachineId: "",
        terminalTabs: [],
      },
      [pwshProfile, bashProfile],
    );

    expect(patch.activeProfileId).toBe("profile-bash");
    expect(patch.profiles).toEqual([pwshProfile, bashProfile]);
    expect(patch.machineGroups).toEqual([]);
    expect(patch.selectedMachineId).toBe("");
  });

  it("restores a profile-declared sidebar machine and clears its removal marker", () => {
    const machineId = localMachineIdForProfile(pwshProfile.id);
    const sidebarProfile = {
      ...pwshProfile,
      sidebarGroupId: "group-local",
    };
    const patch = updateWorkspaceProfilesState(
      {
        activeProfileId: pwshProfile.id,
        activeTabId: "",
        machineGroups: [],
        removedSidebarMachineIds: [machineId, "other"],
        selectedMachineId: machineId,
        terminalTabs: [],
      },
      [sidebarProfile],
    );

    expect(patch.machineGroups[0]).toMatchObject({
      id: "group-local",
      machines: [{ id: machineId, kind: "local" }],
    });
    expect(patch.removedSidebarMachineIds).toEqual(["other"]);
    expect(patch.selectedMachineId).toBe(machineId);
  });

  it("preserves local sidebar machines while refreshing remote hosts", () => {
    const machineGroups: MachineGroup[] = [
      {
        id: "__ungrouped__",
        title: "本地会话",
        machines: [
          {
            description: "pwsh",
            id: "local-manual",
            kind: "local",
            name: "本地终端",
            status: "offline",
            tags: ["local"],
          },
        ],
      },
    ];
    const terminalTabs: TerminalTab[] = [
      {
        id: "tab-host",
        layout: { paneId: "pane-host", type: "pane" },
        machineId: "host-lab",
        title: "host",
      },
    ];
    const patch = updateRemoteHostTreeState(
      {
        activeTabId: "tab-host",
        machineGroups,
        selectedMachineId: "host-lab",
        terminalTabs,
      },
      remoteHostTree,
    );

    expect(patch.machineGroups.map((group) => group.title)).toEqual([
      "本地会话",
      "实验室",
    ]);
    expect(patch.machineGroups[0].machines[0].id).toBe("local-manual");
    expect(patch.selectedMachineId).toBe("host-lab");
  });
});
