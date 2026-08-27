// @author kongweiguang

import {
  ChevronDown,
  ChevronRight,
  Layers2,
  X,
} from "lucide-react";
import type {
  DraggableAttributes,
  DraggableSyntheticListeners,
} from "@dnd-kit/core";
import {
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type Ref,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
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
import {
  type TerminalTabIdentityAccent,
} from "./terminalTabIdentityModel";
import { TerminalTabAttention } from "./TerminalTabAttention";
import type { TerminalTabPresentation } from "./terminalTabPresentationModel";
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
const terminalTabMenuItemClassName = "kerminal-context-menu-item";
const terminalTabMenuIdleClassName = "";

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
          groups={availableGroups.filter((candidate) => candidate.id !== group?.id)}
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
            onClick={() => runMenuAction(() => onMoveWithinGroup(tab.id, "before"))}
          />
          <TerminalTabMenuItem
            label="组内向右移动"
            onClick={() => runMenuAction(() => onMoveWithinGroup(tab.id, "after"))}
          />
        </>
      ) : null}
      {group && !group.grouped && isTerminalSessionTab(tab) ? (
        <TerminalTabMenuItem
          disabled={!onRequestEditIdentity}
          label="设置标识颜色"
          onClick={() =>
            runMenuAction(() => onRequestEditIdentity?.(group))
          }
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

/**
 * “移动到标签组”使用独立 portal，避免根菜单的 overflow:hidden 截断长组列表；
 * 子菜单以 fixed 坐标翻转到视口内，并把方向键焦点限制在自身菜单层。
 */
function TerminalTabMoveToGroupMenu({
  groups,
  onMoveToGroup,
}: {
  groups: readonly TerminalTabGroup[];
  onMoveToGroup: (groupId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const submenuRef = useRef<HTMLDivElement>(null);

  /** 根据触发按钮和实际子菜单尺寸选择左右、上下方向，防止窄窗口溢出。 */
  const updatePosition = () => {
    const trigger = triggerRef.current;
    const submenu = submenuRef.current;
    if (!trigger) return;
    const triggerRect = trigger.getBoundingClientRect();
    const submenuRect = submenu?.getBoundingClientRect();
    const width = submenuRect?.width || 232;
    const height = submenuRect?.height || Math.min(window.innerHeight * 0.7, 360);
    const margin = 8;
    const placeRight = triggerRect.right + margin + width <= window.innerWidth - margin;
    const left = placeRight
      ? triggerRect.right + margin
      : Math.max(margin, triggerRect.left - margin - width);
    const top = Math.min(
      Math.max(margin, triggerRect.top),
      Math.max(margin, window.innerHeight - height - margin),
    );
    setPosition({ left: Math.round(left), top: Math.round(top) });
  };

  /** 打开后先定位再把焦点交给第一个可用组，保持菜单键盘操作连续。 */
  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
    const frame = window.requestAnimationFrame(() => {
      submenuRef.current
        ?.querySelector<HTMLButtonElement>('[role="menuitem"]:not([disabled])')
        ?.focus();
    });
    const handleViewportChange = () => updatePosition();
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [open]);

  /** 子菜单层只在自身可用项之间循环焦点，Escape/左键返回触发项。 */
  const handleSubmenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const menuItems = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"]:not([disabled])',
      ),
    );
    const currentIndex = menuItems.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      if (menuItems.length === 0) return;
      const delta = event.key === "ArrowDown" ? 1 : -1;
      menuItems[(currentIndex + delta + menuItems.length) % menuItems.length]?.focus();
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      event.stopPropagation();
      (event.key === "Home" ? menuItems[0] : menuItems[menuItems.length - 1])?.focus();
      return;
    }
    if (event.key === "Escape" || event.key === "ArrowLeft") {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  return (
    <>
      <div className="relative" role="none">
        <TerminalTabMenuItem
          ariaExpanded={open}
          ariaHasPopup="menu"
          buttonRef={triggerRef}
          label="移动到标签组"
          onClick={() => setOpen(true)}
          onMouseEnter={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === "ArrowRight" || event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              setOpen(true);
            }
            if (event.key === "Escape" || event.key === "ArrowLeft") {
              setOpen(false);
            }
          }}
          rightIcon={<ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-65" />}
        />
      </div>
      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              aria-label="移动到标签组"
              className="kerminal-context-menu kerminal-floating-enter kerminal-layer-popover fixed z-[1000] w-56 max-h-[min(70vh,360px)] overflow-y-auto"
              onClick={(event) => event.stopPropagation()}
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onKeyDown={handleSubmenuKeyDown}
              ref={submenuRef}
              role="menu"
              style={{ left: position.left, top: position.top }}
            >
              <div className="px-2 py-1 text-xs font-medium text-zinc-500 dark:text-zinc-400">
                选择标签组
              </div>
              {groups.map((group) => (
                <TerminalTabMenuItem
                  key={group.id}
                  label={`移入「${group.title}」`}
                  onClick={() => onMoveToGroup(group.id)}
                />
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

/** 菜单项统一处理方向键焦点移动，同时保留浏览器原生 Enter/Space click 语义。 */
function TerminalTabMenuItem({
  danger = false,
  disabled,
  label,
  onClick,
  onKeyDown,
  onMouseEnter,
  ariaExpanded,
  ariaHasPopup,
  buttonRef,
  rightIcon,
}: {
  danger?: boolean;
  disabled?: boolean;
  label: string;
  onClick: () => void;
  onKeyDown?: (event: ReactKeyboardEvent<HTMLButtonElement>) => void;
  onMouseEnter?: () => void;
  ariaExpanded?: boolean;
  ariaHasPopup?: boolean | "menu";
  buttonRef?: Ref<HTMLButtonElement>;
  rightIcon?: ReactNode;
}) {
  /** 在当前 menu 层内移动焦点，避免依赖浏览器对 role=menu 的默认实现。 */
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    if (
      event.key !== "ArrowDown" &&
      event.key !== "ArrowUp" &&
      event.key !== "Home" &&
      event.key !== "End"
    ) {
      return;
    }
    const menu = event.currentTarget.closest<HTMLElement>('[role="menu"]');
    if (!menu) return;
    const items = Array.from(
      menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])'),
    ).filter((item) => item.closest('[role="menu"]') === menu);
    const index = items.indexOf(event.currentTarget);
    if (index < 0 || items.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? items.length - 1
          : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) %
            items.length;
    items[nextIndex]?.focus();
  };

  return (
    <button
      aria-expanded={ariaExpanded}
      aria-haspopup={ariaHasPopup}
      className={cn(
        terminalTabMenuItemClassName,
        danger
          ? "kerminal-context-menu-item--danger"
          : terminalTabMenuIdleClassName,
      )}
      disabled={disabled}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      onMouseEnter={onMouseEnter}
      ref={buttonRef}
      role="menuitem"
      type="button"
    >
      <span className="kerminal-context-menu-label">{label}</span>
      {ariaHasPopup ? (
        <span className="sr-only">子菜单</span>
      ) : null}
      {rightIcon}
    </button>
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
