import { listCommandHistory, type CommandHistoryEntry } from "./commandHistoryApi";
import type {
  CommandSuggestionAuditRecordRequest,
  CommandSuggestionCandidate,
  CommandSuggestionCandidatePayload,
  CommandSuggestionDiagnosticsCleanupRequest,
  CommandSuggestionFeedbackRecordRequest,
  CommandSuggestionGitRefreshRequest,
  CommandSuggestionPresentation,
  CommandSuggestionProvider,
  CommandSuggestionRemoteCommandRefreshRequest,
  CommandSuggestionRemoteHistoryRefreshRequest,
  CommandSuggestionRemotePathRefreshRequest,
  CommandSuggestionReplacementRange,
  CommandSuggestionRequest,
  NormalizedCommandSuggestionDiagnosticsCleanupRequest,
  NormalizedCommandSuggestionFeedbackRecordRequest,
  NormalizedCommandSuggestionGitRefreshRequest,
  NormalizedCommandSuggestionRemoteCommandRefreshRequest,
  NormalizedCommandSuggestionRemoteHistoryRefreshRequest,
  NormalizedCommandSuggestionRemotePathRefreshRequest,
  NormalizedCommandSuggestionRequest,
} from "./terminalSuggestionApi.types";

const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 50;
export const DEFAULT_REMOTE_PATH_TTL_SECONDS = 30;
const MAX_REMOTE_PATH_TTL_SECONDS = 300;
const DEFAULT_REMOTE_PATH_MAX_ENTRIES = 250;
const MAX_REMOTE_PATH_MAX_ENTRIES = 1000;
export const DEFAULT_REMOTE_COMMAND_TTL_SECONDS = 300;
const MAX_REMOTE_COMMAND_TTL_SECONDS = 3600;
const DEFAULT_REMOTE_COMMAND_MAX_ENTRIES = 1500;
const MAX_REMOTE_COMMAND_MAX_ENTRIES = 5000;
export const DEFAULT_REMOTE_HISTORY_TTL_SECONDS = 900;
const MAX_REMOTE_HISTORY_TTL_SECONDS = 86400;
const DEFAULT_REMOTE_HISTORY_MAX_ENTRIES = 1000;
const MAX_REMOTE_HISTORY_MAX_ENTRIES = 5000;
export const DEFAULT_GIT_TTL_SECONDS = 60;
const MAX_GIT_TTL_SECONDS = 600;
const DEFAULT_GIT_MAX_ENTRIES = 500;
const MAX_GIT_MAX_ENTRIES = 5000;
const DEFAULT_AUDIT_RETENTION_DAYS = 30;
const DEFAULT_FEEDBACK_RETENTION_DAYS = 365;
const MAX_DIAGNOSTIC_RETENTION_DAYS = 3650;

export function normalizeCommandSuggestionRequest(
  request: CommandSuggestionRequest,
): NormalizedCommandSuggestionRequest {
  const input = request.input;
  const cursor = clamp(request.cursor, 0, Array.from(input).length);
  const providers = normalizeProviders(request.providers);
  const generation = normalizeGeneration(request.generation);

  return {
    input,
    cursor,
    mode: request.mode ?? "inline",
    target: request.target ?? "local",
    ...(generation !== undefined ? { generation } : {}),
    ...(request.contextKey?.trim()
      ? { contextKey: request.contextKey.trim() }
      : {}),
    ...(request.sessionId?.trim()
      ? { sessionId: request.sessionId.trim() }
      : {}),
    ...(request.paneId?.trim() ? { paneId: request.paneId.trim() } : {}),
    ...(request.profileId?.trim()
      ? { profileId: request.profileId.trim() }
      : {}),
    ...(request.remoteHostId?.trim()
      ? { remoteHostId: request.remoteHostId.trim() }
      : {}),
    ...(request.cwd?.trim() ? { cwd: request.cwd.trim() } : {}),
    ...(request.shell?.trim() ? { shell: request.shell.trim() } : {}),
    ...(providers ? { providers } : {}),
    limit: clampLimit(request.limit),
  };
}

/**
 * 将后端或旧缓存候选归一化为前端稳定合同。
 *
 * 所有偏移均按 Unicode code point 计数；非法 range 回退为当前前缀整条替换，
 * 任一非法 boundary 都会清空全部边界，确保只能整条接受。
 */
