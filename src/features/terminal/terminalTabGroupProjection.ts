// @author kongweiguang

import {
  buildTerminalTabBarItems,
  collectPaneIds,
  isTerminalSessionTab,
  isWorkspaceFileTab,
  type MachineGroup,
  type TerminalPane,
  type TerminalTab,
  type TerminalTabGroups,
  type TerminalTabGroupPreference,
  type TerminalTabGroupPreferences,
} from "../workspace/contracts/index";
import {
  resolveTerminalTabIdentityAccent,
  resolveTerminalTabIdentityPaletteToken,
} from "./terminalTabIdentityModel";
import type {
  TerminalTabGroup,
  TerminalTabGroupBuildOptions,
} from "./terminalTabChrome";

/** 将显式组投影为视觉顺序；legacy 分支仅供旧行为专项测试，不参与正常运行。 */
export function buildTerminalTabGroups(
  tabs: TerminalTab[],
  preferences: TerminalTabGroupPreferences | TerminalTabGroups = {},
  options: TerminalTabGroupBuildOptions = {},
): TerminalTabGroup[] {
  if (options.mode === "explicit") {
    return buildExplicitTerminalTabGroups(
      tabs,
      preferences as TerminalTabGroups,
    );
  }
  const orderedGroupIds: string[] = [];
  const tabsByGroupId = new Map<string, TerminalTab[]>();
  const panesById = new Map(
    (options.panes ?? []).map((pane) => [pane.id, pane]),
  );
  for (const tab of tabs) {
    const groupId = resolveTerminalTabGroupId(tab, panesById);
    if (!tabsByGroupId.has(groupId)) {
      orderedGroupIds.push(groupId);
      tabsByGroupId.set(groupId, []);
    }
    tabsByGroupId.get(groupId)?.push(tab);
  }
  return orderedGroupIds.map((groupId) => {
    const groupTabs = tabsByGroupId.get(groupId) ?? [];
    const preference = preferences[groupId];
    const title =
      preference?.title?.trim() ||
      defaultTerminalTabGroupTitle(groupId, groupTabs, options.machineGroups);
    const identityAccent = resolveTerminalTabIdentityAccent({
      groupId,
      preference,
      tabCount: groupTabs.length,
    });
    return {
      color: identityAccent.color,
      colorLabel: resolveTerminalTabIdentityPaletteToken(identityAccent.color).label,
      grouped: groupTabs.length > 1,
      id: groupId,
      identityAccent,
      ...(preference ? { preference } : {}),
      tabs: groupTabs,
      title,
    };
  });
}

/** 显式组和未分组 Tab 都复用同一视觉契约，但只显式组显示组头。 */
function buildExplicitTerminalTabGroups(
  tabs: TerminalTab[],
  groups: TerminalTabGroups,
): TerminalTabGroup[] {
  return buildTerminalTabBarItems(tabs, groups).map((item) => {
    if (item.kind === "tab") {
      const groupId = `ungrouped:${item.tab.id}`;
      const identityAccent = resolveTerminalTabIdentityAccent({
        groupId,
        tabCount: 1,
      });
      return {
        color: identityAccent.color,
        colorLabel: resolveTerminalTabIdentityPaletteToken(identityAccent.color).label,
        grouped: false,
        id: groupId,
        identityAccent,
        tabs: [item.tab],
        title: item.tab.title,
      };
    }
    const identityAccent = resolveTerminalTabIdentityAccent({
      groupId: item.groupId,
      preference: item.definition,
      tabCount: item.tabs.length,
    });
    const preference: TerminalTabGroupPreference = {
      ...(item.definition.color ? { color: item.definition.color } : {}),
      ...(item.definition.title ? { title: item.definition.title } : {}),
    };
    return {
      color: identityAccent.color,
      colorLabel: resolveTerminalTabIdentityPaletteToken(identityAccent.color).label,
      definition: item.definition,
      collapsed: item.definition.collapsed,
      grouped: true,
      id: item.groupId,
      identityAccent,
      preference,
      tabs: item.tabs,
      title: item.definition.title,
    };
  });
}

/** 旧投影只在迁移专项保留精确 host key 语义。 */
function resolveTerminalTabGroupId(
  tab: TerminalTab,
  panesById: Map<string, TerminalPane>,
) {
  if (isWorkspaceFileTab(tab) && tab.target.kind !== "local") {
    return tab.target.hostId;
  }
  if (isTerminalSessionTab(tab)) {
    const firstRemoteHostId = collectPaneIds(tab.layout)
      .map((paneId) => panesById.get(paneId)?.remoteHostId)
      .find((remoteHostId): remoteHostId is string => Boolean(remoteHostId));
    if (firstRemoteHostId) return firstRemoteHostId;
  }
  return tab.machineId;
}

/** 旧投影标题优先可读 Tab，再查侧栏机器，绝不直接显示空 key。 */
function defaultTerminalTabGroupTitle(
  groupId: string,
  groupTabs: TerminalTab[],
  machineGroups: MachineGroup[] | undefined,
) {
  const firstTab = groupTabs[0];
  if (!firstTab) return groupId;
  if (firstTab.machineId === groupId) return firstTab.title;
  return findMachineGroupTitle(machineGroups, groupId) ?? firstTab.title;
}

/** 旧投影只读取当前侧栏机器的显示名，不改变 host 身份。 */
function findMachineGroupTitle(
  machineGroups: MachineGroup[] | undefined,
  machineId: string,
) {
  for (const group of machineGroups ?? []) {
    const machine = group.machines.find((candidate) => candidate.id === machineId);
    if (machine) return machine.name;
  }
  return undefined;
}
