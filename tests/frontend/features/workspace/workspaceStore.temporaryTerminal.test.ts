// @author kongweiguang

import { beforeEach, describe, expect, it } from "vitest";
import { resolveWorkspaceTargetSelection } from "../../../../src/features/workspace/workspaceTargetSelection";
import { useWorkspaceStore } from "../../../../src/features/workspace/workspaceStore";
import {
  bashProfile,
  pwshProfile,
  resetWorkspaceStore,
} from "../../support/workspace/workspaceStore.testSupport";

describe("workspace temporary terminals", () => {
  beforeEach(() => {
    resetWorkspaceStore();
    useWorkspaceStore.getState().setRemoteHostTree([]);
    useWorkspaceStore.getState().setProfiles([pwshProfile, bashProfile]);
    useWorkspaceStore.getState().selectProfile(pwshProfile.id);
  });

  it("creates a workspace-scoped terminal from the default profile without changing the sidebar", () => {
    const machineGroupsBefore = useWorkspaceStore.getState().machineGroups;

    useWorkspaceStore
      .getState()
      .addTerminalTab({ localMachineScope: "workspace" });

    const state = useWorkspaceStore.getState();
    expect(state.machineGroups).toBe(machineGroupsBefore);
    expect(state.terminalPanes[0]).toMatchObject({
      args: bashProfile.args,
      cwd: bashProfile.cwd,
      env: bashProfile.env,
      localMachineScope: "workspace",
      machineId: "machine-local-1",
      profileId: bashProfile.id,
      shell: bashProfile.shell,
    });
    expect(state.terminalTabs[0]).toMatchObject({
      id: "tab-local-1",
      machineId: "machine-local-1",
      title: bashProfile.name,
    });
    expect(state.activeTabId).toBe("tab-local-1");
    expect(state.focusedPaneId).toBe("pane-local-1");
    expect(state.selectedMachineId).toBe("machine-local-1");

    const selection = resolveWorkspaceTargetSelection(state);
    expect(selection.activeMachine).toMatchObject({
      id: "machine-local-1",
      kind: "local",
      profileId: bashProfile.id,
      shell: bashProfile.shell,
    });
    expect(selection.issues).not.toContain("pane-machine-missing");
    expect(selection.issues).not.toContain("selected-machine-missing");
  });

  it("restores workspace terminals without rebuilding sidebar machines", () => {
    useWorkspaceStore
      .getState()
      .addTerminalTab({ localMachineScope: "workspace" });
    const saved = useWorkspaceStore.getState();

    resetWorkspaceStore();
    useWorkspaceStore.getState().setRemoteHostTree([]);
    useWorkspaceStore.getState().setProfiles([pwshProfile, bashProfile]);
    useWorkspaceStore.getState().restoreWorkspaceSession({
      activeTabId: saved.activeTabId,
      focusedPaneId: saved.focusedPaneId,
      selectedMachineId: saved.selectedMachineId,
      sidebarMachines: [],
      terminalPanes: saved.terminalPanes,
      terminalTabs: saved.terminalTabs,
    });

    const restored = useWorkspaceStore.getState();
    expect(restored.machineGroups.flatMap((group) => group.machines)).toEqual(
      [],
    );
    expect(restored.terminalPanes[0]?.localMachineScope).toBe("workspace");
    expect(restored.selectedMachineId).toBe("machine-local-1");
    expect(resolveWorkspaceTargetSelection(restored).issues).toEqual([]);
  });

  it("uses unique identities and repairs selection when active temporary tabs close", () => {
    useWorkspaceStore
      .getState()
      .addTerminalTab({ localMachineScope: "workspace" });
    useWorkspaceStore
      .getState()
      .addTerminalTab({ localMachineScope: "workspace" });

    const opened = useWorkspaceStore.getState();
    expect(opened.terminalPanes.map((pane) => pane.machineId)).toEqual([
      "machine-local-1",
      "machine-local-2",
    ]);

    useWorkspaceStore.getState().closeTerminalTab("tab-local-2");
    expect(useWorkspaceStore.getState()).toMatchObject({
      activeTabId: "tab-local-1",
      selectedMachineId: "machine-local-1",
    });

    useWorkspaceStore.getState().closeTerminalTab("tab-local-1");
    expect(useWorkspaceStore.getState()).toMatchObject({
      activeTabId: "",
      focusedPaneId: "",
      selectedMachineId: "",
    });
  });
});
