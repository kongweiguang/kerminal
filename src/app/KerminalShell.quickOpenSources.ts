// @author kongweiguang

import {
  QuickOpenProviderRegistry,
  createQuickOpenObjectProvider,
  type QuickOpenReference,
} from "../features/quick-open";
import {
  isTerminalSessionTab,
  isWorkspaceFileTab,
  type MachineGroup,
  type TerminalLayoutNode,
  type TerminalPane,
  type TerminalTab,
  type ToolId,
} from "../features/workspace/types";
import {
  agentSessionRecordAgentId,
  agentSessionRecordId,
  agentSessionRecordStatus,
  agentSessionRecordTarget,
  listAgentSessions,
  type AgentSessionList,
} from "../lib/agentLauncherApi";
import {
  listCommandHistory,
  type CommandHistoryEntry,
} from "../lib/commandHistoryApi";
import {
  listSnippetCatalog,
  listSnippets,
  type CommandSnippet,
  type SnippetCatalogItem,
} from "../lib/snippetApi";
import { requestSnippetPanelOpen } from "../features/snippets/snippetPanelEvents";
import {
  resolveRuntimeSnippetFeatureGates,
  snippetV2NavigationEnabled,
  type SnippetFeatureGates,
} from "../features/snippets/snippetFeatureGates";
import { writeTerminal } from "../lib/terminalApi";
import { listWorkflows, type CommandWorkflow } from "../lib/workflowApi";
import { getTerminalPaneSession } from "../features/terminal/terminalSessionRegistry";

const COMMAND_PREVIEW_LIMIT = 96;

/** Quick Open 异步事实源，保持可注入以测试取消、失败和安全投影。 */
export interface KerminalQuickOpenSourceApi {
  readonly listAgentSessions: () => Promise<AgentSessionList>;
  readonly listCommandHistory: (request: {
    query?: string;
    limit?: number;
  }) => Promise<CommandHistoryEntry[]>;
  readonly listSnippets: (request: {
    query?: string;
  }) => Promise<CommandSnippet[]>;
  readonly listSnippetCatalog?: (request: {
    query?: string;
    limit?: number;
  }) => Promise<SnippetCatalogItem[]>;
  readonly listWorkflows: (request: {
    query?: string;
  }) => Promise<CommandWorkflow[]>;
}

export interface KerminalQuickOpenRegistryInput {
  readonly machineGroups: readonly MachineGroup[];
  readonly terminalPanes: readonly TerminalPane[];
  readonly terminalTabs: readonly TerminalTab[];
  readonly sourceApi?: KerminalQuickOpenSourceApi;
  readonly snippetFeatureGates?: SnippetFeatureGates;
}

export interface KerminalQuickOpenResolutionEnvironment {
  readonly activeTabId: string | null;
  readonly focusedPaneId: string | null;
  readonly onFocusPane: (paneId: string) => void;
  readonly onOpenTool: (toolId: ToolId) => void;
  readonly onSelectMachine: (machineId: string) => void;
  readonly onSelectTab: (tabId: string) => void;
  readonly terminalTabs: readonly TerminalTab[];
}

export type KerminalQuickOpenResolution =
  | { readonly kind: "completed" }
  | { readonly kind: "unavailable"; readonly message: string };

const defaultSourceApi: KerminalQuickOpenSourceApi = {
  listAgentSessions,
  listCommandHistory,
  listSnippets,
  listSnippetCatalog,
  listWorkflows,
};

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new DOMException("Quick Open request aborted", "AbortError");
  }
}

function layoutContainsPane(
  layout: TerminalLayoutNode,
  paneId: string,
): boolean {
  return layout.type === "pane"
    ? layout.paneId === paneId
    : layout.children.some((child) => layoutContainsPane(child, paneId));
}

