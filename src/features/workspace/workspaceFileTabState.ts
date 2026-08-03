// @author kongweiguang

import { isWorkspaceFileTab, type TerminalTab, type WorkspaceFileDirtyState } from "./types";
import {
  directoryForWorkspaceFilePath,
  normalizeWorkspaceFilePath,
} from "./workspaceFileTabModel";

interface WorkspaceFileTabStateInput {
  terminalTabs: TerminalTab[];
  workspaceFileDirtyState: WorkspaceFileDirtyState;
}

/** 更新 workspace 文件 tab 的 dirty 标记，并清理已关闭 tab 的残留状态。 */
export function setWorkspaceFileTabDirtyState(
  state: WorkspaceFileTabStateInput,
  tabId: string,
  dirty: boolean,
) {
  const tab = state.terminalTabs.find((item) => item.id === tabId);
  if (!isWorkspaceFileTab(tab)) {
    if (!(tabId in state.workspaceFileDirtyState)) return {};
    const { [tabId]: _removed, ...workspaceFileDirtyState } =
      state.workspaceFileDirtyState;
    return { workspaceFileDirtyState };
  }
  if (dirty) {
    if (state.workspaceFileDirtyState[tabId]) return {};
    return {
      workspaceFileDirtyState: {
        ...state.workspaceFileDirtyState,
        [tabId]: true,
      },
    };
  }
  if (!state.workspaceFileDirtyState[tabId]) return {};
  const { [tabId]: _removed, ...workspaceFileDirtyState } =
    state.workspaceFileDirtyState;
  return { workspaceFileDirtyState };
}

/** 将 workspace 文件 tab 切回 SFTP 工具并同步目标机器。 */
export function revealWorkspaceFileInSftpState(
  terminalTabs: TerminalTab[],
  tabId: string,
  requestId: number,
) {
  const tab = terminalTabs.find((item) => item.id === tabId);
  if (!isWorkspaceFileTab(tab)) return {};
  return {
    activeTabId: tab.id,
    activeTool: "sftp" as const,
    focusedPaneId: "",
    selectedMachineId: tab.machineId,
    workspaceFileRevealRequest: {
      directoryPath: directoryForWorkspaceFilePath(tab.path),
      filePath: normalizeWorkspaceFilePath(tab.path),
      id: requestId,
      target: tab.target,
    },
  };
}
