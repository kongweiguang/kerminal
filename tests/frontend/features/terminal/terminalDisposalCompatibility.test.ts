// @author kongweiguang

import { Terminal } from "@xterm/xterm";
import { describe, expect, it, vi } from "vitest";
import {
  disposeXtermTerminal,
  shouldUseWebView2GcFallback,
  XTERM_WEBVIEW2_DISPOSE_OOM_VERSION,
  type XtermTerminalDisposalEnvironment,
} from "../../../../src/features/terminal/terminalDisposalCompatibility";

const macosEnvironment: XtermTerminalDisposalEnvironment = {
  desktopPlatform: "macos",
  xtermVersion: XTERM_WEBVIEW2_DISPOSE_OOM_VERSION,
};

const windowsFallbackEnvironment: XtermTerminalDisposalEnvironment = {
  desktopPlatform: "windows",
  xtermVersion: XTERM_WEBVIEW2_DISPOSE_OOM_VERSION,
};

const windowsSafeEnvironment: XtermTerminalDisposalEnvironment = {
  desktopPlatform: "windows",
  xtermVersion: "6.1.0-beta.300",
};

describe("terminalDisposalCompatibility", () => {
  it("uses the complete public dispose sequence on macOS with the exact beta version", () => {
    runPublicDisposeSequenceAssertions(macosEnvironment);
  });

  it("uses the complete public dispose sequence on Windows with a non-problem version", () => {
    runPublicDisposeSequenceAssertions(windowsSafeEnvironment);
  });

  it("avoids terminal.dispose on the Windows WebView2 OOM version and lets the registry own the addon", () => {
    const order: string[] = [];
    const element = document.createElement("div");
    document.body.append(element);
    const removeSpy = vi.spyOn(element, "remove").mockImplementation(() => {
      order.push("element-remove");
      element.parentElement?.removeChild(element);
    });
    const rendererController = {
      dispose: vi.fn(() => {
        order.push("controller-regular-dispose");
      }),
    };
    const terminal = {
      dispose: vi.fn(() => {
        order.push("terminal-public-dispose");
      }),
      element,
    };
    const unregisterRenderer = vi.fn(() => {
      order.push("registry-unregister");
      // 模拟 registry 对仍未 disposed 的 controller 执行普通 dispose（释放 addon）。
      rendererController.dispose();
    });

    const mode = disposeXtermTerminal(
      terminal,
      { unregisterRenderer },
      windowsFallbackEnvironment,
    );

    expect(mode).toBe("webview2-gc-fallback");
    expect(rendererController.dispose).toHaveBeenCalledOnce();
    expect(terminal.dispose).not.toHaveBeenCalled();
    expect(unregisterRenderer).toHaveBeenCalledOnce();
    expect(removeSpy).toHaveBeenCalledOnce();
    expect(order).toEqual([
      "registry-unregister",
      "controller-regular-dispose",
      "element-remove",
    ]);
    expect(document.body.contains(element)).toBe(false);
  });

  it("unregisters the renderer before an xterm dispose failure reaches the caller", () => {
    const error = new Error("xterm dispose failed");
    const unregisterRenderer = vi.fn();

    expect(() =>
      disposeXtermTerminal(
        { dispose: () => { throw error; } },
        { unregisterRenderer },
        macosEnvironment,
      ),
    ).toThrow(error);
    expect(unregisterRenderer).toHaveBeenCalledOnce();
  });

  it("still disposes the terminal when unregister fails and surfaces the first error", () => {
    const unregisterError = new Error("registry unregister failed");
    const terminalDispose = vi.fn();
    const unregisterRenderer = vi.fn(() => {
      throw unregisterError;
    });

    expect(() =>
      disposeXtermTerminal(
        { dispose: terminalDispose },
        { unregisterRenderer },
        macosEnvironment,
      ),
    ).toThrow(unregisterError);
    expect(terminalDispose).toHaveBeenCalledOnce();
  });

  it("surfaces a fallback element-remove failure after unregister", () => {
    const removeError = new Error("element remove failed");
    const unregisterRenderer = vi.fn();
    const terminal = {
      dispose: vi.fn(),
      element: {
        remove: () => { throw removeError; },
      } as unknown as HTMLElement,
    };

    expect(() =>
      disposeXtermTerminal(
        terminal,
        { unregisterRenderer },
        windowsFallbackEnvironment,
      ),
    ).toThrow(removeError);
    expect(unregisterRenderer).toHaveBeenCalledOnce();
    expect(terminal.dispose).not.toHaveBeenCalled();
  });

  it("releases real xterm window resize and DPR media listeners through public dispose", () => {
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

    const mode = disposeXtermTerminal(
      terminal,
      { unregisterRenderer: vi.fn() },
      macosEnvironment,
    );

    expect(mode).toBe("public-dispose");
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
});

function runPublicDisposeSequenceAssertions(
  environment: XtermTerminalDisposalEnvironment,
) {
  const order: string[] = [];
  let addonDisposed = false;
  const addonDispose = vi.fn(() => {
    addonDisposed = true;
    order.push("xterm-addon-dispose");
  });
  const rendererController = {
    dispose: vi.fn(() => {
      order.push("controller-regular-dispose");
      addonDispose();
    }),
  };
  const terminal = {
    dispose: vi.fn(() => {
      expect(addonDisposed).toBe(true);
      order.push("terminal-public-dispose");
    }),
  };
  const unregisterRenderer = vi.fn(() => {
    order.push("registry-unregister");
    // registry cleanup 对仍可用的 controller 执行普通 dispose，完整释放 WebGL addon。
    rendererController.dispose();
  });

  const mode = disposeXtermTerminal(
    terminal,
    { unregisterRenderer },
    environment,
  );

  expect(mode).toBe("public-dispose");
  expect(shouldUseWebView2GcFallback(environment)).toBe(false);
  expect(unregisterRenderer).toHaveBeenCalledOnce();
  expect(rendererController.dispose).toHaveBeenCalledOnce();
  expect(addonDispose).toHaveBeenCalledOnce();
  expect(terminal.dispose).toHaveBeenCalledOnce();
  expect(order).toEqual([
    "registry-unregister",
    "controller-regular-dispose",
    "xterm-addon-dispose",
    "terminal-public-dispose",
  ]);
}
