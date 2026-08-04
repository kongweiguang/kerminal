// @author kongweiguang

import {
  CircleAlert,
  Bot,
  Cpu,
  FileText,
  FolderOpen,
  History,
  Info,
  Network,
  PanelsTopLeft,
  ScanSearch,
  TriangleAlert,
  X,
} from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { Button } from "../components/ui/button";
import {
  claimAgentSendRequestAutoOpen,
  useAgentSendRequestSnapshot,
} from "../features/agent-workflow/agentSendRequestStore";
import { cn } from "../lib/cn";
import type { DesktopPlatform } from "../lib/desktopPlatform";
import type { WindowFrameState } from "../lib/useTauriWindowFrameState";
import type { ToolId } from "../features/workspace/types";
import { tools } from "../features/workspace/workspaceData";
import { AppTitleBar } from "./AppTitleBar";
import type { ConfigChangeNotice } from "./configRefreshCoordinator";

const shellToolRailIcons: Partial<Record<ToolId, typeof Bot>> = {
  agentLauncher: Bot,
  context: ScanSearch,
  logs: History,
  ports: Network,
  sftp: FolderOpen,
  snippets: FileText,
  system: Cpu,
  tmux: PanelsTopLeft,
};

const shellNoticeTone = {
  error: {
    Icon: CircleAlert,
    iconClassName: "text-[rgb(var(--app-danger))]",
  },
  info: {
    Icon: Info,
    iconClassName: "text-[rgb(var(--app-accent))]",
  },
  warning: {
    Icon: TriangleAlert,
    iconClassName: "text-amber-600 dark:text-amber-300",
  },
} as const;

