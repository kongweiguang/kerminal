// @author kongweiguang

import { describe, expect, it } from "vitest";
import {
  closeTerminalPaneState,
  closeTerminalTabState,
  focusTerminalPaneState,
  moveTerminalPaneState,
  resolveFocusedPaneSplitTarget,
  selectTerminalTabState,
  splitFocusedPaneState,
  updatePaneOutputHistoryState,
  updatePaneStatusState,
  updateTerminalSplitLayoutSizesState,
  type TerminalWorkspaceStateSlice,
} from "../../../../src/features/workspace/workspaceTerminalState";
import type { TerminalPane, TerminalTab } from "../../../../src/features/workspace/types";

function terminalPane(overrides: Partial<TerminalPane> = {}): TerminalPane {
  return {
    id: "pane-ssh-1",
    lines: ["boot", "ready"],
    machineId: "host-lab",
    mode: "ssh",
    prompt: "root@lab:~$",
    remoteHostId: "host-lab",
    status: "online",
    target: { hostId: "host-lab", kind: "ssh" },
    title: "lab server",
    ...overrides,
  };
}

function terminalState(
  overrides: Partial<TerminalWorkspaceStateSlice> = {},
): TerminalWorkspaceStateSlice {
  const pane = terminalPane();
  const tab: TerminalTab = {
    id: "tab-ssh-1",
    layout: { paneId: pane.id, type: "pane" },
    machineId: pane.machineId,
    title: pane.title,
  };

  return {
    activeTabId: tab.id,
    focusedPaneId: pane.id,
    terminalPanes: [pane],
    terminalTabs: [tab],
    ...overrides,
  };
}

