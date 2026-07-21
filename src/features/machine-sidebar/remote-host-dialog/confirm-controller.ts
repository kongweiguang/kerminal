import type { Dispatch, SetStateAction } from "react";
import type {
  RemoteHost,
  RemoteHostAuthType,
  RemoteHostCreateRequest,
  RemoteHostUpdateRequest,
  SshOptions,
} from "../../../lib/remoteHostApi";
import { buildUserFacingError, type UserFacingMessage } from "../../../lib/userFacingMessage";
import type { Machine } from "../../workspace/contracts/index";
import { buildLocalTerminalOptions } from "./local-form";
import type { ConnectionMode, RemoteHostCreateDialogProps } from "./model";
import {
  buildRdpHostRequest,
  buildSerialHostRequest,
  buildSshRequest,
  buildTelnetHostRequest,
  isRdpRemoteHost,
  validateRdpHostRequest,
  validateSerialHostRequest,
  validateSshRequest,
  validateTelnetHostRequest,
} from "./request-builders";

type ConfirmCallbacks = Pick<
  RemoteHostCreateDialogProps,
  "onClose" | "onCreateHost" | "onCreateLocal" | "onCreated" | "onUpdateHost" | "onUpdateLocal"
>;

export interface RemoteHostConfirmInput extends ConfirmCallbacks {
  authType: RemoteHostAuthType;
  credentialRef: string;
  credentialSecret: string;
  editingHost?: RemoteHost;
  editingLocalMachine?: Machine;
  externalConfigConflict?: string;
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
  rdpPassword: string;
  rdpUsername: string;
  selectedProtocolLabel: string;
  serialBaud: string;
  serialDataBits: string;
  serialFlow: string;
  serialParity: string;
  serialPort: string;
  serialStopBits: string;
  setError: Dispatch<SetStateAction<string | null>>;
  setOperationError: (error: UserFacingMessage | null) => void;
  setSavingAction: (action: "confirm" | "test" | null) => void;
  sshOptions: SshOptions;
  tags: string;
  username: string;
}

/** 连接确认 command controller：校验 draft 后只通过传入 adapter 执行保存。 */
export async function executeRemoteHostConfirm(input: RemoteHostConfirmInput) {
  const {
    editingHost, editingLocalMachine, externalConfigConflict, mode, setError,
    setOperationError, setSavingAction,
  } = input;
  if ((editingHost || editingLocalMachine) && externalConfigConflict) {
    setError(externalConfigConflict);
    return;
  }
  if (mode === "local") {
    await saveLocal(input);
    return;
  }

  let request: RemoteHostCreateRequest;
  let validationError: string | null | undefined;
  let failure: { detail: string; recoveryAction: string; title: string };
  if (mode === "rdp") {
    request = buildRdpHostRequest({
      existingAuthType: editingHost && isRdpRemoteHost(editingHost) ? editingHost.authType : undefined,
      groupId: input.groupId, host: input.host, name: input.name,
      password: input.rdpPassword, port: input.port, production: input.production,
      tags: input.tags, username: input.rdpUsername,
    });
    validationError = validateRdpHostRequest(request);
    failure = {
      detail: "当前 RDP 连接配置尚未保存。",
      recoveryAction: "请检查地址、网络和认证信息后重试。",
      title: editingHost ? "无法更新 RDP 连接" : "无法创建 RDP 连接",
    };
  } else if (mode === "telnet") {
    request = buildTelnetHostRequest({
      groupId: input.groupId, host: input.host, name: input.name, port: input.port,
      production: input.production, tags: input.tags,
    });
    validationError = validateTelnetHostRequest(request);
    failure = {
      detail: "当前 Telnet 连接配置尚未保存。",
      recoveryAction: "请检查地址和网络后重试。",
      title: editingHost ? "无法更新 Telnet 连接" : "无法创建 Telnet 连接",
    };
  } else if (mode === "serial") {
    request = buildSerialHostRequest({
      groupId: input.groupId, name: input.name, production: input.production,
      serialBaud: input.serialBaud, serialDataBits: input.serialDataBits,
      serialFlow: input.serialFlow, serialParity: input.serialParity,
      serialPort: input.serialPort, serialStopBits: input.serialStopBits, tags: input.tags,
    });
    validationError = validateSerialHostRequest(request);
    failure = {
      detail: "当前串口连接配置尚未保存。",
      recoveryAction: "请检查串口设备和通信参数后重试。",
      title: editingHost ? "无法更新串口连接" : "无法创建串口连接",
    };
  } else if (mode === "ssh" || mode === "sftp") {
    request = buildSshRequest({
      authType: input.authType, credentialRef: input.credentialRef,
      credentialSecret: input.credentialSecret, groupId: input.groupId,
      host: input.host, name: input.name, port: input.port,
      production: input.production, sshOptions: input.sshOptions,
      tags: input.tags, username: input.username,
      protocol: mode,
    });
    validationError = validateSshRequest(request);
    failure = {
      detail: `当前 ${mode === "sftp" ? "SFTP" : "SSH"} 连接配置尚未保存。`,
      recoveryAction: "请检查地址、网络和认证信息后重试。",
      title: editingHost
        ? `无法更新 ${mode === "sftp" ? "SFTP" : "SSH"} 连接`
        : `无法创建 ${mode === "sftp" ? "SFTP" : "SSH"} 连接`,
    };
  } else {
    setError(`${input.selectedProtocolLabel} 暂未支持创建。`);
    return;
  }
  if (validationError) {
    setError(validationError);
    return;
  }

  setSavingAction("confirm");
  setError(null);
  try {
    const saved = editingHost && input.onUpdateHost
      ? await input.onUpdateHost({ ...request, id: editingHost.id, sortOrder: editingHost.sortOrder } as RemoteHostUpdateRequest)
      : await input.onCreateHost(request);
    await input.onCreated?.(saved);
    input.onClose();
  } catch (caught) {
    setOperationError(buildUserFacingError(caught, failure));
  } finally {
    setSavingAction(null);
  }
}

async function saveLocal(input: RemoteHostConfirmInput) {
  const result = buildLocalTerminalOptions({
    args: input.localArgs, cwd: input.localCwd, env: input.localEnv,
    groupId: input.groupId, shell: input.localShell, title: input.localTitle,
  }, Boolean(input.editingLocalMachine));
  if (result.error) {
    input.setError(result.error);
    return;
  }
  if (input.editingLocalMachine) {
    if (!input.onUpdateLocal || !result.options) {
      input.setError("当前运行环境不支持更新本地会话。");
      return;
    }
    if (input.editingLocalMachine.profileId && !result.options.shell?.trim()) {
      input.setError("编辑已保存的本地终端需要指定 Shell。");
      return;
    }
  } else if (!input.onCreateLocal) {
    input.setError("当前运行环境不支持创建本地会话。");
    return;
  }

  input.setSavingAction("confirm");
  input.setError(null);
  try {
    if (input.editingLocalMachine && input.onUpdateLocal && result.options) {
      await input.onUpdateLocal(input.editingLocalMachine.id, result.options);
    } else {
      await input.onCreateLocal?.(result.options);
    }
    input.onClose();
  } catch (caught) {
    input.setOperationError(buildUserFacingError(caught, {
      detail: input.editingLocalMachine ? "本地会话修改尚未保存。" : "本地会话尚未创建。",
      recoveryAction: "请检查 Shell 和工作目录后重试。",
      title: input.editingLocalMachine ? "无法更新本地会话" : "无法创建本地会话",
    }));
  } finally {
    input.setSavingAction(null);
  }
}
