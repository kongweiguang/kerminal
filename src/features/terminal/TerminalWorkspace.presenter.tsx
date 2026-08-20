// @author kongweiguang

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { writeDesktopClipboardText } from "../../lib/desktopClipboardApi";
import type {
  InterfaceDensity,
  ResolvedTheme,
  TerminalAppearance,
} from "../settings/contracts/index";
import {
  analyzeBroadcastCommand,
  canBroadcastCommand,
  type BroadcastCommandAnalysis,
} from "./broadcastCommandPolicy";
import { collectPaneIds } from "../workspace/contracts/index";
import {
  isTerminalSessionTab,
  type MachineStatus,
  type MachineGroup,
  type TerminalPane,
  type TerminalSplitDirection,
  type TerminalSplitLayoutSizes,
  type TerminalTab,
  type TerminalTabGroupPreference,
  type TerminalTabGroupPreferences,
  type WorkspaceFileDirtyState,
} from "../workspace/contracts/index";
import { dispatchWorkspaceFileTabCommand } from "../workspace/contracts/index";
import { resolveWorkspaceTabCloseDecision } from "../workspace/contracts/index";
import { TerminalBroadcastBar } from "./TerminalBroadcastBar";
import { TerminalTabOverviewMenu } from "./TerminalTabOverviewMenu";
import { TerminalTabGroupEditDialog } from "./TerminalTabGroupEditDialog";
import { TerminalTabBar } from "./TerminalTabBar";
import { terminalChromeRuntimeStore } from "./terminalChromeRuntimeStore";
import {
  resolveTerminalTabPresentation,
  type TerminalTabPresentation,
} from "./terminalTabPresentationModel";
import { TerminalWorkspaceContent } from "./TerminalWorkspaceContent";
import type {
  TerminalPaneMoveDropZone,
  TerminalPaneMoveScope,
} from "./terminalPaneMoveDropZones";
import type { TerminalSplitDropIndicator } from "./TerminalSplitDropOverlay";
import type { TerminalSplitPaneOptions } from "./terminalSplitTargets";
import type { ConnectionState } from "./XtermPane.helpers";
import { useTerminalBroadcastTargets } from "./useTerminalBroadcastTargets";
import { useTerminalTabOverview } from "./TerminalWorkspace.tabOverview";
import {
  buildTerminalTabGroups,
  clampContextMenuPosition,
  CloseTabsConfirmationDialog,
  CloseWorkspaceFileTabsConfirmationDialog,
  TerminalTabContextMenuItems,
  TerminalTabGroupContextMenuItems,
  TerminalTabRenameDialog,
  type TerminalTabGroup,
  type TerminalTabContextMenu,
  type TerminalTabContextMenuPayload,
} from "./terminalTabChrome";

const terminalContextMenuPanelClassName =
  "kerminal-context-menu kerminal-floating-enter kerminal-layer-popover fixed w-56";
const EMPTY_PANE_CHROME_SNAPSHOTS: ReturnType<
  typeof terminalChromeRuntimeStore.getSnapshots
> = Object.freeze([]);

export interface BroadcastCommandRequest {
  command: string;
  data: string;
  targetPaneIds: string[];
}

export interface BroadcastCommandResult {
  missingPaneIds: string[];
  sentPaneIds: string[];
}

