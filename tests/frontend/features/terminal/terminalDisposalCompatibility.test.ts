// @author kongweiguang

import { describe, expect, it, vi } from "vitest";
import {
  XTERM_DESKTOP_WEBVIEW_DISPOSE_BROKEN_VERSION,
  disposeXtermTerminal,
  shouldUseDesktopWebViewGcFallback,
} from "../../../../src/features/terminal/terminalDisposalCompatibility";

const BROKEN_VERSION = XTERM_DESKTOP_WEBVIEW_DISPOSE_BROKEN_VERSION;
const HEALTHY_VERSION = "6.1.0";

describe("terminalDisposalCompatibility", () => {
  describe.each([
    { desktopPlatform: "windows" as const, xtermVersion: BROKEN_VERSION },
    { desktopPlatform: "macos" as const, xtermVersion: BROKEN_VERSION },
  ])(
    "uses desktop-webview GC fallback for %o",
    (environment) => {
      it("detaches the terminal element without invoking dispose()", () => {
        const element = document.createElement("div");
        document.body.append(element);
        const terminal = {
          dispose: vi.fn(),
          element,
        };

        const mode = disposeXtermTerminal(terminal, environment);

        expect(mode).toBe("desktop-webview-gc-fallback");
        expect(terminal.dispose).not.toHaveBeenCalled();
        expect(element.isConnected).toBe(false);
      });

      it("flags the environment as needing the GC fallback", () => {
        expect(shouldUseDesktopWebViewGcFallback(environment)).toBe(true);
      });
    },
  );

  describe.each([
    { desktopPlatform: "browser" as const, xtermVersion: BROKEN_VERSION },
    { desktopPlatform: "linux" as const, xtermVersion: BROKEN_VERSION },
    { desktopPlatform: "windows" as const, xtermVersion: HEALTHY_VERSION },
    { desktopPlatform: "macos" as const, xtermVersion: HEALTHY_VERSION },
    { desktopPlatform: "browser" as const, xtermVersion: HEALTHY_VERSION },
    { desktopPlatform: "linux" as const, xtermVersion: HEALTHY_VERSION },
  ])(
    "keeps the public dispose contract for %o",
    (environment) => {
      it("invokes terminal.dispose() and reports public-dispose", () => {
        const terminal = { dispose: vi.fn() };

        const mode = disposeXtermTerminal(terminal, environment);

        expect(mode).toBe("public-dispose");
        expect(terminal.dispose).toHaveBeenCalledOnce();
      });

      it("does not flag the environment as needing the GC fallback", () => {
        expect(shouldUseDesktopWebViewGcFallback(environment)).toBe(false);
      });
    },
  );
});
