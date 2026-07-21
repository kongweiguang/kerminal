// @author kongweiguang

import type { StateCreator } from "zustand";
import type { TerminalProfile } from "../../lib/profileApi";
import {
  buildWorkspaceFileTabKey,
  normalizeWorkspaceFilePath,
  titleForWorkspaceFilePath,
  workspaceFileMachineId,
  workspaceFileTargetHostId,
} from "./workspaceFileTabModel";
import {
  revealWorkspaceFileInSftpState,
  setWorkspaceFileTabDirtyState,
} from "./workspaceFileTabState";
import {
  findMachine,
  isPersistedLocalProfile,
  localMachineIdForProfile,
} from "./workspaceMachineModel";
import type { WorkspaceState } from "./workspaceStore";
import type {
  AddTerminalTabOptions,
  OpenSftpTransferTabOptions,
  OpenWorkspaceFileTabOptions,
} from "./workspaceStoreContract";
import type { WorkspaceStoreCounterRuntime } from "./workspaceStoreCounterRuntime";
import { createLocalTerminalOpenState } from "./workspaceTerminalOpenState";
import {
  isWorkspaceFileTab,
  type SftpTransferWorkspaceTab,
  type WorkspaceFileTab,
} from "./types";

export interface WorkspaceTabSlice {
  addTerminalTab(options?: AddTerminalTabOptions): void;
  openSftpTransferTab(options?: OpenSftpTransferTabOptions): void;
  openWorkspaceFileTab(options: OpenWorkspaceFileTabOptions): void;
  revealWorkspaceFileInSftp(tabId: string): void;
  setWorkspaceFileTabDirty(tabId: string, dirty: boolean): void;
}

/** 组合 local/SFTP/file tab 动作；pane layout 由独立 slice 负责。 */
export function createWorkspaceTabSlice(
  counters: WorkspaceStoreCounterRuntime,
): StateCreator<WorkspaceState, [], [], WorkspaceTabSlice> {
  return (set) => ({
    addTerminalTab: (options) =>
      set((state) => {
        const tabId = counters.nextTabId("tab-local");
        const paneId = counters.nextPaneId("pane-local");
        const generatedIndex = numberSuffix(tabId);
        const usesDirectRuntimeConfig = Boolean(
          options?.shell || options?.args || options?.cwd || options?.env,
        );
        const requestedProfile = options?.profileId
          ? state.profiles.find((profile) => profile.id === options.profileId)
          : undefined;
        const profile =
          requestedProfile ??
          (usesDirectRuntimeConfig ? undefined : activeProfile(state));
        const persistedProfile =
          profile && isPersistedLocalProfile(profile) ? profile : undefined;
        const title = options?.title ?? profile?.name ?? `本地终端 ${generatedIndex}`;
        const machineId = persistedProfile
          ? localMachineIdForProfile(persistedProfile.id)
          : `machine-local-${generatedIndex}`;
        const nextState = createLocalTerminalOpenState(state, {
          args: options?.args ?? profile?.args,
          cwd: options?.cwd ?? profile?.cwd,
          env: options?.env ?? profile?.env,
          groupId: options?.groupId,
          machineId,
          machineProfileId: persistedProfile?.id,
          paneId,
          profile,
          shell: options?.shell ?? profile?.shell,
          tabId,
          tmuxBinding: options?.tmuxBinding,
          title,
        });
        return {
          ...nextState,
          removedSidebarMachineIds: removeRemovedSidebarMachineId(
            state.removedSidebarMachineIds,
            machineId,
          ),
        };
      }),
    openSftpTransferTab: (options) =>
      set((state) => openSftpTransferTabState(state, options, counters)),
    openWorkspaceFileTab: (options) =>
      set((state) => openWorkspaceFileTabState(state, options, counters)),
    setWorkspaceFileTabDirty: (tabId, dirty) =>
      set((state) => setWorkspaceFileTabDirtyState(state, tabId, dirty)),
    revealWorkspaceFileInSftp: (tabId) =>
      set((state) =>
        revealWorkspaceFileInSftpState(state.terminalTabs, tabId, Date.now()),
      ),
  });
}