function ShellNotice({
  level,
  message,
  onDismiss,
  role,
}: {
  level: ConfigChangeNotice["level"];
  message: string;
  onDismiss: () => void;
  role: "alert" | "status";
}) {
  const { Icon, iconClassName } = shellNoticeTone[level];

  return (
    <div className="kerminal-layer-toast pointer-events-none fixed bottom-4 left-1/2 w-[min(40rem,calc(100vw-1.5rem))] -translate-x-1/2">
      <div
        aria-live={role === "alert" ? "assertive" : "polite"}
        className="kerminal-floating-enter kerminal-floating-surface pointer-events-auto flex items-start gap-2.5 rounded-[var(--radius-card)] border px-3 py-2.5 text-[13px] leading-5 text-[var(--text-primary)]"
        data-shell-notice-level={level}
        role={role}
      >
        <Icon
          aria-hidden="true"
          className={cn("mt-0.5 h-4 w-4 shrink-0", iconClassName)}
        />
        <span className="min-w-0 flex-1 break-words">{message}</span>
        <Button
          aria-label="关闭提示"
          className="h-7 w-7 shrink-0 rounded-[var(--radius-control)]"
          onClick={onDismiss}
          size="icon"
          title="关闭提示"
          type="button"
          variant="ghost"
        >
          <X aria-hidden="true" className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

export function ShellToolRail({
  onActiveToolChange,
}: {
  onActiveToolChange: (toolId: ToolId) => void;
}) {
  const agentSendRequest = useAgentSendRequestSnapshot().request;
  useEffect(() => {
    if (
      agentSendRequest &&
      claimAgentSendRequestAutoOpen(agentSendRequest.id)
    ) {
      onActiveToolChange("agentLauncher");
    }
  }, [agentSendRequest, onActiveToolChange]);

  return (
    <aside
      aria-expanded={false}
      aria-label="工具面板"
      className="kerminal-material-nav flex h-full w-full min-w-0 justify-center overflow-hidden border-l"
    >
      <nav
        aria-label="工具栏"
        className="flex w-full min-w-0 flex-col items-center gap-1.5 py-2.5"
      >
        {tools
          .map((tool) => {
            const Icon = shellToolRailIcons[tool.id];
            if (!Icon) {
              return null;
            }
            return (
              <Button
                aria-label={`打开 ${tool.title}`}
                className={cn(
                  "h-[var(--density-control-height)] w-[var(--density-control-height)] rounded-[var(--radius-control)]",
                  tool.id === "logs" && "mt-auto",
                )}
                data-shell-tool-id={tool.id}
                key={tool.id}
                onClick={() => onActiveToolChange(tool.id)}
                size="icon"
                title={tool.title}
                variant="ghost"
              >
                <Icon className="h-4 w-4" />
              </Button>
            );
          })}
      </nav>
    </aside>
  );
}

/**
 * ToolPanel 使用单一稳定宿主；紧凑布局只切换为覆盖式抽屉，不能重建子树。
 * 抽屉保留 ToolPanel 自身工具栏，并提供遮罩与 Escape 两种关闭路径。
 */
export function ShellCompactToolPanel({
  children,
  compact = true,
  onClose,
  open = true,
}: {
  children: ReactNode;
  compact?: boolean;
  onClose: () => void;
  open?: boolean;
}) {
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!compact || !open) {
      return undefined;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) {
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") {
        return;
      }

      const panel = panelRef.current;
      if (!panel) {
        return;
      }
      const focusableElements = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      const firstFocusable = focusableElements[0];
      const lastFocusable = focusableElements[focusableElements.length - 1];
      if (!firstFocusable || !lastFocusable) {
        return;
      }

      // 模态抽屉打开时，Tab 只能在抽屉内部循环，避免焦点落到被遮罩的终端。
      const activeElement = document.activeElement;
      if (
        event.shiftKey &&
        (activeElement === firstFocusable || !panel.contains(activeElement))
      ) {
        event.preventDefault();
        lastFocusable.focus();
        return;
      }
      if (
        !event.shiftKey &&
        (activeElement === lastFocusable || !panel.contains(activeElement))
      ) {
        event.preventDefault();
        firstFocusable.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    const focusFrame = window.requestAnimationFrame(() => {
      panelRef.current
        ?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]')
        ?.focus();
    });
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [compact, onClose, open]);

  return (
    <>
      <button
        aria-label="关闭紧凑工具面板"
        className="kerminal-layer-overlay absolute inset-x-0 bottom-0 top-9 bg-zinc-950/18 backdrop-blur-[2px] dark:bg-black/40"
        hidden={!compact || !open}
        onClick={onClose}
        type="button"
      />
      <section
        aria-hidden={!open}
        aria-modal={compact ? "true" : undefined}
        aria-label={compact ? "紧凑工具面板" : undefined}
        className={cn(
          compact
            ? "kerminal-floating-enter kerminal-floating-surface kerminal-layer-dialog absolute bottom-2 right-2 top-11 w-[min(440px,calc(100%-16px))] overflow-hidden rounded-[var(--radius-panel)] border"
            : "relative z-[var(--layer-chrome)] h-full overflow-hidden",
        )}
        hidden={!open}
        inert={!open}
        ref={panelRef}
        role={compact ? "dialog" : undefined}
        style={
          compact
            ? undefined
            : { gridColumn: "5 / 6", gridRow: "2 / 3" }
        }
      >
        <header
          className="flex h-10 items-center justify-end border-b border-[var(--border-subtle)] px-2"
          hidden={!compact}
        >
          <Button
            aria-label="关闭工具面板"
            className="h-8 w-8 rounded-[var(--radius-control)]"
            onClick={onClose}
            size="icon"
            title="关闭"
            variant="ghost"
          >
            <X aria-hidden className="h-4 w-4" />
          </Button>
        </header>
        <div
          className={cn(
            "min-h-0",
            compact ? "h-[calc(100%-2.5rem)]" : "h-full",
          )}
        >
          {children}
        </div>
      </section>
    </>
  );
}

