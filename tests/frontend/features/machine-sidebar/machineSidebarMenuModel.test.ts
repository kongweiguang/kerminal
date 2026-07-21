/**
 * Machine sidebar context menu model tests.
 *
 * @author kongweiguang
 */

import { describe, expect, it } from "vitest";
import { SFTP_FILE_PANEL_MENU_ACTIONS } from "../../../../src/features/sftp/sftp-tool-content/sftpContextMenuModel";
import {
  containerSidebarGroups,
  localSidebarGroups,
  rdpSidebarGroups,
  remoteSidebarGroups,
  terminalTransportSidebarGroups,
} from "../../support/machine-sidebar/MachineSidebar.testSupport";
import {
  MACHINE_ASSET_MENU_DOMAIN,
  MACHINE_GROUP_MENU_DOMAIN,
  MACHINE_SIDEBAR_MENU_ACTIONS,
  MACHINE_SIDEBAR_ROOT_MENU_DOMAIN,
  buildMachineSidebarGroupMenuItems,
  buildMachineSidebarMachineMenuItems,
  buildMachineSidebarRootMenuItems,
  machineSidebarMenuDomainForContextMenu,
} from "../../../../src/features/machine-sidebar/machineSidebarMenuModel";

function actions(items: ReturnType<typeof buildMachineSidebarRootMenuItems>) {
  return items.map((item) => item.action);
}

describe("machineSidebarMenuModel", () => {
  it("maps sidebar context menu surfaces to explicit domains", () => {
    expect(machineSidebarMenuDomainForContextMenu("root")).toBe(
      MACHINE_SIDEBAR_ROOT_MENU_DOMAIN,
    );
    expect(machineSidebarMenuDomainForContextMenu("group")).toBe(
      MACHINE_GROUP_MENU_DOMAIN,
    );
    expect(machineSidebarMenuDomainForContextMenu("machine")).toBe(
      MACHINE_ASSET_MENU_DOMAIN,
    );
  });

  it("builds root and group menu items without file-panel actions", () => {
    const rootItems = buildMachineSidebarRootMenuItems();
    const groupItems = buildMachineSidebarGroupMenuItems({ pinned: false });
    const pinnedGroupItems = buildMachineSidebarGroupMenuItems({ pinned: true });

    expect(actions(rootItems)).toEqual(["addConnection", "addGroup"]);
    expect(actions(groupItems)).toEqual([
      "addMachineToGroup",
      "editGroup",
      "togglePinGroup",
      "deleteGroup",
      "addGroup",
    ]);
    expect(groupItems.find((item) => item.action === "togglePinGroup")).toMatchObject({
      domain: MACHINE_GROUP_MENU_DOMAIN,
      label: "置顶分组",
    });
    expect(
      pinnedGroupItems.find((item) => item.action === "togglePinGroup"),
    ).toMatchObject({
      label: "取消置顶",
    });
    expect(rootItems.every((item) => item.domain === MACHINE_SIDEBAR_ROOT_MENU_DOMAIN)).toBe(
      true,
    );
    expect(groupItems.every((item) => item.domain === MACHINE_GROUP_MENU_DOMAIN)).toBe(
      true,
    );
  });

  it("builds host-asset menu items by machine kind", () => {
    expect(actions(buildMachineSidebarMachineMenuItems(localSidebarGroups[0]!.machines[0]!))).toEqual([
      "openLocalTerminal",
      "editMachine",
      "duplicateMachine",
      "addMachineToGroup",
      "deleteMachine",
    ]);
    expect(actions(buildMachineSidebarMachineMenuItems(remoteSidebarGroups[1]!.machines[0]!))).toEqual([
      "openSshTerminal",
      "openHostContainers",
      "openSftp",
      "openSftpTransferWorkbench",
      "editMachine",
      "duplicateMachine",
      "addMachineToGroup",
      "deleteMachine",
    ]);
    expect(
      actions(buildMachineSidebarMachineMenuItems(containerSidebarGroups[0]!.machines[1]!)),
    ).toEqual([
      "openContainerTerminal",
      "openContainerDetails",
      "openSftp",
      "deleteMachine",
    ]);
    expect(actions(buildMachineSidebarMachineMenuItems(rdpSidebarGroups[0]!.machines[0]!))).toEqual([
      "openRdpConnection",
      "editMachine",
      "duplicateMachine",
      "addMachineToGroup",
      "deleteMachine",
    ]);
    expect(
      actions(buildMachineSidebarMachineMenuItems(terminalTransportSidebarGroups[0]!.machines[0]!)),
    ).toEqual([
      "openTelnetTerminal",
      "editMachine",
      "duplicateMachine",
      "addMachineToGroup",
      "deleteMachine",
    ]);
    expect(
      actions(buildMachineSidebarMachineMenuItems(terminalTransportSidebarGroups[0]!.machines[1]!)),
    ).toEqual([
      "openSerialTerminal",
      "editMachine",
      "duplicateMachine",
      "addMachineToGroup",
      "deleteMachine",
    ]);
    const sftpItems = buildMachineSidebarMachineMenuItems({ kind: "sftp" });
    expect(actions(sftpItems)).toEqual([
      "openSftp",
      "openSftpTransferWorkbench",
      "editMachine",
      "duplicateMachine",
      "addMachineToGroup",
      "deleteMachine",
    ]);
    expect(sftpItems.find((item) => item.action === "duplicateMachine")?.label).toBe(
      "复制为 SSH 主机",
    );
    expect(sftpItems.slice(0, 2).map((item) => item.label)).toEqual([
      "打开文件传输",
      "新建传输 Tab",
    ]);
  });

  it("keeps host-asset actions disjoint from SFTP file-panel actions", () => {
    const machineActions = new Set<string>(MACHINE_SIDEBAR_MENU_ACTIONS);
    const overlappingFileActions = SFTP_FILE_PANEL_MENU_ACTIONS.filter((action) =>
      machineActions.has(action),
    );

    expect(overlappingFileActions).toEqual([]);
  });
});
