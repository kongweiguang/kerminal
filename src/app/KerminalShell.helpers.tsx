// @author kongweiguang

import {
  useEffect,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { Button } from "../components/ui/button";
import { UserFacingNotice } from "../components/ui/user-facing-notice";
import {
  ModalShell,
  WindowDragStrip,
} from "../components/ui/modal-shell";
import { cn } from "../lib/cn";
import { TOOL_RAIL_WIDTH } from "./KerminalShell.static";
import type { LocalTerminalCreateOptions } from "../features/machine-sidebar/RemoteHostCreateDialog";
import type { AppSettings } from "../features/settings/settingsModel";
import type { ToolRailPanelPlacement } from "../features/tool-panel/toolRailModel";
import type { Machine, MachineGroup } from "../features/workspace/types";
import type { TerminalProfile } from "../lib/profileApi";
import type { UserFacingMessage } from "../lib/userFacingMessage";
import { desktopRuntime } from "../lib/desktopRuntimeApi";
import {
  createDefaultSshOptions,
  UNGROUPED_REMOTE_HOST_GROUP_ID,
  type RemoteHost,
  type RemoteHostCreateRequest,
  type RemoteHostUpdateRequest,
} from "../lib/remoteHostApi";

export type PendingDelete =
  | {
      id: string;
      machineCount: number;
      title: string;
      type: "group";
    }
  | {
      id: string;
      title: string;
      type: "machine";
    };

export function ShellResizeSeparator({
  className,
  hidden,
  label,
  onKeyDown,
  onPointerDown,
  orientation = "vertical",
  style,
}: {
  className: string;
  hidden: boolean;
  label: string;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  orientation?: "horizontal" | "vertical";
  style?: CSSProperties;
}) {
  return (
    <div
      aria-hidden={hidden || undefined}
      aria-label={hidden ? undefined : label}
      aria-orientation={hidden ? undefined : orientation}
      className={cn(
        "group relative flex h-full w-full items-center justify-center outline-none transition focus-visible:ring-4 focus-visible:ring-sky-500/20",
        orientation === "horizontal" ? "cursor-row-resize" : "cursor-col-resize",
        className,
        hidden && "pointer-events-none opacity-0",
      )}
      data-orientation={orientation}
      onKeyDown={hidden ? undefined : onKeyDown}
      onPointerDown={hidden ? undefined : onPointerDown}
      role={hidden ? undefined : "separator"}
      style={style}
      tabIndex={hidden ? -1 : 0}
    >
      <span
        className={cn(
          "block rounded-full bg-transparent transition group-hover:bg-sky-400/70 group-focus-visible:bg-sky-400",
          orientation === "horizontal" ? "h-px w-12" : "h-12 w-px",
        )}
      />
    </div>
  );
}

export function DialogLazyFallback() {
  return (
    <div
      aria-label="正在加载弹窗"
      className="kerminal-layer-dialog fixed inset-0 flex items-center justify-center bg-zinc-950/30 p-4 text-[var(--text-primary)] backdrop-blur-md dark:bg-black/48"
      role="status"
    >
      <WindowDragStrip />
      <div className="kerminal-floating-enter rounded-[1.5rem] border border-[var(--border-subtle)] bg-[var(--surface-overlay)] px-5 py-4 text-sm shadow-lg shadow-black/12 backdrop-blur-xl dark:shadow-black/35">
        正在加载...
      </div>
    </div>
  );
}

export function clampPanelWidth(
  value: number,
  bounds: {
    max: number;
    min: number;
  },
) {
  const max = Math.max(bounds.min, bounds.max);
  return Math.min(Math.max(value, bounds.min), max);
}

export function initialPanelWidth(
  viewportRatio: number,
  bounds: {
    max: number;
    min: number;
  },
) {
  if (typeof window === "undefined") {
    return bounds.min;
  }
  return clampPanelWidth(Math.round(window.innerWidth * viewportRatio), bounds);
}

/** 只注册一个窗口监听，同时为横向和底部面板约束提供最新可视尺寸。 */
export function useViewportSize() {
  const [viewportSize, setViewportSize] = useState(() => ({
    height: typeof window === "undefined" ? 900 : window.innerHeight,
    width: typeof window === "undefined" ? 1440 : window.innerWidth,
  }));

  useEffect(() => {
    const updateViewportSize = () =>
      setViewportSize({ height: window.innerHeight, width: window.innerWidth });
    updateViewportSize();
    window.addEventListener("resize", updateViewportSize);
    return () => window.removeEventListener("resize", updateViewportSize);
  }, []);

  return viewportSize;
}

/**
 * 七列模板把左停靠工具栏放在主机侧栏和终端之间，同时保留右侧 rail；集中生成
 * 字符串可保证 React 布局和原生指针拖动预览使用完全相同的列语义。
 */
export function buildShellGridTemplateColumns({
  leftPanelWidth,
  leftToolPanelWidth,
  rightPanelWidth,
}: {
  leftPanelWidth: number;
  leftToolPanelWidth: number;
  rightPanelWidth: number;
}) {
  return `${leftPanelWidth}px 0px ${leftToolPanelWidth}px 0px minmax(0, 1fr) 0px ${rightPanelWidth}px`;
}

/** 底部停靠使用独立行；零宽分隔轨仍由扩大的命中区域提供拖动能力。 */
export function buildShellGridTemplateRows(bottomToolPanelHeight: number) {
  return `36px minmax(0, 1fr) 0px ${bottomToolPanelHeight}px`;
}

/**
 * 解析 Shell 七列四行网格；左、右和底部槽位各自让出真实布局空间，紧凑抽屉与
 * 自由浮窗只保留 rail，因此不同方向可并开且任一槽位都不会篡改其它槽位尺寸。
 */
export function resolveShellLayout({
  openToolPlacements,
  bottomToolPanelHeight,
  leftPanelCollapsed,
  leftPanelWidth,
  leftToolPanelWidth,
  toolPanelWidth,
  viewportWidth,
}: {
  openToolPlacements: readonly ToolRailPanelPlacement[];
  bottomToolPanelHeight: number;
  leftPanelCollapsed: boolean;
  leftPanelWidth: number;
  leftToolPanelWidth: number;
  toolPanelWidth: number;
  viewportWidth: number;
}) {
  const compactShell = viewportWidth < 900;
  const effectiveLeftPanelCollapsed = leftPanelCollapsed || compactShell;
  const effectiveLeftToolPanelOpen =
    !compactShell && openToolPlacements.includes("left");
  const effectiveRightPanelOpen =
    !compactShell && openToolPlacements.includes("attached");
  const effectiveBottomToolPanelOpen =
    !compactShell && openToolPlacements.includes("bottom");
  const effectiveToolPanelOpen =
    effectiveLeftToolPanelOpen ||
    effectiveRightPanelOpen ||
    effectiveBottomToolPanelOpen;
  const leftPanelColumnWidth = effectiveLeftPanelCollapsed ? 0 : leftPanelWidth;
  const leftToolPanelColumnWidth = effectiveLeftToolPanelOpen
    ? leftToolPanelWidth
    : 0;
  const rightPanelColumnWidth = effectiveRightPanelOpen
    ? toolPanelWidth
    : TOOL_RAIL_WIDTH;
  const bottomToolPanelRowHeight = effectiveBottomToolPanelOpen
    ? bottomToolPanelHeight
    : 0;

  return {
    compactShell,
    effectiveLeftPanelCollapsed,
    effectiveLeftToolPanelOpen,
    effectiveRightPanelOpen,
    effectiveBottomToolPanelOpen,
    effectiveToolPanelOpen,
    gridTemplateColumns: buildShellGridTemplateColumns({
      leftPanelWidth: leftPanelColumnWidth,
      leftToolPanelWidth: leftToolPanelColumnWidth,
      rightPanelWidth: rightPanelColumnWidth,
    }),
    gridTemplateRows: buildShellGridTemplateRows(bottomToolPanelRowHeight),
    bottomToolPanelRowHeight,
    leftPanelColumnWidth,
    leftToolPanelColumnWidth,
    leftWorkspaceInset: leftToolPanelColumnWidth,
    rightPanelColumnWidth,
    rightWorkspaceInset: rightPanelColumnWidth,
  };
}

export function isRealRemoteGroup(group: MachineGroup) {
  return group.id !== "local" && group.id !== UNGROUPED_REMOTE_HOST_GROUP_ID;
}

export function mergeProfiles(
  profiles: TerminalProfile[],
  profile: TerminalProfile,
): TerminalProfile[] {
  return [
    ...profiles.filter((candidate) => candidate.id !== profile.id),
    profile,
  ].sort(
    (left, right) =>
      left.sortOrder - right.sortOrder || left.name.localeCompare(right.name),
  );
}

export function hasLocalProfileOverrides(options: LocalTerminalCreateOptions) {
  return Boolean(
    options.title?.trim() ||
      options.shell?.trim() ||
      options.cwd?.trim() ||
      (options.args && options.args.length > 0) ||
      (options.env && Object.keys(options.env).length > 0),
  );
}

export function duplicateMachineName(name: string) {
  return `${name} 副本`;
}

export function nextPinnedGroupSortOrder(groups: MachineGroup[]) {
  return Math.min(0, ...groups.map((group) => group.sortOrder ?? 0)) - 10;
}

export function nextUnpinnedGroupSortOrder(groups: MachineGroup[], groupId: string) {
  return (
    Math.max(
      0,
      ...groups
        .filter((group) => group.id !== groupId && !isPinnedGroup(group))
        .map((group) => group.sortOrder ?? 0),
    ) + 10
  );
}

function isPinnedGroup(group: MachineGroup) {
  return Boolean(group.pinned ?? ((group.sortOrder ?? 0) < 0));
}

export function remoteHostCreateRequestFromMachine(
  machine: Machine,
  overrides: {
    groupId?: string;
    name?: string;
  } = {},
): RemoteHostCreateRequest | undefined {
  const host = remoteHostFromMachine(machine);
  if (!host) {
    return undefined;
  }

  return {
    authType: host.authType,
    credentialRef: host.authType === "key" ? host.credentialRef : undefined,
    credentialSecret: host.authType === "password" ? host.credentialSecret : undefined,
    groupId: overrides.groupId ?? host.groupId,
    host: host.host,
    name: overrides.name ?? host.name,
    port: host.port,
    protocol: host.protocol,
    sshOptions: host.sshOptions,
    tags: [...host.tags],
    username: host.username,
  };
}

export function remoteHostUpdateRequestFromMachine(
  machine: Machine,
  groupId: string,
): RemoteHostUpdateRequest | undefined {
  const request = remoteHostCreateRequestFromMachine(machine, { groupId });
  if (!request) {
    return undefined;
  }

  return {
    ...request,
    id: machine.id,
    sortOrder: machine.sortOrder ?? 0,
  };
}

export function remoteHostFromMachine(machine: Machine | undefined): RemoteHost | undefined {
  if (
    !machine ||
    (machine.kind !== "ssh" &&
      machine.kind !== "sftp" &&
      machine.kind !== "rdp" &&
      machine.kind !== "telnet" &&
      machine.kind !== "serial")
  ) {
    return undefined;
  }

  return {
    authType: machine.authType ?? "agent",
    createdAt: machine.createdAt ?? "",
    credentialRef: machine.authType === "key" ? machine.credentialRef : undefined,
    credentialSecret:
      machine.authType === "password" ? machine.credentialSecret : undefined,
    groupId: machine.remoteGroupId,
    host: machine.host ?? machine.description,
    id: machine.id,
    name: machine.name,
    port:
      machine.port ??
      (machine.kind === "rdp" ? 3389 : machine.kind === "telnet" ? 23 : 1),
    protocol:
      machine.kind === "sftp"
        ? "sftp"
        : machine.kind === "rdp"
          ? "rdp"
          : machine.kind === "telnet"
            ? "telnet"
            : machine.kind === "serial"
              ? "serial"
              : "ssh",
    sshOptions: machine.sshOptions ?? createDefaultSshOptions(),
    sortOrder: machine.sortOrder ?? 0,
    tags: machine.tags,
    updatedAt: machine.updatedAt ?? "",
    username: machine.username ?? "",
  };
}

export function DeleteConfirmationDialog({
  deleteError,
  deleting,
  onClose,
  onConfirm,
  pendingDelete,
}: {
  deleteError: UserFacingMessage | null;
  deleting: boolean;
  onClose: () => void;
  onConfirm: () => void;
  pendingDelete: PendingDelete | null;
}) {
  const isGroup = pendingDelete?.type === "group";
  const title = isGroup ? "删除分组" : "删除连接";
  const description = isGroup
    ? "删除分组后，主机会移到默认分组。"
    : "删除本地保存的连接配置。";

  return (
    <ModalShell
      footer={
        <>
          <Button disabled={deleting} onClick={onClose} type="button" variant="ghost">
            取消
          </Button>
          <Button
            disabled={deleting || !pendingDelete}
            onClick={onConfirm}
            type="button"
            variant="danger"
          >
            {deleting ? "删除中..." : "确认删除"}
          </Button>
        </>
      }
      description={description}
      onClose={onClose}
      open={Boolean(pendingDelete)}
      size="compact"
      title={title}
    >
      {pendingDelete ? (
        <div className="space-y-3 text-sm text-zinc-600 dark:text-zinc-300">
          <p>
            {isGroup ? "分组" : "连接"}：
            <span className="font-medium text-zinc-950 dark:text-zinc-50">
              {pendingDelete.title}
            </span>
          </p>
          {isGroup && pendingDelete.machineCount > 0 ? (
            <p>包含 {pendingDelete.machineCount} 台主机，将移到默认分组。</p>
          ) : null}
          {deleteError ? (
            <UserFacingNotice compact message={deleteError} />
          ) : null}
        </div>
      ) : null}
    </ModalShell>
  );
}

export function useSystemThemePreference() {
  const [systemPrefersDark, setSystemPrefersDark] = useState(() => {
    if (typeof window === "undefined" || !window.matchMedia) {
      return true;
    }
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) {
      return undefined;
    }

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = (event: MediaQueryListEvent) => {
      setSystemPrefersDark(event.matches);
    };

    setSystemPrefersDark(mediaQuery.matches);
    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", handleChange);
      return () => mediaQuery.removeEventListener("change", handleChange);
    }

    mediaQuery.addListener(handleChange);
    return () => mediaQuery.removeListener(handleChange);
  }, []);

  return systemPrefersDark;
}

