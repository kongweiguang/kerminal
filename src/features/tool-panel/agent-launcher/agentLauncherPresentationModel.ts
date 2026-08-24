// @author kongweiguang

import type {
  AgentSessionRecord,
  AgentSessionScope,
  ExternalAgentId,
  ExternalAgentWorkspaceStatus,
} from "../../../lib/agentLauncherApi";
import { agentSessionRecordId } from "../../../lib/agentLauncherApi";
import type { AgentWorkflowSessionSnapshot } from "../../agent-workflow";
import { redactSensitiveTechnicalDetail } from "../../../lib/userFacingMessage";
import {
  BUILTIN_CLAUDE_AGENT_KEY,
  BUILTIN_CODEX_AGENT_KEY,
  BUILTIN_PI_AGENT_KEY,
  customAgentLauncherKey,
  type AgentLauncherSettings,
  type CustomAgentDefinition,
} from "../../settings/contracts/index";
import type { TerminalPane, TerminalTab } from "../../workspace/contracts/index";
import {
  customAgentExecutableName,
  resolveAgentLauncherDescriptor,
  type AgentLauncherDescriptor,
} from "./agentLauncherSettingsModel";
import type { AgentActionViewModel } from "./agentLauncherModel";
import type { AgentSelectorOption } from "./AgentSelector";
import {
  persistedAgentSessionSelection,
  type AgentSessionSelection,
} from "./agentSessionRestoreModel";
import {
  buildAgentSessionTarget,
  formatCurrentAgentTargetLabel,
} from "./agentSessionTargetModel";
import { agentSessionScopeId } from "./agentTabSessionModel";

export type AgentLaunchSnapshot = Omit<AgentLauncherDescriptor, "launcherKey"> & {
  launcherKey?: string;
};

interface HistoricalAgentRuntimeSession {
  agentId: ExternalAgentId;
  customCommand?: string;
  launcherKey?: string;
  title: string;
}

interface ResolveHistoricalAgentLaunchOptions {
  activeScope: AgentSessionScope;
  agentSessionId: string;
  launcherSettings: AgentLauncherSettings;
  persistedSessions: readonly AgentSessionRecord[];
  runtimeSessions: Readonly<Record<string, HistoricalAgentRuntimeSession>>;
  workflowSessions: readonly AgentWorkflowSessionSnapshot[];
}

export interface HistoricalAgentLaunchResolution {
  agentId: ExternalAgentId;
  launcher: AgentLaunchSnapshot | null;
  sourceScope: AgentSessionScope;
}

/**
 * “同 Agent 新会话”优先读取运行态或持久化历史快照；只有内置 Agent 缺少旧快照时
 * 才退回当前定义，避免 Custom 编辑或删除后悄悄换成另一条命令。
 */
export function resolveHistoricalAgentLaunch({
  activeScope,
  agentSessionId,
  launcherSettings,
  persistedSessions,
  runtimeSessions,
  workflowSessions,
}: ResolveHistoricalAgentLaunchOptions): HistoricalAgentLaunchResolution | null {
  const workflowSession = workflowSessions.find(
    (session) => session.agentSessionId === agentSessionId,
  );
  const agentId = workflowSession?.agentId;
  if (!agentId) {
    return null;
  }
  const sourceScope =
    workflowSession.scope ??
    (workflowSession.target?.liveStatus === "unbound"
      ? { kind: "global" as const }
      : workflowSession.target?.tabId
        ? { kind: "tab" as const, tabId: workflowSession.target.tabId }
        : activeScope);
  const sourceScopeId = agentSessionScopeId(sourceScope);
  const runtimeSession = runtimeSessions[agentSessionId];
  const persistedRecord = persistedSessions.find((candidate) => {
    try {
      return agentSessionRecordId(candidate) === agentSessionId;
    } catch {
      return false;
    }
  });
  const persistedSelection = persistedRecord
    ? persistedAgentSessionSelection(persistedRecord, sourceScopeId)
    : null;
  const launcher: AgentLaunchSnapshot | null = runtimeSession
    ? {
        agentId: runtimeSession.agentId,
        customCommand: runtimeSession.customCommand,
        launcherKey: runtimeSession.launcherKey,
        title: runtimeSession.title,
      }
    : persistedSelection
      ? launcherSnapshotFromSelection(agentId, persistedSelection)
      : resolveAgentLauncherDescriptor(
          launcherSettings,
          builtinAgentLauncherKey(agentId) ?? "",
        );
  return { agentId, launcher, sourceScope };
}

