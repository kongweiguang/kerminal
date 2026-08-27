// @author kongweiguang

import { collectPaneIds } from "./workspaceLayout";
import {
  isTerminalSessionTab,
  isTerminalTabGroupColor,
  isWorkspaceFileTab,
  type Machine,
  type TerminalPane,
  type TerminalTab,
  type TerminalTabGroups,
  type TerminalTabGroupPreferences,
} from "./types";
import {
  definitionFromLegacyPreference,
  normalizeTerminalTabGroupState,
} from "./workspaceTabGroupsModel";

interface LegacyTabGroupMigrationInput {
  source: Record<string, unknown> | null;
  terminalTabs: TerminalTab[];
  terminalTabGroups: TerminalTabGroups;
  legacyPreferences: TerminalTabGroupPreferences | undefined;
  panes: TerminalPane[];
  sidebarMachines: Machine[];
}

/**
 * 将 v1/v2 的主机推导组一次性转换为显式组；v3 之后绝不再根据主机重算。
 * 迁移先按旧渲染顺序收拢非连续成员，再把空组/孤儿引用交给纯模型清理。
 */
export function migrateTerminalTabGroups({
  source,
  terminalTabs,
  terminalTabGroups,
  legacyPreferences,
  panes,
  sidebarMachines,
}: LegacyTabGroupMigrationInput) {
  const version = typeof source?.version === "number" ? source.version : 1;
  if (
    version >= 3 ||
    Boolean(source && Object.prototype.hasOwnProperty.call(source, "terminalTabGroups"))
  ) {
    return normalizeTerminalTabGroupState(terminalTabs, terminalTabGroups);
  }

  const panesById = new Map(panes.map((pane) => [pane.id, pane]));
  const legacyKeys = terminalTabs.map((tab) =>
    legacyTerminalTabGroupKey(tab, panesById),
  );
  const occurrences = new Map<string, number>();
  for (const key of legacyKeys) {
    occurrences.set(key, (occurrences.get(key) ?? 0) + 1);
  }
  const migratedGroupIdByLegacyKey = new Map<string, string>();
  const groups: TerminalTabGroups = {};
  let nextGroupNumber = 1;
  for (const key of [...new Set(legacyKeys)]) {
    const preference = legacyPreferences?.[key];
    if ((occurrences.get(key) ?? 0) <= 1 && !preference) continue;
    const groupId = `tab-group-${nextGroupNumber++}`;
    migratedGroupIdByLegacyKey.set(key, groupId);
    const groupTabs = terminalTabs.filter(
      (_tab, index) => legacyKeys[index] === key,
    );
    groups[groupId] = {
      ...definitionFromLegacyPreference(
        preference,
        legacyGroupTitle(key, groupTabs, sidebarMachines),
      ),
      // 旧的自动色按旧 key 固化，升级后不因新 groupId 改变。
      ...(preference?.color ? {} : { color: legacyAutomaticColor(key) }),
    };
  }

  const migratedTabs = terminalTabs.map((tab, index) => {
    const groupId = migratedGroupIdByLegacyKey.get(legacyKeys[index]);
    return groupId ? { ...tab, tabGroupId: groupId } : withoutTabGroupId(tab);
  });
  return normalizeTerminalTabGroupState(migratedTabs, groups);
}

/** 迁移时复现旧版精确主机 key，避免普通运行态继续依赖自动归组。 */
function legacyTerminalTabGroupKey(
  tab: TerminalTab,
  panesById: Map<string, TerminalPane>,
) {
  if (isWorkspaceFileTab(tab) && tab.target.kind !== "local") {
    return tab.target.hostId;
  }
  if (isTerminalSessionTab(tab)) {
    const remoteHostId = collectPaneIds(tab.layout)
      .map((paneId) => panesById.get(paneId)?.remoteHostId)
      .find((value): value is string => Boolean(value));
    if (remoteHostId) return remoteHostId;
  }
  return tab.machineId;
}

/** 从旧 Tab/机器来源推导迁移标题；只在 v1/v2 兼容分支调用。 */
function legacyGroupTitle(
  key: string,
  groupTabs: TerminalTab[],
  machines: Machine[],
) {
  const firstTab = groupTabs[0];
  if (!firstTab) return key || "标签组";
  const firstTitle = firstTab.title.trim();
  const sidebarMachineTitle = machines
    .find((machine) => machine.id === key)
    ?.name.trim();
  // 只有旧标题仍是机器 ID 这类技术 fallback 时，sidebar 名称才更准确。
  if (
    sidebarMachineTitle &&
    sidebarMachineTitle !== key &&
    (!firstTitle || firstTitle === key || firstTitle === firstTab.machineId)
  ) {
    return sidebarMachineTitle;
  }
  return firstTitle || sidebarMachineTitle || "标签组";
}

/** 固化旧自动组颜色，确保升级前后同一主机视觉颜色不漂移。 */
function legacyAutomaticColor(key: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  const colors = [
    "blue",
    "pink",
    "purple",
    "mint",
    "amber",
    "teal",
    "orange",
    "gray",
  ] as const;
  return colors[(hash >>> 0) % colors.length];
}

/** 清掉迁移前残留的旧 groupId，普通单 Tab 保持未分组。 */
function withoutTabGroupId(tab: TerminalTab): TerminalTab {
  const { tabGroupId: _removed, ...ungrouped } = tab;
  return ungrouped as TerminalTab;
}

/** 仅为旧兼容读取生成 preference 投影，运行态不依赖该字段。 */
export function legacyPreferencesFromGroups(
  groups: TerminalTabGroups,
): TerminalTabGroupPreferences | undefined {
  const preferences = Object.fromEntries(
    Object.entries(groups).map(([groupId, definition]) => [
      groupId,
      {
        ...(definition.color ? { color: definition.color } : {}),
        ...(definition.title ? { title: definition.title } : {}),
      },
    ]),
  );
  return Object.keys(preferences).length > 0 ? preferences : undefined;
}

/** 只读取旧版合法标题与八色值，坏 preference 不阻断其它 Session 数据迁移。 */
export function normalizeTerminalTabGroupPreferences(
  value: unknown,
): TerminalTabGroupPreferences | undefined {
  if (!isRecord(value)) return undefined;
  const preferences: TerminalTabGroupPreferences = {};
  for (const [groupId, rawPreference] of Object.entries(value)) {
    if (!groupId || !isRecord(rawPreference)) continue;
    const title = readOptionalString(rawPreference.title)?.trim();
    const color = isTerminalTabGroupColor(rawPreference.color)
      ? rawPreference.color
      : undefined;
    if (!title && !color) continue;
    preferences[groupId] = {
      ...(color ? { color } : {}),
      ...(title ? { title } : {}),
    };
  }
  return Object.keys(preferences).length > 0 ? preferences : undefined;
}

/** 迁移边界只接受普通 object，避免数组或 null 被当作 preference map。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 旧 preference 的可选字符串必须非空，空值交给标题 fallback。 */
function readOptionalString(value: unknown) {
  return typeof value === "string" && value ? value : undefined;
}
