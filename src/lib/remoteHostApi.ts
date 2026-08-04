// @author kongweiguang

import { invoke, isTauri } from "@tauri-apps/api/core";

export type RemoteHostAuthType = "password" | "key" | "agent";
export type RemoteHostProtocol = "ssh" | "sftp" | "rdp" | "telnet" | "serial";
export type SshProxyProtocol = "none" | "http" | "socks5";
export type SshTunnelKind = "local" | "remote" | "dynamic";

interface SshProxyOptions {
  protocol: SshProxyProtocol;
  host?: string;
  port?: number;
  username?: string;
  credentialRef?: string;
}

export interface SshTunnelOptions {
  name: string;
  kind: SshTunnelKind;
  bindHost: string;
  bindPort?: number;
  targetHost: string;
  targetPort?: number;
}

export interface SshJumpHostOptions {
  name: string;
  host: string;
  port: number;
  username: string;
  authType: RemoteHostAuthType;
  credentialRef?: string;
  credentialSecret?: string;
}

interface SshTerminalOptions {
  encoding: string;
  terminalType: string;
  keyboardProfile: string;
  altModifier: string;
  backspaceKey: string;
  deleteKey: string;
  connectTimeoutSeconds: number;
  keepaliveSeconds: number;
  startupCommand: string;
  environment: string;
  loginScript: string;
}

interface SshTransferOptions {
  enabled: boolean;
  remoteStartDirectory: string;
  localStartDirectory: string;
  preserveTimestamps: boolean;
  followSymlinks: boolean;
  maxConcurrentTransfers: number;
}

export interface SshOptions {
  proxy: SshProxyOptions;
  tunnels: SshTunnelOptions[];
  jumpHosts: SshJumpHostOptions[];
  terminal: SshTerminalOptions;
  transfer: SshTransferOptions;
}

