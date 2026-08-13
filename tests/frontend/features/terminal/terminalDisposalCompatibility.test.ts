// @author kongweiguang

import { Terminal, type ITerminalAddon } from "@xterm/xterm";
import { describe, expect, it, vi } from "vitest";
import { disposeXtermTerminal } from "../../../../src/features/terminal/terminalDisposalCompatibility";

describe("terminalDisposalCompatibility", () => {
  it.each(["browser", "linux", "macos", "windows"])(
    "uses the same public disposal contract on %s",
    () => {
      const order: string[] = [];
      const terminal = {
        element: { remove: vi.fn(() => order.push("dom-remove")) },
        dispose: vi.fn(() => order.push("terminal-dispose")),
      };
      const unregisterRenderer = vi.fn(() => order.push("coordinator-cleanup"));

      const result = disposeXtermTerminal(terminal, { unregisterRenderer });

      expect(result).toBeUndefined();
      expect(terminal.dispose).toHaveBeenCalledOnce();
      expect(unregisterRenderer).toHaveBeenCalledOnce();
      expect(order).toEqual([
        "terminal-dispose",
        "coordinator-cleanup",
        "dom-remove",
      ]);
    },
  );

  it("lets real xterm dispose core, listeners, DOM, and loaded addons before the coordinator", () => {
    type MediaListener = NonNullable<
      Parameters<MediaQueryList["addListener"]>[0]
    >;
    const mediaListeners: Array<{
      listener: MediaListener;
      removeListener: ReturnType<typeof vi.fn>;
    }> = [];
    vi.spyOn(window, "matchMedia").mockImplementation((query) => {
      const removeListener = vi.fn();
      return {
        addEventListener: vi.fn(),
        addListener: (listener) => {
          if (listener) {
            mediaListeners.push({ listener, removeListener });
          }
        },
        dispatchEvent: () => false,
        matches: false,
        media: query,
        onchange: null,
        removeEventListener: vi.fn(),
        removeListener,
      } as MediaQueryList;
    });
    const removeWindowListener = vi.spyOn(window, "removeEventListener");
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      measureText: vi.fn(() => ({ width: 10 })),
    } as unknown as CanvasRenderingContext2D);

    const terminal = new Terminal();
    const container = document.createElement("div");
    document.body.append(container);
    terminal.open(container);
    const order: string[] = [];
    const addonDisposed = vi.fn(() => order.push("addon-dispose"));
    const addon: ITerminalAddon = {
      activate: vi.fn(),
      dispose: addonDisposed,
    };
    terminal.loadAddon(addon);

    const terminalDispose = vi.spyOn(terminal, "dispose").mockImplementation(() => {
      order.push("terminal-dispose");
      Terminal.prototype.dispose.call(terminal);
    });
    const unregisterRenderer = vi.fn(() => order.push("coordinator-cleanup"));

    disposeXtermTerminal(terminal, { unregisterRenderer });

    expect(terminalDispose).toHaveBeenCalledOnce();
    expect(addonDisposed).toHaveBeenCalledOnce();
    expect(unregisterRenderer).toHaveBeenCalledOnce();
    expect(order).toEqual([
      "terminal-dispose",
      "addon-dispose",
      "coordinator-cleanup",
    ]);
    expect(mediaListeners).toHaveLength(1);
    expect(mediaListeners[0].removeListener).toHaveBeenCalledWith(
      mediaListeners[0].listener,
    );
    expect(removeWindowListener.mock.calls).toEqual(
      expect.arrayContaining([
        expect.arrayContaining(["resize", expect.any(Function)]),
      ]),
    );
    expect(container.querySelector(".xterm")).toBeNull();
    container.remove();
  });

  it("runs coordinator cleanup after terminal failure and rethrows its first error", () => {
    const terminalError = new Error("terminal dispose failed");
    const remove = vi.fn();
    const unregisterRenderer = vi.fn();

    const thrown = captureThrown(() =>
      disposeXtermTerminal(
        {
          element: { remove },
          dispose: () => {
            throw terminalError;
          },
        },
        { unregisterRenderer },
      ),
    );

    expect(thrown).toBe(terminalError);
    expect(unregisterRenderer).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledOnce();
  });

  it("runs terminal cleanup after coordinator failure and rethrows the coordinator error", () => {
    const coordinatorError = new Error("coordinator cleanup failed");
    const terminalDispose = vi.fn();
    const unregisterRenderer = vi.fn(() => {
      throw coordinatorError;
    });

    const thrown = captureThrown(() =>
      disposeXtermTerminal(
        { dispose: terminalDispose, element: { remove: vi.fn() } },
        { unregisterRenderer },
      ),
    );

    expect(thrown).toBe(coordinatorError);
    expect(terminalDispose).toHaveBeenCalledOnce();
  });

  it.each([undefined, null])(
    "does not swallow a first cleanup failure that throws %s",
    (firstError) => {
      const terminalDispose = vi.fn(() => {
        throw firstError;
      });
      const unregisterRenderer = vi.fn();

      const thrown = captureThrown(() =>
        disposeXtermTerminal(
          { dispose: terminalDispose, element: { remove: vi.fn() } },
          { unregisterRenderer },
        ),
      );

      expect(thrown).toBe(firstError);
      expect(unregisterRenderer).toHaveBeenCalledOnce();
    },
  );

  it("preserves the first error when both terminal and coordinator cleanup fail", () => {
    const terminalError = new Error("terminal first");
    const coordinatorError = new Error("coordinator second");
    const unregisterRenderer = vi.fn(() => {
      throw coordinatorError;
    });

    const thrown = captureThrown(() =>
      disposeXtermTerminal(
        {
          element: { remove: vi.fn() },
          dispose: () => {
            throw terminalError;
          },
        },
        { unregisterRenderer },
      ),
    );

    expect(thrown).toBe(terminalError);
    expect(unregisterRenderer).toHaveBeenCalledOnce();
  });
});

function captureThrown(action: () => void): unknown {
  try {
    action();
  } catch (error) {
    return error;
  }
  return undefined;
}
