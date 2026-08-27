// @author kongweiguang

import { localTarget, targetStableId } from "../../lib/targetModel";
import { collectPaneIds } from "./workspaceLayout";
import {
  findMachine,
  localRuntimeDescription,
} from "./workspaceMachineModel";
import type {
  Machine,
  MachineGroup,
  TerminalPane,
  TerminalTab,
} from "./types";
import { isTerminalSessionTab } from "./types";

export type WorkspaceTargetSelectionIssue =
  | "active-tab-missing"
  | "focused-pane-missing"
  | "pane-outside-active-tab"
  | "pane-machine-missing"
  | "selected-machine-missing";

export interface WorkspaceTabPaneSelectionInput {
  activeTabId: string;
  focusedPaneId: string;
  terminalPanes: readonly TerminalPane[];
  terminalTabs: readonly TerminalTab[];
}

export interface WorkspaceTabPaneSelection {
  activeTab?: TerminalTab;
  activeTabPaneIds: string[];
  focusedPane?: TerminalPane;
  issues: WorkspaceTargetSelectionIssue[];
}

export interface WorkspaceTargetSelectionInput
  extends WorkspaceTabPaneSelectionInput {
  machineGroups: readonly MachineGroup[];
  selectedMachineId: string;
}

export interface WorkspaceTargetSelection extends WorkspaceTabPaneSelection {
  activeMachine?: Machine;
  selectedMachine?: Machine;
}

/**
 * 从同一份 workspace state 解析 target binding 输入。
 *
 * focused pane 只有在属于 active tab 时才有效；active tab 存在时不会静默
 * 回退到侧栏选择。selected machine 始终独立返回，由具体能力决定是否使用。
 */
export function resolveWorkspaceTargetSelection(
  input: WorkspaceTargetSelectionInput,
): WorkspaceTargetSelection {
  const selection = resolveWorkspaceTabPaneSelection(input);
  const issues = [...selection.issues];
  const activeMachine = resolveActiveMachine(
    selection.focusedPane,
    selection.activeTab,
    input.machineGroups,
  );
  if (selection.focusedPane?.machineId && !activeMachine) {
    issues.push("pane-machine-missing");
  }

  const selectedMachine =
    findMachine(input.machineGroups, input.selectedMachineId) ??
    (activeMachine?.id === input.selectedMachineId
      ? activeMachine
      : undefined);
  if (input.selectedMachineId && !selectedMachine) {
    issues.push("selected-machine-missing");
  }

  return {
    ...selection,
    activeMachine,
    issues,
    selectedMachine,
  };
}

/** 只解析 tab/pane 身份，供高频 selector 使用，避免派生未消费的机器对象。 */
export function resolveWorkspaceTabPaneSelection(
  input: WorkspaceTabPaneSelectionInput,
): WorkspaceTabPaneSelection {
  const issues: WorkspaceTargetSelectionIssue[] = [];
  const activeTab = input.terminalTabs.find(
    (tab) => tab.id === input.activeTabId,
  );
  const requestedPane = input.terminalPanes.find(
    (pane) => pane.id === input.focusedPaneId,
  );

  if (input.activeTabId && !activeTab) {
    issues.push("active-tab-missing");
  }
  if (input.focusedPaneId && !requestedPane) {
    issues.push("focused-pane-missing");
  }

  const activeTabPaneIds =
    activeTab && isTerminalSessionTab(activeTab)
      ? collectPaneIds(activeTab.layout)
      : [];
  const firstLiveActivePane = activeTabPaneIds
    .map((paneId) =>
      input.terminalPanes.find((pane) => pane.id === paneId),
    )
    .find((pane): pane is TerminalPane => Boolean(pane));
  let focusedPane =
    requestedPane && activeTabPaneIds.includes(requestedPane.id)
      ? requestedPane
      : firstLiveActivePane;

  if (
    requestedPane &&
    activeTab &&
    isTerminalSessionTab(activeTab) &&
    !activeTabPaneIds.includes(requestedPane.id)
  ) {
    issues.push("pane-outside-active-tab");
  }
  if (!activeTab || !isTerminalSessionTab(activeTab)) {
    focusedPane = undefined;
  }

  return {
    activeTab,
    activeTabPaneIds,
    focusedPane,
    issues,
  };
}

/**
 * 优先从无需侧栏注册的 pane 派生活动 Machine；其余协议仍严格依赖已有 Machine，
 * 这样合法临时终端不会产生缺失诊断，也不会掩盖真实的远端引用失效。
 */
function resolveActiveMachine(
  focusedPane: TerminalPane | undefined,
  activeTab: TerminalTab | undefined,
  machineGroups: readonly MachineGroup[],
): Machine | undefined {
  const workspaceLocalMachine = machineFromWorkspaceLocalPane(focusedPane);
  if (workspaceLocalMachine) {
    return workspaceLocalMachine;
  }

  const containerMachine = machineFromContainerPane(
    focusedPane,
    machineGroups,
  );
  if (containerMachine) {
    return containerMachine;
  }

  const machineId = focusedPane
    ? focusedPane.mode === "container"
      ? focusedPane.machineId
      : (focusedPane.remoteHostId ?? focusedPane.machineId)
    : activeTab?.machineId;
  return machineId ? findMachine(machineGroups, machineId) : undefined;
}

/** 从 workspace 本地 pane 的持久运行参数构造只读上下文 Machine。 */
function machineFromWorkspaceLocalPane(
  pane: TerminalPane | undefined,
): Machine | undefined {
  if (
    pane?.mode !== "local" ||
    pane.localMachineScope !== "workspace"
  ) {
    return undefined;
  }

  const cwd = pane.currentCwd ?? pane.cwd;
  return {
    args: pane.args,
    cwd,
    description: localRuntimeDescription({
      args: pane.args,
      cwd,
      shell: pane.shell,
    }),
    env: pane.env,
    id: pane.machineId,
    kind: "local",
    name: pane.title,
    profileId: pane.profileId,
    shell: pane.shell,
    status: pane.status,
    tags: ["local", "workspace"],
    target:
      pane.target?.kind === "local"
        ? pane.target
        : localTarget(pane.profileId),
  };
}

function machineFromContainerPane(
  pane: TerminalPane | undefined,
  machineGroups: readonly MachineGroup[],
): Machine | undefined {
  const target =
    pane?.target?.kind === "dockerContainer" ? pane.target : undefined;
  if (!pane || !target) {
    return undefined;
  }

  const existingMachine = findMachine(machineGroups, pane.machineId);
  if (existingMachine?.kind === "dockerContainer") {
    return existingMachine;
  }

  const hostMachine = findMachine(machineGroups, target.hostId);
  const runtime = target.runtime ?? "docker";
  const containerName =
    target.containerName ?? pane.title ?? target.containerId.slice(0, 12);
  const workdir = pane.currentCwd?.trim() || target.workdir;
  const activeTarget = {
    ...target,
    ...(containerName ? { containerName } : {}),
    ...(workdir ? { workdir } : {}),
    runtime,
  };

  return {
    containerId: target.containerId,
    containerName,
    description: hostMachine
      ? `${hostMachine.name} / ${containerName}`
      : `${runtime} container`,
    host: hostMachine?.host,
    id: targetStableId(activeTarget),
    kind: "dockerContainer",
    name: containerName,
    parentMachineId: target.hostId,
    remoteGroupId: hostMachine?.remoteGroupId,
    runtime,
    status: pane.status,
    tags: ["container", runtime],
    target: activeTarget,
    user: target.user,
    username: hostMachine?.username,
    workdir,
  };
}
