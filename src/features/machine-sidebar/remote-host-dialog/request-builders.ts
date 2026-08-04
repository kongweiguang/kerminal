// @author kongweiguang

import {
  createDefaultSshOptions,
  type RemoteHost,
  type RemoteHostAuthType,
  type RemoteHostCreateRequest,
  type RemoteHostProtocol,
  type SshJumpHostOptions,
  type SshOptions,
  type SshTunnelOptions,
} from "../../../lib/remoteHostApi";

export function normalizeSshOptionsForForm(options: SshOptions | undefined): SshOptions {
  const defaults = createDefaultSshOptions();
  return {
    jumpHosts:
      options?.jumpHosts?.map((jumpHost) =>
        normalizeJumpHostDraft({
          authType: jumpHost.authType ?? "agent",
          credentialRef: normalizePrivateKeyPath(jumpHost.credentialRef),
          credentialSecret:
            (jumpHost.authType ?? "agent") === "agent"
              ? undefined
              : trimOptional(jumpHost.credentialSecret),
          host: jumpHost.host ?? "",
          name: jumpHost.name ?? "",
          port: jumpHost.port ?? 22,
          username: jumpHost.username ?? "",
        }),
      ) ?? [],
    proxy: {
      ...defaults.proxy,
      ...options?.proxy,
      credentialRef: undefined,
      host: trimOptional(options?.proxy?.host),
      username: trimOptional(options?.proxy?.username),
    },
    terminal: {
      ...defaults.terminal,
      ...options?.terminal,
      altModifier:
        trimText(options?.terminal?.altModifier) || defaults.terminal.altModifier,
      backspaceKey:
        trimText(options?.terminal?.backspaceKey) || defaults.terminal.backspaceKey,
      deleteKey:
        trimText(options?.terminal?.deleteKey) || defaults.terminal.deleteKey,
      encoding: trimText(options?.terminal?.encoding) || defaults.terminal.encoding,
      keyboardProfile:
        trimText(options?.terminal?.keyboardProfile) ||
        defaults.terminal.keyboardProfile,
      terminalType:
        trimText(options?.terminal?.terminalType) || defaults.terminal.terminalType,
    },
    transfer: {
      ...defaults.transfer,
      ...options?.transfer,
      localStartDirectory: trimText(options?.transfer?.localStartDirectory),
      remoteStartDirectory: trimText(options?.transfer?.remoteStartDirectory),
    },
    tunnels:
      options?.tunnels?.map((tunnel) =>
        normalizeTunnelDraft({
          bindHost: tunnel.bindHost ?? "",
          bindPort: tunnel.bindPort,
          kind: tunnel.kind ?? "local",
          name: tunnel.name ?? "",
          targetHost: tunnel.targetHost ?? "",
          targetPort: tunnel.targetPort,
        }),
      ) ?? [],
  };
}

function normalizeSshOptionsForRequest(options: SshOptions): SshOptions {
  const normalized = normalizeSshOptionsForForm(options);
  const proxy =
    normalized.proxy.protocol === "none"
      ? createDefaultSshOptions().proxy
      : {
          ...normalized.proxy,
          credentialRef: undefined,
          host: trimOptional(normalized.proxy.host),
          username: trimOptional(normalized.proxy.username),
        };

  return {
    ...normalized,
    jumpHosts: normalized.jumpHosts.filter((jumpHost) => jumpHost.host),
    proxy,
    terminal: {
      ...normalized.terminal,
      environment: normalized.terminal.environment.trim(),
      loginScript: normalized.terminal.loginScript.trim(),
      startupCommand: normalized.terminal.startupCommand.trim(),
    },
    transfer: {
      ...normalized.transfer,
      localStartDirectory: normalized.transfer.localStartDirectory.trim(),
      remoteStartDirectory: normalized.transfer.remoteStartDirectory.trim(),
    },
    tunnels: normalized.tunnels.filter(
      (tunnel) =>
        Boolean(tunnel.bindPort) &&
        (tunnel.kind === "dynamic" ||
          (Boolean(tunnel.targetHost) && Boolean(tunnel.targetPort))),
    ),
  };
}

export function normalizeTunnelDraft(tunnel: SshTunnelOptions): SshTunnelOptions {
  const kind = tunnel.kind;
  return {
    bindHost: trimText(tunnel.bindHost) || "127.0.0.1",
    bindPort: tunnel.bindPort,
    kind,
    name: trimText(tunnel.name),
    targetHost: kind === "dynamic" ? "" : trimText(tunnel.targetHost),
    targetPort: kind === "dynamic" ? undefined : tunnel.targetPort,
  };
}

