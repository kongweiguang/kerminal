// @author kongweiguang
import { Channel, invoke, isTauri } from "@tauri-apps/api/core";
import { readDesktopClipboardText } from "./desktopClipboardApi";
import type { SshAuthPromptPlan } from "./sshAuthApi";
import type { ContainerRuntime } from "./targetModel";

type TerminalOutputKind = "data" | "agentSignal" | "closed" | "error";

type TerminalSessionStatus = "running" | "exited";
type TerminalShellIntegrationStatus = "enabled" | "disabled";
export type TerminalAgentKind = "codex" | "claude" | "gemini";
export type TerminalAgentStatus =
  | "working"
  | "attention"
  | "finished"
  | "exited";

export interface TerminalCreateRequest {
  shell?: string;
  args?: string[];
  cwd?: string;
  cols: number;
  rows: number;
  env?: Record<string, string>;
}

export interface SshTerminalCreateRequest {
  hostId: string;
  cwd?: string;
  remoteCommand?: string;
  cols: number;
  rows: number;
}

export interface TelnetTerminalCreateRequest {
  hostId: string;
  cols: number;
  rows: number;
}

export interface SerialTerminalCreateRequest {
  hostId: string;
  cols: number;
  rows: number;
}

export interface DockerContainerTerminalCreateRequest {
  hostId: string;
  containerId: string;
  runtime?: ContainerRuntime;
  shell?: string;
  user?: string;
  workdir?: string;
  cols: number;
  rows: number;
}

export interface TerminalResizeRequest {
  cols: number;
  rows: number;
}

export interface TerminalOutputEvent {
  sessionId: string;
  kind: TerminalOutputKind;
  data: string;
  agentSignal?: TerminalAgentSignal;
  error?: TerminalCommandError;
}

export interface TerminalSessionSummary {
  id: string;
  shell: string;
  cwd?: string;
  cols: number;
  rows: number;
  pid?: number;
  status: TerminalSessionStatus;
  targetRef?: string;
  targetToken?: string;
  shellIntegration: TerminalShellIntegrationSummary;
  agentSessionId?: string;
  agentSignal?: TerminalAgentSignal;
}

interface TerminalShellIntegrationSummary {
  status: TerminalShellIntegrationStatus;
  shell?: string;
  scriptPath?: string;
  reason?: string;
}

export interface TerminalAgentSignal {
  agentSessionId?: string;
  terminalSessionId: string;
  agent: TerminalAgentKind;
  status: TerminalAgentStatus;
}

export interface TerminalSessionReapDiagnostics {
  reapedCount: number;
  sessionIds: string[];
  elapsedMs: number;
}

export interface TerminalReconnectRequest {
  requestId: string;
  paneId: string;
  timeoutMs: number;
}

export interface TerminalReconnectAck {
  requestId: string;
  paneId: string;
  success: boolean;
  error?: string;
}

export const TERMINAL_RECONNECT_REQUEST_EVENT =
  "kerminal://terminal-reconnect-request" as const;

type TerminalPtyOutputPumpFlushReason =
  | "threshold"
  | "idle"
  | "closed"
  | "error"
  | "disconnected";

export interface TerminalPtyOutputPumpStats {
  bufferedChunks: number;
  closedEvents: number;
  coalescedChunks: number;
  dataEvents: number;
  droppedBytes: number;
  errorEvents: number;
  finalTailFlushCount: number;
  finished: boolean;
  flushCount: number;
  inputBytes: number;
  inputChunks: number;
  lastFlushIntervalMs?: number;
  lastFlushReason?: TerminalPtyOutputPumpFlushReason;
  maxPendingBytes: number;
  maxPendingHitCount: number;
  outputBytes: number;
  overflowCount: number;
  pendingBytes: number;
  sessionId: string;
}

type TerminalErrorClass =
  | "sshAuthRequired"
  | "spawnFailed"
  | "ptyReadFailed"
  | "ptyWriteFailed"
  | "resizeFailed"
  | "sessionClosed"
  | "sessionNotFound"
  | "permissionDenied"
  | "invalidInput"
  | "encodingFailure"
  | "loggingFailure"
  | "stateUnavailable"
  | "dependencyMissing"
  | "unknown";

type TerminalErrorRecovery =
  | "retryable"
  | "userActionRequired"
  | "notRetryable"
  | "internal";

