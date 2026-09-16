// @author kongweiguang

import type { Dispatch, SetStateAction } from "react";
import {
  agentSessionRecordTarget,
  rebindAgentSessionTarget,
  type AgentSessionScope,
  type AgentSessionTargetRequest,
} from "../../../lib/agentLauncherApi";
import type { TerminalPane, TerminalTab } from "../../workspace/contracts/index";
import { buildAgentSessionTarget } from "./agentSessionTargetModel";

export interface AgentPreferredTargetSession {
  scope?: AgentSessionScope;
  tabId?: string;
  target?: AgentSessionTargetRequest;
}

interface AgentPreferredTargetCoordinatorOptions<T extends AgentPreferredTargetSession> {
  activeTab?: TerminalTab;
  focusedPane?: TerminalPane;
  globalScopeId: string;
  setRuntimeSessions: Dispatch<SetStateAction<Record<string, T>>>;
}

export interface AgentPreferredTargetCoordinator<T extends AgentPreferredTargetSession> {
  isGlobalAgentSession(session: T | AgentPreferredTargetSession): boolean;
  persistPreferredTarget(
    agentSessionId: string,
    session: T | AgentPreferredTargetSession,
  ): Promise<AgentSessionTargetRequest | undefined>;
  preferredTargetForSession(
    session: T | AgentPreferredTargetSession,
  ): AgentSessionTargetRequest | undefined;
  updateRuntimePreferredTarget(
    agentSessionId: string,
    target: AgentSessionTargetRequest | undefined,
  ): void;
}

/**
 * 集中管理 global Agent 的 preferred target；只有显式恢复/继续才触发 rebind，
 * Tab 上下文重渲染只读当前 pane，避免把普通切 Tab 误当成用户操作。
 */
export function createAgentPreferredTargetCoordinator<
  T extends AgentPreferredTargetSession,
>({
  activeTab,
  focusedPane,
  globalScopeId,
  setRuntimeSessions,
}: AgentPreferredTargetCoordinatorOptions<T>): AgentPreferredTargetCoordinator<T> {
  /** global 会话以当前 pane 作为首选，Tab 会话继续使用其持久 target。 */
  function preferredTargetForSession(
    session: T | AgentPreferredTargetSession,
  ): AgentSessionTargetRequest | undefined {
    return isGlobalAgentSession(session)
      ? buildAgentSessionTarget(focusedPane, activeTab) ?? session.target
      : session.target;
  }

  /** 显式恢复/继续 global Agent 时写回 target；无 live pane 时不伪造绑定。 */
  async function persistPreferredTarget(
    agentSessionId: string,
    session: T | AgentPreferredTargetSession,
  ): Promise<AgentSessionTargetRequest | undefined> {
    const preferredTarget = buildAgentSessionTarget(focusedPane, activeTab);
    const target = preferredTarget ?? session.target;
    if (!preferredTarget || !isGlobalAgentSession(session)) {
      return target;
    }
    const reboundRecord = await rebindAgentSessionTarget(
      agentSessionId,
      preferredTarget,
    );
    return agentSessionRecordTarget(reboundRecord) ?? preferredTarget;
  }

  /** 兼容 canonical global、旧 sentinel 和 unbound target 三种运行态表示。 */
  function isGlobalAgentSession(
    session: T | AgentPreferredTargetSession,
  ): boolean {
    return (
      session.scope?.kind === "global" ||
      session.target?.liveStatus === "unbound" ||
      session.tabId === globalScopeId
    );
  }

  /** rebind 成功后同步右栏快照，避免下一次切回继续使用旧 preferred target。 */
  function updateRuntimePreferredTarget(
    agentSessionId: string,
    target: AgentSessionTargetRequest | undefined,
  ) {
    if (!target) {
      return;
    }
    setRuntimeSessions((current) => {
      const session = current[agentSessionId];
      return session
        ? { ...current, [agentSessionId]: { ...session, target } }
        : current;
    });
  }

  return {
    isGlobalAgentSession,
    persistPreferredTarget,
    preferredTargetForSession,
    updateRuntimePreferredTarget,
  };
}
