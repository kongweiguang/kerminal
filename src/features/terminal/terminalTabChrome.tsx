// @author kongweiguang

import {
  ChevronDown,
  ChevronRight,
  Layers2,
  Pencil,
  X,
} from "lucide-react";
import {
  useEffect,
  useState,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { Button } from "../../components/ui/button";
import { ModalShell } from "../../components/ui/modal-shell";
import { cn } from "../../lib/cn";
import {
  isTerminalSessionTab,
  isWorkspaceFileTab,
  type MachineGroup,
  type MachineStatus,
  type TerminalPane,
  type TerminalTab,
  type TerminalTabGroupColor,
  type TerminalTabGroupPreference,
  type TerminalTabGroupPreferences,
  type WorkspaceFileTab,
} from "../workspace/contracts/index";
import { collectPaneIds } from "../workspace/contracts/index";
import {
  resolveTerminalTabIdentityAccent,
  resolveTerminalTabIdentityPaletteToken,
  type TerminalTabIdentityAccent,
} from "./terminalTabIdentityModel";
import { TerminalTabAttention } from "./TerminalTabAttention";
import type { TerminalTabPresentation } from "./terminalTabPresentationModel";

export interface TerminalTabGroup {
  color: TerminalTabGroupColor;
  colorLabel: string;
  grouped: boolean;
  id: string;
  identityAccent: TerminalTabIdentityAccent;
  preference?: TerminalTabGroupPreference;
  tabs: TerminalTab[];
  title: string;
}

export interface TerminalTabGroupBuildOptions {
  machineGroups?: MachineGroup[];
  panes?: TerminalPane[];
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
}) {
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
        type="button"
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
}: {
  active?: boolean;
  collapsed: boolean;
  group: TerminalTabGroup;
  onContextMenu: (event: ReactMouseEvent) => void;
  onToggle: () => void;
  presentation?: TerminalTabPresentation;
}) {
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
      onClick={onToggle}
      onContextMenu={onContextMenu}
      title={`${group.title} (${group.tabs.length})`}
      type="button"
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
  onRequestRename,
  onRevealWorkspaceFileInSftp,
  onSelectTab,
  runMenuAction,
  tab,
  tabs,
}: {
  activeTabId: string;
  group: TerminalTabGroup | undefined;
  onCloseTabs: (tabIds: string[]) => void;
  onCopyWorkspaceFilePath?: (tab: WorkspaceFileTab) => void;
  onReloadWorkspaceFile?: (tabId: string) => void;
  onRequestEditIdentity?: (group: TerminalTabGroup) => void;
  onRequestRename: (tab: TerminalTab) => void;
  onRevealWorkspaceFileInSftp?: (tabId: string) => void;
  onSelectTab: (tabId: string) => void;
  runMenuAction: (action?: () => void) => void;
  tab: TerminalTab;
  tabs: TerminalTab[];
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
  runMenuAction,
  tabs,
  toggleTabGroup,
}: {
  collapsed: boolean;
  group: TerminalTabGroup;
  onCloseTabs: (tabIds: string[]) => void;
  onRequestEdit?: (group: TerminalTabGroup) => void;
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
        label="关闭其他分组"
        onClick={() => runMenuAction(() => onCloseTabs(otherTabIds))}
      />
    </>
  );
}

export function CloseTabsConfirmationDialog({
  onClose,
  onConfirm,
  tabCount,
}: {
  onClose: () => void;
  onConfirm: () => void;
  tabCount: number;
}) {
  return (
    <ModalShell
      footer={
        <>
          <Button onClick={onClose} type="button" variant="ghost">
            取消
          </Button>
          <Button onClick={onConfirm} type="button" variant="danger">
            关闭标签
          </Button>
        </>
      }
      description={`将关闭 ${tabCount} 个终端标签。`}
      onClose={onClose}
      open={tabCount > 0}
      size="compact"
      title="确认关闭标签"
    >
      <div className="rounded-xl border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-100">
        当前标签内的会话会结束。
      </div>
    </ModalShell>
  );
}

export function CloseWorkspaceFileTabsConfirmationDialog({
  dirtyTabCount,
  onClose,
  onConfirm,
  tabCount,
}: {
  dirtyTabCount: number;
  onClose: () => void;
  onConfirm: () => void;
  tabCount: number;
}) {
  return (
    <ModalShell
      footer={
        <>
          <Button onClick={onClose} type="button" variant="ghost">
            取消
          </Button>
          <Button onClick={onConfirm} type="button" variant="danger">
            放弃修改并关闭
          </Button>
        </>
      }
      description={`将关闭 ${tabCount} 个标签，其中 ${dirtyTabCount} 个文件有未保存修改。`}
      onClose={onClose}
      open={tabCount > 0}
      size="compact"
      title="关闭未保存文件"
    >
      <div className="rounded-xl border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-100">
        未保存的文件修改会丢失。
      </div>
    </ModalShell>
  );
}

