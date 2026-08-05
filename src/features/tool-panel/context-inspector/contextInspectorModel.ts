// @author kongweiguang

import type {
  WorkspaceContextDiagnostic,
  WorkspaceContextProjection,
  WorkspaceContextSourceState,
} from "../../workspace/context";
import type {
  ContextInspectorActionDescriptor,
  ContextInspectorField,
  ContextInspectorSection,
  ContextInspectorViewModel,
} from "./contextInspectorTypes";

const EMPTY_VALUE = "未提供";
const DIAGNOSTIC_SEVERITY_ORDER = {
  error: 0,
  warning: 1,
  info: 2,
} as const;

function value(value: string | number | null | undefined): string {
  return value === null || value === undefined || value === ""
    ? EMPTY_VALUE
    : String(value);
}

function booleanValue(value: boolean): string {
  return value ? "是" : "否";
}

function sourceStatusLabel(source: WorkspaceContextSourceState): string {
  const labels = {
    available: "可用",
    loading: "加载中",
    stale: "已过期",
    unavailable: "不可用",
    error: "错误",
  } as const;
  return `${source.source} · ${labels[source.status]}`;
}

function connectionStatusLabel(
  status: WorkspaceContextProjection["runtime"]["connectionStatus"],
): string {
  const labels = {
    online: "在线",
    offline: "离线",
    warning: "需要注意",
    unknown: "未知",
  } as const;
  return labels[status];
}

function agentStatusLabel(context: WorkspaceContextProjection["agent"]): string {
  if (context.status === "loading") {
    return "正在读取会话";
  }
  if (context.status === "unavailable" || !context.sessionId) {
    return "未关联会话";
  }
  const title = context.title?.trim() || "Agent 会话";
  return context.status === "stale"
    ? `${title} · 已过期`
    : `${title} · 进行中`;
}

function diagnosticField(
  diagnostic: WorkspaceContextDiagnostic,
): ContextInspectorField {
  return {
    id: diagnostic.id,
    label: diagnostic.code,
    value: diagnostic.summary,
    tone:
      diagnostic.severity === "error"
        ? "danger"
        : diagnostic.severity === "warning"
          ? "warning"
          : "muted",
  };
}

function selectTopActions(
  actions: readonly ContextInspectorActionDescriptor[],
): readonly ContextInspectorActionDescriptor[] {
  return [...actions]
    .sort(
      (left, right) =>
        (right.priority ?? 0) - (left.priority ?? 0) ||
        left.title.localeCompare(right.title),
    )
    .slice(0, 4);
}

/**
 * 将统一 Workspace Context 投影转换为只读展示模型。
 * 所有异常和过期来源都降级为可见状态，不会阻断其它分区渲染。
 */
