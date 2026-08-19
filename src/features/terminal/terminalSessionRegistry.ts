// @author kongweiguang
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  acknowledgeTerminalReconnect,
  TERMINAL_RECONNECT_REQUEST_EVENT,
  type TerminalReconnectRequest,
  writeTerminal,
} from "../../lib/terminalApi";
import {
  recordCommandHistory,
  type CommandHistoryTarget,
  type CommandHistorySource,
} from "../../lib/commandHistoryApi";
import {
  closeTerminalSessionBinding,
  markTerminalSessionBindingDisconnected,
  markTerminalSessionBindingReady,
  type PaneSessionBindingTraceRequest,
  registerTerminalSessionBinding,
} from "../../lib/paneSessionTraceApi";
import {
  getRemoteSocksAutoInjection,
} from "./terminalProxyAutoInjection";

export interface PaneSessionRecord {
  sessionId: string;
  connectionGeneration: number;
  commandBlockText?: string;
  containerId?: string;
  containerRuntime?: string;
  selectedText?: string;
  targetRef?: string;
  targetToken?: string;
  tabId?: string;
  target: CommandHistoryTarget;
  cwd?: string;
  profileId?: string;
  remoteHostId?: string;
  shell?: string;
}

export interface PaneSessionListRecord extends PaneSessionRecord {
  paneId: string;
}

export interface TerminalPaneRuntimeContext {
  commandBlockText?: string;
  selectedText?: string;
}

const paneSessions = new Map<string, PaneSessionRecord>();
const paneConnectionGenerations = new Map<string, number>();
const paneReconnectHandlers = new Map<string, () => Promise<void>>();
const remoteSocksInjectionTasks = new Map<string, Promise<void>>();
let reconnectListenerStarted = false;

/** 建立全局 request/ack listener，让 MCP 重连请求复用真实 pane runtime。 */
function ensureTerminalReconnectListener() {
  if (!isTauri() || reconnectListenerStarted) {
    return;
  }
  reconnectListenerStarted = true;
  void listen<TerminalReconnectRequest>(
    TERMINAL_RECONNECT_REQUEST_EVENT,
    async ({ payload }) => {
      const handler = paneReconnectHandlers.get(payload.paneId);
      if (!handler) {
        await acknowledgeTerminalReconnect({
          requestId: payload.requestId,
          paneId: payload.paneId,
          success: false,
          error: "目标 pane 当前没有可用的重连运行时",
        }).catch(() => undefined);
        return;
      }
      try {
        await handler();
        await acknowledgeTerminalReconnect({
          requestId: payload.requestId,
          paneId: payload.paneId,
          success: true,
        }).catch(() => undefined);
      } catch (error: unknown) {
        await acknowledgeTerminalReconnect({
          requestId: payload.requestId,
          paneId: payload.paneId,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        }).catch(() => undefined);
      }
    },
  ).catch(() => {
    reconnectListenerStarted = false;
  });
}

ensureTerminalReconnectListener();

export interface BroadcastWriteRequest {
  command?: string;
  data: string;
  targetPaneIds: string[];
}

export interface BroadcastWriteResult {
  missingPaneIds: string[];
  sentPaneIds: string[];
}

export interface SnippetWriteRequest {
  command: string;
  expectedConnectionGeneration?: number;
  expectedSessionId?: string;
  expectedTargetRef?: string;
  recordHistory?: boolean;
  paneId: string;
  tabId?: string;
}

export interface PaneCommandWriteRequest {
  command: string;
  paneId: string;
  source: Extract<CommandHistorySource, "snippet" | "workflow" | "tool">;
  tabId?: string;
}

export interface PaneCommandWriteResult {
  paneId: string;
  reason?: "empty-command" | "missing-session" | "stale-binding" | "multiline-unsupported";
  sent: boolean;
  sessionId?: string;
  target?: CommandHistoryTarget;
}

export type SnippetWriteResult = PaneCommandWriteResult;
export type WorkflowWriteResult = PaneCommandWriteResult;

