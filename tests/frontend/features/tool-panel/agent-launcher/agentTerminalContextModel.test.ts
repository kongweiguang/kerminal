import { describe, expect, it } from "vitest";
import {
  buildAgentTerminalBranchPrompt,
  buildAgentTerminalCommandBlockPrompt,
  buildAgentTerminalContextPrompt,
  buildAgentTerminalSelectionPrompt,
  tailAgentTerminalOutput,
} from "../../../../../src/features/tool-panel/agent-launcher/agentTerminalContextModel";

describe("agentTerminalContextModel", () => {
  it("builds a pasteable context prompt from the bound terminal pane", () => {
    const prompt = buildAgentTerminalContextPrompt({
      activeTab: { id: "tab-main", title: "prod-api" },
      focusedPane: {
        currentCwd: "/srv/app",
        cwd: "/srv/fallback",
        id: "pane-prod",
        machineId: "prod-api",
        mode: "ssh",
        outputHistory: "$ npm test\r\nok\r\n",
        prompt: "$",
        remoteHostId: "prod-api",
        shell: "bash",
        status: "online",
        title: "prod-api",
      },
      session: {
        commandLabel: "codex",
        cwd: "C:/Users/me/.kerminal/agents/sessions/ags-codex",
        target: {
          cwd: "/srv/app",
          liveStatus: "ready",
          paneId: "pane-prod",
          shell: "bash",
          tabId: "tab-main",
          targetKind: "ssh",
          targetRef: "ssh:prod-api",
          targetTerminalSessionId: "term-prod",
        },
        title: "Codex",
      },
    });

    expect(prompt).toContain("Kerminal target context");
    expect(prompt).toContain("Agent: Codex");
    expect(prompt).toContain("Bound target: ssh:prod-api");
    expect(prompt).toContain("Tab: prod-api (tab-main)");
    expect(prompt).toContain("Target cwd: /srv/app");
    expect(prompt).toContain("```text\n$ npm test\nok\n```");
  });

  it("does not attach output from a focused pane that differs from the bound target", () => {
    const prompt = buildAgentTerminalContextPrompt({
      focusedPane: {
        currentCwd: "/tmp",
        cwd: "/tmp",
        id: "pane-other",
        machineId: "other",
        mode: "ssh",
        outputHistory: "secret unrelated output",
        prompt: "$",
        status: "online",
        title: "other",
      },
      session: {
        commandLabel: "codex",
        cwd: "C:/Users/me/.kerminal/agents/sessions/ags-codex",
        target: {
          cwd: "/srv/app",
          liveStatus: "ready",
          paneId: "pane-prod",
          shell: "bash",
          tabId: "tab-main",
          targetKind: "ssh",
          targetRef: "ssh:prod-api",
          targetTerminalSessionId: "term-prod",
        },
        title: "Codex",
      },
    });

    expect(prompt).toContain("Recent terminal output: <not captured>");
    expect(prompt).not.toContain("secret unrelated output");
  });

  it("attaches the focused pane context when it belongs to the assistant's current tab", () => {
    const prompt = buildAgentTerminalContextPrompt({
      activeTab: { id: "tab-main", title: "prod-api" },
      focusedPane: {
        currentCwd: "/srv/worker",
        cwd: "/srv/worker",
        id: "pane-worker",
        machineId: "prod-worker",
        mode: "ssh",
        outputHistory: "worker output",
        prompt: "$",
        shell: "bash",
        status: "online",
        title: "prod-worker",
      },
      session: {
        commandLabel: "codex",
        cwd: "C:/Users/me/.kerminal/agents/sessions/ags-codex",
        target: {
          liveStatus: "ready",
          paneId: "pane-prod",
          tabId: "tab-main",
          targetRef: "ssh:prod-api",
          targetTerminalSessionId: "term-prod",
        },
        title: "Codex",
      },
    });

    expect(prompt).toContain("Bound target: ssh:prod-api");
    expect(prompt).toContain("worker output");
  });

  it("does not attach output when the active tab differs from the bound target tab", () => {
    const prompt = buildAgentTerminalContextPrompt({
      activeTab: { id: "tab-other", title: "other-tab" },
      focusedPane: {
        currentCwd: "/srv/app",
        cwd: "/srv/app",
        id: "pane-prod",
        machineId: "prod-api",
        mode: "ssh",
        outputHistory: "secret output from another tab",
        prompt: "$",
        shell: "bash",
        status: "online",
        title: "prod-api",
      },
      session: {
        commandLabel: "codex",
        cwd: "C:/Users/me/.kerminal/agents/sessions/ags-codex",
        target: {
          cwd: "/srv/app",
          liveStatus: "ready",
          paneId: "pane-prod",
          shell: "bash",
          tabId: "tab-main",
          targetKind: "ssh",
          targetRef: "ssh:prod-api",
          targetTerminalSessionId: "term-prod",
        },
        title: "Codex",
      },
    });

    expect(prompt).toContain("Tab: tab-main");
    expect(prompt).toContain("Recent terminal output: <not captured>");
    expect(prompt).not.toContain("secret output from another tab");
    expect(prompt).not.toContain("other-tab (tab-other)");
  });

  it("builds selection and command block prompts from matching runtime context", () => {
    const baseInput = {
      activeTab: { id: "tab-main", title: "prod-api" },
      focusedPane: {
        currentCwd: "/srv/app",
        cwd: "/srv/fallback",
        id: "pane-prod",
        machineId: "prod-api",
        mode: "ssh" as const,
        outputHistory: "$ npm test\nok\n",
        prompt: "$",
        shell: "bash",
        status: "online" as const,
        title: "prod-api",
      },
      runtimeContext: {
        commandBlockText: "$ npm test\nok",
        paneId: "pane-prod",
        selectedText: "selected lines\nfrom terminal",
      },
      session: {
        commandLabel: "codex",
        cwd: "C:/Users/me/.kerminal/agents/sessions/ags-codex",
        target: {
          cwd: "/srv/app",
          liveStatus: "ready" as const,
          paneId: "pane-prod",
          shell: "bash",
          tabId: "tab-main",
          targetKind: "ssh",
          targetRef: "ssh:prod-api",
          targetTerminalSessionId: "term-prod",
        },
        title: "Codex",
      },
    };

    expect(buildAgentTerminalSelectionPrompt(baseInput)).toContain(
      "Kerminal target selection",
    );
    expect(buildAgentTerminalSelectionPrompt(baseInput)).toContain(
      "Selected terminal text:\n```text\nselected lines\nfrom terminal\n```",
    );
    expect(buildAgentTerminalCommandBlockPrompt(baseInput)).toContain(
      "Latest terminal command block:\n```text\n$ npm test\nok\n```",
    );
  });

  it("builds a safe branch/fork request without implying git execution", () => {
    const prompt = buildAgentTerminalBranchPrompt({
      activeTab: { id: "tab-main", title: "prod-api" },
      focusedPane: {
        currentCwd: "/srv/app",
        cwd: "/srv/fallback",
        id: "pane-prod",
        machineId: "prod-api",
        mode: "ssh",
        outputHistory: "$ git status\n",
        prompt: "$",
        shell: "bash",
        status: "online",
        title: "prod-api",
      },
      session: {
        agentSessionId: "ags-codex",
        commandLabel: "codex",
        cwd: "C:/Users/me/.kerminal/agents/sessions/ags-codex",
        target: {
          cwd: "/srv/app",
          liveStatus: "ready",
          paneId: "pane-prod",
          shell: "bash",
          tabId: "tab-main",
          targetKind: "ssh",
          targetRef: "ssh:prod-api",
          targetTerminalSessionId: "term-prod",
        },
        title: "Codex",
      },
    });

    expect(prompt).toContain("Kerminal branch/fork request");
    expect(prompt).toContain("Suggested branch: agent/codex-ssh-prod-api-ags-codex");
    expect(prompt).toContain("Agent workspace: C:/Users/me/.kerminal/agents/sessions/ags-codex");
    expect(prompt).toContain("Target cwd: /srv/app");
    expect(prompt).toContain("Please inspect git status first.");
    expect(prompt).toContain("Do not run destructive git operations");
  });

  it("rejects runtime context from a different pane", () => {
    const prompt = buildAgentTerminalSelectionPrompt({
      runtimeContext: {
        paneId: "pane-other",
        selectedText: "unrelated selection",
      },
      session: {
        commandLabel: "codex",
        cwd: "C:/Users/me/.kerminal/agents/sessions/ags-codex",
        target: {
          liveStatus: "ready",
          paneId: "pane-prod",
          targetTerminalSessionId: "term-prod",
        },
        title: "Codex",
      },
    });

    expect(prompt).toBeNull();
  });

  it("rejects runtime context from a different active tab even when the pane matches", () => {
    const prompt = buildAgentTerminalSelectionPrompt({
      activeTab: { id: "tab-other", title: "other-tab" },
      focusedPane: {
        currentCwd: "/srv/app",
        cwd: "/srv/app",
        id: "pane-prod",
        machineId: "prod-api",
        mode: "ssh",
        outputHistory: "",
        prompt: "$",
        shell: "bash",
        status: "online",
        title: "prod-api",
      },
      runtimeContext: {
        paneId: "pane-prod",
        selectedText: "secret selection from another tab",
      },
      session: {
        commandLabel: "codex",
        cwd: "C:/Users/me/.kerminal/agents/sessions/ags-codex",
        target: {
          liveStatus: "ready",
          paneId: "pane-prod",
          tabId: "tab-main",
          targetTerminalSessionId: "term-prod",
        },
        title: "Codex",
      },
    });

    expect(prompt).toBeNull();
  });

  it("tails long terminal output after normalizing line endings", () => {
    expect(tailAgentTerminalOutput("one\r\ntwo\rthree", 7)).toEqual({
      text: "o\nthree",
      truncated: true,
    });
  });
});