type TerminalErrorOperation =
  | "createSession"
  | "readOutput"
  | "write"
  | "resize"
  | "close"
  | "listSessions"
  | "sessionSummary"
  | "outputSnapshot"
  | "startLog"
  | "stopLog"
  | "logState"
  | "reapOrphanSessions"
  | "diagnostics";

export interface TerminalCommandError {
  class: TerminalErrorClass;
  recovery: TerminalErrorRecovery;
  operation: TerminalErrorOperation;
  message: string;
  retryable: boolean;
  sshAuthPromptPlan?: SshAuthPromptPlan;
}

export class TerminalApiError extends Error {
  readonly terminalError: TerminalCommandError;

  constructor(terminalError: TerminalCommandError) {
    super(terminalError.message);
    this.name = "TerminalApiError";
    this.terminalError = terminalError;
  }

  toString() {
    return this.message;
  }
}

export function getTerminalCommandError(
  error: unknown,
): TerminalCommandError | undefined {
  if (error instanceof TerminalApiError) {
    return error.terminalError;
  }
  if (isTerminalCommandErrorPayload(error)) {
    return error;
  }
  return undefined;
}

export interface TerminalSessionLogState {
  active: boolean;
  path?: string;
  startedAt?: string;
  bytesWritten: number;
}

type TerminalOutputHandler = (event: TerminalOutputEvent) => void;

const browserPreviewSessions = new Map<string, TerminalOutputHandler>();
const browserPreviewLogStates = new Map<string, TerminalSessionLogState>();

async function invokeTerminalCommand<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  try {
    if (args === undefined) {
      return await invoke<T>(command);
    }
    return await invoke<T>(command, args);
  } catch (error) {
    throw new TerminalApiError(normalizeTerminalCommandError(error));
  }
}

function normalizeTerminalCommandError(error: unknown): TerminalCommandError {
  if (isTerminalCommandErrorPayload(error)) {
    return error;
  }
  if (error instanceof Error) {
    return unknownTerminalCommandError(error.message);
  }
  return unknownTerminalCommandError(String(error));
}

function unknownTerminalCommandError(message: string): TerminalCommandError {
  return {
    class: "unknown",
    recovery: "internal",
    operation: "diagnostics",
    message,
    retryable: false,
  };
}

