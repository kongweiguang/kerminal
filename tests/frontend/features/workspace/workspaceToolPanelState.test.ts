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

  it("inherits the current tool for a new tab without clearing the old tab", () => {
    const current = state("tab-a", {
      "tab-a": "agentLauncher",
    });

    const next = withToolPanelTabTransition(current, {
      activeTabId: "tab-new",
    });

    expect(next.activeTool).toBe("agentLauncher");
    expect(next.activeToolByTabId).toMatchObject({
      "tab-new": "agentLauncher",
    });
    expect(activeToolForTab(next.activeToolByTabId, "tab-a")).toBe(
      "agentLauncher",
    );
  });

  it("keeps an explicit per-tab close distinct from an uninitialized tab", () => {
    const current = state("tab-a", { "tab-a": "agentLauncher" });
    const closed = setActiveToolForCurrentTabState(current, null);

    expect(closed).toMatchObject({
      activeTool: null,
      activeToolByTabId: { "tab-a": null },
    });
    expect(
      withToolPanelTabTransition(
        { ...current, ...closed },
        { activeTabId: "tab-a" },
      ),
    ).toMatchObject({ activeTool: null });
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

  it("transfers the open tool when closing into an uninitialized next tab", () => {
    const current = state("tab-a", { "tab-a": "agentLauncher" });

    const next = withClosedToolPanelTab(
      current,
      { activeTabId: "tab-b" },
      "tab-a",
    );

    expect(next).toMatchObject({
      activeTool: "agentLauncher",
      activeToolByTabId: { "tab-b": "agentLauncher" },
    });
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
