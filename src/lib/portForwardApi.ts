import { invoke, isTauri } from "@tauri-apps/api/core";

type PortForwardKind =
  | "local"
  | "remote"
  | "dynamic"
  | "remoteDynamic";

type PortForwardStatus = "running" | "exited";

/** 端口转发仅支持 SOCKS 代理；HTTP network-assist 已退役。 */
type PortForwardRuntimeMode =
  | "unknown"
  | "managedSshRuntime"
  | "openSshProcess"
  | "openSshPty"
  | "restored";

export type PortForwardOrigin =
  | "user"
  | "mcpTool"
  | "networkAssist"
  | "hostPreset";

type PortForwardAccessScope =
  | "loopback"
  | "privateNetwork"
  | "allInterfaces"
  | "custom";

interface PortForwardEndpoint {
  host: string;
  label?: string;
  port?: number;
  protocol?: "tcp" | "http" | "socks5";
  side?: "host" | "local";
}

interface PortForwardRuntimeDiagnostics {
  backend: string;
  cleanupStatus: string;
  fallbackReason?: string;
  managedChannelId?: string;
  managedChannelKind?: string;
  managedSessionId?: string;
  managedTunnelId?: string;
  mode: PortForwardRuntimeMode;
  recentFailure?: string;
  tunnelKind: string;
}

export interface PortForwardCreateRequest {
  hostId: string;
  name?: string;
  kind: PortForwardKind;
  bindHost?: string;
  sourcePort: number;
  targetHost?: string;
  targetPort?: number;
  commandPreview?: string;
  localBindHost?: string;
  localEndpoint?: PortForwardEndpoint;
  origin?: PortForwardOrigin;
  proxyProtocol?: "socks5";
  proxyUrl?: string;
  remoteAccessScope?: PortForwardAccessScope;
  remoteBindHost?: string;
  remoteEndpoint?: PortForwardEndpoint;
}

export interface PortForwardSummary {
  id: string;
  hostId: string;
  hostName: string;
  name: string;
  kind: PortForwardKind;
  bindHost: string;
  sourcePort: number;
  targetHost?: string;
  targetPort?: number;
  pid?: number;
  status: PortForwardStatus;
  createdAt: string;
  commandPreview?: string;
  localBindHost?: string;
  localEndpoint?: PortForwardEndpoint;
  origin?: PortForwardOrigin;
  // 仅用于读取和标识旧会话；新建请求只能传入 socks5。
  proxyProtocol?: "http" | "socks5";
  proxyUrl?: string;
  remoteAccessScope?: PortForwardAccessScope;
  remoteBindHost?: string;
  remoteEndpoint?: PortForwardEndpoint;
  runtime?: PortForwardRuntimeDiagnostics;
}

const browserPreviewForwards = new Map<string, PortForwardSummary>();

export async function createPortForward(
  request: PortForwardCreateRequest,
): Promise<PortForwardSummary> {
  const normalized = normalizeCreateRequest(request);
  if (!isTauri()) {
    const id = `preview-forward-${Date.now().toString(36)}`;
    const summary: PortForwardSummary = {
      bindHost: normalized.bindHost ?? "127.0.0.1",
      createdAt: Math.floor(Date.now() / 1000).toString(),
      commandPreview: normalized.commandPreview,
      hostId: normalized.hostId,
      hostName: "浏览器预览主机",
      id,
      kind: normalized.kind,
      localBindHost: normalized.localBindHost,
      localEndpoint: normalized.localEndpoint,
      name: normalized.name || defaultForwardName(normalized),
      origin: normalized.origin ?? "user",
      pid: 0,
      proxyProtocol: normalized.proxyProtocol,
      proxyUrl: normalized.proxyUrl ?? defaultProxyUrl(normalized),
      remoteAccessScope: normalized.remoteAccessScope,
      remoteBindHost: normalized.remoteBindHost,
      remoteEndpoint: normalized.remoteEndpoint,
      sourcePort: normalized.sourcePort,
      status: "running",
      targetHost: normalized.targetHost,
      targetPort: normalized.targetPort,
    };
    browserPreviewForwards.set(id, summary);
    return summary;
  }

  return invoke<PortForwardSummary>("port_forward_create", {
    request: normalized,
  });
}

