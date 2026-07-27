// @author kongweiguang

import {
  collectPaneIds,
  findFirstPaneId,
  movePaneInLayout,
  removePaneFromLayout,
  splitPaneInLayout,
  updateSplitLayoutSizes,
  type MovePaneInLayoutCommand,
} from "./workspaceLayout";
import {
  localTarget,
  serialTarget,
  sshTarget,
  telnetTarget,
  targetStableId,
} from "../../lib/targetModel";
import {
  isTerminalSessionTab,
  type Machine,
  type MachineStatus,
  type TerminalPane,
  type TerminalSplitDirection,
  type TerminalSplitLayoutSizes,
  type TerminalSplitPlacement,
  type TerminalTab,
} from "./types";

export interface TerminalWorkspaceStateSlice {
  activeTabId: string;
  focusedPaneId: string;
  terminalPanes: TerminalPane[];
  terminalTabs: TerminalTab[];
}

type TerminalWorkspaceStatePatch = Partial<TerminalWorkspaceStateSlice>;

export interface FocusedPaneSplitTarget {
  paneIdPrefix: string;
  sourcePaneId: string;
}

export interface SplitFocusedPaneCommand {
  direction: TerminalSplitDirection;
  paneId: string;
  placement?: TerminalSplitPlacement;
  sourcePaneId?: string;
  splitId: string;
  targetPane?: TerminalPane;
}

export type MoveTerminalPaneCommand = MovePaneInLayoutCommand;

export function selectTerminalTabState(
  state: TerminalWorkspaceStateSlice,
  activeTabId: string,
): TerminalWorkspaceStatePatch {
  const activeTab = state.terminalTabs.find((tab) => tab.id === activeTabId);
  if (!activeTab) {
    return {};
  }

  const focusedPaneId = isTerminalSessionTab(activeTab)
    ? resolveFocusForTerminalTab(state, activeTab)
    : "";
  return { activeTabId, focusedPaneId };
}

export function closeTerminalTabState(
  state: TerminalWorkspaceStateSlice,
  tabId: string,
): TerminalWorkspaceStatePatch {
  const tab = state.terminalTabs.find((item) => item.id === tabId);
  if (!tab) {
    return {};
  }

  const paneIds = isTerminalSessionTab(tab) ? collectPaneIds(tab.layout) : [];
  const terminalTabs = state.terminalTabs.filter((item) => item.id !== tabId);
  const terminalPanes = state.terminalPanes.filter(
    (pane) => !paneIds.includes(pane.id),
  );
  const nextActiveTab =
    state.activeTabId === tabId
      ? terminalTabs[0]
      : terminalTabs.find((item) => item.id === state.activeTabId);
  const focusedPaneId =
    nextActiveTab && isTerminalSessionTab(nextActiveTab)
      ? resolveFocusForTerminalTab(
          { ...state, terminalPanes, terminalTabs },
          nextActiveTab,
        )
      : "";

  return {
    activeTabId: nextActiveTab?.id ?? "",
    focusedPaneId,
    terminalPanes,
    terminalTabs,
  };
}

export function closeTerminalPaneState(
  state: TerminalWorkspaceStateSlice,
  paneId: string,
): TerminalWorkspaceStatePatch {
  const activeTab = state.terminalTabs.find(
    (tab) => tab.id === state.activeTabId,
  );
  if (!activeTab || !isTerminalSessionTab(activeTab)) {
    return {};
  }

  const activePaneIds = collectPaneIds(activeTab.layout);
  if (activePaneIds.length <= 1 || !activePaneIds.includes(paneId)) {
    return {};
  }

  const nextLayout = removePaneFromLayout(activeTab.layout, paneId);
  if (!nextLayout) {
    return {};
  }

  const terminalTabs = state.terminalTabs.map((tab) =>
    tab.id === activeTab.id && isTerminalSessionTab(tab)
      ? { ...tab, layout: nextLayout }
      : tab,
  );
  const terminalPanes = state.terminalPanes.filter(
    (pane) => pane.id !== paneId,
  );
  const focusedPaneId =
    paneId === state.focusedPaneId
      ? (findFirstPaneId(nextLayout) ?? state.focusedPaneId)
      : state.focusedPaneId;

  return { focusedPaneId, terminalPanes, terminalTabs };
}