function isTerminalCommandErrorPayload(
  value: unknown,
): value is TerminalCommandError {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.class === "string" &&
    typeof value.recovery === "string" &&
    typeof value.operation === "string" &&
    typeof value.message === "string" &&
    typeof value.retryable === "boolean"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export async function createTerminalSession(
  request: TerminalCreateRequest,
  onOutput: TerminalOutputHandler,
): Promise<TerminalSessionSummary> {
  if (!isTauri()) {
    return createBrowserPreviewSession(request, onOutput);
  }

  const output = createTerminalOutputChannel(onOutput);
  return invokeTerminalCommand<TerminalSessionSummary>("terminal_create_session", {
    output,
    request: normalizeCreateRequest(request),
  });
}

export async function createSshTerminalSession(
  request: SshTerminalCreateRequest,
  onOutput: TerminalOutputHandler,
): Promise<TerminalSessionSummary> {
  if (!isTauri()) {
    return createBrowserPreviewSession(
      {
        cols: request.cols,
        cwd: request.cwd,
        rows: request.rows,
        shell: "ssh-preview",
      },
      onOutput,
      request.remoteCommand
        ? `Kerminal 浏览器预览\r\nSSH 启动命令：${request.remoteCommand}\r\n`
        : "Kerminal 浏览器预览\r\n请在桌面应用中连接真实 SSH 主机。\r\n",
    );
  }

  const output = createTerminalOutputChannel(onOutput);
  return invokeTerminalCommand<TerminalSessionSummary>("ssh_create_session", {
    output,
    request,
  });
}

export async function createTelnetTerminalSession(
  request: TelnetTerminalCreateRequest,
  onOutput: TerminalOutputHandler,
): Promise<TerminalSessionSummary> {
  if (!isTauri()) {
    return createBrowserPreviewSession(
      {
        cols: request.cols,
        rows: request.rows,
        shell: "telnet-preview",
      },
      onOutput,
      "Kerminal 浏览器预览\r\n请在桌面应用中连接真实 Telnet 主机。\r\n",
    );
  }

  const output = createTerminalOutputChannel(onOutput);
  return invokeTerminalCommand<TerminalSessionSummary>("telnet_create_session", {
    output,
    request,
  });
}

export async function createSerialTerminalSession(
  request: SerialTerminalCreateRequest,
  onOutput: TerminalOutputHandler,
): Promise<TerminalSessionSummary> {
  if (!isTauri()) {
    return createBrowserPreviewSession(
      {
        cols: request.cols,
        rows: request.rows,
        shell: "serial-preview",
      },
      onOutput,
      "Kerminal 浏览器预览\r\n请在桌面应用中连接真实 Serial 设备。\r\n",
    );
  }

  const output = createTerminalOutputChannel(onOutput);
  return invokeTerminalCommand<TerminalSessionSummary>("serial_create_session", {
    output,
    request,
  });
}

export async function createDockerContainerTerminalSession(
  request: DockerContainerTerminalCreateRequest,
  onOutput: TerminalOutputHandler,
): Promise<TerminalSessionSummary> {
  if (!isTauri()) {
    return createBrowserPreviewSession(
      {
        cols: request.cols,
        rows: request.rows,
        shell: "container-preview",
      },
      onOutput,
      `Kerminal 浏览器预览\r\n请在桌面应用中进入容器：${request.containerId}\r\n`,
    );
  }

  const output = createTerminalOutputChannel(onOutput);
  return invokeTerminalCommand<TerminalSessionSummary>(
    "docker_create_container_session",
    {
      output,
      request: normalizeDockerContainerCreateRequest(request),
    },
  );
}

function createTerminalOutputChannel(onOutput: TerminalOutputHandler) {
  return new Channel<TerminalOutputEvent>((event) => {
    try {
      onOutput(event);
    } catch (error: unknown) {
      // 输出回调失败属于前端渲染/解析问题，不能让 Tauri Channel 失效并误伤后端会话。
      console.error("terminal output handler failed", error);
    }
  });
}

export async function writeTerminal(
  sessionId: string,
  data: string,
): Promise<void> {
  if (!isTauri()) {
    browserPreviewSessions.get(sessionId)?.({
      sessionId,
      kind: "data",
      data: `\r\n${data}浏览器预览模式不会执行本地命令。\r\n`,
    });
    return;
  }

  await invokeTerminalCommand("terminal_write", { data, sessionId });
}

export async function readTerminalClipboardText(): Promise<string> {
  return readDesktopClipboardText();
}

export async function resizeTerminal(
  sessionId: string,
  request: TerminalResizeRequest,
): Promise<void> {
  if (!isTauri()) {
    return;
  }

  await invokeTerminalCommand("terminal_resize", { request, sessionId });
}

export async function closeTerminal(sessionId: string): Promise<void> {
  if (!isTauri()) {
    browserPreviewSessions.delete(sessionId);
    browserPreviewLogStates.delete(sessionId);
    return;
  }

  await invokeTerminalCommand("terminal_close", { sessionId });
}

/** 将 pane 重连结果回传 Rust request/ack 协调器，保持连接参数只由现有 pane runtime 持有。 */
export async function acknowledgeTerminalReconnect(
  ack: TerminalReconnectAck,
): Promise<void> {
  if (!isTauri()) {
    return;
  }
  await invokeTerminalCommand("terminal_reconnect_ack", { ack });
}

export async function reapOrphanTerminalSessions(): Promise<TerminalSessionReapDiagnostics> {
  if (!isTauri()) {
    return {
      elapsedMs: 0,
      reapedCount: 0,
      sessionIds: [],
    };
  }

  return invokeTerminalCommand<TerminalSessionReapDiagnostics>(
    "terminal_reap_orphan_sessions",
  );
}

export async function listTerminalSessions(): Promise<TerminalSessionSummary[]> {
  if (!isTauri()) {
    return Array.from(browserPreviewSessions.keys()).map((id) => ({
      id,
      shell: "browser-preview",
      cols: 80,
      rows: 24,
      status: "running",
      shellIntegration: {
        reason: "browser preview",
        status: "disabled",
      },
    }));
  }

  return invokeTerminalCommand<TerminalSessionSummary[]>(
    "terminal_list_sessions",
  );
}

export async function getTerminalPtyOutputPumpStats(
  sessionId: string,
): Promise<TerminalPtyOutputPumpStats> {
  if (!isTauri()) {
    return inactiveBrowserPreviewPumpStats(sessionId);
  }

  return invokeTerminalCommand<TerminalPtyOutputPumpStats>(
    "terminal_pty_output_pump_stats",
    {
      sessionId,
    },
  );
}

export async function startTerminalLog(
  sessionId: string,
): Promise<TerminalSessionLogState> {
  if (!isTauri()) {
    return startBrowserPreviewLog(sessionId);
  }

  return invokeTerminalCommand<TerminalSessionLogState>("terminal_start_log", {
    sessionId,
  });
}

export async function stopTerminalLog(
  sessionId: string,
): Promise<TerminalSessionLogState> {
  if (!isTauri()) {
    const previous = browserPreviewLogStates.get(sessionId);
    const stopped = previous
      ? { ...previous, active: false }
      : inactiveLogState();
    browserPreviewLogStates.set(sessionId, stopped);
    return stopped;
  }

  return invokeTerminalCommand<TerminalSessionLogState>("terminal_stop_log", {
    sessionId,
  });
}

export async function getTerminalLogState(
  sessionId: string,
): Promise<TerminalSessionLogState> {
  if (!isTauri()) {
    return browserPreviewLogStates.get(sessionId) ?? inactiveLogState();
  }

  return invokeTerminalCommand<TerminalSessionLogState>("terminal_log_state", {
    sessionId,
  });
}

function normalizeCreateRequest(
  request: TerminalCreateRequest,
): TerminalCreateRequest {
  return {
    ...request,
    args: request.args ?? [],
    env: request.env ?? {},
  };
}

function normalizeDockerContainerCreateRequest(
  request: DockerContainerTerminalCreateRequest,
): DockerContainerTerminalCreateRequest {
  return {
    ...request,
    containerId: request.containerId.trim(),
    hostId: request.hostId.trim(),
    runtime: request.runtime ?? "docker",
    ...(request.shell?.trim() ? { shell: request.shell.trim() } : {}),
    ...(request.user?.trim() ? { user: request.user.trim() } : {}),
    ...(request.workdir?.trim() ? { workdir: request.workdir.trim() } : {}),
  };
}

function createBrowserPreviewSession(
  request: TerminalCreateRequest,
  onOutput: TerminalOutputHandler,
  welcomeText = "Kerminal 浏览器预览\r\n请在桌面应用中使用真实 PTY。\r\n",
): TerminalSessionSummary {
  const id = `browser-preview-${Date.now().toString(36)}`;
  browserPreviewSessions.set(id, onOutput);
  browserPreviewLogStates.set(id, inactiveLogState());

  queueMicrotask(() => {
    onOutput({
      sessionId: id,
      kind: "data",
      data: welcomeText,
    });
  });

  return {
    id,
    shell: request.shell ?? "browser-preview",
    cols: request.cols,
    rows: request.rows,
    status: "running",
    targetRef: "local",
    shellIntegration: {
      reason: "browser preview",
      status: "disabled",
    },
  };
}

function startBrowserPreviewLog(sessionId: string): TerminalSessionLogState {
  const current = browserPreviewLogStates.get(sessionId);
  if (current?.active) {
    return current;
  }

  const state: TerminalSessionLogState = {
    active: true,
    bytesWritten: 0,
    path: `browser-preview://${sessionId}.log`,
    startedAt: Math.floor(Date.now() / 1000).toString(),
  };
  browserPreviewLogStates.set(sessionId, state);
  return state;
}

function inactiveLogState(): TerminalSessionLogState {
  return {
    active: false,
    bytesWritten: 0,
  };
}

function inactiveBrowserPreviewPumpStats(
  sessionId: string,
): TerminalPtyOutputPumpStats {
  return {
    bufferedChunks: 0,
    closedEvents: 0,
    coalescedChunks: 0,
    dataEvents: 0,
    droppedBytes: 0,
    errorEvents: 0,
    finalTailFlushCount: 0,
    finished: false,
    flushCount: 0,
    inputBytes: 0,
    inputChunks: 0,
    maxPendingBytes: 0,
    maxPendingHitCount: 0,
    outputBytes: 0,
    overflowCount: 0,
    pendingBytes: 0,
    sessionId,
  };
}
