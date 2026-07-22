import { describe, expect, it, vi } from "vitest";
import { AgentWorkflowController } from "../../../src/features/agent-workflow";
import { createTerminalArtifactIndex } from "../../../src/features/terminal/artifacts/public";
import { classifyWorkspaceActionError } from "../../../src/features/workspace-actions/errorClassification";
import { buildWorkspaceContextProjection } from "../../../src/features/workspace/context";
import type {
  Machine,
  MachineGroup,
  TerminalPane,
  TerminalTab,
} from "../../../src/features/workspace/types";
import type { AgentSessionRecord } from "../../../src/lib/agentLauncherApi";

const CANARY = "KERMINAL_CANARY_SECRET_7f3d9a2c";

function expectSerializedWithoutCanary(value: unknown) {
  expect(JSON.stringify(value)).not.toContain(CANARY);
}

function createProjectionFixture() {
  const machine: Machine = {
    description: "",
    id: "machine-1",
    kind: "local",
    name: "Local",
    status: "online",
    tags: [],
  };
  const machineGroups: MachineGroup[] = [
    { id: "group-1", machines: [machine], title: "Machines" },
  ];
  const pane: TerminalPane = {
    id: "pane-1",
    lines: [`terminal-output:${CANARY}`],
    machineId: machine.id,
    mode: "local",
    outputHistory: `terminal-history:${CANARY}`,
    prompt: `agent-prompt:${CANARY}`,
    status: "online",
    title: "Terminal",
  };
  const tab: TerminalTab = {
    id: "tab-1",
    layout: { paneId: pane.id, type: "pane" },
    machineId: machine.id,
    title: "Terminal",
  };

  return buildWorkspaceContextProjection({
    activeTabId: tab.id,
    focusedPaneId: pane.id,
    generatedAt: "2026-07-11T08:00:00.000Z",
    machineGroups,
    revision: 1,
    selectedMachineId: machine.id,
    terminalPanes: [
      {
        ...pane,
        selectedText: `terminal-selection:${CANARY}`,
        searchQuery: `terminal-search:${CANARY}`,
      } as TerminalPane,
    ],
    terminalTabs: [tab],
    sources: [
      { source: "terminal", status: "error" },
      { source: "agentRepository", status: "stale" },
    ],
  });
}

function createAgentSession(): AgentSessionRecord {
  return {
    session: {
      agentId: "codex",
      agentSessionId: "agent-1",
      launch: { args: [], cwd: "C:/repo", shell: "codex" },
      status: "active",
      title: "Agent session",
    },
  };
}

describe("Context Workspace 敏感信息边界", () => {
  it("WorkspaceContextProjection diagnostics 和完整投影不复制正文", () => {
    const projection = createProjectionFixture();

    expectSerializedWithoutCanary(projection);
    expectSerializedWithoutCanary(projection.diagnostics);
  });

  it("Artifact 索引拒绝 blocked value 和 blocked label", () => {
    const index = createTerminalArtifactIndex({
      paneId: "pane-1",
      target: { id: "local", kind: "local" },
    });
    index.accept([
      {
        kind: "command",
        source: "command-block",
        value: `deploy --token ${CANARY}`,
      },
      {
        kind: "link",
        label: `password=${CANARY}`,
        source: "osc8",
        value: "https://example.com/safe",
      },
      {
        kind: "link",
        label: "Safe documentation",
        source: "osc8",
        value: "https://example.com/docs",
      },
    ]);

    const snapshot = index.getSnapshot();
    expect(snapshot.rejected).toBe(2);
    expect(snapshot.artifacts).toHaveLength(1);
    expectSerializedWithoutCanary(snapshot);
  });

  it("Agent workflow snapshot、queue 和 history metadata 不保存 prompt 正文", async () => {
    const sent: string[] = [];
    const controller = new AgentWorkflowController(
      { listSessions: vi.fn().mockResolvedValue([createAgentSession()]) },
      { subscribe: () => () => undefined },
      {
        async send(request) {
          sent.push(request.text);
          return { accepted: true, transportId: "transport-1" };
        },
      },
      { now: () => new Date("2026-07-11T08:00:00.000Z") },
    );
    await controller.refresh();
    controller.recordQueueMetadata({
      createdAt: "2026-07-11T08:00:00.000Z",
      id: "queue-1",
      sessionId: "agent-1",
      submit: true,
      textBytes: CANARY.length,
    });
    const preview = controller.createSendPreview({
      kind: "selection",
      sessionId: "agent-1",
      text: `token=${CANARY}`,
    });

    expectSerializedWithoutCanary(controller.getSnapshot());
    await controller.confirmSendPreview(preview.id);
    expect(sent).not.toContainEqual(expect.stringContaining(CANARY));
    expectSerializedWithoutCanary(controller.getSnapshot());
    expectSerializedWithoutCanary(controller.getQueueMetadata());
    expectSerializedWithoutCanary(controller.getHistoryMetadata());
  });

  it("公开 action error classification 不暴露原始异常正文", () => {
    const result = classifyWorkspaceActionError(new Error(`token=${CANARY}`));

    expect(result.kind).toBe("failure");
    expectSerializedWithoutCanary(result);
  });
});