describe("workspaceTerminalState split pane", () => {
  it("builds a split patch that focuses the new pane and clears output lines", () => {
    const state = terminalState();

    expect(resolveFocusedPaneSplitTarget(state)).toEqual({
      paneIdPrefix: "pane-ssh",
      sourcePaneId: "pane-ssh-1",
    });

    const patch = splitFocusedPaneState(state, {
      direction: "horizontal",
      paneId: "pane-ssh-2",
      splitId: "split-1",
    });

    expect(patch.focusedPaneId).toBe("pane-ssh-2");
    expect(patch.terminalPanes).toHaveLength(2);
    expect(patch.terminalPanes?.[1]).toMatchObject({
      id: "pane-ssh-2",
      lines: [],
      machineId: "host-lab",
      mode: "ssh",
      remoteHostId: "host-lab",
      target: { hostId: "host-lab", kind: "ssh" },
      title: "lab server",
    });
    expect(patch.terminalTabs?.[0]).toMatchObject({
      id: "tab-ssh-1",
      layout: {
        children: [
          { paneId: "pane-ssh-1", type: "pane" },
          { paneId: "pane-ssh-2", type: "pane" },
        ],
        direction: "horizontal",
        id: "split-1",
        type: "split",
      },
    });
  });

  it("starts the new split pane in the source pane current working directory", () => {
    const state = terminalState({
      terminalPanes: [
        terminalPane({
          currentCwd: "/srv/app",
          cwd: "/home/root",
        }),
      ],
    });

    const patch = splitFocusedPaneState(state, {
      direction: "horizontal",
      paneId: "pane-ssh-2",
      splitId: "split-1",
    });

    expect(patch.terminalPanes?.[1]).toMatchObject({
      currentCwd: "/srv/app",
      cwd: "/srv/app",
    });
  });

  it("keeps inheriting cwd when an explicit split target points at the same host", () => {
    const state = terminalState({
      terminalPanes: [
        terminalPane({
          currentCwd: "/srv/app",
          cwd: "/home/root",
        }),
      ],
    });

    const patch = splitFocusedPaneState(state, {
      direction: "horizontal",
      paneId: "pane-ssh-2",
      splitId: "split-1",
      targetPane: terminalPane({
        id: "pane-ssh-template",
        machineId: "host-lab",
        remoteHostId: "host-lab",
        target: { hostId: "host-lab", kind: "ssh" },
      }),
    });

    expect(patch.terminalPanes?.[1]).toMatchObject({
      currentCwd: "/srv/app",
      cwd: "/srv/app",
      machineId: "host-lab",
    });
  });

  it("uses the target default cwd when an explicit split target is another host", () => {
    const state = terminalState({
      terminalPanes: [
        terminalPane({
          currentCwd: "/dev",
          cwd: "/bwy",
        }),
      ],
    });

    const patch = splitFocusedPaneState(state, {
      direction: "horizontal",
      paneId: "pane-ssh-2",
      splitId: "split-1",
      targetPane: terminalPane({
        cwd: undefined,
        currentCwd: undefined,
        id: "pane-ssh-other-template",
        machineId: "host-other",
        remoteHostId: "host-other",
        target: { hostId: "host-other", kind: "ssh" },
        title: "other server",
      }),
    });

    const splitPane = patch.terminalPanes?.[1];
    expect(splitPane).toMatchObject({
      id: "pane-ssh-2",
      machineId: "host-other",
      remoteHostId: "host-other",
      title: "other server",
    });
    expect(splitPane?.cwd).toBeUndefined();
    expect(splitPane?.currentCwd).toBeUndefined();
  });

  it("keeps pane titles and split prefixes compatible for vertical splits", () => {
    const previewState = terminalState({
      activeTabId: "tab-preview-1",
      focusedPaneId: "pane-preview-1",
      terminalPanes: [
        terminalPane({
          id: "pane-preview-1",
          machineId: "preview-machine",
          mode: "preview",
          remoteHostId: undefined,
          target: undefined,
          title: "Preview",
        }),
      ],
      terminalTabs: [
        {
          id: "tab-preview-1",
          layout: { paneId: "pane-preview-1", type: "pane" },
          machineId: "preview-machine",
          title: "Preview",
        },
      ],
    });

    expect(resolveFocusedPaneSplitTarget(previewState)).toEqual({
      paneIdPrefix: "pane-preview",
      sourcePaneId: "pane-preview-1",
    });
    expect(
      resolveFocusedPaneSplitTarget(
        terminalState({
          activeTabId: "tab-container-1",
          focusedPaneId: "pane-container-1",
          terminalPanes: [
            terminalPane({
              id: "pane-container-1",
              mode: "container",
            }),
          ],
          terminalTabs: [
            {
              id: "tab-container-1",
              layout: { paneId: "pane-container-1", type: "pane" },
              machineId: "container-machine",
              title: "api",
            },
          ],
        }),
      )?.paneIdPrefix,
    ).toBe("pane-container");

    const patch = splitFocusedPaneState(previewState, {
      direction: "vertical",
      paneId: "pane-preview-2",
      splitId: "split-2",
    });

    expect(patch.terminalPanes?.[1]?.title).toBe("Preview");
    expect(patch.terminalTabs?.[0]).toMatchObject({
      layout: {
        direction: "vertical",
        id: "split-2",
        type: "split",
      },
    });
  });

  it("returns no patch when the focused pane cannot be split from the active tab", () => {
    const inactivePane = terminalPane({ id: "pane-ssh-2" });
    const sftpTab: TerminalTab = {
      id: "tab-transfer-1",
      kind: "sftpTransfer",
      machineId: "host-lab",
      rightHostId: "host-lab",
      title: "lab transfer",
    };

    const transferState = terminalState({
      activeTabId: sftpTab.id,
      focusedPaneId: "",
      terminalPanes: [],
      terminalTabs: [sftpTab],
    });
    const staleFocusState = terminalState({
      focusedPaneId: inactivePane.id,
      terminalPanes: [terminalPane(), inactivePane],
    });

    expect(resolveFocusedPaneSplitTarget(transferState)).toBeUndefined();
    expect(
      splitFocusedPaneState(transferState, {
        direction: "horizontal",
        paneId: "pane-ssh-2",
        splitId: "split-1",
      }),
    ).toEqual({});
    expect(resolveFocusedPaneSplitTarget(staleFocusState)).toBeUndefined();
    expect(
      splitFocusedPaneState(staleFocusState, {
        direction: "vertical",
        paneId: "pane-ssh-3",
        splitId: "split-2",
      }),
    ).toEqual({});
  });

  it("updates split layout sizes only on the active terminal tab", () => {
    const state = terminalState({
      terminalPanes: [
        terminalPane({ id: "pane-ssh-1" }),
        terminalPane({ id: "pane-ssh-2" }),
      ],
      terminalTabs: [
        {
          id: "tab-ssh-1",
          layout: {
            children: [
              { paneId: "pane-ssh-1", type: "pane" },
              { paneId: "pane-ssh-2", type: "pane" },
            ],
            direction: "horizontal",
            id: "split-1",
            type: "split",
          },
          machineId: "host-lab",
          title: "lab server",
        },
      ],
    });

    const patch = updateTerminalSplitLayoutSizesState(state, "split-1", {
      "pane-ssh-1": 28.4444,
      "pane-ssh-2": 71.5555,
    });

    expect(patch).toEqual({
      terminalTabs: [
        {
          ...state.terminalTabs[0],
          layout: {
            children: [
              { paneId: "pane-ssh-1", type: "pane" },
              { paneId: "pane-ssh-2", type: "pane" },
            ],
            direction: "horizontal",
            id: "split-1",
            sizes: {
              "pane-ssh-1": 28.444,
              "pane-ssh-2": 71.556,
            },
            type: "split",
          },
        },
      ],
    });
  });
});

