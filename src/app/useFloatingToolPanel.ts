// @author kongweiguang

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
} from "react";
import type { ToolId } from "../features/workspace/types";
import {
  clampFloatingToolPanelPoint,
  resolveInitialFloatingToolPanelPoint,
  type FloatingToolPanelPoint,
  type FloatingToolPanelSize,
} from "./floatingToolPanelModel";

interface FloatingToolPanelMeasurement {
  host: FloatingToolPanelSize;
  panel: FloatingToolPanelSize;
}

interface UseFloatingToolPanelOptions {
  activeTool: ToolId | null;
  enabled: boolean;
  open: boolean;
  panelRef: RefObject<HTMLElement | null>;
}

/** 比较坐标避免 ResizeObserver 在无变化时触发额外的 Shell 子树协调。 */
function samePoint(
  left: FloatingToolPanelPoint | null,
  right: FloatingToolPanelPoint,
) {
  return left?.x === right.x && left.y === right.y;
}

/** 使用实际 Shell 与面板尺寸做拖动边界，测试环境没有布局时回退到视口安全值。 */
function measureFloatingToolPanel(
  panel: HTMLElement,
): FloatingToolPanelMeasurement {
  const hostRect = panel.parentElement?.getBoundingClientRect();
  const panelRect = panel.getBoundingClientRect();
  const host = {
    height:
      hostRect && hostRect.height > 0 ? hostRect.height : window.innerHeight,
    width: hostRect && hostRect.width > 0 ? hostRect.width : window.innerWidth,
  };
  return {
    host,
    panel: {
      height:
        panelRect.height > 0
          ? panelRect.height
          : Math.min(720, Math.max(240, host.height - 60)),
      width:
        panelRect.width > 0
          ? panelRect.width
          : Math.min(760, Math.max(300, host.width - 32)),
    },
  };
}

/** 直接写 transform 作为高频拖动预览，避免 Agent/SFTP 内容跟随每个指针帧重渲染。 */
function applyFloatingToolPanelPoint(
  panel: HTMLElement,
  point: FloatingToolPanelPoint,
) {
  panel.style.transform = `translate3d(${point.x}px, ${point.y}px, 0)`;
}

/**
 * 管理非模态工具浮窗的运行时几何。位置按工具在本次应用运行期记忆但不写入全局
 * settings，避免不同窗口尺寸之间恢复不可用坐标；持久化设置只负责选择展示模式。
 */
