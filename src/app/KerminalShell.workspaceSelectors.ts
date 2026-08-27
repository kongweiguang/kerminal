// @author kongweiguang

import type {
  Machine,
  MachineGroup,
  TerminalPane,
  TerminalTab,
  WorkspaceFileDirtyState,
  WorkspaceFileRevealRequest,
} from "../features/workspace/types";
import { isTerminalSessionTab } from "../features/workspace/types";
import type { WorkspaceState } from "../features/workspace/workspaceStore";
import { buildWorkspaceContextProjection } from "../features/workspace/context";
import type { WorkspaceContextProjection } from "../features/workspace/context";
import {
  resolveWorkspaceTabPaneSelection,
  resolveWorkspaceTargetSelection,
} from "../features/workspace/workspaceTargetSelection";

interface OpenMachineState {
  terminalPanes: TerminalPane[];
  terminalTabs: TerminalTab[];
}

export interface ToolPanelWorkspaceContext {
  activeMachine?: Machine;
  activeTab?: TerminalTab;
  focusedPane?: TerminalPane;
  selectedMachine?: Machine;
  sftpRevealRequest: WorkspaceFileRevealRequest | null;
  terminalPanes: TerminalPane[];
  terminalTabs: TerminalTab[];
  projection: WorkspaceContextProjection;
}

export interface TerminalWorkspaceSnapshot {
  activeTabId: string;
  broadcastDraft: string;
  focusedPaneId: string;
  terminalPanes: TerminalPane[];
  terminalTabs: TerminalTab[];
  terminalTabGroups: WorkspaceState["terminalTabGroups"];
  terminalTabGroupPreferences: WorkspaceState["terminalTabGroupPreferences"];
  workspaceFileDirtyState: WorkspaceFileDirtyState;
}

interface ParsedTerminalWorkspaceSnapshotCache {
  groupsSnapshot: string;
  panesSnapshot: string;
  preferencesSnapshot: string;
  snapshot: string;
  tabsSnapshot: string;
  value: TerminalWorkspaceSnapshot;
}

let parsedTerminalWorkspaceSnapshotCache:
  ParsedTerminalWorkspaceSnapshotCache | undefined;

function collectOpenMachineIds({
  terminalPanes,
  terminalTabs,
}: OpenMachineState): string[] {
  const ids = new Set<string>();
  for (const tab of terminalTabs) {
    if (isTerminalSessionTab(tab)) {
      ids.add(tab.machineId);
    }
  }
  for (const pane of terminalPanes) {
    ids.add(pane.machineId);
    if (pane.remoteHostId) {
      ids.add(pane.remoteHostId);
    }
  }
  return [...ids];
}

export function buildOpenMachineIdsSnapshot(state: OpenMachineState): string {
  return JSON.stringify(collectOpenMachineIds(state));
}

export function parseOpenMachineIdsSnapshot(snapshot: string): string[] {
  return JSON.parse(snapshot) as string[];
}

export function buildToolPanelWorkspaceSnapshot(state: WorkspaceState): string {
  const { activeTab, focusedPane } = resolveWorkspaceTabPaneSelection({
    activeTabId: state.activeTabId,
    focusedPaneId: state.focusedPaneId,
    terminalPanes: state.terminalPanes,
    terminalTabs: state.terminalTabs,
  });

  return JSON.stringify({
    activeTabId: activeTab?.id ?? "",
    focusedPane: focusedPane
      ? terminalPaneWithoutHighFrequencyOutput(focusedPane)
      : null,
    focusedPaneId: focusedPane?.id ?? "",
    selectedMachineId: state.selectedMachineId,
    sftpRevealRequest: state.workspaceFileRevealRequest,
    terminalPanes: state.terminalPanes.map(
      terminalPaneWithoutHighFrequencyOutput,
    ),
    terminalTabs: state.terminalTabs,
  });
}