function focusPane(
  paneId: string,
  environment: KerminalQuickOpenResolutionEnvironment,
): void {
  const ownerTab = environment.terminalTabs.find(
    (tab) =>
      isTerminalSessionTab(tab) && layoutContainsPane(tab.layout, paneId),
  );
  if (ownerTab) {
    environment.onSelectTab(ownerTab.id);
  }
  environment.onFocusPane(paneId);
}

function commandPreview(command: string): string {
  const normalized = command.replace(/\s+/g, " ").trim();
  return normalized.length <= COMMAND_PREVIEW_LIMIT
    ? normalized
    : `${normalized.slice(0, COMMAND_PREVIEW_LIMIT - 1)}…`;
}

function safeDescription(value: string | null | undefined): string | undefined {
  const normalized = value?.replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, 160) : undefined;
}

function createVisibleRecentPaths(
  terminalTabs: readonly TerminalTab[],
  terminalPanes: readonly TerminalPane[],
) {
  const paths = new Map<
    string,
    {
      kind: "recent-file";
      id: string;
      label: string;
      description: string;
      targetId?: string;
    }
  >();
  for (const tab of terminalTabs.filter(isWorkspaceFileTab)) {
    paths.set(`${tab.machineId}:${tab.path}`, {
      kind: "recent-file",
      id: `file:${tab.id}`,
      label: tab.path,
      description: "当前已打开文件，不是跨重启最近记录",
      targetId: tab.machineId,
    });
  }
  for (const pane of terminalPanes) {
    const path = pane.currentCwd ?? pane.cwd;
    if (!path) {
      continue;
    }
    paths.set(`${pane.machineId}:${path}`, {
      kind: "recent-file",
      id: `pane:${pane.id}`,
      label: path,
      description: "当前终端可见目录，不是跨重启最近记录",
      targetId: pane.machineId,
    });
  }
  return Array.from(paths.values());
}

