// @author kongweiguang
import {
  agentSessionRecordAgentId,
  agentSessionRecordId,
  agentSessionRecordTarget,
  type AgentSessionRecord,
  type AgentSessionScope,
  type AgentSessionTargetRequest,
  type ExternalAgentId,
} from "../../../lib/agentLauncherApi";
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
  permissionMode?: AgentLaunchPermissionMode;
  scope: AgentSessionScope;
  tabId: string;
  target?: AgentSessionTargetRequest;
}

/** 为当前标签选择可恢复的同类 Agent，并从持久记录恢复受限权限模式。 */
export function findPersistedAgentSession(
  tabId: string,
  agentId: ExternalAgentId,
  records: readonly AgentSessionRecord[],
): AgentSessionSelection | null {
  for (const record of restorableSessionsForTab(records, tabId)) {
    if (agentSessionRecordAgentId(record) !== agentId) {
      continue;
    }
    try {
      return {
        agentSessionId: agentSessionRecordId(record),
        permissionMode: agentSessionRecordPermissionMode(record),
        scope: agentSessionScopeFromId(tabId),
        tabId,
        target: agentSessionRecordTarget(record),
      };
    } catch {
      continue;
    }
  }
  return null;
}
