// @author kongweiguang

import { Terminal, type ITerminalAddon } from "@xterm/xterm";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createXtermAddonDisposalErrorState,
  disposeXtermTerminal,
  wrapXtermAddonForDisposal,
} from "../../../../src/features/terminal/terminalDisposalCompatibility";

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

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
        "coordinator-cleanup",
        "terminal-dispose",
        "dom-remove",
      ]);
    },
  );

  it("releases the renderer coordinator before real xterm core, listeners, DOM, and addons", () => {
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
    const unregisterRenderer = vi.fn(() => {
      order.push("coordinator-cleanup");
      addon.dispose();
    });

    disposeXtermTerminal(terminal, { unregisterRenderer });

    expect(terminalDispose).toHaveBeenCalledOnce();
    expect(addonDisposed).toHaveBeenCalledOnce();
    expect(unregisterRenderer).toHaveBeenCalledOnce();
    expect(order).toEqual([
      "coordinator-cleanup",
      "addon-dispose",
      "terminal-dispose",
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

  it("disposes one real xterm without detaching a sibling terminal", () => {
    installXtermBrowserStubs();
    const firstContainer = document.createElement("div");
    const secondContainer = document.createElement("div");
    document.body.append(firstContainer, secondContainer);
    const firstTerminal = new Terminal();
    const secondTerminal = new Terminal();
    firstTerminal.open(firstContainer);
    secondTerminal.open(secondContainer);

    disposeXtermTerminal(firstTerminal, { unregisterRenderer: vi.fn() });

    expect(firstContainer.querySelector(".xterm")).toBeNull();
    expect(secondContainer.querySelector(".xterm")).not.toBeNull();
    expect(() => secondTerminal.write("echo surviving sibling\r\n")).not.toThrow();

    disposeXtermTerminal(secondTerminal, { unregisterRenderer: vi.fn() });
    expect(secondContainer.querySelector(".xterm")).toBeNull();
  });

  it("continues coordinator and DOM cleanup after terminal failure", () => {
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

    expect(thrown).toEqual({ thrown: true, value: terminalError });
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

    expect(thrown).toEqual({ thrown: true, value: coordinatorError });
    expect(terminalDispose).toHaveBeenCalledOnce();
  });

  it.each([undefined, null])(
    "does not swallow a coordinator cleanup value that throws %s",
    (coordinatorError) => {
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

      expect(thrown).toEqual({ thrown: true, value: coordinatorError });
      expect(terminalDispose).toHaveBeenCalledOnce();
    },
  );

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

      expect(thrown).toEqual({ thrown: true, value: firstError });
      expect(unregisterRenderer).toHaveBeenCalledOnce();
    },
  );

  it("preserves the coordinator error when coordinator and terminal cleanup both fail", () => {
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

    expect(thrown).toEqual({ thrown: true, value: coordinatorError });
    expect(unregisterRenderer).toHaveBeenCalledOnce();
  });

  it.each([undefined, null, new Error("addon dispose failed")])(
    "isolates an addon disposal failure with value %s and still releases later addons",
    (addonError) => {
      installXtermBrowserStubs();
      const container = document.createElement("div");
      document.body.append(container);
      const terminal = new Terminal();
      terminal.open(container);
      const errors = createXtermAddonDisposalErrorState();
      const order: string[] = [];
      const firstAddonDispose = vi.fn(() => order.push("first-addon"));
      const secondAddonDispose = vi.fn(() => {
        order.push("second-addon");
        throw addonError;
      });
      const firstAddon: ITerminalAddon = {
        activate: vi.fn(),
        dispose: firstAddonDispose,
      };
      const secondAddon: ITerminalAddon = {
        activate: vi.fn(),
        dispose: secondAddonDispose,
      };
      terminal.loadAddon(wrapXtermAddonForDisposal(firstAddon, errors));
      terminal.loadAddon(wrapXtermAddonForDisposal(secondAddon, errors));
      const unregisterRenderer = vi.fn(() => order.push("coordinator"));

      const thrown = captureThrown(() =>
        disposeXtermTerminal(terminal, { unregisterRenderer }, errors),
      );

      expect(thrown).toEqual({ thrown: true, value: addonError });
      expect(order).toEqual([
        "coordinator",
        "second-addon",
        "first-addon",
      ]);
      expect(firstAddonDispose).toHaveBeenCalledOnce();
      expect(secondAddonDispose).toHaveBeenCalledOnce();
      expect(unregisterRenderer).toHaveBeenCalledOnce();
      container.remove();
    },
  );

  it.each([undefined, null])(
    "keeps the coordinator value when coordinator and DOM cleanup also throw %s",
    (addonError) => {
      const coordinatorError = new Error("coordinator second");
      const domError = new Error("dom third");
      const errors = createXtermAddonDisposalErrorState();
      errors.hasFirstError = true;
      errors.firstError = addonError;
      const remove = vi.fn(() => {
        throw domError;
      });
      const unregisterRenderer = vi.fn(() => {
        throw coordinatorError;
      });

      const thrown = captureThrown(() =>
        disposeXtermTerminal(
          { dispose: vi.fn(), element: { remove } },
          { unregisterRenderer },
          errors,
        ),
      );

      expect(thrown).toEqual({ thrown: true, value: coordinatorError });
      expect(unregisterRenderer).toHaveBeenCalledOnce();
      expect(remove).toHaveBeenCalledOnce();
    },
  );

  it("keeps coordinator failure ahead of terminal and addon failures", () => {
    const terminalError = new Error("terminal first");
    const coordinatorError = new Error("coordinator second");
    const errors = createXtermAddonDisposalErrorState();
    errors.hasFirstError = true;
    errors.firstError = new Error("addon later");
    const unregisterRenderer = vi.fn(() => {
      throw coordinatorError;
    });

    const thrown = captureThrown(() =>
      disposeXtermTerminal(
        {
          dispose: () => {
            throw terminalError;
          },
          element: { remove: vi.fn() },
        },
        { unregisterRenderer },
        errors,
      ),
    );

    expect(thrown).toEqual({ thrown: true, value: coordinatorError });
    expect(unregisterRenderer).toHaveBeenCalledOnce();
  });

  it("replays owned addons when core disposal throws before AddonManager", () => {
    const coreError = new Error("core dispose failed");
    const addonDispose = vi.fn();
    const addon: ITerminalAddon = { activate: vi.fn(), dispose: addonDispose };
    const errors = createXtermAddonDisposalErrorState();
    wrapXtermAddonForDisposal(addon, errors);
    const unregisterRenderer = vi.fn();

    const thrown = captureThrown(() =>
      disposeXtermTerminal(
        { dispose: () => { throw coreError; }, element: { remove: vi.fn() } },
        { unregisterRenderer },
        errors,
      ),
    );

    expect(thrown).toEqual({ thrown: true, value: coreError });
    expect(addonDispose).toHaveBeenCalledOnce();
    expect(unregisterRenderer).toHaveBeenCalledOnce();
  });

  it("makes an addon ownership wrapper idempotent", () => {
    const errors = createXtermAddonDisposalErrorState();
    const addonDispose = vi.fn(() => {
      throw new Error("one addon failure");
    });
    const addon: ITerminalAddon = {
      activate: vi.fn(),
      dispose: addonDispose,
    };
    const wrapped = wrapXtermAddonForDisposal(addon, errors);

    wrapped.dispose();
    wrapped.dispose();

    expect(addonDispose).toHaveBeenCalledOnce();
    expect(errors.hasFirstError).toBe(true);
    expect(errors.firstError).toBeInstanceOf(Error);
  });

  it("treats an addon without an optional dispose callback as an idempotent no-op", () => {
    const errors = createXtermAddonDisposalErrorState();
    const addon = { activate: vi.fn() } as unknown as ITerminalAddon;
    const wrapped = wrapXtermAddonForDisposal(addon, errors);

    wrapped.dispose?.();
    wrapped.dispose?.();

    expect(errors.hasFirstError).toBe(false);
    expect(errors.ownedAddons).toEqual([addon]);
  });
});

/** 用显式标记区分“没有抛出”和合法的 `throw undefined`/`throw null`。 */
function captureThrown(action: () => void): {
  thrown: boolean;
  value: unknown;
} {
  try {
    action();
  } catch (error) {
    return { thrown: true, value: error };
  }
  return { thrown: false, value: undefined };
}

/**
 * xterm 在 jsdom 中仍会走真实的 canvas/media 依赖；只在测试边界补足浏览器
 * 原语，避免把生产 disposal 顺序替换成假 Terminal 或手工 remove。
 */
function installXtermBrowserStubs() {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    measureText: vi.fn(() => ({ width: 10 })),
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(window, "matchMedia").mockImplementation((query) => {
    const removeListener = vi.fn();
    return {
      addEventListener: vi.fn(),
      addListener: vi.fn(),
      dispatchEvent: () => false,
      matches: false,
      media: query,
      onchange: null,
      removeEventListener: vi.fn(),
      removeListener,
    } as MediaQueryList;
  });
}