export function focusTerminalPaneState(
  state: TerminalWorkspaceStateSlice,
  focusedPaneId: string,
): TerminalWorkspaceStatePatch | TerminalWorkspaceStateSlice {
  if (state.focusedPaneId === focusedPaneId) {
    return state;
  }

  const activeTab = state.terminalTabs.find(
    (tab) => tab.id === state.activeTabId,
  );
  if (!activeTab || !isTerminalSessionTab(activeTab)) {
    return state;
  }

  const livePaneIds = new Set(state.terminalPanes.map((pane) => pane.id));
  const activePaneIds = collectPaneIds(activeTab.layout);
  if (
    !activePaneIds.includes(focusedPaneId) ||
    !livePaneIds.has(focusedPaneId)
  ) {
    return state;
  }

  return { focusedPaneId };
}

export function resolveFocusedPaneSplitTarget(
  state: TerminalWorkspaceStateSlice,
  sourcePaneId = state.focusedPaneId,
): FocusedPaneSplitTarget | undefined {
  const activeTab = state.terminalTabs.find(
    (tab) => tab.id === state.activeTabId,
  );
  const sourcePane = state.terminalPanes.find(
    (pane) => pane.id === sourcePaneId,
  );
  if (
    !activeTab ||
    !isTerminalSessionTab(activeTab) ||
    !sourcePane ||
    !collectPaneIds(activeTab.layout).includes(sourcePane.id)
  ) {
    return undefined;
  }

  return {
    paneIdPrefix: paneIdPrefixForSplitMode(sourcePane.mode),
    sourcePaneId: sourcePane.id,
  };
}

export function splitFocusedPaneState(
  state: TerminalWorkspaceStateSlice,
  command: SplitFocusedPaneCommand,
): TerminalWorkspaceStatePatch {
  const activeTab = state.terminalTabs.find(
    (tab) => tab.id === state.activeTabId,
  );
  const sourcePane = state.terminalPanes.find(
    (pane) => pane.id === (command.sourcePaneId ?? state.focusedPaneId),
  );
  if (
    !activeTab ||
    !isTerminalSessionTab(activeTab) ||
    !sourcePane ||
    !collectPaneIds(activeTab.layout).includes(sourcePane.id)
  ) {
    return {};
  }

  const paneTemplate = command.targetPane ?? sourcePane;
  const currentCwd = splitPaneInitialCwd(sourcePane, command.targetPane);
  const newPane: TerminalPane = {
    ...paneTemplate,
    cwd: currentCwd,
    currentCwd,
    id: command.paneId,
    lines: [],
    outputHistory: undefined,
    title: paneTemplate.title,
  };
  const terminalTabs = state.terminalTabs.map((tab) =>
    tab.id === activeTab.id && isTerminalSessionTab(tab)
      ? {
          ...tab,
          layout: splitPaneInLayout(
            activeTab.layout,
            sourcePane.id,
            command.paneId,
            command.direction,
            command.splitId,
            command.placement,
          ),
        }
      : tab,
  );

  return {
    focusedPaneId: command.paneId,
    terminalPanes: [...state.terminalPanes, newPane],
    terminalTabs,
  };
}

export function moveTerminalPaneState(
  state: TerminalWorkspaceStateSlice,
  command: MoveTerminalPaneCommand,
): TerminalWorkspaceStatePatch {
  const activeTab = state.terminalTabs.find(
    (tab) => tab.id === state.activeTabId,
  );
  if (!activeTab || !isTerminalSessionTab(activeTab)) {
    return {};
  }

  const livePaneIds = new Set(state.terminalPanes.map((pane) => pane.id));
  const activePaneIds = collectPaneIds(activeTab.layout);
  if (
    activePaneIds.length <= 1 ||
    command.sourcePaneId === command.targetPaneId ||
    !activePaneIds.includes(command.sourcePaneId) ||
    !activePaneIds.includes(command.targetPaneId) ||
    !livePaneIds.has(command.sourcePaneId) ||
    !livePaneIds.has(command.targetPaneId)
  ) {
    return {};
  }

  const nextLayout = movePaneInLayout(activeTab.layout, command);
  if (nextLayout === activeTab.layout) {
    return {};
  }

  return {
    focusedPaneId: command.sourcePaneId,
    terminalTabs: state.terminalTabs.map((tab) =>
      tab.id === activeTab.id && isTerminalSessionTab(tab)
        ? { ...tab, layout: nextLayout }
        : tab,
    ),
  };
}

