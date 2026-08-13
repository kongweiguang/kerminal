// @author kongweiguang

import { act, render, renderHook } from "@testing-library/react";
import { Suspense } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  createTerminalRuntimePaneRetirementEnvironment,
  useTerminalRuntimePaneRetirement,
  type TerminalRuntimePane,
  type TerminalRuntimePaneRetirementEnvironment,
} from "../../../../src/features/terminal/useTerminalRuntimePaneRetirement";
import type { TerminalPane } from "../../../../src/features/workspace/types";

const pane: TerminalPane = {
  id: "pane-ssh-close",
  lines: [],
  machineId: "host-prod",
  mode: "ssh",
  prompt: "deploy@prod:~$",
  remoteHostId: "host-prod",
  status: "online",
  title: "生产 SSH",
};

const runtimePane: TerminalRuntimePane = {
  active: true,
  pane,
  tabId: "tab-ssh-close",
};

describe("useTerminalRuntimePaneRetirement", () => {
  it("retains a closed runtime invisibly until the first post-paint task", () => {
    let runAfterPaint: (() => void) | undefined;
    const cancel = vi.fn();
    const environment: TerminalRuntimePaneRetirementEnvironment = {
      scheduleAfterPaint(callback) {
        runAfterPaint = callback;
        return cancel;
      },
    };
    const { rerender, result } = renderHook(
      ({ panes }) =>
        useTerminalRuntimePaneRetirement(panes, environment),
      { initialProps: { panes: [runtimePane] } },
    );

    expect(result.current).toEqual([runtimePane]);

    rerender({ panes: [] });

    expect(result.current).toEqual([{ ...runtimePane, active: false }]);
    // 调度只在 pane 进入退休态时创建；初始打开态不会先挂一个全局 callback。
    expect(cancel).not.toHaveBeenCalled();

    act(() => runAfterPaint?.());

    expect(result.current).toEqual([]);
  });

  it("shows newly added runtimes immediately while an old runtime retires", () => {
    let runAfterPaint: (() => void) | undefined;
    const environment: TerminalRuntimePaneRetirementEnvironment = {
      scheduleAfterPaint(callback) {
        runAfterPaint = callback;
        return vi.fn();
      },
    };
    const nextRuntimePane: TerminalRuntimePane = {
      active: true,
      pane: { ...pane, id: "pane-next", title: "下一个终端" },
      tabId: "tab-next",
    };
    const { rerender, result } = renderHook(
      ({ panes }) =>
        useTerminalRuntimePaneRetirement(panes, environment),
      { initialProps: { panes: [runtimePane] } },
    );

    rerender({ panes: [nextRuntimePane] });

    expect(result.current).toEqual([
      nextRuntimePane,
      { ...runtimePane, active: false },
    ]);

    act(() => runAfterPaint?.());

    expect(result.current).toEqual([nextRuntimePane]);
  });

  it("does not schedule retirement when pane details change", () => {
    const scheduleAfterPaint = vi.fn(() => vi.fn());
    const environment: TerminalRuntimePaneRetirementEnvironment = {
      scheduleAfterPaint,
    };
    const { rerender } = renderHook(
      ({ panes }) =>
        useTerminalRuntimePaneRetirement(panes, environment),
      { initialProps: { panes: [runtimePane] } },
    );

    rerender({
      panes: [
        {
          ...runtimePane,
          pane: { ...runtimePane.pane, status: "offline" as const },
        },
      ],
    });

    expect(scheduleAfterPaint).not.toHaveBeenCalled();
  });

  it("does not add a synchronous render for output-history updates", () => {
    const environment: TerminalRuntimePaneRetirementEnvironment = {
      scheduleAfterPaint: () => vi.fn(),
    };
    let renderCount = 0;
    const { rerender } = renderHook(
      ({ panes }) => {
        renderCount += 1;
        return useTerminalRuntimePaneRetirement(panes, environment);
      },
      { initialProps: { panes: [runtimePane] } },
    );
    const renderCountBeforeUpdate = renderCount;

    rerender({
      panes: [
        {
          ...runtimePane,
          pane: { ...runtimePane.pane, outputHistory: "持续输出" },
        },
      ],
    });

    expect(renderCount).toBe(renderCountBeforeUpdate + 1);
  });

  it("retires the latest committed lifecycle details", () => {
    const environment: TerminalRuntimePaneRetirementEnvironment = {
      scheduleAfterPaint: () => vi.fn(),
    };
    const { rerender, result } = renderHook(
      ({ panes }) =>
        useTerminalRuntimePaneRetirement(panes, environment),
      { initialProps: { panes: [runtimePane] } },
    );
    const updatedRuntimePane: TerminalRuntimePane = {
      ...runtimePane,
      pane: { ...runtimePane.pane, currentCwd: "/srv/app" },
    };

    rerender({ panes: [updatedRuntimePane] });
    rerender({ panes: [] });

    expect(result.current).toEqual([
      { ...updatedRuntimePane, active: false },
    ]);
  });

  it("retires a pane added after mount when it closes before the first post-paint task", () => {
    let runAfterPaint: (() => void) | undefined;
    const environment: TerminalRuntimePaneRetirementEnvironment = {
      scheduleAfterPaint(callback) {
        runAfterPaint = callback;
        return vi.fn();
      },
    };
    const addedRuntimePane: TerminalRuntimePane = {
      active: true,
      pane: { ...pane, id: "pane-added", title: "新增终端" },
      tabId: "tab-added",
    };
    const { rerender, result } = renderHook(
      ({ panes }) =>
        useTerminalRuntimePaneRetirement(panes, environment),
      { initialProps: { panes: [] as TerminalRuntimePane[] } },
    );

    rerender({ panes: [addedRuntimePane] });
    expect(result.current).toEqual([addedRuntimePane]);

    rerender({ panes: [] });

    expect(result.current).toEqual([
      { ...addedRuntimePane, active: false },
    ]);

    act(() => runAfterPaint?.());
    expect(result.current).toEqual([]);
  });

  it("cancels a stale retirement when the same pane id reopens", () => {
    const callbacks: Array<() => void> = [];
    const cancels: Array<ReturnType<typeof vi.fn>> = [];
    const environment: TerminalRuntimePaneRetirementEnvironment = {
      scheduleAfterPaint(callback) {
        callbacks.push(callback);
        const cancel = vi.fn();
        cancels.push(cancel);
        return cancel;
      },
    };
    const reopenedRuntimePane: TerminalRuntimePane = {
      ...runtimePane,
      pane: { ...runtimePane.pane, title: "重新打开的 SSH" },
    };
    const { rerender, result } = renderHook(
      ({ panes }) => useTerminalRuntimePaneRetirement(panes, environment),
      { initialProps: { panes: [runtimePane] } },
    );

    rerender({ panes: [] });
    const staleRetirement = callbacks[callbacks.length - 1];
    expect(staleRetirement).toBeTypeOf("function");

    rerender({ panes: [reopenedRuntimePane] });
    act(() => staleRetirement?.());

    expect(result.current).toEqual([reopenedRuntimePane]);
    expect(cancels.some((cancel) => cancel.mock.calls.length > 0)).toBe(true);
  });

  it("does not accumulate pending callbacks across one hundred close and reopen cycles", () => {
    const callbacks = new Map<number, () => void>();
    const activeHandles = new Set<number>();
    let nextHandle = 0;
    const environment: TerminalRuntimePaneRetirementEnvironment = {
      scheduleAfterPaint(callback) {
        const handle = ++nextHandle;
        callbacks.set(handle, callback);
        activeHandles.add(handle);
        return () => {
          activeHandles.delete(handle);
          callbacks.delete(handle);
        };
      },
    };
    const { rerender, result } = renderHook(
      ({ panes }) => useTerminalRuntimePaneRetirement(panes, environment),
      { initialProps: { panes: [] as TerminalRuntimePane[] } },
    );

    for (let index = 0; index < 100; index += 1) {
      const cyclePane: TerminalRuntimePane = {
        ...runtimePane,
        pane: {
          ...runtimePane.pane,
          id: "pane-churn",
          title: `churn-${index}`,
        },
      };
      rerender({ panes: [cyclePane] });
      rerender({ panes: [] });

      const pendingHandles = [...activeHandles];
      const retirementHandle = pendingHandles[pendingHandles.length - 1];
      expect(retirementHandle).toBeDefined();
      const callback = callbacks.get(retirementHandle!);
      activeHandles.delete(retirementHandle!);
      callbacks.delete(retirementHandle!);
      act(() => callback?.());
    }

    expect(result.current).toEqual([]);
    expect(activeHandles.size).toBe(0);
    expect(callbacks.size).toBe(0);
  });

  it("cancels a pending retirement when the hook unmounts", () => {
    const cancel = vi.fn();
    const environment: TerminalRuntimePaneRetirementEnvironment = {
      scheduleAfterPaint: () => cancel,
    };
    const { rerender, unmount } = renderHook(
      ({ panes }) => useTerminalRuntimePaneRetirement(panes, environment),
      { initialProps: { panes: [runtimePane] } },
    );

    rerender({ panes: [] });
    unmount();

    expect(cancel).toHaveBeenCalledOnce();
  });

  it("keeps an aborted reopen from poisoning a committed retirement snapshot", () => {
    let runAfterPaint: (() => void) | undefined;
    const environment: TerminalRuntimePaneRetirementEnvironment = {
      scheduleAfterPaint(callback) {
        runAfterPaint = callback;
        return vi.fn();
      },
    };
    let resolveSuspension: (() => void) | undefined;
    const suspension = new Promise<void>((resolve) => {
      resolveSuspension = resolve;
    });

    /**
     * 用会在 commit 前挂起的 render 驱动已提交 callback，确保 speculative
     * pane 不会污染 lifecycle refs 并形成永久退休项。
     */
    function RetirementProbe({
      panes,
      suspend,
    }: {
      panes: TerminalRuntimePane[];
      suspend: boolean;
    }) {
      const runtimePanes = useTerminalRuntimePaneRetirement(panes, environment);
      if (suspend) {
        throw suspension;
      }
      return <output data-testid="runtime-pane-count">{runtimePanes.length}</output>;
    }

    const view = render(
      <Suspense fallback={<span data-testid="suspended" />}>
        <RetirementProbe panes={[runtimePane]} suspend={false} />
      </Suspense>,
    );

    view.rerender(
      <Suspense fallback={<span data-testid="suspended" />}>
        <RetirementProbe panes={[]} suspend={false} />
      </Suspense>,
    );
    expect(runAfterPaint).toBeTypeOf("function");

    view.rerender(
      <Suspense fallback={<span data-testid="suspended" />}>
        <RetirementProbe panes={[runtimePane]} suspend />
      </Suspense>,
    );
    expect(view.getByTestId("suspended")).toBeInTheDocument();

    act(() => runAfterPaint?.());
    act(() => resolveSuspension?.());
    view.rerender(
      <Suspense fallback={<span data-testid="suspended" />}>
        <RetirementProbe panes={[]} suspend={false} />
      </Suspense>,
    );

    expect(view.getByTestId("runtime-pane-count")).toHaveTextContent("0");
    view.unmount();
  });
});

