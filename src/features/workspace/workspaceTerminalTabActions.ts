// @author kongweiguang

import type { StateCreator } from "zustand";
import { closeTerminalTabState } from "./workspaceTerminalState";
import type {
  TerminalPane,
  TerminalTab,
  TerminalTabGroupPreference,
  TerminalTabGroupPreferences,
  WorkspaceFileDirtyState,
} from "./types";
import type { WorkspaceToolPanelState } from "./workspaceToolPanelState";
import { withClosedToolPanelTab } from "./workspaceToolPanelState";

export interface WorkspaceTerminalTabActions {
  closeTerminalTab: (tabId: string) => void;
  renameTerminalTab: (tabId: string, title: string) => void;
  updateTerminalTabGroupPreference: (
    groupId: string,
    preference: TerminalTabGroupPreference,
  ) => void;
}

interface WorkspaceTerminalTabStore extends WorkspaceToolPanelState {
  activeTabId: string;
  focusedPaneId: string;
  terminalPanes: TerminalPane[];
  terminalTabGroupPreferences: TerminalTabGroupPreferences;
  terminalTabs: TerminalTab[];
  workspaceFileDirtyState: WorkspaceFileDirtyState;
}

/** 创建终端 tab 关闭、重命名和分组展示偏好的 action slice。 */
export const createWorkspaceTerminalTabActions: StateCreator<
  WorkspaceTerminalTabStore,
  [],
  [],
  WorkspaceTerminalTabActions
> = (set) => ({
  closeTerminalTab: (tabId) =>
    set((state) => {
      if (!state.terminalTabs.some((tab) => tab.id === tabId)) {
        return {};
      }
      const patch = closeTerminalTabState(state, tabId);
      const toolPanelPatch = withClosedToolPanelTab(state, patch, tabId);
      if (!(tabId in state.workspaceFileDirtyState)) {
        return toolPanelPatch;
      }
      const { [tabId]: _removed, ...workspaceFileDirtyState } =
        state.workspaceFileDirtyState;
      return { ...toolPanelPatch, workspaceFileDirtyState };
    }),
  renameTerminalTab: (tabId, title) =>
    set((state) => {
      const trimmedTitle = title.trim();
      if (!trimmedTitle) {
        return {};
      }
      return {
        terminalTabs: state.terminalTabs.map((tab) =>
          tab.id === tabId ? { ...tab, title: trimmedTitle } : tab,
        ),
      };
    }),
  updateTerminalTabGroupPreference: (groupId, preference) =>
    set((state) => {
      const trimmedGroupId = groupId.trim();
      if (!trimmedGroupId) {
        return {};
      }
      const trimmedTitle = preference.title?.trim();
      const nextPreference: TerminalTabGroupPreference = {
        ...(preference.color ? { color: preference.color } : {}),
        ...(trimmedTitle ? { title: trimmedTitle } : {}),
      };
      const nextPreferences = { ...state.terminalTabGroupPreferences };
      if (Object.keys(nextPreference).length === 0) {
        delete nextPreferences[trimmedGroupId];
      } else {
        nextPreferences[trimmedGroupId] = nextPreference;
      }
      return { terminalTabGroupPreferences: nextPreferences };
    }),
});