export function normalizeCommandSuggestionCandidate(
  candidate: CommandSuggestionCandidatePayload,
  request: NormalizedCommandSuggestionRequest,
): CommandSuggestionCandidate {
  const replacementRange = normalizeReplacementRange(
    candidate.replacementRange,
    request,
  );
  const allowedPresentations = normalizeAllowedPresentations(candidate);
  const acceptBoundaries = normalizeAcceptBoundaries(
    candidate.acceptBoundaries,
    request.cursor,
    candidate.replacementText,
  );

  return {
    ...candidate,
    activation:
      candidate.activation === "openSnippetPanel"
        ? "openSnippetPanel"
        : "insert",
    replacementRange,
    allowedPresentations,
    acceptBoundaries,
    candidateKind:
      candidate.candidateKind === "snippet" ? "snippet" : "command",
    ...(normalizeOptionalText(candidate.sourceId)
      ? { sourceId: normalizeOptionalText(candidate.sourceId) }
      : {}),
    ...(normalizeOptionalText(candidate.sourceExplanation)
      ? { sourceExplanation: normalizeOptionalText(candidate.sourceExplanation) }
      : {}),
    ...(normalizeSourceExplanations(candidate.mergedSourceExplanations).length > 0
      ? {
          mergedSourceExplanations: normalizeSourceExplanations(
            candidate.mergedSourceExplanations,
          ),
        }
      : {}),
    ...(candidate.contextKey?.trim()
      ? { contextKey: candidate.contextKey.trim() }
      : request.contextKey
        ? { contextKey: request.contextKey }
        : {}),
  };
}

function normalizeOptionalText(value: string | undefined) {
  const normalized = value?.trim();
  return normalized || undefined;
}

function normalizeSourceExplanations(values: string[] | undefined) {
  return Array.from(
    new Set((values ?? []).map((value) => value.trim()).filter(Boolean)),
  );
}

export function normalizeSuggestionFeedbackRecordRequest(
  request: CommandSuggestionFeedbackRecordRequest,
): NormalizedCommandSuggestionFeedbackRecordRequest {
  return {
    action: request.action,
    input: request.input,
    provider: request.provider,
    replacementText: request.replacementText,
    target: request.target ?? "local",
    ...(request.sessionId?.trim()
      ? { sessionId: request.sessionId.trim() }
      : {}),
    ...(request.paneId?.trim() ? { paneId: request.paneId.trim() } : {}),
    ...(request.profileId?.trim()
      ? { profileId: request.profileId.trim() }
      : {}),
    ...(request.remoteHostId?.trim()
      ? { remoteHostId: request.remoteHostId.trim() }
      : {}),
    ...(request.cwd?.trim() ? { cwd: request.cwd.trim() } : {}),
    ...(request.shell?.trim() ? { shell: request.shell.trim() } : {}),
    ...(request.sourceId?.trim() ? { sourceId: request.sourceId.trim() } : {}),
  };
}

export function normalizeDiagnosticsCleanupRequest(
  request: CommandSuggestionDiagnosticsCleanupRequest,
): NormalizedCommandSuggestionDiagnosticsCleanupRequest {
  return {
    auditRetentionDays: clampInteger(
      request.auditRetentionDays,
      DEFAULT_AUDIT_RETENTION_DAYS,
      1,
      MAX_DIAGNOSTIC_RETENTION_DAYS,
    ),
    feedbackRetentionDays: clampInteger(
      request.feedbackRetentionDays,
      DEFAULT_FEEDBACK_RETENTION_DAYS,
      1,
      MAX_DIAGNOSTIC_RETENTION_DAYS,
    ),
    pruneAuditEvents: request.pruneAuditEvents ?? true,
    pruneExpiredProviderCache: request.pruneExpiredProviderCache ?? true,
    pruneFeedback: request.pruneFeedback ?? true,
    resetPersistedTelemetry: request.resetPersistedTelemetry ?? false,
  };
}

export function normalizeSuggestionAuditRecordRequest(
  request: CommandSuggestionAuditRecordRequest,
): Required<
  Pick<
    CommandSuggestionAuditRecordRequest,
    "decision" | "eventKind" | "metadata" | "target"
  >