export function registerTerminalPaneSession(
  paneId: string,
  sessionId: string,
  metadata: Partial<Omit<PaneSessionRecord, "sessionId">> = {},
) {
  ensureTerminalReconnectListener();
  const connectionGeneration = (paneConnectionGenerations.get(paneId) ?? 0) + 1;
  paneConnectionGenerations.set(paneId, connectionGeneration);
  const record = {
    containerId: metadata.containerId,
    containerRuntime: metadata.containerRuntime,
    connectionGeneration,
    sessionId,
    targetRef: metadata.targetRef,
    targetToken: metadata.targetToken,
    target: metadata.target ?? "local",
    cwd: metadata.cwd,
    profileId: metadata.profileId,
    remoteHostId: metadata.remoteHostId,
    shell: metadata.shell,
    tabId: metadata.tabId,
  };
  paneSessions.set(paneId, record);
  reportTerminalSessionRegistered(paneId, record);
  void injectRemoteSocksIfEnabled(paneId, record)?.catch(() => undefined);
}

/** 注册 pane 当前的真实 reconnect 回调，连接参数仍由 XtermPane runtime 持有。 */
export function registerTerminalPaneReconnectHandler(
  paneId: string,
  handler: () => Promise<void>,
) {
  ensureTerminalReconnectListener();
  paneReconnectHandlers.set(paneId, handler);
}

/** pane 销毁时移除 reconnect 回调，避免事件触达已卸载的 runtime。 */
export function unregisterTerminalPaneReconnectHandler(paneId: string) {
  paneReconnectHandlers.delete(paneId);
}

export function unregisterTerminalPaneSession(
  paneId: string,
  sessionId?: string,
  options: { preserveBinding?: boolean } = {},
) {
  const currentSession = paneSessions.get(paneId);
  if (sessionId && currentSession && currentSession.sessionId !== sessionId) {
    return;
  }
  clearInjectedRemoteSocksSessions(paneId, currentSession?.sessionId);
  paneSessions.delete(paneId);
  // disconnected 时运行态 Map 已清空，但 pane dispose 仍必须凭最后 sessionId
  // 关闭 Rust binding；否则 global/tab scope 会永久保留一个不可重连的幽灵成员。
  const closingSessionId = currentSession?.sessionId ?? sessionId;
  if (closingSessionId && !options.preserveBinding) {
    reportTerminalSessionClosed(paneId, closingSessionId);
  }
}

export function getTerminalPaneSession(paneId: string) {
  return paneSessions.get(paneId)?.sessionId;
}

export function getTerminalPaneSessionRecord(
  paneId: string,
): PaneSessionRecord | undefined {
  const record = paneSessions.get(paneId);
  return record ? { ...record } : undefined;
}

export function listTerminalPaneSessionRecords(): PaneSessionListRecord[] {
  return Array.from(paneSessions.entries()).map(([paneId, record]) => ({
    ...record,
    paneId,
  }));
}

export function updateTerminalPaneSessionCwd(paneId: string, cwd: string) {
  const currentSession = paneSessions.get(paneId);
  if (!currentSession) {
    return;
  }
  paneSessions.set(paneId, {
    ...currentSession,
    cwd,
  });
  reportTerminalSessionMetadataUpdated(paneId, {
    ...currentSession,
    cwd,
  });
}

export function updateTerminalPaneRuntimeContext(
  paneId: string,
  context: TerminalPaneRuntimeContext,
) {
  const currentSession = paneSessions.get(paneId);
  if (!currentSession) {
    return;
  }
  paneSessions.set(paneId, {
    ...currentSession,
    ...context,
  });
}

export function markTerminalPaneSessionDisconnected(
  paneId: string,
  sessionId?: string,
) {
  const currentSession = paneSessions.get(paneId);
  if (!currentSession || (sessionId && currentSession.sessionId !== sessionId)) {
    return;
  }
  void markTerminalSessionBindingDisconnected(
    buildTraceRequest(paneId, currentSession),
  ).catch(() => undefined);
}

export function markTerminalPaneSessionReconnected(
  paneId: string,
  sessionId?: string,
) {
  const currentSession = paneSessions.get(paneId);
  if (!currentSession || (sessionId && currentSession.sessionId !== sessionId)) {
    return;
  }
  reportTerminalSessionRegistered(paneId, currentSession);
}

function reportTerminalSessionRegistered(
  paneId: string,
  session: PaneSessionRecord,
) {
  const request = buildTraceRequest(paneId, session);
  void registerTerminalSessionBinding(request).catch(
    () => undefined,
  );
  void markTerminalSessionBindingReady(request).catch(
    () => undefined,
  );
}