export function updateTerminalSplitLayoutSizesState(
  state: TerminalWorkspaceStateSlice,
  splitId: string,
  sizes: TerminalSplitLayoutSizes,
): TerminalWorkspaceStatePatch | TerminalWorkspaceStateSlice {
  const activeTab = state.terminalTabs.find(
    (tab) => tab.id === state.activeTabId,
  );
  if (!activeTab || !isTerminalSessionTab(activeTab)) {
    return state;
  }

  const nextLayout = updateSplitLayoutSizes(activeTab.layout, splitId, sizes);
  if (nextLayout === activeTab.layout) {
    return state;
  }

  return {
    terminalTabs: state.terminalTabs.map((tab) =>
      tab.id === activeTab.id && isTerminalSessionTab(tab)
        ? { ...tab, layout: nextLayout }
        : tab,
    ),
  };
}

export function paneIdPrefixForSplitMachine(
  machine: Machine,
): string | undefined {
  const mode = terminalPaneModeForMachine(machine);
  return mode ? paneIdPrefixForSplitMode(mode) : undefined;
}

export function splitTargetPaneForMachine(
  machine: Machine,
  paneId: string,
): TerminalPane | undefined {
  if (machine.kind === "local") {
    return {
      args: machine.args,
      cwd: machine.cwd,
      env: machine.env,
      id: paneId,
      lines: [],
      machineId: machine.id,
      mode: "local",
      profileId: machine.profileId,
      prompt: "PS>",
      shell: machine.shell,
      status: "online",
      target: localTarget(machine.profileId),
      title: machine.name,
    };
  }

  if (machine.kind === "ssh") {
    const hostLabel = machine.host ?? machine.name;
    const userLabel = machine.username ?? "ssh";
    return {
      id: paneId,
      latencyMs: machine.latencyMs,
      lines: [],
      machineId: machine.id,
      mode: "ssh",
      prompt: `${userLabel}@${hostLabel}:~$`,
      remoteHostId: machine.id,
      remoteHostProduction: machine.production ?? false,
      status: machine.status,
      target:
        machine.target?.kind === "ssh" ? machine.target : sshTarget(machine.id),
      title: machine.name,
    };
  }

  if (machine.kind === "telnet") {
    const hostLabel = machine.host ?? machine.name;
    return {
      id: paneId,
      latencyMs: machine.latencyMs,
      lines: [],
      machineId: machine.id,
      mode: "telnet",
      prompt: `${hostLabel}:${machine.port ?? 23}>`,
      remoteHostProduction: machine.production ?? false,
      status: machine.status,
      target:
        machine.target?.kind === "telnet"
          ? machine.target
          : telnetTarget(machine.id),
      title: machine.name,
    };
  }

  if (machine.kind === "serial") {
    const serialPort =
      serialPortName(machine.tags) ?? machine.host ?? machine.name;
    return {
      id: paneId,
      latencyMs: machine.latencyMs,
      lines: [],
      machineId: machine.id,
      mode: "serial",
      prompt: `${serialPort}>`,
      remoteHostProduction: machine.production ?? false,
      status: machine.status,
      target:
        machine.target?.kind === "serial"
          ? machine.target
          : serialTarget(machine.id),
      title: machine.name,
    };
  }

  if (machine.kind === "dockerContainer" && machine.target) {
    return {
      containerId: machine.containerId,
      id: paneId,
      lines: [],
      machineId: machine.id,
      mode: "container",
      prompt: `${machine.name}:/$`,
      remoteHostId: machine.parentMachineId,
      remoteHostProduction: machine.production ?? false,
      shell: machine.shell,
      status: machine.status,
      target: machine.target,
      title: machine.name,
    };
  }

  return undefined;
}

export function updatePaneCurrentCwdState(
  state: TerminalWorkspaceStateSlice,
  paneId: string,
  currentCwd: string,
): TerminalWorkspaceStatePatch | TerminalWorkspaceStateSlice {
  const targetPane = state.terminalPanes.find((pane) => pane.id === paneId);
  if (!targetPane || targetPane.currentCwd === currentCwd) {
    return state;
  }

  return {
    terminalPanes: state.terminalPanes.map((pane) =>
      pane.id === paneId ? { ...pane, currentCwd } : pane,
    ),
  };
}

