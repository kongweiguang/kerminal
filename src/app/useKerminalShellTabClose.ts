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
  /**
   * 让所有已经通过确认的关闭请求共享同一份 tab 快照；owner 清理必须基于
   * 完整批次计算，否则逐个调用会把仍在本批次关闭的 tab 误判为存活 owner。
   */
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
  /**
   * 组关闭和“关闭其它标签”等批量动作已经完成确认，因此必须整体进入
   * 关闭协调器；不能在调用方拆成多个 singleton，否则 external SSH 的资源
   * 生命周期会看到不完整的关闭集合。
   */
  const closeConfirmedTabs = useCallback(
    (tabIds: string[]) => closeTabs(tabIds),
    [closeTabs],
  );
  const closeConfirmedTab = useCallback(
    (tabId: string) => closeConfirmedTabs([tabId]),
    [closeConfirmedTabs],
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
    closeConfirmedTabs,
    closeConfirmedTab,
    confirmDirtyFileTabs,
    confirmTerminalTabs,
    dirtyFileTabCount,
    pendingDirtyFileTabCount: pendingDirtyFileTabIds?.length ?? 0,
    pendingTerminalTabCount: pendingTerminalTabIds?.length ?? 0,
    requestCloseTab,
  };
}

/**
 * 以批次为单位执行关闭和 owner 清理，避免多个关闭入口各自释放同一外部
 * launch；SFTP 的拒绝或清理异常只跳过对应 tab，不影响同批次其它 tab。
 */
async function closeTabsWithExternalOwners(
  tabIds: string[],
  terminalTabs: TerminalTab[],
  closeExternalLaunch: (launchId: string) => Promise<unknown>,
  closeTerminalTab: (tabId: string) => void,
  removeSidebarMachine: (machineId: string) => void,
  onTabsClosed?: (tabIds: string[]) => void,
) {
  /**
   * 关闭副作用按“实际成功关闭的 tab”结算，而不是按请求 ID 结算：重复或
   * stale ID 只能 no-op；external launch/sidebar 则在批次末尾按 launch 去重，
   * 并把未能关闭的 SFTP tab 保留为真实 owner，避免过早释放共享资源。
   */
  const requestedTabIds = uniqueTabIds(tabIds);
  if (requestedTabIds.length === 0) {
    return;
  }

  const tabsById = new Map(terminalTabs.map((tab) => [tab.id, tab]));
  const closedTabIds: string[] = [];
  const closedTabIdSet = new Set<string>();

  for (const tabId of requestedTabIds) {
    const tab = tabsById.get(tabId);
    if (!tab) {
      continue;
    }
    if (tab.kind === "sftpTransfer" && tab.externalLaunchId) {
      let preparation: ReturnType<typeof prepareExternalSftpTabClose>;
      try {
        preparation = prepareExternalSftpTabClose(tabId);
      } catch {
        continue;
      }
      if (!preparation.canClose) {
        continue;
      }
      try {
        await preparation.cleanup;
      } catch {
        continue;
      }
      closeTerminalTab(tabId);
      closedTabIdSet.add(tabId);
      closedTabIds.push(tabId);
      continue;
    }
    closeTerminalTab(tabId);
    closedTabIdSet.add(tabId);
    closedTabIds.push(tabId);
  }

  const launchIdsToRelease = new Map<string, string>();
  for (const tabId of closedTabIds) {
    const tab = tabsById.get(tabId);
    if (!tab) {
      continue;
    }
    const externalLaunchId =
      tab.kind === "sftpTransfer"
        ? tab.externalLaunchId
        : externalSshLaunchIdFromMachineId(tab.machineId);
    if (externalLaunchId) {
      launchIdsToRelease.set(externalLaunchId, tab.machineId);
    }
  }

  for (const [externalLaunchId, machineId] of launchIdsToRelease) {
    const ownerRemains = terminalTabs.some(
      (candidate) => {
        if (closedTabIdSet.has(candidate.id)) {
          return false;
        }
        const candidateLaunchId =
          candidate.kind === "sftpTransfer"
            ? candidate.externalLaunchId
            : externalSshLaunchIdFromMachineId(candidate.machineId);
        return candidateLaunchId === externalLaunchId;
      },
    );
    if (ownerRemains) {
      continue;
    }
    removeSidebarMachine(machineId);
    void closeExternalLaunch(externalLaunchId).catch(() => undefined);
  }

  if (closedTabIds.length > 0) {
    onTabsClosed?.(closedTabIds);
  }
}

/** 去重且保留调用方顺序，保证批量关闭的回调顺序稳定且 stale ID 可安全忽略。 */
function uniqueTabIds(tabIds: string[]): string[] {
  return [...new Set(tabIds)];
}
