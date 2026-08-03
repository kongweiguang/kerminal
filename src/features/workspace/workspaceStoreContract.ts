// @author kongweiguang

import type { RemoteTargetRef } from "../../lib/targetModel";
import type { TmuxPaneBinding } from "../../lib/tmuxApi";
import type {
  TerminalSplitPlacement,
  ToolId,
  WorkspaceFileAccess,
  WorkspaceFileSource,
} from "./types";
import type { ActiveToolByTabId } from "./workspaceToolPanelState";

interface WorkspaceShellInteractionState {
  activeTool: ToolId | null;
  activeToolByTabId: ActiveToolByTabId;
  broadcastDraft: string;
  machineSearch: string;
}

interface WorkspaceShellInteractionActions {
  setActiveTool: (toolId: ToolId | null) => void;
  setBroadcastDraft: (draft: string) => void;
  setMachineSearch: (query: string) => void;
}

export type WorkspaceShellInteractionSlice = WorkspaceShellInteractionState &
  WorkspaceShellInteractionActions;

export interface AddTerminalTabOptions {
  title?: string;
  profileId?: string;
  groupId?: string;
  shell?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  tmuxBinding?: TmuxPaneBinding;
}

export interface AddDockerContainerOptions {
  groupId?: string;
  shell?: string;
  user?: string;
  workdir?: string;
}

export interface OpenSftpTransferTabOptions {
  leftHostId?: string;
  lockedLeftHostId?: string;
  rightHostId?: string;
}

export interface OpenWorkspaceFileTabOptions {
  access: WorkspaceFileAccess;
  path: string;
  rootPath?: string;
  source: WorkspaceFileSource;
  target: RemoteTargetRef;
  title?: string;
}

export interface SplitFocusedPaneOptions {
  placement?: TerminalSplitPlacement;
  sourcePaneId?: string;
  targetMachineId?: string;
}

export interface OpenSshCommandTerminalOptions {
  cwd?: string;
  remoteCommand: string;
  title: string;
}

export type TmuxAttachPlacement = "pane" | "tab";