describe("createTerminalRuntimePaneRetirementEnvironment", () => {
  it("schedules a visible retirement through rAF and a post-paint task", () => {
    const scheduler = createFakeRetirementScheduler();
    const callback = vi.fn();
    const environment = createTerminalRuntimePaneRetirementEnvironment({
      ...scheduler.dependencies(),
      isDocumentHidden: () => false,
    });

    const cancel = environment.scheduleAfterPaint(callback);

    expect(scheduler.requestAnimationFrame).toHaveBeenCalledOnce();
    expect(scheduler.setTimeout).toHaveBeenCalledTimes(1);

    scheduler.runRaf();
    expect(scheduler.setTimeout).toHaveBeenLastCalledWith(
      expect.any(Function),
      0,
    );

    scheduler.runTimeout();
    expect(callback).toHaveBeenCalledOnce();

    cancel();
    expect(callback).toHaveBeenCalledOnce();
  });

  it("uses a short timer directly when the document is hidden", () => {
    const scheduler = createFakeRetirementScheduler();
    const callback = vi.fn();
    const environment = createTerminalRuntimePaneRetirementEnvironment({
      ...scheduler.dependencies(),
      isDocumentHidden: () => true,
    });

    environment.scheduleAfterPaint(callback);

    expect(scheduler.requestAnimationFrame).not.toHaveBeenCalled();
    expect(scheduler.setTimeout).toHaveBeenCalledWith(
      expect.any(Function),
      16,
    );

    scheduler.runTimeout();
    expect(callback).toHaveBeenCalledOnce();
  });

  it("uses a short timer directly when rAF is unavailable", () => {
    const scheduler = createFakeRetirementScheduler();
    const callback = vi.fn();
    const environment = createTerminalRuntimePaneRetirementEnvironment({
      ...scheduler.dependencies(),
      isDocumentHidden: () => false,
      requestAnimationFrame: undefined,
    });

    environment.scheduleAfterPaint(callback);

    expect(scheduler.requestAnimationFrame).not.toHaveBeenCalled();
    scheduler.runTimeout();
    expect(callback).toHaveBeenCalledOnce();
  });

  it("fires the callback through the watchdog when rAF never fires", () => {
    const scheduler = createFakeRetirementScheduler();
    const callback = vi.fn();
    const environment = createTerminalRuntimePaneRetirementEnvironment({
      ...scheduler.dependencies(),
      isDocumentHidden: () => false,
      maxRetirementDelayMs: 100,
    });

    environment.scheduleAfterPaint(callback);
    expect(scheduler.setTimeout).toHaveBeenCalledWith(
      expect.any(Function),
      100,
    );

    scheduler.runTimeout();
    expect(callback).toHaveBeenCalledOnce();

    scheduler.runRaf();
    scheduler.runTimeout();
    expect(callback).toHaveBeenCalledOnce();
  });

  it("cancel prevents the callback even when handles fire later", () => {
    const scheduler = createFakeRetirementScheduler();
    const callback = vi.fn();
    const environment = createTerminalRuntimePaneRetirementEnvironment({
      ...scheduler.dependencies(),
      isDocumentHidden: () => false,
    });

    const cancel = environment.scheduleAfterPaint(callback);
    cancel();

    scheduler.runRaf();
    scheduler.runTimeout();
    expect(callback).not.toHaveBeenCalled();
    expect(scheduler.cancelAnimationFrame).toHaveBeenCalled();
  });
});

