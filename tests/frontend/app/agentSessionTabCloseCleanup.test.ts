// @author kongweiguang
import { describe, expect, it, vi } from "vitest";
import type {
  AgentSessionRecord,
  AgentSessionRecordStatus,
} from "../../../src/lib/agentLauncherApi";
import { archiveAgentSessionsForClosedTabs } from "../../../src/app/agentSessionTabCloseCleanup";

describe("archiveAgentSessionsForClosedTabs", () => {
  it("archives every non-archived session bound to a closed tab", async () => {
    const archiveSession = vi
      .fn<(agentSessionId: string) => Promise<AgentSessionRecord>>()
      .mockImplementation(async (agentSessionId) =>
        record(agentSessionId, "tab-a", "archived"),
      );
    const listSessions = vi.fn().mockResolvedValue({
      diagnostics: [],
      sessions: [
        record("agent-active", "tab-a", "active"),
        record("agent-stale", "tab-a", "stale"),
        record("agent-archived", "tab-a", "archived"),
        record("agent-other-tab", "tab-b", "active"),
        record("agent-unbound", "tab-a", "active", "unbound"),
      ],
    });

    await expect(
      archiveAgentSessionsForClosedTabs(["tab-a"], {
        archiveSession,
        listSessions,
      }),
    ).resolves.toEqual(["agent-active", "agent-stale"]);
    expect(archiveSession).toHaveBeenCalledTimes(2);
    expect(archiveSession).toHaveBeenCalledWith("agent-active");
    expect(archiveSession).toHaveBeenCalledWith("agent-stale");
  });

  it("does not read session storage when no valid tab id closed", async () => {
    const listSessions = vi.fn();

    await expect(
      archiveAgentSessionsForClosedTabs(["", "  "], {
        archiveSession: vi.fn(),
        listSessions,
      }),
    ).resolves.toEqual([]);
    expect(listSessions).not.toHaveBeenCalled();
  });
});

function record(
  agentSessionId: string,
  tabId: string,
  status: AgentSessionRecordStatus,
  liveStatus: "ready" | "unbound" = "ready",
): AgentSessionRecord {
  return {
    session: {
      agentId: "codex",
      agentSessionId,
      launch: { args: [], cwd: "C:/workspace", shell: "codex" },
      status,
      target: { liveStatus, tabId },
      title: "Codex",
    },
  };
}
