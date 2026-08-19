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
        record("agent-active", "tab-a", "active", "scope"),
        record("agent-stale", "tab-a", "stale", "scope"),
        record("agent-archived", "tab-a", "archived"),
        record("agent-other-tab", "tab-b", "active"),
        record("agent-unbound", "tab-a", "active", "unbound"),
        record("agent-global", "tab-a", "active", "global"),
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
  representation: "ready" | "unbound" | "scope" | "global" = "ready",
): AgentSessionRecord {
  return {
    session: {
      agentId: "codex",
      agentSessionId,
      launch: { args: [], cwd: "C:/workspace", shell: "codex" },
      scope:
        representation === "scope"
          ? { kind: "tab", tabId }
          : representation === "global"
            ? { kind: "global" }
            : undefined,
      status,
      target:
        representation === "scope" || representation === "global"
          ? undefined
          : {
              liveStatus: representation === "unbound" ? "unbound" : "ready",
              tabId,
            },
      title: "Codex",
    },
  };
}
