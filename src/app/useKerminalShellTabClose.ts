// @author kongweiguang
import { useCallback, useMemo, useState } from "react";
import type {
  TerminalTab,
  WorkspaceFileDirtyState,
} from "../features/workspace/types";
import { resolveWorkspaceTabCloseDecision } from "../features/workspace/workspaceTabCloseGuardModel";

interface UseKerminalShellTabCloseOptions {
  closeTerminalTab: (tabId: string) => void;
  confirmTerminalClose: boolean;
  onTabsClosed?: (tabIds: string[]) => void;
  terminalTabs: TerminalTab[];
  workspaceFileDirtyState: WorkspaceFileDirtyState;
}

/** 管理终端 tab 与未保存文件的两阶段关闭确认。 */
export function useKerminalShellTabClose({
  closeTerminalTab,
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
      for (const tabId of tabIds) closeTerminalTab(tabId);
      onTabsClosed?.(tabIds);
    },
    [closeTerminalTab, onTabsClosed],
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
