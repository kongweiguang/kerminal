import type { CommandHistoryTarget } from "./commandHistoryApi";

export type CommandSuggestionProvider =
  | "git"
  | "history"
  | "remoteCommand"
  | "remotePath"
  | "snippet"
  | "spec";

type CommandSuggestionSensitivity = "normal" | "sensitive" | "dangerous";
type CommandSuggestionFeedbackAction = "accepted" | "dismissed";
export type CommandSuggestionQueryMode = "inline" | "menu";
export type CommandSuggestionPresentation = "inline" | "menu";
type CommandSuggestionCandidateKind = "command" | "snippet";
type CommandSuggestionActivation = "insert" | "openSnippetPanel";
type CommandSuggestionAuditEventKind =
  | "feedback"
  | "remoteProbeRefresh"
  | "remoteProbeSchedule";
type CommandSuggestionAuditDecision =
  | "allowed"
  | "failed"
  | "recorded"
  | "skipped"
  | "succeeded";

export interface CommandSuggestionReplacementRange {
  start: number;
  end: number;
}

export interface CommandSuggestionRequest {
  input: string;
  cursor: number;
  mode?: CommandSuggestionQueryMode;
  generation?: number;
  contextKey?: string;
  target?: CommandHistoryTarget;
  sessionId?: string;
  paneId?: string;
  profileId?: string;
  remoteHostId?: string;
  cwd?: string;
  shell?: string;
  providers?: CommandSuggestionProvider[];
  limit?: number;
}

export interface NormalizedCommandSuggestionRequest {
  input: string;
  cursor: number;
  mode: CommandSuggestionQueryMode;
  generation?: number;
  contextKey?: string;
  target: CommandHistoryTarget;
  sessionId?: string;
  paneId?: string;
  profileId?: string;
  remoteHostId?: string;
  cwd?: string;
  shell?: string;
  providers?: CommandSuggestionProvider[];
  limit: number;
}

export interface CommandSuggestionCandidate {
  id: string;
  provider: CommandSuggestionProvider;
  displayText: string;
  replacementText: string;
  replacementRange: CommandSuggestionReplacementRange;
  suffix: string;
  score: number;
  sensitivity: CommandSuggestionSensitivity;
  description?: string;
  sourceId?: string;
  metadata?: Record<string, string | number | boolean | null>;
  allowedPresentations: CommandSuggestionPresentation[];
  acceptBoundaries: number[];
  contextKey?: string;
  /** 旧候选缺省为 command，归一化边界会补齐。 */
  candidateKind?: CommandSuggestionCandidateKind;
  /** 旧候选缺省为 insert；openSnippetPanel 永远不能写入终端。 */
  activation?: CommandSuggestionActivation;
  sourceExplanation?: string;
  mergedSourceExplanations?: string[];
}

export type CommandSuggestionCandidatePayload = Omit<
  CommandSuggestionCandidate,
  | "acceptBoundaries"
  | "activation"
  | "allowedPresentations"
  | "candidateKind"
  | "contextKey"
> &
  Partial<
    Pick<
      CommandSuggestionCandidate,
      | "acceptBoundaries"
      | "activation"
      | "allowedPresentations"
      | "candidateKind"
      | "contextKey"
    >
  >;

export interface CommandSuggestionFeedbackRecordRequest {
  action: CommandSuggestionFeedbackAction;
  provider: CommandSuggestionProvider;
  replacementText: string;
  input: string;
  target?: CommandHistoryTarget;
  sessionId?: string;
  paneId?: string;
  profileId?: string;
  remoteHostId?: string;
  cwd?: string;
  shell?: string;
  sourceId?: string;
}

export interface CommandSuggestionFeedbackRecordResult {
  recorded: boolean;
  id?: string;
  skipReason?: string;
}

export interface NormalizedCommandSuggestionFeedbackRecordRequest {
  action: CommandSuggestionFeedbackAction;
  provider: CommandSuggestionProvider;
  replacementText: string;
  input: string;
  target: CommandHistoryTarget;
  sessionId?: string;
  paneId?: string;
  profileId?: string;
  remoteHostId?: string;
  cwd?: string;
  shell?: string;
  sourceId?: string;
}

interface CommandSuggestionProviderTelemetry {
  provider: CommandSuggestionProvider;
  queryCount: number;
  candidateCount: number;
  totalElapsedMs: number;
  averageElapsedMs: number;
  cacheHitCount: number;
  cacheMissCount: number;
  refreshSuccessCount: number;
  refreshFailureCount: number;
  feedbackAcceptedCount: number;
  feedbackDismissedCount: number;
  feedbackSkippedCount: number;
  lastEventUnixMs?: number;
  lastError?: string;
}

