// @author kongweiguang

import type { TerminalProfile } from "../../lib/profileApi";
import type { TmuxPaneBinding } from "../../lib/tmuxApi";
import {
  localTarget,
  serialTarget,
  sshTarget,
  telnetTarget,
} from "../../lib/targetModel";
import { collectPaneIds, findFirstPaneId } from "./workspaceLayout";
import { addMachineToGroup, serialPortName } from "./workspaceMachineModel";
import {
  isTerminalSessionTab,
  type LocalMachineScope,
  type Machine,
  type MachineGroup,
  type TerminalPane,
  type TerminalTab,
} from "./types";

export interface TerminalOpenStateSlice {
  activeTabId: string;
  focusedPaneId: string;
  machineGroups: MachineGroup[];
  selectedMachineId: string;
  terminalPanes: TerminalPane[];
  terminalTabs: TerminalTab[];
}

export type TerminalOpenStatePatch = Partial<TerminalOpenStateSlice>;

export interface TerminalOpenIds {
  paneId: string;
  tabId: string;
}

export interface LocalTerminalOpenOptions extends TerminalOpenIds {
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  groupId?: string;
  localMachineScope?: LocalMachineScope;
  machineId: string;
  machineProfileId?: string;
  profile?: TerminalProfile;
  shell?: string;
  tmuxBinding?: TmuxPaneBinding;
  title: string;
}

export interface SshTerminalOpenOptions extends TerminalOpenIds {
  cwd?: string;
  remoteCommand?: string;
  title?: string;
  tmuxBinding?: TmuxPaneBinding;
}

export function focusExistingMachineTabState(
  state: TerminalOpenStateSlice,
  machineId: string,
): TerminalOpenStatePatch | undefined {
  const existingTab = findTabForMachine(state, machineId);
  if (!existingTab) {
    return undefined;
  }

  return {
    activeTabId: existingTab.id,
    focusedPaneId: isTerminalSessionTab(existingTab)
      ? findFirstPaneId(existingTab.layout) ?? state.focusedPaneId
      : "",
    selectedMachineId: machineId,
  };
}

/**
 * 创建本地终端运行态；workspace 范围只建立 pane/tab，避免快速终端被误注册为
 * 可长期管理的侧栏连接，同时保留同一份运行参数供恢复和右栏上下文使用。
 */
export function createLocalTerminalOpenState(
  state: TerminalOpenStateSlice,
  options: LocalTerminalOpenOptions,
): TerminalOpenStatePatch {
  const localMachineScope = options.localMachineScope ?? "sidebar";
  const machineProfileId =
    "machineProfileId" in options ? options.machineProfileId : options.profile?.id;
  const pane: TerminalPane = {
    args: options.args ?? options.profile?.args,
    cwd: options.cwd ?? options.profile?.cwd,
    env: options.env ?? options.profile?.env,
    id: options.paneId,
    localMachineScope,
    profileId: options.profile?.id,
    tmuxBinding: options.tmuxBinding,
    shell: options.shell ?? options.profile?.shell,
    title: options.title,
    machineId: options.machineId,
    mode: "local",
    prompt: "PS>",
    status: "online",
    target: localTarget(options.profile?.id),
    lines: [],
  };
  const tab: TerminalTab = {
    id: options.tabId,
    title: options.title,
    machineId: options.machineId,
    layout: { type: "pane", paneId: options.paneId },
  };
  const machine: Machine = {
    args: pane.args,
    cwd: pane.cwd,
    description: pane.shell ?? options.profile?.shell ?? "本地会话",
    env: pane.env,
    id: options.machineId,
    kind: "local",
    name: options.title,
    profileId: machineProfileId,
    remoteGroupId: options.groupId,
    shell: pane.shell,
    status: "online",
    target: localTarget(machineProfileId),
    tags: ["local"],
  };

  return {
    activeTabId: options.tabId,
    focusedPaneId: options.paneId,
    machineGroups:
      localMachineScope === "workspace"
        ? state.machineGroups
        : addMachineToGroup(state.machineGroups, machine, options.groupId),
    selectedMachineId: machine.id,
    terminalPanes: [...state.terminalPanes, pane],
    terminalTabs: [...state.terminalTabs, tab],
  };
}

