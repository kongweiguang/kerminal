// @author kongweiguang

import { describe, expect, it } from "vitest";
import type { TerminalTab } from "../../../../src/features/workspace/types";
import {
  prioritizeTerminalTabPointerTargetIds,
  resolveTerminalTabDragCommand,
  type TerminalTabDragSource,
  type TerminalTabDragTarget,
} from "../../../../src/features/terminal/terminalTabDragModel";

const tab = (id: string, tabGroupId?: string): TerminalTab => ({
  id,
  layout: { paneId: `pane-${id}`, type: "pane" },
  machineId: `machine-${id}`,
  title: id,
  ...(tabGroupId ? { tabGroupId } : {}),
});

const tabs = [tab("tab-a", "group-a"), tab("tab-b", "group-a"), tab("tab-c"), tab("tab-d", "group-b")];
const tabGroups = [
  { grouped: true, id: "group-a", tabs: [tabs[0], tabs[1]] },
  { grouped: false, id: "ungrouped:tab-c", tabs: [tabs[2]] },
  { grouped: true, id: "group-b", tabs: [tabs[3]] },
];

/** 用固定工作区投影包装解析器，使每个用例只表达源、目标和相对位置。 */
function resolve(
  active: TerminalTabDragSource,
  over: TerminalTabDragTarget,
  position: "before" | "after" = "before",
) {
  return resolveTerminalTabDragCommand({
    active,
    over,
    position,
    tabGroups,
    tabs,
  });
}

describe("resolveTerminalTabDragCommand", () => {
  it("prefers a nested tab or gap over its outer group collision", () => {
    expect(
      prioritizeTerminalTabPointerTargetIds([
        "group:group-a",
        "tab:tab-a",
      ]),
    ).toEqual(["tab:tab-a"]);
    expect(
      prioritizeTerminalTabPointerTargetIds([
        "group:group-a",
        "gap:2",
      ]),
    ).toEqual(["gap:2"]);
    expect(
      prioritizeTerminalTabPointerTargetIds(["group:group-a"]),
    ).toEqual(["group:group-a"]);
  });

  it("moves a tab between hosts into a group without changing the session identity", () => {
    expect(
      resolve(
        { kind: "tab", tabId: "tab-c" },
        { kind: "tab", groupId: "group-a", tabId: "tab-a" },
      ),
    ).toMatchObject({
      tabId: "tab-c",
      targetGroupId: "group-a",
      targetTabId: "tab-a",
    });
  });

  it("uses a top-level gap to remove a tab from its group", () => {
    expect(
      resolve(
        { groupId: "group-a", kind: "tab", tabId: "tab-a" },
        { index: 2, kind: "gap" },
      ),
    ).toEqual({
      tabId: "tab-a",
      targetGroupId: null,
      targetIndex: 2,
    });
  });

  it("does not create a pseudo group for ungrouped tabs", () => {
    expect(
      resolve(
        { kind: "group", groupId: "group-a" },
        { kind: "tab", tabId: "tab-c" },
        "after",
      ),
    ).toEqual({ groupId: "group-a", targetIndex: 3 });
  });

  it("returns no-op for stale, illegal, and same-position drops", () => {
    expect(
      resolve(
        { kind: "tab", tabId: "missing" },
        { kind: "tab", tabId: "tab-a", groupId: "group-a" },
      ),
    ).toBeNull();
    expect(
      resolve(
        { kind: "group", groupId: "group-a" },
        { kind: "group", groupId: "group-a" },
      ),
    ).toBeNull();
    expect(
      resolve(
        { kind: "tab", tabId: "tab-a", groupId: "group-a" },
        { kind: "tab", tabId: "tab-b", groupId: "group-a" },
        "before",
      ),
    ).toBeNull();
  });
});