> &
  Omit<
    CommandSuggestionAuditRecordRequest,
    "decision" | "eventKind" | "metadata" | "target"
  > {
  const metadata = Object.fromEntries(
    Object.entries(request.metadata ?? {})
      .map(([key, value]) => [key.trim(), value.trim()] as const)
      .filter(([key]) => key.length > 0),
  );

  return {
    decision: request.decision,
    eventKind: request.eventKind,
    metadata,
    target: request.target ?? "local",
    ...(request.provider ? { provider: request.provider } : {}),
    ...(request.reason?.trim() ? { reason: request.reason.trim() } : {}),
    ...(request.remoteHostId?.trim()
      ? { remoteHostId: request.remoteHostId.trim() }
      : {}),
    ...(request.cwd?.trim() ? { cwd: request.cwd.trim() } : {}),
    ...(request.path?.trim() ? { path: request.path.trim() } : {}),
    ...(request.paneId?.trim() ? { paneId: request.paneId.trim() } : {}),
    ...(request.sessionId?.trim()
      ? { sessionId: request.sessionId.trim() }
      : {}),
  };
}

export function normalizeRemotePathRefreshRequest(
  request: CommandSuggestionRemotePathRefreshRequest,
): NormalizedCommandSuggestionRemotePathRefreshRequest {
  return {
    hostId: request.hostId.trim(),
    maxEntries: clamp(
      Math.trunc(request.maxEntries ?? DEFAULT_REMOTE_PATH_MAX_ENTRIES),
      1,
      MAX_REMOTE_PATH_MAX_ENTRIES,
    ),
    path: request.path.trim() || "/",
    ttlSeconds: clamp(
      Math.trunc(request.ttlSeconds ?? DEFAULT_REMOTE_PATH_TTL_SECONDS),
      1,
      MAX_REMOTE_PATH_TTL_SECONDS,
    ),
  };
}

export function normalizeRemoteCommandRefreshRequest(
  request: CommandSuggestionRemoteCommandRefreshRequest,
): NormalizedCommandSuggestionRemoteCommandRefreshRequest {
  return {
    hostId: request.hostId.trim(),
    maxEntries: clamp(
      Math.trunc(request.maxEntries ?? DEFAULT_REMOTE_COMMAND_MAX_ENTRIES),
      1,
      MAX_REMOTE_COMMAND_MAX_ENTRIES,
    ),
    ttlSeconds: clamp(
      Math.trunc(request.ttlSeconds ?? DEFAULT_REMOTE_COMMAND_TTL_SECONDS),
      1,
      MAX_REMOTE_COMMAND_TTL_SECONDS,
    ),
  };
}

export function normalizeRemoteHistoryRefreshRequest(
  request: CommandSuggestionRemoteHistoryRefreshRequest,
): NormalizedCommandSuggestionRemoteHistoryRefreshRequest {
  return {
    hostId: request.hostId.trim(),
    maxEntries: clamp(
      Math.trunc(request.maxEntries ?? DEFAULT_REMOTE_HISTORY_MAX_ENTRIES),
      1,
      MAX_REMOTE_HISTORY_MAX_ENTRIES,
    ),
    ttlSeconds: clamp(
      Math.trunc(request.ttlSeconds ?? DEFAULT_REMOTE_HISTORY_TTL_SECONDS),
      1,
      MAX_REMOTE_HISTORY_TTL_SECONDS,
    ),
  };
}

export function normalizeGitRefreshRequest(
  request: CommandSuggestionGitRefreshRequest,
): NormalizedCommandSuggestionGitRefreshRequest {
  return {
    cwd: request.cwd.trim() || "/",
    hostId: request.hostId.trim(),
    maxEntries: clamp(
      Math.trunc(request.maxEntries ?? DEFAULT_GIT_MAX_ENTRIES),
      1,
      MAX_GIT_MAX_ENTRIES,
    ),
    ttlSeconds: clamp(
      Math.trunc(request.ttlSeconds ?? DEFAULT_GIT_TTL_SECONDS),
      1,
      MAX_GIT_TTL_SECONDS,
    ),
  };
}

