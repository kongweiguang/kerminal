// @author kongweiguang
import {
  agentSessionRecordId,
  agentSessionRecordStatus,
  agentSessionRecordTarget,
  type AgentTargetLiveStatus,
  type AgentSessionRecord,
} from "../../../lib/agentLauncherApi";
import type { WorkspaceContextAgent } from "./workspaceContextTypes";

export interface WorkspaceContextAgentTarget {
  readonly activeTabId: string | null;
  readonly focusedPaneId: string | null;
  readonly targetId: string | null;
}

interface RankedAgentSession {
  readonly agent: WorkspaceContextAgent;
  readonly bindingScore: number;
  readonly statusScore: number;
  readonly updatedAt: number;
}

/** 新 scope 是主授权边界；只有旧记录才继续使用单 pane target 评分。 */
function bindingScore(
  record: AgentSessionRecord,
  context: WorkspaceContextAgentTarget,
) {
  const scope = record.session.scope;
  if (scope?.kind === "tab") {
    const tabId = scope.tabId ?? ("tab_id" in scope ? scope.tab_id : undefined);
    return context.activeTabId && tabId === context.activeTabId ? 250 : -1;
  }
  if (scope?.kind === "global") {
    return 50;
  }
  const target = agentSessionRecordTarget(record);
  if (!target) {
    return 50;
  }
  if (context.focusedPaneId && target.paneId === context.focusedPaneId) {
    return 300;
  }
  if (
    context.activeTabId &&
    target.tabId === context.activeTabId &&
    !target.paneId
  ) {
    return 200;
  }
  if (
    !context.focusedPaneId &&
    context.activeTabId &&
    target.tabId === context.activeTabId
  ) {
    return 180;
  }
  if (context.targetId && target.targetRef === context.targetId) {
    return 100;
  }
  return -1;
}

function timestamp(record: AgentSessionRecord) {
  const value = record.session.updatedAt ?? record.session.updated_at;
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function sessionStatus(
  record: AgentSessionRecord,
  liveStatus: AgentTargetLiveStatus | undefined,
): WorkspaceContextAgent["status"] {
  return agentSessionRecordStatus(record) === "stale" ||
    liveStatus === "stale" ||
    liveStatus === "closed"
    ? "stale"
    : "active";
}

/**
 * tab scope 优先匹配当前 Tab；global scope 可作为整个 Kerminal 的低优先级兜底。
 * legacy target 仅用于迁移期评分，unbound/无 target 按新语义解释为 global。
 */
export function resolveWorkspaceContextAgent(
  context: WorkspaceContextAgentTarget,
  records: readonly AgentSessionRecord[],
): WorkspaceContextAgent {
  const ranked = records.flatMap<RankedAgentSession>((record) => {
    if (agentSessionRecordStatus(record) === "archived") {
      return [];
    }
    const target = agentSessionRecordTarget(record);
    const score = bindingScore(record, context);
    if (score < 0) {
      return [];
    }
    let sessionId: string;
    try {
      sessionId = agentSessionRecordId(record);
    } catch {
      return [];
    }
    const status = sessionStatus(record, target?.liveStatus);
    const title = record.session.title.trim();
    return [
      {
        agent: {
          sessionId,
          status,
          ...(title ? { title } : {}),
        },
        bindingScore: score,
        statusScore: status === "active" ? 1 : 0,
        updatedAt: timestamp(record),
      },
    ];
  });

  ranked.sort(
    (left, right) =>
      right.bindingScore - left.bindingScore ||
      right.statusScore - left.statusScore ||
      right.updatedAt - left.updatedAt ||
      (left.agent.sessionId ?? "").localeCompare(right.agent.sessionId ?? ""),
  );
  return ranked[0]?.agent ?? { sessionId: null, status: "unavailable" };
}