/** 创建只读取真实快照或查询现有 API 的生产 Quick Open providers。 */
export function createKerminalQuickOpenRegistry({
  machineGroups,
  sourceApi = defaultSourceApi,
  snippetFeatureGates = resolveRuntimeSnippetFeatureGates(),
  terminalPanes,
  terminalTabs,
}: KerminalQuickOpenRegistryInput): QuickOpenProviderRegistry {
  const registry = new QuickOpenProviderRegistry();
  registry.register(
    createQuickOpenObjectProvider("hosts", ["host"], () =>
      machineGroups.flatMap((group) =>
        group.machines.map((machine) => ({
          kind: "host" as const,
          id: machine.id,
          label: machine.name,
          description: group.title,
          keywords: [machine.kind, machine.status, ...machine.tags],
          targetId: machine.id,
        })),
      ),
    ),
  );
  registry.register(
    createQuickOpenObjectProvider("terminal-tabs", ["terminal-tab"], () =>
      terminalTabs.map((tab) => ({
        kind: "terminal-tab" as const,
        id: tab.id,
        label: tab.title,
        description: isWorkspaceFileTab(tab) ? tab.path : "工作区标签页",
        targetId: tab.machineId,
      })),
    ),
  );
  registry.register(
    createQuickOpenObjectProvider("terminal-panes", ["terminal-pane"], () =>
      terminalPanes.map((pane) => ({
        kind: "terminal-pane" as const,
        id: pane.id,
        label: pane.title,
        description: pane.currentCwd ?? pane.cwd ?? pane.mode,
        targetId: pane.machineId,
      })),
    ),
  );
  registry.register(
    createQuickOpenObjectProvider("workspace-files", ["workspace-file"], () =>
      terminalTabs.filter(isWorkspaceFileTab).map((tab) => ({
        kind: "workspace-file" as const,
        id: tab.id,
        label: tab.title,
        description: tab.path,
        keywords: [tab.path, tab.source],
        targetId: tab.machineId,
      })),
    ),
  );
  registry.register(
    createQuickOpenObjectProvider("visible-recent-paths", ["recent-file"], () =>
      createVisibleRecentPaths(terminalTabs, terminalPanes),
    ),
  );
  registry.register(
    createQuickOpenObjectProvider(
      "command-history",
      ["command-history"],
      async ({ limit, signal, text }) => {
        throwIfAborted(signal);
        const entries = await sourceApi.listCommandHistory({
          limit,
          query: text.trim() || undefined,
        });
        throwIfAborted(signal);
        return entries.map((entry) => ({
          kind: "command-history" as const,
          id: entry.id,
          label: commandPreview(entry.command),
          description: `插入当前终端但不执行 · ${entry.target}`,
          targetId: entry.remoteHostId ?? undefined,
          updatedAt: entry.createdAt,
        }));
      },
    ),
  );
  registry.register(
    createQuickOpenObjectProvider(
      "snippets",
      ["snippet"],
      async ({ signal, text }) => {
        throwIfAborted(signal);
        const snippets = snippetV2NavigationEnabled(snippetFeatureGates) && sourceApi.listSnippetCatalog
          ? await sourceApi.listSnippetCatalog({
              limit: 200,
              query: text.trim() || undefined,
            })
          : await sourceApi.listSnippets({ query: text.trim() || undefined });
        throwIfAborted(signal);
        return snippets.map((snippet) => ({
          kind: "snippet" as const,
          id: snippet.id,
          label: snippet.title,
          description:
            safeDescription(snippet.description) ??
            `打开片段详情或配置参数 · ${snippet.scope}`,
          keywords: [...snippet.tags, snippet.scope],
          updatedAt: snippet.updatedAt,
        }));
      },
    ),
  );
  registry.register(
    createQuickOpenObjectProvider(
      "workflows",
      ["workflow"],
      async ({ signal, text }) => {
        throwIfAborted(signal);
        const workflows = await sourceApi.listWorkflows({
          query: text.trim() || undefined,
        });
        throwIfAborted(signal);
        return workflows.map((workflow) => ({
          kind: "workflow" as const,
          id: workflow.id,
          label: workflow.title,
          description:
            safeDescription(workflow.description) ??
            `在脚本片段工具中打开工作流 · ${workflow.steps.length} 个步骤`,
          keywords: [...workflow.tags, workflow.scope],
          updatedAt: workflow.updatedAt,
        }));
      },
    ),
  );
  registry.register(
    createQuickOpenObjectProvider(
      "agent-sessions",
      ["agent-session"],
      async ({ signal }) => {
        throwIfAborted(signal);
        const sessions = await sourceApi.listAgentSessions();
        throwIfAborted(signal);
        return sessions.sessions.flatMap((record) => {
          const status = agentSessionRecordStatus(record);
          if (status === "archived") {
            return [];
          }
          try {
            const target = agentSessionRecordTarget(record);
            const agentId = agentSessionRecordAgentId(record) ?? "custom";
            return [
              {
                kind: "agent-session" as const,
                id: agentSessionRecordId(record),
                label: record.session.title,
                description: `在 Agent 启动器中继续 · ${agentId} · ${status}`,
                keywords: [agentId, status],
                targetId: target?.targetRef,
                targetLabel: target?.liveStatus,
              },
            ];
          } catch {
            return [];
          }
        });
      },
    ),
  );
  return registry;
}

async function findCommand(
  reference: QuickOpenReference<"command-history" | "snippet">,
  sourceApi: KerminalQuickOpenSourceApi,
  signal: AbortSignal,
): Promise<string | undefined> {
  throwIfAborted(signal);
  const items =
    reference.kind === "command-history"
      ? await sourceApi.listCommandHistory({ limit: 100 })
      : await sourceApi.listSnippets({});
  throwIfAborted(signal);
  return items.find((item) => item.id === reference.id)?.command;
}

