// @author kongweiguang

import type {
  MachineGroup,
  TerminalPane,
  TerminalTab,
  TerminalTabGroups,
  TerminalTabGroupPreferences,
} from "./types";
import { sidebarMachinesForWorkspaceSession } from "./workspaceMachineModel";
import type {
  WorkspaceSessionSnapshot,
  WorkspaceShellLayout,
} from "./workspaceSession";

export interface WorkspaceSessionCaptureInput {
  activeTabId: string;
  focusedPaneId: string;
  machineGroups: MachineGroup[];
  removedSidebarMachineIds: string[];
  selectedMachineId: string;
  shellLayout?: WorkspaceShellLayout;
  terminalPanes: TerminalPane[];
  terminalTabGroups?: TerminalTabGroups;
  terminalTabGroupPreferences: TerminalTabGroupPreferences;
  terminalTabs: TerminalTab[];
}

/** 创建可持久化的完整 workspace session；输出历史仍保留在实际快照中。 */
export function captureWorkspaceSession(
  input: WorkspaceSessionCaptureInput,
): WorkspaceSessionSnapshot {
  return {
    activeTabId: input.activeTabId,
    focusedPaneId: input.focusedPaneId,
    removedSidebarMachineIds: input.removedSidebarMachineIds,
    selectedMachineId: input.selectedMachineId,
    shellLayout: input.shellLayout,
    sidebarMachines: sidebarMachinesForWorkspaceSession(input.machineGroups),
    terminalTabGroups: input.terminalTabGroups ?? {},
    terminalPanes: input.terminalPanes,
    terminalTabGroupPreferences: input.terminalTabGroupPreferences,
    terminalTabs: input.terminalTabs,
  };
}

/**
 * 构建忽略高频运行字段的稳定键。cwd、状态和输出历史仍通过延迟 flush 保存，
 * 但不会把终端输出流放大为每个 chunk 一次文件写入。
 */
export function workspaceSessionStableKey(
  input: WorkspaceSessionCaptureInput,
): string {
  return JSON.stringify({
    activeTabId: input.activeTabId,
    focusedPaneId: input.focusedPaneId,
    removedSidebarMachineIds: input.removedSidebarMachineIds,
    selectedMachineId: input.selectedMachineId,
    shellLayout: input.shellLayout,
    sidebarMachines: sidebarMachinesForWorkspaceSession(input.machineGroups),
    terminalTabGroups: input.terminalTabGroups ?? {},
    terminalPanes: input.terminalPanes.map(
      terminalPaneWithoutVolatileSessionFields,
    ),
    terminalTabGroupPreferences: input.terminalTabGroupPreferences,
    terminalTabs: input.terminalTabs,
  });
}

function terminalPaneWithoutVolatileSessionFields(pane: TerminalPane) {
  const {
    currentCwd: _currentCwd,
    latencyMs: _latencyMs,
    lines: _lines,
    outputHistory: _outputHistory,
    status: _status,
    ...stablePane
  } = pane;
  return stablePane;
}