interface TerminalWorkspaceProps {
  activeTabId: string;
  backgroundImageVisible?: boolean;
  broadcastDraft: string;
  contentLeftInset?: number;
  contentRightInset?: number;
  focusedPaneId: string;
  interfaceDensity?: InterfaceDensity;
  machineGroups?: MachineGroup[];
  panes: TerminalPane[];
  resolvedTheme: ResolvedTheme;
  tabs: TerminalTab[];
  tabGroupPreferences?: TerminalTabGroupPreferences;
  terminalAppearance: TerminalAppearance;
  onBroadcastCommand: (
    request: BroadcastCommandRequest,
  ) => Promise<BroadcastCommandResult>;
  onBroadcastDraftChange: (draft: string) => void;
  onClosePane: (paneId: string) => void;
  onCloseTab: (tabId: string) => void;
  onCreateTerminal?: () => void;
  onFocusPane: (paneId: string) => void;
  onOpenAgentTool?: () => void;
  onOpenConnection?: () => void;
  onRevealWorkspaceFileInSftp?: (tabId: string) => void;
  onMovePane?: (
    sourcePaneId: string,
    targetPaneId: string,
    placement: TerminalPaneMoveDropZone,
    scope?: TerminalPaneMoveScope,
  ) => void;
  onPaneConnectionStateChange?: (
    paneId: string,
    state: ConnectionState,
  ) => void;
  onPaneCurrentCwdChange?: (paneId: string, cwd: string) => void;
  onPaneOutputHistoryChange?: (
    paneId: string,
    outputHistory: string | undefined,
  ) => void;
  onSplitLayoutSizesChange?: (
    splitId: string,
    sizes: TerminalSplitLayoutSizes,
  ) => void;
  onOpenLogs?: () => void;
  onRenameTab: (tabId: string, title: string) => void;
  onUpdateTabGroupPreference?: (
    groupId: string,
    preference: TerminalTabGroupPreference,
  ) => void;
  leftTitleBarInset?: number;
  reserveRightTitleBarControls?: boolean;
  resolvePaneLines?: (paneId: string) => string[];
  resolvePaneOutputHistory?: (paneId: string) => string | undefined;
  renderCustomTab?: (tab: TerminalTab, active: boolean) => ReactNode;
  onSelectTab: (tabId: string) => void;
  onSplitPane: (
    direction: TerminalSplitDirection,
    options?: TerminalSplitPaneOptions,
  ) => void;
  splitDropIndicator?: TerminalSplitDropIndicator | null;
  workspaceFileDirtyState?: WorkspaceFileDirtyState;
}

/**
 * 组合标签、广播栏和活动终端内容；左右 inset 只施加到标签栏下方，既让导航横跨
 * 停靠面板上方，也避免面板覆盖实际终端与广播交互区。
 */
