// @author kongweiguang
import {
  agentSessionRecordAgentId,
  agentSessionRecordId,
  agentSessionRecordLaunchCommand,
  agentSessionRecordLauncherKey,
  agentSessionRecordTarget,
  type AgentSessionRecord,
  type AgentSessionScope,
  type AgentSessionTargetRequest,
  type ExternalAgentId,
} from "../../../lib/agentLauncherApi";
import {
  BUILTIN_CLAUDE_AGENT_KEY,
  BUILTIN_CODEX_AGENT_KEY,
  BUILTIN_PI_AGENT_KEY,
} from "../../settings/contracts/index";
import {
  agentSessionRecordPermissionMode,
  type AgentLaunchPermissionMode,
} from "./agentLauncherModel";
import {
  agentSessionScopeFromId,
  restorableSessionsForTab,
} from "./agentTabSessionModel";

export interface AgentSessionSelection {
  agentSessionId: string;
  customCommand?: string;
  launcherKey?: string;
  permissionMode?: AgentLaunchPermissionMode;
  scope: AgentSessionScope;
  tabId: string;
  target?: AgentSessionTargetRequest;
  title: string;
}

export interface AgentSessionMatcher {
  agentId: ExternalAgentId;
  customCommand?: string;
  launcherKey: string;
  permissionMode: AgentLaunchPermissionMode;
}

/** 为当前标签选择可恢复的同类 Agent，并从持久记录恢复受限权限模式。 */
export function findPersistedAgentSession(
  tabId: string,
  matcher: AgentSessionMatcher,
  records: readonly AgentSessionRecord[],
): AgentSessionSelection | null {
  for (const record of restorableSessionsForTab(records, tabId)) {
    if (!recordMatchesLauncher(record, matcher)) {
      continue;
    }
    const selection = persistedAgentSessionSelection(record, tabId);
    if (selection) {
      return {
        ...selection,
        launcherKey: selection.launcherKey ?? matcher.launcherKey,
      };
    }
  }
  return null;
}

/** 从历史记录恢复不可变名称/命令快照；旧 Custom 缺少 launcherKey 时保持为空。 */
export function persistedAgentSessionSelection(
  record: AgentSessionRecord,
  tabId: string,
): AgentSessionSelection | null {
  try {
    return {
      agentSessionId: agentSessionRecordId(record),
      customCommand:
        agentSessionRecordAgentId(record) === "custom"
          ? agentSessionRecordLaunchCommand(record)
          : undefined,
      launcherKey: resolvedRecordLauncherKey(record),
      permissionMode: agentSessionRecordPermissionMode(record),
      scope: agentSessionScopeFromId(tabId),
      tabId,
      target: agentSessionRecordTarget(record),
      title: record.session.title,
    };
  } catch {
    return null;
  }
}

/**
 * 恢复候选同时匹配 provider、launcherKey 和权限模式；历史“继续”不经过本函数，
 * 因而仍可显式沿用创建时的完整快照。
 */
function recordMatchesLauncher(
  record: AgentSessionRecord,
  matcher: AgentSessionMatcher,
): boolean {
  if (agentSessionRecordAgentId(record) !== matcher.agentId) {
    return false;
  }
  if (agentSessionRecordPermissionMode(record) !== matcher.permissionMode) {
    return false;
  }
  const recordLauncherKey = agentSessionRecordLauncherKey(record);
  if (recordLauncherKey) {
    return recordLauncherKey === matcher.launcherKey;
  }
  if (matcher.agentId !== "custom") {
    return resolvedRecordLauncherKey(record) === matcher.launcherKey;
  }
  return (
    normalizeCommand(agentSessionRecordLaunchCommand(record)) ===
    normalizeCommand(matcher.customCommand)
  );
}

/** 内置旧会话可从 agentId 推导 key；Custom 必须依赖新字段或命令兼容。 */
function resolvedRecordLauncherKey(
  record: AgentSessionRecord,
): string | undefined {
  const explicit = agentSessionRecordLauncherKey(record);
  if (explicit) {
    return explicit;
  }
  const agentId = agentSessionRecordAgentId(record);
  return agentId === "codex"
    ? BUILTIN_CODEX_AGENT_KEY
    : agentId === "claude"
      ? BUILTIN_CLAUDE_AGENT_KEY
      : agentId === "pi"
        ? BUILTIN_PI_AGENT_KEY
        : undefined;
}

/** 命令兼容只忽略首尾空白，不重写参数或引号语义。 */
function normalizeCommand(command: string | undefined): string {
  return command?.trim() ?? "";
}
