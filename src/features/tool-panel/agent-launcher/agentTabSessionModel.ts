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

/**
 * 解析右栏会话归属；旧 global 记录若留有目标 Tab，优先回到该 Tab，避免同一
 * 历史助手在每个 Tab 重复出现。scope 仍由 Rust 单独投影为全局终端权限。
 */
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

/** 将会话归属转换为内存索引；无 Tab 的旧全局记录使用稳定 fallback key。 */
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

/** 将会话归属 key 还原为持久化 scope 形状，避免调用方复制 sentinel 判断。 */
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

/** 返回当前 Tab 可恢复的 active 记录，绝不把一个助手恢复到其它 Tab。 */
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

/** 为恢复列表返回右栏 Tab 归属；旧 global 记录优先使用其最后保存的目标 Tab。 */
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

/** 兼容运行态旧字段；已保存的 Tab 归属优先，旧 global 则按最后目标 Tab 落位。 */
function sessionScope(
  session: Pick<AgentSidebarTabSession, "tabId" | "target" | "scope">,
): AgentSessionScope {
  if (session.scope?.kind === "tab") {
    return session.scope;
  }
  const targetTabId = normalizedText(session.target?.tabId);
  if (targetTabId) {
    return { kind: "tab", tabId: targetTabId };
  }
  if (session.scope?.kind === "global" || session.target?.liveStatus === "unbound") {
    return { kind: "global" };
  }
  const tabId = normalizedText(session.tabId);
  if (
    tabId === GLOBAL_AGENT_SESSION_SCOPE_ID ||
    tabId === LEGACY_UNBOUND_AGENT_SESSION_SCOPE_ID
  ) {
    return { kind: "global" };
  }
  return tabId ? { kind: "tab", tabId } : { kind: "global" };
}

/** 将已校验的 scope 投影为内存索引；global 使用固定值而非任意 Tab id。 */
function scopeId(scope: AgentSessionScope): string {
  return scope.kind === "tab" ? scope.tabId : GLOBAL_AGENT_SESSION_SCOPE_ID;
}

/** 读取保存的 Tab 归属，并把旧 global 记录按最后目标 Tab 兼容落位。 */
function recordScope(record: AgentSessionRecord): AgentSessionScope {
  const rawScope = record.session.scope as
    | { kind?: "tab" | "global"; tabId?: string; tab_id?: string }
    | null
    | undefined;
  if (rawScope?.kind === "tab") {
    const tabId = normalizedText(rawScope.tabId ?? rawScope.tab_id);
    if (tabId) {
      return { kind: "tab", tabId };
    }
  }
  const target = agentSessionRecordTarget(record);
  const targetTabId = normalizedText(target?.tabId);
  if (targetTabId) {
    return { kind: "tab", tabId: targetTabId };
  }
  if (rawScope?.kind === "global" || target?.liveStatus === "unbound") {
    return { kind: "global" };
  }
  return { kind: "global" };
}
