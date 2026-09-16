// @author kongweiguang
import { useEffect } from "react";
import {
  consumeAgentSendRequest,
  type AgentSendRequest,
} from "../../agent-workflow/state/index";
import type { TerminalPane, TerminalTab } from "../../workspace/contracts/index";
import type { UserFacingMessage } from "../../../lib/userFacingMessage";
import type { AgentTerminalSession } from "./AgentTerminalView";
import type { AgentSendPreviewSource } from "./agentSendPreviewModel";
import { agentSessionScopeId } from "./agentTabSessionModel";

interface UseAgentSendRequestCoordinatorInput {
  activeTab?: TerminalTab;
  agentScopeId: string;
  createPreview: (
    source: AgentSendPreviewSource,
    override?: {
      activeTab?: TerminalTab;
      focusedPane?: TerminalPane;
      session?: AgentTerminalSession;
    },
  ) => boolean;
  consumeRequest?: (requestId: number) => void;
  onActivateSession: (tabId: string, agentSessionId: string) => void;
  preferredSessionId?: string;
  request: AgentSendRequest | null;
  sessions: readonly AgentTerminalSession[];
  setActionError: (message: UserFacingMessage | null) => void;
  targetPane?: TerminalPane;
}

/** 将终端对象动作交给绑定该 pane 的 Agent 会话；无运行会话时短暂等待用户继续或新建。 */
export function useAgentSendRequestCoordinator({
  activeTab,
  agentScopeId,
  createPreview,
  consumeRequest = consumeAgentSendRequest,
  onActivateSession,
  preferredSessionId,
  request,
  sessions,
  setActionError,
  targetPane,
}: UseAgentSendRequestCoordinatorInput) {
  useEffect(() => {
    if (!request) {
      return undefined;
    }
    const clearDelay = Math.max(0, request.expiresAt - Date.now());
    const clearTimer = window.setTimeout(
      () => consumeRequest(request.id),
      clearDelay,
    );
    if (!targetPane || targetPane.id !== request.paneId) {
      consumeRequest(request.id);
      setActionError({
        recoveryAction: "请回到原终端重新选择要发送的内容。",
        severity: "warning",
        title: "目标终端已经不可用",
      });
      return () => window.clearTimeout(clearTimer);
    }
    if (request.tabId && activeTab?.id !== request.tabId) {
      consumeRequest(request.id);
      setActionError({
        recoveryAction: "请回到原终端标签，重新选择需要发送的内容。",
        severity: "warning",
        title: "发送请求已取消",
      });
      return () => window.clearTimeout(clearTimer);
    }

    const scopedSessions = sessions.filter(
      (session) =>
        session.tabId === agentScopeId || isGlobalAgentSession(session),
    );
    const matchingSessions = scopedSessions.filter(
      (candidate) =>
        isGlobalAgentSession(candidate) || candidate.target?.paneId === request.paneId,
    );
    const session =
      matchingSessions.find(
        (candidate) => candidate.agentSessionId === preferredSessionId,
      ) ?? (matchingSessions.length === 1 ? matchingSessions[0] : undefined);
    if (!session) {
      setActionError(null);
      return () => window.clearTimeout(clearTimer);
    }

    const created = createPreview(request.source, {
      activeTab,
      focusedPane: targetPane,
      session,
    });
    consumeRequest(request.id);
    if (!created) {
      return () => window.clearTimeout(clearTimer);
    }
    onActivateSession(session.tabId, session.agentSessionId);
    setActionError(null);
    return () => window.clearTimeout(clearTimer);
  }, [
    activeTab,
    agentScopeId,
    createPreview,
    consumeRequest,
    onActivateSession,
    preferredSessionId,
    request,
    sessions,
    setActionError,
    targetPane,
  ]);
}

/** 全局 Agent 可接收任一用户终端的上下文发送；Tab Agent 仍只匹配其目标 pane。 */
function isGlobalAgentSession(session: AgentTerminalSession): boolean {
  return (
    session.scope?.kind === "global" ||
    session.target?.liveStatus === "unbound" ||
    session.tabId === agentSessionScopeId({ kind: "global" })
  );
}
