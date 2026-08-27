// @author kongweiguang

import type { RefObject } from "react";
import { createPortal } from "react-dom";
import { writeDesktopClipboardText } from "../../lib/desktopClipboardApi";
import {
  dispatchWorkspaceFileTabCommand,
  type TerminalTab,
  type TerminalTabGroupDefinition,
  type TerminalTabGroupPreference,
  type WorkspaceFileDirtyState,
} from "../workspace/contracts/index";
import type { TerminalAppearance } from "../settings/contracts/index";
import { TerminalTabOverviewMenu } from "./TerminalTabOverviewMenu";
import { TerminalTabGroupEditDialog } from "./TerminalTabGroupEditDialog";
import type { TerminalTabPresentation } from "./terminalTabPresentationModel";
import {
  CloseTabsConfirmationDialog,
  CloseWorkspaceFileTabsConfirmationDialog,
  TerminalTabContextMenuItems,
  TerminalTabGroupContextMenuItems,
  TerminalTabRenameDialog,
  type TerminalTabContextMenu,
  type TerminalTabGroup,
} from "./terminalTabChrome";
import type { MachineStatus } from "../workspace/contracts/index";

const terminalContextMenuPanelClassName =
  "kerminal-context-menu kerminal-floating-enter kerminal-layer-popover fixed w-56";

interface TerminalWorkspaceTabOverlaysProps {
  activeTabId: string;
  collapsedGroupIds: ReadonlySet<string>;
  contextMenu: TerminalTabContextMenu | null;
  contextMenuRef: RefObject<HTMLDivElement | null>;
  contextTab?: TerminalTab;
  contextTabGroup?: TerminalTabGroup;
  creatingGroupForTabId: string | null;
  editingTabGroup: TerminalTabGroup | null;
  explicitTabGroups: boolean;
  onCloseContextDialog: () => void;
  onCloseTabs: (tabIds: string[]) => void;
  onConfirmCloseTabs: () => void;
  onConfirmDirtyCloseTabs: () => void;
  onCreateGroup?: (
    tabId: string,
    definition: Partial<TerminalTabGroupDefinition>,
  ) => void;
  onDismissCloseTabs: () => void;
  onDismissDirtyCloseTabs: () => void;
  onMoveGroup?: (groupId: string, direction: "before" | "after") => void;
  onMoveTabToGroup?: (tabId: string, groupId: string) => void;
  onMoveTabWithinGroup?: (tabId: string, direction: "before" | "after") => void;
  onRemoveTabFromGroup?: (tabId: string) => void;
  onRequestCreateGroup?: (tabId: string) => void;
  onRequestEditGroup?: (group: TerminalTabGroup) => void;
  onRequestRenameTab: (tab: TerminalTab) => void;
  onRenameTab: (tabId: string, title: string) => void;
  onRevealWorkspaceFileInSftp?: (tabId: string) => void;
  onSaveGroup: (
    groupId: string,
    preference: TerminalTabGroupPreference,
  ) => void;
  onSelectTab: (tabId: string) => void;
  onSelectTabFromOverview: (tabId: string) => void;
  onToggleGroup: (groupId: string) => void;
  onUngroup?: (groupId: string) => void;
  overviewMenuRef: RefObject<HTMLDivElement | null>;
  overviewOpen: boolean;
  overviewPosition: { x: number; y: number };
  pendingCloseTabIds: string[] | null;
  pendingDirtyCloseTabIds: string[] | null;
  renamingTab: TerminalTab | null;
  runMenuAction: (action?: () => void) => void;
  tabGroups: TerminalTabGroup[];
  tabPresentationById: ReadonlyMap<string, TerminalTabPresentation>;
  tabs: TerminalTab[];
  tabStatusById: ReadonlyMap<string, MachineStatus>;
  terminalAppearance: TerminalAppearance;
  workspaceFileDirtyState: WorkspaceFileDirtyState;
}

/**
 * 集中渲染标签栏 portal 与 Dialog，确保所有覆盖层从 document 主题继承 CSS 变量；
 * 组件只转发已经解析好的命令，不持有排序或关闭领域状态。
 */
