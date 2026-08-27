// @author kongweiguang

import { ChevronDown, ChevronRight, Layers2, X } from "lucide-react";
import type {
  DraggableAttributes,
  DraggableSyntheticListeners,
} from "@dnd-kit/core";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { cn } from "../../lib/cn";
import {
  isTerminalSessionTab,
  isWorkspaceFileTab,
  type MachineGroup,
  type MachineStatus,
  type TerminalPane,
  type TerminalTab,
  type TerminalTabGroupDefinition,
  type TerminalTabGroupColor,
  type TerminalTabGroupPreference,
  type WorkspaceFileTab,
} from "../workspace/contracts/index";
import { type TerminalTabIdentityAccent } from "./terminalTabIdentityModel";
import { TerminalTabAttention } from "./TerminalTabAttention";
import type { TerminalTabPresentation } from "./terminalTabPresentationModel";
import {
  TerminalTabMenuItem,
  TerminalTabMoveToGroupMenu,
} from "./terminalTabMenuPrimitives";
export { buildTerminalTabGroups } from "./terminalTabGroupProjection";
export {
  CloseTabsConfirmationDialog,
  CloseWorkspaceFileTabsConfirmationDialog,
  TerminalTabRenameDialog,
} from "./terminalTabDialogs";

export interface TerminalTabGroup {
  color: TerminalTabGroupColor;
  colorLabel: string;
  grouped: boolean;
  id: string;
  identityAccent: TerminalTabIdentityAccent;
  preference?: TerminalTabGroupPreference;
  tabs: TerminalTab[];
  title: string;
  /** 显式组定义；旧自动分组仅在迁移测试模式下没有该字段。 */
  definition?: TerminalTabGroupDefinition;
  collapsed?: boolean;
}

/** dnd-kit 的激活器契约只挂在真实按钮上，避免布局壳获得无效键盘焦点。 */
export interface TerminalTabDragActivatorProps {
  dragActivatorRef?: (node: HTMLElement | null) => void;
  dragAttributes?: DraggableAttributes;
  dragListeners?: DraggableSyntheticListeners;
}

export interface TerminalTabGroupBuildOptions {
  machineGroups?: MachineGroup[];
  panes?: TerminalPane[];
  mode?: "explicit" | "legacy";
}

export type TerminalTabContextMenu =
  | {
      type: "group";
      groupId: string;
      x: number;
      y: number;
    }
  | {
      type: "tab";
      tabId: string;
      x: number;
      y: number;
    };

export type TerminalTabContextMenuPayload =
  | {
      type: "group";
      groupId: string;
    }
  | {
      type: "tab";
      tabId: string;
    };

const CONTEXT_MENU_MARGIN = 8;
const terminalTabIdleClassName =
  "border-[var(--border-subtle)] bg-[var(--surface-solid)] text-zinc-600 shadow-sm shadow-black/5 hover:border-sky-500/25 hover:bg-[var(--surface-hover)] hover:text-zinc-950 dark:text-zinc-300 dark:shadow-black/20 dark:hover:border-sky-300/25 dark:hover:text-zinc-100";
const terminalTabCompactIdleClassName =
  "border-transparent bg-transparent text-zinc-600 hover:bg-white/55 hover:text-zinc-950 dark:text-zinc-300 dark:hover:bg-white/8 dark:hover:text-zinc-50";
const terminalTabCompactActiveClassName =
  "border-white/70 bg-white/72 text-zinc-950 shadow-sm shadow-black/8 ring-1 ring-white/70 dark:border-white/14 dark:bg-white/14 dark:text-zinc-50 dark:shadow-black/20 dark:ring-white/12";

/** 将菜单键和 Shift+F10 转成现有 contextmenu 链路，保证键盘不依赖鼠标坐标。 */
function dispatchTerminalTabContextMenu(
  event: ReactKeyboardEvent<HTMLButtonElement>,
) {
  if (
    event.key !== "ContextMenu" &&
    event.key !== "Menu" &&
    !(event.key === "F10" && event.shiftKey)
  ) {
    return;
  }
  event.preventDefault();
  const rect = event.currentTarget.getBoundingClientRect();
  event.currentTarget.dispatchEvent(
    new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: Math.round(rect.left),
      clientY: Math.round(rect.bottom),
    }),
  );
}

