// @author kongweiguang
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  discardForegroundRenderSettle,
  writeForegroundTerminalChunk,
} from "../../../../src/features/terminal/terminalForegroundRenderSettle";

function createTerminal() {
  return {
    _core: { refresh: vi.fn() },
    buffer: { active: { baseY: 10, viewportY: 10 } },
    refresh: vi.fn(),
    rows: 24,
    write: vi.fn((_data: string, callback?: () => void) => callback?.()),
  };
}

describe("terminalForegroundRenderSettle", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("synchronously refreshes all visible rows after protected output parses", () => {
    const terminal = createTerminal();

    writeForegroundTerminalChunk(terminal, "Codex repaint", {
      forceViewportRefresh: true,
    });

    expect(terminal._core.refresh).toHaveBeenCalledWith(0, 23, true);
    expect(terminal.refresh).not.toHaveBeenCalled();
  });

  it("repaints again on the next frame after a cursor restore", () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const terminal = createTerminal();

    writeForegroundTerminalChunk(terminal, "\x1b[?25l\x1b[13;4H\x1b[?25h", {
      followupViewportRefresh: true,
      forceViewportRefresh: true,
    });

    expect(terminal._core.refresh).toHaveBeenCalledTimes(1);
    expect(frames).toHaveLength(1);
    frames[0]?.(16);
    expect(terminal._core.refresh).toHaveBeenCalledTimes(2);
  });

  it("cancels a pending follow-up when the writer is disposed", () => {
    const frames: FrameRequestCallback[] = [];
    const cancel = vi.fn();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.push(callback);
      return 7;
    });
    vi.stubGlobal("cancelAnimationFrame", cancel);
    const terminal = createTerminal();

    writeForegroundTerminalChunk(terminal, "cursor restore", {
      followupViewportRefresh: true,
      forceViewportRefresh: true,
    });
    discardForegroundRenderSettle(terminal);

    expect(cancel).toHaveBeenCalledWith(7);
  });
});
