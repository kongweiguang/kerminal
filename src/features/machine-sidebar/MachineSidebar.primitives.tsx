// @author kongweiguang

import { Box, Monitor, Pin, Server, Terminal } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../lib/cn";
import type { Machine, MachineGroup } from "../workspace/contracts/index";
import { CONTEXT_MENU_MARGIN, statusClasses } from "./MachineSidebar.shared";
import type { MachineSidebarMenuAction, MachineSidebarMenuDomain } from "./machineSidebarMenuModel";
import { sidebarDisplayStatus } from "./MachineSidebarMachineRow";

const contextMenuItemBaseClassName = "kerminal-context-menu-item";
const contextMenuItemDangerClassName = "kerminal-context-menu-item--danger";
const dragPreviewSurfaceClassName =
  "kerminal-layer-drag-preview pointer-events-none fixed w-64 select-none rounded-[var(--radius-card)] border border-sky-300/60 bg-[var(--surface-elevated)] p-3 text-sm text-[var(--text-primary)] shadow-[var(--shadow-floating)] ring-2 ring-sky-400/18 dark:border-sky-300/35";
const dragPreviewHintClassName =
  "mt-2 rounded-xl bg-[var(--surface-selected)] px-3 py-1.5 text-xs font-medium text-sky-700 dark:text-sky-200";
const sidebarStatusDotClassName =
  "absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-[var(--surface-nav-glass)]";

export function ContextMenuItem({ danger = false, disabled, icon, label, menuAction, menuDomain, onClick }: {
  danger?: boolean; disabled?: boolean; icon: ReactNode; label: string;
  menuAction?: MachineSidebarMenuAction; menuDomain?: MachineSidebarMenuDomain; onClick: () => void;
}) {
  return (
    <button
      className={cn(contextMenuItemBaseClassName, danger && contextMenuItemDangerClassName)}
      data-menu-action={menuAction}
      data-menu-domain={menuDomain}
      disabled={disabled}
      onClick={onClick}
      role="menuitem"
      type="button"
    >
      <span className="kerminal-context-menu-icon">{icon}</span>
      <span className="kerminal-context-menu-label">{label}</span>
    </button>
  );
}

export function MachineDragPreviewCard({ externalTargetHint, machine, targetGroupTitle, x, y }: {
  externalTargetHint?: string; machine: Machine; targetGroupTitle: string | undefined; x: number; y: number;
}) {
  const Icon = previewMachineIcon(machine);
  const displayStatus = sidebarDisplayStatus(machine, false);
  return (
    <div aria-label="正在拖动主机" className={dragPreviewSurfaceClassName} role="status" style={dragPreviewPosition(x, y)}>
      <div className="flex items-center gap-3">
        <span className={cn(
          "relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
          machine.kind === "local"
            ? "bg-emerald-500/12 text-emerald-600 dark:bg-emerald-400/14 dark:text-emerald-300"
            : "bg-sky-500/12 text-sky-600 dark:bg-sky-400/14 dark:text-sky-300",
        )}>
          <Icon className="h-4 w-4" />
          <span className={cn(sidebarStatusDotClassName, statusClasses[displayStatus])} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{machine.name}</span>
          <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">{machine.description}</span>
        </span>
      </div>
      <div className={dragPreviewHintClassName}>
        {targetGroupTitle ? `松开移动到 ${targetGroupTitle}` : externalTargetHint ? externalTargetHint : "拖到分组后松开"}
      </div>
    </div>
  );
}

function dragPreviewPosition(x: number, y: number) {
  const width = 264;
  const height = 96;
  if (typeof window === "undefined") return { left: x + 16, top: y + 12, transform: "rotate(1deg)" };
  const maxLeft = Math.max(8, window.innerWidth - width - 8);
  const maxTop = Math.max(8, window.innerHeight - height - 8);
  return {
    left: Math.min(Math.max(x + 16, 8), maxLeft),
    top: Math.min(Math.max(y + 12, 8), maxTop),
    transform: "rotate(1deg)",
  };
}

export function PinnedGroupBadge() {
  return <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-medium text-sky-700 dark:bg-sky-400/12 dark:text-sky-200" title="已置顶"><Pin className="h-3 w-3" />置顶</span>;
}

export function isPinnedMachineGroup(group: MachineGroup | undefined) {
  return Boolean(group?.pinned ?? ((group?.sortOrder ?? 0) < 0));
}

function previewMachineIcon(machine: Machine) {
  if (machine.kind === "local" || machine.kind === "rdp") return Monitor;
  if (machine.kind === "telnet" || machine.kind === "serial") return Terminal;
  if (machine.kind === "dockerContainer") return Box;
  return Server;
}

export function clampContextMenuPosition(x: number, y: number, width: number, height: number) {
  const maxX = Math.max(CONTEXT_MENU_MARGIN, window.innerWidth - width - CONTEXT_MENU_MARGIN);
  const maxY = Math.max(CONTEXT_MENU_MARGIN, window.innerHeight - height - CONTEXT_MENU_MARGIN);
  return {
    x: Math.round(Math.min(Math.max(x, CONTEXT_MENU_MARGIN), maxX)),
    y: Math.round(Math.min(Math.max(y, CONTEXT_MENU_MARGIN), maxY)),
  };
}
