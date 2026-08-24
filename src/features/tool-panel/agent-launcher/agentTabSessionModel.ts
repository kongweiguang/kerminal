// @author kongweiguang
import {
  agentSessionRecordId,
  agentSessionRecordStatus,
  agentSessionRecordTarget,
  type AgentSessionScope,
  type AgentSessionRecord,
  type AgentSessionTargetRequest,
  type ExternalAgentId,
  type ExternalAgentSessionStatus,
} from "../../../lib/agentLauncherApi";
import type { AgentLaunchPermissionMode } from "./agentLauncherModel";

export const GLOBAL_AGENT_SESSION_SCOPE_ID = "__kerminal_agent_global__";
/** 旧常量保留导出，值指向新的稳定全局作用域，避免升级后重建本地映射。 */
export const UNBOUND_AGENT_SESSION_SCOPE_ID = GLOBAL_AGENT_SESSION_SCOPE_ID;
const LEGACY_UNBOUND_AGENT_SESSION_SCOPE_ID = "__kerminal_agent_unbound__";

export interface AgentSidebarTabSession {
  agentId: ExternalAgentId;
  agentSessionId: string;
  customCommand?: string;
  launcherKey?: string;
  permissionMode: AgentLaunchPermissionMode;
  scope?: AgentSessionScope;
  status: ExternalAgentSessionStatus;
  tabId: string;
  target?: AgentSessionTargetRequest;
}

export interface AgentSidebarSessionState {
  activeSessionIdByTabId: Record<string, string | undefined>;
  sessionsById: Record<string, AgentSidebarTabSession>;
  viewByTabId: Record<string, "launcher" | "terminal">;
}

export interface TabRemovedCleanupPlan {
  removedTabIds: string[];
  agentSessionIds: string[];
}

/** 以 scope 优先解析运行态会话；旧 unbound 统一迁移为整个 Kerminal。 */
export function agentSessionTabId(
  session: Pick<AgentSidebarTabSession, "tabId" | "target" | "scope">,
): string | undefined {
  const scope = sessionScope(session);
  return scopeId(scope);
}

export interface AgentRuntimeSessionMatcher {
  agentId: ExternalAgentId;
  customCommand?: string;
  launcherKey: string;
}

/** 把 tab 或显式 scope 变成可用于内存映射的稳定 key；global key 永不随 tab 生命周期变化。 */
export function agentSessionScopeId(
  scopeOrTabId: AgentSessionScope | string | undefined,
): string {
  if (typeof scopeOrTabId === "object") {
    return scopeId(scopeOrTabId);
  }
  const normalized = normalizedText(scopeOrTabId);
  if (!normalized || normalized === LEGACY_UNBOUND_AGENT_SESSION_SCOPE_ID) {
    return GLOBAL_AGENT_SESSION_SCOPE_ID;
  }
  return normalized;
}

/** 把运行态 scope key 还原成显式权限模型，避免调用方复制 global sentinel 判断。 */
export function agentSessionScopeFromId(scopeId: string | undefined): AgentSessionScope {
  const normalized = agentSessionScopeId(scopeId);
  return normalized === GLOBAL_AGENT_SESSION_SCOPE_ID
    ? { kind: "global" }
    : { kind: "tab", tabId: normalized };
}

export function visibleAgentSessionForTab(
  state: AgentSidebarSessionState,
  tabId: string | undefined,
): AgentSidebarTabSession | undefined {
  const normalizedTabId = agentSessionScopeId(tabId);
  const sessionId = state.activeSessionIdByTabId[normalizedTabId];
  if (!sessionId) {
    return undefined;
  }
  const session = state.sessionsById[sessionId];
  if (!session) {
    return undefined;
  }
  return agentSessionTabId(session) === normalizedTabId ? session : undefined;
}

export function findRunningSessionForTabAgent(
  state: AgentSidebarSessionState,
  tabId: string | undefined,
  matcher: AgentRuntimeSessionMatcher,
  permissionMode: AgentLaunchPermissionMode,
): AgentSidebarTabSession | undefined {
  const normalizedTabId = agentSessionScopeId(tabId);
  return Object.values(state.sessionsById).find((session) => {
    if (agentSessionTabId(session) !== normalizedTabId) {
      return false;
    }
    if (
      session.agentId !== matcher.agentId ||
      session.permissionMode !== permissionMode
    ) {
      return false;
    }
    if (!isRunningSidebarSessionStatus(session.status)) {
      return false;
    }
    return sessionMatchesLauncher(session, matcher);
  });
}