export function TerminalWorkspaceTabOverlays(
  props: TerminalWorkspaceTabOverlaysProps,
) {
  const {
    activeTabId,
    collapsedGroupIds,
    contextMenu,
    contextMenuRef,
    contextTab,
    contextTabGroup,
    creatingGroupForTabId,
    editingTabGroup,
    explicitTabGroups,
    onCloseContextDialog,
    onCloseTabs,
    onConfirmCloseTabs,
    onConfirmDirtyCloseTabs,
    onCreateGroup,
    onDismissCloseTabs,
    onDismissDirtyCloseTabs,
    onMoveGroup,
    onMoveTabToGroup,
    onMoveTabWithinGroup,
    onRemoveTabFromGroup,
    onRequestCreateGroup,
    onRequestEditGroup,
    onRequestRenameTab,
    onRenameTab,
    onRevealWorkspaceFileInSftp,
    onSaveGroup,
    onSelectTab,
    onSelectTabFromOverview,
    onToggleGroup,
    onUngroup,
    overviewMenuRef,
    overviewOpen,
    overviewPosition,
    pendingCloseTabIds,
    pendingDirtyCloseTabIds,
    renamingTab,
    runMenuAction,
    tabGroups,
    tabPresentationById,
    tabs,
    tabStatusById,
    terminalAppearance,
    workspaceFileDirtyState,
  } = props;
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
                availableGroups={tabGroups.filter((group) => group.grouped)}
                group={contextTabGroup}
                onCloseTabs={onCloseTabs}
                onCopyWorkspaceFilePath={(tab) => {
                  void writeDesktopClipboardText(tab.path);
                }}
                onReloadWorkspaceFile={(tabId) =>
                  dispatchWorkspaceFileTabCommand({ command: "reload", tabId })
                }
                onRequestEditIdentity={
                  !explicitTabGroups ? onRequestEditGroup : undefined
                }
                onRequestCreateGroup={onRequestCreateGroup}
                onMoveToGroup={onMoveTabToGroup}
                onRemoveFromGroup={onRemoveTabFromGroup}
                onMoveWithinGroup={onMoveTabWithinGroup}
                onRequestRename={onRequestRenameTab}
                onRevealWorkspaceFileInSftp={onRevealWorkspaceFileInSftp}
                onSelectTab={onSelectTab}
                runMenuAction={runMenuAction}
                tab={contextTab}
                tabs={tabs}
              />
            ) : null}
            {contextMenu.type === "group" && contextTabGroup ? (
              <TerminalTabGroupContextMenuItems
                collapsed={collapsedGroupIds.has(contextTabGroup.id)}
                group={contextTabGroup}
                onCloseTabs={onCloseTabs}
                onRequestEdit={onRequestEditGroup}
                onMoveGroup={onMoveGroup}
                onUngroup={onUngroup}
                runMenuAction={runMenuAction}
                tabs={tabs}
                toggleTabGroup={onToggleGroup}
              />
            ) : null}
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      {contextMenuElement}
      <TerminalTabOverviewMenu
        activeTabId={activeTabId}
        menuRef={overviewMenuRef}
        onSelectTab={onSelectTabFromOverview}
        open={overviewOpen}
        position={overviewPosition}
        tabGroups={tabGroups}
        tabs={tabs}
        tabStatusById={tabStatusById}
        tabPresentationById={tabPresentationById}
        terminalAppearance={terminalAppearance}
      />
      <TerminalTabRenameDialog
        onClose={onCloseContextDialog}
        onRenameTab={onRenameTab}
        tab={renamingTab}
      />
      <TerminalTabGroupEditDialog
        createForTabId={creatingGroupForTabId}
        group={editingTabGroup}
        onClose={onCloseContextDialog}
        onCreate={onCreateGroup}
        onSave={onSaveGroup}
      />
      <CloseTabsConfirmationDialog
        onClose={onDismissCloseTabs}
        onConfirm={onConfirmCloseTabs}
        tabCount={pendingCloseTabIds?.length ?? 0}
      />
      <CloseWorkspaceFileTabsConfirmationDialog
        dirtyTabCount={
          pendingDirtyCloseTabIds?.filter(
            (tabId) => workspaceFileDirtyState[tabId],
          ).length ?? 0
        }
        onClose={onDismissDirtyCloseTabs}
        onConfirm={onConfirmDirtyCloseTabs}
        tabCount={pendingDirtyCloseTabIds?.length ?? 0}
      />
    </>
  );
}
