import { invoke, isTauri } from "@tauri-apps/api/core";

export type CommandHistoryTarget =
  "local" | "ssh" | "telnet" | "serial" | "dockerContainer";
export type CommandHistorySource =
  "user" | "snippet" | "workflow" | "broadcast" | "tool";

export interface CommandHistoryEntry {
  id: string;
  command: string;
  source: CommandHistorySource;
  target: CommandHistoryTarget;
  sessionId?: string | null;
  paneId?: string | null;
  tabId?: string | null;
  profileId?: string | null;
  remoteHostId?: string | null;
  cwd?: string | null;
  shell?: string | null;
  createdAt: string;
}

export interface CommandHistoryListRequest {
  query?: string;
  source?: CommandHistorySource;
  target?: CommandHistoryTarget;
  paneId?: string;
  remoteHostId?: string;
  sessionId?: string;
  limit?: number;
}

/** 命令历史清理范围；空对象保留全局清空的兼容语义。 */
export type CommandHistoryClearRequest = Pick<
  CommandHistoryListRequest,
  "paneId" | "remoteHostId" | "sessionId" | "target"
>;

export interface CommandHistoryRecordRequest {
  command: string;
  source?: CommandHistorySource;
  target?: CommandHistoryTarget;
  record?: boolean;
  sessionId?: string;
  paneId?: string;
  tabId?: string;
  profileId?: string;
  remoteHostId?: string;
  cwd?: string;
  shell?: string;
}

export interface CommandHistoryRecordResult {
  recorded: boolean;
  entry?: CommandHistoryEntry | null;
  skipReason?: string | null;
}

interface NormalizedCommandHistoryRecordRequest {
  command: string;
  source: CommandHistorySource;
  target: CommandHistoryTarget;
  record?: boolean;
  sessionId?: string;
  paneId?: string;
  tabId?: string;
  profileId?: string;
  remoteHostId?: string;
  cwd?: string;
  shell?: string;
}

const browserPreviewHistory = new Map<string, CommandHistoryEntry>(
  [
    previewHistory({
      command: "git status --short",
      id: "history-preview-git",
      source: "user",
      target: "local",
      cwd: "C:/dev/rust/kerminal",
      shell: "pwsh.exe",
    }),
    previewHistory({
      command: "journalctl -u app.service -n 200 --no-pager",
      id: "history-preview-log",
      source: "tool",
      target: "ssh",
      remoteHostId: "prod-api",
      shell: "ssh",
    }),
  ].map((entry) => [entry.id, entry]),
);

export async function listCommandHistory(
  request: CommandHistoryListRequest = {},
): Promise<CommandHistoryEntry[]> {
  const normalized = normalizeListRequest(request);

  if (!isTauri()) {
    return browserPreviewList(normalized);
  }

  return invoke<CommandHistoryEntry[]>("command_history_list", {
    request: normalized,
  });
}

export async function recordCommandHistory(
  request: CommandHistoryRecordRequest,
): Promise<CommandHistoryRecordResult> {
  const normalized = normalizeRecordRequest(request);

  if (!isTauri()) {
    if (normalized.record === false) {
      return {
        recorded: false,
        entry: null,
        skipReason: "当前会话已禁用命令历史记录",
      };
    }
    const entry = previewHistory({
      ...normalized,
      id: `history-preview-${Date.now().toString(36)}`,
    });
    browserPreviewHistory.set(entry.id, entry);
    return { recorded: true, entry, skipReason: null };
  }

  return invoke<CommandHistoryRecordResult>("command_history_record", {
    request: normalized,
  });
}

export async function deleteCommandHistory(entryId: string): Promise<boolean> {
  if (!isTauri()) {
    return browserPreviewHistory.delete(entryId);
  }

  return invoke<boolean>("command_history_delete", { entryId });
}

export async function clearCommandHistory(
  request: CommandHistoryClearRequest = {},
): Promise<number> {
  const normalized = normalizeScopeRequest(request);
  if (!isTauri()) {
    const matchingIds = Array.from(browserPreviewHistory.values())
      .filter((entry) => historyMatchesScope(entry, normalized))
      .map((entry) => entry.id);
    for (const entryId of matchingIds) {
      browserPreviewHistory.delete(entryId);
    }
    return matchingIds.length;
  }

  return invoke<number>("command_history_clear", { request: normalized });
}

