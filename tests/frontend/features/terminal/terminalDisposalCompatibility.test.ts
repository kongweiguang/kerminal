// @author kongweiguang

import { describe, expect, it, vi } from "vitest";
import {
  XTERM_WEBVIEW2_DISPOSE_OOM_VERSION,
  disposeXtermTerminal,
  shouldUseWebView2GcFallback,
} from "../../../../src/features/terminal/terminalDisposalCompatibility";

describe("terminalDisposalCompatibility", () => {
  it("detaches the terminal without invoking the known-bad WebView2 dispose path", () => {
    const element = document.createElement("div");
    document.body.append(element);
    const terminal = {
      dispose: vi.fn(),
      element,
    };

    const mode = disposeXtermTerminal(terminal, {
      desktopPlatform: "windows",
      xtermVersion: XTERM_WEBVIEW2_DISPOSE_OOM_VERSION,
    });

    expect(mode).toBe("webview2-gc-fallback");
    expect(terminal.dispose).not.toHaveBeenCalled();
    expect(element.isConnected).toBe(false);
  });

  it.each([
    { desktopPlatform: "browser" as const, xtermVersion: XTERM_WEBVIEW2_DISPOSE_OOM_VERSION },
    { desktopPlatform: "linux" as const, xtermVersion: XTERM_WEBVIEW2_DISPOSE_OOM_VERSION },
    { desktopPlatform: "macos" as const, xtermVersion: XTERM_WEBVIEW2_DISPOSE_OOM_VERSION },
    { desktopPlatform: "windows" as const, xtermVersion: "6.1.0" },
  ])("uses public dispose outside the affected environment: %o", (environment) => {
    const terminal = { dispose: vi.fn() };

    const mode = disposeXtermTerminal(terminal, environment);

    expect(mode).toBe("public-dispose");
    expect(terminal.dispose).toHaveBeenCalledOnce();
    expect(shouldUseWebView2GcFallback(environment)).toBe(false);
  });
});
