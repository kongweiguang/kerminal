// @author kongweiguang

import { useEffect, useLayoutEffect, useState } from "react";
import type { TerminalPane } from "../workspace/contracts/index";

export interface TerminalRuntimePane {
  active: boolean;
  pane: TerminalPane;
  tabId: string;
}

export interface TerminalRuntimePaneRetirementEnvironment {
  scheduleAfterPaint(callback: () => void): () => void;
}

export interface TerminalRuntimePaneRetirementSchedulerOptions {
  cancelAnimationFrame?: (handle: number) => void;
  cancelTimeout: (handle: number) => void;
  isDocumentHidden: () => boolean;
  maxRetirementDelayMs?: number;
  requestAnimationFrame?: (callback: FrameRequestCallback) => number;
  setTimeout: (callback: () => void, delayMs: number) => number;
}

/** 隐藏或无 rAF 时直接使用的短延时，等价于约一帧。 */
const HIDDEN_RETIREMENT_DELAY_MS = 16;
/**
 * 可见路径的兜底上限：正常帧远快于此值，仅在 rAF 被暂停或绘制后任务被卡住时
 * 兜底触发，保证退休 runtime 不会无限存活。
 */
const DEFAULT_MAX_RETIREMENT_DELAY_MS = 250;

/**
 * 构造可确定测试的退休调度环境。可见时优先走 rAF + 绘制后 task，保证关闭后的
 * 标签视觉先完成一帧提交；文档隐藏或 rAF 缺失时直接走短 timer；可见路径同时
 * 挂一个最大延时 watchdog，确保 callback 至多执行一次。
 */
export function createTerminalRuntimePaneRetirementEnvironment(
  options: TerminalRuntimePaneRetirementSchedulerOptions,
): TerminalRuntimePaneRetirementEnvironment {
  const {
    cancelAnimationFrame = noopCancelAnimationFrame,
    cancelTimeout,
    isDocumentHidden,
    maxRetirementDelayMs = DEFAULT_MAX_RETIREMENT_DELAY_MS,
    requestAnimationFrame,
    setTimeout,
  } = options;

  return {
    scheduleAfterPaint(callback) {
      let cancelled = false;
      let done = false;
      let frameHandle: number | null = null;
      let taskHandle: number | null = null;
      let watchdogHandle: number | null = null;

      const clearHandles = () => {
        if (frameHandle !== null) {
          cancelAnimationFrame(frameHandle);
        }
        if (taskHandle !== null) {
          cancelTimeout(taskHandle);
        }
        if (watchdogHandle !== null) {
          cancelTimeout(watchdogHandle);
        }
        frameHandle = null;
        taskHandle = null;
        watchdogHandle = null;
      };

      const run = () => {
        if (cancelled || done) {
          return;
        }
        done = true;
        clearHandles();
        callback();
      };

      if (isDocumentHidden() || typeof requestAnimationFrame !== "function") {
        taskHandle = setTimeout(run, HIDDEN_RETIREMENT_DELAY_MS);
        return () => {
          cancelled = true;
          clearHandles();
        };
      }

      frameHandle = requestAnimationFrame(() => {
        frameHandle = null;
        // rAF 在绘制前运行；下一 task 才能保证关闭后的 UI 已先完成一帧提交。
        taskHandle = setTimeout(run, 0);
      });
      watchdogHandle = setTimeout(run, maxRetirementDelayMs);
      return () => {
        cancelled = true;
        clearHandles();
      };
    },
  };
}

const browserRetirementEnvironment = createTerminalRuntimePaneRetirementEnvironment({
  cancelAnimationFrame:
    typeof window.cancelAnimationFrame === "function"
      ? window.cancelAnimationFrame.bind(window)
      : noopCancelAnimationFrame,
  cancelTimeout: window.clearTimeout.bind(window),
  isDocumentHidden: () => document.visibilityState === "hidden",
  requestAnimationFrame:
    typeof window.requestAnimationFrame === "function"
      ? window.requestAnimationFrame.bind(window)
      : undefined,
  setTimeout: window.setTimeout.bind(window),
});

function noopCancelAnimationFrame(): void {
  // rAF 分支只有在调用方注入 requestAnimationFrame 后才可达，未注入时无需取消防帧。
}

/**
 * 让已从 workspace 状态删除的 runtime 多存活一帧，使标签视觉关闭不被资源析构阻塞。
 */