export function normalizeJumpHostDraft(jumpHost: SshJumpHostOptions): SshJumpHostOptions {
  return {
    authType: jumpHost.authType,
    credentialRef: normalizePrivateKeyPath(jumpHost.credentialRef),
    credentialSecret:
      jumpHost.authType === "agent"
        ? undefined
        : trimOptional(jumpHost.credentialSecret),
    host: trimText(jumpHost.host),
    name: trimText(jumpHost.name),
    port: jumpHost.port,
    username: trimText(jumpHost.username),
  };
}

export function trimText(value: string | undefined) {
  return value?.trim() ?? "";
}

export function trimOptional(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function normalizePrivateKeyPath(value: string | undefined) {
  const trimmed = trimOptional(value);
  return trimmed?.startsWith("credential:") ? undefined : trimmed;
}

export function optionalNumber(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function removeAt<T>(items: T[], index: number) {
  return items.filter((_, itemIndex) => itemIndex !== index);
}

export function moveAt<T>(items: T[], from: number, to: number) {
  if (from < 0 || from >= items.length || to < 0 || to >= items.length) {
    return items;
  }
  const nextItems = [...items];
  const [item] = nextItems.splice(from, 1);
  nextItems.splice(to, 0, item);
  return nextItems;
}

export function buildSshRequest({
  authType,
  clearKeyPassphrase,
  credentialRef,
  credentialSecret,
  groupId,
  host,
  keyPassphraseSecret,
  name,
  port,
  production,
  sshOptions,
  tags,
  username,
  protocol,
}: {
  authType: RemoteHostAuthType;
  clearKeyPassphrase?: boolean;
  credentialRef: string;
  credentialSecret: string;
  groupId: string;
  host: string;
  keyPassphraseSecret?: string;
  name: string;
  port: string;
  production: boolean;
  sshOptions: SshOptions;
  tags: string;
  username: string;
  protocol?: Extract<RemoteHostProtocol, "ssh" | "sftp">;
}): RemoteHostCreateRequest {
  return {
    authType,
    ...(authType === "key" && clearKeyPassphrase
      ? { clearKeyPassphrase: true }
      : {}),
    credentialRef:
      authType === "key" ? normalizePrivateKeyPath(credentialRef) : undefined,
    credentialSecret: credentialSecret.trim() ? credentialSecret : undefined,
    ...(authType === "key" && keyPassphraseSecret?.length
      ? { keyPassphraseSecret }
      : {}),
    groupId: groupId || undefined,
    host: host.trim(),
    name: name.trim(),
    port: Number(port),
    protocol: protocol ?? "ssh",
    production,
    sshOptions: normalizeSshOptionsForRequest(sshOptions),
    tags: parseTags(tags),
    username: username.trim(),
  };
}

export function buildRdpRequest({
  fullscreen,
  height,
  host,
  name,
  note,
  password,
  port,
  username,
  width,
}: {
  fullscreen: boolean;
  height: string;
  host: string;
  name: string;
  note: string;
  password: string;
  port: string;
  username: string;
  width: string;
}) {
  return {
    desktopHeight: fullscreen ? undefined : Number(height),
    desktopWidth: fullscreen ? undefined : Number(width),
    fullscreen,
    host: host.trim(),
    name: name.trim(),
    note: note.trim() || undefined,
    password: password.trim() || undefined,
    port: Number(port),
    username: username.trim() || undefined,
  };
}

export function buildRdpHostRequest({
  existingAuthType,
  groupId,
  host,
  name,
  password,
  port,
  production,
  tags,
  username,
}: {
  existingAuthType?: RemoteHostAuthType;
  groupId: string;
  host: string;
  name: string;
  password: string;
  port: string;
  production: boolean;
  tags: string;
  username: string;
}): RemoteHostCreateRequest {
  const trimmedPassword = password.trim();
  const usePasswordAuth = Boolean(trimmedPassword) || existingAuthType === "password";
  return {
    authType: usePasswordAuth ? "password" : "agent",
    credentialRef: undefined,
    credentialSecret: trimmedPassword ? password : undefined,
    groupId: groupId || undefined,
    host: host.trim(),
    name: name.trim(),
    port: Number(port),
    protocol: "rdp",
    production,
    tags: ensureTag(parseTags(tags), "rdp"),
    username: username.trim(),
  };
}

export function buildTelnetHostRequest({
  groupId,
  host,
  name,
  port,
  production,
  tags,
}: {
  groupId: string;
  host: string;
  name: string;
  port: string;
  production: boolean;
  tags: string;
}): RemoteHostCreateRequest {
  return {
    authType: "agent",
    credentialRef: undefined,
    credentialSecret: undefined,
    groupId: groupId || undefined,
    host: host.trim(),
    name: name.trim(),
    port: Number(port),
    protocol: "telnet",
    production,
    tags: ensureTag(parseTags(tags), "telnet"),
    username: "",
  };
}

export function buildSerialHostRequest({
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
}: {
  groupId: string;
  name: string;
  production: boolean;
  serialBaud: string;
  serialDataBits: string;
  serialFlow: string;
  serialParity: string;
  serialPort: string;
  serialStopBits: string;
  tags: string;
}): RemoteHostCreateRequest {
  const normalizedSerialPort = serialPort.trim();
  const normalizedBaud = serialBaud.trim();
  const normalizedDataBits = serialDataBits.trim();
  const normalizedStopBits = serialStopBits.trim();
  const normalizedParity = serialParity.trim().toLowerCase();
  const normalizedFlow = serialFlow.trim().toLowerCase();
  return {
    authType: "agent",
    credentialRef: undefined,
    credentialSecret: undefined,
    groupId: groupId || undefined,
    host: normalizedSerialPort,
    name: name.trim(),
    port: 1,
    protocol: "serial",
    production,
    tags: buildSerialTags(parseTags(tags), {
      baud: normalizedBaud,
      dataBits: normalizedDataBits,
      flow: normalizedFlow,
      parity: normalizedParity,
      port: normalizedSerialPort,
      stopBits: normalizedStopBits,
    }),
    username: "",
  };
}

export function validateSshRequest(request: RemoteHostCreateRequest) {
  if (!request.name) {
    return "请输入主机名称。";
  }
  if (!request.host) {
    return "请输入主机地址。";
  }
  if (!request.username) {
    return "请输入用户名。";
  }
  if (
    request.authType === "password" &&
    !request.credentialSecret
  ) {
    return "密码认证需要输入 SSH 密码。";
  }
  if (
    request.authType === "key" &&
    !request.credentialSecret &&
    !request.credentialRef
  ) {
    return "密钥认证需要填写私钥路径或私钥内容。";
  }
  return validatePort(request.port) ?? validateSshOptions(request.sshOptions);
}

function validateSshOptions(options: SshOptions | undefined) {
  const sshOptions = normalizeSshOptionsForRequest(options ?? createDefaultSshOptions());
  if (sshOptions.proxy.protocol !== "none") {
    if (!sshOptions.proxy.host) {
      return "代理配置需要填写代理主机。";
    }
    const portError = validatePort(sshOptions.proxy.port);
    if (portError) {
      return `代理端口无效：${portError}`;
    }
  }
  for (const [index, jumpHost] of sshOptions.jumpHosts.entries()) {
    if (!jumpHost.host) {
      return `第 ${index + 1} 个跳板机需要填写主机。`;
    }
    if (!jumpHost.username) {
      return `第 ${index + 1} 个跳板机需要填写用户名。`;
    }
    if (jumpHost.authType === "password" && !jumpHost.credentialSecret) {
      return `第 ${index + 1} 个跳板机密码认证需要输入 SSH 密码。`;
    }
    if (
      jumpHost.authType === "key" &&
      !jumpHost.credentialRef &&
      !jumpHost.credentialSecret
    ) {
      return `第 ${index + 1} 个跳板机密钥认证需要填写私钥路径或私钥内容。`;
    }
    const portError = validatePort(jumpHost.port);
    if (portError) {
      return `第 ${index + 1} 个跳板机端口无效：${portError}`;
    }
  }
  for (const [index, tunnel] of sshOptions.tunnels.entries()) {
    const bindPortError = validatePort(tunnel.bindPort);
    if (bindPortError) {
      return `第 ${index + 1} 条隧道监听端口无效：${bindPortError}`;
    }
    if (tunnel.kind !== "dynamic") {
      if (!tunnel.targetHost) {
        return `第 ${index + 1} 条隧道需要填写目标主机。`;
      }
      const targetPortError = validatePort(tunnel.targetPort);
      if (targetPortError) {
        return `第 ${index + 1} 条隧道目标端口无效：${targetPortError}`;
      }
    }
  }
  if (
    sshOptions.terminal.connectTimeoutSeconds < 1 ||
    sshOptions.terminal.connectTimeoutSeconds > 600
  ) {
    return "连接超时时间需要在 1 到 600 秒之间。";
  }
  if (sshOptions.terminal.keepaliveSeconds > 3600) {
    return "心跳间隔不能超过 3600 秒。";
  }
  if (sshOptions.terminal.startupCommand) {
    if (!sshOptions.terminal.startupCommand.startsWith("/")) {
      return "默认目录必须是以 / 开头的远端绝对路径。";
    }
    if (/[\0\r\n]/u.test(sshOptions.terminal.startupCommand)) {
      return "默认目录不能包含换行或非法控制字符。";
    }
    if (sshOptions.terminal.startupCommand.length > 4096) {
      return "默认目录不能超过 4096 个字符。";
    }
  }
  if (
    sshOptions.transfer.maxConcurrentTransfers < 1 ||
    sshOptions.transfer.maxConcurrentTransfers > 16
  ) {
    return "同时传输数量需要在 1 到 16 之间。";
  }
  return null;
}

export function validateRdpHostRequest(request: RemoteHostCreateRequest) {
  if (!request.name) {
    return "请输入 RDP 名称。";
  }
  if (!request.host) {
    return "请输入 RDP 主机地址。";
  }
  if (!request.username) {
    return "请输入 RDP 用户名。";
  }
  return validatePort(request.port);
}

export function validateTelnetHostRequest(request: RemoteHostCreateRequest) {
  if (!request.name) {
    return "请输入 Telnet 名称。";
  }
  if (!request.host) {
    return "请输入 Telnet 主机地址。";
  }
  return validatePort(request.port);
}

export function validateSerialHostRequest(request: RemoteHostCreateRequest) {
  if (!request.name) {
    return "请输入 Serial 名称。";
  }
  if (!request.host) {
    return "请输入串口名称。";
  }
  const tags = request.tags ?? [];
  const baud = Number(readSerialTag(tags, "baud"));
  if (
    !Number.isInteger(baud) ||
    Number.isNaN(baud) ||
    baud < 300 ||
    baud > 4000000
  ) {
    return "波特率必须是 300 到 4000000 之间的整数。";
  }
  if (!["5", "6", "7", "8"].includes(readSerialTag(tags, "data-bits") ?? "")) {
    return "数据位必须是 5、6、7 或 8。";
  }
  if (!["1", "2"].includes(readSerialTag(tags, "stop-bits") ?? "")) {
    return "停止位必须是 1 或 2。";
  }
  if (
    !["none", "odd", "even"].includes(readSerialTag(tags, "parity") ?? "")
  ) {
    return "校验方式必须是 none、odd 或 even。";
  }
  if (
    !["none", "xonxoff", "rtscts"].includes(readSerialTag(tags, "flow") ?? "")
  ) {
    return "流控方式必须是 none、xonxoff 或 rtscts。";
  }
  return validatePort(request.port);
}

export function validateRdpRequest(request: ReturnType<typeof buildRdpRequest>) {
  if (!request.name) {
    return "请输入 RDP 名称。";
  }
  if (!request.host) {
    return "请输入 RDP 主机地址。";
  }
  const portError = validatePort(request.port);
  if (portError) {
    return portError;
  }
  if (
    !request.fullscreen &&
    ((request.desktopWidth !== undefined && request.desktopWidth < 640) ||
      (request.desktopHeight !== undefined && request.desktopHeight < 480))
  ) {
    return "RDP 窗口尺寸不能小于 640x480。";
  }
  return null;
}

function validatePort(port: number | undefined) {
  if (
    typeof port !== "number" ||
    Number.isNaN(port) ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  ) {
    return "端口必须是 1 到 65535 之间的数字。";
  }
  return null;
}

function parseTags(value: string) {
  return Array.from(
    new Set(
      value
        .split(/[,\s，]+/)
        .map((tag) => tag.trim())
        .filter(Boolean),
      ),
  );
}

function ensureTag(tags: string[], tag: string) {
  if (tags.some((candidate) => candidate.toLowerCase() === tag.toLowerCase())) {
    return tags;
  }
  return [tag, ...tags];
}

function buildSerialTags(
  tags: string[],
  options: {
    baud: string;
    dataBits: string;
    flow: string;
    parity: string;
    port: string;
    stopBits: string;
  },
) {
  const filteredTags = tags.filter((tag) => {
    const normalized = tag.trim().toLowerCase();
    return (
      normalized !== "rdp" &&
      normalized !== "telnet" &&
      normalized !== "serial" &&
      !normalized.startsWith("serial-")
    );
  });
  return ensureTag(
    [
      ...filteredTags,
      `serial-port:${options.port}`,
      `serial-baud:${options.baud}`,
      `serial-data-bits:${options.dataBits}`,
      `serial-stop-bits:${options.stopBits}`,
      `serial-parity:${options.parity}`,
      `serial-flow:${options.flow}`,
    ],
    "serial",
  );
}

export function readSerialTagValue(host: RemoteHost | undefined, key: string) {
  return host ? readSerialTag(host.tags, key) : undefined;
}

function readSerialTag(tags: string[], key: string) {
  const prefix = `serial-${key}:`;
  const match = tags.find((tag) =>
    tag.trim().toLowerCase().startsWith(prefix.toLowerCase()),
  );
  return match?.slice(prefix.length).trim() || undefined;
}

export function isRdpRemoteHost(host: RemoteHost) {
  return host.tags.some((tag) => tag.trim().toLowerCase() === "rdp");
}

export function isTelnetRemoteHost(host: RemoteHost) {
  return host.tags.some((tag) => tag.trim().toLowerCase() === "telnet");
}

export function isSerialRemoteHost(host: RemoteHost) {
  return host.tags.some((tag) => tag.trim().toLowerCase() === "serial");
}
