// @author kongweiguang

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
} from "react";
import type { ToolRailPanelPlacement } from "../features/tool-panel";
import type { WorkspaceShellLayout } from "../features/workspace/workspaceSession";
import {
  buildShellGridTemplateColumns,
  buildShellGridTemplateRows,
  clampPanelWidth,
  initialPanelWidth,
  resolveShellLayout,
} from "./KerminalShell.helpers";
import { TOOL_RAIL_WIDTH } from "./KerminalShell.static";

const TOOL_PANEL_INITIAL_MAX_WIDTH = 444;
const TOOL_PANEL_INITIAL_MIN_WIDTH = 340;
const TOOL_PANEL_MIN_WIDTH = 300;
const TOOL_PANEL_MAX_VIEWPORT_RATIO = 0.5;
const BOTTOM_TOOL_PANEL_MIN_HEIGHT = 180;
const BOTTOM_TOOL_PANEL_INITIAL_MAX_HEIGHT = 360;
const BOTTOM_TOOL_PANEL_INITIAL_MIN_HEIGHT = 240;
const BOTTOM_TOOL_PANEL_MAX_VIEWPORT_RATIO = 0.55;
const TERMINAL_MIN_HEIGHT = 220;
const TERMINAL_MIN_WIDTH = 360;

type ResizablePanel =
  | "left"
  | "leftTools"
  | "rightTools"
  | "bottomTools";

/**
 * 左右工具面板最多占工作区一半，并为另一侧面板和终端保留真实宽度；不同方向
 * 同时打开时各自使用独立尺寸，拖动其中一个不会意外改变另一个。
 */
function resolveToolPanelMaxWidth(
  frameWidth: number,
  leftPanelColumnWidth: number,
  reservedOtherPanelWidth = 0,
) {
  const midpointWidth = frameWidth * TOOL_PANEL_MAX_VIEWPORT_RATIO;
  const terminalSafeWidth =
    frameWidth -
    leftPanelColumnWidth -
    reservedOtherPanelWidth -
    TERMINAL_MIN_WIDTH;
  return Math.max(
    TOOL_PANEL_MIN_WIDTH,
    Math.min(midpointWidth, terminalSafeWidth),
  );
}

/** 底部面板最多占工作区 55%，同时为终端正文和标题栏保留可交互高度。 */
function resolveBottomToolPanelMaxHeight(frameHeight: number) {
  return Math.max(
    BOTTOM_TOOL_PANEL_MIN_HEIGHT,
    Math.min(
      frameHeight * BOTTOM_TOOL_PANEL_MAX_VIEWPORT_RATIO,
      frameHeight - 36 - TERMINAL_MIN_HEIGHT,
    ),
  );
}

/** 初始底部高度使用视口比例，但限制在适合常见终端窗口的生产区间内。 */
function initialBottomToolPanelHeight() {
  const frameHeight = typeof window === "undefined" ? 900 : window.innerHeight;
  return clampPanelWidth(Math.round(frameHeight * 0.3), {
    max: BOTTOM_TOOL_PANEL_INITIAL_MAX_HEIGHT,
    min: BOTTOM_TOOL_PANEL_INITIAL_MIN_HEIGHT,
  });
}

function normalizeCollapsedMachineGroupIds(groupIds: readonly string[] = []) {
  return [...new Set(groupIds.filter(Boolean))].sort();
}

/**
 * 统一管理主机栏、左右工具面板和底部工具面板的拖动预览。高频 pointermove 只
 * 写 Shell 网格，结束时才提交 React 状态，避免终端和远端工具整树重复渲染。
 */
