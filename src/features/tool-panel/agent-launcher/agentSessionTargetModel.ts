// @author kongweiguang

import type {
  AgentSessionScope,
  AgentSessionTargetRequest,
} from "../../../lib/agentLauncherApi";
import { targetStableId } from "../../../lib/targetModel";
import {
  getTerminalPaneSessionRecord,
  type PaneSessionRecord,
} from "../../terminal/session/index";
import {
  isTerminalSessionTab,
  type TerminalPane,
  type TerminalTab,
} from "../../workspace/contracts/index";
import { collectPaneIds } from "../../workspace/workspaceLayout";

/** 将启动入口的当前上下文转换成稳定作用域；pane/session 仅用于兼容展示，不参与权限边界。 */
export function buildAgentSessionScope(
  activeTab?: TerminalTab,
  targetMode: "current" | "unbound" = "current",
): AgentSessionScope {
  if (targetMode === "unbound" || !isTerminalSessionTab(activeTab)) {
    return { kind: "global" };
  }
  return { kind: "tab", tabId: activeTab.id };
}

export function buildAgentSessionTarget(
  focusedPane?: TerminalPane,
  activeTab?: TerminalTab,
): AgentSessionTargetRequest | undefined {
  if (!focusedPane) {
    return undefined;
  }
  const paneSession = getTerminalPaneSessionRecord(focusedPane.id);
  if (!paneSession?.sessionId) {
    return undefined;
  }
  return {
    cwd: paneSession.cwd ?? focusedPane.currentCwd ?? focusedPane.cwd,
    liveStatus: "ready",
    paneId: focusedPane.id,
    shell: paneSession.shell ?? focusedPane.shell,
    tabId: paneSession.tabId ?? activeTab?.id,
    targetKind: paneSession.target ?? paneTargetKind(focusedPane),
    targetRef: buildAgentTargetRef(focusedPane, activeTab, paneSession),
    targetTerminalSessionId: paneSession.sessionId,
  };
}

function buildAgentTargetRef(
  focusedPane: TerminalPane,
  activeTab: TerminalTab | undefined,
  paneSession: PaneSessionRecord,
): string {
  if (paneSession.targetRef?.trim()) {
    return paneSession.targetRef.trim();
  }
  if (focusedPane.target) {
    return targetStableId(focusedPane.target);
  }
  const tabPart = activeTab?.id ? `tab:${activeTab.id}` : undefined;
  const panePart = `pane:${focusedPane.id}`;
  if (paneSession.target === "dockerContainer") {
    return joinTargetRefParts([
      "dockerContainer",
      paneSession.remoteHostId ? `host:${paneSession.remoteHostId}` : undefined,
      paneSession.containerRuntime
        ? `runtime:${paneSession.containerRuntime}`
        : undefined,
      paneSession.containerId ? `container:${paneSession.containerId}` : undefined,
      tabPart,
      panePart,
    ]);
  }
  if (paneSession.target === "local") {
    return joinTargetRefParts([
      "local",
      paneSession.profileId ? `profile:${paneSession.profileId}` : "profile:default",
      tabPart,
      panePart,
    ]);
  }
  return joinTargetRefParts([
    paneSession.target,
    paneSession.remoteHostId ? `host:${paneSession.remoteHostId}` : undefined,
    tabPart,
    panePart,
  ]);
}

function joinTargetRefParts(parts: Array<string | undefined>): string {
  return parts.filter((part): part is string => Boolean(part?.trim())).join(":");
}

/** 将旧 target 仅用于历史提示；新 global 会话没有 target 时明确显示全局范围。 */
export function formatTargetChipLabel(
  target?: AgentSessionTargetRequest,
): string {
  if (!target) {
    return "整个 Kerminal";
  }
  if (target.liveStatus === "unbound") {
    return "整个 Kerminal";
  }
  if (!target.targetTerminalSessionId) {
    return target.tabId ? "当前 Tab" : "整个 Kerminal";
  }
  if (target.liveStatus === "closed") {
    return "已关闭";
  }
  if (target.liveStatus === "stale") {
    return "已失效";
  }
  const name = compactTargetName(target.targetRef ?? target.paneId);
  const path = compactTargetPath(target.cwd);
  return path ? `${name} · ${path}` : name;
}

/** 为右栏展示当前权限范围和 Tab 内终端数量，不暴露 pane/session 作为绑定提示。 */
export function formatCurrentAgentTargetLabel(
  _focusedPane?: TerminalPane,
  activeTab?: TerminalTab,
  terminalPanes?: readonly TerminalPane[],
): string {
  if (!isTerminalSessionTab(activeTab)) {
    return "整个 Kerminal";
  }
  const paneIds = activeTab.layout ? collectPaneIds(activeTab.layout) : [];
  const livePaneCount = terminalPanes
    ? paneIds.filter((paneId) => terminalPanes.some((pane) => pane.id === paneId))
        .length
    : paneIds.length;
  const paneCount = livePaneCount || paneIds.length || 1;
  const tabTitle = activeTab.title?.trim();
  return `当前 Tab · ${paneCount} 个终端${tabTitle ? ` · ${tabTitle}` : ""}`;
}

function compactTargetName(value?: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    return "当前终端";
  }
  const parts = normalized.split(":").filter(Boolean);
  return parts[parts.length - 1] ?? normalized;
}

function compactTargetPath(path?: string): string {
  const normalized = path?.replace(/\\/g, "/").trim();
  if (!normalized) {
    return "cwd 未知";
  }
  const segments = normalized.split("/").filter(Boolean);
  if (segments.length <= 2) {
    return normalized;
  }
  return `.../${segments.slice(-2).join("/")}`;
}

function paneTargetKind(pane: TerminalPane): string | undefined {
  if (pane.mode === "container") {
    return "dockerContainer";
  }
  return pane.mode === "preview" ? undefined : pane.mode;
}
