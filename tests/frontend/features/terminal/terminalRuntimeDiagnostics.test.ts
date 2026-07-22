import { describe, expect, it } from "vitest";
import {
  createRuntimePerformanceSnapshot,
  createRuntimeTerminalOutputPaneSnapshot,
  evaluateRuntimeProductionReadinessGate,
  findRuntimePerformanceSnapshotSensitiveKeys,
  isSensitiveRuntimeDiagnosticsKey,
  RUNTIME_PERFORMANCE_SNAPSHOT_SCHEMA_VERSION,
  type RuntimePerformanceSnapshot,
} from "../../../../src/features/terminal/terminalRuntimeDiagnostics";

describe("terminalRuntimeDiagnostics", () => {
  it("creates a versioned runtime performance snapshot", () => {
    const snapshot = createRuntimePerformanceSnapshot({
      generatedAt: "2026-07-01T15:20:00.000Z",
      terminalRenderer: {
        activeControllers: 2,
        atlasEpoch: 0,
        effectiveGpuPanes: 1,
        hiddenControllers: 1,
        panes: [
          {
            backend: "gpu",
            canvasCount: 1,
            failureCount: 0,
            focused: true,
            paneId: "pane-1",
            recoveryCount: 0,
            visible: true,
          },
        ],
        recoveryCount: 0,
        requestedMode: "auto",
        webglCanvasCount: 1,
      },
      terminalOutput: {
        panes: [
          {
            coldSnapshotChars: 2048,
            droppedTailChars: 0,
            flushCount: 12,
            focused: true,
            historyFlushCount: 4,
            paneId: "pane-1",
            pendingBytes: 0,
            pendingChars: 0,
            pendingChunks: 0,
            runtimeWorkMode: "full",
            slowFlushCount: 0,
            storeUpdateCount: 3,
            tailChars: 4096,
            truncatedTail: false,
            visible: true,
            writerFlushCount: 8,
          },
        ],
        totalColdSnapshotChars: 2048,
        totalPendingBytes: 0,
      },
    });

    expect(snapshot.schemaVersion).toBe(
      RUNTIME_PERFORMANCE_SNAPSHOT_SCHEMA_VERSION,
    );
    expect(snapshot.generatedAt).toBe("2026-07-01T15:20:00.000Z");
    expect(snapshot.terminalRenderer?.effectiveGpuPanes).toBe(1);
    expect(findRuntimePerformanceSnapshotSensitiveKeys(snapshot)).toEqual([]);
  });

  it("builds terminal output pane snapshots from writer and history metrics", () => {
    const pane = createRuntimeTerminalOutputPaneSnapshot({
      focused: false,
      historyStats: {
        appendCount: 5,
        appendedChars: 96,
        coldSnapshotChars: 64,
        droppedTailChars: 32,
        flushCount: 2,
        lastFlushMs: 14,
        lastSlowFlushAt: 124,
        manualFlushCount: 1,
        maxFlushMs: 14,
        pendingFlush: true,
        pendingSnapshotChars: 48,
        runtimeBufferStats: {
          chunkCount: 3,
          maxChars: 128,
          totalChars: 96,
          truncatedChars: 32,
        },
        scheduledFlushCount: 1,
        skippedUnchangedSnapshotCount: 1,
        slowFlushCount: 1,
        storeUpdateCount: 1,
        tailChars: 96,
        truncatedTail: true,
      },
      paneId: "pane-1",
      runtimeWorkMode: "visible-degraded",
      visible: true,
      writerStats: {
        flushCount: 3,
        lastFlushChars: 42,
        lastFlushMs: 7,
        lastSlowFlushAt: 118,
        maxFlushMs: 11,
        pendingBytes: 42,
        pendingChars: 42,
        pendingChunks: 2,
        slowFlushCount: 1,
        splitFrameCount: 1,
        totalFlushChars: 512,
        writeErrorCount: 2,
        writeNowCount: 1,
      },
    });

    expect(pane).toMatchObject({
      coldSnapshotChars: 64,
      droppedTailChars: 32,
      flushCount: 5,
      historyFlushCount: 2,
      lastFlushMs: 14,
      lastSlowFlushAt: 124,
      maxFlushMs: 14,
      pendingBytes: 42,
      pendingChars: 42,
      pendingChunks: 2,
      slowFlushCount: 2,
      storeUpdateCount: 1,
      tailChars: 96,
      truncatedTail: true,
      writerFlushCount: 3,
      writerWriteErrorCount: 2,
    });
    expect(findRuntimePerformanceSnapshotSensitiveKeys(pane)).toEqual([]);
    expect(JSON.stringify(pane)).not.toContain("visible output");
  });

  it("keeps all planned diagnostic sections expressible without raw output", () => {
    const snapshot: RuntimePerformanceSnapshot = createRuntimePerformanceSnapshot({
      generatedAt: "2026-07-01T15:21:00.000Z",
      managedSsh: {
        activeChannels: 3,
        activeSessions: 1,
        generatedAt: "1760000000",
        recentLegacyFallbacks: [],
        sessions: [
          {
            activeChannels: 3,
            channelCounts: {
              exec: 2,
              shell: 1,
              sftp: 1,
            },
            createdAt: "1760000000",
            key: {
              jumps: ["jump@example.net:22"],
              knownHostsProfile: "default",
              proxyProfile: null,
              runtimeFlags: [],
              target: "deploy@example.internal:22",
            },
            lastError: null,
            lastUsedAt: "1760000001",
            maxConcurrentExecChannels: 4,
            openedChannels: 4,
            pendingExecRequests: 1,
            refCount: 1,
            sessionId: "managed-session-1",
            state: "ready",
          },
        ],
      },
      configWatcher: {
        diagnostics: [
          {
            fileKind: "settings",
            key: "terminal.rendererType",
            line: 12,
            reason: "invalid enum value",
            severity: "warning",
          },
        ],
        invalidFileCount: 1,
      },
      degraded: [
        {
          disabledReason: "hidden-pane",
          effectiveMode: "hidden-tail-only",
          enabled: false,
          retryAfterMs: 30_000,
          system: "suggestions",
        },
      ],
      ptyPump: {
        sessions: [
          {
            bufferedChunks: 3,
            closed: false,
            coalescedChunks: 20,
            finalFlushCount: 0,
            flushCount: 4,
            maxPendingBytes: 65536,
            maxPendingHitCount: 1,
            pendingBytes: 1024,
            sessionId: "session-1",
          },
        ],
        totalPendingBytes: 1024,
      },
      sftp: {
        preflight: {
          active: 2,
          cancelRequested: false,
          completed: 10,
          concurrencyLimit: 8,
          failed: 1,
          queued: 5,
        },
        transfers: {
          activeTransfers: 1,
          failedRecent: 2,
          prunedCompleted: 100,
          recentCompleted: 50,
        },
      },
      ssh: {
        activeConnections: 2,
        errorClasses: {
          "auth-failed": 1,
          "network-unreachable": 1,
        },
        failedRecent: 2,
        reconnecting: 1,
      },
      suggestions: {
        activeTasks: 3,
        disabledReasons: {
          "hidden-pane": 2,
        },
        inFlight: 1,
        maxConcurrent: 2,
        queued: 2,
        tasks: [
          {
            failureCount: 0,
            inFlight: false,
            kind: "remotePath",
            ownerCount: 1,
            timerPending: true,
          },
        ],
      },
    });

    expect(snapshot.schemaVersion).toBe(1);
    expect(snapshot.managedSsh?.activeSessions).toBe(1);
    expect(snapshot.managedSsh?.sessions[0]?.pendingExecRequests).toBe(1);
    expect(snapshot.sftp?.preflight?.concurrencyLimit).toBe(8);
    expect(snapshot.configWatcher?.diagnostics[0]?.fileKind).toBe("settings");
    expect(findRuntimePerformanceSnapshotSensitiveKeys(snapshot)).toEqual([]);
  });

  it("passes the production gate when managed diagnostics are complete and clean", () => {
    const snapshot = createRuntimePerformanceSnapshot({
      managedSsh: {
        activeChannels: 2,
        activeSessions: 1,
        generatedAt: "1760000000",
        recentLegacyFallbacks: [],
        sessions: [
          {
            activeChannels: 2,
            channelCounts: { exec: 1, shell: 1 },
            createdAt: "1760000000",
            key: {
              jumps: [],
              knownHostsProfile: "default",
              proxyProfile: null,
              runtimeFlags: [],
              target: "deploy@example.internal:22",
            },
            lastError: null,
            lastUsedAt: "1760000001",
            maxConcurrentExecChannels: 4,
            openedChannels: 2,
            pendingExecRequests: 0,
            refCount: 1,
            sessionId: "managed-session-1",
            state: "ready",
          },
        ],
      },
      sftp: {
        transfers: {
          activeTransfers: 0,
          failedRecent: 0,
          prunedCompleted: 0,
          recentCompleted: 0,
        },
      },
      ssh: {
        activeConnections: 1,
        errorClasses: {
          authentication: 1,
        },
        failedRecent: 1,
        reconnecting: 0,
      },
      suggestions: {
        activeTasks: 0,
        disabledReasons: {},
        inFlight: 0,
        maxConcurrent: 2,
        queued: 0,
      },
    });

    expect(evaluateRuntimeProductionReadinessGate(snapshot)).toMatchObject({
      fallbackCount: 0,
      missingDiagnostics: [],
      ready: true,
      statusLabel: "默认启用门禁通过",
      unknownErrorClassCount: 0,
    });
  });

  it("blocks the production gate for fallback, unknown errors, or missing diagnostics", () => {
    const snapshot = createRuntimePerformanceSnapshot({
      managedSsh: {
        activeChannels: 0,
        activeSessions: 0,
        generatedAt: "1760000000",
        recentLegacyFallbacks: [
          {
            capability: "sftp",
            count: 2,
            lastAt: "1760000001",
            reason: "runtime-unwired",
            target: "deploy@example.internal:22",
          },
        ],
        sessions: [],
      },
      ssh: {
        activeConnections: 0,
        errorClasses: {
          unexpectedBackendFailure: 1,
          unknown: 1,
        },
        failedRecent: 2,
        reconnecting: 0,
      },
    });

    const gate = evaluateRuntimeProductionReadinessGate(snapshot);
    expect(gate.ready).toBe(false);
    expect(gate.fallbackCount).toBe(2);
    expect(gate.unknownErrorClassCount).toBe(2);
    expect(gate.missingDiagnostics).toEqual(["sftp", "suggestions"]);
    expect(gate.issues.map((issue) => issue.kind)).toEqual([
      "missing-diagnostics",
      "legacy-fallback",
      "unknown-error-class",
    ]);
  });

  it("detects keys that would leak raw output, paths, or credentials", () => {
    expect(isSensitiveRuntimeDiagnosticsKey("stdout")).toBe(true);
    expect(isSensitiveRuntimeDiagnosticsKey("terminalOutput")).toBe(false);

    expect(
      findRuntimePerformanceSnapshotSensitiveKeys({
        nested: {
          password: "secret",
          remotePath: "/srv/private",
        },
        stdout: "full terminal output",
        terminalOutput: {
          totalPendingBytes: 0,
        },
      }),
    ).toEqual(["nested.password", "nested.remotePath", "stdout"]);
  });
});
