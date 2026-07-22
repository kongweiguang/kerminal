import type { CompatibilityMetricSnapshot } from "../../architecture/compatibility/compatibilityRegistry";
import type { ManagedSshRuntimeSnapshot } from "../../lib/diagnosticsApi";
import type { TerminalRendererRegistrySnapshot } from "./terminalRendererRegistry";
import type { TerminalOutputHistoryBufferStats } from "./terminalOutputHistoryBuffer";
import type { TerminalOutputWriterStats } from "./terminalOutputWriter";

export const RUNTIME_PERFORMANCE_SNAPSHOT_SCHEMA_VERSION = 1 as const;

export type RuntimeDiagnosticsWorkMode =
  | "full"
  | "visible-degraded"
  | "hidden-tail-only"
  | "suspended-renderer";

type RuntimeDiagnosticsSystem =
  | "renderer"
  | "terminal-output"
  | "output-history"
  | "pty-pump"
  | "suggestions"
  | "sftp"
  | "ssh"
  | "managed-ssh"
  | "config-watcher";

type RuntimeDiagnosticsSeverity = "info" | "warning" | "error";

export interface RuntimeDiagnosticsDegradeState {
  disabledReason?: string;
  effectiveMode: string;
  enabled: boolean;
  lastFailureAt?: number;
  lastRecoveredAt?: number;
  retryAfterMs?: number;
  system: RuntimeDiagnosticsSystem;
}

export interface RuntimeTerminalOutputPaneSnapshot {
  coldSnapshotChars: number;
  droppedTailChars: number;
  flushCount: number;
  focused: boolean;
  historyFlushCount?: number;
  historyLastFlushMs?: number;
  historySlowFlushCount?: number;
  lastFlushMs?: number;
  lastSlowFlushAt?: number;
  maxFlushMs?: number;
  paneId: string;
  pendingBytes: number;
  pendingChars?: number;
  pendingChunks: number;
  runtimeWorkMode: RuntimeDiagnosticsWorkMode;
  slowFlushCount: number;
  storeUpdateCount?: number;
  tailChars: number;
  truncatedTail?: boolean;
  visible: boolean;
  writerFlushCount?: number;
  writerLastFlushMs?: number;
  writerSlowFlushCount?: number;
  writerWriteErrorCount?: number;
}

interface RuntimeTerminalOutputSnapshot {
  panes: RuntimeTerminalOutputPaneSnapshot[];
  storeUpdateCount?: number;
  totalColdSnapshotChars: number;
  totalPendingBytes: number;
}

/** 终端 Tab chrome activity 的低频转换摘要。 */
interface RuntimeTerminalChromeActivitySnapshot {
  publishedTransitions: number;
  registeredPanes: number;
  suppressedTransitions: number;
}

export interface RuntimePtyPumpSessionSnapshot {
  bufferedChunks: number;
  closed: boolean;
  coalescedChunks: number;
  finalFlushCount: number;
  flushCount: number;
  lastFlushMs?: number;
  maxPendingBytes: number;
  maxPendingHitCount: number;
  pendingBytes: number;
  sessionId: string;
}

interface RuntimePtyPumpSnapshot {
  sessions: RuntimePtyPumpSessionSnapshot[];
  totalPendingBytes: number;
}

type RuntimeSuggestionProbeKind =
  | "git"
  | "remoteCommand"
  | "remoteHistory"
  | "remotePath";

interface RuntimeSuggestionProbeSnapshot {
  failureCount: number;
  inFlight: boolean;
  kind: RuntimeSuggestionProbeKind;
  lastFailureAt?: number;
  lastFailureReason?: string;
  nextAllowedInMs?: number;
  ownerCount: number;
  timerPending: boolean;
}

export interface RuntimeSuggestionSchedulerSnapshot {
  activeTasks: number;
  disabledReasons: Record<string, number>;
  inFlight: number;
  maxConcurrent: number;
  queued: number;
  tasks?: RuntimeSuggestionProbeSnapshot[];
}

