import {
  Box,
  Cloud,
  FolderKey,
  LoaderCircle,
  Monitor,
  Server,
  Terminal,
  type LucideIcon,
} from "lucide-react";
import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { cn } from "../../lib/cn";
import type { Machine, MachineGroup, MachineStatus } from "../workspace/contracts/index";
import { statusClasses } from "./MachineSidebar.shared";

const sidebarMachineButtonBaseClassName =
  "kerminal-sidebar-machine-row kerminal-focus-ring kerminal-pressable flex w-full items-center rounded-xl text-left text-sm transition";
const sidebarMachineDraggingClassName =
  "scale-[0.98] bg-sky-500/6 opacity-35 ring-2 ring-dashed ring-sky-400/70 dark:bg-sky-400/8";
const sidebarMachineSelectedClassName =
  "bg-[var(--surface-selected)] text-zinc-950 shadow-sm shadow-sky-950/5 ring-1 ring-sky-500/15 dark:text-zinc-50 dark:ring-sky-300/15";
const sidebarMachineIdleClassName =
  "text-zinc-600 hover:bg-[var(--surface-hover)] hover:text-zinc-950 dark:text-zinc-300 dark:hover:text-zinc-50";
const sidebarMachineOpeningClassName =
  "cursor-wait bg-sky-500/8 text-zinc-950 ring-1 ring-sky-500/20 dark:bg-sky-400/10 dark:text-zinc-50 dark:ring-sky-300/20";
const sidebarStatusDotClassName =
  "absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-[var(--surface-nav-glass)]";

type MachineSidebarMachineRowProps = {
  canMove?: boolean;
  dragging?: boolean;
  group: MachineGroup;
  hasOpenTerminalSession: boolean;
  machine: Machine;
  onClick: () => void;
  onContextMenu: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  onDoubleClick?: () => void;
  onPointerDown?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  rdpOpening?: boolean;
  selected: boolean;
  showLatency?: boolean;
};

/**
 * 统一渲染展开侧栏与折叠弹出列表中的主机行，保证状态、可访问性和加载反馈一致。
 */
export function MachineSidebarMachineRow({
  canMove = false,
  dragging = false,
  group,
  hasOpenTerminalSession,
  machine,
  onClick,
  onContextMenu,
  onDoubleClick,
  onPointerDown,
  rdpOpening = false,
  selected,
  showLatency = false,
}: MachineSidebarMachineRowProps) {
  const Icon = machineIcon(machine, group);
  const displayStatus = sidebarDisplayStatus(machine, hasOpenTerminalSession);
  const opening = machine.kind === "rdp" && rdpOpening;

  return (
    <button
      aria-busy={opening || undefined}
      aria-grabbed={dragging || undefined}
      aria-pressed={selected}
      className={cn(
        sidebarMachineButtonBaseClassName,
        canMove && !opening && "cursor-grab active:cursor-grabbing",
        dragging && sidebarMachineDraggingClassName,
        selected
          ? sidebarMachineSelectedClassName
          : sidebarMachineIdleClassName,
        opening && sidebarMachineOpeningClassName,
      )}
      data-rdp-opening={opening || undefined}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onDoubleClick={opening ? undefined : onDoubleClick}
      onPointerDown={opening ? undefined : onPointerDown}
      title={
        opening
          ? `${machine.name} · 正在打开远程桌面`
          : machineTitle(machine)
      }
      type="button"
    >
      <span
        className={cn(
          "kerminal-sidebar-machine-icon relative flex shrink-0 items-center justify-center rounded-lg",
          machine.kind === "local"
            ? "bg-emerald-500/10 text-emerald-600 dark:bg-emerald-400/12 dark:text-emerald-300"
            : "bg-sky-500/10 text-sky-600 dark:bg-sky-400/12 dark:text-sky-300",
        )}
      >
        {opening ? (
          <LoaderCircle
            aria-hidden="true"
            className="h-4 w-4 animate-spin motion-reduce:animate-none"
          />
        ) : (
          <>
            <Icon className="h-4 w-4" />
            <span
              className={cn(
                sidebarStatusDotClassName,
                statusClasses[displayStatus],
              )}
              title={statusTitle(displayStatus)}
            />
          </>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{machine.name}</span>
        <span
          aria-live="polite"
          className={cn(
            "block truncate text-xs",
            opening
              ? "font-medium text-sky-700 dark:text-sky-200"
              : "text-zinc-500 dark:text-zinc-400",
          )}
        >
          {opening ? "正在打开远程桌面..." : machine.description}
        </span>
      </span>
      {showLatency && machine.latencyMs ? (
        <span className="shrink-0 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-600 dark:text-emerald-300">
          {machine.latencyMs}ms
        </span>
      ) : null}
    </button>
  );
}

export function sidebarDisplayStatus(
  machine: Machine,
  hasOpenTerminalSession: boolean,
): MachineStatus {
  if (hasOpenTerminalSession) {
    return "online";
  }
  return machine.kind === "local" ? "offline" : machine.status;
}

function machineIcon(
  machine: Machine,
  group: MachineGroup,
): LucideIcon {
  if (machine.kind === "local" || machine.kind === "rdp") {
    return Monitor;
  }
  if (machine.kind === "telnet" || machine.kind === "serial") {
    return Terminal;
  }
  if (machine.kind === "sftp") {
    return FolderKey;
  }
  if (machine.kind === "dockerContainer") {
    return Box;
  }
  if (group.id === "cloud" || group.id === "group-cloud" || machine.production) {
    return Cloud;
  }
  return Server;
}

function machineTitle(machine: Machine) {
  return [machine.name, machine.description, ...machine.tags]
    .filter(Boolean)
    .join(" · ");
}

function statusTitle(status: Machine["status"]) {
  if (status === "online") {
    return "已打开会话";
  }
  if (status === "warning") {
    return "需要注意";
  }
  return "未打开会话";
}