export function TerminalWorkspace({
  activeTabId,
  backgroundImageVisible = false,
  broadcastDraft,
  contentLeftInset = 0,
  contentRightInset = 0,
  focusedPaneId,
  interfaceDensity = "comfortable",
  leftTitleBarInset = 0,
  machineGroups = [],
  onBroadcastCommand,
  onBroadcastDraftChange,
  onClosePane,
  onCloseTab,
  onCreateTerminal,
  onFocusPane,
  onOpenAgentTool,
  onOpenConnection,
  onMovePane,
  onPaneConnectionStateChange,
  onPaneCurrentCwdChange,
  onPaneOutputHistoryChange,
  onSplitLayoutSizesChange,
  onOpenLogs,
  onRevealWorkspaceFileInSftp,
  onRenameTab,
  onUpdateTabGroupPreference,
  reserveRightTitleBarControls = true,
  resolvePaneLines,
  resolvePaneOutputHistory,
  renderCustomTab,
  onSelectTab,
  onSplitPane,
  panes,
  resolvedTheme,
  splitDropIndicator,
  tabs,
  tabGroupPreferences = {},
  terminalAppearance,
  workspaceFileDirtyState = {},
}: TerminalWorkspaceProps) {
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];
  const tabGroups = useMemo(
    () =>
      buildTerminalTabGroups(tabs, tabGroupPreferences, {
        machineGroups,
        panes,
      }),
    [machineGroups, panes, tabGroupPreferences, tabs],
  );
  const [collapsedTabGroupIds, setCollapsedTabGroupIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [contextMenu, setContextMenu] = useState<TerminalTabContextMenu | null>(
    null,
  );
  const [editingTabGroup, setEditingTabGroup] =
    useState<TerminalTabGroup | null>(null);
  const [renamingTab, setRenamingTab] = useState<TerminalTab | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const panesById = useMemo(
    () => new Map(panes.map((pane) => [pane.id, pane])),
    [panes],
  );
  const tabStatusById = useMemo(
    () =>
      new Map(
        tabs.map((tab) => [tab.id, resolveTerminalTabStatus(tab, panesById)]),
      ),
    [panesById, tabs],
  );
  const paneChromeSnapshots = useSyncExternalStore(
    terminalChromeRuntimeStore.subscribeAll,
    terminalChromeRuntimeStore.getSnapshots,
    () => EMPTY_PANE_CHROME_SNAPSHOTS,
  );
  const tabPresentationById = useMemo(() => {
    const snapshotsByPaneId = new Map(
      paneChromeSnapshots.map((snapshot) => [snapshot.paneId, snapshot]),
    );
    return new Map<string, TerminalTabPresentation>(
      tabs.map((tab) => {
        if (!isTerminalSessionTab(tab)) {
          return [tab.id, resolveTerminalTabPresentation([])];
        }
        const paneSnapshots = collectPaneIds(tab.layout)
          .map((paneId) => snapshotsByPaneId.get(paneId))
          .filter((snapshot) => snapshot !== undefined);
        return [tab.id, resolveTerminalTabPresentation(paneSnapshots)];
      }),
    );
  }, [paneChromeSnapshots, tabs]);
  const activePaneIds = useMemo(
    () =>
      activeTab && isTerminalSessionTab(activeTab)
        ? collectPaneIds(activeTab.layout)
        : [],
    [activeTab],
  );
  const hasActiveSplit = activePaneIds.length > 1;
  const {
    broadcastTargets,
    broadcastTargetMode,
    broadcastTargetOptions,
    handleBroadcastTargetModeChange,
    handleToggleCustomTarget,
    selectedTargetPaneIds,
  } = useTerminalBroadcastTargets({
    activePaneIds,
    focusedPaneId,
    panesById,
  });
  const broadcastAnalysis = useMemo(
    () => analyzeBroadcastCommand(broadcastDraft, broadcastTargets),
    [broadcastDraft, broadcastTargets],
  );
  const [broadcastStatus, setBroadcastStatus] = useState<string | null>(null);
  const [broadcastError, setBroadcastError] = useState<string | null>(null);
  const [pendingCloseTabIds, setPendingCloseTabIds] = useState<string[] | null>(
    null,
  );
  const [pendingDirtyCloseTabIds, setPendingDirtyCloseTabIds] = useState<
    string[] | null
  >(null);
  const [sendingBroadcast, setSendingBroadcast] = useState(false);
  const contextTab =
    contextMenu?.type === "tab"
      ? tabs.find((tab) => tab.id === contextMenu.tabId)
      : undefined;
  const contextTabGroup =
    contextMenu?.type === "group"
      ? tabGroups.find((group) => group.id === contextMenu.groupId)
      : contextTab
        ? tabGroups.find((group) =>
            group.tabs.some((tab) => tab.id === contextTab.id),
          )
        : undefined;
  const compactDensity = interfaceDensity === "compact";
  const spaciousDensity = interfaceDensity === "spacious";
  const tabBarHeightClass = compactDensity
    ? "h-9"
    : spaciousDensity
      ? "h-10"
      : "h-9";
  const toolbarPaddingClass = compactDensity
    ? "px-2 py-1.5"
    : spaciousDensity
      ? "px-4 py-3"
      : "px-3 py-2";
  const workspacePaddingClass = compactDensity
    ? "p-1.5"
    : spaciousDensity
      ? "p-3"
      : "p-2";
  const terminalInset = compactDensity ? 6 : spaciousDensity ? 12 : 8;
  const contentInsetStyle =
    contentLeftInset > 0 || contentRightInset > 0
      ? ({
          marginLeft: contentLeftInset,
          marginRight: contentRightInset,
        } satisfies CSSProperties)
      : undefined;
  const tabBarStyle =
    leftTitleBarInset > 0
      ? ({ paddingLeft: leftTitleBarInset } satisfies CSSProperties)
      : undefined;
  const {
    handleTabListWheel,
    selectTabFromOverview,
    shouldShowTabOverview,
    tabListRef,
    tabOverviewButtonRef,
    tabOverviewMenuRef,
    tabOverviewOpen,
    tabOverviewPosition,
    toggleTabOverview,
  } = useTerminalTabOverview({
    collapsedTabGroupIds,
    onSelectTab,
    tabCount: tabs.length,
    tabGroups,
  });

  useEffect(() => {
    setCollapsedTabGroupIds((current) => {
      const validIds = new Set(
        tabGroups.filter((group) => group.grouped).map((group) => group.id),
      );
      const next = new Set([...current].filter((id) => validIds.has(id)));
      if (next.size === current.size) {
        return current;
      }
      return next;
    });
  }, [tabGroups]);

  useEffect(() => {
    if (hasActiveSplit) {
      return;
    }

    setBroadcastStatus(null);
    setBroadcastError(null);
  }, [hasActiveSplit]);

  useEffect(() => {
    if (!contextMenu) {
      return undefined;
    }

    const close = () => setContextMenu(null);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setContextMenu(null);
      }
    };
    window.addEventListener("click", close);
    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", close);
    };
  }, [contextMenu]);

  useEffect(() => {
    if (!editingTabGroup) {
      return;
    }

    const nextGroup = tabGroups.find(
      (group) => group.id === editingTabGroup.id,
    );
    if (!nextGroup) {
      setEditingTabGroup(null);
      return;
    }

    if (!sameTerminalTabGroupSnapshot(nextGroup, editingTabGroup)) {
      setEditingTabGroup(nextGroup);
    }
  }, [editingTabGroup, tabGroups]);

  useEffect(() => {
    if (!renamingTab) {
      return;
    }

    if (!tabs.some((tab) => tab.id === renamingTab.id)) {
      setRenamingTab(null);
    }
  }, [renamingTab, tabs]);

  useLayoutEffect(() => {
    if (!contextMenu) {
      return;
    }

    const menuElement = contextMenuRef.current;
    if (!menuElement) {
      return;
    }

    const rect = menuElement.getBoundingClientRect();
    const nextPosition = clampContextMenuPosition(
      contextMenu.x,
      contextMenu.y,
      rect.width,
      rect.height,
    );
    if (nextPosition.x === contextMenu.x && nextPosition.y === contextMenu.y) {
      return;
    }
    setContextMenu((current) =>
      current === contextMenu ? { ...current, ...nextPosition } : current,
    );
  }, [contextMenu]);

  const executeBroadcast = useCallback(
    async (analysis: BroadcastCommandAnalysis) => {
      if (!canBroadcastCommand(analysis)) {
        setBroadcastError(
          analysis.command
            ? "当前 tab 没有可发送的真实终端分屏。"
            : "请输入要发送的命令。",
        );
        return;
      }

      setSendingBroadcast(true);
      setBroadcastError(null);
      try {
        const result = await onBroadcastCommand({
          command: analysis.command,
          data: analysis.data,
          targetPaneIds: analysis.targets.map((target) => target.paneId),
        });
        const skipped =
          result.missingPaneIds.length > 0
            ? `，${result.missingPaneIds.length} 个分屏尚未连接`
            : "";
        setBroadcastStatus(
          `已发送到 ${result.sentPaneIds.length} 个分屏${skipped}。`,
        );
        if (result.sentPaneIds.length > 0) {
          onBroadcastDraftChange("");
        }
      } catch (error) {
        setBroadcastError(
          error instanceof Error ? error.message : String(error),
        );
      } finally {
        setSendingBroadcast(false);
      }
    },
    [onBroadcastCommand, onBroadcastDraftChange],
  );

  const requestBroadcast = useCallback(() => {
    setBroadcastStatus(null);
    setBroadcastError(null);
    if (!canBroadcastCommand(broadcastAnalysis)) {
      void executeBroadcast(broadcastAnalysis);
      return;
    }
    void executeBroadcast(broadcastAnalysis);
  }, [broadcastAnalysis, executeBroadcast]);

  const handleDraftChange = useCallback(
    (draft: string) => {
      setBroadcastStatus(null);
      setBroadcastError(null);
      onBroadcastDraftChange(draft);
    },
    [onBroadcastDraftChange],
  );
  const toggleTabGroup = useCallback((groupId: string) => {
    setCollapsedTabGroupIds((current) => {
      const next = new Set(current);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  }, []);
  const openContextMenu = useCallback(
    (event: ReactMouseEvent, menu: TerminalTabContextMenuPayload) => {
      event.preventDefault();
      event.stopPropagation();
      const position = clampContextMenuPosition(
        event.clientX,
        event.clientY,
        0,
        0,
      );
      setContextMenu({ ...menu, ...position });
    },
    [],
  );
  const runMenuAction = useCallback((action?: () => void) => {
    setContextMenu(null);
    action?.();
  }, []);
  const requestCloseTabs = useCallback(
    (tabIds: string[], confirmedDirtyFiles = false) => {
      const decision = resolveWorkspaceTabCloseDecision({
        confirmTerminalClose: terminalAppearance.confirmCloseTab,
        confirmedDirtyFiles,
        tabIds,
        tabs,
        workspaceFileDirtyState,
      });
      if (decision.kind === "confirmDirtyFiles") {
        setPendingDirtyCloseTabIds(decision.tabIds);
        return;
      }
      if (decision.kind === "confirmTerminalTabs") {
        setPendingCloseTabIds(decision.tabIds);
        return;
      }
      for (const tabId of decision.tabIds) {
        onCloseTab(tabId);
      }
    },
    [
      onCloseTab,
      tabs,
      terminalAppearance.confirmCloseTab,
      workspaceFileDirtyState,
    ],
  );
  const confirmCloseTabs = useCallback(() => {
    if (!pendingCloseTabIds) {
      return;
    }
    for (const tabId of pendingCloseTabIds) {
      onCloseTab(tabId);
    }
    setPendingCloseTabIds(null);
  }, [onCloseTab, pendingCloseTabIds]);
  const confirmDirtyFileCloseTabs = useCallback(() => {
    if (!pendingDirtyCloseTabIds) {
      return;
    }
    requestCloseTabs(pendingDirtyCloseTabIds, true);
    setPendingDirtyCloseTabIds(null);
  }, [pendingDirtyCloseTabIds, requestCloseTabs]);
  const contextMenuElement =
    contextMenu && typeof document !== "undefined"
      ? createPortal(
          <div
            aria-label="终端标签操作菜单"
            className={terminalContextMenuPanelClassName}
            onClick={(event) => event.stopPropagation()}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            ref={contextMenuRef}
            role="menu"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            {contextMenu.type === "tab" && contextTab ? (
              <TerminalTabContextMenuItems
                activeTabId={activeTabId}
                group={contextTabGroup}
                onCloseTabs={requestCloseTabs}
                onCopyWorkspaceFilePath={(tab) => {
                  void writeDesktopClipboardText(tab.path);
                }}
                onReloadWorkspaceFile={(tabId) =>
                  dispatchWorkspaceFileTabCommand({
                    command: "reload",
                    tabId,
                  })
                }
                onRequestEditIdentity={
                  onUpdateTabGroupPreference
                    ? setEditingTabGroup
                    : undefined
                }
                onRequestRename={setRenamingTab}
                onRevealWorkspaceFileInSftp={onRevealWorkspaceFileInSftp}
                onSelectTab={onSelectTab}
                runMenuAction={runMenuAction}
                tab={contextTab}
                tabs={tabs}
              />
            ) : null}
            {contextMenu.type === "group" && contextTabGroup ? (
              <TerminalTabGroupContextMenuItems
                collapsed={collapsedTabGroupIds.has(contextTabGroup.id)}
                group={contextTabGroup}
                onCloseTabs={requestCloseTabs}
                onRequestEdit={
                  onUpdateTabGroupPreference ? setEditingTabGroup : undefined
                }
                runMenuAction={runMenuAction}
                tabs={tabs}
                toggleTabGroup={toggleTabGroup}
              />
            ) : null}
          </div>,
          document.body,
        )
      : null;
  const tabOverviewElement = (
    <TerminalTabOverviewMenu
      activeTabId={activeTabId}
      menuRef={tabOverviewMenuRef}
      onSelectTab={selectTabFromOverview}
      open={tabOverviewOpen}
      position={tabOverviewPosition}
      tabGroups={tabGroups}
      tabs={tabs}
      tabStatusById={tabStatusById}
      tabPresentationById={tabPresentationById}
      terminalAppearance={terminalAppearance}
    />
  );

  return (
    <main
      aria-label="终端工作区"
      className="kerminal-workspace-surface flex h-full w-full min-w-0 flex-col overflow-hidden"
      data-density={interfaceDensity}
    >
      <TerminalTabBar
        activeTabId={activeTabId}
        collapsedGroupIds={collapsedTabGroupIds}
        heightClassName={tabBarHeightClass}
        onOpenContextMenu={openContextMenu}
        onRequestCloseTab={(tabId) => requestCloseTabs([tabId])}
        onSelectTab={onSelectTab}
        onToggleGroup={toggleTabGroup}
        onToggleOverview={toggleTabOverview}
        onWheel={handleTabListWheel}
        overviewButtonRef={tabOverviewButtonRef}
        overviewOpen={tabOverviewOpen}
        reserveRightTitleBarControls={reserveRightTitleBarControls}
        shouldShowOverview={shouldShowTabOverview}
        style={tabBarStyle}
        tabGroups={tabGroups}
        tabListRef={tabListRef}
        tabPresentationById={tabPresentationById}
        tabs={tabs}
        tabStatusById={tabStatusById}
        terminalAppearance={terminalAppearance}
        workspaceFileDirtyState={workspaceFileDirtyState}
      />
      {contextMenuElement}
      {tabOverviewElement}
      <TerminalTabRenameDialog
        onClose={() => setRenamingTab(null)}
        onRenameTab={onRenameTab}
        tab={renamingTab}
      />
      <TerminalTabGroupEditDialog
        group={editingTabGroup}
        onClose={() => setEditingTabGroup(null)}
        onSave={(groupId, preference) =>
          onUpdateTabGroupPreference?.(groupId, preference)
        }
      />
      <CloseTabsConfirmationDialog
        onClose={() => setPendingCloseTabIds(null)}
        onConfirm={confirmCloseTabs}
        tabCount={pendingCloseTabIds?.length ?? 0}
      />
      <CloseWorkspaceFileTabsConfirmationDialog
        dirtyTabCount={
          pendingDirtyCloseTabIds?.filter(
            (tabId) => workspaceFileDirtyState[tabId],
          ).length ?? 0
        }
        onClose={() => setPendingDirtyCloseTabIds(null)}
        onConfirm={confirmDirtyFileCloseTabs}
        tabCount={pendingDirtyCloseTabIds?.length ?? 0}
      />

      {hasActiveSplit ? (
        <TerminalBroadcastBar
          analysis={broadcastAnalysis}
          draft={broadcastDraft}
          error={broadcastError}
          focusedPaneId={focusedPaneId}
          onDraftChange={handleDraftChange}
          onRequestBroadcast={requestBroadcast}
          onTargetModeChange={handleBroadcastTargetModeChange}
          onToggleCustomTarget={handleToggleCustomTarget}
          selectedTargetPaneIds={selectedTargetPaneIds}
          sending={sendingBroadcast}
          status={broadcastStatus}
          style={contentInsetStyle}
          targetMode={broadcastTargetMode}
          targetOptions={broadcastTargetOptions}
          toolbarPaddingClass={toolbarPaddingClass}
        />
      ) : null}

      <TerminalWorkspaceContent
        activeTab={activeTab}
        backgroundImageVisible={backgroundImageVisible}
        contentInsetStyle={contentInsetStyle}
        focusedPaneId={focusedPaneId}
        machineGroups={machineGroups}
        onClosePane={onClosePane}
        onCreateTerminal={onCreateTerminal}
        onFocusPane={onFocusPane}
        onOpenAgentTool={onOpenAgentTool}
        onOpenConnection={onOpenConnection}
        onOpenLogs={onOpenLogs}
        onMovePane={onMovePane}
        onPaneConnectionStateChange={onPaneConnectionStateChange}
        onPaneCurrentCwdChange={onPaneCurrentCwdChange}
        onPaneOutputHistoryChange={onPaneOutputHistoryChange}
        onSplitLayoutSizesChange={onSplitLayoutSizesChange}
        onSplitPane={onSplitPane}
        panesById={panesById}
        resolvePaneLines={resolvePaneLines}
        resolvePaneOutputHistory={resolvePaneOutputHistory}
        renderCustomTab={renderCustomTab}
        resolvedTheme={resolvedTheme}
        splitDropIndicator={splitDropIndicator}
        tabs={tabs}
        terminalAppearance={terminalAppearance}
        terminalInset={terminalInset}
        workspacePaddingClass={workspacePaddingClass}
      />
    </main>
  );
}

function resolveTerminalTabStatus(
  tab: TerminalTab,
  panesById: Map<string, TerminalPane>,
): MachineStatus {
  if (!isTerminalSessionTab(tab)) {
    return "online";
  }
  const statuses = collectPaneIds(tab.layout)
    .map((paneId) => panesById.get(paneId)?.status)
    .filter((status): status is MachineStatus => Boolean(status));
  if (statuses.length === 0) {
    return "offline";
  }
  if (statuses.every((status) => status === "online")) {
    return "online";
  }
  if (statuses.every((status) => status === "offline")) {
    return "offline";
  }
  return "warning";
}

function sameTerminalTabGroupSnapshot(
  left: TerminalTabGroup,
  right: TerminalTabGroup,
) {
  return (
    left.id === right.id &&
    left.title === right.title &&
    left.color === right.color &&
    left.grouped === right.grouped &&
    left.tabs.length === right.tabs.length &&
    left.tabs.every((tab, index) => tab.id === right.tabs[index]?.id)
  );
}
