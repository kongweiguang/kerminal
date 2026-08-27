// @author kongweiguang

import type { RemoteTargetRef } from "../../lib/targetModel";
import type { SshOptions } from "../../lib/remoteHostApi";
import type { TmuxPaneBinding } from "../../lib/tmuxApi";

export type MachineStatus = "online" | "offline" | "warning";

export type MachineKind =
  | "local"
  | "ssh"
  | "sftp"
  | "telnet"
  | "serial"
  | "rdp"
  | "dockerContainer"
  | "group";

export interface Machine {
  id: string;
  name: string;
  kind: MachineKind;
  status: MachineStatus;
  description: string;
  host?: string;
  port?: number;
  username?: string;
  authType?: "password" | "key" | "agent";
  credentialRef?: string;
  credentialSecret?: string;
  profileId?: string;
  shell?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  target?: RemoteTargetRef;
  sshOptions?: SshOptions;
  remoteGroupId?: string;
  parentMachineId?: string;
  containerId?: string;
  containerName?: string;
  runtime?: "docker" | "podman";
  user?: string;
  workdir?: string;
  latencyMs?: number;
  sortOrder?: number;
  createdAt?: string;
  updatedAt?: string;
  tags: string[];
}

export interface MachineGroup {
  id: string;
  title: string;
  pinned?: boolean;
  sortOrder?: number;
  createdAt?: string;
  updatedAt?: string;
  machines: Machine[];
}

export interface TerminalSessionTab {
  kind?: "terminal";
  id: string;
  /** 用户显式标签组；它只影响标签栏组织，不参与连接或权限身份。 */
  tabGroupId?: string;
  title: string;
  machineId: string;
  layout: TerminalLayoutNode;
}

export interface SftpTransferWorkspaceTab {
  kind: "sftpTransfer";
  id: string;
  /** 用户显式标签组；SFTP 与终端可以共享同一组。 */
  tabGroupId?: string;
  title: string;
  machineId: string;
  leftHostId?: string;
  lockedLeftHostId?: string;
  rightHostId?: string;
  externalLaunchId?: string;
  initialRightPath?: string;
  initialRightSelection?: string;
}

export type WorkspaceFileAccess = "readonly" | "editable";
export type WorkspaceFileSource =
  "sftp" | "container" | "composeYaml" | "workspace" | "local";

export interface WorkspaceFileTab {
  kind: "workspaceFile";
  id: string;
  /** 用户显式标签组；文件 Tab 与主机来源解耦。 */
  tabGroupId?: string;
  title: string;
  machineId: string;
  target: RemoteTargetRef;
  path: string;
  rootPath?: string;
  access: WorkspaceFileAccess;
  source: WorkspaceFileSource;
}

export interface WorkspaceFileRevealRequest {
  id: number;
  directoryPath: string;
  filePath: string;
  target: RemoteTargetRef;
}

export type TerminalTab =
  TerminalSessionTab | SftpTransferWorkspaceTab | WorkspaceFileTab;

export type WorkspaceFileDirtyState = Record<string, boolean>;

export const terminalTabGroupColorIds = [
  "blue",
  "pink",
  "purple",
  "mint",
  "amber",
  "teal",
  "orange",
  "gray",
] as const;

export type TerminalTabGroupColor = (typeof terminalTabGroupColorIds)[number];

export interface TerminalTabGroupPreference {
  color?: TerminalTabGroupColor;
  title?: string;
}

export type TerminalTabGroupPreferences = Record<
  string,
  TerminalTabGroupPreference
>;

/**
 * 用户显式标签组定义。组定义不保存成员顺序，成员顺序唯一由 terminalTabs
 * 扁平数组及每个 Tab 的 tabGroupId 决定，避免连接运行态与视觉组织耦合。
 */
export interface TerminalTabGroupDefinition {
  title: string;
  color?: TerminalTabGroupColor;
  collapsed: boolean;
}

export type TerminalTabGroups = Record<string, TerminalTabGroupDefinition>;

export function isTerminalTabGroupColor(
  value: unknown,
): value is TerminalTabGroupColor {
  return (
    typeof value === "string" &&
    (terminalTabGroupColorIds as readonly string[]).includes(value)
  );
}

export function isTerminalSessionTab(
  tab: TerminalTab | undefined | null,
): tab is TerminalSessionTab {
  return Boolean(tab && (!tab.kind || tab.kind === "terminal"));
}

export function isSftpTransferWorkspaceTab(
  tab: TerminalTab | undefined | null,
): tab is SftpTransferWorkspaceTab {
  return tab?.kind === "sftpTransfer";
}

export function isWorkspaceFileTab(
  tab: TerminalTab | undefined | null,
): tab is WorkspaceFileTab {
  return tab?.kind === "workspaceFile";
}

export type TerminalSplitDirection = "horizontal" | "vertical";
export type TerminalSplitPlacement = "after" | "before";
export type TerminalSplitLayoutSizes = Record<string, number>;
export type LocalMachineScope = "sidebar" | "workspace";

export type TerminalLayoutNode =
  | {
      type: "pane";
      paneId: string;
    }
  | {
      type: "split";
      id: string;
      direction: TerminalSplitDirection;
      children: TerminalLayoutNode[];
      sizes?: TerminalSplitLayoutSizes;
    };

export interface TerminalPane {
  id: string;
  title: string;
  machineId: string;
  mode: "local" | "ssh" | "telnet" | "serial" | "container" | "preview";
  target?: RemoteTargetRef;
  remoteHostId?: string;
  containerId?: string;
  profileId?: string;
  shell?: string;
  args?: string[];
  cwd?: string;
  currentCwd?: string;
  env?: Record<string, string>;
  remoteCommand?: string;
  tmuxBinding?: TmuxPaneBinding;
  prompt: string;
  status: MachineStatus;
  latencyMs?: number;
  localMachineScope?: LocalMachineScope;
  lines: string[];
  outputHistory?: string;
}

const toolIds = [
  "agentLauncher",
  "context",
  "system",
  "containers",
  "sftp",
  "ports",
  "tmux",
  "snippets",
  "logs",
  "settings",
] as const;

export type ToolId = (typeof toolIds)[number];

export function isToolId(value: string): value is ToolId {
  return (toolIds as readonly string[]).includes(value);
}

export interface ToolSummary {
  id: ToolId;
  title: string;
  description: string;
}