describe("workspaceTerminalState move pane", () => {
  it("moves a pane in the active terminal tab without changing pane runtime data", () => {
    const paneA = terminalPane({ id: "pane-ssh-1", title: "A" });
    const paneB = terminalPane({ id: "pane-ssh-2", title: "B" });
    const paneC = terminalPane({ id: "pane-ssh-3", title: "C" });
    const inactiveTab: TerminalTab = {
      id: "tab-ssh-2",
      layout: { paneId: "pane-ssh-3", type: "pane" },
      machineId: "host-lab",
      title: "inactive",
    };
    const state = terminalState({
      focusedPaneId: paneB.id,
      terminalPanes: [paneA, paneB, paneC],
      terminalTabs: [
        {
          id: "tab-ssh-1",
          layout: {
            children: [
              { paneId: paneA.id, type: "pane" },
              {
                type: "split",
                id: "split-nested",
                direction: "vertical",
                children: [
                  { paneId: paneB.id, type: "pane" },
                  { paneId: paneC.id, type: "pane" },
                ],
              },
            ],
            direction: "horizontal",
            id: "split-root",
            type: "split",
          },
          machineId: "host-lab",
          title: "active",
        },
        inactiveTab,
      ],
    });

    const patch = moveTerminalPaneState(state, {
      placement: "right",
      sourcePaneId: paneA.id,
      splitId: "split-move-1",
      targetPaneId: paneB.id,
    });

    expect(patch.focusedPaneId).toBe(paneA.id);
    expect(patch.terminalPanes).toBeUndefined();
    expect(patch.terminalTabs).toEqual([
      {
        ...state.terminalTabs[0],
        layout: {
          type: "split",
          id: "split-nested",
          direction: "vertical",
          children: [
            {
              type: "split",
              id: "split-move-1",
              direction: "horizontal",
              children: [
                { type: "pane", paneId: paneB.id },
                { type: "pane", paneId: paneA.id },
              ],
            },
            { type: "pane", paneId: paneC.id },
          ],
        },
      },
      inactiveTab,
    ]);
  });

  it("returns no patch for invalid pane moves", () => {
    const state = terminalState({
      terminalPanes: [
        terminalPane({ id: "pane-ssh-1" }),
        terminalPane({ id: "pane-ssh-2" }),
      ],
      terminalTabs: [
        {
          id: "tab-ssh-1",
          layout: {
            children: [
              { paneId: "pane-ssh-1", type: "pane" },
              { paneId: "pane-ssh-2", type: "pane" },
            ],
            direction: "horizontal",
            id: "split-1",
            type: "split",
          },
          machineId: "host-lab",
          title: "active",
        },
      ],
    });

    expect(
      moveTerminalPaneState(state, {
        placement: "left",
        sourcePaneId: "pane-ssh-1",
        splitId: "split-move-1",
        targetPaneId: "pane-ssh-1",
      }),
    ).toEqual({});
    expect(
      moveTerminalPaneState(state, {
        placement: "bottom",
        sourcePaneId: "pane-missing",
        splitId: "split-move-1",
        targetPaneId: "pane-ssh-2",
      }),
    ).toEqual({});
    expect(
      moveTerminalPaneState(
        terminalState({
          activeTabId: "tab-transfer-1",
          focusedPaneId: "",
          terminalPanes: [],
          terminalTabs: [
            {
              id: "tab-transfer-1",
              kind: "sftpTransfer",
              machineId: "host-lab",
              rightHostId: "host-lab",
              title: "transfer",
            },
          ],
        }),
        {
          placement: "center",
          sourcePaneId: "pane-ssh-1",
          splitId: "split-move-1",
          targetPaneId: "pane-ssh-2",
        },
      ),
    ).toEqual({});
  });
});