/** 新运行态优先按 launcherKey 隔离；旧 Custom 只有命令完全相同时才可复用。 */
function sessionMatchesLauncher(
  session: AgentSidebarTabSession,
  matcher: AgentRuntimeSessionMatcher,
): boolean {
  const sessionLauncherKey = session.launcherKey?.trim();
  if (sessionLauncherKey) {
    return sessionLauncherKey === matcher.launcherKey;
  }
  if (matcher.agentId === "custom") {
    return (
      normalizeCustomCommand(session.customCommand) ===
      normalizeCustomCommand(matcher.customCommand)
    );
  }
  return matcher.launcherKey === `builtin:${matcher.agentId}`;
}

export function tabRemovedCleanupPlan(
  previousTabIds: readonly string[],
  nextTabIds: readonly string[],
  state: AgentSidebarSessionState,
): TabRemovedCleanupPlan {
  const nextIds = new Set(nextTabIds.map(normalizedText).filter(Boolean));
  const removedTabIds = previousTabIds
    .map(normalizedText)
    .filter((tabId): tabId is string => Boolean(tabId) && !nextIds.has(tabId));
  const removedSet = new Set(removedTabIds);
  const agentSessionIds = Object.values(state.sessionsById)
    .filter((session) => {
      const tabId = agentSessionTabId(session);
      return Boolean(tabId && removedSet.has(tabId));
    })
    .map((session) => session.agentSessionId);
  return {
    agentSessionIds: [...new Set(agentSessionIds)],
    removedTabIds,
  };
}

export function restorableSessionsForTab(
  records: readonly AgentSessionRecord[],
  tabId: string | undefined,
): AgentSessionRecord[] {
  const normalizedTabId = agentSessionScopeId(tabId);
  return records.filter((record) => {
    if (agentSessionRecordStatus(record) !== "active") {
      return false;
    }
    return agentSessionRecordTabId(record) === normalizedTabId;
  });
}

/** 为恢复列表返回 scope key；没有新字段的历史记录按 legacy target 兼容推断。 */
export function agentSessionRecordTabId(
  record: AgentSessionRecord,
): string | undefined {
  return agentSessionScopeId(recordScope(record));
}

export function agentSessionRecordIds(
  records: readonly AgentSessionRecord[],
): string[] {
  return records.map((record) => agentSessionRecordId(record));
}

function isRunningSidebarSessionStatus(
  status: ExternalAgentSessionStatus,
): boolean {
  return status === "starting" || status === "running";
}

function normalizeCustomCommand(command: string | undefined): string {
  return command?.trim() ?? "";
}

function normalizedText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/** 兼容 runtime 旧字段；旧 unbound 为 global，旧 bound 继续按 target/tab 还原。 */
function sessionScope(
  session: Pick<AgentSidebarTabSession, "tabId" | "target" | "scope">,
): AgentSessionScope {
  if (session.scope) {
    return session.scope;
  }
  const tabId = normalizedText(session.tabId);
  if (
    tabId === GLOBAL_AGENT_SESSION_SCOPE_ID ||
    tabId === LEGACY_UNBOUND_AGENT_SESSION_SCOPE_ID
  ) {
    return { kind: "global" };
  }
  if (session.target?.liveStatus === "unbound") {
    return { kind: "global" };
  }
  const targetTabId = normalizedText(session.target?.tabId);
  if (targetTabId) {
    return { kind: "tab", tabId: targetTabId };
  }
  return tabId ? { kind: "tab", tabId } : { kind: "global" };
}

/** 将已校验的 scope 投影为内存索引；global 使用固定值而非任意 Tab id。 */
function scopeId(scope: AgentSessionScope): string {
  return scope.kind === "tab" ? scope.tabId : GLOBAL_AGENT_SESSION_SCOPE_ID;
}

/** 读取新 scope，并将旧 target/unbound 记录收敛到 global 或 tab key。 */
function recordScope(record: AgentSessionRecord): AgentSessionScope {
  const rawScope = record.session.scope as
    | { kind?: "tab" | "global"; tabId?: string; tab_id?: string }
    | null
    | undefined;
  if (rawScope?.kind === "global") {
    return { kind: "global" };
  }
  if (rawScope?.kind === "tab") {
    const tabId = normalizedText(rawScope.tabId ?? rawScope.tab_id);
    if (tabId) {
      return { kind: "tab", tabId };
    }
  }
  const target = agentSessionRecordTarget(record);
  if (target?.liveStatus === "unbound") {
    return { kind: "global" };
  }
  const targetTabId = normalizedText(target?.tabId);
  return targetTabId ? { kind: "tab", tabId: targetTabId } : { kind: "global" };
}
