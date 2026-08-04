// @author kongweiguang

import type {
  RemoteHostAuthType,
  SshOptions,
} from "../../../lib/remoteHostApi";
import type { ConnectionTestRequest } from "../../../lib/connectionApi";
import { buildLocalTerminalOptions } from "./local-form";
import type { ConnectionMode } from "./model";
import {
  buildRdpRequest,
  buildSerialHostRequest,
  buildSshRequest,
  buildTelnetHostRequest,
  validateRdpRequest,
  validateSerialHostRequest,
  validateSshRequest,
  validateTelnetHostRequest,
} from "./request-builders";

export interface ConnectionCheckInput {
  authType: RemoteHostAuthType;
  credentialRef: string;
  credentialSecret: string;
  keyPassphraseSecret: string;
  editingLocalMachine: boolean;
  groupId: string;
  host: string;
  localArgs: string;
  localCwd: string;
  localEnv: string;
  localShell: string;
  localTitle: string;
  mode: ConnectionMode;
  name: string;
  port: string;
  production: boolean;
  rdpFullscreen: boolean;
  rdpHeight: string;
  rdpNote: string;
  rdpPassword: string;
  rdpUsername: string;
  rdpWidth: string;
  selectedProtocolLabel: string;
  serialBaud: string;
  serialDataBits: string;
  serialFlow: string;
  serialParity: string;
  serialPort: string;
  serialStopBits: string;
  sshOptions: SshOptions;
  tags: string;
  username: string;
}

export type ConnectionCheckResult =
  | { error: string; ok: false }
  | { ok: true; statusMessage: string; testRequest?: never }
  | { ok: true; statusMessage?: never; testRequest: ConnectionTestRequest };

export function evaluateConnectionCheck({
  authType,
  credentialRef,
  credentialSecret,
  keyPassphraseSecret,
  editingLocalMachine,
  groupId,
  host,
  localArgs,
  localCwd,
  localEnv,
  localShell,
  localTitle,
  mode,
  name,
  port,
  production,
  rdpFullscreen,
  rdpHeight,
  rdpNote,
  rdpPassword,
  rdpUsername,
  rdpWidth,
  selectedProtocolLabel,
  serialBaud,
  serialDataBits,
  serialFlow,
  serialParity,
  serialPort,
  serialStopBits,
  sshOptions,
  tags,
  username,
}: ConnectionCheckInput): ConnectionCheckResult {
  if (mode === "local") {
    const localOptionsResult = buildLocalTerminalOptions({
      args: localArgs,
      cwd: localCwd,
      env: localEnv,
      groupId,
      shell: localShell,
      title: localTitle,
    });
    if (localOptionsResult.error) {
      return { error: localOptionsResult.error, ok: false };
    }
    return {
      ok: true,
      statusMessage: editingLocalMachine
        ? "本地终端配置检查通过，确认后会保存到左侧卡片。"
        : "本地终端无需连接测试，确认后会创建本地会话。",
    };
  }

  if (mode === "rdp") {
    const request = buildRdpRequest({
      fullscreen: rdpFullscreen,
      height: rdpHeight,
      host,
      name,
      note: rdpNote,
      password: rdpPassword,
      port,
      username: rdpUsername,
      width: rdpWidth,
    });
    const validationError = validateRdpRequest(request);
    return validationError
      ? { error: validationError, ok: false }
      : { ok: true, testRequest: { mode: "rdp", request } };
  }

  if (mode === "telnet") {
    const request = buildTelnetHostRequest({
      groupId,
      host,
      name,
      port,
      production,
      tags,
    });
    const validationError = validateTelnetHostRequest(request);
    return validationError
      ? { error: validationError, ok: false }
      : { ok: true, testRequest: { host: request, mode: "telnet" } };
  }

  if (mode === "serial") {
    const request = buildSerialHostRequest({
      groupId,
      name,
      production,
      serialBaud,
      serialDataBits,
      serialFlow,
      serialParity,
      serialPort,
      serialStopBits,
      tags,
    });
    const validationError = validateSerialHostRequest(request);
    return validationError
      ? { error: validationError, ok: false }
      : { ok: true, testRequest: { host: request, mode: "serial" } };
  }

  if (mode !== "ssh" && mode !== "sftp") {
    return { error: `${selectedProtocolLabel} 暂未支持测试。`, ok: false };
  }

  const request = buildSshRequest({
    authType,
    credentialRef,
    credentialSecret,
    keyPassphraseSecret,
    groupId,
    host,
    name,
    port,
    production,
    sshOptions,
    tags,
    username,
    protocol: mode,
  });
  const validationError = validateSshRequest(request);
  return validationError
    ? { error: validationError, ok: false }
    : { ok: true, testRequest: { host: request, mode } };
}
