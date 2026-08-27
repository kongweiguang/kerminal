// @author kongweiguang

import { describe, expect, it } from "vitest";
import {
  buildTerminalTabBarItems,
  createTerminalTabGroupState,
  moveTerminalTabGroupState,
  moveTerminalTabState,
  normalizeTerminalTabGroupState,
  removeTerminalTabFromGroupState,
  updateTerminalTabGroupState,
  ungroupTerminalTabGroupState,
} from "../../../../src/features/workspace/workspaceTabGroupsModel";
import type { TerminalTab } from "../../../../src/features/workspace/types";

const tabs: TerminalTab[] = [
  { id: "local", machineId: "local", title: "本地", layout: { paneId: "p-local", type: "pane" } },
  { id: "prod", machineId: "prod", title: "生产", layout: { paneId: "p-prod", type: "pane" } },
  { id: "sftp", kind: "sftpTransfer", machineId: "prod", title: "SFTP" },
];

describe("workspaceTabGroupsModel", () => {
  it("allows different tab kinds and hosts in one explicit group", () => {
    const created = createTerminalTabGroupState(
      { terminalTabs: tabs, terminalTabGroups: {} },
      "prod",
      "tab-group-1",
      { title: "工作流" },
    );
    const joined = moveTerminalTabState(created, {
      position: "after",
      tabId: "sftp",
      targetGroupId: "tab-group-1",
      targetTabId: "prod",
    });
    expect(joined.terminalTabs.map((tab) => tab.id)).toEqual(["local", "prod", "sftp"]);
    expect(joined.terminalTabs.slice(1).every((tab) => tab.tabGroupId === "tab-group-1")).toBe(true);
    expect(buildTerminalTabBarItems(joined.terminalTabs, joined.terminalTabGroups)).toHaveLength(2);
  });

  it("inserts tabs at the requested sibling position instead of group edges", () => {
    const state = normalizeTerminalTabGroupState(
      tabs.map((tab) =>
        tab.id === "prod" || tab.id === "sftp"
          ? { ...tab, tabGroupId: "tab-group-1" }
          : tab,
      ),
      { "tab-group-1": { collapsed: false, title: "工作流" } },
    );

    const before = moveTerminalTabState(state, {
      position: "before",
      tabId: "sftp",
      targetGroupId: "tab-group-1",
      targetTabId: "prod",
    });
    expect(before.terminalTabs.map((tab) => tab.id)).toEqual([
      "local",
      "sftp",
      "prod",
    ]);

    const after = moveTerminalTabState(before, {
      position: "after",
      tabId: "sftp",
      targetGroupId: "tab-group-1",
      targetTabId: "prod",
    });
    expect(after.terminalTabs.map((tab) => tab.id)).toEqual([
      "local",
      "prod",
      "sftp",
    ]);
  });

  it("projects flat gap coordinates after removing the source block", () => {
    const grouped = normalizeTerminalTabGroupState(
      tabs.map((tab) =>
        tab.id === "prod" || tab.id === "sftp"
          ? { ...tab, tabGroupId: "tab-group-1" }
          : tab,
      ),
      { "tab-group-1": { collapsed: false, title: "工作流" } },
    );
    const sameTabPosition = moveTerminalTabState(grouped, {
      tabId: "prod",
      targetGroupId: "tab-group-1",
      targetIndex: 2,
    });
    expect(sameTabPosition.terminalTabs.map((tab) => tab.id)).toEqual([
      "local",
      "prod",
      "sftp",
    ]);

    const sameGroupPosition = moveTerminalTabGroupState(grouped, {
      groupId: "tab-group-1",
      targetIndex: 3,
    });
    expect(sameGroupPosition.terminalTabs.map((tab) => tab.id)).toEqual([
      "local",
      "prod",
      "sftp",
    ]);
  });

  it("rejects stale and cross-layer drop targets without changing state", () => {
    const state = normalizeTerminalTabGroupState(
      tabs.map((tab) =>
        tab.id === "prod" || tab.id === "sftp"
          ? { ...tab, tabGroupId: "tab-group-1" }
          : tab,
      ),
      { "tab-group-1": { collapsed: false, title: "工作流" } },
    );
    const stale = moveTerminalTabState(state, {
      tabId: "prod",
      targetTabId: "closed-tab",
    });
    const crossLayer = moveTerminalTabState(state, {
      tabId: "prod",
      targetGroupId: "missing-group",
      targetTabId: "sftp",
    });
    const staleGap = moveTerminalTabGroupState(state, {
      groupId: "tab-group-1",
      targetIndex: 99,
    });
    expect(stale).toBe(state);
    expect(crossLayer).toBe(state);
    expect(staleGap).toBe(state);
  });

  it("allows explicit colors to return to stable automatic assignment", () => {
    const state = normalizeTerminalTabGroupState(
      [{ ...tabs[0], tabGroupId: "tab-group-1" }],
      { "tab-group-1": { collapsed: false, color: "pink", title: "工作流" } },
    );
    const updated = updateTerminalTabGroupState(state, "tab-group-1", {
      color: undefined,
    });
    expect(updated.terminalTabGroups["tab-group-1"]).toEqual({
      collapsed: false,
      title: "工作流",
    });
  });

  it("keeps groups contiguous and cleans the definition when the last member leaves", () => {
    const state = createTerminalTabGroupState(
      { terminalTabs: tabs, terminalTabGroups: {} },
      "prod",
      "tab-group-1",
      { title: "工作流" },
    );
    const moved = removeTerminalTabFromGroupState(state, "prod");
    expect(moved.terminalTabGroups).toEqual({});
    expect(moved.terminalTabs.every((tab) => !tab.tabGroupId)).toBe(true);
  });

  it("moves a group as a block without changing tab identity", () => {
    const state = normalizeTerminalTabGroupState(
      tabs.map((tab) => (tab.id === "prod" || tab.id === "sftp" ? { ...tab, tabGroupId: "tab-group-1" } : tab)),
      { "tab-group-1": { collapsed: false, title: "工作流" } },
    );
    const moved = moveTerminalTabGroupState(state, { groupId: "tab-group-1", targetIndex: 0 });
    expect(moved.terminalTabs.map((tab) => tab.id)).toEqual(["prod", "sftp", "local"]);
    expect(moved.terminalTabs[0].machineId).toBe("prod");
  });

  it("ungroups without closing the tabs", () => {
    const state = normalizeTerminalTabGroupState(
      tabs.map((tab) => ({ ...tab, tabGroupId: "tab-group-1" })),
      { "tab-group-1": { collapsed: true, title: "工作流" } },
    );
    const ungrouped = ungroupTerminalTabGroupState(state, "tab-group-1");
    expect(ungrouped.terminalTabs).toHaveLength(3);
    expect(ungrouped.terminalTabGroups).toEqual({});
  });
});