export function buildTerminalWorkspaceSnapshot(state: WorkspaceState): string {
  return JSON.stringify({
    activeTabId: state.activeTabId,
    broadcastDraft: state.broadcastDraft,
    focusedPaneId: state.focusedPaneId,
    terminalPanes: state.terminalPanes.map(
      terminalPaneWithoutHighFrequencyOutput,
    ),
    terminalTabs: state.terminalTabs,
    terminalTabGroups: state.terminalTabGroups,
    terminalTabGroupPreferences: state.terminalTabGroupPreferences,
    workspaceFileDirtyState: state.workspaceFileDirtyState,
  } satisfies TerminalWorkspaceSnapshot);
}

export function parseTerminalWorkspaceSnapshot(
  snapshot: string,
): TerminalWorkspaceSnapshot {
  if (parsedTerminalWorkspaceSnapshotCache?.snapshot === snapshot) {
    return parsedTerminalWorkspaceSnapshotCache.value;
  }

  const next = JSON.parse(snapshot) as TerminalWorkspaceSnapshot;
  const panesSnapshot = JSON.stringify(next.terminalPanes);
  const tabsSnapshot = JSON.stringify(next.terminalTabs);
  const groupsSnapshot = JSON.stringify(next.terminalTabGroups);
  const preferencesSnapshot = JSON.stringify(next.terminalTabGroupPreferences);
  const previous = parsedTerminalWorkspaceSnapshotCache;

  if (previous && previous.panesSnapshot === panesSnapshot) {
    next.terminalPanes = previous.value.terminalPanes;
  }
  if (previous && previous.tabsSnapshot === tabsSnapshot) {
    next.terminalTabs = previous.value.terminalTabs;
  }
  if (previous && previous.groupsSnapshot === groupsSnapshot) {
    next.terminalTabGroups = previous.value.terminalTabGroups;
  }
  if (previous && previous.preferencesSnapshot === preferencesSnapshot) {
    next.terminalTabGroupPreferences =
      previous.value.terminalTabGroupPreferences;
  }

  parsedTerminalWorkspaceSnapshotCache = {
    panesSnapshot,
    groupsSnapshot,
    preferencesSnapshot,
    snapshot,
    tabsSnapshot,
    value: next,
  };

  return next;
}

export function buildToolPanelWorkspaceContext(
  state: WorkspaceState,
  machineGroups: MachineGroup[],
): ToolPanelWorkspaceContext {
  const {
    activeMachine,
    activeTab,
    focusedPane,
    selectedMachine,
  } = resolveWorkspaceTargetSelection({
    activeTabId: state.activeTabId,
    focusedPaneId: state.focusedPaneId,
    machineGroups,
    selectedMachineId: state.selectedMachineId,
    terminalPanes: state.terminalPanes,
    terminalTabs: state.terminalTabs,
  });

  return {
    activeMachine,
    activeTab,
    focusedPane,
    selectedMachine,
    sftpRevealRequest: state.workspaceFileRevealRequest,
    terminalPanes: state.terminalPanes.map(
      terminalPaneWithoutHighFrequencyOutput,
    ),
    terminalTabs: state.terminalTabs,
    projection: buildWorkspaceContextProjection({
      activeTabId: state.activeTabId,
      focusedPaneId: state.focusedPaneId,
      generatedAt: new Date().toISOString(),
      machineGroups,
      revision: workspaceContextRevision(state),
      selectedMachineId: state.selectedMachineId,
      terminalPanes: state.terminalPanes,
      terminalTabs: state.terminalTabs,
      workspaceFileDirtyState: state.workspaceFileDirtyState,
      workspaceFileRevealRequest: state.workspaceFileRevealRequest,
    }),
  };
}

function workspaceContextRevision(state: WorkspaceState): number {
  const snapshot = buildToolPanelWorkspaceSnapshot(state);
  let hash = 2166136261;
  for (let index = 0; index < snapshot.length; index += 1) {
    hash ^= snapshot.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function terminalPaneWithoutHighFrequencyOutput(pane: TerminalPane) {
  const { lines: _lines, outputHistory: _outputHistory, ...stablePane } = pane;
  return {
    ...stablePane,
    lines: [],
  };
}
