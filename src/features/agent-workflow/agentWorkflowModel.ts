import type { AgentSessionRecord } from "../../lib/agentLauncherApi";
import type { TerminalAgentSignal } from "../../lib/terminalApi";
import type {
  AgentWorkflowBadgeModel,
  AgentWorkflowHistoryMetadata,
  AgentWorkflowQueueMetadata,
  AgentWorkflowRuntimeStatus,
  AgentWorkflowSendPreview,
  AgentWorkflowSessionSnapshot,
  AgentWorkflowSourceInput,
} from "./agentWorkflowTypes";

/** agent queue 的领域适配输入，避免 workflow 反向依赖 tool-panel 私有模型。 */
interface AgentWorkflowPromptQueueSource {
  createdAt: string;
  id: string;
  submit: boolean;
  text: string;
}

/** history 适配只要求 queue 字段和 workflow 已定义的 action 契约。 */
type AgentWorkflowPromptHistorySource = AgentWorkflowPromptQueueSource &
  Pick<AgentWorkflowHistoryMetadata, "action">;

export const AGENT_WORKFLOW_PREVIEW_MAX_BYTES = 32 * 1024;
export const AGENT_WORKFLOW_PREVIEW_TTL_MS = 60_000;
/** Queue/history 仅保存近期 metadata，避免长期挂载的 Controller 无界增长。 */
export const AGENT_WORKFLOW_METADATA_LIMIT = 20;

/** 兼容 Rust 历史 snake_case 与当前 camelCase session 字段。 */
export function getAgentWorkflowSessionId(record: AgentSessionRecord) {
  return record.session.agentSessionId ?? record.session.agent_session_id;
}

/**
 * 解析会话状态来源优先级。
 * 归档是 repository 的最终生命周期事实；其余运行态优先采用 typed terminal signal。
 */
export function resolveAgentWorkflowSessionSnapshot({
  record,
  signal,
}: AgentWorkflowSourceInput): AgentWorkflowSessionSnapshot | null {
  const agentSessionId = getAgentWorkflowSessionId(record);
  if (!agentSessionId) {
    return null;
  }
  const repositoryStatus = record.session.status ?? "active";
  const terminalMatches =
    signal?.agentSessionId === agentSessionId &&
    repositoryStatus !== "archived";
  const runtimeStatus = terminalMatches
    ? resolveTerminalRuntimeStatus(signal.status)
    : resolveRepositoryRuntimeStatus(repositoryStatus);

  return {
    agentId: record.session.agentId ?? record.session.agent_id,
    agentSessionId,
    createdAt: record.session.createdAt ?? record.session.created_at,
    repositoryStatus,
    runtimeStatus,
    statusSource: terminalMatches ? "terminalSignal" : "repository",
    terminalAgent: terminalMatches ? signal.agent : undefined,
    terminalSessionId: terminalMatches ? signal.terminalSessionId : undefined,
    terminalStatus: terminalMatches ? signal.status : undefined,
    target: record.session.target
      ? {
          bindingId:
            record.session.target.bindingId ?? record.session.target.binding_id,
          bindingGeneration:
            record.session.target.bindingGeneration ??
            record.session.target.binding_generation,
          cwd: record.session.target.cwd,
          lastSeenAt:
            record.session.target.lastSeenAt ??
            record.session.target.last_seen_at,
          liveStatus:
            record.session.target.liveStatus ??
            record.session.target.live_status,
          paneId:
            record.session.target.paneId ?? record.session.target.pane_id,
          shell: record.session.target.shell,
          tabId: record.session.target.tabId ?? record.session.target.tab_id,
          targetKind:
            record.session.target.targetKind ??
            record.session.target.target_kind,
          targetRef:
            record.session.target.targetRef ?? record.session.target.target_ref,
          targetTerminalSessionId:
            record.session.target.targetTerminalSessionId ??
            record.session.target.target_terminal_session_id,
        }
      : undefined,
    title: record.session.title,
    updatedAt: record.session.updatedAt ?? record.session.updated_at,
  };
}