interface RuntimeSftpPreflightSnapshot {
  active: number;
  cancelRequested: boolean;
  completed: number;
  concurrencyLimit: number;
  failed: number;
  queued: number;
}

interface RuntimeSftpTransferSnapshot {
  activeTransfers: number;
  failedRecent: number;
  prunedCompleted: number;
  recentCompleted: number;
  retryableFailedRecent?: number;
}

export interface RuntimeSftpSnapshot {
  preflight?: RuntimeSftpPreflightSnapshot;
  transfers: RuntimeSftpTransferSnapshot;
}

interface RuntimeSshSnapshot {
  activeConnections: number;
  errorClasses: Record<string, number>;
  failedRecent: number;
  reconnecting: number;
}

interface RuntimeConfigDiagnosticSnapshot {
  column?: number;
  fileKind:
    | "settings"
    | "profile"
    | "host"
    | "host-group"
    | "snippet"
    | "workflow"
    | "unknown";
  key?: string;
  line?: number;
  reason: string;
  severity: RuntimeDiagnosticsSeverity;
}

interface RuntimeConfigWatcherSnapshot {
  diagnostics: RuntimeConfigDiagnosticSnapshot[];
  invalidFileCount: number;
  lastInvalidAt?: number;
  lastValidAt?: number;
}

export interface RuntimePerformanceSnapshot {
  compatibility?: CompatibilityMetricSnapshot;
  configWatcher?: RuntimeConfigWatcherSnapshot;
  degraded?: RuntimeDiagnosticsDegradeState[];
  generatedAt: string;
  managedSsh?: ManagedSshRuntimeSnapshot;
  ptyPump?: RuntimePtyPumpSnapshot;
  schemaVersion: typeof RUNTIME_PERFORMANCE_SNAPSHOT_SCHEMA_VERSION;
  sftp?: RuntimeSftpSnapshot;
  ssh?: RuntimeSshSnapshot;
  suggestions?: RuntimeSuggestionSchedulerSnapshot;
  terminalChromeActivity?: RuntimeTerminalChromeActivitySnapshot;
  terminalOutput?: RuntimeTerminalOutputSnapshot;
  terminalRenderer?: TerminalRendererRegistrySnapshot;
}

type RuntimeProductionReadinessGateIssueKind =
  | "legacy-fallback"
  | "missing-diagnostics"
  | "unknown-error-class";

interface RuntimeProductionReadinessGateIssue {
  count: number;
  kind: RuntimeProductionReadinessGateIssueKind;
  message: string;
}

export interface RuntimeProductionReadinessGate {
  fallbackCount: number;
  fallbackRate: number;
  missingDiagnostics: string[];
  ready: boolean;
  statusLabel: string;
  unknownErrorClassCount: number;
  issues: RuntimeProductionReadinessGateIssue[];
}

export interface RuntimeProductionReadinessGateOptions {
  fallbackRateThreshold?: number;
  requiredDiagnostics?: Array<"managedSsh" | "sftp" | "ssh" | "suggestions">;
  unknownErrorClassThreshold?: number;
}

export type RuntimePerformanceSnapshotInput = Partial<
  Omit<RuntimePerformanceSnapshot, "generatedAt" | "schemaVersion">
> & {
  generatedAt?: string;
};

export interface RuntimeTerminalOutputPaneSnapshotInput {
  focused: boolean;
  historyStats?: TerminalOutputHistoryBufferStats;
  paneId: string;
  runtimeWorkMode: RuntimeDiagnosticsWorkMode;
  visible: boolean;
  writerStats?: TerminalOutputWriterStats;
}

const SENSITIVE_RUNTIME_DIAGNOSTICS_KEYS = new Set([
  "credential",
  "credentialsecret",
  "fulloutput",
  "fullpath",
  "hostpassword",
  "inlineprivatekey",
  "localpath",
  "output",
  "outputtext",
  "passphrase",
  "password",
  "privatekey",
  "rawoutput",
  "remotepath",
  "secret",
  "stderr",
  "stdout",
  "terminaltext",
  "token",
]);

