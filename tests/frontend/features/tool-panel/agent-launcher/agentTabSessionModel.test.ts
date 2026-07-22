import { describe, expect, it } from "vitest";
import type { AgentSessionRecord } from "../../../../../src/lib/agentLauncherApi";
import {
  UNBOUND_AGENT_SESSION_SCOPE_ID,
  agentSessionRecordIds,
  agentSessionRecordTabId,
  agentSessionScopeId,
  agentSessionTabId,
  findRunningSessionForTabAgent,
  restorableSessionsForTab,
  tabRemovedCleanupPlan,
  visibleAgentSessionForTab,
  type AgentSidebarSessionState,
  type AgentSidebarTabSession,
} from "../../../../../src/features/tool-panel/agent-launcher/agentTabSessionModel";

function sidebarSession(
  overrides: Partial<AgentSidebarTabSession> = {},
): AgentSidebarTabSession {
  return {
    agentId: "codex",
    agentSessionId: "ags-tab-a-codex",
    permissionMode: "default",
    status: "running",
    tabId: "tab-a",
    target: { paneId: "pane-a", tabId: "tab-a" },
    ...overrides,
  };
}

function state(
  sessions: AgentSidebarTabSession[],
  activeSessionIdByTabId: Record<string, string | undefined>,
): AgentSidebarSessionState {
  return {
    activeSessionIdByTabId,
    sessionsById: Object.fromEntries(
      sessions.map((session) => [session.agentSessionId, session]),
    ),
    viewByTabId: {},
  };
}

function record(
  agentSessionId: string,
  tabId: string | undefined,
  status: AgentSessionRecord["session"]["status"] = "active",
  targetOverride?: AgentSessionRecord["session"]["target"],
): AgentSessionRecord {
  return {
    session: {
      agentId: "codex",
      agentSessionId,
      launch: {
        args: [],
        cwd: `C:/Users/me/.kerminal/agents/sessions/${agentSessionId}`,
        shell: "codex",
      },
      status,
      target:
        targetOverride ??
        (tabId ? { paneId: `pane-${tabId}`, tabId } : undefined),
      title: "Codex",
    },
  };
}