export function updatePaneOutputHistoryState(
  state: TerminalWorkspaceStateSlice,
  paneId: string,
  outputHistory: string | undefined,
): TerminalWorkspaceStatePatch | TerminalWorkspaceStateSlice {
  const targetPaneIndex = state.terminalPanes.findIndex(
    (pane) => pane.id === paneId,
  );
  const targetPane = state.terminalPanes[targetPaneIndex];
  if (!targetPane || targetPane.outputHistory === outputHistory) {
    return state;
  }

  const terminalPanes = [...state.terminalPanes];
  terminalPanes[targetPaneIndex] = { ...targetPane, outputHistory };

  return {
    terminalPanes,
  };
}

export function updatePaneStatusState(
  state: TerminalWorkspaceStateSlice,
  paneId: string,
  status: MachineStatus,
): TerminalWorkspaceStatePatch | TerminalWorkspaceStateSlice {
  const targetPane = state.terminalPanes.find((pane) => pane.id === paneId);
  if (!targetPane || targetPane.status === status) {
    return state;
  }

  return {
    terminalPanes: state.terminalPanes.map((pane) =>
      pane.id === paneId ? { ...pane, status } : pane,
    ),
  };
}

function paneIdPrefixForSplitMode(mode: TerminalPane["mode"]): string {
  switch (mode) {
    case "ssh":
      return "pane-ssh";
    case "telnet":
      return "pane-telnet";
    case "serial":
      return "pane-serial";
    case "container":
      return "pane-container";
    case "preview":
      return "pane-preview";
    default:
      return "pane-local";
  }
}

function splitPaneInitialCwd(
  sourcePane: TerminalPane,
  targetPane: TerminalPane | undefined,
) {
  const sourceCwd = sourcePane.currentCwd ?? sourcePane.cwd;
  if (!targetPane || isSameSplitTarget(sourcePane, targetPane)) {
    return sourceCwd ?? targetPane?.currentCwd ?? targetPane?.cwd;
  }
  return targetPane.currentCwd ?? targetPane.cwd;
}

function isSameSplitTarget(left: TerminalPane, right: TerminalPane) {
  return terminalPaneTargetKey(left) === terminalPaneTargetKey(right);
}

function terminalPaneTargetKey(pane: TerminalPane) {
  if (pane.mode === "local") {
    return `local:${pane.profileId ?? pane.machineId}`;
  }
  if (pane.target) {
    return targetStableId(pane.target);
  }
  if (pane.mode === "ssh") {
    return `ssh:${pane.remoteHostId ?? pane.machineId}`;
  }
  if (pane.mode === "telnet" || pane.mode === "serial") {
    return `${pane.mode}:${pane.remoteHostId ?? pane.machineId}`;
  }
  if (pane.mode === "container") {
    return `container:${pane.remoteHostId ?? ""}:${pane.containerId ?? pane.machineId}`;
  }
  return `${pane.mode}:${pane.machineId}`;
}

function terminalPaneModeForMachine(
  machine: Machine,
): TerminalPane["mode"] | undefined {
  if (
    machine.kind === "local" ||
    machine.kind === "ssh" ||
    machine.kind === "telnet" ||
    machine.kind === "serial"
  ) {
    return machine.kind;
  }
  if (machine.kind === "dockerContainer") {
    return "container";
  }
  return undefined;
}

function serialPortName(tags: string[]) {
  const prefix = "serial-port:";
  const tag = tags.find((candidate) => candidate.startsWith(prefix));
  const port = tag?.slice(prefix.length).trim();
  return port || undefined;
}

function resolveFocusForTerminalTab(
  state: TerminalWorkspaceStateSlice,
  tab: TerminalTab,
): string {
  if (!isTerminalSessionTab(tab)) {
    return "";
  }

  const livePaneIds = new Set(state.terminalPanes.map((pane) => pane.id));
  const layoutPaneIds = collectPaneIds(tab.layout).filter((paneId) =>
    livePaneIds.has(paneId),
  );
  if (layoutPaneIds.includes(state.focusedPaneId)) {
    return state.focusedPaneId;
  }

  return layoutPaneIds[0] ?? "";
}
