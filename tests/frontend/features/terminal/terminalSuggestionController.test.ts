import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CommandSuggestionCandidate } from "../../../../src/lib/terminalSuggestionApi";
import { TerminalSuggestionCache } from "../../../../src/features/terminal/terminalSuggestionCache";
import { TerminalSuggestionController } from "../../../../src/features/terminal/terminalSuggestionController";
import { DEFAULT_TERMINAL_SUGGESTION_LIFECYCLE } from "../../../../src/features/terminal/terminalSuggestionModel";

describe("TerminalSuggestionController", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows a cache hit synchronously with zero immediate IPC", () => {
    const cache = new TerminalSuggestionCache();
    cache.put({
      candidates: [candidate()],
      contextKey: "local:/workspace:pwsh",
      cursor: 3,
      input: "git",
      mode: "inline",
      now: Date.now(),
      paneId: "pane-a",
    });
    const requestSuggestions = vi.fn().mockResolvedValue([]);
    const controller = new TerminalSuggestionController({
      cache,
      paneId: "pane-a",
      requestSuggestions,
    });

    controller.update(input());

    expect(controller.getSnapshot().inlineSuffix).toBe(" status --short");
    expect(requestSuggestions).not.toHaveBeenCalled();
  });

  it("keeps one in-flight request and coalesces to the latest pending input", async () => {
    const first = deferred<readonly ReturnType<typeof candidate>[]>();
    const requestSuggestions = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce([candidate({ replacementRange: { start: 0, end: 5 } })]);
    const controller = new TerminalSuggestionController({
      debounceMs: 10,
      paneId: "pane-a",
      requestSuggestions,
    });

    controller.update(input());
    await vi.advanceTimersByTimeAsync(10);
    controller.update(input({ cursor: 4, input: "git " }));
    controller.update(input({ cursor: 5, input: "git s" }));
    await vi.advanceTimersByTimeAsync(20);
    expect(requestSuggestions).toHaveBeenCalledTimes(1);

    first.resolve([candidate()]);
    await Promise.resolve();
    await vi.runAllTimersAsync();

    expect(requestSuggestions).toHaveBeenCalledTimes(2);
    expect(requestSuggestions.mock.calls[1]?.[0]).toMatchObject({
      cursor: 5,
      input: "git s",
    });
  });

  it("never exposes stale responses and isolates multiple panes", async () => {
    const stale = deferred<readonly ReturnType<typeof candidate>[]>();
    const cache = new TerminalSuggestionCache();
    const paneA = new TerminalSuggestionController({
      cache,
      debounceMs: 0,
      paneId: "pane-a",
      requestSuggestions: vi.fn().mockReturnValue(stale.promise),
    });
    const paneB = new TerminalSuggestionController({
      cache,
      debounceMs: 0,
      paneId: "pane-b",
      requestSuggestions: vi.fn().mockResolvedValue([candidate()]),
    });

    paneA.update(input());
    paneB.update(input());
    await vi.runAllTimersAsync();
    paneA.update(input({ cursor: 2, input: "ls" }));
    stale.resolve([candidate()]);
    await Promise.resolve();

    expect(paneA.getSnapshot().inlineCandidate).toBeNull();
    expect(paneB.getSnapshot().inlineSuffix).toBe(" status --short");
  });

  it("aborts timer/request and clears overlay on hidden or dispose", async () => {
    const pending = deferred<readonly ReturnType<typeof candidate>[]>();
    let signal: AbortSignal | undefined;
    const controller = new TerminalSuggestionController({
      debounceMs: 0,
      paneId: "pane-a",
      requestSuggestions: vi.fn((_query, requestSignal) => {
        signal = requestSignal;
        return pending.promise;
      }),
    });
    controller.update(input());
    await vi.runAllTimersAsync();
    controller.update(
      input({
        lifecycle: {
          ...input().lifecycle,
          hidden: true,
        },
      }),
    );

    expect(signal?.aborted).toBe(true);
    expect(controller.getSnapshot().phase).toBe("disabled");
    controller.dispose();
    expect(controller.getSnapshot().phase).toBe("disposed");
  });

  it("emits all, partial, and dismissed feedback distinctly", () => {
    const onFeedback = vi.fn();
    const cache = new TerminalSuggestionCache();
    cache.put({
      candidates: [candidate()],
      contextKey: "local:/workspace:pwsh",
      cursor: 3,
      input: "git",
      mode: "inline",
      now: Date.now(),
      paneId: "pane-a",
    });
    const controller = new TerminalSuggestionController({
      cache,
      onFeedback,
      paneId: "pane-a",
      requestSuggestions: vi.fn().mockResolvedValue([]),
    });
    controller.update(input());
    controller.accept("partial");
    expect(onFeedback).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: "partial" }),
    );

    controller.update(input());
    controller.accept("all");
    expect(onFeedback).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: "all" }),
    );

    controller.update(input());
    controller.dismiss();
    expect(onFeedback).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: "dismissed" }),
    );
  });

  it("cancels a scheduled refresh when the visible candidate is dismissed", async () => {
    const cache = new TerminalSuggestionCache();
    cache.put({
      candidates: [candidate()],
      contextKey: "local:/workspace:pwsh",
      cursor: 3,
      input: "git",
      mode: "inline",
      now: Date.now(),
      paneId: "pane-a",
    });
    const requestSuggestions = vi.fn().mockResolvedValue([]);
    const controller = new TerminalSuggestionController({
      cache,
      debounceMs: 50,
      paneId: "pane-a",
      requestSuggestions,
    });
    controller.update(input());
    controller.dismiss();
    await vi.advanceTimersByTimeAsync(50);

    expect(requestSuggestions).not.toHaveBeenCalled();
    expect(controller.getSnapshot().inlineCandidate).toBeNull();
  });

  it("clears lifecycle-invalidated candidates without recording a dismissal", () => {
    const onFeedback = vi.fn();
    const cache = new TerminalSuggestionCache();
    cache.put({
      candidates: [candidate()],
      contextKey: "local:/workspace:pwsh",
      cursor: 3,
      input: "git",
      mode: "inline",
      now: Date.now(),
      paneId: "pane-a",
    });
    const controller = new TerminalSuggestionController({
      cache,
      onFeedback,
      paneId: "pane-a",
      requestSuggestions: vi.fn().mockResolvedValue([]),
    });

    controller.update(input());
    controller.clear();

    expect(controller.getSnapshot().inlineCandidate).toBeNull();
    expect(onFeedback).not.toHaveBeenCalled();
  });
});

function candidate(
  overrides: Partial<CommandSuggestionCandidate> = {},
): CommandSuggestionCandidate {
  return {
    acceptBoundaries: [10, 17],
    allowedPresentations: ["inline", "menu"],
    displayText: "git status --short",
    id: "history:git-status",
    provider: "history",
    replacementRange: { end: 3, start: 0 },
    replacementText: "git status --short",
    score: 0.9,
    sensitivity: "normal",
    suffix: " status --short",
    ...overrides,
  };
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    contextKey: "local:/workspace:pwsh",
    cursor: 3,
    input: "git",
    lifecycle: { ...DEFAULT_TERMINAL_SUGGESTION_LIFECYCLE },
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}