export function useTerminalRuntimePaneRetirement(
  currentPanes: TerminalRuntimePane[],
  environment: TerminalRuntimePaneRetirementEnvironment =
    browserRetirementEnvironment,
): TerminalRuntimePane[] {
  const [retainedPaneIds, setRetainedPaneIds] = useState(() =>
    currentPanes.map((runtimePane) => runtimePane.pane.id),
  );
  const [retainedPaneById, setRetainedPaneById] = useState(
    () =>
      new Map(
        currentPanes.map((runtimePane) => [runtimePane.pane.id, runtimePane]),
      ),
  );
  const currentPaneIdSnapshot = JSON.stringify(
    currentPanes.map((runtimePane) => runtimePane.pane.id),
  );
  const currentPaneIds = new Set(
    currentPanes.map((runtimePane) => runtimePane.pane.id),
  );
  const retiringPanes = retainedPaneIds.flatMap((paneId) => {
    if (currentPaneIds.has(paneId)) {
      return [];
    }
    const runtimePane = retainedPaneById.get(paneId);
    return runtimePane ? [{ ...runtimePane, active: false }] : [];
  });

  useLayoutEffect(() => {
    const snapshotChanged = currentPanes.some(
      (runtimePane) =>
        !terminalRuntimeRetirementSnapshotEqual(
          retainedPaneById.get(runtimePane.pane.id),
          runtimePane,
        ),
    );
    if (!snapshotChanged) {
      return;
    }

    setRetainedPaneById((retained) => {
      let next = retained;
      for (const runtimePane of currentPanes) {
        const paneId = runtimePane.pane.id;
        if (
          terminalRuntimeRetirementSnapshotEqual(
            retained.get(paneId),
            runtimePane,
          )
        ) {
          continue;
        }
        if (next === retained) {
          next = new Map(retained);
        }
        next.set(paneId, runtimePane);
      }
      return next;
    });
    // 同步登记新出现的 pane id，保证它在关闭后的下一帧仍能被识别为 retiring，
    // 而不是在第一次 after-paint 回调前就永久消失。
    setRetainedPaneIds((retained) => {
      let next = retained;
      for (const runtimePane of currentPanes) {
        const paneId = runtimePane.pane.id;
        if (retained.includes(paneId)) {
          continue;
        }
        if (next === retained) {
          next = [...retained];
        }
        next.push(paneId);
      }
      return next;
    });
  }, [currentPanes, retainedPaneById]);

  useEffect(() => {
    const nextPaneIds = JSON.parse(currentPaneIdSnapshot) as string[];
    return environment.scheduleAfterPaint(() => {
      const nextPaneIdSet = new Set(nextPaneIds);
      setRetainedPaneById((retained) => {
        let next = retained;
        for (const paneId of retained.keys()) {
          if (nextPaneIdSet.has(paneId)) {
            continue;
          }
          if (next === retained) {
            next = new Map(retained);
          }
          next.delete(paneId);
        }
        return next;
      });
      setRetainedPaneIds(nextPaneIds);
    });
  }, [currentPaneIdSnapshot, environment]);

  return [...currentPanes, ...retiringPanes];
}

/**
 * 退休帧只需要维持既有 runtime 的生命周期配置。输出历史、连接状态和预览行
 * 都不会重建 xterm，不能让这些高频字段反向触发一次同步 workspace 提交。
 */
function terminalRuntimeRetirementSnapshotEqual(
  retained: TerminalRuntimePane | undefined,
  current: TerminalRuntimePane,
): boolean {
  if (!retained) {
    return false;
  }

  const retainedPane = retained.pane;
  const currentPane = current.pane;
  return (
    retained.tabId === current.tabId &&
    retainedPane.id === currentPane.id &&
    retainedPane.title === currentPane.title &&
    retainedPane.machineId === currentPane.machineId &&
    retainedPane.mode === currentPane.mode &&
    retainedPane.target === currentPane.target &&
    retainedPane.remoteHostId === currentPane.remoteHostId &&
    retainedPane.containerId === currentPane.containerId &&
    retainedPane.profileId === currentPane.profileId &&
    retainedPane.shell === currentPane.shell &&
    retainedPane.args === currentPane.args &&
    retainedPane.cwd === currentPane.cwd &&
    retainedPane.currentCwd === currentPane.currentCwd &&
    retainedPane.env === currentPane.env &&
    retainedPane.remoteCommand === currentPane.remoteCommand &&
    retainedPane.tmuxBinding === currentPane.tmuxBinding
  );
}
