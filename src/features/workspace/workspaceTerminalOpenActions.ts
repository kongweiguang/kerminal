// @author kongweiguang

import type { StateCreator } from "zustand";
import type { TerminalProfile } from "../../lib/profileApi";
import { sshTarget } from "../../lib/targetModel";
import type { TmuxAttachLaunch } from "../../lib/tmuxApi";
import {
  externalSshLaunchAuthType,
  externalSshLaunchDescription,
  externalSshLaunchDisplayName,
  externalSshLaunchMachineId,
  externalSshLaunchTags,
  type ExternalSshLaunchResolvedRequest,
} from "../external-launch";
import { addMachineToGroup, findMachine } from "./workspaceMachineModel";
import type { OpenSshCommandTerminalOptions } from "./workspaceStoreContract";
import { openSftpTransferTabState } from "./workspaceTabSlice";
import {
  createContainerTerminalOpenState,
  createLocalTerminalOpenState,
  createSerialTerminalOpenState,
  createSshTerminalOpenState,
  createTelnetTerminalOpenState,
  focusExistingMachineTabState,
  type TerminalOpenStateSlice,
} from "./workspaceTerminalOpenState";
import { openTmuxAttachTerminalState } from "./workspaceTmuxState";
import type { Machine, SftpTransferWorkspaceTab, ToolId } from "./types";
import type { ActiveToolByTabId } from "./workspaceToolPanelState";
import { withToolPanelTabTransition } from "./workspaceToolPanelState";

export interface WorkspaceTerminalOpenActions {
  openContainerTerminal: (machineId: string) => void;
  openExternalSshLaunch: (launch: ExternalSshLaunchResolvedRequest) => void;
  openExternalSftpLaunch: (launch: ExternalSshLaunchResolvedRequest) => void;
  openLocalTerminal: (machineId: string) => void;
  openSerialTerminal: (hostId: string) => void;
  openSshCommandTerminal: (
    hostId: string,
    options: OpenSshCommandTerminalOptions,
  ) => void;
  openSshTerminal: (hostId: string) => void;
  openTelnetTerminal: (hostId: string) => void;
  openTmuxAttachTerminal: (
    launch: TmuxAttachLaunch,
    placement?: "pane" | "tab",
  ) => void;
}

export interface WorkspaceTerminalOpenCounterPort {
  commitTmuxConsumption: (consumed: {
    pane: boolean;
    split: boolean;
    tab: boolean;
  }) => void;
  nextPaneId: (prefix: string) => string;
  nextTabId: (prefix: string) => string;
  previewTmuxIds: () => {
    localMachineId: string;
    paneId: string;
    splitId: string;
    tabId: string;
  };
}

interface WorkspaceTerminalOpenStore extends TerminalOpenStateSlice {
  activeTool: ToolId | null;
  activeToolByTabId: ActiveToolByTabId;
  profiles: TerminalProfile[];
}

/** 创建各终端协议的打开 action，并由注入端口统一分配稳定 ID。 */
export function createWorkspaceTerminalOpenActions(
  counters: WorkspaceTerminalOpenCounterPort,
): StateCreator<
  WorkspaceTerminalOpenStore,
  [],
  [],
  WorkspaceTerminalOpenActions
