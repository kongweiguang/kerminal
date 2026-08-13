// @author kongweiguang

import { act, renderHook } from "@testing-library/react";
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
    expect(cancel).toHaveBeenCalledOnce();

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

  it("does not postpone retirement scheduling when pane details change", () => {
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

    expect(scheduleAfterPaint).toHaveBeenCalledOnce();
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