export interface CommandSuggestionTelemetrySummary {
  startedAtUnixMs: number;
  generatedAtUnixMs: number;
  totalQueryCount: number;
  totalCandidateCount: number;
  providers: CommandSuggestionProviderTelemetry[];
}

export interface CommandSuggestionTelemetryExport {
  generatedAtUnixMs: number;
  runtime: CommandSuggestionTelemetrySummary;
  persisted: CommandSuggestionTelemetrySummary;
  auditEvents: CommandSuggestionAuditEvent[];
}

export interface CommandSuggestionDiagnosticsCleanupRequest {
  pruneAuditEvents?: boolean;
  pruneFeedback?: boolean;
  auditRetentionDays?: number;
  feedbackRetentionDays?: number;
  pruneExpiredProviderCache?: boolean;
  resetPersistedTelemetry?: boolean;
}

export interface NormalizedCommandSuggestionDiagnosticsCleanupRequest {
  pruneAuditEvents: boolean;
  pruneFeedback: boolean;
  auditRetentionDays: number;
  feedbackRetentionDays: number;
  pruneExpiredProviderCache: boolean;
  resetPersistedTelemetry: boolean;
}

export interface CommandSuggestionDiagnosticsCleanupResult {
  generatedAtUnixMs: number;
  auditCutoffUnixMs?: number;
  feedbackCutoffUnixMs?: number;
  auditEventsDeleted: number;
  feedbackDeleted: number;
  providerCacheDeleted: number;
  telemetryRowsDeleted: number;
}

interface CommandSuggestionAuditEvent {
  id: string;
  eventKind: CommandSuggestionAuditEventKind;
  provider?: CommandSuggestionProvider;
  target: CommandHistoryTarget;
  decision: CommandSuggestionAuditDecision;
  reason?: string;
  remoteHostId?: string;
  cwd?: string;
  path?: string;
  paneId?: string;
  sessionId?: string;
  metadata: Record<string, string>;
  createdAtUnixMs: number;
}

export interface CommandSuggestionAuditRecordRequest {
  eventKind: CommandSuggestionAuditEventKind;
  provider?: CommandSuggestionProvider;
  target?: CommandHistoryTarget;
  decision: CommandSuggestionAuditDecision;
  reason?: string;
  remoteHostId?: string;
  cwd?: string;
  path?: string;
  paneId?: string;
  sessionId?: string;
  metadata?: Record<string, string>;
}

export interface CommandSuggestionAuditRecordResult {
  recorded: boolean;
  eventId: string;
}

export interface CommandSuggestionRemotePathRefreshRequest {
  hostId: string;
  path: string;
  ttlSeconds?: number;
  maxEntries?: number;
}

export interface NormalizedCommandSuggestionRemotePathRefreshRequest {
  hostId: string;
  path: string;
  ttlSeconds?: number;
  maxEntries?: number;
}

export interface CommandSuggestionRemotePathRefreshResult {
  hostId: string;
  path: string;
  entryCount: number;
  cachedAtUnixMs: number;
  ttlSeconds: number;
}

export interface CommandSuggestionRemoteCommandRefreshRequest {
  hostId: string;
  ttlSeconds?: number;
  maxEntries?: number;
}

export interface NormalizedCommandSuggestionRemoteCommandRefreshRequest {
  hostId: string;
  ttlSeconds?: number;
  maxEntries?: number;
}

export interface CommandSuggestionRemoteCommandRefreshResult {
  hostId: string;
  commandCount: number;
  cachedAtUnixMs: number;
  ttlSeconds: number;
}

export interface CommandSuggestionRemoteHistoryRefreshRequest {
  hostId: string;
  ttlSeconds?: number;
  maxEntries?: number;
}

export interface NormalizedCommandSuggestionRemoteHistoryRefreshRequest {
  hostId: string;
  ttlSeconds?: number;
  maxEntries?: number;
}

export interface CommandSuggestionRemoteHistoryRefreshResult {
  hostId: string;
  commandCount: number;
  cachedAtUnixMs: number;
  ttlSeconds: number;
}

export interface CommandSuggestionGitRefreshRequest {
  hostId: string;
  cwd: string;
  ttlSeconds?: number;
  maxEntries?: number;
}

export interface NormalizedCommandSuggestionGitRefreshRequest {
  hostId: string;
  cwd: string;
  ttlSeconds?: number;
  maxEntries?: number;
}

export interface CommandSuggestionGitRefreshResult {
  hostId: string;
  cwd: string;
  repoRoot?: string;
  entryCount: number;
  cachedAtUnixMs: number;
  ttlSeconds: number;
}
