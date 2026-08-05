// @author kongweiguang

import { localTarget } from "../../lib/targetModel";
import type { TmuxAttachLaunch, TmuxPaneBinding } from "../../lib/tmuxApi";
import { collectPaneIds } from "./workspaceLayout";
import { findMachine } from "./workspaceMachineModel";
import {
  createLocalTerminalOpenState,
  createSshTerminalOpenState,
} from "./workspaceTerminalOpenState";
import {
  resolveFocusedPaneSplitTarget,
  splitFocusedPaneState,
} from "./workspaceTerminalState";
import type { MachineGroup, TerminalPane, TerminalTab } from "./types";
import { isTerminalSessionTab } from "./types";

interface TmuxWorkspaceStateSlice {
  activeTabId: string;
  focusedPaneId: string;
  machineGroups: MachineGroup[];
  selectedMachineId: string;
  terminalPanes: TerminalPane[];
  terminalTabs: TerminalTab[];
}

type TmuxWorkspaceStatePatch = Partial<TmuxWorkspaceStateSlice>;

export interface OpenTmuxAttachTerminalCommand {
  launch: TmuxAttachLaunch;
  nextLocalMachineId: string;
  nextPaneId: string;
  nextSplitId: string;
  nextTabId: string;
  placement: "pane" | "tab";
}

export interface OpenTmuxAttachTerminalResult {
  consumedPane: boolean;
  consumedSplit: boolean;
  consumedTab: boolean;
  patch: TmuxWorkspaceStatePatch;
}

export function openTmuxAttachTerminalState(
  state: TmuxWorkspaceStateSlice,
  command: OpenTmuxAttachTerminalCommand,
): OpenTmuxAttachTerminalResult {
  const existing = focusExistingTmuxAttachState(state, command.launch.binding);
  if (existing) {
    return emptyConsumption(existing);
  }

  if (command.placement === "pane") {
    const splitPane = buildTmuxSplitPane(
      state,
      command.launch,
      command.nextPaneId,
    );
    const splitTarget = splitPane ? resolveFocusedPaneSplitTarget(state) : undefined;
    if (splitPane && splitTarget) {
      const splitPatch = splitFocusedPaneState(state, {
        direction: "horizontal",
        paneId: splitPane.id,
        sourcePaneId: splitTarget.sourcePaneId,
        splitId: command.nextSplitId,
        targetPane: splitPane,
      });
      return {
        consumedPane: true,
        consumedSplit: true,
        consumedTab: false,
        patch:
          "focusedPaneId" in splitPatch
            ? { ...splitPatch, selectedMachineId: splitPane.machineId }
            : splitPatch,
      };
    }
  }

  if (command.launch.mode === "ssh") {
    const machine = findMachine(state.machineGroups, command.launch.hostId);
    if (!machine || machine.kind !== "ssh") {
      return emptyConsumption({});
    }
    return {
      consumedPane: true,
      consumedSplit: false,
      consumedTab: true,
      patch: createSshTerminalOpenState(state, machine, {
        cwd: command.launch.cwd,
        paneId: command.nextPaneId,
        remoteCommand: command.launch.remoteCommand,
        tabId: command.nextTabId,
        title: command.launch.title,
        tmuxBinding: command.launch.binding,
      }),
    };
  }

  return {
    consumedPane: true,
    consumedSplit: false,
    consumedTab: true,
    patch: createLocalTerminalOpenState(state, {
      args: command.launch.terminal.args,
      cwd: command.launch.terminal.cwd,
      env: command.launch.terminal.env,
      machineId: command.nextLocalMachineId,
      paneId: command.nextPaneId,
      shell: command.launch.terminal.shell,
      tabId: command.nextTabId,
      title: command.launch.title,
      tmuxBinding: command.launch.binding,
    }),
  };
}

function focusExistingTmuxAttachState(
  state: TmuxWorkspaceStateSlice,
  binding: TmuxPaneBinding,
): TmuxWorkspaceStatePatch | undefined {
  const existingPane = state.terminalPanes.find((pane) =>
    tmuxPaneBindingMatches(pane.tmuxBinding, binding),
  );
  if (!existingPane) {
    return undefined;
  }

  const existingTab = state.terminalTabs.find(
    (tab) =>
      isTerminalSessionTab(tab) &&
      collectPaneIds(tab.layout).includes(existingPane.id),
  );
  if (!existingTab) {
    return { focusedPaneId: existingPane.id };
  }

  return {
    activeTabId: existingTab.id,
    focusedPaneId: existingPane.id,
    selectedMachineId: existingPane.machineId,
  };
}

function buildTmuxSplitPane(
  state: TmuxWorkspaceStateSlice,
  launch: TmuxAttachLaunch,
  paneId: string,
): TerminalPane | undefined {
  if (launch.mode === "ssh") {
    const machine = findMachine(state.machineGroups, launch.hostId);
    if (!machine || machine.kind !== "ssh") {
      return undefined;
    }
    const hostLabel = machine.host ?? machine.name;
    const userLabel = machine.username ?? "ssh";
    return {
      cwd: launch.cwd,
      id: paneId,
      latencyMs: machine.latencyMs,
      lines: [],
      machineId: machine.id,
      mode: "ssh",
      prompt: `${userLabel}@${hostLabel}:~$`,
      remoteCommand: launch.remoteCommand,
      remoteHostId: machine.id,
      status: machine.status,
      target: { hostId: machine.id, kind: "ssh" },
      title: launch.title,
      tmuxBinding: launch.binding,
    };
  }

  const focusedPane = state.terminalPanes.find(
    (pane) => pane.id === state.focusedPaneId,
  );
  if (focusedPane && focusedPane.mode !== "local") {
    return undefined;
  }
  return {
    args: launch.terminal.args,
    cwd: launch.terminal.cwd,
    env: launch.terminal.env,
    id: paneId,
    lines: [],
    machineId: focusedPane?.machineId ?? "machine-tmux-local",
    mode: "local",
    prompt: "tmux>",
    shell: launch.terminal.shell,
    status: focusedPane?.status ?? "online",
    target: localTarget(),
    title: launch.title,
    tmuxBinding: launch.binding,
  };
}

function tmuxPaneBindingMatches(
  left: TmuxPaneBinding | undefined,
  right: TmuxPaneBinding,
) {
  return (
    left?.targetRef === right.targetRef &&
    left.sessionId === right.sessionId &&
    left.socketName === right.socketName &&
    left.socketPath === right.socketPath
  );
}

function emptyConsumption(
  patch: TmuxWorkspaceStatePatch,
): OpenTmuxAttachTerminalResult {
  return {
    consumedPane: false,
    consumedSplit: false,
    consumedTab: false,
    patch,
  };
}
