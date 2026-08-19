// @author kongweiguang
import {
  agentSessionRecordId,
  agentSessionRecordTarget,
  createAgentSession,
  type AgentSessionScope,
  type ExternalAgentId,
} from "../../../lib/agentLauncherApi";
import type { TerminalPane, TerminalTab } from "../../workspace/contracts/index";
import type { AgentLaunchTargetMode } from "./AgentLaunchControls";
import { buildAgentSessionTitle } from "./agentLauncherModel";
import {
  buildAgentSessionScope,
  formatCurrentAgentTargetLabel,
} from "./agentSessionTargetModel";
import { agentSessionScopeId } from "./agentTabSessionModel";

interface CreateAgentSessionForLaunchInput {
  activeTab?: TerminalTab;
  focusedPane?: TerminalPane;
  /** 旧调用方传入的 scope key，仅保留接口兼容；新作用域由 activeTab/targetMode 计算。 */
  tabId?: string;
  /** 恢复流程可显式指定原作用域，避免在当前 Tab 上误建 global/tab 会话。 */
  scope?: AgentSessionScope;
  targetMode?: AgentLaunchTargetMode;
}

/** 创建带显式权限作用域的持久会话；旧 target 不再决定新会话能访问哪些终端。 */
export async function createAgentSessionForLaunch(
  agentId: ExternalAgentId,
  {
    activeTab,
    focusedPane,
    scope: requestedScope,
    targetMode = "current",
  }: CreateAgentSessionForLaunchInput,
) {
  const scope = requestedScope ?? buildAgentSessionScope(activeTab, targetMode);
  const record = await createAgentSession({
    agentId,
    title: buildAgentSessionTitle(
      agentId,
      scope.kind === "global"
        ? "整个 Kerminal"
        : formatCurrentAgentTargetLabel(focusedPane, activeTab),
    ),
    scope,
  });
  const resolvedScope = resolveRecordScope(record, scope);
  return {
    agentSessionId: agentSessionRecordId(record),
    scope: resolvedScope,
    tabId: scopeIdForAgentSession(resolvedScope),
    target: agentSessionRecordTarget(record),
  };
}

/** 保留旧运行态 tabId 字段，避免已打开的 Agent 面板在升级后丢失归属。 */
function scopeIdForAgentSession(scope: AgentSessionScope): string {
  return scope.kind === "tab" ? scope.tabId : agentSessionScopeId(scope);
}

/** 新后端返回 scope 时优先采用它；旧响应没有 scope 时保留本次启动的预期范围。 */
function resolveRecordScope(
  record: Awaited<ReturnType<typeof createAgentSession>>,
  fallback: AgentSessionScope,
): AgentSessionScope {
  const rawScope = record.session.scope as
    | { kind?: "tab" | "global"; tabId?: string; tab_id?: string }
    | null
    | undefined;
  if (rawScope?.kind === "global") {
    return { kind: "global" };
  }
  if (rawScope?.kind === "tab") {
    const tabId = rawScope.tabId?.trim() ?? rawScope.tab_id?.trim();
    if (tabId) {
      return { kind: "tab", tabId };
    }
  }
  const target = agentSessionRecordTarget(record);
  if (target?.liveStatus === "unbound") {
    return { kind: "global" };
  }
  const targetTabId = target?.tabId?.trim();
  return targetTabId ? { kind: "tab", tabId: targetTabId } : fallback;
}
