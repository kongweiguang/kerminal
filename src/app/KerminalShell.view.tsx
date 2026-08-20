// @author kongweiguang

import {
  CircleAlert,
  GripHorizontal,
  Info,
  TriangleAlert,
  X,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { Button } from "../components/ui/button";
import {
  claimAgentSendRequestAutoOpen,
  useAgentSendRequestSnapshot,
} from "../features/agent-workflow/agentSendRequestStore";
import { cn } from "../lib/cn";
import type { DesktopPlatform } from "../lib/desktopPlatform";
import type { WindowFrameState } from "../lib/useTauriWindowFrameState";
import type { InterfaceDensity } from "../features/settings/settingsModel";
import type { ToolId } from "../features/workspace/types";
import { tools } from "../features/workspace/workspaceData";
import { AppTitleBar } from "./AppTitleBar";
import type { ConfigChangeNotice } from "./configRefreshCoordinator";
import { ToolRail } from "../features/tool-panel/ToolRail";
import type {
  ResolvedOpenToolPanels,
  ToolRailPanelPlacement,
  ToolRailSettings,
} from "../features/tool-panel/toolRailModel";
import { useFloatingToolPanel } from "./useFloatingToolPanel";
import { TOOL_RAIL_WIDTH } from "./KerminalShell.static";

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

const toolPanelPlacementOrder = [
  "attached",
  "left",
  "bottom",
  "center",
] as const satisfies readonly ToolRailPanelPlacement[];

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

/** 紧凑态关闭面板时复用同一份工具顺序和右击编辑入口。 */
export function ShellToolRail({
  activeTool = null,
  activeTools = activeTool ? [activeTool] : [],
  interfaceDensity = "comfortable",
  onActiveToolChange,
  onOpenTool,
  onOpenToolRailCustomization,
  toolRailSettings,
}: {
  activeTool?: ToolId | null;
  activeTools?: readonly ToolId[];
  interfaceDensity?: InterfaceDensity;
  onActiveToolChange: (toolId: ToolId) => void;
  onOpenTool?: (toolId: ToolId) => void;
  onOpenToolRailCustomization?: () => void;
  toolRailSettings?: ToolRailSettings | null;
}) {
  const agentSendRequest = useAgentSendRequestSnapshot().request;
  useEffect(() => {
    if (
      agentSendRequest &&
      claimAgentSendRequestAutoOpen(agentSendRequest.id)
    ) {
      (onOpenTool ?? onActiveToolChange)("agentLauncher");
    }
  }, [agentSendRequest, onActiveToolChange, onOpenTool]);

  return (
    <aside
      aria-expanded={false}
      aria-label="右侧工具栏"
      className="kerminal-material-nav flex h-full w-full min-w-0 justify-center overflow-hidden border-l"
    >
      <ToolRail
        activeTool={activeTool}
        activeTools={activeTools}
        interfaceDensity={interfaceDensity}
        onActiveToolChange={onActiveToolChange}
        onOpenToolRailCustomization={onOpenToolRailCustomization}
        settings={toolRailSettings}
        tools={tools}
        variant="shell"
      />
    </aside>
  );
}

/**
 * ToolPanel 始终使用同一宿主，右停靠、左停靠、自由浮窗和紧凑抽屉只改变外层
 * 几何，避免重建 Agent/SFTP 子树。桌面四个方向槽位共用单层工具材质，避免子面板
 * 再盖一层实色背景；紧凑态才保留独立的抽屉模态语义。
 */
export function ShellCompactToolPanel({
  activeTool = null,
  children,
  compact = true,
  onClose,
  open = true,
  placement = "attached",
}: {
  activeTool?: ToolId | null;
  children: ReactNode;
  compact?: boolean;
  onClose: () => void;
  open?: boolean;
  placement?: ToolRailPanelPlacement;
}) {
  const panelRef = useRef<HTMLElement>(null);
  const floating = !compact && placement === "center";
  const dockedLeft = !compact && placement === "left";
  const dockedBottom = !compact && placement === "bottom";
  const dockedRight = !compact && placement === "attached";
  const modal = compact;
  const panelChromeVisible = modal || floating || dockedLeft || dockedBottom;
  const activeToolTitle =
    tools.find((tool) => tool.id === activeTool)?.title ?? "工具面板";
  const {
    beginDrag,
    moveWithKeyboard,
    position: floatingPosition,
    ready: floatingPositionReady,
  } = useFloatingToolPanel({
    activeTool,
    enabled: floating,
    open,
    panelRef,
  });

  useEffect(() => {
    if (!modal || !open) {
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
      const panel = panelRef.current;
      const preferredTarget =
        panel?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]') ??
        panel?.querySelector<HTMLButtonElement>("button:not([disabled])");
      preferredTarget?.focus();
    });
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [modal, onClose, open]);

  /** 非模态宿主只在焦点位于自身时响应 Escape，不拦截终端和侧栏的快捷键。 */
  const handleNonModalKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (
      event.key === "Escape" &&
      (floating || dockedLeft || dockedBottom || dockedRight) &&
      panelRef.current?.dataset.floatingToolPanelDragging !== "true"
    ) {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
  };

  return (
    <>
      <button
        aria-label="关闭紧凑工具面板"
        className="kerminal-layer-overlay absolute inset-x-0 bottom-0 top-9 bg-zinc-950/18 backdrop-blur-[2px] dark:bg-black/40"
        hidden={!modal || !open}
        onClick={onClose}
        type="button"
      />
      <section
        aria-hidden={!open}
        aria-label={
          floating
            ? "可拖动工具浮窗"
            : dockedLeft
              ? "左侧工具面板"
              : dockedBottom
                ? "底部工具面板"
                : compact
                  ? "紧凑工具面板"
                  : undefined
        }
        aria-modal={modal ? "true" : undefined}
        className={cn(
          !modal && "kerminal-tool-panel-surface",
          floating
            ? "kerminal-floating-window-enter kerminal-layer-workspace-window absolute h-[min(720px,calc(100%-60px))] w-[min(760px,calc(100%-32px))] overflow-hidden rounded-[var(--radius-panel)] border shadow-[var(--shadow-dialog)]"
            : compact
              ? "kerminal-floating-enter kerminal-floating-surface kerminal-layer-dialog absolute bottom-2 right-2 top-11 w-[min(440px,calc(100%-16px))] overflow-hidden rounded-[var(--radius-panel)] border"
              : dockedLeft
                ? "relative z-[var(--layer-chrome)] h-full overflow-hidden border-r border-[var(--border-subtle)]"
                : dockedBottom
                  ? "relative z-[var(--layer-chrome)] h-full overflow-hidden border-t border-[var(--border-subtle)]"
                  : "relative z-[var(--layer-chrome)] h-full overflow-hidden",
        )}
        data-tool-panel-non-modal={
          floating || dockedLeft || dockedBottom || dockedRight
            ? "true"
            : undefined
        }
        data-tool-panel-placement={placement}
        hidden={!open}
        inert={!open}
        onKeyDown={handleNonModalKeyDown}
        ref={panelRef}
        role={
          modal || floating
            ? "dialog"
            : dockedLeft || dockedBottom || dockedRight
              ? "complementary"
              : undefined
        }
        style={
          floating
            ? {
                left: 0,
                top: 0,
                transform: floatingPosition
                  ? `translate3d(${floatingPosition.x}px, ${floatingPosition.y}px, 0)`
                  : undefined,
                visibility: floatingPositionReady ? "visible" : "hidden",
              }
            : modal
              ? undefined
              : dockedLeft
                ? { gridColumn: "3 / 4", gridRow: "2 / 5" }
                : dockedBottom
                  ? { gridColumn: "5 / 6", gridRow: "4 / 5" }
                  : {
                      gridColumn: "7 / 8",
                      gridRow: "2 / 5",
                      paddingRight: TOOL_RAIL_WIDTH,
                    }
        }
      >
        <header
          className="flex h-10 items-center gap-2 border-b border-[var(--border-subtle)] px-2"
          hidden={!panelChromeVisible}
        >
          {floating ? (
            <div
              aria-label="拖动工具浮窗"
              className="kerminal-focus-ring flex min-w-0 flex-1 cursor-move touch-none select-none items-center gap-2 rounded-[var(--radius-control)] px-2 py-1 text-[12px] font-medium text-[var(--text-secondary)] active:cursor-grabbing"
              onKeyDown={moveWithKeyboard}
              onPointerDown={beginDrag}
              role="button"
              tabIndex={0}
              title="拖动工具浮窗；方向键可微调位置"
            >
              <GripHorizontal aria-hidden className="h-4 w-4 shrink-0" />
              <span className="truncate">{activeToolTitle}</span>
            </div>
          ) : (
            <div className="min-w-0 flex-1 truncate px-2 text-[12px] font-medium text-[var(--text-secondary)]">
              {activeToolTitle}
            </div>
          )}
          <Button
            aria-label="关闭工具面板"
            className="h-8 w-8 rounded-[var(--radius-control)]"
            onClick={onClose}
            onPointerDown={(event) => event.stopPropagation()}
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
            panelChromeVisible
              ? cn(
                  "h-[calc(100%-2.5rem)]",
                  !modal && "kerminal-tool-panel-host",
                )
              : "kerminal-tool-panel-host h-full",
          )}
          data-compositor={modal ? undefined : "surface-parent"}
        >
          {children}
        </div>
      </section>
    </>
  );
}