/** 解析 Quick Open 选择；命令正文只写入终端输入缓冲，绝不附加回车。 */
export async function resolveKerminalQuickOpenReference(
  reference: QuickOpenReference,
  environment: KerminalQuickOpenResolutionEnvironment,
  options: {
    readonly signal: AbortSignal;
    readonly sourceApi?: KerminalQuickOpenSourceApi;
    readonly writeTerminal?: (sessionId: string, data: string) => Promise<void>;
    readonly getTerminalPaneSession?: (paneId: string) => string | undefined;
    readonly snippetFeatureGates?: SnippetFeatureGates;
  },
): Promise<KerminalQuickOpenResolution> {
  const sourceApi = options.sourceApi ?? defaultSourceApi;
  if (reference.kind === "host") {
    environment.onSelectMachine(reference.id);
    return { kind: "completed" };
  }
  if (
    reference.kind === "terminal-tab" ||
    reference.kind === "workspace-file"
  ) {
    environment.onSelectTab(reference.id);
    return { kind: "completed" };
  }
  if (reference.kind === "terminal-pane") {
    focusPane(reference.id, environment);
    return { kind: "completed" };
  }
  if (reference.kind === "recent-file") {
    const [source, id] = reference.id.split(":", 2);
    if (source === "file" && id) {
      environment.onSelectTab(id);
      return { kind: "completed" };
    }
    if (source === "pane" && id) {
      focusPane(id, environment);
      return { kind: "completed" };
    }
    return { kind: "unavailable", message: "当前可见路径已失效，请重新搜索。" };
  }
  if (reference.kind === "snippet") {
    const gates = options.snippetFeatureGates ?? resolveRuntimeSnippetFeatureGates();
    if (snippetV2NavigationEnabled(gates)) {
      environment.onOpenTool("snippets");
      requestSnippetPanelOpen({
        ...(environment.focusedPaneId
          ? { paneId: environment.focusedPaneId }
          : {}),
        snippetId: reference.id,
      });
      return { kind: "completed" };
    }
    const paneId = environment.focusedPaneId;
    const sessionId = paneId
      ? (options.getTerminalPaneSession ?? getTerminalPaneSession)(paneId)
      : undefined;
    if (!paneId || !sessionId) {
      return { kind: "unavailable", message: "当前没有已连接的终端分屏。" };
    }
    const command = await findCommand(
      { id: reference.id, kind: "snippet" },
      sourceApi,
      options.signal,
    );
    if (!command) {
      return { kind: "unavailable", message: "该片段已不存在，请重新搜索。" };
    }
    throwIfAborted(options.signal);
    await (options.writeTerminal ?? writeTerminal)(sessionId, command);
    throwIfAborted(options.signal);
    return { kind: "completed" };
  }
  if (reference.kind === "command-history") {
    const paneId = environment.focusedPaneId;
    const sessionId = paneId
      ? (options.getTerminalPaneSession ?? getTerminalPaneSession)(paneId)
      : undefined;
    if (!paneId || !sessionId) {
      return { kind: "unavailable", message: "当前没有已连接的终端分屏。" };
    }
    const command = await findCommand(
      { id: reference.id, kind: reference.kind },
      sourceApi,
      options.signal,
    );
    if (!command?.trim()) {
      return { kind: "unavailable", message: "该命令已不存在，请重新搜索。" };
    }
    throwIfAborted(options.signal);
    await (options.writeTerminal ?? writeTerminal)(sessionId, command);
    throwIfAborted(options.signal);
    return { kind: "completed" };
  }
  if (reference.kind === "workflow") {
    environment.onOpenTool("snippets");
    return {
      kind: "unavailable",
      message:
        "已打开脚本片段工具；当前入口尚不能直接定位工作流，请在工作流视图中选择。",
    };
  }
  if (reference.kind === "agent-session") {
    environment.onOpenTool("agentLauncher");
    return {
      kind: "unavailable",
      message: `已打开 Agent 启动器；请从会话列表继续 ${reference.id}。`,
    };
  }
  return { kind: "unavailable", message: "当前对象没有可用的打开入口。" };
}