describe("workspaceTerminalState tab and pane focus", () => {
  it("focuses a live pane in the active terminal tab", () => {
    const state = terminalState({
      focusedPaneId: "pane-ssh-1",
      terminalPanes: [
        terminalPane({ id: "pane-ssh-1" }),
        terminalPane({ id: "pane-ssh-2" }),
      ],
      terminalTabs: [
        {
          id: "tab-ssh-1",
          layout: {
            children: [
              { paneId: "pane-ssh-1", type: "pane" },
              { paneId: "pane-ssh-2", type: "pane" },
            ],
            direction: "horizontal",
            id: "split-1",
            type: "split",
          },
          machineId: "host-lab",
          title: "lab server",
        },
      ],
    });

    expect(focusTerminalPaneState(state, "pane-ssh-2")).toEqual({
      focusedPaneId: "pane-ssh-2",
    });
  });

  it("ignores focus requests outside the active tab layout", () => {
    const state = terminalState({
      activeTabId: "tab-ssh-1",
      focusedPaneId: "pane-ssh-1",
      terminalPanes: [
        terminalPane({ id: "pane-ssh-1" }),
        terminalPane({ id: "pane-ssh-2" }),
        terminalPane({ id: "pane-ssh-3" }),
      ],
      terminalTabs: [
        {
          id: "tab-ssh-1",
          layout: {
            children: [
              { paneId: "pane-ssh-1", type: "pane" },
              { paneId: "pane-ssh-2", type: "pane" },
            ],
            direction: "horizontal",
            id: "split-1",
            type: "split",
          },
          machineId: "host-lab",
          title: "lab server",
        },
        {
          id: "tab-ssh-2",
          layout: { paneId: "pane-ssh-3", type: "pane" },
          machineId: "host-lab",
          title: "lab server 2",
        },
      ],
    });

    expect(focusTerminalPaneState(state, "pane-ssh-3")).toBe(state);
    expect(focusTerminalPaneState(state, "pane-missing")).toBe(state);
  });

  it("selects a terminal tab without focusing a missing pane", () => {
    const state = terminalState({
      activeTabId: "tab-ssh-2",
      focusedPaneId: "pane-ssh-2",
      terminalPanes: [
        terminalPane({ id: "pane-ssh-2" }),
        terminalPane({ id: "pane-ssh-3" }),
      ],
      terminalTabs: [
        {
          id: "tab-ssh-1",
          layout: {
            children: [
              { paneId: "pane-missing", type: "pane" },
              { paneId: "pane-ssh-3", type: "pane" },
            ],
            direction: "horizontal",
            id: "split-existing",
            type: "split",
          },
          machineId: "host-lab",
          title: "lab server",
        },
        {
          id: "tab-ssh-2",
          layout: { paneId: "pane-ssh-2", type: "pane" },
          machineId: "host-lab",
          title: "lab server 2",
        },
      ],
    });

    expect(selectTerminalTabState(state, "tab-ssh-1")).toEqual({
      activeTabId: "tab-ssh-1",
      focusedPaneId: "pane-ssh-3",
    });
  });

  it("keeps the focused split pane when closing an inactive tab", () => {
    const state = terminalState({
      focusedPaneId: "pane-ssh-2",
      terminalPanes: [
        terminalPane({ id: "pane-ssh-1" }),
        terminalPane({ id: "pane-ssh-2" }),
        terminalPane({ id: "pane-ssh-3" }),
      ],
      terminalTabs: [
        {
          id: "tab-ssh-1",
          layout: {
            children: [
              { paneId: "pane-ssh-1", type: "pane" },
              { paneId: "pane-ssh-2", type: "pane" },
            ],
            direction: "horizontal",
            id: "split-1",
            type: "split",
          },
          machineId: "host-lab",
          title: "lab server",
        },
        {
          id: "tab-ssh-2",
          layout: { paneId: "pane-ssh-3", type: "pane" },
          machineId: "host-lab",
          title: "lab server 2",
        },
      ],
    });

    expect(closeTerminalTabState(state, "tab-ssh-2")).toMatchObject({
      activeTabId: "tab-ssh-1",
      focusedPaneId: "pane-ssh-2",
    });
  });

  it("selects the right neighbor when closing the active middle tab", () => {
    const state = terminalState({
      activeTabId: "tab-ssh-2",
      focusedPaneId: "pane-ssh-2",
      terminalPanes: [
        terminalPane({ id: "pane-ssh-1" }),
        terminalPane({ id: "pane-ssh-2" }),
        terminalPane({ id: "pane-ssh-3" }),
      ],
      terminalTabs: [
        {
          id: "tab-ssh-1",
          layout: { paneId: "pane-ssh-1", type: "pane" },
          machineId: "host-lab",
          title: "lab server 1",
        },
        {
          id: "tab-ssh-2",
          layout: { paneId: "pane-ssh-2", type: "pane" },
          machineId: "host-lab",
          title: "lab server 2",
        },
        {
          id: "tab-ssh-3",
          layout: { paneId: "pane-ssh-3", type: "pane" },
          machineId: "host-lab",
          title: "lab server 3",
        },
      ],
    });

    expect(closeTerminalTabState(state, "tab-ssh-2")).toMatchObject({
      activeTabId: "tab-ssh-3",
      focusedPaneId: "pane-ssh-3",
    });
  });

  it("does not remove panes outside the active terminal tab", () => {
    const state = terminalState({
      activeTabId: "tab-ssh-1",
      focusedPaneId: "pane-ssh-2",
      terminalPanes: [
        terminalPane({ id: "pane-ssh-1" }),
        terminalPane({ id: "pane-ssh-2" }),
        terminalPane({ id: "pane-ssh-3" }),
      ],
      terminalTabs: [
        {
          id: "tab-ssh-1",
          layout: {
            children: [
              { paneId: "pane-ssh-1", type: "pane" },
              { paneId: "pane-ssh-2", type: "pane" },
            ],
            direction: "horizontal",
            id: "split-1",
            type: "split",
          },
          machineId: "host-lab",
          title: "lab server",
        },
        {
          id: "tab-ssh-2",
          layout: { paneId: "pane-ssh-3", type: "pane" },
          machineId: "host-lab",
          title: "lab server 2",
        },
      ],
    });

    expect(closeTerminalPaneState(state, "pane-ssh-3")).toEqual({});
  });
});

