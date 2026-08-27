// @author kongweiguang

import { collectPaneIds } from "./workspaceLayout";
import { findMachine } from "./workspaceMachineModel";
import type { MachineGroup, TerminalPane, TerminalTab } from "./types";
import {
  isSftpTransferWorkspaceTab,
  isTerminalSessionTab,
  isWorkspaceFileTab,
} from "./types";
import { workspaceFileTargetHostId } from "./workspaceFileTabModel";

interface RestoredSelectedMachineIdOptions {
  activeTabId: string;
  fallbackSelectedMachineId: string;
  machineGroups: MachineGroup[];
  selectedMachineId: string;
  terminalPanes: TerminalPane[];
  terminalTabs: TerminalTab[];
}

interface SelectedMachineIdForUpdatedGroupsOptions {
  activeTabId: string;
  allowPendingActiveTabSelection: boolean;
  fallbackSelectedMachineId: string;
  machineGroups: MachineGroup[];
  terminalPanes: TerminalPane[];
  terminalTabs: TerminalTab[];
}

export function sanitizeRestoredSftpTransferTabs(
  tabs: TerminalTab[],
  machineGroups: MachineGroup[],
): TerminalTab[] {
  return tabs.map((tab) => {
    if (!isSftpTransferWorkspaceTab(tab)) {
      return tab;
    }

    const lockedLeftHostId = validSshHostId(machineGroups, tab.lockedLeftHostId);
    const leftHostId =
      lockedLeftHostId ?? validSshHostId(machineGroups, tab.leftHostId);
    const rightHostId = validSshHostId(machineGroups, tab.rightHostId);
    const machineHostId = validSshHostId(machineGroups, tab.machineId);
    const primaryHostId =
      rightHostId ?? lockedLeftHostId ?? leftHostId ?? machineHostId;

    return {
      ...tab,
      leftHostId: leftHostId ?? machineHostId,
      lockedLeftHostId,
      machineId: primaryHostId ?? "sftp-transfer",
      rightHostId,
    };
  });
}

/** 恢复选择时承认 workspace 本地 pane 的会话级 Machine ID，但不要求它存在于左栏。 */
export function restoredSelectedMachineId({
  activeTabId,
  fallbackSelectedMachineId,
  machineGroups,
  selectedMachineId,
  terminalPanes,
  terminalTabs,
}: RestoredSelectedMachineIdOptions): string {
  const activeTab =
    terminalTabs.find((tab) => tab.id === activeTabId) ?? terminalTabs[0];
  // 空工作区没有当前目标，历史侧栏选择不能恢复成运行态上下文。
  if (!activeTab) {
    return "";
  }
  const activeTabCandidate = selectedMachineIdCandidateFromTab(
    activeTab,
  );
  const workspaceLocalCandidate = workspaceLocalMachineIdFromTab(
    activeTab,
    terminalPanes,
  );

  return (
    validMachineId(machineGroups, activeTabCandidate) ||
    workspaceLocalCandidate ||
    activeTabCandidate ||
    validMachineId(machineGroups, selectedMachineId) ||
    pendingRemoteSelectionId(selectedMachineId) ||
    validMachineId(machineGroups, fallbackSelectedMachineId) ||
    ""
  );
}

/** 侧栏数据刷新时优先保留活动的 workspace 本地目标，避免它被误判为失效连接。 */
export function selectedMachineIdForUpdatedGroups({
  activeTabId,
  allowPendingActiveTabSelection,
  fallbackSelectedMachineId,
  machineGroups,
  terminalPanes,
  terminalTabs,
}: SelectedMachineIdForUpdatedGroupsOptions): string {
  const activeTab =
    terminalTabs.find((tab) => tab.id === activeTabId) ?? terminalTabs[0];
  const activeTabCandidate = selectedMachineIdCandidateFromTab(activeTab);
  const workspaceLocalCandidate = workspaceLocalMachineIdFromTab(
    activeTab,
    terminalPanes,
  );

  return (
    workspaceLocalCandidate ||
    validMachineId(machineGroups, fallbackSelectedMachineId) ||
    validMachineId(machineGroups, activeTabCandidate) ||
    (allowPendingActiveTabSelection
      ? pendingRemoteSelectionId(fallbackSelectedMachineId) ||
        activeTabCandidate
      : "") ||
    ""
  );
}

/** 解析 Tab 选择对应的运行目标；workspace 本地目标不依赖 machineGroups。 */
export function selectedMachineIdFromWorkspaceTab(
  tab: TerminalTab | undefined,
  machineGroups: MachineGroup[],
  terminalPanes: TerminalPane[],
): string {
  return (
    validMachineId(machineGroups, selectedMachineIdCandidateFromTab(tab)) ||
    workspaceLocalMachineIdFromTab(tab, terminalPanes)
  );
}

function pendingRemoteSelectionId(machineId: string | undefined): string {
  return machineId && machineId !== "sftp-transfer" ? machineId : "";
}

function selectedMachineIdCandidateFromTab(
  tab: TerminalTab | undefined,
): string {
  if (!tab) {
    return "";
  }
  if (isSftpTransferWorkspaceTab(tab)) {
    return (
      tab.rightHostId ||
      tab.lockedLeftHostId ||
      tab.leftHostId ||
      (tab.machineId === "sftp-transfer" ? "" : tab.machineId)
    );
  }
  if (isWorkspaceFileTab(tab)) {
    return workspaceFileTargetHostId(tab.target) ?? tab.machineId;
  }
  return tab.machineId;
}

/**
 * 仅把当前 Tab 布局内显式标记为 workspace 的本地 pane 视为会话级 Machine，
 * 防止普通缺失 Machine 被同一规则意外放行。
 */
function workspaceLocalMachineIdFromTab(
  tab: TerminalTab | undefined,
  terminalPanes: readonly TerminalPane[],
): string {
  if (!tab || !isTerminalSessionTab(tab)) {
    return "";
  }

  const paneIds = new Set(collectPaneIds(tab.layout));
  return (
    terminalPanes.find(
      (pane) =>
        paneIds.has(pane.id) &&
        pane.machineId === tab.machineId &&
        pane.mode === "local" &&
        pane.localMachineScope === "workspace",
    )?.machineId ?? ""
  );
}

function validSshHostId(
  machineGroups: MachineGroup[],
  machineId: string | undefined,
): string | undefined {
  const machine = machineId ? findMachine(machineGroups, machineId) : undefined;
  return machine?.kind === "ssh" ? machine.id : undefined;
}

function validMachineId(
  machineGroups: MachineGroup[],
  machineId: string | undefined,
): string {
  if (!machineId || machineId === "sftp-transfer") {
    return "";
  }
  return findMachine(machineGroups, machineId)?.id ?? "";
}
