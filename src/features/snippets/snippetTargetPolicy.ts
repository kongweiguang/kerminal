import type { PaneSessionRecord } from "../terminal/session/index";

export type SnippetShell = "posix" | "powershell" | "cmd" | "unknown";
export type SnippetRisk = "inspect" | "change" | "destructive" | "unknown";

export interface SnippetTargetSnapshot {
  paneId: string;
  sessionId: string;
  targetId: string;
  displayName: string;
  production: boolean;
  connectionGeneration: number;
  capturedAt: number;
}

export interface SnippetExecutionPolicy {
  effectiveRisk: SnippetRisk;
  requiresConfirmation: boolean;
  requiresStrongConfirmation: boolean;
}

interface CreateSnippetTargetSnapshotInput {
  paneId: string;
  record: PaneSessionRecord;
  connectionGeneration: number;
  displayName?: string;
  production?: boolean;
  capturedAt?: number;
}

/**
 * 从现有运行态上下文生成不可变目标快照；该函数不发起本地或远程探测。
 */
export function createSnippetTargetSnapshot({
  paneId,
  record,
  connectionGeneration,
  displayName,
  production = false,
  capturedAt = Date.now(),
}: CreateSnippetTargetSnapshotInput): SnippetTargetSnapshot {
  return Object.freeze({
    paneId,
    sessionId: record.sessionId,
    targetId: record.targetRef ?? record.remoteHostId ?? record.sessionId,
    displayName: displayName?.trim() || record.targetRef || record.remoteHostId || "本地终端",
    production,
    connectionGeneration,
    capturedAt,
  });
}

/** 快照必须仍绑定相同 pane/session/target/generation，禁止确认期间静默改投。 */
export function isSnippetTargetSnapshotCurrent(
  snapshot: SnippetTargetSnapshot,
  current: SnippetTargetSnapshot | null,
): boolean {
  return Boolean(
    current &&
      snapshot.paneId === current.paneId &&
      snapshot.sessionId === current.sessionId &&
      snapshot.targetId === current.targetId &&
      snapshot.connectionGeneration === current.connectionGeneration,
  );
}

/** 片段只根据操作风险决定确认强度，不再探测或判定目标环境兼容性。 */
export function resolveSnippetExecutionPolicy({
  snapshot,
  risk,
  hasLegacyRaw = false,
  sensitive = false,
}: {
  snapshot: SnippetTargetSnapshot;
  risk: SnippetRisk;
  hasLegacyRaw?: boolean;
  sensitive?: boolean;
}): SnippetExecutionPolicy {
  const effectiveRisk = hasLegacyRaw && risk === "inspect" ? "change" : risk;
  const requiresConfirmation =
    snapshot.production ||
    sensitive ||
    effectiveRisk !== "inspect";
  return {
    effectiveRisk,
    requiresConfirmation,
    requiresStrongConfirmation: effectiveRisk === "destructive",
  };
}
