// @author kongweiguang

import { useCallback, useMemo, useState } from "react";
import type {
  TerminalTab,
  WorkspaceFileDirtyState,
} from "../features/workspace/types";
import { resolveWorkspaceTabCloseDecision } from "../features/workspace/workspaceTabCloseGuardModel";
import { prepareExternalSftpTabClose } from "../features/sftp/externalSftpLaunchLifecycle";

interface UseKerminalShellTabCloseOptions {
  closeTerminalTab: (tabId: string) => void;
  removeSidebarMachine?: (machineId: string) => void;
  confirmTerminalClose: boolean;
  onTabsClosed?: (tabIds: string[]) => void;
  terminalTabs: TerminalTab[];
  workspaceFileDirtyState: WorkspaceFileDirtyState;
}

/** 管理终端 tab 与未保存文件的两阶段关闭确认。 */
export function useKerminalShellTabClose({
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
        closeTerminalTab,
        removeSidebarMachine,
        onTabsClosed,
      );
    },
    [closeTerminalTab, onTabsClosed, removeSidebarMachine, terminalTabs],
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
      removeSidebarMachine,
      terminalTabs,
      workspaceFileDirtyState,
    ],
  );

  const requestCloseTab = useCallback(
    (tabId: string) => requestCloseTabs([tabId]),
    [requestCloseTabs],
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
  closeTerminalTab: (tabId: string) => void,
  removeSidebarMachine: (machineId: string) => void,
  onTabsClosed?: (tabIds: string[]) => void,
) {
  const closedTabIds: string[] = [];
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
    closeTerminalTab(tabId);
    closedTabIds.push(tabId);
  }
  if (closedTabIds.length > 0) {
    onTabsClosed?.(closedTabIds);
  }
}
