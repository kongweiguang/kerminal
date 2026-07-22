// @author kongweiguang

import { invoke, isTauri } from "@tauri-apps/api/core";
import { parseAgentCommandLine } from "./agentCommandLine";

export type ExternalAgentId = "codex" | "claude" | "custom";

export interface ExternalAgentStatus {
  id: ExternalAgentId;
  title: string;
  cliCommand: string;
  installed: boolean;
  configReady: boolean;
  configPath: string;
  statusDetail: string;
}

export interface ExternalAgentWorkspaceStatus {
  workspaceDir: string;
  mcpEndpoint: string;
  mcpServerRunning: boolean;
  agents: Record<ExternalAgentId, ExternalAgentStatus>;
  validator?: ExternalAgentValidatorStatus;
}

export interface PrepareExternalAgentWorkspaceRequest {
  agentId: ExternalAgentId;
  agentSessionId?: string;
  customCommand?: string;
  resumeProviderSession?: boolean;
  dryRun?: boolean;
  overwritePolicy?: ExternalAgentOverwritePolicy;
}

type ExternalAgentOverwritePolicy =
  | "backupAndReplaceInvalid"
  | "preserveUserContent";

export interface ExternalAgentLaunchSpec {
  agentId: ExternalAgentId;
  agentSessionId?: string;
  title: string;
  shell: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
  status?: ExternalAgentSessionStatus;
  message: string;
  dryRun?: boolean;
  operations?: ExternalAgentFileOperation[];
  validator?: ExternalAgentValidatorStatus;
}

export type ExternalAgentSessionStatus =
  | "starting"
  | "running"
  | "stale"
  | "closed"
  | "error";

export type AgentSessionRecordStatus = "active" | "archived" | "stale";

interface ExternalAgentValidatorStatus {
  available: boolean;
  command: string;
  detail: string;
  status: string;
}

interface ExternalAgentFileOperation {
  path: string;
  action: "created" | "updated" | "unchanged";
  changed: boolean;
  dryRun: boolean;
  backupPath?: string;
  diff?: string;
  reason: string;
}

export type AgentTargetLiveStatus = "unbound" | "ready" | "stale" | "closed";

export interface AgentSessionTargetRequest {
  bindingId?: string;
  bindingGeneration?: number;
  paneId?: string;
  tabId?: string;
  targetTerminalSessionId?: string;
  targetRef?: string;
  targetKind?: string;
  cwd?: string;
  shell?: string;
  liveStatus?: AgentTargetLiveStatus;
  lastSeenAt?: string;
}

interface AgentSessionTargetRecord {
  binding_id?: string;
  binding_generation?: number;
  cwd?: string;
  last_seen_at?: string;
  live_status?: AgentTargetLiveStatus;
  pane_id?: string;
  shell?: string;
  tab_id?: string;
  target_terminal_session_id?: string;
  target_ref?: string;
  target_kind?: string;
}

export interface AgentSessionCreateRequest {
  agentId: ExternalAgentId;
  title?: string;
  target?: AgentSessionTargetRequest;
  mcpEndpoint?: string;
}

export interface AgentSessionUpdateRequest {
  title?: string;
}

export interface AgentSessionRecord {
  session: {
    agent_session_id?: string;
    agent_id?: ExternalAgentId;
    title: string;
    session_root?: string;
    workspace_root?: string;
    created_at?: string;
    updated_at?: string;
    status: AgentSessionRecordStatus;
    launch: {
      command_label?: string;
      shell: string;
      args: string[];
      cwd: string;
    };
    target?: AgentSessionTargetRecord | null;
  };
}

export interface AgentSessionList {
  sessions: AgentSessionRecord[];
  diagnostics?: Array<{
    code: string;
    message: string;
    path?: string;
  }>;
}

export function getExternalAgentWorkspaceStatus(): Promise<ExternalAgentWorkspaceStatus> {
  if (!isTauri()) {
    return Promise.resolve(previewExternalAgentWorkspaceStatus());
  }

  return invoke<ExternalAgentWorkspaceStatus>(
    "get_external_agent_workspace_status",
  );
}