export interface RemoteHostGroup {
  id: string;
  name: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface RemoteHost {
  id: string;
  groupId?: string;
  name: string;
  host: string;
  port: number;
  username: string;
  protocol: RemoteHostProtocol;
  authType: RemoteHostAuthType;
  credentialRef?: string;
  secretRef?: string;
  keyPassphraseRef?: string;
  keyPassphraseSecret?: string;
  credentialSecret?: string;
  credentialStatus?: RemoteHostCredentialStatus;
  tags: string[];
  production: boolean;
  sshOptions: SshOptions;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

type RemoteHostCredentialStatus =
  | "missing"
  | "vault"
  | "agent";

type RemoteHostCredentialRevealStatus =
  | "available"
  | "agent"
  | "configPath"
  | "missing"
  | "unsupported";

export interface RemoteHostCredentialReveal {
  hostId: string;
  authType: RemoteHostAuthType;
  status: RemoteHostCredentialRevealStatus;
  credentialSecret?: string;
  keyPassphraseSecret?: string;
  message?: string;
}

export interface RemoteHostGroupWithHosts extends RemoteHostGroup {
  hosts: RemoteHost[];
}

export interface RemoteHostGroupCreateRequest {
  name: string;
}

export interface RemoteHostGroupUpdateRequest extends RemoteHostGroupCreateRequest {
  id: string;
  sortOrder: number;
}

export interface RemoteHostCreateRequest {
  groupId?: string;
  name: string;
  host: string;
  port?: number;
  username: string;
  protocol?: RemoteHostProtocol;
  authType?: RemoteHostAuthType;
  credentialRef?: string;
  credentialSecret?: string;
  keyPassphraseSecret?: string;
  clearKeyPassphrase?: boolean;
  tags?: string[];
  production?: boolean;
  sshOptions?: SshOptions;
}

export interface RemoteHostUpdateRequest extends RemoteHostCreateRequest {
  id: string;
  sortOrder: number;
}

type NormalizedRemoteHostRequest = Required<
  Omit<
    RemoteHostCreateRequest,
    | "clearKeyPassphrase"
    | "credentialRef"
    | "credentialSecret"
    | "groupId"
    | "keyPassphraseSecret"
  >
> & {
  clearKeyPassphrase?: boolean;
  credentialRef?: string;
  credentialSecret?: string;
  groupId?: string;
  keyPassphraseSecret?: string;
};

interface NormalizedRemoteHostUpdateRequest
  extends NormalizedRemoteHostRequest {
  id: string;
  sortOrder: number;
}

const browserPreviewRemoteHostTree: RemoteHostGroupWithHosts[] =
  browserPreviewMode() === "system-info"
    ? [
        {
          createdAt: "browser-preview",
          hosts: [
            {
              authType: "agent",
              createdAt: "browser-preview",
              groupId: "group-preview-infrastructure",
              host: "preview.internal",
              id: "prod-api",
              name: "生产 API",
              port: 22,
              protocol: "ssh",
              production: true,
              sortOrder: 10,
              sshOptions: createDefaultSshOptions(),
              tags: ["production", "preview"],
              updatedAt: "browser-preview",
              username: "deploy",
            },
          ],
          id: "group-preview-infrastructure",
          name: "基础设施",
          sortOrder: 10,
          updatedAt: "browser-preview",
        },
      ]
    : [];

export const UNGROUPED_REMOTE_HOST_GROUP_ID = "__ungrouped__";

export function createDefaultSshOptions(): SshOptions {
  return {
    jumpHosts: [],
    proxy: {
      protocol: "none",
    },
    terminal: {
      altModifier: "8bit",
      backspaceKey: "ascii-delete",
      connectTimeoutSeconds: 30,
      deleteKey: "delete-sequence",
      encoding: "UTF-8",
      environment: "",
      keepaliveSeconds: 60,
      keyboardProfile: "default",
      loginScript: "",
      startupCommand: "",
      terminalType: "xterm-256color",
    },
    transfer: {
      enabled: true,
      followSymlinks: false,
      localStartDirectory: "",
      maxConcurrentTransfers: 4,
      preserveTimestamps: true,
      remoteStartDirectory: "",
    },
    tunnels: [],
  };
}

function browserPreviewMode() {
  if (typeof window === "undefined") {
    return undefined;
  }
  return new URLSearchParams(window.location.search).get("preview") ?? undefined;
}

let browserPreviewRemoteHostState = cloneRemoteHostTree(
  browserPreviewRemoteHostTree,
);
let browserPreviewSequence = 100;

export async function listRemoteHostTree(): Promise<RemoteHostGroupWithHosts[]> {
  if (!isTauri()) {
    return cloneRemoteHostTree(browserPreviewRemoteHostState);
  }

  return invoke<RemoteHostGroupWithHosts[]>("remote_host_tree");
}

export async function createRemoteHostGroup(
  request: RemoteHostGroupCreateRequest,
): Promise<RemoteHostGroup> {
  if (!isTauri()) {
    browserPreviewSequence += 1;
    const timestamp = "browser-preview";
    const group: RemoteHostGroupWithHosts = {
      createdAt: timestamp,
      hosts: [],
      id: `group-preview-${browserPreviewSequence}`,
      name: request.name.trim(),
      sortOrder:
        Math.max(0, ...browserPreviewRemoteHostState.map((item) => item.sortOrder)) +
        10,
      updatedAt: timestamp,
    };
    browserPreviewRemoteHostState = [...browserPreviewRemoteHostState, group];
    return {
      createdAt: group.createdAt,
      id: group.id,
      name: group.name,
      sortOrder: group.sortOrder,
      updatedAt: group.updatedAt,
    };
  }

  return invoke<RemoteHostGroup>("remote_host_group_create", { request });
}

export async function updateRemoteHostGroup(
  request: RemoteHostGroupUpdateRequest,
): Promise<RemoteHostGroup> {
  if (!isTauri()) {
    const target = browserPreviewRemoteHostState.find(
      (group) => group.id === request.id,
    );
    if (!target) {
      throw new Error("远程主机分组不存在。");
    }
    const updated = {
      ...target,
      name: request.name.trim(),
      sortOrder: request.sortOrder,
      updatedAt: "browser-preview",
    };
    browserPreviewRemoteHostState = browserPreviewRemoteHostState.map((group) =>
      group.id === request.id ? updated : group,
    );
    return {
      createdAt: updated.createdAt,
      id: updated.id,
      name: updated.name,
      sortOrder: updated.sortOrder,
      updatedAt: updated.updatedAt,
    };
  }

  return invoke<RemoteHostGroup>("remote_host_group_update", { request });
}

export async function deleteRemoteHostGroup(groupId: string): Promise<boolean> {
  if (!isTauri()) {
    let movedHosts: RemoteHost[] = [];
    const nextState = browserPreviewRemoteHostState.filter((group) => {
      if (group.id !== groupId) {
        return true;
      }
      movedHosts = group.hosts.map((host) => ({
        ...host,
        groupId: undefined,
        updatedAt: "browser-preview",
      }));
      return false;
    });
    const deleted = nextState.length !== browserPreviewRemoteHostState.length;
    browserPreviewRemoteHostState = deleted
      ? ensureBrowserUngroupedHosts(nextState, movedHosts)
      : nextState;
    return deleted;
  }

  return invoke<boolean>("remote_host_group_delete", { groupId });
}

export async function createRemoteHost(
  request: RemoteHostCreateRequest,
): Promise<RemoteHost> {
  if (!isTauri()) {
    const normalized = normalizeRemoteHostRequest(request);
    if (normalized.clearKeyPassphrase) {
      throw new Error("新建主机时没有可清空的私钥口令。");
    }
    const targetGroup = findBrowserPreviewGroup(normalized.groupId);
    if (!targetGroup) {
      throw new Error("远程主机分组不存在。");
    }

    browserPreviewSequence += 1;
    const { clearKeyPassphrase: _clearKeyPassphrase, ...hostFields } = normalized;
    const host: RemoteHost = {
      ...hostFields,
      createdAt: "browser-preview",
      id: `host-preview-${browserPreviewSequence}`,
      sortOrder: Math.max(0, ...targetGroup.hosts.map((item) => item.sortOrder)) + 10,
      updatedAt: "browser-preview",
    };
    browserPreviewRemoteHostState = browserPreviewRemoteHostState.map((group) =>
      group.id === targetGroup.id
        ? {
            ...group,
            hosts: [...group.hosts, host],
            updatedAt: "browser-preview",
          }
        : group,
    );
    return host;
  }

  return invoke<RemoteHost>("remote_host_create", {
    request: normalizeRemoteHostRequest(request),
  });
}

export async function updateRemoteHost(
  request: RemoteHostUpdateRequest,
): Promise<RemoteHost> {
  if (!isTauri()) {
    const normalized = normalizeRemoteHostUpdateRequest(request);
    const targetGroup = findBrowserPreviewGroup(normalized.groupId);
    if (!targetGroup) {
      throw new Error("远程主机分组不存在。");
    }
    const previousHost = browserPreviewRemoteHostState
      .flatMap((group) => group.hosts)
      .find((host) => host.id === normalized.id);
    if (!previousHost) {
      throw new Error("远程主机不存在。");
    }

    const {
      clearKeyPassphrase,
      keyPassphraseSecret,
      ...normalizedHostFields
    } = normalized;
    const updatedHost: RemoteHost = {
      ...previousHost,
      ...normalizedHostFields,
      keyPassphraseSecret:
        normalized.authType !== "key" || clearKeyPassphrase
          ? undefined
          : keyPassphraseSecret ?? previousHost.keyPassphraseSecret,
      updatedAt: "browser-preview",
    };

    browserPreviewRemoteHostState = browserPreviewRemoteHostState.map((group) => {
      const remainingHosts = group.hosts.filter((host) => host.id !== normalized.id);
      const changed = remainingHosts.length !== group.hosts.length;
      if (group.id === targetGroup.id && updatedHost) {
        return {
          ...group,
          hosts: [...remainingHosts, updatedHost].sort(
            (left, right) => left.sortOrder - right.sortOrder,
          ),
          updatedAt: "browser-preview",
        };
      }
      return {
        ...group,
        hosts: remainingHosts,
        updatedAt: changed ? "browser-preview" : group.updatedAt,
      };
    });

    return updatedHost;
  }

  return invoke<RemoteHost>("remote_host_update", {
    request: normalizeRemoteHostUpdateRequest(request),
  });
}

export async function deleteRemoteHost(hostId: string): Promise<boolean> {
  if (!isTauri()) {
    let deleted = false;
    browserPreviewRemoteHostState = browserPreviewRemoteHostState.map((group) => {
      const hosts = group.hosts.filter((host) => host.id !== hostId);
      if (hosts.length !== group.hosts.length) {
        deleted = true;
        return {
          ...group,
          hosts,
          updatedAt: "browser-preview",
        };
      }
      return group;
    });
    return deleted;
  }

  return invoke<boolean>("remote_host_delete", { hostId });
}

export async function revealRemoteHostCredential(
  hostId: string,
): Promise<RemoteHostCredentialReveal> {
  if (!isTauri()) {
    const host = browserPreviewRemoteHostState
      .flatMap((group) => group.hosts)
      .find((host) => host.id === hostId);
    if (!host) {
      throw new Error("远程主机不存在。");
    }
    if (host.authType === "agent") {
      return {
        authType: host.authType,
        hostId,
        message: "SSH Agent 认证不需要保存密码。",
        status: "agent",
      };
    }
    if (host.authType === "key" && host.credentialRef?.trim()) {
      return {
        authType: host.authType,
        hostId,
        keyPassphraseSecret: host.keyPassphraseSecret,
        message: "该主机使用私钥路径，无需回显私钥内容。",
        status: "configPath",
      };
    }
    if (host.credentialSecret?.trim()) {
      return {
        authType: host.authType,
        credentialSecret: host.credentialSecret,
        hostId,
        keyPassphraseSecret: host.keyPassphraseSecret,
        status: "available",
      };
    }
    return {
      authType: host.authType,
      hostId,
      message: "没有可回显的保存凭据。",
      status: "missing",
    };
  }

  return invoke<RemoteHostCredentialReveal>("remote_host_reveal_credential", {
    hostId,
  });
}

function normalizeRemoteHostRequest(
  request: RemoteHostCreateRequest,
): NormalizedRemoteHostRequest {
  return {
    ...request,
    authType: request.authType ?? "agent",
    credentialRef:
      (request.authType ?? "agent") === "key"
        ? normalizePrivateKeyPath(request.credentialRef)
        : undefined,
    credentialSecret: request.credentialSecret?.trim()
      ? request.credentialSecret
      : undefined,
    ...((request.authType ?? "agent") === "key" &&
    request.keyPassphraseSecret?.length
      ? { keyPassphraseSecret: request.keyPassphraseSecret }
      : {}),
    ...((request.authType ?? "agent") === "key" && request.clearKeyPassphrase
      ? { clearKeyPassphrase: true }
      : {}),
    groupId: request.groupId?.trim() || undefined,
    port: request.port ?? 22,
    protocol: request.protocol ?? "ssh",
    production: request.production ?? false,
    sshOptions: normalizeSshOptions(request.sshOptions),
    tags: request.tags ?? [],
  };
}

function normalizeSshOptions(options: SshOptions | undefined): SshOptions {
  const defaults = createDefaultSshOptions();
  if (!options) {
    return defaults;
  }

  const proxyProtocol = options.proxy?.protocol ?? defaults.proxy.protocol;
  const proxy =
    proxyProtocol === "none"
      ? defaults.proxy
      : {
          ...defaults.proxy,
          ...options.proxy,
          credentialRef: undefined,
          host: trimOptional(options.proxy?.host),
          protocol: proxyProtocol,
          username: trimOptional(options.proxy?.username),
        };

  return {
    jumpHosts:
      options.jumpHosts
        ?.map((host) => ({
          authType: host.authType ?? "agent",
          credentialRef:
            (host.authType ?? "agent") === "key"
              ? normalizePrivateKeyPath(host.credentialRef)
              : undefined,
          credentialSecret:
            (host.authType ?? "agent") === "agent"
              ? undefined
              : trimOptional(host.credentialSecret),
          host: host.host.trim(),
          name: host.name.trim(),
          port: host.port,
          username: host.username.trim(),
        }))
        .filter((host) => host.host) ?? [],
    proxy,
    terminal: {
      ...defaults.terminal,
      ...options.terminal,
      altModifier:
        options.terminal?.altModifier?.trim() || defaults.terminal.altModifier,
      backspaceKey:
        options.terminal?.backspaceKey?.trim() || defaults.terminal.backspaceKey,
      deleteKey:
        options.terminal?.deleteKey?.trim() || defaults.terminal.deleteKey,
      encoding: options.terminal?.encoding?.trim() || defaults.terminal.encoding,
      environment: options.terminal?.environment?.trim() ?? "",
      keyboardProfile:
        options.terminal?.keyboardProfile?.trim() ||
        defaults.terminal.keyboardProfile,
      loginScript: options.terminal?.loginScript?.trim() ?? "",
      startupCommand: options.terminal?.startupCommand?.trim() ?? "",
      terminalType:
        options.terminal?.terminalType?.trim() || defaults.terminal.terminalType,
    },
    transfer: {
      ...defaults.transfer,
      ...options.transfer,
      localStartDirectory: options.transfer?.localStartDirectory?.trim() ?? "",
      maxConcurrentTransfers: Math.min(
        Math.max(options.transfer?.maxConcurrentTransfers ?? 4, 1),
        16,
      ),
      remoteStartDirectory: options.transfer?.remoteStartDirectory?.trim() ?? "",
    },
    tunnels:
      options.tunnels
        ?.map((tunnel) => ({
          bindHost: tunnel.bindHost.trim() || "127.0.0.1",
          bindPort: tunnel.bindPort,
          kind: tunnel.kind,
          name: tunnel.name.trim(),
          targetHost: tunnel.kind === "dynamic" ? "" : tunnel.targetHost.trim(),
          targetPort: tunnel.kind === "dynamic" ? undefined : tunnel.targetPort,
        }))
        .filter(
          (tunnel) =>
            Boolean(tunnel.bindPort) &&
            (tunnel.kind === "dynamic" ||
              (Boolean(tunnel.targetHost) && Boolean(tunnel.targetPort))),
        ) ?? [],
  };
}

function trimOptional(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function normalizePrivateKeyPath(value: string | undefined) {
  const trimmed = trimOptional(value);
  return trimmed?.startsWith("credential:") ? undefined : trimmed;
}

function findBrowserPreviewGroup(groupId: string | undefined) {
  if (!groupId) {
    return ensureBrowserUngroupedGroup();
  }
  return browserPreviewRemoteHostState.find((group) => group.id === groupId);
}

function ensureBrowserUngroupedGroup() {
  const existing = browserPreviewRemoteHostState.find(
    (group) => group.id === UNGROUPED_REMOTE_HOST_GROUP_ID,
  );
  if (existing) {
    return existing;
  }

  const group: RemoteHostGroupWithHosts = {
    createdAt: "browser-preview",
    hosts: [],
    id: UNGROUPED_REMOTE_HOST_GROUP_ID,
    name: "默认分组",
    sortOrder: Number.MIN_SAFE_INTEGER,
    updatedAt: "browser-preview",
  };
  browserPreviewRemoteHostState = [group, ...browserPreviewRemoteHostState];
  return group;
}

function ensureBrowserUngroupedHosts(
  groups: RemoteHostGroupWithHosts[],
  hosts: RemoteHost[],
) {
  if (hosts.length === 0) {
    return groups;
  }

  const existing = groups.find(
    (group) => group.id === UNGROUPED_REMOTE_HOST_GROUP_ID,
  );
  if (existing) {
    return groups.map((group) =>
      group.id === existing.id
        ? {
            ...group,
            hosts: [...group.hosts, ...hosts].sort(
              (left, right) => left.sortOrder - right.sortOrder,
            ),
            updatedAt: "browser-preview",
          }
        : group,
    );
  }

  return [
    {
      createdAt: "browser-preview",
      hosts,
      id: UNGROUPED_REMOTE_HOST_GROUP_ID,
      name: "默认分组",
      sortOrder: Number.MIN_SAFE_INTEGER,
      updatedAt: "browser-preview",
    },
    ...groups,
  ];
}

function normalizeRemoteHostUpdateRequest(
  request: RemoteHostUpdateRequest,
): NormalizedRemoteHostUpdateRequest {
  return {
    ...normalizeRemoteHostRequest(request),
    id: request.id,
    sortOrder: request.sortOrder,
  };
}

function cloneRemoteHostTree(
  tree: RemoteHostGroupWithHosts[],
): RemoteHostGroupWithHosts[] {
  return [...tree]
    .sort(compareRemoteHostGroups)
    .map((group) => ({
      ...group,
      hosts: [...group.hosts].sort(compareRemoteHosts).map((host) => ({
        ...host,
        sshOptions: normalizeSshOptions(host.sshOptions),
        tags: [...host.tags],
      })),
    }));
}

function compareRemoteHostGroups(
  left: RemoteHostGroupWithHosts,
  right: RemoteHostGroupWithHosts,
) {
  return left.sortOrder - right.sortOrder || left.name.localeCompare(right.name);
}

function compareRemoteHosts(left: RemoteHost, right: RemoteHost) {
  return left.sortOrder - right.sortOrder || left.name.localeCompare(right.name);
}