export async function listPortForwards(): Promise<PortForwardSummary[]> {
  if (!isTauri()) {
    return Array.from(browserPreviewForwards.values());
  }

  return invoke<PortForwardSummary[]>("port_forward_list");
}

export async function startPortForward(
  forwardId: string,
): Promise<PortForwardSummary> {
  if (!isTauri()) {
    const summary = browserPreviewForwards.get(forwardId);
    if (!summary) {
      throw new Error(`端口转发不存在: ${forwardId}`);
    }
    const next: PortForwardSummary = {
      ...summary,
      pid: 0,
      status: "running",
    };
    browserPreviewForwards.set(forwardId, next);
    return next;
  }

  return invoke<PortForwardSummary>("port_forward_start", { forwardId });
}

export async function stopPortForward(forwardId: string): Promise<boolean> {
  if (!isTauri()) {
    const summary = browserPreviewForwards.get(forwardId);
    if (!summary) {
      return false;
    }
    browserPreviewForwards.set(forwardId, {
      ...summary,
      pid: undefined,
      status: "exited",
    });
    return true;
  }

  return invoke<boolean>("port_forward_stop", { forwardId });
}

export async function deletePortForward(forwardId: string): Promise<boolean> {
  if (!isTauri()) {
    return browserPreviewForwards.delete(forwardId);
  }

  return invoke<boolean>("port_forward_delete", { forwardId });
}

function normalizeCreateRequest(
  request: PortForwardCreateRequest,
): PortForwardCreateRequest {
  const dynamicWithoutTarget =
    request.kind === "dynamic" ||
    request.kind === "remoteDynamic" ||
    (request.kind === "remote" &&
      request.proxyProtocol === "socks5" &&
      !request.targetHost &&
      !request.targetPort);
  const bindHost =
    request.bindHost?.trim() ||
    request.remoteBindHost?.trim() ||
    request.localBindHost?.trim() ||
    "127.0.0.1";
  return {
    ...request,
    bindHost,
    commandPreview: request.commandPreview?.trim() || undefined,
    localBindHost: request.localBindHost?.trim() || undefined,
    name: request.name?.trim() || undefined,
    proxyUrl: request.proxyUrl?.trim() || undefined,
    remoteBindHost: request.remoteBindHost?.trim() || undefined,
    targetHost: dynamicWithoutTarget
      ? undefined
      : request.targetHost?.trim() || "127.0.0.1",
    targetPort: dynamicWithoutTarget ? undefined : request.targetPort,
  };
}

function defaultForwardName(request: PortForwardCreateRequest) {
  if (request.kind === "remoteDynamic") {
    return `远端 SOCKS :${request.sourcePort}`;
  }
  if (request.kind === "dynamic") {
    return `SOCKS :${request.sourcePort}`;
  }
  return `${request.sourcePort} -> ${request.targetHost}:${request.targetPort}`;
}

function defaultProxyUrl(
  request: PortForwardCreateRequest,
): string | undefined {
  if (request.kind !== "remoteDynamic") {
    return undefined;
  }
  const host = proxyHostForRemoteUse(request.remoteBindHost ?? request.bindHost);
  return `socks5h://${formatProxyHost(host)}:${request.sourcePort}`;
}

function proxyHostForRemoteUse(host: string | undefined): string {
  const normalized = host?.trim();
  if (!normalized || normalized === "0.0.0.0") {
    return "127.0.0.1";
  }
  if (normalized === "::") {
    return "::1";
  }
  return normalized;
}

function formatProxyHost(host: string): string {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}
