import { describe, expect, it } from "vitest";
import {
  KERMINAL_QUICK_OPEN_COPY,
  canSplitWorkspaceProjection,
  createKerminalQuickOpenRegistry,
  createKerminalWorkspaceActionRegistry,
  disableProtectedActionsWithoutConfirmation,
  overlayBindingMatches,
} from "../../../src/app/KerminalShell.contextWorkspace";
import { WorkspaceActionRegistry } from "../../../src/features/workspace-actions";
import { buildWorkspaceContextProjection } from "../../../src/features/workspace/context";

describe("KerminalShell Context Workspace adapters", () => {
  it("registers the production provider set", async () => {
    const registry = createKerminalQuickOpenRegistry({
      machineGroups: [
        {
          id: "group-1",
          title: "生产主机",
          machines: [
            {
              id: "host-1",
              kind: "ssh",
              name: "api-01",
              description: "生产 API",
              status: "online",
              tags: ["prod"],
              target: { kind: "ssh", hostId: "host-1" },
            },
          ],
        },
      ],
      terminalPanes: [
        {
          id: "pane-1",
          machineId: "host-1",
          mode: "ssh",
          prompt: "$",
          status: "online",
          title: "api shell",
          lines: [],
        },
      ],
      terminalTabs: [
        {
          id: "tab-1",
          machineId: "host-1",
          title: "api",
          layout: { type: "pane", paneId: "pane-1" },
        },
        {
          access: "readonly",
          id: "file-1",
          kind: "workspaceFile",
          machineId: "host-1",
          path: "/var/log/api.log",
          source: "sftp",
          target: { kind: "ssh", hostId: "host-1" },
          title: "api.log",
        },
      ],
      sourceApi: {
        listAgentSessions: async () => ({ sessions: [] }),
        listCommandHistory: async () => [],
        listSnippets: async () => [],
        listWorkflows: async () => [],
      },
    });
    const controller = new AbortController();
    const results = await Promise.all(
      registry.list().map((provider) =>
        provider.search({
          limit: 100,
          signal: controller.signal,
          text: "",
        }),
      ),
    );

    expect(registry.list().map((provider) => provider.id)).toEqual([
      "hosts",
      "terminal-tabs",
      "terminal-panes",
      "workspace-files",
      "visible-recent-paths",
      "command-history",
      "snippets",
      "workflows",
      "agent-sessions",
    ]);
    expect(results.flat().map((item) => item.reference.kind)).toEqual([
      "host",
      "terminal-tab",
      "terminal-tab",
      "terminal-pane",
      "workspace-file",
      "recent-file",
    ]);
  });

  it("registers only local/read-safe command palette actions", () => {
    const registry = createKerminalWorkspaceActionRegistry();

    expect(registry.list()).toHaveLength(11);
    expect(
      registry
        .list()
        .every(
          (descriptor) =>
            descriptor.effect === "local" || descriptor.effect === "read",
        ),
    ).toBe(true);
  });

  it("disables protected actions when no confirmation controller exists", () => {
    const registry = new WorkspaceActionRegistry<{
      "remote.restart": undefined;
    }>();
    registry.register({
      effect: "remote",
      id: "remote.restart",
      title: "重启远端服务",
    });

    const safeRegistry = disableProtectedActionsWithoutConfirmation(
      registry,
      false,
    );

    expect(
      safeRegistry.get("remote.restart")?.availability?.(
        {
          revision: 1,
        },
        undefined,
      ),
    ).toEqual({
      available: false,
      code: "confirmation-unavailable",
      reason: "当前入口尚未接入安全确认流程",
    });
  });

  it("derives split capability from the active terminal projection", () => {
    const terminalTabs = [
      {
        id: "tab-1",
        machineId: "host-1",
        title: "api",
        layout: { type: "pane" as const, paneId: "pane-1" },
      },
    ];
    const terminalPanes = [
      {
        id: "pane-1",
        machineId: "host-1",
        mode: "ssh" as const,
        prompt: "$",
        status: "online" as const,
        title: "api shell",
        lines: [],
      },
    ];
    const projection = buildWorkspaceContextProjection({
      activeTabId: "tab-1",
      focusedPaneId: "pane-1",
      generatedAt: "2026-07-11T00:00:00.000Z",
      machineGroups: [],
      revision: 1,
      selectedMachineId: "",
      sources: [{ source: "workspace", status: "available" }],
      terminalPanes,
      terminalTabs,
    });

    expect(
      canSplitWorkspaceProjection(projection, terminalTabs, terminalPanes),
    ).toBe(true);
    expect(canSplitWorkspaceProjection(projection, terminalTabs, [])).toBe(
      false,
    );
  });

  it("describes all production providers connected by KerminalShell", () => {
    expect(KERMINAL_QUICK_OPEN_COPY.placeholder).toBe(
      "搜索主机、终端、历史、片段、工作流或 Agent",
    );
    expect(KERMINAL_QUICK_OPEN_COPY.description).toMatch(/历史|片段|Agent/);
  });

  it("does not let fallback shortcuts override a user keybinding", () => {
    const event = new KeyboardEvent("keydown", { ctrlKey: true, key: "p" });
    const keybindings = [
      {
        action: "terminal.focus",
        binding: "Ctrl+P",
        description: "",
        editable: true,
        label: "回到终端",
        macBinding: "Cmd+P",
        scope: "global" as const,
        windowsBinding: "Ctrl+P",
      },
    ];

    expect(
      overlayBindingMatches(
        event,
        keybindings,
        "workspace.quickOpen",
        "Ctrl+P",
      ),
    ).toBe(false);
  });
});
