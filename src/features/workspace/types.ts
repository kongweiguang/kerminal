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
  title: string;
  machineId: string;
  layout: TerminalLayoutNode;
}

export interface SftpTransferWorkspaceTab {
  kind: "sftpTransfer";
  id: string;
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
