// @author kongweiguang
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createTerminalOutputWriter,
  type TerminalOutputScheduler,
} from "../../../../src/features/terminal/terminalOutputWriter";

function createManualScheduler() {
  const callbacks = new Map<number, () => void>();
  let nextHandle = 1;
  const scheduler: TerminalOutputScheduler = {
    cancel: vi.fn((handle: number) => {
      callbacks.delete(handle);
    }),
    request: vi.fn((callback: () => void) => {
      const handle = nextHandle;
      nextHandle += 1;
      callbacks.set(handle, callback);
      return handle;
    }),
  };

  return {
    pendingCount: () => callbacks.size,
    runNext() {
      const next = callbacks.entries().next();
      if (next.done) {
        return false;
      }
      const [handle, callback] = next.value;
      callbacks.delete(handle);
      callback();
      return true;
    },
    scheduler,
  };
}

describe("terminalOutputWriter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("preserves the TUI native final cursor placement", () => {
    const terminal = {
      write: vi.fn((_data: string, callback?: () => void) => callback?.()),
    };
    const manual = createManualScheduler();
    const writer = createTerminalOutputWriter(terminal, {
      callbackMode: "required",
      scheduler: manual.scheduler,
    });
    writer.setTuiCursorProtection!(true);

    writer.write(
      "\x1b[?2026h\x1b[?25l\x1b[10;5HWorking\x1b[?25h\x1b[13;4H\x1b[?2026l",
    );
    manual.runNext();

    expect(terminal.write).toHaveBeenNthCalledWith(
      1,
      "\x1b[?2026h\x1b[?25l\x1b[10;5HWorking\x1b[13;4H\x1b[?25h\x1b[?2026l",
      expect.any(Function),
    );
  });

  it("keeps the pinned cursor hidden until a split synchronized frame closes", () => {
    const terminal = {
      write: vi.fn((_data: string, callback?: () => void) => callback?.()),
    };
    const manual = createManualScheduler();
    const writer = createTerminalOutputWriter(terminal, {
      callbackMode: "required",
      scheduler: manual.scheduler,
    });
    writer.setTuiCursorProtection!(true);

    writer.write(
      "\x1b[?2026h\x1b[?25l\x1b[10;5HWorking\x1b[?25h\x1b[13;4H",
    );
    manual.runNext();
    writer.write("\x1b[?2026l");
    manual.runNext();

    expect(terminal.write.mock.calls.map(([data]) => data)).toEqual([
      "\x1b[?2026h\x1b[?25l\x1b[10;5HWorking\x1b[13;4H\x1b[?25h",
      "\x1b[?2026l",
    ]);
  });

  it("settles a protected Codex frame through the real writer callback", () => {
    const parseCallbacks: Array<() => void> = [];
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const terminal = {
      _core: { refresh: vi.fn() },
      buffer: { active: { baseY: 0, viewportY: 0 } },
      rows: 14,
      write: vi.fn((_data: string, callback?: () => void) => {
        if (callback) {
          parseCallbacks.push(callback);
        }
      }),
    };
    const manual = createManualScheduler();
    const writer = createTerminalOutputWriter(terminal, {
      callbackMode: "required",
      scheduler: manual.scheduler,
    });
    writer.setTuiCursorProtection!(true);

    writer.write(
      "\x1b[?2026h\x1b[?25l\x1b[4;2HWorking\x1b[?2026l\x1b[13;4H\x1b[?25h",
    );
    manual.runNext();
    parseCallbacks.shift()?.();

    expect(terminal._core.refresh).toHaveBeenCalledWith(0, 13, true);
    expect(frames).toHaveLength(1);
    frames[0]?.(16);
    expect(terminal._core.refresh).toHaveBeenCalledTimes(2);
    writer.dispose();
  });

  it("automatically protects synchronized output without an Agent signal", () => {
    const terminal = { write: vi.fn() };
    const manual = createManualScheduler();
    const writer = createTerminalOutputWriter(terminal, {
      scheduler: manual.scheduler,
    });

    writer.write("\x1b[?2026h\x1b[?25l\x1b[4;2HWorking\x1b[?25h");
    writer.write("\x1b[?2026l");

    expect(terminal.write).not.toHaveBeenCalled();
    expect(manual.scheduler.request).toHaveBeenLastCalledWith(
      expect.any(Function),
      16,
    );

    writer.write("\x1b[13;4H\x1b[?25l\x1b[?25h");
    manual.runNext();

    expect(terminal.write).toHaveBeenCalledWith(
      "\x1b[?2026h\x1b[?25l\x1b[4;2HWorking\x1b[?2026l\x1b[13;4H\x1b[?25l\x1b[?25h",
    );
  });

  it("holds synchronized TUI frames and defers transient cursor shows", () => {
    const terminal = { write: vi.fn() };
    const manual = createManualScheduler();
    const writer = createTerminalOutputWriter(terminal, {
      scheduler: manual.scheduler,
    });
    writer.setTuiCursorProtection!(true);

    writer.write("\x1b[?2026h\x1b[?25l\x1b[10;5HWorking\x1b[?25h");

    expect(terminal.write).not.toHaveBeenCalled();
    expect(manual.scheduler.request).toHaveBeenLastCalledWith(
      expect.any(Function),
      32,
    );

    writer.write("\x1b[13;4H\x1b[?2026l");
    manual.runNext();

    expect(terminal.write).toHaveBeenCalledTimes(1);
    expect(terminal.write).toHaveBeenCalledWith(
      "\x1b[?2026h\x1b[?25l\x1b[10;5HWorking\x1b[13;4H\x1b[?25h\x1b[?2026l",
    );
  });

  it("coalesces a synchronized frame end with the next cursor restore chunk", () => {
    const terminal = { write: vi.fn() };
    const manual = createManualScheduler();
    const writer = createTerminalOutputWriter(terminal, {
      scheduler: manual.scheduler,
    });
    writer.setTuiCursorProtection!(true);

    writer.write("\x1b[?2026h\x1b[?25l\x1b[4;2HWorking\x1b[?25h");
    writer.write("\x1b[?2026l");

    expect(terminal.write).not.toHaveBeenCalled();
    expect(manual.scheduler.request).toHaveBeenLastCalledWith(
      expect.any(Function),
      16,
    );

    writer.write("\x1b[13;4H\x1b[?25l\x1b[?25h");
    manual.runNext();

    expect(terminal.write).toHaveBeenCalledTimes(1);
    expect(terminal.write).toHaveBeenCalledWith(
      "\x1b[?2026h\x1b[?25l\x1b[4;2HWorking\x1b[?2026l\x1b[13;4H\x1b[?25l\x1b[?25h",
    );
  });

  it("keeps post-frame cursor coalescing while an earlier write is in flight", () => {
    const callbacks: Array<() => void> = [];
    const terminal = {
      write: vi.fn((_data: string, callback?: () => void) => {
        if (callback) {
          callbacks.push(callback);
        }
      }),
    };
    const manual = createManualScheduler();
    const writer = createTerminalOutputWriter(terminal, {
      callbackMode: "required",
      scheduler: manual.scheduler,
    });
    writer.setTuiCursorProtection!(true);
    writer.write("earlier output");
    manual.runNext();

    writer.write(
      "\x1b[?2026h\x1b[?25l\x1b[4;2HWorking\x1b[?25h\x1b[?2026l",
    );
    expect(manual.pendingCount()).toBe(0);

    callbacks.shift()?.();
    expect(manual.scheduler.request).toHaveBeenLastCalledWith(
      expect.any(Function),
      16,
    );
    writer.write("\x1b[13;4H\x1b[?25l\x1b[?25h");
    manual.runNext();

    expect(terminal.write.mock.calls.map(([data]) => data)).toEqual([
      "earlier output",
      "\x1b[?2026h\x1b[?25l\x1b[4;2HWorking\x1b[?2026l\x1b[13;4H\x1b[?25l\x1b[?25h",
    ]);
  });

  it("safety-flushes an unclosed synchronized frame after 32ms", () => {
    const terminal = { write: vi.fn() };
    const manual = createManualScheduler();
    const writer = createTerminalOutputWriter(terminal, {
      scheduler: manual.scheduler,
    });
    writer.setTuiCursorProtection!(true);

    writer.write("\x1b[?2026hpartial frame");
    manual.runNext();

    expect(terminal.write).toHaveBeenCalledWith("\x1b[?2026hpartial frame");
  });

  it("releases a held synchronized frame when TUI protection is disabled", () => {
    const terminal = { write: vi.fn() };
    const manual = createManualScheduler();
    const writer = createTerminalOutputWriter(terminal, {
      scheduler: manual.scheduler,
    });
    writer.setTuiCursorProtection!(true);
    writer.write("\x1b[?2026hpartial frame");

    writer.setTuiCursorProtection!(false);
    manual.runNext();

    expect(terminal.write).toHaveBeenCalledWith("\x1b[?2026hpartial frame");
    expect(manual.scheduler.cancel).toHaveBeenCalledTimes(1);
  });

  it("detects synchronized frame delimiters split across PTY chunks", () => {
    const terminal = { write: vi.fn() };
    const manual = createManualScheduler();
    const writer = createTerminalOutputWriter(terminal, {
      scheduler: manual.scheduler,
    });
    writer.setTuiCursorProtection!(true);

    writer.write("before\x1b[?20");
    writer.write("26h\x1b[?25h\x1b[4;2Hinput\x1b[?202");
    expect(terminal.write).not.toHaveBeenCalled();
    writer.write("6l");
    manual.runNext();

    expect(terminal.write).toHaveBeenCalledWith(
      "before\x1b[?2026h\x1b[4;2H\x1b[?25hinput\x1b[?2026l",
    );
  });

  it("does not alter ordinary output when TUI protection is disabled", () => {
    const terminal = { write: vi.fn() };
    const manual = createManualScheduler();
    const writer = createTerminalOutputWriter(terminal, {
      scheduler: manual.scheduler,
    });
    const output = "plain\x1b[?25h\x1b[3;2Hterminal output";

    writer.write(output);
    manual.runNext();

    expect(terminal.write).toHaveBeenCalledWith(output);
  });

  it("coalesces small output chunks into one xterm write per frame", () => {
    const terminal = { write: vi.fn() };
    const manual = createManualScheduler();
    const writer = createTerminalOutputWriter(terminal, {
      maxCharsPerFlush: 100,
      scheduler: manual.scheduler,
    });

    writer.write("hello ");
    writer.write("from ");
    writer.write("pty");

    expect(terminal.write).not.toHaveBeenCalled();
    expect(manual.scheduler.request).toHaveBeenCalledTimes(1);
    expect(writer.pendingLength()).toBe("hello from pty".length);
    expect(writer.stats()).toMatchObject({
      flushCount: 0,
      pendingBytes: "hello from pty".length,
      pendingChars: "hello from pty".length,
      pendingChunks: 3,
    });

    manual.runNext();

    expect(terminal.write).toHaveBeenCalledTimes(1);
    expect(terminal.write).toHaveBeenCalledWith("hello from pty");
    expect(writer.pendingLength()).toBe(0);
    expect(manual.pendingCount()).toBe(0);
    expect(writer.stats()).toMatchObject({
      flushCount: 1,
      lastFlushChars: "hello from pty".length,
      pendingBytes: 0,
      pendingChars: 0,
      pendingChunks: 0,
      totalFlushChars: "hello from pty".length,
    });
  });

  it("splits large output across frames", () => {
    const terminal = { write: vi.fn() };
    const manual = createManualScheduler();
    const writer = createTerminalOutputWriter(terminal, {
      maxCharsPerFlush: 5,
      scheduler: manual.scheduler,
    });

    writer.write("abcdefghijkl");

    manual.runNext();
    expect(terminal.write).toHaveBeenLastCalledWith("abcde");
    expect(writer.pendingLength()).toBe(7);
    expect(writer.stats()).toMatchObject({
      flushCount: 1,
      pendingChunks: 1,
      splitFrameCount: 1,
    });

    manual.runNext();
    expect(terminal.write).toHaveBeenLastCalledWith("fghij");
    expect(writer.pendingLength()).toBe(2);

    manual.runNext();
    expect(terminal.write).toHaveBeenLastCalledWith("kl");
    expect(writer.pendingLength()).toBe(0);
    expect(terminal.write).toHaveBeenCalledTimes(3);
  });

  it("records flush duration and slow flush metrics without output text", () => {
    let now = 10;
    const terminal = {
      write: vi.fn(() => {
        now += 12;
      }),
    };
    const manual = createManualScheduler();
    const writer = createTerminalOutputWriter(terminal, {
      now: () => now,
      scheduler: manual.scheduler,
      slowFlushMs: 8,
    });

    writer.write("diagnostic output");
    manual.runNext();

    expect(writer.stats()).toMatchObject({
      flushCount: 1,
      lastFlushChars: "diagnostic output".length,
      lastFlushMs: 12,
      lastSlowFlushAt: 22,
      maxFlushMs: 12,
      slowFlushCount: 1,
      totalFlushChars: "diagnostic output".length,
    });
    expect(JSON.stringify(writer.stats())).not.toContain("diagnostic output");
  });

  it("preserves order while draining many queued chunks across frames", () => {
    const terminal = { write: vi.fn() };
    const manual = createManualScheduler();
    const writer = createTerminalOutputWriter(terminal, {
      maxCharsPerFlush: 100,
      scheduler: manual.scheduler,
    });
    const chunks = Array.from(
      { length: 250 },
      (_, index) => `${index.toString().padStart(3, "0")}|`,
    );

    for (const chunk of chunks) {
      writer.write(chunk);
    }

    while (manual.runNext()) {
      // Run all scheduled frames.
    }

    expect(terminal.write.mock.calls.map(([data]) => data).join("")).toBe(
      chunks.join(""),
    );
    expect(terminal.write).toHaveBeenCalledTimes(10);
    expect(writer.pendingLength()).toBe(0);
    expect(manual.pendingCount()).toBe(0);
  });

  it("flushes only the pending tail after a frame partially drains chunks", () => {
    const terminal = { write: vi.fn() };
    const manual = createManualScheduler();
    const writer = createTerminalOutputWriter(terminal, {
      maxCharsPerFlush: 5,
      scheduler: manual.scheduler,
    });

    writer.write("ab");
    writer.write("cd");
    writer.write("efgh");

    manual.runNext();
    writer.flush();

    expect(terminal.write).toHaveBeenNthCalledWith(1, "abcde");
    expect(terminal.write).toHaveBeenNthCalledWith(2, "fgh");
    expect(writer.pendingLength()).toBe(0);
    expect(manual.pendingCount()).toBe(0);
  });

  it("avoids splitting immediately after a high surrogate when batching", () => {
    const terminal = { write: vi.fn() };
    const manual = createManualScheduler();
    const writer = createTerminalOutputWriter(terminal, {
      maxCharsPerFlush: 3,
      scheduler: manual.scheduler,
    });

    writer.write("ab\uD83D\uDE00cd");

    manual.runNext();
    manual.runNext();
    manual.runNext();

    expect(terminal.write.mock.calls.map(([data]) => data)).toEqual([
      "ab",
      "\uD83D\uDE00c",
      "d",
    ]);
    expect(writer.pendingLength()).toBe(0);
  });

  it("keeps a surrogate pair intact when only one code unit remains", () => {
    const terminal = { write: vi.fn() };
    const manual = createManualScheduler();
    const writer = createTerminalOutputWriter(terminal, {
      maxCharsPerFlush: 3,
      scheduler: manual.scheduler,
    });

    writer.write("ab");
    writer.write("\uD83D\uDE00cd");

    manual.runNext();
    manual.runNext();
    manual.runNext();

    expect(terminal.write.mock.calls.map(([data]) => data)).toEqual([
      "ab",
      "\uD83D\uDE00c",
      "d",
    ]);
    expect(writer.pendingLength()).toBe(0);
  });

  it("flushes queued data before immediate status output", () => {
    const terminal = { write: vi.fn() };
    const manual = createManualScheduler();
    const writer = createTerminalOutputWriter(terminal, {
      scheduler: manual.scheduler,
    });

    writer.write("queued output");
    writer.writeNow("\r\n会话已结束。\r\n");

    expect(manual.scheduler.cancel).toHaveBeenCalledTimes(1);
    expect(terminal.write).toHaveBeenNthCalledWith(1, "queued output");
    expect(terminal.write).toHaveBeenNthCalledWith(2, "\r\n会话已结束。\r\n");
    expect(writer.pendingLength()).toBe(0);
    expect(manual.pendingCount()).toBe(0);
    expect(writer.stats()).toMatchObject({
      flushCount: 2,
      writeNowCount: 1,
    });
  });

  it("drops queued output and cancels scheduled work on dispose", () => {
    const terminal = { write: vi.fn() };
    const manual = createManualScheduler();
    const writer = createTerminalOutputWriter(terminal, {
      scheduler: manual.scheduler,
    });

    writer.write("queued output");
    writer.dispose();
    writer.write("late output");
    writer.writeNow("late status");
    manual.runNext();

    expect(manual.scheduler.cancel).toHaveBeenCalledTimes(1);
    expect(terminal.write).not.toHaveBeenCalled();
    expect(writer.pendingLength()).toBe(0);
  });

  it("keeps the writer alive when terminal.write rejects a batch synchronously", () => {
    const writeErrors: unknown[] = [];
    const terminal = {
      write: vi
        .fn()
        .mockImplementationOnce(() => {
          throw new Error("terminal write rejected");
        })
        .mockImplementation(() => undefined),
    };
    const manual = createManualScheduler();
    const writer = createTerminalOutputWriter(terminal, {
      onWriteError: (error) => writeErrors.push(error),
      scheduler: manual.scheduler,
    });

    writer.write("\u0000\u001b]bad-binary");
    manual.runNext();
    writer.write("after-binary");
    manual.runNext();

    expect(terminal.write).toHaveBeenCalledTimes(2);
    expect(terminal.write).toHaveBeenNthCalledWith(2, "after-binary");
    expect(writer.pendingLength()).toBe(0);
    expect(writeErrors).toHaveLength(1);
    expect(writer.stats()).toMatchObject({
      flushCount: 1,
      totalFlushChars: "after-binary".length,
      writeErrorCount: 1,
    });
  });

  it("keeps exactly one callback-aware xterm write in flight", () => {
    const callbacks: Array<() => void> = [];
    const terminal = {
      write: vi.fn((_data: string, callback?: () => void) => {
        if (callback) {
          callbacks.push(callback);
        }
      }),
    };
    const manual = createManualScheduler();
    const writer = createTerminalOutputWriter(terminal, {
      callbackMode: "required",
      initialCharsPerFlush: 4,
      maxCharsPerFlush: 4,
      minCharsPerFlush: 4,
      scheduler: manual.scheduler,
    });

    writer.write("abcdefgh");
    manual.runNext();

    expect(terminal.write).toHaveBeenCalledTimes(1);
    expect(terminal.write.mock.calls[0]?.[0]).toBe("abcd");
    expect(writer.stats().inFlight).toBe(true);
    expect(manual.pendingCount()).toBe(0);

    callbacks.shift()?.();

    expect(writer.stats().inFlight).toBe(false);
    expect(manual.pendingCount()).toBe(1);
    manual.runNext();
    expect(terminal.write.mock.calls[1]?.[0]).toBe("efgh");
  });

  it("adapts batch size with hysteresis inside configured bounds", () => {
    let now = 0;
    const callbacks: Array<() => void> = [];
    const terminal = {
      write: vi.fn((_data: string, callback?: () => void) => {
        if (callback) {
          callbacks.push(callback);
        }
      }),
    };
    const manual = createManualScheduler();
    const writer = createTerminalOutputWriter(terminal, {
      callbackMode: "required",
      initialCharsPerFlush: 16,
      maxCharsPerFlush: 16,
      minCharsPerFlush: 4,
      now: () => now,
      scheduler: manual.scheduler,
      targetWriteCallbackMs: 6,
    });

    for (let index = 0; index < 2; index += 1) {
      writer.write("x".repeat(16));
      manual.runNext();
      now += 10;
      callbacks.shift()?.();
    }

    expect(writer.stats()).toMatchObject({
      adaptationDecreaseCount: 1,
      currentCharsPerFlush: 12,
    });

    for (let index = 0; index < 2; index += 1) {
      writer.write("y".repeat(16));
      manual.runNext();
      now += 1;
      callbacks.shift()?.();
    }

    expect(writer.stats()).toMatchObject({
      adaptationIncreaseCount: 1,
      currentCharsPerFlush: 15,
    });
  });

  it("uses hidden cadence but accelerates when backlog crosses pressure threshold", () => {
    const terminal = { write: vi.fn() };
    const manual = createManualScheduler();
    const writer = createTerminalOutputWriter(terminal, {
      cadence: "hidden",
      scheduler: manual.scheduler,
    });

    writer.write("small");
    expect(manual.scheduler.request).toHaveBeenLastCalledWith(
      expect.any(Function),
      100,
    );

    writer.dispose();
    const pressured = createTerminalOutputWriter(terminal, {
      cadence: "hidden",
      scheduler: manual.scheduler,
    });
    pressured.write("x".repeat(256 * 1024));

    expect(manual.scheduler.request).toHaveBeenLastCalledWith(
      expect.any(Function),
      16,
    );
  });

  it("preserves writeNow ordering while an async write is in flight", () => {
    const callbacks: Array<() => void> = [];
    const terminal = {
      write: vi.fn((_data: string, callback?: () => void) => {
        if (callback) {
          callbacks.push(callback);
        }
      }),
    };
    const manual = createManualScheduler();
    const writer = createTerminalOutputWriter(terminal, {
      callbackMode: "required",
      scheduler: manual.scheduler,
    });

    writer.write("queued");
    writer.writeNow("status");

    expect(terminal.write.mock.calls.map(([data]) => data)).toEqual(["queued"]);

    callbacks.shift()?.();
    manual.runNext();

    expect(terminal.write.mock.calls.map(([data]) => data)).toEqual([
      "queued",
      "status",
    ]);
  });

  it("reports UTF-8 pending bytes without retaining output content", () => {
    const manual = createManualScheduler();
    const writer = createTerminalOutputWriter(
      { write: vi.fn() },
      { scheduler: manual.scheduler },
    );

    writer.write("终端");

    expect(writer.stats()).toMatchObject({
      pendingBytes: 6,
      pendingChars: 2,
    });
    expect(JSON.stringify(writer.stats())).not.toContain("终端");
  });
});