function reportTerminalSessionMetadataUpdated(
  paneId: string,
  session: PaneSessionRecord,
) {
  reportTerminalSessionRegistered(paneId, session);
}

function reportTerminalSessionClosed(paneId: string, sessionId: string) {
  void closeTerminalSessionBinding({ paneId, sessionId }).catch(() => undefined);
}

function buildTraceRequest(
  paneId: string,
  session: PaneSessionRecord,
): PaneSessionBindingTraceRequest {
  return {
    metadata: {
      cwd: session.cwd,
      profileId: session.profileId,
      remoteHostId: session.remoteHostId,
      shell: session.shell,
      tabId: session.tabId,
      targetRef: buildTargetRef(paneId, session),
      targetKind: session.target,
    },
    paneId,
    sessionId: session.sessionId,
    targetToken: session.targetToken,
  };
}

function buildTargetRef(paneId: string, session: PaneSessionRecord): string {
  const backendTargetRef = session.targetRef?.trim();
  if (backendTargetRef) {
    return backendTargetRef;
  }
  const scopeParts = [
    session.tabId ? `tab:${session.tabId}` : undefined,
    `pane:${paneId}`,
  ];
  if (session.target === "local") {
    return joinTargetRefParts([
      "local",
      session.profileId ? `profile:${session.profileId}` : "profile:default",
      ...scopeParts,
    ]);
  }
  if (session.target === "dockerContainer") {
    return joinTargetRefParts([
      "dockerContainer",
      session.remoteHostId ? `host:${session.remoteHostId}` : undefined,
      session.containerRuntime ? `runtime:${session.containerRuntime}` : undefined,
      session.containerId ? `container:${session.containerId}` : undefined,
      ...scopeParts,
    ]);
  }
  return joinTargetRefParts([
    session.target,
    session.remoteHostId ? `host:${session.remoteHostId}` : undefined,
    ...scopeParts,
  ]);
}

function joinTargetRefParts(parts: Array<string | undefined>): string {
  return parts
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(":");
}

function injectRemoteSocksIfEnabled(
  paneId: string,
  session: PaneSessionRecord,
): Promise<void> | undefined {
  if (session.target !== "ssh" || !session.remoteHostId) {
    return undefined;
  }

  const injection = getRemoteSocksAutoInjection(session.remoteHostId);
  if (!injection) {
    return undefined;
  }
  const { command: injectionCommand, sessionId: injectionSessionId } = injection;
  const command = injectionCommand.trim();
  if (!command) {
    return undefined;
  }

  const injectionKey = [paneId, session.sessionId, injectionSessionId].join(
    "\u0000",
  );
  const existingTask = remoteSocksInjectionTasks.get(injectionKey);
  if (existingTask) {
    return existingTask;
  }

  const task = Promise.resolve(writeTerminal(session.sessionId, `${command}\r`))
    .then(() =>
      recordCommandHistory({
        command,
        cwd: session.cwd,
        paneId,
        profileId: session.profileId,
        remoteHostId: session.remoteHostId,
        sessionId: session.sessionId,
        shell: session.shell,
        source: "tool",
        target: session.target,
      }),
    )
    .then(() => undefined)
    .catch(() => {
      remoteSocksInjectionTasks.delete(injectionKey);
    });
  remoteSocksInjectionTasks.set(injectionKey, task);
  return task;
}

function clearInjectedRemoteSocksSessions(
  paneId: string,
  sessionId?: string,
) {
  const prefix = sessionId
    ? `${paneId}\u0000${sessionId}\u0000`
    : `${paneId}\u0000`;
  for (const key of remoteSocksInjectionTasks.keys()) {
    if (key.startsWith(prefix)) {
      remoteSocksInjectionTasks.delete(key);
    }
  }
}

export async function writeBroadcastCommand({
  command,
  data,
  targetPaneIds,
}: BroadcastWriteRequest): Promise<BroadcastWriteResult> {
  const sentPaneIds: string[] = [];
  const missingPaneIds: string[] = [];

  for (const paneId of targetPaneIds) {
    const session = paneSessions.get(paneId);
    if (!session) {
      missingPaneIds.push(paneId);
      continue;
    }
    await writeTerminal(session.sessionId, data);
    if (command?.trim()) {
      void recordCommandHistory({
        command,
        cwd: session.cwd,
        paneId,
        profileId: session.profileId,
        remoteHostId: session.remoteHostId,
        sessionId: session.sessionId,
        shell: session.shell,
        source: "broadcast",
        target: session.target,
      });
    }
    sentPaneIds.push(paneId);
  }

  return { missingPaneIds, sentPaneIds };
}