export function useFloatingToolPanel({
  activeTool,
  enabled,
  open,
  panelRef,
}: UseFloatingToolPanelOptions) {
  const positionsRef = useRef<Partial<Record<ToolId, FloatingToolPanelPoint>>>(
    {},
  );
  const positionRef = useRef<FloatingToolPanelPoint | null>(null);
  const activeDragCleanupRef = useRef<(() => void) | null>(null);
  const [position, setPosition] = useState<FloatingToolPanelPoint | null>(null);

  /** 提交低频最终坐标，并为当前工具保留本次运行期位置。 */
  const commitPoint = useCallback(
    (nextPoint: FloatingToolPanelPoint) => {
      positionRef.current = nextPoint;
      if (activeTool) {
        positionsRef.current[activeTool] = nextPoint;
      }
      setPosition((current) => (samePoint(current, nextPoint) ? current : nextPoint));
      const panel = panelRef.current;
      if (panel) {
        applyFloatingToolPanelPoint(panel, nextPoint);
      }
    },
    [activeTool, panelRef],
  );

  useLayoutEffect(() => {
    if (!enabled || !open) {
      return;
    }
    const panel = panelRef.current;
    if (!panel) {
      return;
    }
    const measurement = measureFloatingToolPanel(panel);
    const remembered = activeTool ? positionsRef.current[activeTool] : undefined;
    commitPoint(
      remembered
        ? clampFloatingToolPanelPoint(
            remembered,
            measurement.host,
            measurement.panel,
          )
        : resolveInitialFloatingToolPanelPoint(
            measurement.host,
            measurement.panel,
          ),
    );
  }, [activeTool, commitPoint, enabled, open, panelRef]);

  useEffect(() => {
    if (!enabled || !open) {
      return undefined;
    }
    const panel = panelRef.current;
    const host = panel?.parentElement;
    if (!panel || !host) {
      return undefined;
    }

    /** 窗口或内容尺寸变化后重新夹取坐标，保证标题栏和关闭按钮始终可达。 */
    const clampCurrentPoint = () => {
      const current = positionRef.current;
      if (!current) {
        return;
      }
      const measurement = measureFloatingToolPanel(panel);
      commitPoint(
        clampFloatingToolPanelPoint(
          current,
          measurement.host,
          measurement.panel,
        ),
      );
    };

    window.addEventListener("resize", clampCurrentPoint);
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(clampCurrentPoint);
    resizeObserver?.observe(host);
    resizeObserver?.observe(panel);
    return () => {
      window.removeEventListener("resize", clampCurrentPoint);
      resizeObserver?.disconnect();
    };
  }, [commitPoint, enabled, open, panelRef]);

  useEffect(
    () => () => {
      activeDragCleanupRef.current?.();
    },
    [],
  );

  /**
   * 左键从专用标题栏启动拖动；指针帧只更新 DOM transform，松开时才提交 React
   * 状态。窗口失焦提交当前位置，pointercancel 或 Escape 则恢复拖动前坐标。
   */
  const beginDrag = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      if (!enabled || !open || event.button !== 0) {
        return;
      }
      const panel = panelRef.current;
      if (!panel) {
        return;
      }
      activeDragCleanupRef.current?.();
      event.preventDefault();
      event.stopPropagation();

      const measurement = measureFloatingToolPanel(panel);
      const origin =
        positionRef.current ??
        resolveInitialFloatingToolPanelPoint(
          measurement.host,
          measurement.panel,
        );
      const pointerId = event.pointerId;
      const owner = event.currentTarget;
      const startX = event.clientX;
      const startY = event.clientY;
      let current = origin;
      let animationFrame: number | null = null;
      let stopped = false;
      panel.dataset.floatingToolPanelDragging = "true";

      if (typeof owner.setPointerCapture === "function") {
        try {
          owner.setPointerCapture(pointerId);
        } catch {
          // WebView2 可能在系统取消手势后拒绝 capture；窗口监听仍保证结束路径。
        }
      }

      /** 合并同一绘制帧内的高频坐标，直接更新合成层。 */
      const applyPreview = () => {
        animationFrame = null;
        applyFloatingToolPanelPoint(panel, current);
      };

      /** 计算并夹取相对 Shell 的下一坐标。 */
      const updatePoint = (clientX: number, clientY: number) => {
        const nextMeasurement = measureFloatingToolPanel(panel);
        current = clampFloatingToolPanelPoint(
          {
            x: origin.x + clientX - startX,
            y: origin.y + clientY - startY,
          },
          nextMeasurement.host,
          nextMeasurement.panel,
        );
        if (animationFrame === null) {
          animationFrame = window.requestAnimationFrame(applyPreview);
        }
      };

      /** 移除全局监听和 capture，避免松手或失焦后窗口继续粘住指针。 */
      const cleanup = () => {
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp);
        window.removeEventListener("pointercancel", handlePointerCancel);
        window.removeEventListener("blur", handleWindowBlur);
        window.removeEventListener("keydown", handleKeyDown);
        if (
          typeof owner.hasPointerCapture === "function" &&
          typeof owner.releasePointerCapture === "function" &&
          owner.hasPointerCapture(pointerId)
        ) {
          try {
            owner.releasePointerCapture(pointerId);
          } catch {
            // 系统可能已先释放 capture；全局监听已清理，不需要重复补偿。
          }
        }
        delete panel.dataset.floatingToolPanelDragging;
        activeDragCleanupRef.current = null;
      };

      /** 正常结束提交坐标，取消路径恢复原点；卸载清理时不再触发 React 更新。 */
      const stopDrag = (commit: boolean, updateReactState = true) => {
        if (stopped) {
          return;
        }
        stopped = true;
        if (animationFrame !== null) {
          window.cancelAnimationFrame(animationFrame);
          applyPreview();
        }
        cleanup();
        const finalPoint = commit ? current : origin;
        positionRef.current = finalPoint;
        if (activeTool) {
          positionsRef.current[activeTool] = finalPoint;
        }
        applyFloatingToolPanelPoint(panel, finalPoint);
        if (updateReactState) {
          setPosition(finalPoint);
        }
      };

      /** 只消费发起拖动的指针，主键丢失时按正常松手收口。 */
      function handlePointerMove(moveEvent: globalThis.PointerEvent) {
        if (moveEvent.pointerId !== pointerId) {
          return;
        }
        if (moveEvent.buttons === 0) {
          stopDrag(true);
          return;
        }
        if (moveEvent.cancelable) {
          moveEvent.preventDefault();
        }
        updatePoint(moveEvent.clientX, moveEvent.clientY);
      }

      /** pointerup 使用最后坐标后提交，避免最后一帧移动被丢弃。 */
      function handlePointerUp(upEvent: globalThis.PointerEvent) {
        if (upEvent.pointerId !== pointerId) {
          return;
        }
        updatePoint(upEvent.clientX, upEvent.clientY);
        stopDrag(true);
      }

      /** 系统取消手势时恢复拖动前位置，避免留下半完成状态。 */
      function handlePointerCancel(cancelEvent: globalThis.PointerEvent) {
        if (cancelEvent.pointerId === pointerId) {
          stopDrag(false);
        }
      }

      /** 切出应用时保留用户已经看到的位置，并结束捕获。 */
      function handleWindowBlur() {
        stopDrag(true);
      }

      /** Escape 是拖动专用撤销路径，不在拖动中关闭浮窗。 */
      function handleKeyDown(keyEvent: globalThis.KeyboardEvent) {
        if (keyEvent.key === "Escape") {
          keyEvent.preventDefault();
          keyEvent.stopPropagation();
          stopDrag(false);
        }
      }

      activeDragCleanupRef.current = () => stopDrag(false, false);
      window.addEventListener("pointermove", handlePointerMove, {
        passive: false,
      });
      window.addEventListener("pointerup", handlePointerUp);
      window.addEventListener("pointercancel", handlePointerCancel);
      window.addEventListener("blur", handleWindowBlur);
      window.addEventListener("keydown", handleKeyDown);
    },
    [activeTool, enabled, open, panelRef],
  );

  /** 标题栏获得焦点时支持方向键移动，Shift 提供更大的桌面步长。 */
  const moveWithKeyboard = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (
        !enabled ||
        !open ||
        !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
          event.key,
        )
      ) {
        return;
      }
      const panel = panelRef.current;
      if (!panel) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const measurement = measureFloatingToolPanel(panel);
      const current =
        positionRef.current ??
        resolveInitialFloatingToolPanelPoint(
          measurement.host,
          measurement.panel,
        );
      const step = event.shiftKey ? 40 : 12;
      const next = {
        x:
          current.x +
          (event.key === "ArrowLeft"
            ? -step
            : event.key === "ArrowRight"
              ? step
              : 0),
        y:
          current.y +
          (event.key === "ArrowUp"
            ? -step
            : event.key === "ArrowDown"
              ? step
              : 0),
      };
      commitPoint(
        clampFloatingToolPanelPoint(
          next,
          measurement.host,
          measurement.panel,
        ),
      );
    },
    [commitPoint, enabled, open, panelRef],
  );

  return {
    beginDrag,
    moveWithKeyboard,
    position,
    ready: !enabled || position !== null,
  };
}