function createFakeRetirementScheduler() {
  const timeouts = new Map<number, { callback: () => void; delayMs: number }>();
  let nextTimeoutId = 1;
  let rafCallback: FrameRequestCallback | undefined;
  const setTimeout = vi.fn((callback: () => void, delayMs: number) => {
    const handle = nextTimeoutId++;
    timeouts.set(handle, { callback, delayMs });
    return handle;
  });
  const cancelTimeout = vi.fn((handle: number) => {
    timeouts.delete(handle);
  });
  const requestAnimationFrame = vi.fn(
    (callback: FrameRequestCallback) => {
      rafCallback = callback;
      return 1;
    },
  );
  const cancelAnimationFrame = vi.fn((handle: number) => {
    if (handle === 1) {
      rafCallback = undefined;
    }
  });

  return {
    cancelAnimationFrame,
    cancelTimeout,
    dependencies: () => ({
      cancelAnimationFrame,
      cancelTimeout,
      requestAnimationFrame,
      setTimeout,
    }),
    requestAnimationFrame,
    runRaf() {
      const callback = rafCallback;
      rafCallback = undefined;
      callback?.(16);
    },
    runTimeout() {
      let nextHandle: number | undefined;
      let nextDelayMs = Infinity;
      for (const [handle, entry] of timeouts) {
        if (entry.delayMs < nextDelayMs) {
          nextHandle = handle;
          nextDelayMs = entry.delayMs;
        }
      }
      if (nextHandle === undefined) {
        return;
      }
      const entry = timeouts.get(nextHandle);
      timeouts.delete(nextHandle);
      entry?.callback();
    },
    setTimeout,
  };
}