export function terminalTabStatusDotClassName(
  tab: TerminalTab,
  status: MachineStatus = "online",
  dirty = false,
) {
  if (tab.kind === "sftpTransfer") {
    return "bg-sky-400";
  }
  if (tab.kind === "workspaceFile") {
    return dirty ? "bg-amber-400" : "bg-emerald-400";
  }
  if (status === "offline") {
    return "bg-zinc-400 dark:bg-zinc-500";
  }
  if (status === "warning") {
    return "bg-amber-400";
  }
  return isTerminalSessionTab(tab) ? undefined : "bg-emerald-400";
}

export function TerminalTabButton({
  active,
  compact = false,
  onCloseTab,
  onContextMenu,
  onSelectTab,
  presentation,
  showClose,
  status = "online",
  tab,
  tabNumber,
  identityAccent,
  workspaceFileDirty,
  dragActivatorRef,
  dragAttributes,
  dragListeners,
}: {
  active: boolean;
  compact?: boolean;
  onCloseTab: (tabId: string) => void;
  onContextMenu: (event: ReactMouseEvent) => void;
  onSelectTab: (tabId: string) => void;
  presentation?: TerminalTabPresentation;
  showClose: boolean;
  status?: MachineStatus;
  tab: TerminalTab;
  tabNumber?: number;
  identityAccent?: TerminalTabIdentityAccent;
  workspaceFileDirty?: boolean;
} & TerminalTabDragActivatorProps) {
  const title = tabNumber ? `${tabNumber} · ${tab.title}` : tab.title;

  return (
    <div
      className={cn(
        "relative z-30 flex items-center gap-2 border text-sm transition-[background-color,border-color,box-shadow,color,transform] duration-150",
        compact ? "h-8 rounded-lg px-2" : "h-9 rounded-xl px-2.5",
        compact ? "max-w-[190px]" : "shrink-0",
        active
          ? compact
            ? terminalTabCompactActiveClassName
            : "border-sky-500/60 bg-sky-500/14 text-sky-800 shadow-md shadow-sky-500/15 ring-1 ring-sky-400/30 dark:border-sky-300/45 dark:bg-sky-400/16 dark:text-sky-50 dark:ring-sky-300/25"
          : compact
            ? terminalTabCompactIdleClassName
            : terminalTabIdleClassName,
      )}
      onContextMenu={onContextMenu}
    >
      <button
        aria-label={title}
        aria-pressed={active}
        className="kerminal-focus-ring absolute inset-0 appearance-none rounded-[inherit] border-0 bg-transparent p-0"
        onClick={() => onSelectTab(tab.id)}
        onKeyDown={dispatchTerminalTabContextMenu}
        ref={dragActivatorRef}
        type="button"
        {...dragAttributes}
        {...dragListeners}
      />
      {identityAccent?.visible ? (
        <span
          aria-hidden="true"
          className={cn(
            "pointer-events-none relative z-10 h-[18px] w-[3px] shrink-0 rounded-full",
            identityAccent.accentClassName,
          )}
          data-terminal-identity-accent={identityAccent.color}
          data-terminal-identity-source={identityAccent.source}
        />
      ) : null}
      {terminalTabStatusDotClassName(tab, status, workspaceFileDirty) ? (
        <span
          aria-hidden="true"
          className={cn(
            "pointer-events-none relative z-10 h-2 w-2 shrink-0 rounded-full",
            terminalTabStatusDotClassName(tab, status, workspaceFileDirty),
          )}
        />
      ) : null}
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none relative z-10 min-w-0 truncate rounded-md text-left",
          compact ? "max-w-[104px]" : "max-w-[160px]",
        )}
      >
        {title}
      </span>
      {presentation ? (
        <TerminalTabAttention
          attention={presentation.attention}
          count={
            presentation.attention !== "none"
              ? presentation.attentionCount
              : presentation.progressCount
          }
          label={presentation.statusLabel}
          progress={presentation.progress}
        />
      ) : null}
      {showClose ? (
        <button
          aria-label={`关闭 ${tab.title} tab`}
          className="kerminal-focus-ring kerminal-pressable relative z-20 rounded-md p-0.5 text-zinc-500 hover:bg-[var(--surface-hover)] hover:text-zinc-900 dark:hover:text-zinc-100"
          onClick={(event) => {
            event.stopPropagation();
            onCloseTab(tab.id);
          }}
          type="button"
        >
          <X className="h-3 w-3" />
        </button>
      ) : null}
    </div>
  );
}

