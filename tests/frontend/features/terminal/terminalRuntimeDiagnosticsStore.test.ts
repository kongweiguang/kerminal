import { beforeEach, describe, expect, it } from "vitest";
import { createTerminalRuntimeDiagnosticsStore } from "../../../../src/features/terminal/terminalRuntimeDiagnosticsStore";
import {
  findRuntimePerformanceSnapshotSensitiveKeys,
} from "../../../../src/features/terminal/terminalRuntimeDiagnostics";
import { terminalSuggestionProbeScheduler } from "../../../../src/features/terminal/terminalSuggestionProbeScheduler";
import {
  createSftpRuntimeDiagnostics,
} from "../../../../src/features/sftp/sftpRuntimeDiagnostics";
import type { SftpTransferSummary } from "../../../../src/lib/sftpApi";
import type { TerminalPtyOutputPumpStats } from "../../../../src/lib/terminalApi";

describe("terminalRuntimeDiagnosticsStore", () => {
  let sftpDiagnostics: ReturnType<typeof createSftpRuntimeDiagnostics>;
  let diagnosticsStore: ReturnType<typeof createTerminalRuntimeDiagnosticsStore>;

  beforeEach(() => {
    diagnosticsStore = createTerminalRuntimeDiagnosticsStore();
    sftpDiagnostics = createSftpRuntimeDiagnostics();
    terminalSuggestionProbeScheduler.reset();
  });

  it("collects non-sensitive runtime diagnostics from registered providers", async () => {
    sftpDiagnostics.updateTransfers([
      transfer({ id: "running", status: "running" }),
      transfer({ id: "failed", status: "failed" }),
    ]);
    sftpDiagnostics.updatePreflight({
      checked: 4,
      conflicts: 1,
      inFlight: 1,
      queued: 3,
      total: 8,
    });
    const unregister = diagnosticsStore.register({
      getSnapshot: () => ({
        focused: false,
        historyStats: {
          appendCount: 1,
          appendedChars: 64,
          coldSnapshotChars: 32,
          droppedTailChars: 4,
          flushCount: 2,
          manualFlushCount: 1,
          maxFlushMs: 11,
          pendingFlush: false,
          pendingSnapshotChars: 0,
          runtimeBufferStats: {
            chunkCount: 1,
            maxChars: 128,
            totalChars: 64,
            truncatedChars: 4,
          },
          scheduledFlushCount: 1,
          skippedUnchangedSnapshotCount: 0,
          slowFlushCount: 0,
          storeUpdateCount: 1,
          tailChars: 64,
          truncatedTail: true,
        },
        paneId: "pane-1",
        runtimeWorkMode: "hidden-tail-only",
        sessionId: "session-1",
        sshFailure: {
          class: "networkUnreachable",
          nextAction: "check network",
          reconnectHint: "network",
          retryable: true,
          userMessage: "network",
        },
        sshReconnect: {
          reconnecting: true,
          sshReconnectAttempt: 2,
        },
        sshTarget: true,
        visible: false,
        writerStats: {
          flushCount: 3,
          lastFlushChars: 20,
          maxFlushMs: 8,
          pendingBytes: 20,
          pendingChars: 20,
          pendingChunks: 1,
          slowFlushCount: 0,
          splitFrameCount: 0,
          totalFlushChars: 80,
          writeErrorCount: 1,
          writeNowCount: 1,
        },
      }),
    });

    const snapshot = await diagnosticsStore.collect({
      generatedAt: "2026-07-02T03:40:00.000Z",
      readManagedSshSnapshot: async () => ({
        activeChannels: 2,
        activeSessions: 1,
        generatedAt: "1760000000",
        recentLegacyFallbacks: [],
        sessions: [
          {
            activeChannels: 2,
            channelCounts: {
              exec: 2,
              sftp: 1,
            },
            createdAt: "1760000000",
            key: {
              jumps: [],
              knownHostsProfile: "default",
              proxyProfile: null,
              runtimeFlags: [],
              target: "deploy@example.internal:22",
            },
            lastError: "managed SSH runtime backend does not support exec channels yet",
            lastUsedAt: "1760000001",
            maxConcurrentExecChannels: 4,
            openedChannels: 3,
            pendingExecRequests: 1,
            refCount: 1,
            sessionId: "managed-session-1",
            state: "ready",
          },
        ],
      }),
      readPtyPumpStats: async (sessionId) => ptyStats(sessionId),
      readSftpSnapshot: sftpDiagnostics.getSnapshot,
    });

    expect(snapshot).toMatchObject({
      generatedAt: "2026-07-02T03:40:00.000Z",
      managedSsh: {
        activeChannels: 2,
        activeSessions: 1,
        sessions: [
          {
            channelCounts: {
              exec: 2,
              sftp: 1,
            },
            key: {
              target: "deploy@example.internal:22",
            },
            pendingExecRequests: 1,
            sessionId: "managed-session-1",
          },
        ],
      },
      ptyPump: {
        sessions: [
          {
            bufferedChunks: 2,
            closed: false,
            coalescedChunks: 4,
            finalFlushCount: 0,
            flushCount: 1,
            lastFlushMs: 7,
            maxPendingBytes: 64,
            maxPendingHitCount: 0,
            pendingBytes: 12,
            sessionId: "session-1",
          },
        ],
        totalPendingBytes: 12,
      },
      sftp: {
        preflight: {
          active: 1,
          cancelRequested: false,
          completed: 4,
          concurrencyLimit: 8,
          failed: 0,
          queued: 3,
        },
        transfers: {
          activeTransfers: 1,
          failedRecent: 1,
          prunedCompleted: 0,
          recentCompleted: 1,
          retryableFailedRecent: 1,
        },
      },
      ssh: {
        activeConnections: 1,
        errorClasses: {
          networkUnreachable: 1,
        },
        failedRecent: 1,
        reconnecting: 1,
      },
      terminalOutput: {
        panes: [
          {
            coldSnapshotChars: 32,
            droppedTailChars: 4,
            flushCount: 5,
            focused: false,
            historyFlushCount: 2,
            historySlowFlushCount: 0,
            paneId: "pane-1",
            pendingBytes: 20,
            pendingChars: 20,
            pendingChunks: 1,
            runtimeWorkMode: "hidden-tail-only",
            slowFlushCount: 0,
            storeUpdateCount: 1,
            tailChars: 64,
            truncatedTail: true,
            visible: false,
            writerFlushCount: 3,
            writerSlowFlushCount: 0,
            writerWriteErrorCount: 1,
          },
        ],
        storeUpdateCount: 1,
        totalColdSnapshotChars: 32,
        totalPendingBytes: 20,
      },
    });
    expect(snapshot.terminalOutput?.panes[0]).toMatchObject({
      paneId: "pane-1",
      runtimeWorkMode: "hidden-tail-only",
      visible: false,
    });
    expect(snapshot.ptyPump?.sessions[0]).toMatchObject({
      pendingBytes: 12,
      sessionId: "session-1",
    });
    expect(findRuntimePerformanceSnapshotSensitiveKeys(snapshot)).toEqual([]);
    expect(JSON.stringify(snapshot)).not.toContain("/secret");
    expect(JSON.stringify(snapshot)).not.toContain("host-secret");

    unregister();
  });
});

