// @author kongweiguang

import { useEffect, useLayoutEffect, useRef, useState } from "react";
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

interface PendingTerminalRuntimePaneRetirement {
  cancel: () => void;
  token: symbol;
}

/**
 * 让已从 workspace 状态删除的 runtime 多存活一帧，使标签视觉关闭不被资源析构阻塞；
 * 每个 pane 单独持有取消句柄，才能在同 ID 快速重开时阻止旧 callback 误删新 runtime。
 */
export function useTerminalRuntimePaneRetirement(
  currentPanes: TerminalRuntimePane[],
  environment: TerminalRuntimePaneRetirementEnvironment =
    browserRetirementEnvironment,
): TerminalRuntimePane[] {
  const [retainedPaneById, setRetainedPaneById] = useState(
    () =>
      new Map(
        currentPanes.map((runtimePane) => [runtimePane.pane.id, runtimePane]),
      ),
  );
  const retainedPaneByIdRef = useRef(retainedPaneById);
  const pendingRetirementsRef = useRef(
    new Map<string, PendingTerminalRuntimePaneRetirement>(),
  );
  const environmentRef = useRef(environment);
  const currentPaneIds = new Set(
    currentPanes.map((runtimePane) => runtimePane.pane.id),
  );
  const currentPaneIdsRef = useRef(currentPaneIds);
  const currentPaneIdSnapshot = JSON.stringify([...currentPaneIds]);

  const retiringPanes = [...retainedPaneById.values()].flatMap((runtimePane) =>
    currentPaneIds.has(runtimePane.pane.id)
      ? []
      : [{ ...runtimePane, active: false }],
  );

  useLayoutEffect(() => {
    let nextRetainedPaneById = retainedPaneById;
    for (const runtimePane of currentPanes) {
      const paneId = runtimePane.pane.id;
      if (
        terminalRuntimeRetirementSnapshotEqual(
          retainedPaneById.get(paneId),
          runtimePane,
        )
      ) {
        continue;
      }
      if (nextRetainedPaneById === retainedPaneById) {
        nextRetainedPaneById = new Map(retainedPaneById);
      }
      nextRetainedPaneById.set(paneId, runtimePane);
    }

    // 已调度 callback 只能读取已提交快照；否则中止 render 会让未出现的 pane 看似存活。
    retainedPaneByIdRef.current = nextRetainedPaneById;
    currentPaneIdsRef.current = new Set(
      currentPanes.map((runtimePane) => runtimePane.pane.id),
    );
    if (nextRetainedPaneById !== retainedPaneById) {
      setRetainedPaneById(nextRetainedPaneById);
    }
  }, [currentPanes, retainedPaneById]);

  useEffect(() => {
    const pendingRetirements = pendingRetirementsRef.current;
    const nextCurrentPaneIds = currentPaneIdsRef.current;
    const environmentChanged = environmentRef.current !== environment;
    if (environmentChanged) {
      // 调度器切换时旧环境可能不会再派发 callback，先取消其全部任务再迁移。
      for (const pending of pendingRetirements.values()) {
        pending.cancel();
      }
      pendingRetirements.clear();
      environmentRef.current = environment;
    }

    const schedule = (paneId: string) => {
      const token = Symbol(paneId);
      const pending: PendingTerminalRuntimePaneRetirement = {
        cancel: () => undefined,
        token,
      };
      pendingRetirements.set(paneId, pending);
      const cancel = environment.scheduleAfterPaint(() => {
        if (pendingRetirements.get(paneId)?.token !== token) {
          return;
        }
        pendingRetirements.delete(paneId);
        if (currentPaneIdsRef.current.has(paneId)) {
          return;
        }

        setRetainedPaneById((retained) => {
          if (!retained.has(paneId)) {
            return retained;
          }
          const next = new Map(retained);
          next.delete(paneId);
          return next;
        });
      });
      if (pendingRetirements.get(paneId)?.token === token) {
        pending.cancel = cancel;
      } else {
        // 防止测试调度器或宿主同步执行 callback 时遗留一个不可取消句柄。
        cancel();
      }
    };

    // 只取消重新出现的 pane；其它 pane 的任务继续独立等待，避免全局 ID 快照
    // 变化导致所有 runtime 同时重排退休时间。
    for (const paneId of nextCurrentPaneIds) {
      const pending = pendingRetirements.get(paneId);
      if (pending) {
        pending.cancel();
        pendingRetirements.delete(paneId);
      }
    }

    // 只为当前已不在 workspace 的 retained pane 调度退休，保证每个 pane 只有一个
    // callback；同 ID reopen 会在上面的循环中取消旧 callback 后重新成为当前 pane。
    for (const paneId of retainedPaneByIdRef.current.keys()) {
      if (nextCurrentPaneIds.has(paneId) || pendingRetirements.has(paneId)) {
        continue;
      }
      schedule(paneId);
    }
  }, [currentPaneIdSnapshot, environment, retainedPaneById]);

  useEffect(() => {
    const pendingRetirements = pendingRetirementsRef.current;
    return () => {
      // 组件卸载时取消所有未完成的退休任务，避免 callback 在新 workspace 中写入旧状态。
      for (const pending of pendingRetirements.values()) {
        pending.cancel();
      }
      pendingRetirements.clear();
    };
  }, []);

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