export function TerminalTabGroupHeader({
  active,
  collapsed,
  group,
  onContextMenu,
  onToggle,
  presentation,
  dragActivatorRef,
  dragAttributes,
  dragListeners,
}: {
  active?: boolean;
  collapsed: boolean;
  group: TerminalTabGroup;
  onContextMenu: (event: ReactMouseEvent) => void;
  onToggle: () => void;
  presentation?: TerminalTabPresentation;
} & TerminalTabDragActivatorProps) {
  return (
    <button
      aria-expanded={!collapsed}
      aria-label={
        collapsed ? `展开 ${group.title} 标签组` : `折叠 ${group.title} 标签组`
      }
      className={cn(
        "kerminal-focus-ring kerminal-pressable flex h-9 max-w-[220px] items-center gap-1.5 rounded-lg border px-2.5 text-sm font-semibold shadow-sm shadow-black/5 dark:shadow-black/20",
        active
          ? "border-sky-500/40 bg-[var(--surface-selected)] text-sky-800 ring-1 ring-sky-400/20 dark:border-sky-300/30 dark:text-sky-100"
          : "border-transparent bg-transparent text-zinc-700 hover:border-[var(--border-subtle)] hover:bg-[var(--surface-hover)] dark:text-zinc-200",
      )}
      onKeyDown={dispatchTerminalTabContextMenu}
      onClick={onToggle}
      onContextMenu={onContextMenu}
      ref={dragActivatorRef}
      title={`${group.title} (${group.tabs.length})`}
      type="button"
      {...dragAttributes}
      {...dragListeners}
    >
      <span
        aria-hidden="true"
        className={cn(
          "h-[18px] w-[3px] shrink-0 rounded-full",
          group.identityAccent.accentClassName,
        )}
      />
      {collapsed ? (
        <ChevronRight className="h-3.5 w-3.5 shrink-0" />
      ) : (
        <ChevronDown className="h-3.5 w-3.5 shrink-0" />
      )}
      <Layers2 className="h-3.5 w-3.5 shrink-0 opacity-75" />
      <span className="truncate">{group.title}</span>
      {presentation ? (
        <TerminalTabAttention
          attention={presentation.attention}
          count={
            presentation.attention !== "none"
              ? presentation.attentionCount
              : presentation.progressCount
          }
          label={presentation.statusLabel}
          progress={presentation.progress}
        />
      ) : null}
      <span className="rounded-full bg-white/40 px-1.5 text-[10px] leading-4 opacity-80 dark:bg-white/10">
        {group.tabs.length}
      </span>
    </button>
  );
}

