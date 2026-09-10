// @author kongweiguang

import {
  createDockerContainerTerminalSession,
  createSerialTerminalSession,
  createTelnetTerminalSession,
  createTerminalSession,
  type TerminalOutputEvent,
  type TerminalSessionSummary,
} from "../../lib/terminalApi";
import type { RemoteTargetRef } from "../../lib/targetModel";
import {
  buildTerminalCreateRequest,
  normalizeTerminalSessionSize,
} from "./XtermPane.helpers";
import { createSshTerminalSessionWithAuthRecovery } from "./XtermPane.sshAuthRecovery";
import type { SshAuthPromptRequest } from "../../lib/sshAuthApi";

interface CreateXtermPaneTerminalSessionOptions {
  args?: string[];
  cols: number;
  currentCwd?: string;
  cwd?: string;
  env?: Record<string, string>;
  onOutput: (event: TerminalOutputEvent) => void;
  isPromptOwnerActive?: () => boolean;
  promptOwnerId?: string;
  promptForSecret: (prompt: SshAuthPromptRequest) => Promise<string | null>;
  remoteCommand?: string;
  remoteHostId?: string;
  rows: number;
  shell?: string;
  target?: RemoteTargetRef;
}

/**
 * 根据 pane target 创建对应终端 session；SSH 专属恢复仍在此边界内，调用方只负责生命周期和错误展示。
 * promptOwnerId 与 generation 检查让 pane 关闭时未完成的 host-key 确认不能重新打开会话。
 */
export function createXtermPaneTerminalSession({
  args,
  cols,
  currentCwd,
  cwd,
  env,
  isPromptOwnerActive,
  onOutput,
  promptOwnerId,
  promptForSecret,
  remoteCommand,
  remoteHostId,
  rows,
  shell,
  target,
}: CreateXtermPaneTerminalSessionOptions): Promise<TerminalSessionSummary> {
  const sessionSize = normalizeTerminalSessionSize({ cols, rows });
  if (target?.kind === "dockerContainer") {
    return createDockerContainerTerminalSession(
      {
        cols: sessionSize.cols,
        containerId: target.containerId,
        hostId: target.hostId,
        rows: sessionSize.rows,
        runtime: target.runtime,
        shell,
        user: target.user,
        workdir: target.workdir,
      },
      onOutput,
    );
  }
  if (target?.kind === "telnet") {
    return createTelnetTerminalSession(
      { cols: sessionSize.cols, hostId: target.hostId, rows: sessionSize.rows },
      onOutput,
    );
  }
  if (target?.kind === "serial") {
    return createSerialTerminalSession(
      { cols: sessionSize.cols, hostId: target.hostId, rows: sessionSize.rows },
      onOutput,
    );
  }
  if (remoteHostId) {
    return createSshTerminalSessionWithAuthRecovery(
      {
        cols: sessionSize.cols,
        ...(currentCwd ?? cwd ? { cwd: currentCwd ?? cwd } : {}),
        hostId: remoteHostId,
        ...(remoteCommand ? { remoteCommand } : {}),
        rows: sessionSize.rows,
      },
      onOutput,
      promptForSecret,
      { isPromptOwnerActive, promptOwnerId },
    );
  }
  return createTerminalSession(
    buildTerminalCreateRequest({
      args,
      cols: sessionSize.cols,
      cwd,
      env,
      rows: sessionSize.rows,
      shell,
    }),
    onOutput,
  );
}