export async function writePaneCommand({
  command,
  paneId,
  source,
  tabId,
}: PaneCommandWriteRequest): Promise<PaneCommandWriteResult> {
  const normalizedCommand = command.trim();
  if (!normalizedCommand) {
    return { paneId, reason: "empty-command", sent: false };
  }

  const session = paneSessions.get(paneId);
  if (!session) {
    return { paneId, reason: "missing-session", sent: false };
  }

  const autoInjectionCommand = session.remoteHostId
    ? getRemoteSocksAutoInjection(session.remoteHostId)?.command.trim()
    : undefined;
  if (autoInjectionCommand && autoInjectionCommand !== normalizedCommand) {
    await injectRemoteSocksIfEnabled(paneId, session);
  }

  await writeTerminal(session.sessionId, `${normalizedCommand}\r`);
  void recordCommandHistory({
    command: normalizedCommand,
    cwd: session.cwd,
    paneId,
    profileId: session.profileId,
    remoteHostId: session.remoteHostId,
    sessionId: session.sessionId,
    shell: session.shell,
    source,
    tabId,
    target: session.target,
  });

  return {
    paneId,
    sent: true,
    sessionId: session.sessionId,
    target: session.target,
  };
}

export async function writeSnippetCommand(
  request: SnippetWriteRequest,
): Promise<SnippetWriteResult> {
  const normalizedCommand = request.command.trim();
  if (!normalizedCommand) {
    return { paneId: request.paneId, reason: "empty-command", sent: false };
  }
  if (/[\r\n]/.test(normalizedCommand)) {
    return {
      paneId: request.paneId,
      reason: "multiline-unsupported",
      sent: false,
    };
  }
  const session = paneSessions.get(request.paneId);
  if (!session) {
    return { paneId: request.paneId, reason: "missing-session", sent: false };
  }
  if (!snippetBindingMatches(request, session)) {
    return { paneId: request.paneId, reason: "stale-binding", sent: false };
  }
  await writeTerminal(session.sessionId, normalizedCommand);
  return {
    paneId: request.paneId,
    sent: true,
    sessionId: session.sessionId,
    target: session.target,
  };
}

/** 显式运行片段；旧右栏在 V2 切换前继续使用该入口。 */
export async function runSnippetCommand(
  request: SnippetWriteRequest,
): Promise<SnippetWriteResult> {
  const session = paneSessions.get(request.paneId);
  if (!session) {
    return { paneId: request.paneId, reason: "missing-session", sent: false };
  }
  if (!snippetBindingMatches(request, session)) {
    return { paneId: request.paneId, reason: "stale-binding", sent: false };
  }
  if (request.recordHistory === false) {
    const command = request.command.trim();
    if (!command) {
      return { paneId: request.paneId, reason: "empty-command", sent: false };
    }
    await writeTerminal(session.sessionId, `${command}\r`);
    return {
      paneId: request.paneId,
      sent: true,
      sessionId: session.sessionId,
      target: session.target,
    };
  }
  return writePaneCommand({ ...request, source: "snippet" });
}

/** 确认弹框期间连接发生重建或换目标时，旧意图不得写入新会话。 */
function snippetBindingMatches(
  request: SnippetWriteRequest,
  session: PaneSessionRecord,
): boolean {
  return (
    (request.expectedSessionId === undefined ||
      request.expectedSessionId === session.sessionId) &&
    (request.expectedConnectionGeneration === undefined ||
      request.expectedConnectionGeneration === session.connectionGeneration) &&
    (request.expectedTargetRef === undefined ||
      request.expectedTargetRef ===
        (session.targetRef ?? session.remoteHostId ?? session.sessionId))
  );
}

export async function writeWorkflowCommand(
  request: SnippetWriteRequest,
): Promise<WorkflowWriteResult> {
  return writePaneCommand({ ...request, source: "workflow" });
}