export function TerminalTabContextMenuItems({
  activeTabId,
  group,
  onCloseTabs,
  onCopyWorkspaceFilePath,
  onReloadWorkspaceFile,
  onRequestEditIdentity,
  onRequestCreateGroup,
  onMoveToGroup,
  onRemoveFromGroup,
  onMoveWithinGroup,
  onRequestRename,
  onRevealWorkspaceFileInSftp,
  onSelectTab,
  runMenuAction,
  tab,
  tabs,
  availableGroups,
}: {
  activeTabId: string;
  group: TerminalTabGroup | undefined;
  onCloseTabs: (tabIds: string[]) => void;
  onCopyWorkspaceFilePath?: (tab: WorkspaceFileTab) => void;
  onReloadWorkspaceFile?: (tabId: string) => void;
  onRequestEditIdentity?: (group: TerminalTabGroup) => void;
  onRequestCreateGroup?: (tabId: string) => void;
  onMoveToGroup?: (tabId: string, groupId: string) => void;
  onRemoveFromGroup?: (tabId: string) => void;
  onMoveWithinGroup?: (tabId: string, direction: "before" | "after") => void;
  onRequestRename: (tab: TerminalTab) => void;
  onRevealWorkspaceFileInSftp?: (tabId: string) => void;
  onSelectTab: (tabId: string) => void;
  runMenuAction: (action?: () => void) => void;
  tab: TerminalTab;
  tabs: TerminalTab[];
  availableGroups?: TerminalTabGroup[];
}) {
  const tabIndex = tabs.findIndex((candidate) => candidate.id === tab.id);
  const rightTabIds =
    tabIndex >= 0
      ? tabs.slice(tabIndex + 1).map((candidate) => candidate.id)
      : [];
  const otherTabIds = tabs
    .filter((candidate) => candidate.id !== tab.id)
    .map((candidate) => candidate.id);
  const sameGroupOtherTabIds =
    group && group.grouped
      ? group.tabs
          .filter((candidate) => candidate.id !== tab.id)
          .map((candidate) => candidate.id)
      : [];
  const workspaceFileTab = isWorkspaceFileTab(tab) ? tab : null;
  const canRevealWorkspaceFileInSftp =
    workspaceFileTab?.target.kind === "ssh" &&
    Boolean(onRevealWorkspaceFileInSftp);

  return (
    <>
      <TerminalTabMenuItem
        label={tab.id === activeTabId ? "当前标签" : "切换到此标签"}
        onClick={() => runMenuAction(() => onSelectTab(tab.id))}
      />
      {workspaceFileTab ? (
        <>
          <TerminalTabMenuItem
            disabled={!onCopyWorkspaceFilePath}
            label="复制完整路径"
            onClick={() =>
              runMenuAction(() => onCopyWorkspaceFilePath?.(workspaceFileTab))
            }
          />
          <TerminalTabMenuItem
            disabled={!canRevealWorkspaceFileInSftp}
            label="在 SFTP 中显示"
            onClick={() =>
              runMenuAction(() =>
                onRevealWorkspaceFileInSftp?.(workspaceFileTab.id),
              )
            }
          />
          <TerminalTabMenuItem
            disabled={!onReloadWorkspaceFile}
            label="重新加载"
            onClick={() =>
              runMenuAction(() => onReloadWorkspaceFile?.(workspaceFileTab.id))
            }
          />
        </>
      ) : null}
      <TerminalTabMenuItem
        label="重命名标签"
        onClick={() => runMenuAction(() => onRequestRename(tab))}
      />
      {onRequestCreateGroup ? (
        <TerminalTabMenuItem
          label="新建标签组…"
          onClick={() => runMenuAction(() => onRequestCreateGroup(tab.id))}
        />
      ) : null}
      {availableGroups?.some((candidate) => candidate.id !== group?.id) ? (
        <TerminalTabMoveToGroupMenu
          groups={availableGroups.filter(
            (candidate) => candidate.id !== group?.id,
          )}
          onMoveToGroup={(groupId) =>
            runMenuAction(() => onMoveToGroup?.(tab.id, groupId))
          }
        />
      ) : null}
      {group?.grouped && onRemoveFromGroup ? (
        <TerminalTabMenuItem
          label="移出标签组"
          onClick={() => runMenuAction(() => onRemoveFromGroup(tab.id))}
        />
      ) : null}
      {group?.grouped && onMoveWithinGroup ? (
        <>
          <TerminalTabMenuItem
            label="组内向左移动"
            onClick={() =>
              runMenuAction(() => onMoveWithinGroup(tab.id, "before"))
            }
          />
          <TerminalTabMenuItem
            label="组内向右移动"
            onClick={() =>
              runMenuAction(() => onMoveWithinGroup(tab.id, "after"))
            }
          />
        </>
      ) : null}
      {group && !group.grouped && isTerminalSessionTab(tab) ? (
        <TerminalTabMenuItem
          disabled={!onRequestEditIdentity}
          label="设置标识颜色"
          onClick={() => runMenuAction(() => onRequestEditIdentity?.(group))}
        />
      ) : null}
      <TerminalTabMenuItem
        danger
        label="关闭标签"
        onClick={() => runMenuAction(() => onCloseTabs([tab.id]))}
      />
      {group?.grouped ? (
        <TerminalTabMenuItem
          danger
          disabled={sameGroupOtherTabIds.length === 0}
          label="关闭同组其他标签"
          onClick={() => runMenuAction(() => onCloseTabs(sameGroupOtherTabIds))}
        />
      ) : null}
      <TerminalTabMenuItem
        danger
        disabled={rightTabIds.length === 0}
        label="关闭右侧标签"
        onClick={() => runMenuAction(() => onCloseTabs(rightTabIds))}
      />
      <TerminalTabMenuItem
        danger
        disabled={otherTabIds.length === 0}
        label="关闭其他标签"
        onClick={() => runMenuAction(() => onCloseTabs(otherTabIds))}
      />
    </>
  );
}

