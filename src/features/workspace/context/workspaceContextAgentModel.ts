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

function bindingScore(
  target: ReturnType<typeof agentSessionRecordTarget>,
  context: WorkspaceContextAgentTarget,
) {
  if (!target) {
    return -1;
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
    liveStatus === "closed" ||
    liveStatus === "unbound"
    ? "stale"
    : "active";
}

/**
 * 只接受与当前 pane/tab/target 明确绑定的会话。
 * 未绑定会话不能作为兜底，避免把其它任务误标为当前上下文。
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
    const score = bindingScore(target, context);
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
