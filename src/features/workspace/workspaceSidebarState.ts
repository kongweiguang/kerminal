// @author kongweiguang

import {
  browserPreviewProfiles,
  type TerminalProfile,
} from "../../lib/profileApi";
import type { RemoteHostGroupWithHosts } from "../../lib/remoteHostApi";
import type { MachineGroup, TerminalPane, TerminalTab } from "./types";
import {
  addPersistentSidebarMachines,
  buildMachineGroups,
  collectPersistentSidebarMachines,
  sidebarMachinesFromProfiles,
  syncLocalSidebarMachines,
  ungroupedGroupTitle,
  withUngroupedGroupTitle,
} from "./workspaceMachineModel";
import { selectedMachineIdForUpdatedGroups } from "./workspaceSelectionModel";

interface WorkspaceProfileStateInput {
  activeProfileId: string;
  activeTabId: string;
  machineGroups: MachineGroup[];
  removedSidebarMachineIds: string[];
  selectedMachineId: string;
  terminalPanes: TerminalPane[];
  terminalTabs: TerminalTab[];
}

interface WorkspaceProfileStatePatch {
  activeProfileId: string;
  machineGroups: MachineGroup[];
  profiles: TerminalProfile[];
  removedSidebarMachineIds: string[];
  selectedMachineId: string;
}

interface RemoteHostTreeStateInput {
  activeTabId: string;
  machineGroups: MachineGroup[];
  selectedMachineId: string;
  terminalPanes: TerminalPane[];
  terminalTabs: TerminalTab[];
}

interface RemoteHostTreeStatePatch {
  machineGroups: MachineGroup[];
  selectedMachineId: string;
}

/** 将配置文件刷新转换为可原子写入 workspace store 的状态补丁。 */
export function updateWorkspaceProfilesState(
  state: WorkspaceProfileStateInput,
  profiles: TerminalProfile[],
): WorkspaceProfileStatePatch {
  const nextProfiles = profiles.length > 0 ? profiles : browserPreviewProfiles;
  const activeProfile =
    nextProfiles.find((profile) => profile.id === state.activeProfileId) ??
    nextProfiles.find((profile) => profile.isDefault) ??
    nextProfiles[0];
  const syncedMachineGroups = syncLocalSidebarMachines(
    state.machineGroups,
    nextProfiles,
  );
  const profileSidebarMachines = sidebarMachinesFromProfiles(nextProfiles);
  const profileSidebarMachineIds = new Set(
    profileSidebarMachines.map((machine) => machine.id),
  );
  const removedSidebarMachineIds = state.removedSidebarMachineIds.filter(
    (machineId) => !profileSidebarMachineIds.has(machineId),
  );
  const machineGroups = addPersistentSidebarMachines(
    syncedMachineGroups,
    profileSidebarMachines,
  );

  return {
    activeProfileId: activeProfile.id,
    machineGroups,
    profiles: nextProfiles,
    removedSidebarMachineIds,
    selectedMachineId: selectedMachineIdForUpdatedGroups({
      activeTabId: state.activeTabId,
      allowPendingActiveTabSelection: true,
      fallbackSelectedMachineId: state.selectedMachineId,
      machineGroups,
      terminalPanes: state.terminalPanes,
      terminalTabs: state.terminalTabs,
    }),
  };
}

/** 将远端主机树刷新转换为保留本地侧栏机器的状态补丁。 */
export function updateRemoteHostTreeState(
  state: RemoteHostTreeStateInput,
  remoteGroups: RemoteHostGroupWithHosts[],
): RemoteHostTreeStatePatch {
  const sidebarMachines = collectPersistentSidebarMachines(state.machineGroups);
  const machineGroups = withUngroupedGroupTitle(
    addPersistentSidebarMachines(
      buildMachineGroups(remoteGroups),
      sidebarMachines,
    ),
    ungroupedGroupTitle(state.machineGroups),
  );

  return {
    machineGroups,
    selectedMachineId: selectedMachineIdForUpdatedGroups({
      activeTabId: state.activeTabId,
      allowPendingActiveTabSelection: false,
      fallbackSelectedMachineId: state.selectedMachineId,
      machineGroups,
      terminalPanes: state.terminalPanes,
      terminalTabs: state.terminalTabs,
    }),
  };
}
