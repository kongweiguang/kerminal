// @author kongweiguang

import { describe, expect, it } from "vitest";
import type { AgentSessionRecord } from "../../../../../src/lib/agentLauncherApi";
import { resolveWorkspaceContextAgent } from "../../../../../src/features/workspace/context";

function record(
  overrides: Partial<AgentSessionRecord["session"]>,
): AgentSessionRecord {
  return {
    session: {
      agent_session_id: "agent-1",
      agent_id: "codex",
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
          agent_session_id: "agent-tab",
          title: "Tab session",
          updated_at: "2026-07-12T01:02:00.000Z",
          target: { tab_id: "tab-1" },
        }),
        record({
          agent_session_id: "agent-pane-old",
          title: "Old pane session",
          updated_at: "2026-07-12T01:00:00.000Z",
          target: { pane_id: "pane-1", tab_id: "tab-1" },
        }),
        record({
          agent_session_id: "agent-pane-new",
          title: "Current pane session",
          updated_at: "2026-07-12T01:03:00.000Z",
          target: { pane_id: "pane-1", tab_id: "tab-1" },
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
          agent_session_id: "agent-other",
          target: { pane_id: "pane-2", tab_id: "tab-2" },
        }),
        record({
          agent_session_id: "agent-unbound",
          target: null,
        }),
        record({
          agent_session_id: "agent-archived",
          status: "archived",
          target: { pane_id: "pane-1", tab_id: "tab-1" },
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
          agent_session_id: "agent-stale",
          status: "stale",
          title: "Stale session",
          target: {
            pane_id: "pane-1",
            tab_id: "tab-1",
            live_status: "stale",
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