function normalizeListRequest(
  request: CommandHistoryListRequest,
): CommandHistoryListRequest {
  return {
    ...(request.query?.trim() ? { query: request.query.trim() } : {}),
    ...(request.source ? { source: request.source } : {}),
    ...(request.target ? { target: request.target } : {}),
    ...(request.paneId?.trim() ? { paneId: request.paneId.trim() } : {}),
    ...(request.remoteHostId?.trim()
      ? { remoteHostId: request.remoteHostId.trim() }
      : {}),
    ...(request.sessionId?.trim()
      ? { sessionId: request.sessionId.trim() }
      : {}),
    limit: clampLimit(request.limit),
  };
}

function normalizeScopeRequest(
  request: CommandHistoryClearRequest,
): CommandHistoryClearRequest {
  return {
    ...(request.target ? { target: request.target } : {}),
    ...(request.paneId?.trim() ? { paneId: request.paneId.trim() } : {}),
    ...(request.remoteHostId?.trim()
      ? { remoteHostId: request.remoteHostId.trim() }
      : {}),
    ...(request.sessionId?.trim()
      ? { sessionId: request.sessionId.trim() }
      : {}),
  };
}

function normalizeRecordRequest(
  request: CommandHistoryRecordRequest,
): NormalizedCommandHistoryRecordRequest {
  return {
    command: request.command,
    source: request.source ?? "user",
    target: request.target ?? "local",
    ...(request.record === false ? { record: false } : {}),
    ...(request.sessionId?.trim()
      ? { sessionId: request.sessionId.trim() }
      : {}),
    ...(request.paneId?.trim() ? { paneId: request.paneId.trim() } : {}),
    ...(request.tabId?.trim() ? { tabId: request.tabId.trim() } : {}),
    ...(request.profileId?.trim()
      ? { profileId: request.profileId.trim() }
      : {}),
    ...(request.remoteHostId?.trim()
      ? { remoteHostId: request.remoteHostId.trim() }
      : {}),
    ...(request.cwd?.trim() ? { cwd: request.cwd.trim() } : {}),
    ...(request.shell?.trim() ? { shell: request.shell.trim() } : {}),
  };
}

function clampLimit(limit: number | undefined) {
  if (!Number.isFinite(limit)) {
    return 100;
  }
  return Math.min(Math.max(Math.trunc(limit ?? 100), 1), 500);
}

function browserPreviewList(request: CommandHistoryListRequest) {
  const query = request.query?.toLowerCase();
  return Array.from(browserPreviewHistory.values())
    .filter((entry) => !request.source || entry.source === request.source)
    .filter((entry) => !request.target || entry.target === request.target)
    .filter((entry) =>
      request.paneId ? entry.paneId === request.paneId : true,
    )
    .filter((entry) =>
      request.remoteHostId ? entry.remoteHostId === request.remoteHostId : true,
    )
    .filter((entry) =>
      request.sessionId ? entry.sessionId === request.sessionId : true,
    )
    .filter((entry) => (query ? historyMatchesQuery(entry, query) : true))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, request.limit ?? 100);
}

function historyMatchesScope(
  entry: CommandHistoryEntry,
  request: CommandHistoryClearRequest,
) {
  return (
    (!request.target || entry.target === request.target) &&
    (!request.paneId || entry.paneId === request.paneId) &&
    (!request.remoteHostId || entry.remoteHostId === request.remoteHostId) &&
    (!request.sessionId || entry.sessionId === request.sessionId)
  );
}

function historyMatchesQuery(entry: CommandHistoryEntry, query: string) {
  return (
    entry.command.toLowerCase().includes(query) ||
    (entry.cwd ?? "").toLowerCase().includes(query) ||
    (entry.shell ?? "").toLowerCase().includes(query) ||
    (entry.remoteHostId ?? "").toLowerCase().includes(query)
  );
}

function previewHistory(
  input: Pick<CommandHistoryEntry, "command" | "id" | "source" | "target"> &
    Partial<
      Pick<
        CommandHistoryEntry,
        | "cwd"
        | "paneId"
        | "profileId"
        | "remoteHostId"
        | "sessionId"
        | "shell"
        | "tabId"
      >
    >,
): CommandHistoryEntry {
  return {
    command: input.command.trim(),
    createdAt: new Date().toISOString(),
    cwd: input.cwd ?? null,
    id: input.id,
    paneId: input.paneId ?? null,
    profileId: input.profileId ?? null,
    remoteHostId: input.remoteHostId ?? null,
    sessionId: input.sessionId ?? null,
    shell: input.shell ?? null,
    source: input.source,
    tabId: input.tabId ?? null,
    target: input.target,
  };
}
