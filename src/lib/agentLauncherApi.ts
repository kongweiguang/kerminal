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

interface AgentSessionTargetRecord extends AgentSessionTargetRequest {
  binding_id?: string;
  binding_generation?: number;
  pane_id?: string;
  tab_id?: string;
  target_terminal_session_id?: string;
  target_ref?: string;
  target_kind?: string;
  live_status?: AgentTargetLiveStatus;
  last_seen_at?: string;
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
    agentSessionId?: string;
    agent_session_id?: string;
    agentId?: ExternalAgentId;
    agent_id?: ExternalAgentId;
    title: string;
    sessionRoot?: string;
    session_root?: string;
    workspaceRoot?: string;
    workspace_root?: string;
    createdAt?: string;
    created_at?: string;
    updatedAt?: string;
    updated_at?: string;
    status?: AgentSessionRecordStatus;
    launch: {
      commandLabel?: string;
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
  const id = record.session.agentSessionId ?? record.session.agent_session_id;
  if (!id?.trim()) {
    throw new Error("agent_session_create did not return an agent session id.");
  }
  return id;
}

export function agentSessionRecordAgentId(
  record: AgentSessionRecord,
): ExternalAgentId | undefined {
  return record.session.agentId ?? record.session.agent_id;
}

export function agentSessionRecordTarget(
  record: AgentSessionRecord,
): AgentSessionTargetRequest | undefined {
  const target = record.session.target;
  if (!target) {
    return undefined;
  }
  return {
    bindingId: target.bindingId ?? target.binding_id,
    bindingGeneration: target.bindingGeneration ?? target.binding_generation,
    cwd: target.cwd,
    lastSeenAt: target.lastSeenAt ?? target.last_seen_at,
    liveStatus: target.liveStatus ?? target.live_status,
    paneId: target.paneId ?? target.pane_id,
    shell: target.shell,
    tabId: target.tabId ?? target.tab_id,
    targetKind: target.targetKind ?? target.target_kind,
    targetRef: target.targetRef ?? target.target_ref,
    targetTerminalSessionId:
      target.targetTerminalSessionId ?? target.target_terminal_session_id,
  };
}

export function agentSessionRecordStatus(
  record: AgentSessionRecord,
): AgentSessionRecordStatus {
  return record.session.status ?? "active";
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
      agentId: request.agentId,
      agentSessionId,
      launch: {
        args: [],
        commandLabel: request.agentId,
        cwd: sessionRoot,
        shell: request.agentId === "custom" ? "" : request.agentId,
      },
      sessionRoot,
      status: "active",
      target: request.target,
      title,
      workspaceRoot,
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
      agentSessionId,
      launch: {
        args: [],
        commandLabel: "archived",
        cwd: sessionRoot,
        shell: "",
      },
      sessionRoot,
      status: "archived",
      title: "Archived Agent Session",
      workspaceRoot,
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
      agentId: "custom",
      agentSessionId,
      launch: {
        args: [],
        commandLabel: "custom",
        cwd: sessionRoot,
        shell: "",
      },
      sessionRoot,
      status: "active",
      title: request.title ?? "Custom",
      workspaceRoot,
    },
  };
}