export function createSshTerminalOpenState(
  state: TerminalOpenStateSlice,
  machine: Machine | undefined,
  ids: SshTerminalOpenOptions,
): TerminalOpenStatePatch {
  if (!machine || machine.kind !== "ssh") {
    return {};
  }

  const hostLabel = machine.host ?? machine.name;
  const userLabel = machine.username ?? "ssh";
  const pane: TerminalPane = {
    id: ids.paneId,
    cwd: ids.cwd,
    latencyMs: machine.latencyMs,
    lines: [],
    machineId: machine.id,
    mode: "ssh",
    prompt: `${userLabel}@${hostLabel}:~$`,
    remoteCommand: ids.remoteCommand,
    remoteHostId: machine.id,
    status: machine.status,
    target: sshTarget(machine.id),
    title: ids.title ?? machine.name,
    tmuxBinding: ids.tmuxBinding,
  };
  const tab = createTerminalTab(
    ids.tabId,
    machine.id,
    ids.paneId,
    ids.title ?? machine.name,
  );

  return appendTerminalOpenState(state, machine.id, pane, tab, ids);
}

export function createTelnetTerminalOpenState(
  state: TerminalOpenStateSlice,
  machine: Machine | undefined,
  ids: TerminalOpenIds,
): TerminalOpenStatePatch {
  if (!machine || machine.kind !== "telnet") {
    return {};
  }

  const hostLabel = machine.host ?? machine.name;
  const pane: TerminalPane = {
    id: ids.paneId,
    latencyMs: machine.latencyMs,
    lines: [],
    machineId: machine.id,
    mode: "telnet",
    prompt: `${hostLabel}:${machine.port ?? 23}>`,
    status: machine.status,
    target: telnetTarget(machine.id),
    title: machine.name,
  };
  const tab = createTerminalTab(ids.tabId, machine.id, ids.paneId, machine.name);

  return appendTerminalOpenState(state, machine.id, pane, tab, ids);
}

export function createSerialTerminalOpenState(
  state: TerminalOpenStateSlice,
  machine: Machine | undefined,
  ids: TerminalOpenIds,
): TerminalOpenStatePatch {
  if (!machine || machine.kind !== "serial") {
    return {};
  }

  const serialPort = serialPortName(machine.tags) ?? machine.host ?? machine.name;
  const pane: TerminalPane = {
    id: ids.paneId,
    latencyMs: machine.latencyMs,
    lines: [],
    machineId: machine.id,
    mode: "serial",
    prompt: `${serialPort}>`,
    status: machine.status,
    target: serialTarget(machine.id),
    title: machine.name,
  };
  const tab = createTerminalTab(ids.tabId, machine.id, ids.paneId, machine.name);

  return appendTerminalOpenState(state, machine.id, pane, tab, ids);
}

export function createContainerTerminalOpenState(
  state: TerminalOpenStateSlice,
  machine: Machine | undefined,
  ids: TerminalOpenIds,
): TerminalOpenStatePatch {
  if (!machine || machine.kind !== "dockerContainer" || !machine.target) {
    return {};
  }

  const pane: TerminalPane = {
    containerId: machine.containerId,
    id: ids.paneId,
    lines: [],
    machineId: machine.id,
    mode: "container",
    prompt: `${machine.name}:/$`,
    remoteHostId: machine.parentMachineId,
    shell: machine.shell,
    status: machine.status,
    target: machine.target,
    title: machine.name,
  };
  const tab = createTerminalTab(ids.tabId, machine.id, ids.paneId, machine.name);

  return appendTerminalOpenState(state, machine.id, pane, tab, ids);
}

