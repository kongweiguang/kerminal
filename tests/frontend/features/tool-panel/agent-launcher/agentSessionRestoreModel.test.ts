// @author kongweiguang
import { describe, expect, it } from "vitest";
import type { AgentSessionRecord } from "../../../../../src/lib/agentLauncherApi";
import { findPersistedAgentSession } from "../../../../../src/features/tool-panel/agent-launcher/agentSessionRestoreModel";

function record(
  agentId: "codex" | "claude",
  agentSessionId: string,
  tabId: string,
  command: string,
): AgentSessionRecord {
  return {
    session: {
      agentId,
      agentSessionId,
      launch: {
        args: ["-Command", command],
        commandLabel: command,
        cwd: `C:/sessions/${agentSessionId}`,
        shell: "pwsh.exe",
      },
      status: "active",
      target: { tabId },
      title: agentId === "codex" ? "Codex" : "Claude",
    },
  };
}

describe("findPersistedAgentSession", () => {
  it("selects the active matching Agent and restores its saved permission mode", () => {
    const selection = findPersistedAgentSession("tab-main", "codex", [
      record("claude", "ags-claude", "tab-main", "claude"),
      record(
        "codex",
        "ags-codex",
        "tab-main",
        "codex --dangerously-bypass-approvals-and-sandbox resume --last",
      ),
    ]);

    expect(selection).toMatchObject({
      agentSessionId: "ags-codex",
      permissionMode: "skipPermissions",
      tabId: "tab-main",
    });
  });
});
