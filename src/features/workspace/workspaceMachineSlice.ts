// @author kongweiguang

import type { StateCreator } from "zustand";
import type { DockerContainerSummary } from "../../lib/dockerApi";
import type { RemoteHostGroupWithHosts } from "../../lib/remoteHostApi";
import type { TerminalProfile } from "../../lib/profileApi";
import { normalizeAppSettings, type AppSettings } from "../settings/contracts/index";
import {
  containerToMachine,
  findMachine,
} from "./workspaceMachineModel";
import {
  addDockerContainerState,
  addLocalProfileMachineState,
  moveSidebarMachineState,
  pinMachineGroupState,
  removeSidebarMachineState,
  renameMachineGroupState,
  updateLocalMachineState,
} from "./workspaceMachineState";
import { selectedMachineIdFromWorkspaceTab } from "./workspaceSelectionModel";
import {
  updateRemoteHostTreeState,
  updateWorkspaceProfilesState,
} from "./workspaceSidebarState";
import type { WorkspaceState } from "./workspaceStore";
import type { AddDockerContainerOptions, AddTerminalTabOptions } from "./workspaceStoreContract";
import type { WorkspaceStoreCounterRuntime } from "./workspaceStoreCounterRuntime";
import {
  createContainerTerminalOpenState,
  focusExistingMachineTabState,
} from "./workspaceTerminalOpenState";
import { selectTerminalTabState } from "./workspaceTerminalState";
import { withToolPanelTabTransition } from "./workspaceToolPanelState";

export interface WorkspaceMachineSlice {
  setProfiles(profiles: TerminalProfile[]): void;
  setSettings(settings: AppSettings): void;
  selectProfile(profileId: string): void;
  setRemoteHostTree(remoteGroups: RemoteHostGroupWithHosts[]): void;
  addDockerContainer(
    container: DockerContainerSummary,
    options?: AddDockerContainerOptions,
  ): void;
  openDockerContainerTerminal(
    container: DockerContainerSummary,
    options?: AddDockerContainerOptions,
  ): void;
  addLocalProfileMachine(profile: TerminalProfile, groupId?: string): void;
  moveSidebarMachine(machineId: string, groupId: string): void;
  pinMachineGroup(groupId: string, pinned?: boolean): void;
  removeSidebarMachine(machineId: string): void;
  renameMachineGroup(groupId: string, title: string): void;
  updateLocalMachine(machineId: string, options: AddTerminalTabOptions): void;
  selectMachine(machineId: string): void;
  selectTab(tabId: string): void;
}

/** 组合 sidebar machine、profile/settings 与 workspace 选择动作。 */
export function createWorkspaceMachineSlice(
  counters: WorkspaceStoreCounterRuntime,
): StateCreator<WorkspaceState, [], [], WorkspaceMachineSlice> {
  return (set) => ({
    setProfiles: (profiles) =>
      set((state) => updateWorkspaceProfilesState(state, profiles)),
    setSettings: (settings) => set({ settings: normalizeAppSettings(settings) }),
    selectProfile: (activeProfileId) => set({ activeProfileId }),
    setRemoteHostTree: (remoteGroups) =>
      set((state) => updateRemoteHostTreeState(state, remoteGroups)),
    addDockerContainer: (container, options) =>
      set((state) => addDockerContainerState(state, container, options)),
    openDockerContainerTerminal: (container, options) =>
      set((state) => {
        if (container.status !== "running") return {};
        const hostMachine = findMachine(state.machineGroups, container.hostId);
        if (!hostMachine || hostMachine.kind !== "ssh") return {};
        const machine = containerToMachine(container, hostMachine, options);
        const focusState = focusExistingMachineTabState(state, machine.id);
        if (focusState) {
          return withToolPanelTabTransition(state, focusState);
        }
        return withToolPanelTabTransition(state, createContainerTerminalOpenState(state, machine, {
          paneId: counters.nextPaneId("pane-container"),
          tabId: counters.nextTabId("tab-container"),
        }));
      }),
    addLocalProfileMachine: (profile, groupId) =>
      set((state) => addLocalProfileMachineState(state, profile, groupId)),
    moveSidebarMachine: (machineId, groupId) =>
      set((state) => moveSidebarMachineState(state, machineId, groupId)),
    pinMachineGroup: (groupId, pinned = true) =>
      set((state) => pinMachineGroupState(state, groupId, pinned)),
    removeSidebarMachine: (machineId) =>
      set((state) => removeSidebarMachineState(state, machineId)),
    renameMachineGroup: (groupId, title) =>
      set((state) => renameMachineGroupState(state, groupId, title)),
    updateLocalMachine: (machineId, options) =>
      set((state) => updateLocalMachineState(state, machineId, options)),
    selectMachine: (selectedMachineId) => set({ selectedMachineId }),
    selectTab: (activeTabId) =>
      set((state) => {
        const tabPatch = selectTerminalTabState(state, activeTabId);
        if (!("activeTabId" in tabPatch)) return tabPatch;
        return withToolPanelTabTransition(state, {
          ...tabPatch,
          selectedMachineId: selectedMachineIdFromWorkspaceTab(
            state.terminalTabs.find((tab) => tab.id === activeTabId),
            state.machineGroups,
            state.terminalPanes,
          ),
        });
      }),
  });
}