export function TerminalTabRenameDialog({
  onClose,
  onRenameTab,
  tab,
}: {
  onClose: () => void;
  onRenameTab: (tabId: string, title: string) => void;
  tab: TerminalTab | null;
}) {
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tab) {
      return;
    }

    setTitle(tab.title);
    setError(null);
  }, [tab]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!tab) {
      return;
    }

    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError("请输入标签名称。");
      return;
    }

    if (trimmedTitle !== tab.title) {
      onRenameTab(tab.id, trimmedTitle);
    }
    onClose();
  };

  return (
    <ModalShell
      onClose={onClose}
      open={Boolean(tab)}
      size="compact"
      title="重命名标签"
    >
      <form className="space-y-4" onSubmit={submit}>
        <div className="rounded-[var(--radius-card)] border border-[var(--border-subtle)] p-4">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Pencil className="h-4 w-4 text-sky-500 dark:text-sky-300" />
            标签信息
          </div>
          <label className="mt-4 block">
            <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
              标签名称
            </span>
            <input
              autoFocus
              className="kerminal-field-surface mt-1 h-9 w-full rounded-xl border px-3 text-sm"
              onChange={(event) => {
                setTitle(event.currentTarget.value);
                setError(null);
              }}
              placeholder="例如：生产日志"
              value={title}
            />
          </label>
          {error ? (
            <p
              className="mt-3 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-300"
              role="alert"
            >
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex justify-end gap-2">
          <Button onClick={onClose} type="button" variant="ghost">
            取消
          </Button>
          <Button disabled={!title.trim()} type="submit" variant="primary">
            保存标签
          </Button>
        </div>
      </form>
    </ModalShell>
  );
}

function TerminalTabMenuItem({
  danger = false,
  disabled,
  label,
  onClick,
}: {
  danger?: boolean;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={cn(
        terminalTabMenuItemClassName,
        danger
          ? "kerminal-context-menu-item--danger"
          : terminalTabMenuIdleClassName,
      )}
      disabled={disabled}
      onClick={onClick}
      role="menuitem"
      type="button"
    >
      <span className="kerminal-context-menu-label">{label}</span>
    </button>
  );
}

export function buildTerminalTabGroups(
  tabs: TerminalTab[],
  preferences: TerminalTabGroupPreferences = {},
  options: TerminalTabGroupBuildOptions = {},
): TerminalTabGroup[] {
  const orderedGroupIds: string[] = [];
  const tabsByGroupId = new Map<string, TerminalTab[]>();
  const panesById = new Map(
    (options.panes ?? []).map((pane) => [pane.id, pane]),
  );

  for (const tab of tabs) {
    const groupId = resolveTerminalTabGroupId(tab, panesById);
    if (!tabsByGroupId.has(groupId)) {
      orderedGroupIds.push(groupId);
      tabsByGroupId.set(groupId, []);
    }
    tabsByGroupId.get(groupId)?.push(tab);
  }

  return orderedGroupIds.map((groupId) => {
    const groupTabs = tabsByGroupId.get(groupId) ?? [];
    const preference = preferences[groupId];
    const title =
      preference?.title?.trim() ||
      defaultTerminalTabGroupTitle(groupId, groupTabs, options.machineGroups);
    const identityAccent = resolveTerminalTabIdentityAccent({
      groupId,
      preference,
      tabCount: groupTabs.length,
    });
    const paletteToken = resolveTerminalTabIdentityPaletteToken(
      identityAccent.color,
    );
    return {
      color: identityAccent.color,
      colorLabel: paletteToken.label,
      grouped: groupTabs.length > 1,
      id: groupId,
      identityAccent,
      ...(preference ? { preference } : {}),
      tabs: groupTabs,
      title,
    };
  });
}

function resolveTerminalTabGroupId(
  tab: TerminalTab,
  panesById: Map<string, TerminalPane>,
) {
  if (isWorkspaceFileTab(tab) && tab.target.kind !== "local") {
    return tab.target.hostId;
  }

  if (isTerminalSessionTab(tab)) {
    const firstRemoteHostId = collectPaneIds(tab.layout)
      .map((paneId) => panesById.get(paneId)?.remoteHostId)
      .find((remoteHostId): remoteHostId is string => Boolean(remoteHostId));
    if (firstRemoteHostId) {
      return firstRemoteHostId;
    }
  }

  return tab.machineId;
}

function defaultTerminalTabGroupTitle(
  groupId: string,
  groupTabs: TerminalTab[],
  machineGroups: MachineGroup[] | undefined,
) {
  const firstTab = groupTabs[0];
  if (!firstTab) {
    return groupId;
  }
  if (firstTab.machineId === groupId) {
    return firstTab.title;
  }
  return findMachineGroupTitle(machineGroups, groupId) ?? firstTab.title;
}

function findMachineGroupTitle(
  machineGroups: MachineGroup[] | undefined,
  machineId: string,
) {
  for (const group of machineGroups ?? []) {
    const machine = group.machines.find(
      (candidate) => candidate.id === machineId,
    );
    if (machine) {
      return machine.name;
    }
  }
  return undefined;
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
