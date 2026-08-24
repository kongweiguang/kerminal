// @author kongweiguang

import { describe, expect, it } from "vitest";
import {
  deleteCustomAgentDefinition,
  resolveAgentLauncherDescriptor,
  saveCustomAgentDefinition,
  selectAgentLauncher,
} from "../../../../../src/features/tool-panel/agent-launcher/agentLauncherSettingsModel";
import type { AgentLauncherSettings } from "../../../../../src/features/settings/settingsModel";

const FIRST_ID = "11111111-1111-4111-8111-111111111111";
const SECOND_ID = "22222222-2222-4222-8222-222222222222";

/** 生成隔离 fixture，避免单测之间共享可变定义数组。 */
function settingsFixture(): AgentLauncherSettings {
  return {
    customAgents: [
      { command: "pi --mcp-config .mcp.json", id: FIRST_ID, name: "PI" },
    ],
    selectedAgentKey: `custom:${FIRST_ID}`,
  };
}

describe("agentLauncherSettingsModel", () => {
  it("adds definitions in insertion order and selects the saved entry", () => {
    const next = saveCustomAgentDefinition(
      settingsFixture(),
      { command: "qwen --fast", name: "Qwen" },
      () => SECOND_ID,
    );

    expect(next.customAgents.map((agent) => agent.name)).toEqual(["PI", "Qwen"]);
    expect(next.selectedAgentKey).toBe(`custom:${SECOND_ID}`);
  });

  it("edits in place without changing the stable launcher key", () => {
    const next = saveCustomAgentDefinition(settingsFixture(), {
      command: "pi --mcp-config ./context/.mcp.json",
      id: FIRST_ID,
      name: "PI Agent",
    });

    expect(next.customAgents).toEqual([
      {
        command: "pi --mcp-config ./context/.mcp.json",
        id: FIRST_ID,
        name: "PI Agent",
      },
    ]);
    expect(next.selectedAgentKey).toBe(`custom:${FIRST_ID}`);
  });

  it("rejects case-insensitive duplicate names", () => {
    expect(() =>
      saveCustomAgentDefinition(
        settingsFixture(),
        { command: "other", name: " pi " },
        () => SECOND_ID,
      ),
    ).toThrow("Agent 名称已存在");
  });

  it("counts emoji by Unicode code point at the Rust-compatible boundary", () => {
    const accepted = saveCustomAgentDefinition(
      { customAgents: [], selectedAgentKey: "builtin:codex" },
      { command: "pi", name: "😀".repeat(64) },
      () => FIRST_ID,
    );
    expect(accepted.customAgents[0]?.name).toHaveLength(128);
    expect(() =>
      saveCustomAgentDefinition(
        { customAgents: [], selectedAgentKey: "builtin:codex" },
        { command: "pi", name: "😀".repeat(65) },
        () => FIRST_ID,
      ),
    ).toThrow("64");
    expect(() =>
      saveCustomAgentDefinition(
        { customAgents: [], selectedAgentKey: "builtin:codex" },
        { command: "😀".repeat(4097), name: "PI" },
        () => FIRST_ID,
      ),
    ).toThrow("4096");
  });

  it("rejects the thirty-third custom definition", () => {
    const full: AgentLauncherSettings = {
      customAgents: Array.from({ length: 32 }, (_, index) => ({
        command: `agent-${index}`,
        id: `${index.toString(16).padStart(8, "0")}-0000-0000-0000-000000000000`,
        name: `Agent ${index}`,
      })),
      selectedAgentKey: "builtin:codex",
    };

    expect(() =>
      saveCustomAgentDefinition(
        full,
        { command: "agent-33", name: "Agent 33" },
        () => SECOND_ID,
      ),
    ).toThrow("32");
  });

  it("falls back to Codex only when deleting the selected definition", () => {
    const selectedDeleted = deleteCustomAgentDefinition(
      settingsFixture(),
      FIRST_ID,
    );
    expect(selectedDeleted).toEqual({
      customAgents: [],
      selectedAgentKey: "builtin:codex",
    });

    const unselected = selectAgentLauncher(settingsFixture(), "builtin:claude");
    expect(deleteCustomAgentDefinition(unselected, FIRST_ID).selectedAgentKey).toBe(
      "builtin:claude",
    );
  });

  it("resolves current definitions without exposing command arguments to callers", () => {
    expect(
      resolveAgentLauncherDescriptor(settingsFixture()),
    ).toMatchObject({
      agentId: "custom",
      customCommand: "pi --mcp-config .mcp.json",
      launcherKey: `custom:${FIRST_ID}`,
      title: "PI",
    });
  });

  it("resolves PI as a native built-in launcher", () => {
    expect(
      resolveAgentLauncherDescriptor({
        customAgents: [],
        selectedAgentKey: "builtin:pi",
      }),
    ).toEqual({
      agentId: "pi",
      launcherKey: "builtin:pi",
      title: "PI Agent",
    });
  });
});
