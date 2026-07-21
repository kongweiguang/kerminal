/**
 * Machine sidebar context menu domain and action model.
 *
 * @author kongweiguang
 */

import type { Machine } from "../workspace/contracts/index";

export const MACHINE_SIDEBAR_ROOT_MENU_DOMAIN = "machineSidebarRoot";
export const MACHINE_GROUP_MENU_DOMAIN = "machineGroup";
export const MACHINE_ASSET_MENU_DOMAIN = "machineAsset";

export type MachineSidebarMenuDomain =
  | typeof MACHINE_SIDEBAR_ROOT_MENU_DOMAIN
  | typeof MACHINE_GROUP_MENU_DOMAIN
  | typeof MACHINE_ASSET_MENU_DOMAIN;

export type MachineSidebarMenuContextType = "root" | "group" | "machine";

export type MachineSidebarMenuAction =
  | "addConnection"
  | "addGroup"
  | "addMachineToGroup"
  | "deleteGroup"
  | "deleteMachine"
  | "duplicateMachine"
  | "editGroup"
  | "editMachine"
  | "openHostContainers"
  | "openContainerDetails"
  | "openContainerTerminal"
  | "openLocalTerminal"
  | "openRdpConnection"
  | "openSerialTerminal"
  | "openSftp"
  | "openSftpTransferWorkbench"
  | "openSshTerminal"
  | "openTelnetTerminal"
  | "togglePinGroup";

export const MACHINE_SIDEBAR_MENU_ACTIONS = [
  "addConnection",
  "addGroup",
  "addMachineToGroup",
  "deleteGroup",
  "deleteMachine",
  "duplicateMachine",
  "editGroup",
  "editMachine",
  "openHostContainers",
  "openContainerDetails",
  "openContainerTerminal",
  "openLocalTerminal",
  "openRdpConnection",
  "openSerialTerminal",
  "openSftp",
  "openSftpTransferWorkbench",
  "openSshTerminal",
  "openTelnetTerminal",
  "togglePinGroup",
] satisfies readonly MachineSidebarMenuAction[];

export type MachineSidebarMenuItemModel = {
  action: MachineSidebarMenuAction;
  danger?: boolean;
  domain: MachineSidebarMenuDomain;
  label: string;
};

export function machineSidebarMenuDomainForContextMenu(
  type: MachineSidebarMenuContextType,
): MachineSidebarMenuDomain {
  if (type === "root") {
    return MACHINE_SIDEBAR_ROOT_MENU_DOMAIN;
  }
  if (type === "group") {
    return MACHINE_GROUP_MENU_DOMAIN;
  }
  return MACHINE_ASSET_MENU_DOMAIN;
}

export function buildMachineSidebarRootMenuItems(): MachineSidebarMenuItemModel[] {
  return [
    machineSidebarMenuItem({
      action: "addConnection",
      domain: MACHINE_SIDEBAR_ROOT_MENU_DOMAIN,
      label: "添加连接",
    }),
    machineSidebarMenuItem({
      action: "addGroup",
      domain: MACHINE_SIDEBAR_ROOT_MENU_DOMAIN,
      label: "新建分组",
    }),
  ];
}

export function buildMachineSidebarGroupMenuItems({
  pinned,
}: {
  pinned: boolean;
}): MachineSidebarMenuItemModel[] {
  return [
    machineSidebarMenuItem({
      action: "addMachineToGroup",
      domain: MACHINE_GROUP_MENU_DOMAIN,
      label: "添加连接到此分组",
    }),
    machineSidebarMenuItem({
      action: "editGroup",
      domain: MACHINE_GROUP_MENU_DOMAIN,
      label: "重命名分组",
    }),
    machineSidebarMenuItem({
      action: "togglePinGroup",
      domain: MACHINE_GROUP_MENU_DOMAIN,
      label: pinned ? "取消置顶" : "置顶分组",
    }),
    machineSidebarMenuItem({
      action: "deleteGroup",
      danger: true,
      domain: MACHINE_GROUP_MENU_DOMAIN,
      label: "删除分组",
    }),
    machineSidebarMenuItem({
      action: "addGroup",
      domain: MACHINE_GROUP_MENU_DOMAIN,
      label: "新建分组",
    }),
  ];
}

