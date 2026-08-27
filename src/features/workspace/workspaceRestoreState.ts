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
import { normalizeTerminalTabGroupState } from "./workspaceTabGroupsModel";

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
  const sanitizedTerminalTabs = sanitizeRestoredSftpTransferTabs(
    session.terminalTabs,
    machineGroups,
  );
  // SFTP 恢复可能丢弃失效远端引用；再次归一化组元数据，避免留下空组或孤儿
  // tabGroupId，同时保持 session 原有扁平顺序和活动/焦点选择不被分组逻辑改写。
  const { terminalTabs, terminalTabGroups } = normalizeTerminalTabGroupState(
    sanitizedTerminalTabs,
    session.terminalTabGroups ?? {},
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
    terminalTabGroups,
    terminalTabGroupPreferences: session.terminalTabGroupPreferences ?? {},
    terminalTabs,
    selectedMachineId: restoredSelectedMachineId({
      activeTabId: session.activeTabId,
      fallbackSelectedMachineId: state.selectedMachineId,
      machineGroups,
      selectedMachineId: session.selectedMachineId,
      terminalPanes: session.terminalPanes,
      terminalTabs,
    }),
  };
}