function ptyStats(sessionId: string): TerminalPtyOutputPumpStats {
  return {
    bufferedChunks: 2,
    closedEvents: 0,
    coalescedChunks: 4,
    dataEvents: 1,
    droppedBytes: 0,
    errorEvents: 0,
    finalTailFlushCount: 0,
    finished: false,
    flushCount: 1,
    inputBytes: 128,
    inputChunks: 2,
    lastFlushIntervalMs: 7,
    maxPendingBytes: 64,
    maxPendingHitCount: 0,
    outputBytes: 116,
    overflowCount: 0,
    pendingBytes: 12,
    sessionId,
  };
}

function transfer({
  id,
  status,
}: {
  id: string;
  status: SftpTransferSummary["status"];
}): SftpTransferSummary {
  return {
    bytesTransferred: 0,
    cancelRequested: false,
    conflictPolicy: "overwrite",
    createdAt: 1,
    direction: "upload",
    hostId: "host-secret",
    id,
    kind: "file",
    localPath: "/secret/local.txt",
    operation: "upload",
    remotePath: "/secret/remote.txt",
    source: { kind: "local", path: "/secret/local.txt" },
    status,
    target: {
      hostId: "host-secret",
      hostLabel: "private",
      kind: "remote",
      path: "/secret/remote.txt",
    },
    transportMode: "singleHostSftp",
    updatedAt: 1,
  };
}
