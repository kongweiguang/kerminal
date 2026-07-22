import { describe, expect, it } from "vitest";
import type { AgentSessionRecord } from "../../../../../src/lib/agentLauncherApi";
import { resolveWorkspaceContextAgent } from "../../../../../src/features/workspace/context";

function record(
  overrides: Partial<AgentSessionRecord["session"]>,
): AgentSessionRecord {
  return {
    session: {
      agentSessionId: "agent-1",
      agentId: "codex",
      title: "Agent session",
      status: "active",
      launch: { args: [], cwd: "/workspace", shell: "codex" },
      ...overrides,
    },
  };
}

describe("resolveWorkspaceContextAgent", () => {
  it("优先选择精确 pane 绑定的最新活动会话", () => {
    const result = resolveWorkspaceContextAgent(
      {
        activeTabId: "tab-1",
        focusedPaneId: "pane-1",
        targetId: "host-1",
      },
      [
        record({
          agentSessionId: "agent-tab",
          title: "Tab session",
          updatedAt: "2026-07-12T01:02:00.000Z",
          target: { tabId: "tab-1" },
        }),
        record({
          agentSessionId: "agent-pane-old",
          title: "Old pane session",
          updatedAt: "2026-07-12T01:00:00.000Z",
          target: { paneId: "pane-1", tabId: "tab-1" },
        }),
        record({
          agentSessionId: "agent-pane-new",
          title: "Current pane session",
          updatedAt: "2026-07-12T01:03:00.000Z",
          target: { paneId: "pane-1", tabId: "tab-1" },
        }),
      ],
    );

    expect(result).toEqual({
      sessionId: "agent-pane-new",
      status: "active",
      title: "Current pane session",
    });
  });

  it("不把其它目标、未绑定或已归档会话当作当前会话", () => {
    const result = resolveWorkspaceContextAgent(
      {
        activeTabId: "tab-1",
        focusedPaneId: "pane-1",
        targetId: "host-1",
      },
      [
        record({
          agentSessionId: "agent-other",
          target: { paneId: "pane-2", tabId: "tab-2" },
        }),
        record({
          agentSessionId: "agent-unbound",
          target: null,
        }),
        record({
          agentSessionId: "agent-archived",
          status: "archived",
          target: { paneId: "pane-1", tabId: "tab-1" },
        }),
      ],
    );

    expect(result).toEqual({
      sessionId: null,
      status: "unavailable",
    });
  });

  it("在没有活动会话时显示当前目标的 stale 会话", () => {
    const result = resolveWorkspaceContextAgent(
      {
        activeTabId: "tab-1",
        focusedPaneId: "pane-1",
        targetId: "host-1",
      },
      [
        record({
          agentSessionId: "agent-stale",
          status: "stale",
          title: "Stale session",
          target: {
            paneId: "pane-1",
            tabId: "tab-1",
            liveStatus: "stale",
          },
        }),
      ],
    );

    expect(result).toEqual({
      sessionId: "agent-stale",
      status: "stale",
      title: "Stale session",
    });
  });
});
