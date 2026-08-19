// @author kongweiguang
import { describe, expect, it } from "vitest";
import {
  matchesCurrentTarget,
  type AgentConversationSessionSnapshot,
} from "../../../../../src/features/tool-panel/agent-launcher/AgentConversationList";

function session(
  overrides: Partial<AgentConversationSessionSnapshot> = {},
): AgentConversationSessionSnapshot {
  return {
    agentSessionId: "ags-session",
    repositoryStatus: "active",
    runtimeStatus: "running",
    statusSource: "repository",
    title: "Codex",
    ...overrides,
  };
}

describe("AgentConversationList scope matching", () => {
  it("matches a tab-scoped session only inside the same tab", () => {
    const tabSession = session({ scope: { kind: "tab", tabId: "tab-a" } });

    expect(
      matchesCurrentTarget(tabSession, undefined, {
        kind: "tab",
        tabId: "tab-a",
      }),
    ).toBe(true);
    expect(
      matchesCurrentTarget(tabSession, undefined, {
        kind: "tab",
        tabId: "tab-b",
      }),
    ).toBe(false);
    expect(
      matchesCurrentTarget(tabSession, undefined, { kind: "global" }),
    ).toBe(false);
  });

  it("shows a global session as current only in the global scope", () => {
    const globalSession = session({ scope: { kind: "global" } });

    expect(
      matchesCurrentTarget(globalSession, undefined, { kind: "global" }),
    ).toBe(true);
    expect(
      matchesCurrentTarget(globalSession, undefined, {
        kind: "tab",
        tabId: "tab-a",
      }),
    ).toBe(false);
  });

  it("keeps legacy target matching when no scope is available", () => {
    const legacyTabSession = session({ target: { tabId: "tab-a" } });
    const legacyGlobalSession = session({
      agentSessionId: "ags-global",
      target: { liveStatus: "unbound" },
    });

    expect(
      matchesCurrentTarget(legacyTabSession, undefined, {
        kind: "tab",
        tabId: "tab-a",
      }),
    ).toBe(true);
    expect(
      matchesCurrentTarget(legacyGlobalSession, undefined, {
        kind: "global",
      }),
    ).toBe(true);
    expect(
      matchesCurrentTarget(legacyTabSession, {
        targetRef: "ssh:prod",
      }),
    ).toBe(false);
  });
});