describe("agentTabSessionModel", () => {
  it("resolves the tab scope from the persisted target before the registry field", () => {
    expect(
      agentSessionTabId(
        sidebarSession({
          tabId: "registry-tab",
          target: { tabId: "target-tab" },
        }),
      ),
    ).toBe("target-tab");
    expect(agentSessionTabId(sidebarSession({ target: undefined }))).toBe(
      "tab-a",
    );
    expect(
      agentSessionTabId(sidebarSession({ target: { liveStatus: "unbound" } })),
    ).toBe("tab-a");
    expect(agentSessionScopeId(undefined)).toBe(UNBOUND_AGENT_SESSION_SCOPE_ID);
  });

  it("returns only the visible session for the active tab mapping", () => {
    const sessionA = sidebarSession();
    const sessionB = sidebarSession({
      agentSessionId: "ags-tab-b-codex",
      tabId: "tab-b",
      target: { paneId: "pane-b", tabId: "tab-b" },
    });
    const model = state([sessionA, sessionB], {
      "tab-a": sessionA.agentSessionId,
      "tab-b": sessionB.agentSessionId,
    });

    expect(visibleAgentSessionForTab(model, "tab-a")).toBe(sessionA);
    expect(visibleAgentSessionForTab(model, "tab-b")).toBe(sessionB);
    expect(visibleAgentSessionForTab(model, "tab-c")).toBeUndefined();
  });

  it("does not show a session when the mapping points across tab boundaries", () => {
    const sessionB = sidebarSession({
      agentSessionId: "ags-tab-b-codex",
      tabId: "tab-b",
      target: { paneId: "pane-b", tabId: "tab-b" },
    });
    const model = state([sessionB], {
      "tab-a": sessionB.agentSessionId,
    });

    expect(visibleAgentSessionForTab(model, "tab-a")).toBeUndefined();
  });

  it("finds reusable running sessions only inside the same tab and launch mode", () => {
    const tabACodex = sidebarSession();
    const tabBCodex = sidebarSession({
      agentSessionId: "ags-tab-b-codex",
      tabId: "tab-b",
      target: { paneId: "pane-b", tabId: "tab-b" },
    });
    const tabAClaude = sidebarSession({
      agentId: "claude",
      agentSessionId: "ags-tab-a-claude",
    });
    const model = state([tabACodex, tabBCodex, tabAClaude], {});

    expect(
      findRunningSessionForTabAgent(model, "tab-a", "codex", "default"),
    ).toBe(tabACodex);
    expect(
      findRunningSessionForTabAgent(model, "tab-b", "codex", "default"),
    ).toBe(tabBCodex);
    expect(
      findRunningSessionForTabAgent(model, "tab-a", "claude", "default"),
    ).toBe(tabAClaude);
    expect(
      findRunningSessionForTabAgent(model, "tab-a", "codex", "skipPermissions"),
    ).toBeUndefined();
  });

  it("keeps unbound sessions in the sidebar fallback scope", () => {
    const unbound = sidebarSession({
      agentSessionId: "ags-unbound-codex",
      tabId: UNBOUND_AGENT_SESSION_SCOPE_ID,
      target: { liveStatus: "unbound" },
    });
    const model = state([unbound], {
      [UNBOUND_AGENT_SESSION_SCOPE_ID]: unbound.agentSessionId,
    });

    expect(visibleAgentSessionForTab(model, undefined)).toBe(unbound);
    expect(
      findRunningSessionForTabAgent(model, undefined, "codex", "default"),
    ).toBe(unbound);
  });

  it("matches custom commands without crossing tabs", () => {
    const tabACustom = sidebarSession({
      agentId: "custom",
      agentSessionId: "ags-tab-a-custom",
      customCommand: " qwen --fast ",
    });
    const tabBCustom = sidebarSession({
      agentId: "custom",
      agentSessionId: "ags-tab-b-custom",
      customCommand: "qwen --fast",
      tabId: "tab-b",
      target: { paneId: "pane-b", tabId: "tab-b" },
    });
    const model = state([tabACustom, tabBCustom], {});

    expect(
      findRunningSessionForTabAgent(
        model,
        "tab-a",
        "custom",
        "default",
        "qwen --fast",
      ),
    ).toBe(tabACustom);
    expect(
      findRunningSessionForTabAgent(
        model,
        "tab-a",
        "custom",
        "default",
        "qwen --slow",
      ),
    ).toBeUndefined();
  });

  it("plans cleanup for sessions whose tabs were removed", () => {
    const tabA = sidebarSession();
    const tabB = sidebarSession({
      agentSessionId: "ags-tab-b-codex",
      tabId: "tab-b",
      target: { paneId: "pane-b", tabId: "tab-b" },
    });
    const model = state([tabA, tabB], {});

    expect(tabRemovedCleanupPlan(["tab-a", "tab-b"], ["tab-b"], model)).toEqual({
      agentSessionIds: ["ags-tab-a-codex"],
      removedTabIds: ["tab-a"],
    });
  });

  it("restores only active records for the requested tab", () => {
    const tabAActive = record("ags-a-active", "tab-a", "active");
    const tabAArchived = record("ags-a-archived", "tab-a", "archived");
    const tabBActive = record("ags-b-active", "tab-b", "active");
    const legacyActive = record("ags-legacy", undefined, "active");

    const restorable = restorableSessionsForTab(
      [tabAActive, tabAArchived, tabBActive, legacyActive],
      "tab-a",
    );

    expect(agentSessionRecordIds(restorable)).toEqual(["ags-a-active"]);
    expect(agentSessionRecordTabId(tabAActive)).toBe("tab-a");
    expect(agentSessionRecordTabId(legacyActive)).toBeUndefined();
  });

  it("restores active unbound records only for the fallback scope", () => {
    const unboundActive = record("ags-unbound", undefined, "active", {
      liveStatus: "unbound",
    });
    const legacyActive = record("ags-legacy", undefined, "active");
    const tabAActive = record("ags-a-active", "tab-a", "active");

    const restorable = restorableSessionsForTab(
      [unboundActive, legacyActive, tabAActive],
      undefined,
    );

    expect(agentSessionRecordIds(restorable)).toEqual(["ags-unbound"]);
    expect(agentSessionRecordTabId(unboundActive)).toBe(
      UNBOUND_AGENT_SESSION_SCOPE_ID,
    );
    expect(agentSessionRecordTabId(legacyActive)).toBeUndefined();
  });
});
