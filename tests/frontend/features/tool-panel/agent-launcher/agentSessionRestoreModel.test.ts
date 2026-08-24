// @author kongweiguang
import { describe, expect, it } from "vitest";
import type {
  AgentSessionRecord,
  ExternalAgentId,
} from "../../../../../src/lib/agentLauncherApi";
import { findPersistedAgentSession } from "../../../../../src/features/tool-panel/agent-launcher/agentSessionRestoreModel";

function record(
  agentId: ExternalAgentId,
  agentSessionId: string,
  tabId: string,
  command: string,
  launcherKey?: string,
  title?: string,
): AgentSessionRecord {
  return {
    session: {
      agentId,
      agentSessionId,
      launcherKey,
      launch: {
        args: ["-Command", command],
        commandLabel: command,
        cwd: `C:/sessions/${agentSessionId}`,
        shell: "pwsh.exe",
      },
      status: "active",
      target: { tabId },
      title:
        title ??
        (agentId === "codex"
          ? "Codex"
          : agentId === "claude"
            ? "Claude"
            : agentId === "pi"
              ? "PI Agent"
              : "Custom"),
    },
  };
}

describe("findPersistedAgentSession", () => {
  it("selects the active matching Agent and restores its saved permission mode", () => {
    const selection = findPersistedAgentSession("tab-main", {
      agentId: "codex",
      launcherKey: "builtin:codex",
      permissionMode: "skipPermissions",
    }, [
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
      launcherKey: "builtin:codex",
      permissionMode: "skipPermissions",
      tabId: "tab-main",
    });
  });

  it("isolates multiple Custom sessions by launcherKey", () => {
    const selection = findPersistedAgentSession(
      "tab-main",
      {
        agentId: "custom",
        customCommand: "same-command",
        launcherKey: "custom:22222222-2222-4222-8222-222222222222",
        permissionMode: "default",
      },
      [
        record(
          "custom",
          "ags-first",
          "tab-main",
          "same-command",
          "custom:11111111-1111-4111-8111-111111111111",
          "First",
        ),
        record(
          "custom",
          "ags-second",
          "tab-main",
          "same-command",
          "custom:22222222-2222-4222-8222-222222222222",
          "Second",
        ),
      ],
    );

    expect(selection).toMatchObject({
      agentSessionId: "ags-second",
      customCommand: "same-command",
      launcherKey: "custom:22222222-2222-4222-8222-222222222222",
      title: "Second",
    });
  });

  it("matches legacy Custom records only by their saved command", () => {
    const records = [
      record("custom", "ags-legacy", "tab-main", " pi --fast ", undefined, "PI old"),
    ];

    expect(
      findPersistedAgentSession(
        "tab-main",
        {
          agentId: "custom",
          customCommand: "pi --fast",
          launcherKey: "custom:11111111-1111-4111-8111-111111111111",
          permissionMode: "default",
        },
        records,
      ),
    ).toMatchObject({
      agentSessionId: "ags-legacy",
      customCommand: "pi --fast",
      launcherKey: "custom:11111111-1111-4111-8111-111111111111",
      title: "PI old",
    });
    expect(
      findPersistedAgentSession(
        "tab-main",
        {
          agentId: "custom",
          customCommand: "pi --slow",
          launcherKey: "custom:11111111-1111-4111-8111-111111111111",
          permissionMode: "default",
        },
        records,
      ),
    ).toBeNull();
  });

  it("does not restore a skip-permissions session from the default entry action", () => {
    const skip = record(
      "codex",
      "ags-skip",
      "tab-main",
      "codex --dangerously-bypass-approvals-and-sandbox resume --last",
    );
    const regular = record(
      "codex",
      "ags-default",
      "tab-main",
      "codex resume --last",
    );

    expect(
      findPersistedAgentSession(
        "tab-main",
        {
          agentId: "codex",
          launcherKey: "builtin:codex",
          permissionMode: "default",
        },
        [skip, regular],
      ),
    ).toMatchObject({
      agentSessionId: "ags-default",
      permissionMode: "default",
    });
    expect(
      findPersistedAgentSession(
        "tab-main",
        {
          agentId: "codex",
          launcherKey: "builtin:codex",
          permissionMode: "skipPermissions",
        },
        [regular, skip],
      ),
    ).toMatchObject({
      agentSessionId: "ags-skip",
      permissionMode: "skipPermissions",
    });
  });

  it("infers builtin:pi for legacy native PI sessions", () => {
    expect(
      findPersistedAgentSession(
        "tab-main",
        {
          agentId: "pi",
          launcherKey: "builtin:pi",
          permissionMode: "default",
        },
        [
          record(
            "pi",
            "ags-pi",
            "tab-main",
            "pi --approve --mcp-config .mcp.json --continue",
          ),
        ],
      ),
    ).toMatchObject({
      agentSessionId: "ags-pi",
      launcherKey: "builtin:pi",
      permissionMode: "default",
    });
  });
});