export function buildMachineSidebarMachineMenuItems(
  machine: Pick<Machine, "kind">,
): MachineSidebarMenuItemModel[] {
  if (machine.kind === "local") {
    return withMachineAssetDomain([
      { action: "openLocalTerminal", label: "打开本地会话" },
      { action: "editMachine", label: "编辑连接配置" },
      { action: "duplicateMachine", label: "复制主机" },
      { action: "addMachineToGroup", label: "添加同组连接" },
      { action: "deleteMachine", danger: true, label: "删除连接" },
    ]);
  }

  if (machine.kind === "dockerContainer") {
    return withMachineAssetDomain([
      { action: "openContainerTerminal", label: "进入容器终端" },
      { action: "openContainerDetails", label: "详情" },
      { action: "openSftp", label: "打开 SFTP" },
      { action: "deleteMachine", danger: true, label: "删除连接" },
    ]);
  }

  if (machine.kind === "rdp") {
    return withMachineAssetDomain([
      { action: "openRdpConnection", label: "打开 RDP 连接" },
      { action: "editMachine", label: "编辑连接配置" },
      { action: "duplicateMachine", label: "复制主机" },
      { action: "addMachineToGroup", label: "添加同组连接" },
      { action: "deleteMachine", danger: true, label: "删除连接" },
    ]);
  }

  if (machine.kind === "telnet") {
    return withMachineAssetDomain([
      { action: "openTelnetTerminal", label: "打开 Telnet 终端" },
      { action: "editMachine", label: "编辑连接配置" },
      { action: "duplicateMachine", label: "复制主机" },
      { action: "addMachineToGroup", label: "添加同组连接" },
      { action: "deleteMachine", danger: true, label: "删除连接" },
    ]);
  }

  if (machine.kind === "serial") {
    return withMachineAssetDomain([
      { action: "openSerialTerminal", label: "打开 Serial 终端" },
      { action: "editMachine", label: "编辑连接配置" },
      { action: "duplicateMachine", label: "复制主机" },
      { action: "addMachineToGroup", label: "添加同组连接" },
      { action: "deleteMachine", danger: true, label: "删除连接" },
    ]);
  }

  if (machine.kind === "sftp") {
    return withMachineAssetDomain([
      { action: "openSftp", label: "打开文件传输" },
      { action: "openSftpTransferWorkbench", label: "新建传输 Tab" },
      { action: "editMachine", label: "编辑连接配置" },
      { action: "duplicateMachine", label: "复制为 SSH 主机" },
      { action: "addMachineToGroup", label: "添加同组连接" },
      { action: "deleteMachine", danger: true, label: "删除连接" },
    ]);
  }

  return withMachineAssetDomain([
    { action: "openSshTerminal", label: "打开 SSH 终端" },
    { action: "openHostContainers", label: "容器" },
    { action: "openSftp", label: "打开 SFTP" },
    { action: "openSftpTransferWorkbench", label: "新建传输 Tab" },
    { action: "editMachine", label: "编辑连接配置" },
    { action: "duplicateMachine", label: "复制主机" },
    { action: "addMachineToGroup", label: "添加同组连接" },
    { action: "deleteMachine", danger: true, label: "删除连接" },
  ]);
}

function withMachineAssetDomain(
  items: Array<
    Omit<MachineSidebarMenuItemModel, "domain"> & {
      domain?: never;
    }
  >,
): MachineSidebarMenuItemModel[] {
  return items.map((item) =>
    machineSidebarMenuItem({
      ...item,
      domain: MACHINE_ASSET_MENU_DOMAIN,
    }),
  );
}

function machineSidebarMenuItem(
  item: MachineSidebarMenuItemModel,
): MachineSidebarMenuItemModel {
  return item;
}
