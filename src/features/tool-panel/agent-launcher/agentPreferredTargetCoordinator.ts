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
 * 集中管理每个 Tab 助手的首选终端；普通切换只读取上下文，只有用户明确继续
 * 会话才写回 target，避免切换 Tab 偷偷改写另一个助手的会话历史。
 */
export function createAgentPreferredTargetCoordinator<
  T extends AgentPreferredTargetSession,
>({
  activeTab,
  focusedPane,
  globalScopeId,
  setRuntimeSessions,
}: AgentPreferredTargetCoordinatorOptions<T>): AgentPreferredTargetCoordinator<T> {
  /** 当前 Tab 的助手以聚焦 pane 为首选，其它 Tab 的会话保留自己的持久 target。 */
  function preferredTargetForSession(
    session: T | AgentPreferredTargetSession,
  ): AgentSessionTargetRequest | undefined {
    return canRefreshCurrentTabTarget(session)
      ? buildAgentSessionTarget(focusedPane, activeTab) ?? session.target
      : session.target;
  }

  /** 显式恢复/继续当前 Tab 助手时写回 target；无 live pane 时不伪造绑定。 */
  async function persistPreferredTarget(
    agentSessionId: string,
    session: T | AgentPreferredTargetSession,
  ): Promise<AgentSessionTargetRequest | undefined> {
    const preferredTarget = buildAgentSessionTarget(focusedPane, activeTab);
    const target = preferredTarget ?? session.target;
    if (!preferredTarget || !canRefreshCurrentTabTarget(session)) {
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

  /** 仅允许当前 Tab 或旧全局会话在用户明确继续时更新首选目标。 */
  function canRefreshCurrentTabTarget(
    session: T | AgentPreferredTargetSession,
  ): boolean {
    return (
      isGlobalAgentSession(session) ||
      Boolean(activeTab?.id && session.tabId === activeTab.id)
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
