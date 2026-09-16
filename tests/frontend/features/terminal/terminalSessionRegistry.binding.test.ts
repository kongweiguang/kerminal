// @author kongweiguang

import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerTerminalPaneSession } from "../../../../src/features/terminal/terminalSessionRegistry";
import { unregisterTestTerminalPaneSessions } from "../../support/terminalSessionRegistry.testSupport";

const registerTerminalSessionBindingMock = vi.hoisted(() => vi.fn());
const markTerminalSessionBindingReadyMock = vi.hoisted(() => vi.fn());
const closeTerminalSessionBindingMock = vi.hoisted(() => vi.fn());

vi.mock("../../../../src/lib/paneSessionTraceApi", () => ({
  closeTerminalSessionBinding: (...args: unknown[]) =>
    closeTerminalSessionBindingMock(...args),
  markTerminalSessionBindingReady: (...args: unknown[]) =>
    markTerminalSessionBindingReadyMock(...args),
  registerTerminalSessionBinding: (...args: unknown[]) =>
    registerTerminalSessionBindingMock(...args),
}));

describe("terminalSessionRegistry binding queue", () => {
  beforeEach(() => {
    unregisterTestTerminalPaneSessions();
    registerTerminalSessionBindingMock.mockReset();
    registerTerminalSessionBindingMock.mockResolvedValue(undefined);
    markTerminalSessionBindingReadyMock.mockReset();
    markTerminalSessionBindingReadyMock.mockResolvedValue(undefined);
    closeTerminalSessionBindingMock.mockReset();
    closeTerminalSessionBindingMock.mockResolvedValue(undefined);
  });

  it("serializes register before ready and retries a transient register failure", async () => {
    const calls: string[] = [];
    registerTerminalSessionBindingMock
      .mockImplementationOnce(async () => {
        calls.push("register-1");
        throw new Error("binding service warming up");
      })
      .mockImplementation(async () => {
        calls.push("register-2");
      });
    markTerminalSessionBindingReadyMock.mockImplementation(async () => {
      calls.push("ready");
    });

    registerTerminalPaneSession("pane-sequenced", "session-sequenced", {
      tabId: "tab-a",
    });

    await vi.waitFor(() =>
      expect(markTerminalSessionBindingReadyMock).toHaveBeenCalledTimes(1),
    );
    expect(calls).toEqual(["register-1", "register-2", "ready"]);
  });

  it("bounds failed binding registration and redacts warning context", async () => {
    const warning = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    registerTerminalSessionBindingMock.mockRejectedValue(
      new Error("binding targetToken=secret-token"),
    );

    try {
      registerTerminalPaneSession("pane-failing", "session-failing", {
        tabId: "tab-a",
        targetToken: "secret-token",
      });

      await vi.waitFor(() =>
        expect(registerTerminalSessionBindingMock).toHaveBeenCalledTimes(3),
      );
      expect(markTerminalSessionBindingReadyMock).not.toHaveBeenCalled();
      expect(warning).toHaveBeenCalledWith(
        "[Kerminal] terminal session binding operation failed",
        {
          attempts: 3,
          operation: "register",
          paneId: "pane-failing",
          sessionId: "session-failing",
        },
      );
      expect(JSON.stringify(warning.mock.calls)).not.toContain(
        "secret-token",
      );
    } finally {
      warning.mockRestore();
    }
  });
});