> {
  return (set) => ({
    openLocalTerminal: (machineId) =>
      set((state) => {
        const machine = findMachine(state.machineGroups, machineId);
        if (!machine || machine.kind !== "local") {
          return {};
        }
        const profile = machine.profileId
          ? state.profiles.find(
              (candidate) => candidate.id === machine.profileId,
            )
          : undefined;
        return withToolPanelTabTransition(state, createLocalTerminalOpenState(state, {
          args: machine.args,
          cwd: machine.cwd,
          env: machine.env,
          groupId: machine.remoteGroupId,
          machineId: machine.id,
          paneId: counters.nextPaneId("pane-local"),
          profile,
          shell: machine.shell,
          tabId: counters.nextTabId("tab-local"),
          title: machine.name,
        }));
      }),
    openSshTerminal: (hostId) =>
      set((state) => {
        const machine = findMachine(state.machineGroups, hostId);
        if (!machine || machine.kind !== "ssh") {
          return {};
        }
        return withToolPanelTabTransition(state, createSshTerminalOpenState(state, machine, {
          paneId: counters.nextPaneId("pane-ssh"),
          tabId: counters.nextTabId("tab-ssh"),
        }));
      }),
    openSshCommandTerminal: (hostId, options) =>
      set((state) => {
        const machine = findMachine(state.machineGroups, hostId);
        if (!machine || machine.kind !== "ssh") {
          return {};
        }
        return withToolPanelTabTransition(state, createSshTerminalOpenState(state, machine, {
          cwd: options.cwd,
          paneId: counters.nextPaneId("pane-ssh"),
          remoteCommand: options.remoteCommand,
          tabId: counters.nextTabId("tab-ssh"),
          title: options.title,
        }));
      }),
    openExternalSshLaunch: (launch) =>
      set((state) => {
        const machineId = externalSshLaunchMachineId(launch);
        const machine: Machine = {
          authType: externalSshLaunchAuthType(launch),
          description: externalSshLaunchDescription(launch),
          host: launch.target.host,
          id: machineId,
          kind: "ssh",
          name: externalSshLaunchDisplayName(launch),
          port: launch.target.port,
          status: "online",
          tags: externalSshLaunchTags(launch),
          target: sshTarget(machineId),
          username: launch.target.username,
        };
        const machineGroups = addMachineToGroup(
          state.machineGroups,
          machine,
          undefined,
        );
        const terminalState = createSshTerminalOpenState(
          { ...state, machineGroups },
          machine,
          {
            paneId: counters.nextPaneId("pane-ssh"),
            remoteCommand: launch.options.remoteCommand,
            tabId: counters.nextTabId("tab-ssh"),
            title: machine.name,
          },
        );
        if (launch.options.openSftp) {
          const transferState = openSftpTransferTabState(
            { ...state, ...terminalState, machineGroups },
            { rightHostId: machineId },
            counters,
          );
          return withToolPanelTabTransition(state, {
            ...terminalState,
            ...transferState,
            machineGroups,
          }, null);
        }
        return withToolPanelTabTransition(state, {
          ...terminalState,
          machineGroups,
        });
      }),
    openExternalSftpLaunch: (launch) =>
      set((state) => {
        if (launch.intent?.kind !== "sftpTransfer") {
          return {};
        }
        const existingTab = state.terminalTabs.find(
          (tab) =>
            tab.kind === "sftpTransfer" && tab.externalLaunchId === launch.id,
        );
        if (existingTab) {
          return withToolPanelTabTransition(state, {
            activeTabId: existingTab.id,
            focusedPaneId: "",
            selectedMachineId: existingTab.machineId,
          });
        }
        const machineId = externalSshLaunchMachineId(launch);
        const machine: Machine = {
          authType: externalSshLaunchAuthType(launch),
          cwd: launch.intent.remotePath ?? "/",
          description: externalSshLaunchDescription(launch),
          host: launch.target.host,
          id: machineId,
          kind: "ssh",
          name: externalSshLaunchDisplayName(launch),
          port: launch.target.port,
          status: "online",
          tags: externalSshLaunchTags(launch),
          target: sshTarget(machineId),
          username: launch.target.username,
        };
        const machineGroups = addMachineToGroup(
          state.machineGroups,
          machine,
          undefined,
        );
        const tabId = counters.nextTabId("tab-sftp-transfer");
        const tab: SftpTransferWorkspaceTab = {
          externalLaunchId: launch.id,
          id: tabId,
          initialRightPath: launch.intent.remotePath,
          initialRightSelection: launch.intent.selectedEntry,
          kind: "sftpTransfer",
          machineId,
          rightHostId: machineId,
          title: `${machine.name} 传输`,
        };
        return withToolPanelTabTransition(state, {
          activeTabId: tabId,
          focusedPaneId: "",
          machineGroups,
          selectedMachineId: machineId,
          terminalTabs: [...state.terminalTabs, tab],
        });
      }),
    openTmuxAttachTerminal: (launch, placement = "pane") =>
      set((state) => {
        const ids = counters.previewTmuxIds();
        const result = openTmuxAttachTerminalState(state, {
          launch,
          nextLocalMachineId: ids.localMachineId,
          nextPaneId: ids.paneId,
          nextSplitId: ids.splitId,
          nextTabId: ids.tabId,
          placement,
        });
        counters.commitTmuxConsumption({
          pane: result.consumedPane,
          split: result.consumedSplit,
          tab: result.consumedTab,
        });
        return withToolPanelTabTransition(state, result.patch);
      }),
    openTelnetTerminal: (hostId) =>
      set((state) => {
        const machine = findMachine(state.machineGroups, hostId);
        if (!machine || machine.kind !== "telnet") {
          return {};
        }
        return withToolPanelTabTransition(state, createTelnetTerminalOpenState(state, machine, {
          paneId: counters.nextPaneId("pane-telnet"),
          tabId: counters.nextTabId("tab-telnet"),
        }));
      }),
    openSerialTerminal: (hostId) =>
      set((state) => {
        const machine = findMachine(state.machineGroups, hostId);
        if (!machine || machine.kind !== "serial") {
          return {};
        }
        return withToolPanelTabTransition(state, createSerialTerminalOpenState(state, machine, {
          paneId: counters.nextPaneId("pane-serial"),
          tabId: counters.nextTabId("tab-serial"),
        }));
      }),
    openContainerTerminal: (machineId) =>
      set((state) => {
        const machine = findMachine(state.machineGroups, machineId);
        if (!machine || machine.kind !== "dockerContainer" || !machine.target) {
          return {};
        }
        const existingTabState = focusExistingMachineTabState(state, machine.id);
        if (existingTabState) {
          return withToolPanelTabTransition(state, existingTabState);
        }
        return withToolPanelTabTransition(state, createContainerTerminalOpenState(state, machine, {
          paneId: counters.nextPaneId("pane-container"),
          tabId: counters.nextTabId("tab-container"),
        }));
      }),
  });
}