export function createAgentSession(
  request: AgentSessionCreateRequest,
): Promise<AgentSessionRecord> {
  if (!isTauri()) {
    return Promise.resolve(previewAgentSessionRecord(request));
  }

  return invoke<AgentSessionRecord>("agent_session_create", { request });
}

export function listAgentSessions(): Promise<AgentSessionList> {
  if (!isTauri()) {
    return Promise.resolve({ diagnostics: [], sessions: [] });
  }

  return invoke<AgentSessionList>("agent_session_list");
}

export function updateAgentSession(
  agentSessionId: string,
  request: AgentSessionUpdateRequest,
): Promise<AgentSessionRecord> {
  if (!isTauri()) {
    return Promise.resolve(
      previewUpdatedAgentSessionRecord(agentSessionId, request),
    );
  }

  return invoke<AgentSessionRecord>("agent_session_update", {
    agentSessionId,
    request,
  });
}

export function archiveAgentSession(
  agentSessionId: string,
): Promise<AgentSessionRecord> {
  if (!isTauri()) {
    return Promise.resolve(previewArchivedAgentSessionRecord(agentSessionId));
  }

  return invoke<AgentSessionRecord>("agent_session_archive", {
    agentSessionId,
  });
}

export function agentSessionRecordId(record: AgentSessionRecord): string {
  const id = record.session.agent_session_id;
  if (!id?.trim()) {
    throw new Error("agent_session_create did not return an agent session id.");
  }
  return id;
}

export function agentSessionRecordAgentId(
  record: AgentSessionRecord,
): ExternalAgentId | undefined {
  return record.session.agent_id;
}

export function agentSessionRecordTarget(
  record: AgentSessionRecord,
): AgentSessionTargetRequest | undefined {
  const target = record.session.target;
  if (!target) {
    return undefined;
  }
  return {
    bindingId: target.binding_id,
    bindingGeneration: target.binding_generation,
    cwd: target.cwd,
    lastSeenAt: target.last_seen_at,
    liveStatus: target.live_status,
    paneId: target.pane_id,
    shell: target.shell,
    tabId: target.tab_id,
    targetKind: target.target_kind,
    targetRef: target.target_ref,
    targetTerminalSessionId: target.target_terminal_session_id,
  };
}

export function agentSessionRecordStatus(
  record: AgentSessionRecord,
): AgentSessionRecordStatus {
  return record.session.status;
}

export function prepareExternalAgentWorkspace(
  request: PrepareExternalAgentWorkspaceRequest,
): Promise<ExternalAgentLaunchSpec> {
  if (!isTauri()) {
    return Promise.resolve(previewExternalAgentLaunchSpec(request));
  }

  return invoke<ExternalAgentLaunchSpec>("prepare_external_agent_workspace", {
    request,
  });
}

function previewExternalAgentWorkspaceStatus(): ExternalAgentWorkspaceStatus {
  const workspaceDir = "~/.kerminal";
  const endpoint = "http://127.0.0.1:37657/mcp";
  return {
    agents: {
      claude: {
        cliCommand: "claude",
        configPath: `${workspaceDir}/.mcp.json`,
        configReady: true,
        id: "claude",
        installed: false,
        statusDetail: "Claude CLI was not detected in browser preview.",
        title: "Claude",
      },
      codex: {
        cliCommand: "codex",
        configPath: `${workspaceDir}/.codex/config.toml`,
        configReady: true,
        id: "codex",
        installed: false,
        statusDetail: "Codex CLI was not detected in browser preview.",
        title: "Codex",
      },
      custom: {
        cliCommand: "",
        configPath: "",
        configReady: false,
        id: "custom",
        installed: false,
        statusDetail: "Custom Agent is not initialized by default.",
        title: "Custom",
      },
    },
    mcpEndpoint: endpoint,
    mcpServerRunning: false,
    validator: {
      available: false,
      command: "Validator unavailable in browser preview",
      detail: "Open the Tauri app to resolve the local validator command.",
      status: "missing",
    },
    workspaceDir,
  };
}

