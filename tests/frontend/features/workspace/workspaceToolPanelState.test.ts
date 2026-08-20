// @author kongweiguang

import { describe, expect, it } from "vitest";
import {
  activeToolForTab,
  setOpenToolsForCurrentTabState,
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

  it("preserves an ordered multi-panel set independently for each tab", () => {
    const tabA = {
      ...state("tab-a"),
      ...setOpenToolsForCurrentTabState(
        state("tab-a"),
        ["logs", "sftp", "system"],
        "system",
      ),
    };
    const tabB = withToolPanelTabTransition(tabA, { activeTabId: "tab-b" });
    const closedSftp = setOpenToolsForCurrentTabState(
      { ...tabA, ...tabB },
      ["logs", "system"],
      "system",
    );

    expect(tabB.openTools).toEqual(["logs", "sftp", "system"]);
    expect(closedSftp.openToolsByTabId).toMatchObject({
      "tab-a": ["logs", "sftp", "system"],
      "tab-b": ["logs", "system"],
    });
    expect(
      withToolPanelTabTransition(
        { ...tabA, ...tabB, ...closedSftp },
        { activeTabId: "tab-a" },
      ).openTools,
    ).toEqual(["logs", "sftp", "system"]);
  });
});

/** 旧单面板 fixture 同时补出等价打开集合，验证迁移路径与新状态保持一致。 */
function state(
  activeTabId: string,
  activeToolByTabId: WorkspaceToolPanelState["activeToolByTabId"] = {},
): WorkspaceToolPanelState {
  const openToolsByTabId = Object.fromEntries(
    Object.entries(activeToolByTabId).map(([tabId, toolId]) => [
      tabId,
      toolId ? [toolId] : [],
    ]),
  );
  const activeTool = activeToolForTab(activeToolByTabId, activeTabId);
  return {
    activeTabId,
    activeTool,
    activeToolByTabId,
    openTools: activeTool ? [activeTool] : [],
    openToolsByTabId,
  };
}
