// @author kongweiguang
import type {
  AgentSessionRecord,
  AgentSessionRecordStatus,
  AgentSessionScope,
  AgentSessionTargetRequest,
  ExternalAgentId,
} from "../../lib/agentLauncherApi";
import type {
  TerminalAgentKind,
  TerminalAgentSignal,
  TerminalAgentStatus,
} from "../../lib/terminalApi";

/** Agent Workflow 对 UI 暴露的统一运行状态，不替代持久化 session 状态。 */
export type AgentWorkflowRuntimeStatus =
  "running" | "waitingForUser" | "failed" | "done" | "stale";

type AgentWorkflowStatusSource =
  "repository" | "terminalSignal" | "promptTransport";

/** 可丢弃的会话派生快照，正文和可变运行时对象不得进入该结构。 */
export interface AgentWorkflowSessionSnapshot {
  agentId?: ExternalAgentId;
  agentSessionId: string;
  createdAt?: string;
  repositoryStatus: AgentSessionRecordStatus;
  runtimeStatus: AgentWorkflowRuntimeStatus;
  statusSource: AgentWorkflowStatusSource;
  terminalAgent?: TerminalAgentKind;
  terminalSessionId?: string;
  terminalStatus?: TerminalAgentStatus;
  /** 权限作用域必须进入派生快照，否则刷新列表后会退回 legacy 单终端筛选。 */
  scope?: AgentSessionScope;
  target?: AgentSessionTargetRequest;
  title: string;
  updatedAt?: string;
}

/** Controller 的只读快照；revision 仅在可观察状态变化时递增。 */
export interface AgentWorkflowSnapshot {
  disposed: boolean;
  errorCode?: string;
  historyMetadata: AgentWorkflowHistoryMetadata[];
  loading: boolean;
  queueMetadata: AgentWorkflowQueueMetadata[];
  refreshedAt?: string;
  revision: number;
  sessions: AgentWorkflowSessionSnapshot[];
  stale: boolean;
}

export interface AgentWorkflowBadgeModel {
  label: string;
  status: AgentWorkflowRuntimeStatus;
  tone: "danger" | "done" | "running" | "stale" | "waiting";
}

export type AgentWorkflowPreviewKind =
  "artifact" | "commandBlock" | "diagnostic" | "selection";

/** 发送预览正文只允许驻留于 controller 内存，调用方不得持久化该对象。 */
export interface AgentWorkflowSendPreview {
  byteLength: number;
  createdAt: string;
  expiresAt: string;
  id: string;
  kind: AgentWorkflowPreviewKind;
  redacted: boolean;
  sessionId: string;
  text: string;
  truncated: boolean;
}

export interface AgentWorkflowQueueMetadata {
  createdAt: string;
  id: string;
  sessionId: string;
  submit: boolean;
  textBytes: number;
}

export interface AgentWorkflowHistoryMetadata extends AgentWorkflowQueueMetadata {
  action:
    | "branch"
    | "commandBlock"
    | "context"
    | "pasted"
    | "queued"
    | "ranQueued"
    | "selection"
    | "sent";
  outcome: "cancelled" | "expired" | "failed" | "queued" | "sent";
  /** Controller 创建的记录保留预览来源；旧 queue/history adapter 可不提供。 */
  previewKind?: AgentWorkflowPreviewKind;
}

export interface AgentWorkflowPromptRequest {
  sessionId: string;
  submit: boolean;
  text: string;
}

export interface AgentWorkflowPromptResult {
  accepted: boolean;
  transportId?: string;
}

export interface AgentWorkflowControllerOptions {
  historyMetadataLimit?: number;
  now?: () => Date;
  previewMaxBytes?: number;
  previewTtlMs?: number;
  queueMetadataLimit?: number;
}

export type AgentWorkflowPreviewResolution =
  | { outcome: "cancelled" | "expired" | "missing" }
  | { outcome: "failed"; errorCode: string }
  | { outcome: "sent"; transportId?: string };

export interface AgentWorkflowSourceInput {
  record: AgentSessionRecord;
  signal?: TerminalAgentSignal;
}
