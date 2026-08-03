// @author kongweiguang

import { describe, expect, it } from "vitest";
import {
  activeToolForTab,
  setActiveToolForCurrentTabState,
  withClosedToolPanelTab,
  withToolPanelTabTransition,
  type WorkspaceToolPanelState,
} from "../../../../src/features/workspace/workspaceToolPanelState";

describe("workspaceToolPanelState", () => {
  it("restores each open tab's last selected right-panel tool", () => {
    const tabA = setActiveToolForCurrentTabState(state("tab-a"), "agentLauncher");
    const afterTabA = { ...state("tab-a"), ...tabA };
    const tabBTransition = withToolPanelTabTransition(afterTabA, {
      activeTabId: "tab-b",
    });
    const tabB = setActiveToolForCurrentTabState(
      { ...afterTabA, ...tabBTransition },
      "sftp",
    );
    const afterTabB = { ...afterTabA, ...tabBTransition, ...tabB };

    expect(
      withToolPanelTabTransition(afterTabB, { activeTabId: "tab-a" }),
    ).toMatchObject({ activeTool: "agentLauncher" });
    expect(
      withToolPanelTabTransition(afterTabB, { activeTabId: "tab-b" }),
    ).toMatchObject({ activeTool: "sftp" });
  });

  it("defaults a new tab to a collapsed panel without clearing the old tab", () => {
    const current = state("tab-a", {
      "tab-a": "agentLauncher",
    });

    const next = withToolPanelTabTransition(current, {
      activeTabId: "tab-new",
    });

    expect(next.activeTool).toBeNull();
    expect(activeToolForTab(next.activeToolByTabId, "tab-a")).toBe(
      "agentLauncher",
    );
  });

  it("cleans only the closed tab and restores the next active tab", () => {
    const current = state("tab-b", {
      "tab-a": "agentLauncher",
      "tab-b": "sftp",
    });

    const next = withClosedToolPanelTab(
      current,
      { activeTabId: "tab-a" },
      "tab-b",
    );

    expect(next).toMatchObject({
      activeTool: "agentLauncher",
      activeToolByTabId: { "tab-a": "agentLauncher" },
    });
    expect(next.activeToolByTabId).not.toHaveProperty("tab-b");
  });
});

function state(
  activeTabId: string,
  activeToolByTabId: WorkspaceToolPanelState["activeToolByTabId"] = {},
): WorkspaceToolPanelState {
  return {
    activeTabId,
    activeTool: activeToolForTab(activeToolByTabId, activeTabId),
    activeToolByTabId,
  };
}