export function syncContainerTerminalOpenState(
  state: TerminalOpenStateSlice,
  machine: Machine,
): TerminalOpenStatePatch | TerminalOpenStateSlice {
  if (machine.kind !== "dockerContainer" || !machine.target) {
    return state;
  }

  let changed = false;
  const panesById = new Map(state.terminalPanes.map((pane) => [pane.id, pane]));
  const terminalPanes = state.terminalPanes.map((pane) => {
    if (pane.mode !== "container" || pane.machineId !== machine.id) {
      return pane;
    }

    const target = containerTargetForOpenPane(pane, machine);
    const nextPane: TerminalPane = {
      ...pane,
      containerId: machine.containerId,
      prompt: `${machine.name}:/$`,
      remoteHostId: machine.parentMachineId,
      status: machine.status,
      target,
      title: machine.name,
    };

    if (isSameContainerPane(pane, nextPane)) {
      return pane;
    }
    changed = true;
    return nextPane;
  });

  const terminalTabs = state.terminalTabs.map((tab) => {
    if (
      !isTerminalSessionTab(tab) ||
      tab.machineId !== machine.id
    ) {
      return tab;
    }
    const oldPaneTitle = panesById.get(findFirstPaneId(tab.layout) ?? "")?.title;
    if (tab.title !== oldPaneTitle || tab.title === machine.name) {
      return tab;
    }
    changed = true;
    return { ...tab, title: machine.name };
  });

  return changed ? { terminalPanes, terminalTabs } : state;
}

function appendTerminalOpenState(
  state: TerminalOpenStateSlice,
  selectedMachineId: string,
  pane: TerminalPane,
  tab: TerminalTab,
  ids: TerminalOpenIds,
): TerminalOpenStatePatch {
  return {
    activeTabId: ids.tabId,
    focusedPaneId: ids.paneId,
    selectedMachineId,
    terminalPanes: [...state.terminalPanes, pane],
    terminalTabs: [...state.terminalTabs, tab],
  };
}

function createTerminalTab(
  tabId: string,
  machineId: string,
  paneId: string,
  title: string,
): TerminalTab {
  return {
    id: tabId,
    layout: { type: "pane", paneId },
    machineId,
    title,
  };
}

function findTabForMachine(
  state: TerminalOpenStateSlice,
  machineId: string,
): TerminalTab | undefined {
  const panesById = new Map(state.terminalPanes.map((pane) => [pane.id, pane]));
  return state.terminalTabs.find((tab) => {
    if (tab.machineId === machineId) {
      return true;
    }
    if (!isTerminalSessionTab(tab)) {
      return false;
    }
    return collectPaneIds(tab.layout).some((paneId) => {
      const pane = panesById.get(paneId);
      return pane?.machineId === machineId || pane?.remoteHostId === machineId;
    });
  });
}

function containerTargetForOpenPane(
  pane: TerminalPane,
  machine: Machine,
): TerminalPane["target"] {
  if (machine.target?.kind !== "dockerContainer") {
    return pane.target;
  }

  const paneTarget = pane.target?.kind === "dockerContainer" ? pane.target : undefined;
  return {
    containerId: machine.target.containerId,
    containerName: machine.target.containerName,
    hostId: machine.target.hostId,
    kind: "dockerContainer",
    runtime: machine.target.runtime,
    ...(paneTarget?.user ? { user: paneTarget.user } : {}),
    ...(paneTarget?.workdir ? { workdir: paneTarget.workdir } : {}),
  };
}

function isSameContainerPane(left: TerminalPane, right: TerminalPane) {
  return (
    left.containerId === right.containerId &&
    left.prompt === right.prompt &&
    left.remoteHostId === right.remoteHostId &&
    left.status === right.status &&
    left.title === right.title &&
    isSameContainerTarget(left.target, right.target)
  );
}

function isSameContainerTarget(
  left: TerminalPane["target"],
  right: TerminalPane["target"],
) {
  if (left?.kind !== "dockerContainer" || right?.kind !== "dockerContainer") {
    return left === right;
  }
  return (
    left.containerId === right.containerId &&
    left.containerName === right.containerName &&
    left.hostId === right.hostId &&
    left.runtime === right.runtime &&
    left.user === right.user &&
    left.workdir === right.workdir
  );
}