export function TerminalTabGroupContextMenuItems({
  collapsed,
  group,
  onCloseTabs,
  onRequestEdit,
  onMoveGroup,
  onUngroup,
  runMenuAction,
  tabs,
  toggleTabGroup,
}: {
  collapsed: boolean;
  group: TerminalTabGroup;
  onCloseTabs: (tabIds: string[]) => void;
  onRequestEdit?: (group: TerminalTabGroup) => void;
  onMoveGroup?: (groupId: string, direction: "before" | "after") => void;
  onUngroup?: (groupId: string) => void;
  runMenuAction: (action?: () => void) => void;
  tabs: TerminalTab[];
  toggleTabGroup: (groupId: string) => void;
}) {
  const groupTabIds = group.tabs.map((tab) => tab.id);
  const otherTabIds = tabs
    .filter((tab) => !groupTabIds.includes(tab.id))
    .map((tab) => tab.id);

  return (
    <>
      <TerminalTabMenuItem
        label={collapsed ? "展开分组" : "折叠分组"}
        onClick={() => runMenuAction(() => toggleTabGroup(group.id))}
      />
      <TerminalTabMenuItem
        disabled={!onRequestEdit}
        label="编辑分组"
        onClick={() => runMenuAction(() => onRequestEdit?.(group))}
      />
      <TerminalTabMenuItem
        danger
        disabled={group.tabs.length === 0}
        label="关闭分组"
        onClick={() => runMenuAction(() => onCloseTabs(groupTabIds))}
      />
      <TerminalTabMenuItem
        danger
        disabled={otherTabIds.length === 0}
        label="关闭组外其它标签"
        onClick={() => runMenuAction(() => onCloseTabs(otherTabIds))}
      />
      {onMoveGroup ? (
        <>
          <TerminalTabMenuItem
            label="整组向左移动"
            onClick={() => runMenuAction(() => onMoveGroup(group.id, "before"))}
          />
          <TerminalTabMenuItem
            label="整组向右移动"
            onClick={() => runMenuAction(() => onMoveGroup(group.id, "after"))}
          />
        </>
      ) : null}
      {onUngroup ? (
        <TerminalTabMenuItem
          label="取消分组但保留标签"
          onClick={() => runMenuAction(() => onUngroup(group.id))}
        />
      ) : null}
    </>
  );
}

export function clampContextMenuPosition(
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const maxX = Math.max(
    CONTEXT_MENU_MARGIN,
    window.innerWidth - width - CONTEXT_MENU_MARGIN,
  );
  const maxY = Math.max(
    CONTEXT_MENU_MARGIN,
    window.innerHeight - height - CONTEXT_MENU_MARGIN,
  );

  return {
    x: Math.round(Math.min(Math.max(x, CONTEXT_MENU_MARGIN), maxX)),
    y: Math.round(Math.min(Math.max(y, CONTEXT_MENU_MARGIN), maxY)),
  };
}
