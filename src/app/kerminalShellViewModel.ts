// @author kongweiguang

import type { InterfaceDensity } from "../features/settings/settingsModel";
import type { Machine, MachineGroup, ToolId } from "../features/workspace/types";
import type { RemoteHost } from "../lib/remoteHostApi";
import type { WindowChromeModel } from "../lib/windowChromeModel";
import { DEFAULT_REMOTE_GROUP_NAME } from "./KerminalShell.static";
import { isRealRemoteGroup } from "./KerminalShell.helpers";
import {
  resolveConnectionEditConflict,
  resolveRemoteGroupEditConflict,
} from "./configDirtyGuardModel";

const RIGHT_TITLE_BAR_ACTION_GAP = 8;
const WINDOWS_CUSTOM_CONTROL_INSET = 112;

/** 在远程动作 controller 初始化前冻结默认分组与主机目标。 */
export function buildKerminalShellRemoteTargetModel(
  machineGroups: MachineGroup[],
) {
  return {
    defaultRemoteGroupId:
      machineGroups.find(
        (group) =>
          isRealRemoteGroup(group) &&
          group.title.trim() === DEFAULT_REMOTE_GROUP_NAME,
      )?.id ?? machineGroups.find(isRealRemoteGroup)?.id,
    defaultRemoteHostId: machineGroups
      .find((group) => group.id !== "local")
      ?.machines.find((machine) => machine.kind === "ssh")?.id,
  };
}

/** 仅在主机树变化时重新计算远程 controller 的默认目标。 */
export function useKerminalShellRemoteTargetModel(
  machineGroups: MachineGroup[],
) {
  return useMemo(
    () => buildKerminalShellRemoteTargetModel(machineGroups),
    [machineGroups],
  );
}

interface BuildKerminalShellViewModelOptions {
  activeTool: ToolId | null;
  compactShell: boolean;
  editingLocalMachine?: Machine;
  editingRemoteGroup?: MachineGroup;
  editingRemoteHost?: RemoteHost;
  effectiveLeftPanelCollapsed: boolean;
  interfaceDensity: InterfaceDensity;
  machineGroups: MachineGroup[];
  profileLoadError: string | null;
  remoteHostLoadError: string | null;
  settingsLoadError: string | null;
  toolPanelDocked?: boolean;
  windowChrome: WindowChromeModel;
  workspaceSessionPersistenceNotice: string | null;
}

/**
 * 汇总主壳所需的稳定派生状态；浮层模式只保留 rail 宽度，避免标题栏材质遮到
 * 工作区，同时不让 composition root 承载具体尺寸分支。
 */
export function buildKerminalShellViewModel({
  activeTool,
  compactShell,
  editingLocalMachine,
  editingRemoteGroup,
  editingRemoteHost,
  effectiveLeftPanelCollapsed,
  interfaceDensity,
  machineGroups,
  profileLoadError,
  remoteHostLoadError,
  settingsLoadError,
  toolPanelDocked = true,
  windowChrome,
  workspaceSessionPersistenceNotice,
}: BuildKerminalShellViewModelOptions) {
  const rightToolRailTitleBarFillWidth =
    activeTool === null || compactShell || !toolPanelDocked
      ? 44
      : interfaceDensity === "spacious"
        ? 56
        : interfaceDensity === "compact"
          ? 44
          : 48;
  return {
    connectionConfigConflict: resolveConnectionEditConflict({
      editingHost: editingRemoteHost,
      editingLocalMachine,
      groups: machineGroups,
    }),
    leftTitleBarInset: effectiveLeftPanelCollapsed
      ? windowChrome.reserveTrafficLightInset
        ? 112
        : 48
      : 0,
    remoteGroupConfigConflict: resolveRemoteGroupEditConflict({
      group: editingRemoteGroup,
      groups: machineGroups,
    }),
    rightTitleBarInset:
      windowChrome.controlMode === "custom"
        ? WINDOWS_CUSTOM_CONTROL_INSET
        : rightToolRailTitleBarFillWidth + RIGHT_TITLE_BAR_ACTION_GAP,
    rightToolRailTitleBarFillWidth,
    shellNoticeMessage:
      workspaceSessionPersistenceNotice ??
      profileLoadError ??
      remoteHostLoadError ??
      settingsLoadError,
  };
}

/** 对主机树 fingerprint 等派生计算提供稳定的渲染期缓存。 */
export function useKerminalShellViewModel(
  options: BuildKerminalShellViewModelOptions,
) {
  const {
    activeTool,
    compactShell,
    editingLocalMachine,
    editingRemoteGroup,
    editingRemoteHost,
    effectiveLeftPanelCollapsed,
    interfaceDensity,
    machineGroups,
    profileLoadError,
    remoteHostLoadError,
    settingsLoadError,
    toolPanelDocked = true,
    windowChrome,
    workspaceSessionPersistenceNotice,
  } = options;
  return useMemo(
    () =>
      buildKerminalShellViewModel({
        activeTool,
        compactShell,
        editingLocalMachine,
        editingRemoteGroup,
        editingRemoteHost,
        effectiveLeftPanelCollapsed,
        interfaceDensity,
        machineGroups,
        profileLoadError,
        remoteHostLoadError,
        settingsLoadError,
        toolPanelDocked,
        windowChrome,
        workspaceSessionPersistenceNotice,
      }),
    [
      activeTool,
      compactShell,
      editingLocalMachine,
      editingRemoteGroup,
      editingRemoteHost,
      effectiveLeftPanelCollapsed,
      interfaceDensity,
      machineGroups,
      profileLoadError,
      remoteHostLoadError,
      settingsLoadError,
      toolPanelDocked,
      windowChrome,
      workspaceSessionPersistenceNotice,
    ],
  );
}
import { useMemo } from "react";