/** 创建并聚焦 SFTP 传输工作台，供导航入口与外部启动复用同一标签语义。 */
export function openSftpTransferTabState(
  state: Pick<
    WorkspaceState,
    "machineGroups" | "selectedMachineId" | "terminalTabs"
  >,
  options: OpenSftpTransferTabOptions | undefined,
  counters: Pick<WorkspaceStoreCounterRuntime, "nextTabId">,
) {
  const leftHost = options?.leftHostId
    ? findMachine(state.machineGroups, options.leftHostId)
    : undefined;
  const lockedLeftHost = options?.lockedLeftHostId
    ? findMachine(state.machineGroups, options.lockedLeftHostId)
    : undefined;
  const rightHost = options?.rightHostId
    ? findMachine(state.machineGroups, options.rightHostId)
    : undefined;
  const leftHostId = leftHost?.kind === "ssh" ? leftHost.id : undefined;
  const lockedLeftHostId =
    lockedLeftHost?.kind === "ssh" ? lockedLeftHost.id : undefined;
  const rightHostId = rightHost?.kind === "ssh" ? rightHost.id : undefined;
  const tabId = counters.nextTabId("tab-sftp-transfer");
  const primaryHostId = rightHostId ?? lockedLeftHostId ?? leftHostId;
  const primaryHost = primaryHostId
    ? findMachine(state.machineGroups, primaryHostId)
    : undefined;
  const tab: SftpTransferWorkspaceTab = {
    id: tabId,
    kind: "sftpTransfer",
    leftHostId: lockedLeftHostId ?? leftHostId,
    lockedLeftHostId,
    machineId: primaryHostId ?? "sftp-transfer",
    rightHostId,
    title: primaryHost ? `${primaryHost.name} 传输` : "SFTP 传输",
  };
  return {
    activeTabId: tabId,
    focusedPaneId: "",
    selectedMachineId: primaryHostId ?? state.selectedMachineId,
    terminalTabs: [...state.terminalTabs, tab],
  };
}

function openWorkspaceFileTabState(
  state: WorkspaceState,
  options: OpenWorkspaceFileTabOptions,
  counters: WorkspaceStoreCounterRuntime,
) {
  const path = normalizeWorkspaceFilePath(options.path);
  const rootPath = options.rootPath
    ? normalizeWorkspaceFilePath(options.rootPath)
    : undefined;
  const tabKey = buildWorkspaceFileTabKey({
    access: options.access,
    path,
    source: options.source,
    target: options.target,
  });
  const existingTab = state.terminalTabs.find(
    (tab) =>
      isWorkspaceFileTab(tab) &&
      buildWorkspaceFileTabKey({
        access: tab.access,
        path: tab.path,
        source: tab.source,
        target: tab.target,
      }) === tabKey,
  );
  const selectedMachineId =
    workspaceFileTargetHostId(options.target) ??
    workspaceFileMachineId(options.target);
  if (existingTab) {
    return { activeTabId: existingTab.id, focusedPaneId: "", selectedMachineId };
  }
  const tabId = counters.nextTabId("tab-workspace-file");
  const tab: WorkspaceFileTab = {
    access: options.access,
    id: tabId,
    kind: "workspaceFile",
    machineId: workspaceFileMachineId(options.target),
    path,
    ...(rootPath ? { rootPath } : {}),
    source: options.source,
    target: options.target,
    title: options.title?.trim() || titleForWorkspaceFilePath(path),
  };
  return {
    activeTabId: tabId,
    focusedPaneId: "",
    selectedMachineId,
    terminalTabs: [...state.terminalTabs, tab],
  };
}

function activeProfile(state: WorkspaceState): TerminalProfile | undefined {
  return (
    state.profiles.find((profile) => profile.id === state.activeProfileId) ??
    state.profiles.find((profile) => profile.isDefault) ??
    state.profiles[0]
  );
}

function numberSuffix(id: string) {
  return Number(id.slice(id.lastIndexOf("-") + 1));
}

function removeRemovedSidebarMachineId(machineIds: string[], machineId: string) {
  return machineIds.includes(machineId)
    ? machineIds.filter((candidate) => candidate !== machineId)
    : machineIds;
}
