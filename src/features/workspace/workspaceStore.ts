// @author kongweiguang

import { create } from "zustand";
import {
  defaultAppSettings,
  type AppSettings,
} from "../settings/contracts/index";
import {
  browserPreviewProfiles,
  type TerminalProfile,
} from "../../lib/profileApi";
import {
  machineGroups,
  terminalPanes,
  terminalTabs,
  tools,
} from "./workspaceData";
import type {
  MachineGroup,
  TerminalPane,
  TerminalTab,
  TerminalTabGroups,
  TerminalTabGroupPreferences,
  WorkspaceFileDirtyState,
  WorkspaceFileRevealRequest,
} from "./types";
import type {
  WorkspaceShellInteractionSlice,
} from "./workspaceStoreContract";
import {
  createWorkspaceShellInteractionSlice,
  initialWorkspaceShellInteractionState,
} from "./workspaceShellInteractionSlice";
import {
  createWorkspaceTerminalOpenActions,
  type WorkspaceTerminalOpenActions,
} from "./workspaceTerminalOpenActions";
import {
  createWorkspaceTerminalTabActions,
  type WorkspaceTerminalTabActions,
} from "./workspaceTerminalTabActions";
import {
  createWorkspaceMachineSlice,
  type WorkspaceMachineSlice,
} from "./workspaceMachineSlice";
import {
  createWorkspacePaneSlice,
  type WorkspacePaneSlice,
} from "./workspacePaneSlice";
import {
  createWorkspacePersistenceSlice,
  type WorkspacePersistenceSlice,
} from "./workspacePersistenceSlice";
import { createWorkspaceStoreCounterRuntime } from "./workspaceStoreCounterRuntime";
import {
  createWorkspaceTabSlice,
  type WorkspaceTabSlice,
} from "./workspaceTabSlice";

export type {
  AddTerminalTabOptions,
  OpenWorkspaceFileTabOptions,
  TmuxAttachPlacement,
} from "./workspaceStoreContract";

export interface WorkspaceState
  extends WorkspaceShellInteractionSlice,
    WorkspaceMachineSlice,
    WorkspacePaneSlice,
    WorkspacePersistenceSlice,
    WorkspaceTabSlice,
    WorkspaceTerminalOpenActions,
    WorkspaceTerminalTabActions {
  profiles: TerminalProfile[];
  activeProfileId: string;
  machineGroups: MachineGroup[];
  terminalTabs: TerminalTab[];
  terminalTabGroups: TerminalTabGroups;
  /** @deprecated 仅用于旧 session/测试兼容；运行态 UI 使用 terminalTabGroups。 */
  terminalTabGroupPreferences: TerminalTabGroupPreferences;
  terminalPanes: TerminalPane[];
  activeTabId: string;
  selectedMachineId: string;
  focusedPaneId: string;
  removedSidebarMachineIds: string[];
  settings: AppSettings;
  workspaceFileDirtyState: WorkspaceFileDirtyState;
  workspaceFileRevealRequest: WorkspaceFileRevealRequest | null;
}

export {
  findMachine,
  localMachineIdForProfile,
} from "./workspaceMachineModel";

const initialState = {
  profiles: browserPreviewProfiles,
  activeProfileId: browserPreviewProfiles[0].id,
  machineGroups,
  terminalTabs,
  terminalTabGroups: {},
  terminalTabGroupPreferences: {},
  terminalPanes,
  activeTabId: "",
  selectedMachineId: "",
  focusedPaneId: "",
  removedSidebarMachineIds: [],
  ...initialWorkspaceShellInteractionState,
  settings: defaultAppSettings,
  workspaceFileDirtyState: {},
  workspaceFileRevealRequest: null,
};

const workspaceCounters = createWorkspaceStoreCounterRuntime({
  paneCount: terminalPanes.length,
  tabCount: terminalTabs.length,
  tabGroupCount: 0,
});

export const useWorkspaceStore = create<WorkspaceState>()((set, get, store) => ({
  ...initialState,
  ...createWorkspaceShellInteractionSlice(set, get, store),
  ...createWorkspaceMachineSlice(workspaceCounters)(set, get, store),
  ...createWorkspacePaneSlice(workspaceCounters)(set, get, store),
  ...createWorkspacePersistenceSlice(workspaceCounters)(set, get, store),
  ...createWorkspaceTabSlice(workspaceCounters)(set, get, store),
  ...createWorkspaceTerminalOpenActions(workspaceCounters)(set, get, store),
  ...createWorkspaceTerminalTabActions(workspaceCounters)(set, get, store),
}));

useWorkspaceStore.subscribe((state) => {
  if (state === useWorkspaceStore.getInitialState()) workspaceCounters.reset();
});

export { tools };
