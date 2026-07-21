// @author kongweiguang

import { useCallback, useMemo, useState } from "react";
import type {
  TerminalTab,
  WorkspaceFileDirtyState,
} from "../features/workspace/types";
import { resolveWorkspaceTabCloseDecision } from "../features/workspace/workspaceTabCloseGuardModel";
import { prepareExternalSftpTabClose } from "../features/sftp/externalSftpLaunchLifecycle";
import { externalSshLaunchIdFromMachineId } from "../features/external-launch/externalSshLaunchModel";
import { closeExternalSshLaunch } from "../lib/externalLaunchApi";

interface UseKerminalShellTabCloseOptions {
  closeExternalLaunch?: (launchId: string) => Promise<unknown>;
  closeTerminalTab: (tabId: string) => void;
  removeSidebarMachine?: (machineId: string) => void;
  confirmTerminalClose: boolean;
  onTabsClosed?: (tabIds: string[]) => void;
  terminalTabs: TerminalTab[];
  workspaceFileDirtyState: WorkspaceFileDirtyState;
}

/** 管理终端 tab 与未保存文件的两阶段关闭确认。 */
export function useKerminalShellTabClose({
  closeExternalLaunch = closeExternalSshLaunch,
  closeTerminalTab,
  removeSidebarMachine = () => undefined,
  confirmTerminalClose,
  onTabsClosed,
  terminalTabs,
  workspaceFileDirtyState,
}: UseKerminalShellTabCloseOptions) {
  const [pendingTerminalTabIds, setPendingTerminalTabIds] = useState<
    string[] | null
  >(null);
  const [pendingDirtyFileTabIds, setPendingDirtyFileTabIds] = useState<
    string[] | null
  >(null);
  const closeTabs = useCallback(
    (tabIds: string[]) => {
      void closeTabsWithExternalOwners(
        tabIds,
        terminalTabs,
        closeExternalLaunch,
        closeTerminalTab,
        removeSidebarMachine,
        onTabsClosed,
      );
    },
    [
      closeExternalLaunch,
      closeTerminalTab,
      onTabsClosed,
      removeSidebarMachine,
      terminalTabs,
    ],
  );

  const requestCloseTabs = useCallback(
    (tabIds: string[], confirmedDirtyFiles = false) => {
      const decision = resolveWorkspaceTabCloseDecision({
        confirmTerminalClose,
        confirmedDirtyFiles,
        tabIds,
        tabs: terminalTabs,
        workspaceFileDirtyState,
      });
      if (decision.kind === "confirmDirtyFiles") {
        setPendingDirtyFileTabIds(decision.tabIds);
        return;
      }
      if (decision.kind === "confirmTerminalTabs") {
        setPendingTerminalTabIds(decision.tabIds);
        return;
      }
      closeTabs(decision.tabIds);
    },
    [
      closeTabs,
      confirmTerminalClose,
      terminalTabs,
      workspaceFileDirtyState,
    ],
  );

  const requestCloseTab = useCallback(
    (tabId: string) => requestCloseTabs([tabId]),
    [requestCloseTabs],
  );
  const closeConfirmedTab = useCallback(
    (tabId: string) => closeTabs([tabId]),
    [closeTabs],
  );
  const confirmTerminalTabs = useCallback(() => {
    if (!pendingTerminalTabIds) return;
    closeTabs(pendingTerminalTabIds);
    setPendingTerminalTabIds(null);
  }, [closeTabs, pendingTerminalTabIds]);
  const confirmDirtyFileTabs = useCallback(() => {
    if (!pendingDirtyFileTabIds) return;
    requestCloseTabs(pendingDirtyFileTabIds, true);
    setPendingDirtyFileTabIds(null);
  }, [pendingDirtyFileTabIds, requestCloseTabs]);
  const dirtyFileTabCount = useMemo(
    () =>
      pendingDirtyFileTabIds?.filter(
        (tabId) => workspaceFileDirtyState[tabId],
      ).length ?? 0,
    [pendingDirtyFileTabIds, workspaceFileDirtyState],
  );

  return {
    cancelDirtyFileTabs: () => setPendingDirtyFileTabIds(null),
    cancelTerminalTabs: () => setPendingTerminalTabIds(null),
    closeConfirmedTab,
    confirmDirtyFileTabs,
    confirmTerminalTabs,
    dirtyFileTabCount,
    pendingDirtyFileTabCount: pendingDirtyFileTabIds?.length ?? 0,
    pendingTerminalTabCount: pendingTerminalTabIds?.length ?? 0,
    requestCloseTab,
  };
}

async function closeTabsWithExternalOwners(
  tabIds: string[],
  terminalTabs: TerminalTab[],
  closeExternalLaunch: (launchId: string) => Promise<unknown>,
  closeTerminalTab: (tabId: string) => void,
  removeSidebarMachine: (machineId: string) => void,
  onTabsClosed?: (tabIds: string[]) => void,
) {
  const closedTabIds: string[] = [];
  const closingTabIds = new Set(tabIds);
  for (const tabId of tabIds) {
    const tab = terminalTabs.find((candidate) => candidate.id === tabId);
    if (tab?.kind === "sftpTransfer" && tab.externalLaunchId) {
      const preparation = prepareExternalSftpTabClose(tabId);
      if (!preparation.canClose) {
        continue;
      }
      try {
        await preparation.cleanup;
      } catch {
        continue;
      }
      closeTerminalTab(tabId);
      removeSidebarMachine(tab.machineId);
      closedTabIds.push(tabId);
      continue;
    }
    const externalLaunchId = tab
      ? externalSshLaunchIdFromMachineId(tab.machineId)
      : null;
    closeTerminalTab(tabId);
    closedTabIds.push(tabId);
    if (!tab || !externalLaunchId) {
      continue;
    }
    const ownerRemains = terminalTabs.some(
      (candidate) =>
        candidate.machineId === tab.machineId &&
        candidate.id !== tab.id &&
        !closingTabIds.has(candidate.id),
    );
    const closingSftpOwner = terminalTabs.some(
      (candidate) =>
        closingTabIds.has(candidate.id) &&
        candidate.kind === "sftpTransfer" &&
        candidate.externalLaunchId === externalLaunchId,
    );
    if (!ownerRemains && !closingSftpOwner) {
      removeSidebarMachine(tab.machineId);
      void closeExternalLaunch(externalLaunchId).catch(() => undefined);
    }
  }
  if (closedTabIds.length > 0) {
    onTabsClosed?.(closedTabIds);
  }
}
