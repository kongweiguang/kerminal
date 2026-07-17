/**
 * @author kongweiguang
 */

import { describe, expect, it, vi } from "vitest";
import {
  createTerminalSessionOutputController,
  terminalControlSequenceRequiresImmediateResponse,
} from "../../../../src/features/terminal/terminalSessionOutputController";

function createHarness(
  overrides: {
    current?: boolean;
    remote?: boolean;
    remoteCwdTracking?: boolean;
  } = {},
) {
  const order: string[] = [];
  const onAgentSignal = vi.fn();
  const onReadError = vi.fn();
  const onSessionClosed = vi.fn();
  const outputWriter = {
    dispose: vi.fn(),
    flush: vi.fn(),
    pendingLength: vi.fn(() => 0),
    setCadence: vi.fn((cadence: string) => order.push(`cadence:${cadence}`)),
    setTuiCursorProtection: vi.fn((active: boolean) =>
      order.push(`protect:${active}`),
    ),
    stats: vi.fn(),
    write: vi.fn((data: string) => order.push(`write:${data}`)),
    writeNow: vi.fn((data: string) => order.push(`now:${data}`)),
  };
  const onCurrentCwd = vi.fn();
  const controller = createTerminalSessionOutputController({
    activityRuntime: { markOutput: () => order.push("activity") },
    artifactRuntime: { queueOutput: () => order.push("artifact") },
    assistEnabled: true,
    commandBlockRuntime: {
      appendShellIntegrationCommandOutput: () => order.push("command"),
    },
    cwdTrackingBufferRef: { current: "" },
    focusedRef: { current: true },
    hasRemoteTerminalTarget: overrides.remote ?? true,
    initialRemoteOutputGate: { shouldWriteNow: () => true },
    instrumentation: null,
    isCurrent: () => overrides.current ?? true,
    isSshTerminalTarget: true,
    onAgentSignal,
    onCurrentCwd,
    onReadError,
    onSessionClosed,
    outputHistoryBuffer: {
      append: () => order.push("history"),
      dispose: vi.fn(),
      flush: vi.fn(),
      pendingFlush: vi.fn(() => false),
      stats: vi.fn(),
    },
    outputWriter,
    remoteCwdTracking: overrides.remoteCwdTracking ?? false,
    sshFailureTracker: { append: () => order.push("ssh") },
    transientStartupNoticeVisible: true,
    visibleRef: { current: true },
  });
  return {
    controller,
    onAgentSignal,
    onCurrentCwd,
    onReadError,
    onSessionClosed,
    order,
  };
}