/** 将内置可用性和有序 Custom 定义投影为专用选择器条目。 */
export function buildAgentSelectorOptions(
  agentActions: readonly AgentActionViewModel[],
  customAgents: readonly CustomAgentDefinition[],
): AgentSelectorOption[] {
  return [
    ...agentActions
      .filter((agent) => agent.agentId !== "custom")
      .map((agent) => ({
        agentId: agent.agentId,
        commandLabel: agent.cliCommand,
        disabled: agent.disabled,
        disabledReason: agent.disabledReason,
        key: builtinAgentLauncherKey(agent.agentId) ?? BUILTIN_CODEX_AGENT_KEY,
        name: agent.title,
        statusDetail: agent.availabilityDetail,
        statusLabel: agent.availabilityLabel,
        tone:
          agent.tone === "danger" ? ("warning" as const) : agent.tone,
      })),
    ...customAgents.map((agent) => ({
      agentId: "custom" as const,
      commandLabel: customAgentExecutableName(agent.command),
      disabled: false,
      key: customAgentLauncherKey(agent.id),
      name: agent.name,
      statusLabel: "已保存",
      tone: "ready" as const,
    })),
  ];
}

/** 技术详情仅覆盖探测到的内置 provider，并统一经过敏感内容脱敏。 */
export function buildAgentTechnicalDetail(
  status: ExternalAgentWorkspaceStatus | null,
  agentActions: readonly AgentActionViewModel[],
): string {
  return redactSensitiveTechnicalDetail(
    [
      `MCP: ${status?.mcpServerRunning ? "running" : "stopped"}`,
      `Endpoint: ${status?.mcpEndpoint || "unavailable"}`,
      ...agentActions.flatMap((agent) => [
        "",
        `${agent.title}: ${agent.availabilityLabel}`,
        `  command: ${agent.cliCommand}`,
        `  config: ${agent.configPath}`,
        `  status: ${agent.statusDetail}`,
      ]),
    ].join("\n"),
  );
}

/** 将当前 scope 一次投影成标题、兼容 target 和显式权限范围，避免三处条件漂移。 */
export function buildAgentTargetPresentation(options: {
  activeAgentScope: AgentSessionScope;
  activeAgentViewScopeId: string;
  activeTab?: TerminalTab;
  effectiveFocusedPane?: TerminalPane;
  globalAgentScopeId: string;
  terminalPanes?: TerminalPane[];
}) {
  const global = options.activeAgentViewScopeId === options.globalAgentScopeId;
  const focusedPane = global ? undefined : options.effectiveFocusedPane;
  const activeTab = global ? undefined : options.activeTab;
  return {
    currentAgentScope: global
      ? ({ kind: "global" } as const)
      : options.activeAgentScope,
    currentAgentTarget: buildAgentSessionTarget(focusedPane, activeTab),
    currentAgentTargetLabel: formatCurrentAgentTargetLabel(
      focusedPane,
      activeTab,
      options.terminalPanes,
    ),
  };
}

/** 历史恢复始终从 session 快照构造启动描述，不读取可能已编辑或删除的定义。 */
export function launcherSnapshotFromSelection(
  agentId: ExternalAgentId,
  selection: AgentSessionSelection,
): AgentLaunchSnapshot {
  return {
    agentId,
    customCommand: selection.customCommand,
    launcherKey:
      selection.launcherKey ??
      builtinAgentLauncherKey(agentId),
    title:
      selection.title ||
      (agentId === "codex"
        ? "Codex"
        : agentId === "claude"
          ? "Claude"
          : agentId === "pi"
            ? "PI Agent"
            : "Custom"),
  };
}

/** 只为原生内置 provider 返回稳定 key；Custom 必须保留其定义 UUID。 */
function builtinAgentLauncherKey(
  agentId: ExternalAgentId,
): string | undefined {
  if (agentId === "codex") {
    return BUILTIN_CODEX_AGENT_KEY;
  }
  if (agentId === "claude") {
    return BUILTIN_CLAUDE_AGENT_KEY;
  }
  return agentId === "pi" ? BUILTIN_PI_AGENT_KEY : undefined;
}