export async function listBrowserPreviewSuggestions(
  request: NormalizedCommandSuggestionRequest,
) {
  if (request.providers && !request.providers.includes("history")) {
    return [];
  }

  const prefix = commandPrefix(request);
  const history = await listCommandHistory({
    limit: request.limit,
    query: prefix.trim(),
    remoteHostId: request.remoteHostId,
    target: request.target,
  });

  return history
    .map((entry) => historyEntryToCandidate(entry, request, prefix))
    .filter((candidate): candidate is CommandSuggestionCandidate =>
      Boolean(candidate),
    )
    .slice(0, request.limit);
}

function historyEntryToCandidate(
  entry: CommandHistoryEntry,
  request: NormalizedCommandSuggestionRequest,
  prefix: string,
): CommandSuggestionCandidate | null {
  if (!entry.command.startsWith(prefix) || entry.command === prefix) {
    return null;
  }

  const suffix = entry.command.slice(prefix.length);
  const sameHost =
    entry.remoteHostId && entry.remoteHostId === request.remoteHostId;
  const sameCwd = entry.cwd && entry.cwd === request.cwd;

  return {
    acceptBoundaries: [],
    allowedPresentations: ["inline", "menu"],
    id: `history:${entry.id}`,
    provider: "history",
    displayText: entry.command,
    replacementText: entry.command,
    replacementRange: {
      start: 0,
      end: request.cursor,
    },
    suffix,
    score: 0.55 + (sameHost ? 0.2 : 0) + (sameCwd ? 0.2 : 0),
    sensitivity: "normal",
    description: sameCwd
      ? "历史命令，匹配当前目录"
      : sameHost
        ? "历史命令，匹配当前主机"
        : "历史命令",
    sourceId: entry.id,
    metadata: {
      createdAt: entry.createdAt,
      source: entry.source,
    },
    ...(request.contextKey ? { contextKey: request.contextKey } : {}),
  };
}

function commandPrefix(request: NormalizedCommandSuggestionRequest) {
  return unicodePrefix(request.input, request.cursor);
}

export function unicodePrefix(input: string, cursor: number) {
  return Array.from(input).slice(0, cursor).join("");
}

function normalizeGeneration(generation: number | undefined) {
  if (
    generation === undefined ||
    !Number.isSafeInteger(generation) ||
    generation < 0
  ) {
    return undefined;
  }
  return generation;
}

function normalizeReplacementRange(
  range: CommandSuggestionReplacementRange,
  request: NormalizedCommandSuggestionRequest,
): CommandSuggestionReplacementRange {
  const inputLength = Array.from(request.input).length;
  const valid =
    Number.isSafeInteger(range.start) &&
    Number.isSafeInteger(range.end) &&
    range.start >= 0 &&
    range.start <= range.end &&
    range.end <= request.cursor &&
    range.end <= inputLength;

  return valid ? range : { start: 0, end: request.cursor };
}

function normalizeAllowedPresentations(
  candidate: CommandSuggestionCandidatePayload,
): CommandSuggestionPresentation[] {
  if (candidate.sensitivity === "dangerous") {
    return ["menu"];
  }
  if (!candidate.allowedPresentations) {
    return ["inline"];
  }

  return Array.from(
    new Set(
      candidate.allowedPresentations.filter(
        (presentation): presentation is CommandSuggestionPresentation =>
          presentation === "inline" || presentation === "menu",
      ),
    ),
  );
}

function normalizeAcceptBoundaries(
  boundaries: number[] | undefined,
  cursor: number,
  replacementText: string,
) {
  if (!boundaries) {
    return [];
  }
  const replacementLength = Array.from(replacementText).length;
  if (
    boundaries.some(
      (boundary) =>
        !Number.isSafeInteger(boundary) ||
        boundary <= cursor ||
        boundary > replacementLength,
    )
  ) {
    return [];
  }
  return Array.from(new Set(boundaries)).sort((left, right) => left - right);
}

function normalizeProviders(
  providers: CommandSuggestionProvider[] | undefined,
) {
  if (!providers) {
    return undefined;
  }

  const unique = Array.from(new Set(providers));
  return unique.length > 0 ? unique : undefined;
}

function clampLimit(limit: number | undefined) {
  if (!Number.isFinite(limit)) {
    return DEFAULT_LIMIT;
  }
  return clamp(Math.trunc(limit ?? DEFAULT_LIMIT), 1, MAX_LIMIT);
}

function clampInteger(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
) {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return clamp(Math.trunc(value ?? fallback), min, max);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