const KNOWN_SSH_ERROR_CLASSES = new Set([
  "authentication",
  "disconnect",
  "knownHosts",
  "networkUnreachable",
  "permission",
  "proxyJump",
  "remoteShellStartup",
]);

export function createRuntimePerformanceSnapshot(
  input: RuntimePerformanceSnapshotInput = {},
): RuntimePerformanceSnapshot {
  const { generatedAt = new Date().toISOString(), ...sections } = input;
  return {
    schemaVersion: RUNTIME_PERFORMANCE_SNAPSHOT_SCHEMA_VERSION,
    generatedAt,
    ...sections,
  };
}

export function createRuntimeTerminalOutputPaneSnapshot({
  focused,
  historyStats,
  paneId,
  runtimeWorkMode,
  visible,
  writerStats,
}: RuntimeTerminalOutputPaneSnapshotInput): RuntimeTerminalOutputPaneSnapshot {
  const writerFlushCount = writerStats?.flushCount ?? 0;
  const historyFlushCount = historyStats?.flushCount ?? 0;
  const writerSlowFlushCount = writerStats?.slowFlushCount ?? 0;
  const historySlowFlushCount = historyStats?.slowFlushCount ?? 0;
  const snapshot: RuntimeTerminalOutputPaneSnapshot = {
    coldSnapshotChars: historyStats?.coldSnapshotChars ?? 0,
    droppedTailChars: historyStats?.droppedTailChars ?? 0,
    flushCount: writerFlushCount + historyFlushCount,
    focused,
    paneId,
    pendingBytes: writerStats?.pendingBytes ?? 0,
    pendingChars: writerStats?.pendingChars ?? 0,
    pendingChunks: writerStats?.pendingChunks ?? 0,
    runtimeWorkMode,
    slowFlushCount: writerSlowFlushCount + historySlowFlushCount,
    tailChars: historyStats?.tailChars ?? 0,
    visible,
  };

  assignOptionalNumber(snapshot, "historyFlushCount", historyFlushCount);
  assignOptionalNumber(
    snapshot,
    "historyLastFlushMs",
    historyStats?.lastFlushMs,
  );
  assignOptionalNumber(
    snapshot,
    "historySlowFlushCount",
    historySlowFlushCount,
  );
  assignOptionalNumber(
    snapshot,
    "lastFlushMs",
    maxDefinedNumber(writerStats?.lastFlushMs, historyStats?.lastFlushMs),
  );
  assignOptionalNumber(
    snapshot,
    "lastSlowFlushAt",
    maxDefinedNumber(
      writerStats?.lastSlowFlushAt,
      historyStats?.lastSlowFlushAt,
    ),
  );
  assignOptionalNumber(
    snapshot,
    "maxFlushMs",
    maxDefinedNumber(writerStats?.maxFlushMs, historyStats?.maxFlushMs),
  );
  assignOptionalNumber(
    snapshot,
    "storeUpdateCount",
    historyStats?.storeUpdateCount,
  );
  if (historyStats?.truncatedTail !== undefined) {
    snapshot.truncatedTail = historyStats.truncatedTail;
  }
  assignOptionalNumber(snapshot, "writerFlushCount", writerFlushCount);
  assignOptionalNumber(
    snapshot,
    "writerLastFlushMs",
    writerStats?.lastFlushMs,
  );
  assignOptionalNumber(
    snapshot,
    "writerSlowFlushCount",
    writerSlowFlushCount,
  );
  assignOptionalNumber(
    snapshot,
    "writerWriteErrorCount",
    writerStats?.writeErrorCount,
  );

  return snapshot;
}

export function isSensitiveRuntimeDiagnosticsKey(key: string): boolean {
  return SENSITIVE_RUNTIME_DIAGNOSTICS_KEYS.has(normalizeDiagnosticKey(key));
}