/** 在桌面固定侧栏与紧凑覆盖抽屉之间复用同一份 ToolPanel。 */
export function ShellResponsiveToolPanel({
  activeTool,
  compact,
  panel,
  rail,
  onClose,
}: {
  activeTool: ToolId | null;
  compact: boolean;
  panel: ReactNode;
  rail: ReactNode;
  onClose: () => void;
}) {
  const lastActiveToolRef = useRef<ToolId | null>(activeTool);
  const open = activeTool !== null;

  useEffect(() => {
    if (activeTool) {
      lastActiveToolRef.current = activeTool;
      return;
    }
    const toolId = lastActiveToolRef.current;
    if (!toolId) {
      return;
    }
    const focusFrame = window.requestAnimationFrame(() => {
      document
        .querySelector<HTMLButtonElement>(`[data-shell-tool-id="${toolId}"]`)
        ?.focus();
    });
    return () => window.cancelAnimationFrame(focusFrame);
  }, [activeTool]);

  return (
    <>
      <div
        className="relative z-[var(--layer-chrome)] h-full overflow-hidden"
        style={{ gridColumn: "5 / 6", gridRow: "2 / 3" }}
      >
        {open ? null : rail}
      </div>
      <ShellCompactToolPanel
        compact={compact}
        onClose={onClose}
        open={open}
      >
        {panel}
      </ShellCompactToolPanel>
    </>
  );
}

/** 主窗口顶部材质、拖拽区域和平台标题栏。 */
export function ShellWindowChrome({
  desktopPlatform,
  leftPanelCollapsed,
  onLeftPanelCollapsedChange,
  resolvedTheme,
  rightToolRailTitleBarFillWidth,
  windowFrameState,
}: {
  desktopPlatform: DesktopPlatform;
  leftPanelCollapsed: boolean;
  onLeftPanelCollapsedChange: (collapsed: boolean) => void;
  resolvedTheme: "dark" | "light";
  rightToolRailTitleBarFillWidth: number;
  windowFrameState: WindowFrameState;
}) {
  return (
    <>
      <div
        className="kerminal-material-nav col-[1/2] row-[1/2]"
        data-tauri-drag-region
      />
      <div
        className="kerminal-material-nav col-[2/6] row-[1/2] border-b"
        data-tauri-drag-region
      />
      <div
        className="pointer-events-none relative z-10 col-[2/6] row-[1/2] justify-self-end kerminal-material-nav"
        data-right-tool-rail-titlebar-fill
        style={{
          height: "calc(100% + 1px)",
          width: rightToolRailTitleBarFillWidth,
        }}
      />
      <AppTitleBar
        className="pointer-events-none col-[1/-1] row-[1/2] z-[var(--layer-chrome)] border-b-0 bg-transparent"
        desktopPlatform={desktopPlatform}
        leftPanelCollapsed={leftPanelCollapsed}
        onLeftPanelCollapsedChange={onLeftPanelCollapsedChange}
        resolvedTheme={resolvedTheme}
        surface={false}
        windowFrameState={windowFrameState}
      />
    </>
  );
}

export function KerminalShellNotices({
  configNotice,
  onConfigNoticeDismiss,
  onShellNoticeDismiss,
  shellNoticeMessage,
  shellNoticeVisible,
}: {
  configNotice: ConfigChangeNotice | null;
  onConfigNoticeDismiss: () => void;
  onShellNoticeDismiss: () => void;
  shellNoticeMessage?: string | null;
  shellNoticeVisible: boolean;
}) {
  if (configNotice) {
    return (
      <ShellNotice
        level={configNotice.level}
        message={configNotice.text}
        onDismiss={onConfigNoticeDismiss}
        role={configNotice.level === "error" ? "alert" : "status"}
      />
    );
  }

  if (!shellNoticeMessage || !shellNoticeVisible) {
    return null;
  }

  return (
    <ShellNotice
      level="warning"
      message={shellNoticeMessage}
      onDismiss={onShellNoticeDismiss}
      role="alert"
    />
  );
}