function previewExternalAgentLaunchSpec({
  agentId,
  agentSessionId,
  customCommand,
}: PrepareExternalAgentWorkspaceRequest): ExternalAgentLaunchSpec {
  const status = previewExternalAgentWorkspaceStatus();
  const agent = status.agents[agentId];
  const custom = agentId === "custom";
  const parsed = custom ? parseAgentCommandLine(customCommand ?? "") : null;
  const sessionRoot = agentSessionId
    ? `${status.workspaceDir}/agents/sessions/${agentSessionId}`
    : status.workspaceDir;
  return {
    agentId,
    agentSessionId,
    args: parsed?.args ?? [],
    cwd: sessionRoot,
    env: agentSessionId
      ? {
          KERMINAL_AGENT_SESSION_ID: agentSessionId,
          KERMINAL_AGENT_SESSION_ROOT: sessionRoot,
          KERMINAL_MCP_ENDPOINT: `${status.mcpEndpoint}/agents/${agentSessionId}`,
          KERMINAL_WORKSPACE_ROOT: status.workspaceDir,
        }
      : undefined,
    shell: parsed?.shell ?? agent.cliCommand,
    title: agent.title,
    message: `${agent.title} preview launch prepared.`,
    dryRun: false,
    operations: [],
    validator: status.validator,
  };
}

function previewAgentSessionRecord(
  request: AgentSessionCreateRequest,
): AgentSessionRecord {
  const workspaceRoot = "~/.kerminal";
  const agentSessionId = `preview-${request.agentId}-${Date.now().toString(36)}`;
  const sessionRoot = `${workspaceRoot}/agents/sessions/${agentSessionId}`;
  const title =
    request.title ??
    (request.agentId === "custom"
      ? "Custom"
      : request.agentId === "claude"
        ? "Claude"
        : "Codex");
  return {
    session: {
      agent_id: request.agentId,
      agent_session_id: agentSessionId,
      launch: {
        args: [],
        command_label: request.agentId,
        cwd: sessionRoot,
        shell: request.agentId === "custom" ? "" : request.agentId,
      },
      session_root: sessionRoot,
      status: "active",
      target: request.target ? targetRecordFromRequest(request.target) : undefined,
      title,
      workspace_root: workspaceRoot,
    },
  };
}

function previewArchivedAgentSessionRecord(
  agentSessionId: string,
): AgentSessionRecord {
  const workspaceRoot = "~/.kerminal";
  const sessionRoot = `${workspaceRoot}/agents/sessions/${agentSessionId}`;
  return {
    session: {
      agent_session_id: agentSessionId,
      launch: {
        args: [],
        command_label: "archived",
        cwd: sessionRoot,
        shell: "",
      },
      session_root: sessionRoot,
      status: "archived",
      title: "Archived Agent Session",
      workspace_root: workspaceRoot,
    },
  };
}

function previewUpdatedAgentSessionRecord(
  agentSessionId: string,
  request: AgentSessionUpdateRequest,
): AgentSessionRecord {
  const workspaceRoot = "~/.kerminal";
  const sessionRoot = `${workspaceRoot}/agents/sessions/${agentSessionId}`;
  return {
    session: {
      agent_id: "custom",
      agent_session_id: agentSessionId,
      launch: {
        args: [],
        command_label: "custom",
        cwd: sessionRoot,
        shell: "",
      },
      session_root: sessionRoot,
      status: "active",
      title: request.title ?? "Custom",
      workspace_root: workspaceRoot,
    },
  };
}

function targetRecordFromRequest(
  target: AgentSessionTargetRequest,
): AgentSessionTargetRecord {
  return {
    binding_generation: target.bindingGeneration,
    binding_id: target.bindingId,
    cwd: target.cwd,
    last_seen_at: target.lastSeenAt,
    live_status: target.liveStatus,
    pane_id: target.paneId,
    shell: target.shell,
    tab_id: target.tabId,
    target_kind: target.targetKind,
    target_ref: target.targetRef,
    target_terminal_session_id: target.targetTerminalSessionId,
  };
}