describe("workspaceTerminalState pane status", () => {
  it("updates only the matching terminal pane status", () => {
    const otherPane = terminalPane({
      id: "pane-ssh-2",
      status: "online",
      title: "other",
    });
    const state = terminalState({
      terminalPanes: [terminalPane(), otherPane],
    });

    const patch = updatePaneStatusState(state, "pane-ssh-1", "offline");

    expect(patch).toEqual({
      terminalPanes: [
        { ...state.terminalPanes[0], status: "offline" },
        otherPane,
      ],
    });
  });

  it("returns the same state when the pane status is unchanged or missing", () => {
    const state = terminalState();

    expect(updatePaneStatusState(state, "pane-ssh-1", "online")).toBe(state);
    expect(updatePaneStatusState(state, "pane-missing", "offline")).toBe(state);
  });
});

describe("workspaceTerminalState pane output history", () => {
  it("updates only the matching pane output history snapshot", () => {
    const firstPane = terminalPane({
      id: "pane-ssh-1",
      outputHistory: "old tail",
      title: "first",
    });
    const secondPane = terminalPane({
      id: "pane-ssh-2",
      outputHistory: "other tail",
      title: "second",
    });
    const thirdPane = terminalPane({
      id: "pane-ssh-3",
      outputHistory: undefined,
      title: "third",
    });
    const state = terminalState({
      terminalPanes: [firstPane, secondPane, thirdPane],
    });

    const patch = updatePaneOutputHistoryState(
      state,
      secondPane.id,
      "new cold tail",
    );

    expect(patch).not.toBe(state);
    expect(patch.terminalPanes).toHaveLength(3);
    expect(patch.terminalPanes?.[0]).toBe(firstPane);
    expect(patch.terminalPanes?.[1]).toEqual({
      ...secondPane,
      outputHistory: "new cold tail",
    });
    expect(patch.terminalPanes?.[1]).not.toBe(secondPane);
    expect(patch.terminalPanes?.[2]).toBe(thirdPane);
  });

  it("returns the same state for repeated or missing output snapshots", () => {
    const state = terminalState({
      terminalPanes: [
        terminalPane({
          id: "pane-ssh-1",
          outputHistory: "stable cold tail",
        }),
        terminalPane({
          id: "pane-ssh-2",
          outputHistory: undefined,
        }),
      ],
    });

    expect(
      updatePaneOutputHistoryState(state, "pane-ssh-1", "stable cold tail"),
    ).toBe(state);
    expect(updatePaneOutputHistoryState(state, "pane-ssh-2", undefined)).toBe(
      state,
    );
    expect(
      updatePaneOutputHistoryState(state, "pane-missing", "new tail"),
    ).toBe(state);
  });
});