export function findRuntimePerformanceSnapshotSensitiveKeys(
  value: unknown,
): string[] {
  const hits = new Set<string>();

  const visit = (current: unknown, path: string) => {
    if (!current || typeof current !== "object") {
      return;
    }
    if (Array.isArray(current)) {
      current.forEach((item, index) => {
        visit(item, path ? `${path}.${index}` : String(index));
      });
      return;
    }
    for (const [key, nested] of Object.entries(current)) {
      const nextPath = path ? `${path}.${key}` : key;
      if (isSensitiveRuntimeDiagnosticsKey(key)) {
        hits.add(nextPath);
      }
      visit(nested, nextPath);
    }
  };

  visit(value, "");
  return [...hits].sort();
}

export function evaluateRuntimeProductionReadinessGate(
  snapshot: RuntimePerformanceSnapshot,
  {
    fallbackRateThreshold = 0,
    requiredDiagnostics = ["managedSsh", "sftp", "ssh", "suggestions"],
    unknownErrorClassThreshold = 0,
  }: RuntimeProductionReadinessGateOptions = {},
): RuntimeProductionReadinessGate {
  const fallbackCount =
    snapshot.managedSsh?.recentLegacyFallbacks.reduce(
      (sum, fallback) => sum + fallback.count,
      0,
    ) ?? 0;
  const sessionEvidence =
    (snapshot.managedSsh?.activeSessions ?? 0) +
    (snapshot.ssh?.activeConnections ?? 0);
  const fallbackRate =
    fallbackCount <= 0 ? 0 : fallbackCount / (fallbackCount + sessionEvidence);
  const missingDiagnostics = requiredDiagnostics.filter(
    (section) => snapshot[section] === undefined,
  );
  const unknownErrorClassCount = Object.entries(
    snapshot.ssh?.errorClasses ?? {},
  ).reduce((sum, [errorClass, count]) => {
    if (errorClass === "unknown" || !KNOWN_SSH_ERROR_CLASSES.has(errorClass)) {
      return sum + count;
    }
    return sum;
  }, 0);

  const issues: RuntimeProductionReadinessGateIssue[] = [];
  if (missingDiagnostics.length > 0) {
    issues.push({
      count: missingDiagnostics.length,
      kind: "missing-diagnostics",
      message: `缺少 ${missingDiagnostics.join(", ")} diagnostics`,
    });
  }
  if (fallbackRate > fallbackRateThreshold) {
    issues.push({
      count: fallbackCount,
      kind: "legacy-fallback",
      message: `legacy fallback rate ${formatGatePercent(fallbackRate)} 超过阈值 ${formatGatePercent(fallbackRateThreshold)}`,
    });
  }
  if (unknownErrorClassCount > unknownErrorClassThreshold) {
    issues.push({
      count: unknownErrorClassCount,
      kind: "unknown-error-class",
      message: `unknown SSH error class count ${unknownErrorClassCount} 超过阈值 ${unknownErrorClassThreshold}`,
    });
  }

  return {
    fallbackCount,
    fallbackRate,
    missingDiagnostics,
    ready: issues.length === 0,
    statusLabel: issues.length === 0 ? "默认启用门禁通过" : "默认启用门禁阻断",
    unknownErrorClassCount,
    issues,
  };
}

function normalizeDiagnosticKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

function formatGatePercent(rate: number) {
  return `${Math.round(rate * 100)}%`;
}

function maxDefinedNumber(
  first: number | undefined,
  second: number | undefined,
): number | undefined {
  if (first === undefined) {
    return second;
  }
  if (second === undefined) {
    return first;
  }
  return Math.max(first, second);
}

function assignOptionalNumber<
  TKey extends keyof RuntimeTerminalOutputPaneSnapshot,
>(
  snapshot: RuntimeTerminalOutputPaneSnapshot,
  key: TKey,
  value: RuntimeTerminalOutputPaneSnapshot[TKey] | undefined,
) {
  if (typeof value === "number" && Number.isFinite(value)) {
    snapshot[key] = value;
  }
}