export function buildContextInspectorViewModel(
  context: WorkspaceContextProjection,
  actions: readonly ContextInspectorActionDescriptor[] = [],
): ContextInspectorViewModel {
  const sourceHasError = context.freshness.sources.some(
    (source) => source.status === "error",
  );
  const status = sourceHasError
    ? "error"
    : context.freshness.state === "stale"
      ? "stale"
      : context.freshness.state === "partial"
        ? "partial"
        : "ready";
  const targetLabel =
    context.target?.label ?? context.machine?.name ?? context.subject.title;
  const connectionLabel = [
    connectionStatusLabel(context.runtime.connectionStatus),
    context.runtime.latencyMs === null ? null : `${context.runtime.latencyMs} ms`,
  ]
    .filter(Boolean)
    .join(" · ");
  const primaryFields: ContextInspectorField[] = [
    {
      id: "primary-target",
      label: "当前目标",
      value: targetLabel || "未选择目标",
      navigationId: context.target ? `target:${context.target.id}` : undefined,
      tone: "default",
    },
    {
      id: "primary-location",
      label: "当前目录",
      value: value(context.location.cwd),
      navigationId: context.location.cwd
        ? `location:${context.location.cwd}`
        : undefined,
      tone: context.location.confidence === "low" ? "warning" : "default",
    },
    {
      id: "primary-connection",
      label: "连接",
      value: connectionLabel,
      tone:
        context.runtime.connectionStatus === "online"
          ? "success"
          : context.runtime.connectionStatus === "offline"
            ? "danger"
            : "warning",
    },
    {
      id: "primary-agent",
      label: "Agent",
      value: agentStatusLabel(context.agent),
      navigationId: context.agent.sessionId
        ? `agent:${context.agent.sessionId}`
        : undefined,
      tone:
        context.agent.status === "active"
          ? "success"
          : context.agent.status === "stale"
            ? "warning"
            : "muted",
    },
  ];
  const sections: ContextInspectorSection[] = [
    {
      id: "machine",
      title: "机器",
      fields: context.machine
        ? [
            { id: "machine-name", label: "名称", value: context.machine.name, navigationId: `machine:${context.machine.id}` },
            { id: "machine-kind", label: "类型", value: context.machine.kind },
            { id: "machine-status", label: "状态", value: context.machine.status },
          ]
        : [],
      emptyMessage: "当前没有选中的机器。",
    },
    {
      id: "target",
      title: "目标",
      fields: context.target
        ? [
            { id: "target-label", label: "目标", value: context.target.label, navigationId: `target:${context.target.id}` },
            { id: "target-kind", label: "连接", value: context.target.kind },
            { id: "target-host", label: "主机", value: value(context.target.hostLabel) },
            { id: "target-container", label: "容器", value: value(context.target.containerLabel) },
          ]
        : [],
      emptyMessage: "当前上下文没有可解析目标。",
    },
    {
      id: "tab-pane",
      title: "页签与窗格",
      fields: [
        { id: "subject", label: "当前对象", value: context.subject.title, navigationId: context.subject.id ? `subject:${context.subject.kind}:${context.subject.id}` : undefined },
        { id: "active-tab", label: "活动页签", value: value(context.activeTabId), navigationId: context.activeTabId ? `tab:${context.activeTabId}` : undefined },
        { id: "focused-pane", label: "焦点窗格", value: value(context.focusedPaneId), navigationId: context.focusedPaneId ? `pane:${context.focusedPaneId}` : undefined },
        { id: "subject-dirty", label: "未保存", value: booleanValue(Boolean(context.subject.dirty)) },
      ],
    },
    {
      id: "location",
      title: "位置",
      fields: [
        { id: "cwd", label: "当前目录", value: value(context.location.cwd), navigationId: context.location.cwd ? `location:${context.location.cwd}` : undefined },
        { id: "cwd-source", label: "来源", value: context.location.cwdSource },
        { id: "path-style", label: "路径风格", value: context.location.pathStyle },
        { id: "confidence", label: "置信度", value: context.location.confidence, tone: context.location.confidence === "low" ? "warning" : "default" },
      ],
    },
    {
      id: "resources",
      title: "资源",
      fields: [
        { id: "tabs", label: "页签", value: value(context.resources.tabs.length) },
        { id: "panes", label: "窗格", value: value(context.resources.panes.length) },
        { id: "files", label: "工作区文件", value: value(context.resources.workspaceFileCount) },
        { id: "dirty-files", label: "未保存文件", value: value(context.resources.dirtyWorkspaceFileCount), tone: context.resources.dirtyWorkspaceFileCount > 0 ? "warning" : "default" },
      ],
    },
    {
      id: "runtime",
      title: "运行态",
      fields: [
        { id: "connection", label: "连接状态", value: context.runtime.connectionStatus },
        { id: "pane-mode", label: "窗格模式", value: value(context.runtime.paneMode) },
        { id: "latency", label: "延迟", value: context.runtime.latencyMs === null ? EMPTY_VALUE : `${context.runtime.latencyMs} ms` },
        { id: "tmux", label: "tmux", value: context.runtime.tmuxAttached ? "已附加" : "未附加" },
      ],
    },
    {
      id: "agent",
      title: "Agent",
      fields: [
        {
          id: "agent-title",
          label: "标题",
          value: value(context.agent.title),
        },
        { id: "agent-session", label: "会话", value: value(context.agent.sessionId), navigationId: context.agent.sessionId ? `agent:${context.agent.sessionId}` : undefined },
        { id: "agent-status", label: "状态", value: agentStatusLabel(context.agent) },
      ],
      emptyMessage: "当前没有关联 Agent 会话。",
    },
    {
      id: "freshness",
      title: "新鲜度",
      status: context.freshness.state === "fresh" ? "normal" : context.freshness.state,
      fields: context.freshness.sources.map((source) => ({
        id: `source-${source.source}`,
        label: sourceStatusLabel(source),
        value: source.updatedAt ?? value(source.revision),
        tone:
          source.status === "error"
            ? "danger"
            : source.status === "stale" || source.status === "unavailable"
              ? "warning"
              : "muted",
      })),
      emptyMessage: "没有来源状态。",
    },
    {
      id: "diagnostics",
      title: "诊断",
      status: context.diagnostics.some((item) => item.severity === "error")
        ? "error"
        : context.diagnostics.length > 0
          ? "partial"
          : "normal",
      fields: [...context.diagnostics]
        .sort(
          (left, right) =>
            DIAGNOSTIC_SEVERITY_ORDER[left.severity] -
              DIAGNOSTIC_SEVERITY_ORDER[right.severity] ||
            left.id.localeCompare(right.id),
        )
        .map(diagnosticField),
      emptyMessage: "没有上下文诊断。",
    },
  ];

  return {
    title: targetLabel || "当前上下文",
    subtitle:
      context.subject.title && context.subject.title !== targetLabel
        ? context.subject.title
        : context.runtime.paneMode
          ? `${context.runtime.paneMode.toUpperCase()} 工作区`
          : "当前工作区",
    status,
    primaryFields,
    sections,
    topActions: selectTopActions(actions),
  };
}