export function htmlLanguage(language: AppSettings["appearance"]["interfaceLanguage"]) {
  if (language === "enUS") {
    return "en-US";
  }
  return "zh-CN";
}

/**
 * 构造统一的工作台壁纸遮罩。这里刻意只保留一层均匀明暗蒙版，避免径向、
 * 侧边和地平线渐变叠加后吞掉主体，也让终端与侧栏看到的是同一张连续图片。
 */
export function workspaceBackgroundImage(
  enabled: boolean,
  imagePath: string,
  resolvedTheme: "dark" | "light",
) {
  const trimmedPath = imagePath.trim();
  if (!enabled || !trimmedPath) {
    return undefined;
  }

  const overlayRgb = resolvedTheme === "dark" ? "16, 16, 18" : "245, 245, 247";
  const imageUrl = localPathToCssUrl(trimmedPath);

  return [
    `linear-gradient(rgba(${overlayRgb}, var(--app-background-veil-opacity)), rgba(${overlayRgb}, var(--app-background-veil-opacity)))`,
    `url("${imageUrl}")`,
  ].join(", ");
}

function localPathToCssUrl(path: string) {
  if (/^(https?|asset|data|blob):/i.test(path)) {
    return path.replace(/"/g, "%22");
  }
  try {
    const desktopUrl = desktopRuntime.convertLocalFileSrc(path);
    if (desktopUrl) {
      return desktopUrl.replace(/"/g, "%22");
    }
  } catch {
    // Fall through to browser-friendly URL handling for invalid local paths.
  }
  if (/^file:/i.test(path)) {
    return path.replace(/"/g, "%22");
  }
  const normalized = path.replace(/\\/g, "/");
  if (/^[a-z]:\//i.test(normalized)) {
    return `file:///${normalized}`.replace(/"/g, "%22");
  }
  if (normalized.startsWith("/")) {
    return `file://${normalized}`.replace(/"/g, "%22");
  }
  return normalized.replace(/"/g, "%22");
}

export function workspaceBackgroundColor(
  windowOpacity: number,
  resolvedTheme: "dark" | "light",
) {
  const opacity = Math.min(Math.max(windowOpacity, 35), 100) / 100;
  const rgb = resolvedTheme === "dark" ? "16 16 18" : "245 245 247";
  return `rgb(${rgb} / ${opacity})`;
}