/**
 * 桌面端为右、左、底部和浮窗分别渲染一个稳定宿主；工具 id 作为 React key，
 * 因此修改位置只移动同一子树。紧凑态只投影最近活动工具到既有模态抽屉。
 */
export function ShellResponsiveToolPanels({
  activeTool,
  activeTools,
  compact,
  openPanels,
  rail,
  renderPanel,
  onClose,
}: {
  activeTool: ToolId | null;
  activeTools: readonly ToolId[];
  compact: boolean;
  openPanels: ResolvedOpenToolPanels;
  rail: ReactNode;
  renderPanel: (toolId: ToolId) => ReactNode;
  onClose: (toolId: ToolId) => void;
}) {
  const previousActiveToolsRef = useRef<readonly ToolId[]>(activeTools);
  const [mountedPanels, setMountedPanels] = useState<
    Array<{ placement: ToolRailPanelPlacement; toolId: ToolId }>
  >(() =>
    toolPanelPlacementOrder.flatMap((placement) => {
      const toolId = openPanels[placement];
      return toolId ? [{ placement, toolId }] : [];
    }),
  );
  const railControlsFloatingPanel = Boolean(openPanels.center);

  useEffect(() => {
    const toolId = previousActiveToolsRef.current.find(
      (candidate) => !activeTools.includes(candidate),
    );
    previousActiveToolsRef.current = activeTools;
    if (!toolId) {
      return;
    }
    const focusFrame = window.requestAnimationFrame(() => {
      const preferredTarget = document.querySelector<HTMLButtonElement>(
        `[data-shell-tool-id="${toolId}"]`,
      );
      const fallbackTarget = document.querySelector<HTMLButtonElement>(
        "[data-shell-tool-id]",
      );
      (preferredTarget ?? fallbackTarget)?.focus();
    });
    return () => window.cancelAnimationFrame(focusFrame);
  }, [activeTools]);

  useEffect(() => {
    setMountedPanels((current) => {
      const next = [...current];
      let changed = false;
      for (const placement of toolPanelPlacementOrder) {
        const toolId = openPanels[placement];
        if (!toolId) {
          continue;
        }
        const existingIndex = next.findIndex(
          (candidate) => candidate.toolId === toolId,
        );
        if (existingIndex < 0) {
          next.push({ placement, toolId });
          changed = true;
        } else if (next[existingIndex].placement !== placement) {
          next[existingIndex] = { placement, toolId };
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [openPanels]);

  return (
    <>
      <div
        className="relative h-full justify-self-end overflow-hidden"
        style={{
          gridColumn: "7 / 8",
          gridRow: "2 / 5",
          width: TOOL_RAIL_WIDTH,
          zIndex: railControlsFloatingPanel
            ? "calc(var(--layer-workspace-window) + 1)"
            : "calc(var(--layer-chrome) + 1)",
        }}
      >
        {rail}
      </div>
      {mountedPanels.map(({ placement, toolId }) => {
        const open = compact
          ? activeTool === toolId
          : activeTools.includes(toolId);
        return (
          <ShellCompactToolPanel
            activeTool={toolId}
            compact={compact}
            key={toolId}
            onClose={() => onClose(toolId)}
            open={open}
            placement={placement}
          >
            {renderPanel(toolId)}
          </ShellCompactToolPanel>
        );
      })}
    </>
  );
}

/** 单面板兼容入口供局部组件测试复用；主 Shell 使用多槽位版本。 */
export function ShellResponsiveToolPanel({
  activeTool,
  compact,
  panel,
  placement = "attached",
  rail,
  onClose,
}: {
  activeTool: ToolId | null;
  compact: boolean;
  panel: ReactNode;
  placement?: ToolRailPanelPlacement;
  rail: ReactNode;
  onClose: () => void;
}) {
  return (
    <ShellResponsiveToolPanels
      activeTool={activeTool}
      activeTools={activeTool ? [activeTool] : []}
      compact={compact}
      onClose={onClose}
      openPanels={activeTool ? { [placement]: activeTool } : {}}
      rail={rail}
      renderPanel={() => panel}
    />
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
        className="kerminal-material-nav col-[2/8] row-[1/2] border-b"
        data-tauri-drag-region
      />
      <div
        className="pointer-events-none relative z-10 col-[2/8] row-[1/2] justify-self-end kerminal-material-nav"
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