export function resolveAgentWorkflowBadge(
  status: AgentWorkflowRuntimeStatus,
): AgentWorkflowBadgeModel {
  switch (status) {
    case "running":
      return { label: "运行中", status, tone: "running" };
    case "waitingForUser":
      return { label: "等待人工", status, tone: "waiting" };
    case "failed":
      return { label: "失败", status, tone: "danger" };
    case "done":
      return { label: "已完成", status, tone: "done" };
    case "stale":
      return { label: "状态过期", status, tone: "stale" };
  }
}

/** 将既有 queue item 收窄为无正文 metadata，避免 controller 持久保存 item.text。 */
export function adaptAgentPromptQueueMetadata(
  sessionId: string,
  item: AgentWorkflowPromptQueueSource,
): AgentWorkflowQueueMetadata {
  return {
    createdAt: item.createdAt,
    id: item.id,
    sessionId,
    submit: item.submit,
    textBytes: new TextEncoder().encode(item.text).length,
  };
}

/** 将既有 history item 收窄为无正文 metadata；outcome 由调用路径明确提供。 */
export function adaptAgentPromptHistoryMetadata(
  sessionId: string,
  item: AgentWorkflowPromptHistorySource,
  outcome: AgentWorkflowHistoryMetadata["outcome"],
): AgentWorkflowHistoryMetadata {
  return {
    ...adaptAgentPromptQueueMetadata(sessionId, item),
    action: item.action,
    outcome,
  };
}

/** 对显式发送正文做基础凭据脱敏；它不是通用 DLP，调用方仍应避免传入秘密。 */
export function redactAgentWorkflowPreview(text: string) {
  let redacted = text;
  redacted = redacted.replace(
    /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/gi,
    "[REDACTED PRIVATE KEY]",
  );
  redacted = redacted.replace(
    /\b(Bearer)\s+[A-Za-z0-9._~+/-]+=*/gi,
    "$1 [REDACTED]",
  );
  redacted = redacted.replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, "[REDACTED TOKEN]");
  redacted = redacted.replace(
    /\b(password|passwd|token|api[_-]?key|secret)\s*([=:])\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
    "$1$2[REDACTED]",
  );
  return { redacted: redacted !== text, text: redacted };
}

/** 按 UTF-8 字节边界截断，避免 32 KiB 限制被多字节字符绕过或切出损坏文本。 */
export function truncateAgentWorkflowPreview(
  text: string,
  maxBytes = AGENT_WORKFLOW_PREVIEW_MAX_BYTES,
) {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(text);
  if (bytes.length <= maxBytes) {
    return { byteLength: bytes.length, text, truncated: false };
  }
  let byteLength = 0;
  let safeText = "";
  // 按 code point 追加，确保代理对和 UTF-8 多字节序列都不会被切断。
  for (const character of text) {
    const characterBytes = encoder.encode(character).length;
    if (byteLength + characterBytes > Math.max(0, maxBytes)) {
      break;
    }
    safeText += character;
    byteLength += characterBytes;
  }
  return {
    byteLength,
    text: safeText,
    truncated: true,
  };
}

export function isAgentWorkflowPreviewExpired(
  preview: AgentWorkflowSendPreview,
  now: Date,
) {
  return now.getTime() >= Date.parse(preview.expiresAt);
}

function resolveTerminalRuntimeStatus(
  status: TerminalAgentSignal["status"],
): AgentWorkflowRuntimeStatus {
  switch (status) {
    case "working":
      return "running";
    case "attention":
      return "waitingForUser";
    case "finished":
    case "exited":
      return "done";
  }
}

function resolveRepositoryRuntimeStatus(
  status: NonNullable<AgentSessionRecord["session"]["status"]>,
): AgentWorkflowRuntimeStatus {
  return status === "active"
    ? "running"
    : status === "archived"
      ? "done"
      : "stale";
}