describe("terminalSessionOutputController", () => {
  it("rejects stale-generation output before every side effect", () => {
    const harness = createHarness({ current: false });

    harness.controller({ data: "late", kind: "data", sessionId: "old" });

    expect(harness.order).toEqual([]);
  });

  it("preserves startup-clear, output and history ordering", () => {
    const harness = createHarness();

    harness.controller({ data: "first", kind: "data", sessionId: "session-1" });
    harness.controller({ data: "second", kind: "data", sessionId: "session-1" });

    expect(harness.order).toEqual([
      "artifact",
      "activity",
      "ssh",
      "now:\x1b[1A\x1b[2K\r",
      "command",
      "now:first",
      "history",
      "artifact",
      "activity",
      "ssh",
      "command",
      "now:second",
      "history",
    ]);
  });

  it("uses hidden buffered cadence when the fast remote gate is inactive", () => {
    const harness = createHarness({ remote: false });
    const hiddenController = createTerminalSessionOutputController({
      activityRuntime: { markOutput: vi.fn() },
      artifactRuntime: { queueOutput: vi.fn() },
      assistEnabled: false,
      commandBlockRuntime: { appendShellIntegrationCommandOutput: vi.fn() },
      cwdTrackingBufferRef: { current: "" },
      focusedRef: { current: false },
      hasRemoteTerminalTarget: false,
      initialRemoteOutputGate: { shouldWriteNow: vi.fn(() => false) },
      instrumentation: null,
      isCurrent: () => true,
      isSshTerminalTarget: false,
      onAgentSignal: vi.fn(),
      onCurrentCwd: vi.fn(),
      onReadError: vi.fn(),
      onSessionClosed: vi.fn(),
      outputHistoryBuffer: {
        append: vi.fn(),
        dispose: vi.fn(),
        flush: vi.fn(),
        pendingFlush: vi.fn(() => false),
        stats: vi.fn(),
      },
      outputWriter: {
        dispose: vi.fn(),
        flush: vi.fn(),
        pendingLength: vi.fn(() => 0),
        setCadence: (cadence) => harness.order.push(`cadence:${cadence}`),
        stats: vi.fn(),
        write: (data) => harness.order.push(`write:${data}`),
        writeNow: vi.fn(),
      },
      remoteCwdTracking: false,
      sshFailureTracker: { append: vi.fn() },
      transientStartupNoticeVisible: false,
      visibleRef: { current: false },
    });

    hiddenController({ data: "buffered", kind: "data", sessionId: "session-1" });

    expect(harness.order).toEqual(["cadence:hidden", "write:buffered"]);
  });

  it("routes terminal capability probes through the immediate writer path", () => {
    expect(
      terminalControlSequenceRequiresImmediateResponse("\x1b[6n"),
    ).toBe(true);
    expect(
      terminalControlSequenceRequiresImmediateResponse(
        "\x1b]10;?\x1b\\\x1b]11;?\x1b\\",
      ),
    ).toBe(true);
    expect(
      terminalControlSequenceRequiresImmediateResponse(
        "\x1b[?2026hstreaming response\x1b[?2026l",
      ),
    ).toBe(false);

    const harness = createHarness({ remote: false });
    harness.controller({
      data: "\x1b]10;?\x1b\\\x1b]11;?\x1b\\",
      kind: "data",
      sessionId: "session-1",
    });

    expect(harness.order).toContain("now:\x1b]10;?\x1b\\\x1b]11;?\x1b\\");
    expect(harness.order).not.toContain(
      "write:\x1b]10;?\x1b\\\x1b]11;?\x1b\\",
    );

    const splitHarness = createHarness({ remote: false });
    splitHarness.controller({
      data: "\x1b]10;",
      kind: "data",
      sessionId: "session-1",
    });
    splitHarness.controller({
      data: "?\x1b\\",
      kind: "data",
      sessionId: "session-1",
    });
    expect(splitHarness.order).toContain("write:\x1b]10;");
    expect(splitHarness.order).toContain("now:?\x1b\\");

    harness.controller({
      data: "streaming response",
      kind: "data",
      sessionId: "session-1",
    });
    expect(harness.order).toContain("write:streaming response");
    expect(harness.order).not.toContain("now:streaming response");
  });

  it("protects Agent TUI cursor frames and restores shell buffering on exit", () => {
    const harness = createHarness({ remote: false });

    harness.controller({
      agentSignal: {
        agent: "codex",
        status: "working",
        terminalSessionId: "session-1",
      },
      data: "",
      kind: "agentSignal",
      sessionId: "session-1",
    });
    harness.controller({
      data: "\x1b[?2026hframe\x1b[?2026l",
      kind: "data",
      sessionId: "session-1",
    });

    expect(harness.order).toContain("protect:true");
    expect(harness.order).toContain("write:\x1b[?2026hframe\x1b[?2026l");
    expect(harness.order).not.toContain("now:\x1b[?2026hframe\x1b[?2026l");

    harness.controller({
      agentSignal: {
        agent: "codex",
        status: "exited",
        terminalSessionId: "session-1",
      },
      data: "",
      kind: "agentSignal",
      sessionId: "session-1",
    });
    harness.controller({
      data: "shell output",
      kind: "data",
      sessionId: "session-1",
    });

    expect(harness.order).toContain("write:shell output");
    expect(harness.order).not.toContain("now:shell output");
    expect(harness.order).toContain("protect:false");
  });

  it("routes agent, closed and read-error events without cross-calling", () => {
    const harness = createHarness();
    const signal = {
      agent: "codex" as const,
      status: "working" as const,
      terminalSessionId: "session-1",
    };

    harness.controller({ agentSignal: signal, data: "", kind: "agentSignal", sessionId: "session-1" });
    harness.controller({ data: "", kind: "closed", sessionId: "session-1" });
    harness.controller({ data: "failed", kind: "error", sessionId: "session-1" });

    expect(harness.onAgentSignal).toHaveBeenCalledWith(signal);
    expect(harness.onSessionClosed).toHaveBeenCalledWith("session-1");
    expect(harness.onReadError).toHaveBeenCalledWith(
      expect.objectContaining({ data: "failed", kind: "error" }),
    );
  });

  it("does not let prompt heuristics override an established cwd protocol", () => {
    const harness = createHarness({ remoteCwdTracking: true });

    harness.controller({
      data: "\u001b]7;file://prod.internal/srv/app\u0007",
      kind: "data",
      sessionId: "session-1",
    });
    harness.controller({
      data: "\r\nroot@prod.internal:/stale# ",
      kind: "data",
      sessionId: "session-1",
    });

    expect(harness.onCurrentCwd).toHaveBeenCalledTimes(1);
    expect(harness.onCurrentCwd).toHaveBeenCalledWith("/srv/app");
  });
});