export function useKerminalShellPanelResize({
  openToolPlacements,
  viewportHeight,
  viewportWidth,
  workspaceFrameRef,
}: {
  openToolPlacements: readonly ToolRailPanelPlacement[];
  viewportHeight: number;
  viewportWidth: number;
  workspaceFrameRef: RefObject<HTMLDivElement | null>;
}) {
  const [leftPanelWidth, setLeftPanelWidth] = useState(() =>
    initialPanelWidth(0.22, { max: 320, min: 240 }),
  );
  const [leftToolPanelWidth, setLeftToolPanelWidth] = useState(() =>
    initialPanelWidth(0.24, {
      max: TOOL_PANEL_INITIAL_MAX_WIDTH,
      min: TOOL_PANEL_INITIAL_MIN_WIDTH,
    }),
  );
  const [toolPanelWidth, setToolPanelWidth] = useState(() =>
    initialPanelWidth(0.24, {
      max: TOOL_PANEL_INITIAL_MAX_WIDTH,
      min: TOOL_PANEL_INITIAL_MIN_WIDTH,
    }),
  );
  const [bottomToolPanelHeight, setBottomToolPanelHeight] = useState(
    initialBottomToolPanelHeight,
  );
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(false);
  const [collapsedMachineGroupIds, setCollapsedMachineGroupIds] = useState<
    string[]
  >([]);
  const activeResizeCleanupRef = useRef<(() => void) | null>(null);
  const presentationCleanupFrameRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      activeResizeCleanupRef.current?.();
      if (presentationCleanupFrameRef.current !== null) {
        window.cancelAnimationFrame(presentationCleanupFrameRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    setBottomToolPanelHeight((current) =>
      clampPanelWidth(current, {
        max: resolveBottomToolPanelMaxHeight(viewportHeight),
        min: BOTTOM_TOOL_PANEL_MIN_HEIGHT,
      }),
    );
  }, [viewportHeight]);

  const handleCollapsedMachineGroupIdsChange = useCallback(
    (groupIds: string[]) => {
      setCollapsedMachineGroupIds(normalizeCollapsedMachineGroupIds(groupIds));
    },
    [],
  );

  /** 恢复旧布局时让单一 toolPanelWidth 同时成为缺省左右宽度，保持向前兼容。 */
  const handleWorkspaceShellLayoutRestored = useCallback(
    (layout: WorkspaceShellLayout) => {
      if (typeof layout.leftPanelWidth === "number") {
        setLeftPanelWidth(
          clampPanelWidth(layout.leftPanelWidth, { max: 520, min: 220 }),
        );
      }
      if (typeof layout.toolPanelWidth === "number") {
        setToolPanelWidth(
          clampPanelWidth(layout.toolPanelWidth, {
            max: resolveToolPanelMaxWidth(viewportWidth, 0),
            min: TOOL_PANEL_MIN_WIDTH,
          }),
        );
      }
      const restoredLeftToolPanelWidth =
        layout.leftToolPanelWidth ?? layout.toolPanelWidth;
      if (typeof restoredLeftToolPanelWidth === "number") {
        setLeftToolPanelWidth(
          clampPanelWidth(restoredLeftToolPanelWidth, {
            max: resolveToolPanelMaxWidth(
              viewportWidth,
              0,
              openToolPlacements.includes("attached")
                ? TOOL_RAIL_WIDTH
                : 0,
            ),
            min: TOOL_PANEL_MIN_WIDTH,
          }),
        );
      }
      if (typeof layout.bottomToolPanelHeight === "number") {
        setBottomToolPanelHeight(
          clampPanelWidth(layout.bottomToolPanelHeight, {
            max: resolveBottomToolPanelMaxHeight(viewportHeight),
            min: BOTTOM_TOOL_PANEL_MIN_HEIGHT,
          }),
        );
      }
      if (typeof layout.leftPanelCollapsed === "boolean") {
        setLeftPanelCollapsed(layout.leftPanelCollapsed);
      }
      setCollapsedMachineGroupIds(
        normalizeCollapsedMachineGroupIds(layout.collapsedMachineGroupIds),
      );
    },
    [openToolPlacements, viewportHeight, viewportWidth],
  );

  const workspaceShellLayout = useMemo<WorkspaceShellLayout>(
    () => ({
      bottomToolPanelHeight,
      collapsedMachineGroupIds,
      leftPanelCollapsed,
      leftPanelWidth,
      leftToolPanelWidth,
      toolPanelWidth,
    }),
    [
      bottomToolPanelHeight,
      collapsedMachineGroupIds,
      leftPanelCollapsed,
      leftPanelWidth,
      leftToolPanelWidth,
      toolPanelWidth,
    ],
  );

  const layout = resolveShellLayout({
    bottomToolPanelHeight,
    leftPanelCollapsed,
    leftPanelWidth,
    leftToolPanelWidth,
    openToolPlacements,
    toolPanelWidth,
    viewportWidth,
  });

  const beginPanelResize = useCallback(
    (panel: ResizablePanel, event: PointerEvent<HTMLDivElement>) => {
      const panelUnavailable =
        (panel === "left" && layout.effectiveLeftPanelCollapsed) ||
        (panel === "leftTools" && !layout.effectiveLeftToolPanelOpen) ||
        (panel === "rightTools" && !layout.effectiveRightPanelOpen) ||
        (panel === "bottomTools" && !layout.effectiveBottomToolPanelOpen);
      if (panelUnavailable) {
        return;
      }
      const frame = workspaceFrameRef.current;
      if (!frame) {
        return;
      }

      activeResizeCleanupRef.current?.();
      if (presentationCleanupFrameRef.current !== null) {
        window.cancelAnimationFrame(presentationCleanupFrameRef.current);
        presentationCleanupFrameRef.current = null;
      }
      event.preventDefault();
      event.stopPropagation();
      const startX = event.clientX;
      const startY = event.clientY;
      const startLeftWidth = leftPanelWidth;
      const startLeftToolWidth = leftToolPanelWidth;
      const startRightToolWidth = toolPanelWidth;
      const startBottomHeight = bottomToolPanelHeight;
      const frameBounds = frame.getBoundingClientRect();
      const frameWidth =
        frameBounds.width > 0 ? frameBounds.width : window.innerWidth;
      const frameHeight =
        frameBounds.height > 0 ? frameBounds.height : window.innerHeight;
      const pointerId = event.pointerId;
      const separator = event.currentTarget;
      let animationFrame: number | null = null;
      let pendingClientX = startX;
      let pendingClientY = startY;
      let previewLeftWidth = startLeftWidth;
      let previewLeftToolWidth = startLeftToolWidth;
      let previewRightToolWidth = startRightToolWidth;
      let previewBottomHeight = startBottomHeight;
      let stopped = false;
      const resizePresentation =
        panel === "leftTools"
          ? "tools-left"
          : panel === "rightTools"
            ? "tools-right"
            : panel === "bottomTools"
              ? "tools-bottom"
              : "left";

      frame.dataset.panelResizing = resizePresentation;
      if (panel === "rightTools") {
        frame.style.setProperty(
          "--kerminal-live-right-inset",
          `${startRightToolWidth}px`,
        );
      }
      if (typeof separator.setPointerCapture === "function") {
        try {
          separator.setPointerCapture(pointerId);
        } catch {
          // WebView2 可能在系统刚取消指针时拒绝 capture；窗口级监听仍可收口。
        }
      }

      /** 单帧只写一次列或行模板，连续高频鼠标事件不会积压 React 更新。 */
      const applyResizePreview = () => {
        animationFrame = null;
        if (panel === "bottomTools") {
          previewBottomHeight = clampPanelWidth(
            startBottomHeight + startY - pendingClientY,
            {
              max: resolveBottomToolPanelMaxHeight(frameHeight),
              min: BOTTOM_TOOL_PANEL_MIN_HEIGHT,
            },
          );
          frame.style.gridTemplateRows = buildShellGridTemplateRows(
            previewBottomHeight,
          );
          return;
        }

        const deltaX = pendingClientX - startX;
        if (panel === "left") {
          const maxLeftWidth =
            frameWidth -
            layout.leftToolPanelColumnWidth -
            layout.rightPanelColumnWidth -
            TERMINAL_MIN_WIDTH;
          previewLeftWidth = clampPanelWidth(startLeftWidth + deltaX, {
            max: Math.min(520, maxLeftWidth),
            min: 220,
          });
        } else if (panel === "leftTools") {
          previewLeftToolWidth = clampPanelWidth(
            startLeftToolWidth + deltaX,
            {
              max: resolveToolPanelMaxWidth(
                frameWidth,
                layout.leftPanelColumnWidth,
                layout.rightPanelColumnWidth,
              ),
              min: TOOL_PANEL_MIN_WIDTH,
            },
          );
        } else {
          previewRightToolWidth = clampPanelWidth(
            startRightToolWidth - deltaX,
            {
              max: resolveToolPanelMaxWidth(
                frameWidth,
                layout.leftPanelColumnWidth,
                layout.leftToolPanelColumnWidth,
              ),
              min: TOOL_PANEL_MIN_WIDTH,
            },
          );
          frame.style.setProperty(
            "--kerminal-live-right-inset",
            `${previewRightToolWidth}px`,
          );
        }
        frame.style.gridTemplateColumns = buildShellGridTemplateColumns({
          leftPanelWidth: previewLeftWidth,
          leftToolPanelWidth: previewLeftToolWidth,
          rightPanelWidth: previewRightToolWidth,
        });
      };

      /** 请求下一绘制帧，覆盖尚未消费的坐标而不是排队处理全部 move。 */
      const scheduleResizePreview = (clientX: number, clientY: number) => {
        pendingClientX = clientX;
        pendingClientY = clientY;
        if (animationFrame === null) {
          animationFrame = window.requestAnimationFrame(applyResizePreview);
        }
      };

      /** 移除本次拖动的所有全局监听和 pointer capture，确保失焦后不会粘住。 */
      const cleanupResizeListeners = () => {
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp);
        window.removeEventListener("pointercancel", handlePointerCancel);
        window.removeEventListener("blur", handleWindowBlur);
        window.removeEventListener("keydown", handleKeyDown);
        if (
          typeof separator.hasPointerCapture === "function" &&
          typeof separator.releasePointerCapture === "function" &&
          separator.hasPointerCapture(pointerId)
        ) {
          try {
            separator.releasePointerCapture(pointerId);
          } catch {
            // 系统可能先释放 capture；监听已经移除，无需再补偿。
          }
        }
        activeResizeCleanupRef.current = null;
      };

      /** 提交最终尺寸后延后一帧恢复过渡，避免终端边界追赶旧 React 值。 */
      const stopResize = (commit: boolean) => {
        if (stopped) {
          return;
        }
        stopped = true;
        if (animationFrame !== null) {
          window.cancelAnimationFrame(animationFrame);
          applyResizePreview();
        }
        cleanupResizeListeners();

        if (commit) {
          if (panel === "left") {
            setLeftPanelWidth(previewLeftWidth);
          } else if (panel === "leftTools") {
            setLeftToolPanelWidth(previewLeftToolWidth);
          } else if (panel === "rightTools") {
            setToolPanelWidth(previewRightToolWidth);
          } else {
            setBottomToolPanelHeight(previewBottomHeight);
          }
        } else {
          frame.style.gridTemplateColumns = layout.gridTemplateColumns;
          frame.style.gridTemplateRows = layout.gridTemplateRows;
          if (panel === "rightTools") {
            frame.style.setProperty(
              "--kerminal-live-right-inset",
              `${startRightToolWidth}px`,
            );
          }
        }

        presentationCleanupFrameRef.current = window.requestAnimationFrame(
          () => {
            if (frame.dataset.panelResizing === resizePresentation) {
              delete frame.dataset.panelResizing;
              frame.style.removeProperty("--kerminal-live-right-inset");
            }
            presentationCleanupFrameRef.current = null;
          },
        );
      };

      /** 只处理发起本次拖动的指针，并在 buttons 丢失时主动完成收口。 */
      function handlePointerMove(moveEvent: globalThis.PointerEvent) {
        if (moveEvent.pointerId !== pointerId) {
          return;
        }
        if (moveEvent.buttons === 0) {
          stopResize(true);
          return;
        }
        if (moveEvent.cancelable) {
          moveEvent.preventDefault();
        }
        scheduleResizePreview(moveEvent.clientX, moveEvent.clientY);
      }

      /** 正常 pointerup 提交最后一个坐标。 */
      function handlePointerUp(upEvent: globalThis.PointerEvent) {
        if (upEvent.pointerId !== pointerId) {
          return;
        }
        scheduleResizePreview(upEvent.clientX, upEvent.clientY);
        stopResize(true);
      }

      /** 系统取消指针时回退到拖动前尺寸，避免保存半截布局。 */
      function handlePointerCancel(cancelEvent: globalThis.PointerEvent) {
        if (cancelEvent.pointerId === pointerId) {
          stopResize(false);
        }
      }

      /** 窗口失焦时提交当前预览，防止松开鼠标后界面仍停留在拖动状态。 */
      function handleWindowBlur() {
        stopResize(true);
      }

      /** Escape 是可恢复的取消路径，符合桌面分隔条的通用交互预期。 */
      function handleKeyDown(keyEvent: globalThis.KeyboardEvent) {
        if (keyEvent.key === "Escape") {
          keyEvent.preventDefault();
          stopResize(false);
        }
      }

      activeResizeCleanupRef.current = () => stopResize(false);
      window.addEventListener("pointermove", handlePointerMove, {
        passive: false,
      });
      window.addEventListener("pointerup", handlePointerUp);
      window.addEventListener("pointercancel", handlePointerCancel);
      window.addEventListener("blur", handleWindowBlur);
      window.addEventListener("keydown", handleKeyDown);
    },
    [
      bottomToolPanelHeight,
      layout.effectiveBottomToolPanelOpen,
      layout.effectiveLeftPanelCollapsed,
      layout.effectiveLeftToolPanelOpen,
      layout.effectiveRightPanelOpen,
      layout.gridTemplateColumns,
      layout.gridTemplateRows,
      layout.leftPanelColumnWidth,
      layout.leftToolPanelColumnWidth,
      layout.rightPanelColumnWidth,
      leftPanelWidth,
      leftToolPanelWidth,
      toolPanelWidth,
      workspaceFrameRef,
    ],
  );

  /** 分隔条键盘路径与指针方向一致，Shift 使用大步长便于快速调整。 */
  const resizeWithKeyboard = useCallback(
    (panel: ResizablePanel, event: KeyboardEvent<HTMLDivElement>) => {
      if (panel === "bottomTools") {
        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") {
          return;
        }
        if (!layout.effectiveBottomToolPanelOpen) {
          return;
        }
        event.preventDefault();
        const step = event.shiftKey ? 40 : 16;
        setBottomToolPanelHeight((current) =>
          clampPanelWidth(
            current + (event.key === "ArrowUp" ? step : -step),
            {
              max: resolveBottomToolPanelMaxHeight(viewportHeight),
              min: BOTTOM_TOOL_PANEL_MIN_HEIGHT,
            },
          ),
        );
        return;
      }

      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
        return;
      }
      const panelUnavailable =
        (panel === "left" && layout.effectiveLeftPanelCollapsed) ||
        (panel === "leftTools" && !layout.effectiveLeftToolPanelOpen) ||
        (panel === "rightTools" && !layout.effectiveRightPanelOpen);
      if (panelUnavailable) {
        return;
      }
      event.preventDefault();
      const step = event.shiftKey ? 40 : 16;
      if (panel === "left") {
        setLeftPanelWidth((current) =>
          clampPanelWidth(
            current + (event.key === "ArrowRight" ? step : -step),
            { max: 520, min: 220 },
          ),
        );
        return;
      }

      const increaseKey = panel === "leftTools" ? "ArrowRight" : "ArrowLeft";
      const reservedOtherPanelWidth =
        panel === "leftTools"
          ? layout.rightPanelColumnWidth
          : layout.leftToolPanelColumnWidth;
      const updateWidth =
        panel === "leftTools" ? setLeftToolPanelWidth : setToolPanelWidth;
      updateWidth((current) =>
        clampPanelWidth(current + (event.key === increaseKey ? step : -step), {
          max: resolveToolPanelMaxWidth(
            viewportWidth,
            layout.leftPanelColumnWidth,
            reservedOtherPanelWidth,
          ),
          min: TOOL_PANEL_MIN_WIDTH,
        }),
      );
    },
    [
      layout.effectiveBottomToolPanelOpen,
      layout.effectiveLeftPanelCollapsed,
      layout.effectiveLeftToolPanelOpen,
      layout.effectiveRightPanelOpen,
      layout.leftPanelColumnWidth,
      layout.leftToolPanelColumnWidth,
      layout.rightPanelColumnWidth,
      viewportHeight,
      viewportWidth,
    ],
  );

  return {
    beginPanelResize,
    collapsedMachineGroupIds,
    handleCollapsedMachineGroupIdsChange,
    handleWorkspaceShellLayoutRestored,
    leftPanelCollapsed,
    resizeWithKeyboard,
    setLeftPanelCollapsed,
    workspaceShellLayout,
    ...layout,
  };
}
