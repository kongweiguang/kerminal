import { describe, expect, it, vi } from "vitest";
import {
  createKerminalQuickOpenRegistry,
  resolveKerminalQuickOpenReference,
  type KerminalQuickOpenSourceApi,
} from "../../../src/app/KerminalShell.quickOpenSources";

function sourceApi(overrides: Partial<KerminalQuickOpenSourceApi> = {}) {
  return {
    listAgentSessions: async () => ({ sessions: [] }),
    listCommandHistory: async () => [],
    listSnippets: async () => [],
    listWorkflows: async () => [],
    ...overrides,
  } satisfies KerminalQuickOpenSourceApi;
}

function environment() {
  return {
    activeTabId: "tab-1",
    focusedPaneId: "pane-1",
    onFocusPane: vi.fn(),
    onOpenTool: vi.fn(),
    onSelectMachine: vi.fn(),
    onSelectTab: vi.fn(),
    terminalTabs: [],
  };
}

describe("Kerminal Quick Open production sources", () => {
  it("projects async facts without leaking command, workflow step or session paths", async () => {
    const registry = createKerminalQuickOpenRegistry({
      machineGroups: [],
      terminalPanes: [],
      terminalTabs: [],
      sourceApi: sourceApi({
        listAgentSessions: async () => ({
          diagnostics: [
            { code: "private", message: "secret", path: "C:/private" },
          ],
          sessions: [
            {
              session: {
                agentId: "codex",
                agentSessionId: "agent-1",
                launch: {
                  args: ["--secret"],
                  cwd: "C:/private/workspace",
                  shell: "pwsh",
                },
                sessionRoot: "C:/private/session",
                status: "active",
                title: "修复任务",
              },
            },
          ],
        }),
        listCommandHistory: async () => [
          {
            command: `echo ${"secret ".repeat(30)}`,
            createdAt: "2026-07-11T00:00:00.000Z",
            id: "history-1",
            source: "user",
            target: "local",
          },
        ],
        listSnippets: async () => [
          {
            command: "curl -H 'Authorization: Bearer secret'",
            createdAt: "2026-07-11T00:00:00.000Z",
            description: "安全说明",
            id: "snippet-1",
            scope: "local",
            sortOrder: 10,
            tags: ["daily"],
            title: "检查状态",
            updatedAt: "2026-07-11T00:00:00.000Z",
          },
        ],
        listWorkflows: async () => [
          {
            createdAt: "2026-07-11T00:00:00.000Z",
            id: "workflow-1",
            scope: "ssh",
            sortOrder: 10,
            steps: [
              {
                command: "deploy --token secret",
                createdAt: "2026-07-11T00:00:00.000Z",
                id: "step-1",
                requiresConfirmation: true,
                sortOrder: 10,
                title: "部署",
                updatedAt: "2026-07-11T00:00:00.000Z",
              },
            ],
            tags: ["deploy"],
            title: "部署流程",
            updatedAt: "2026-07-11T00:00:00.000Z",
          },
        ],
      }),
    });
    const signal = new AbortController().signal;
    const candidates = (
      await Promise.all(
        registry
          .list()
          .map((provider) => provider.search({ limit: 100, signal, text: "" })),
      )
    ).flat();
    const serialized = JSON.stringify(candidates);

    expect(serialized).not.toContain("Authorization");
    expect(serialized).not.toContain("deploy --token");
    expect(serialized).not.toContain("C:/private");
    expect(serialized).not.toContain("--secret");
    expect(
      candidates.find((item) => item.reference.kind === "command-history")
        ?.label,
    ).toHaveLength(96);
  });

  it("checks AbortSignal before and after async fact reads", async () => {
    const controller = new AbortController();
    const registry = createKerminalQuickOpenRegistry({
      machineGroups: [],
      terminalPanes: [],
      terminalTabs: [],
      sourceApi: sourceApi({
        listSnippets: async () => {
          controller.abort();
          return [];
        },
      }),
    });
    const provider = registry.list().find((item) => item.id === "snippets");

    await expect(
      provider?.search({ limit: 10, signal: controller.signal, text: "git" }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("inserts history text without carriage return or automatic execution", async () => {
    const writeTerminal = vi.fn(
      async (_sessionId: string, _data: string) => undefined,
    );
    const result = await resolveKerminalQuickOpenReference(
      { id: "history-1", kind: "command-history" },
      environment(),
      {
        getTerminalPaneSession: () => "session-1",
        signal: new AbortController().signal,
        sourceApi: sourceApi({
          listCommandHistory: async () => [
            {
              command: "git status --short",
              createdAt: "2026-07-11T00:00:00.000Z",
              id: "history-1",
              source: "user",
              target: "local",
            },
          ],
        }),
        writeTerminal,
      },
    );

    expect(result).toEqual({ kind: "completed" });
    expect(writeTerminal).toHaveBeenCalledWith(
      "session-1",
      "git status --short",
    );
    expect(writeTerminal.mock.calls[0]?.[1]).not.toMatch(/[\r\n]$/);
  });

  it("deep-links snippets in V2 and restores insert-only behavior during rollback", async () => {
    const v2Environment = environment();
    const writeTerminal = vi.fn(
      async (_sessionId: string, _data: string) => undefined,
    );
    const v2Result = await resolveKerminalQuickOpenReference(
      { id: "snippet-1", kind: "snippet" },
      v2Environment,
      {
        signal: new AbortController().signal,
        snippetFeatureGates: { snippetCatalogV2: true, snippetPanelV2: true },
        writeTerminal,
      },
    );
    expect(v2Result).toEqual({ kind: "completed" });
    expect(v2Environment.onOpenTool).toHaveBeenCalledWith("snippets");
    expect(writeTerminal).not.toHaveBeenCalled();

    const rollbackEnvironment = environment();
    const rollbackResult = await resolveKerminalQuickOpenReference(
      { id: "snippet-1", kind: "snippet" },
      rollbackEnvironment,
      {
        getTerminalPaneSession: () => "session-1",
        signal: new AbortController().signal,
        snippetFeatureGates: { snippetCatalogV2: false, snippetPanelV2: false },
        sourceApi: sourceApi({
          listSnippets: async () => [
            {
              command: "git status --short",
              createdAt: "1",
              id: "snippet-1",
              scope: "local",
              sortOrder: 1,
              tags: [],
              title: "状态",
              updatedAt: "1",
            },
          ],
        }),
        writeTerminal,
      },
    );
    expect(rollbackResult).toEqual({ kind: "completed" });
    expect(writeTerminal).toHaveBeenLastCalledWith(
      "session-1",
      "git status --short",
    );
    expect(
      writeTerminal.mock.calls[writeTerminal.mock.calls.length - 1]?.[1],
    ).not.toMatch(/[\r\n]$/u);
  });

  it("opens honest deep entries when exact workflow or agent selection is unavailable", async () => {
    const workflowEnvironment = environment();
    const workflowResult = await resolveKerminalQuickOpenReference(
      { id: "workflow-1", kind: "workflow" },
      workflowEnvironment,
      { signal: new AbortController().signal },
    );
    const agentEnvironment = environment();
    const agentResult = await resolveKerminalQuickOpenReference(
      { id: "agent-1", kind: "agent-session" },
      agentEnvironment,
      { signal: new AbortController().signal },
    );

    expect(workflowEnvironment.onOpenTool).toHaveBeenCalledWith("snippets");
    expect(workflowResult).toMatchObject({ kind: "unavailable" });
    expect(agentEnvironment.onOpenTool).toHaveBeenCalledWith("agentLauncher");
    expect(agentResult).toMatchObject({ kind: "unavailable" });
  });
});
