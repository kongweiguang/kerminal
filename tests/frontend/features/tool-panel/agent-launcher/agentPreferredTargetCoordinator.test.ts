// @author kongweiguang
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerTerminalPaneSession } from "../../../../../src/features/terminal/terminalSessionRegistry";
import { createAgentPreferredTargetCoordinator } from "../../../../../src/features/tool-panel/agent-launcher/agentPreferredTargetCoordinator";
import { unregisterTestTerminalPaneSessions } from "../../../support/terminalSessionRegistry.testSupport";

describe("agentPreferredTargetCoordinator", () => {
  afterEach(unregisterTestTerminalPaneSessions);

  it("uses the focused pane as the preferred target for an assistant owned by the active tab", () => {
    registerTerminalPaneSession("pane-b", "term-b", {
      cwd: "C:/dev/workspace",
      shell: "pwsh",
      tabId: "tab-a",
      target: "local",
    });
    const coordinator = createAgentPreferredTargetCoordinator({
      activeTab: { id: "tab-a", title: "开发" } as never,
      focusedPane: {
        currentCwd: "C:/dev/workspace",
        id: "pane-b",
        mode: "local",
        shell: "pwsh",
      } as never,
      globalScopeId: "__kerminal_agent_global__",
      setRuntimeSessions: vi.fn(),
    });

    expect(
      coordinator.preferredTargetForSession({
        scope: { kind: "tab", tabId: "tab-a" },
        tabId: "tab-a",
        target: { paneId: "pane-a", tabId: "tab-a" },
      }),
    ).toMatchObject({ paneId: "pane-b", tabId: "tab-a" });
  });
});
