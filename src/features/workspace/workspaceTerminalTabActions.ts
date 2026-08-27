// @author kongweiguang

import type { StateCreator } from "zustand";
import { closeTerminalTabState } from "./workspaceTerminalState";
import type {
  MachineGroup,
  TerminalPane,
  TerminalTab,
  TerminalTabGroupDefinition,
  TerminalTabGroups,
  TerminalTabGroupPreference,
  TerminalTabGroupPreferences,
  WorkspaceFileDirtyState,
} from "./types";
import {
  createTerminalTabGroupState,
  moveTerminalTabGroupState,
  moveTerminalTabState,
  normalizeTerminalTabGroupState,
  removeTerminalTabFromGroupState,
  setTerminalTabGroupCollapsedState,
  type TerminalTabGroupMoveRequest,
  type TerminalTabMoveRequest,
  ungroupTerminalTabGroupState,
  updateTerminalTabGroupState,
} from "./workspaceTabGroupsModel";
import type { WorkspaceStoreCounterRuntime } from "./workspaceStoreCounterRuntime";
import { selectedMachineIdFromWorkspaceTab } from "./workspaceSelectionModel";
import type { WorkspaceToolPanelState } from "./workspaceToolPanelState";
import { withClosedToolPanelTab } from "./workspaceToolPanelState";

export interface WorkspaceTerminalTabActions {
  closeTerminalTab: (tabId: string) => void;
  renameTerminalTab: (tabId: string, title: string) => void;
  createTerminalTabGroup: (
    tabId: string,
    definition?: Partial<TerminalTabGroupDefinition>,
  ) => string | undefined;
  updateTerminalTabGroup: (
    groupId: string,
    definition: Partial<TerminalTabGroupDefinition>,
  ) => void;
  setTerminalTabGroupCollapsed: (groupId: string, collapsed: boolean) => void;
  moveTerminalTab: (request: TerminalTabMoveRequest) => void;
  moveTerminalTabGroup: (request: TerminalTabGroupMoveRequest) => void;
  removeTerminalTabFromGroup: (tabId: string) => void;
  ungroupTerminalTabGroup: (groupId: string) => void;
  /** 旧调用方的窄兼容入口；新 UI 只使用 updateTerminalTabGroup。 */
  updateTerminalTabGroupPreference: (
    groupId: string,
    preference: TerminalTabGroupPreference,
  ) => void;
}

interface WorkspaceTerminalTabStore extends WorkspaceToolPanelState {
  activeTabId: string;
  focusedPaneId: string;
  machineGroups: MachineGroup[];
  selectedMachineId: string;
  terminalPanes: TerminalPane[];
  terminalTabGroups: TerminalTabGroups;
  terminalTabGroupPreferences: TerminalTabGroupPreferences;
  terminalTabs: TerminalTab[];
  workspaceFileDirtyState: WorkspaceFileDirtyState;
}

/** 创建终端 tab 关闭、重命名和显式分组 action；ID 由共享计数器统一分配。 */
export function createWorkspaceTerminalTabActions(
  counters: Pick<WorkspaceStoreCounterRuntime, "nextTabGroupId">,
): StateCreator<
  WorkspaceTerminalTabStore,
  [],
  [],
  WorkspaceTerminalTabActions
> {
  return (set) => ({
  closeTerminalTab: (tabId) =>
    set((state) => {
      if (!state.terminalTabs.some((tab) => tab.id === tabId)) {
        return {};
      }
      const patch = closeTerminalTabState(state, tabId);
      const toolPanelPatch = withClosedToolPanelTab(state, patch, tabId);
      const terminalTabs = patch.terminalTabs ?? state.terminalTabs;
      const terminalPanes = patch.terminalPanes ?? state.terminalPanes;
      const groupState = normalizeTerminalTabGroupState(
        terminalTabs,
        state.terminalTabGroups,
      );
      const selectionPatch =
        state.activeTabId === tabId
          ? {
              selectedMachineId: selectedMachineIdFromWorkspaceTab(
                terminalTabs.find(
                  (tab) => tab.id === (patch.activeTabId ?? state.activeTabId),
                ),
                state.machineGroups,
                terminalPanes,
              ),
            }
          : {};
      if (!(tabId in state.workspaceFileDirtyState)) {
        return {
          ...toolPanelPatch,
          ...selectionPatch,
          terminalTabGroups: groupState.terminalTabGroups,
          terminalTabs: groupState.terminalTabs,
        };
      }
      const { [tabId]: _removed, ...workspaceFileDirtyState } =
        state.workspaceFileDirtyState;
      return {
        ...toolPanelPatch,
        ...selectionPatch,
        terminalTabGroups: groupState.terminalTabGroups,
        terminalTabs: groupState.terminalTabs,
        workspaceFileDirtyState,
      };
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
  createTerminalTabGroup: (tabId, definition = {}) => {
    let createdGroupId: string | undefined;
    set((state) => {
      if (!state.terminalTabs.some((tab) => tab.id === tabId)) {
        return {};
      }
      const usedIds = new Set(Object.keys(state.terminalTabGroups));
      let candidate = counters.nextTabGroupId();
      while (usedIds.has(candidate)) candidate = counters.nextTabGroupId();
      createdGroupId = candidate;
      const next = createTerminalTabGroupState(
        state,
        tabId,
        createdGroupId,
        definition,
      );
      return {
        terminalTabGroups: next.terminalTabGroups,
        terminalTabs: next.terminalTabs,
      };
    });
    return createdGroupId;
  },
  updateTerminalTabGroup: (groupId, definition) =>
    set((state) => {
      const next = updateTerminalTabGroupState(
        state,
        groupId,
        definition,
      );
      return {
        terminalTabGroups: next.terminalTabGroups,
        terminalTabs: next.terminalTabs,
      };
    }),
  setTerminalTabGroupCollapsed: (groupId, collapsed) =>
    set((state) => {
      const next = setTerminalTabGroupCollapsedState(
        state,
        groupId,
        collapsed,
      );
      return {
        terminalTabGroups: next.terminalTabGroups,
        terminalTabs: next.terminalTabs,
      };
    }),
  moveTerminalTab: (request) =>
    set((state) => {
      const next = moveTerminalTabState(state, request);
      return {
        terminalTabGroups: next.terminalTabGroups,
        terminalTabs: next.terminalTabs,
      };
    }),
  moveTerminalTabGroup: (request) =>
    set((state) => {
      const next = moveTerminalTabGroupState(state, request);
      return {
        terminalTabGroups: next.terminalTabGroups,
        terminalTabs: next.terminalTabs,
      };
    }),
  removeTerminalTabFromGroup: (tabId) =>
    set((state) => {
      const next = removeTerminalTabFromGroupState(state, tabId);
      return {
        terminalTabGroups: next.terminalTabGroups,
        terminalTabs: next.terminalTabs,
      };
    }),
  ungroupTerminalTabGroup: (groupId) =>
    set((state) => {
      const next = ungroupTerminalTabGroupState(state, groupId);
      return {
        terminalTabGroups: next.terminalTabGroups,
        terminalTabs: next.terminalTabs,
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
}
