// @author kongweiguang

import type { WorkspaceSessionSnapshot } from "./workspaceSession";
import type { MachineGroup } from "./types";
import {
  addPersistentSidebarMachines,
  dockerContainerMachinesFromSession,
  localMachinesFromSession,
  mergeSidebarMachines,
} from "./workspaceMachineModel";
import {
  restoredSelectedMachineId,
  sanitizeRestoredSftpTransferTabs,
} from "./workspaceSelectionModel";

interface WorkspaceRestoreStateInput {
  machineGroups: MachineGroup[];
  selectedMachineId: string;
}

/** 将已归一化 snapshot 合并为可原子写入 store 的恢复补丁。 */
export function restoreWorkspaceSessionState(
  state: WorkspaceRestoreStateInput,
  session: WorkspaceSessionSnapshot,
) {
  const removedSidebarMachineIds = session.removedSidebarMachineIds ?? [];
  const removedMachineIds = new Set(removedSidebarMachineIds);
  const machineGroups = addPersistentSidebarMachines(
    state.machineGroups,
    mergeSidebarMachines(
      localMachinesFromSession(session),
      dockerContainerMachinesFromSession(session),
      session.sidebarMachines,
    ).filter((machine) => !removedMachineIds.has(machine.id)),
  );
  const terminalTabs = sanitizeRestoredSftpTransferTabs(
    session.terminalTabs,
    machineGroups,
  );
  return {
    activeTabId: session.activeTabId,
    activeTool: null,
    activeToolByTabId: {},
    openTools: [],
    openToolsByTabId: {},
    focusedPaneId: session.focusedPaneId,
    machineGroups,
    removedSidebarMachineIds,
    terminalPanes: session.terminalPanes,
    terminalTabGroupPreferences: session.terminalTabGroupPreferences ?? {},
    terminalTabs,
    selectedMachineId: restoredSelectedMachineId({
      activeTabId: session.activeTabId,
      fallbackSelectedMachineId: state.selectedMachineId,
      machineGroups,
      selectedMachineId: session.selectedMachineId,
      terminalTabs,
    }),
  };
}
