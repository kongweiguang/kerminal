// @author kongweiguang

import type { StateCreator } from "zustand";
import { isToolId } from "./types";
import type { WorkspaceShellInteractionSlice } from "./workspaceStoreContract";
import { setActiveToolForCurrentTabState } from "./workspaceToolPanelState";

interface WorkspaceShellInteractionStore extends WorkspaceShellInteractionSlice {
  activeTabId: string;
}

/** 工作区工具选择、机器搜索和广播草稿的稳定初始状态。 */
export const initialWorkspaceShellInteractionState = {
  activeTool: null,
  activeToolByTabId: {},
  broadcastDraft: "",
  machineSearch: "",
} satisfies Pick<
  WorkspaceShellInteractionSlice,
  "activeTool" | "activeToolByTabId" | "broadcastDraft" | "machineSearch"
>;

/** 创建不参与 session 持久化的工作区 shell 交互 action slice。 */
export const createWorkspaceShellInteractionSlice: StateCreator<
  WorkspaceShellInteractionStore,
  [],
  [],
  WorkspaceShellInteractionSlice
> = (set) => ({
  ...initialWorkspaceShellInteractionState,
  setActiveTool: (activeTool) =>
    set((state) => {
      if (activeTool === null) {
        return setActiveToolForCurrentTabState(state, activeTool);
      }
      return isToolId(activeTool)
        ? setActiveToolForCurrentTabState(state, activeTool)
        : {};
    }),
  setBroadcastDraft: (broadcastDraft) => set({ broadcastDraft }),
  setMachineSearch: (machineSearch) => set({ machineSearch }),
});
