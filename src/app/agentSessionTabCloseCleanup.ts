// @author kongweiguang
import {
  agentSessionRecordId,
  agentSessionRecordStatus,
  agentSessionRecordTarget,
  archiveAgentSession,
  listAgentSessions,
  type AgentSessionList,
  type AgentSessionRecord,
} from "../lib/agentLauncherApi";

interface AgentSessionTabCloseCleanupDependencies {
  archiveSession: (agentSessionId: string) => Promise<AgentSessionRecord>;
  listSessions: () => Promise<AgentSessionList>;
}

const defaultDependencies: AgentSessionTabCloseCleanupDependencies = {
  archiveSession: archiveAgentSession,
  listSessions: listAgentSessions,
};

/** 归档已关闭终端 tab 绑定的会话，避免复用后的 tab id 恢复到失效 Agent。 */
export async function archiveAgentSessionsForClosedTabs(
  tabIds: readonly string[],
  dependencies: AgentSessionTabCloseCleanupDependencies = defaultDependencies,
): Promise<string[]> {
  const closedTabIds = new Set(tabIds.map(normalizedText).filter(Boolean));
  if (closedTabIds.size === 0) {
    return [];
  }

  const records = (await dependencies.listSessions()).sessions ?? [];
  const agentSessionIds = records
    .filter((record) => {
      if (agentSessionRecordStatus(record) === "archived") {
        return false;
      }
      const target = agentSessionRecordTarget(record);
      if (target?.liveStatus === "unbound") {
        return false;
      }
      const tabId = normalizedText(target?.tabId);
      return Boolean(tabId && closedTabIds.has(tabId));
    })
    .flatMap((record) => {
      try {
        return [agentSessionRecordId(record)];
      } catch {
        return [];
      }
    });
  const uniqueSessionIds = [...new Set(agentSessionIds)];

  await Promise.all(
    uniqueSessionIds.map((agentSessionId) =>
      dependencies.archiveSession(agentSessionId),
    ),
  );
  return uniqueSessionIds;
}

function normalizedText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
