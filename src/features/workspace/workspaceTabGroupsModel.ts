// @author kongweiguang

import type {
  TerminalTab,
  TerminalTabGroupColor,
  TerminalTabGroupDefinition,
  TerminalTabGroups,
} from "./types";
import { isTerminalTabGroupColor } from "./types";

const TERMINAL_TAB_GROUP_TITLE_MAX_LENGTH = 64;

export type TerminalTabBarItem =
  | { kind: "tab"; tab: TerminalTab }
  | {
      kind: "group";
      groupId: string;
      definition: TerminalTabGroupDefinition;
      tabs: TerminalTab[];
    };

export interface TerminalTabMoveRequest {
  tabId: string;
  targetTabId?: string;
  targetGroupId?: string | null;
  targetIndex?: number;
  position?: "before" | "after";
}

export interface TerminalTabGroupMoveRequest {
  groupId: string;
  targetGroupId?: string;
  targetIndex?: number;
  position?: "before" | "after";
}

export interface TerminalTabGroupState {
  terminalTabs: TerminalTab[];
  terminalTabGroups: TerminalTabGroups;
}

/**
 * 规范化标签组定义；标题在模型边界裁剪到 64 个 Unicode code unit，
 * 这样 Dialog、Session 和拖拽命令共享同一约束且不会产生空组标题。
 */
function normalizeTerminalTabGroupDefinition(
  value: Partial<TerminalTabGroupDefinition> | undefined,
  fallbackTitle = "新建分组",
): TerminalTabGroupDefinition {
  const title = (value?.title ?? fallbackTitle).trim().slice(
    0,
    TERMINAL_TAB_GROUP_TITLE_MAX_LENGTH,
  );
  return {
    collapsed: value?.collapsed === true,
    ...(isTerminalTabGroupColor(value?.color) ? { color: value.color } : {}),
    title: title || fallbackTitle,
  };
}

/**
 * 清理孤儿引用和空定义，并把组成员重新收拢成连续块；坏组只影响自身，
 * 不会删除其它 Tab 或改变活动/焦点字段。
 */
export function normalizeTerminalTabGroupState(
  tabs: TerminalTab[],
  groups: TerminalTabGroups,
): TerminalTabGroupState {
  const validGroupIds = new Set(Object.keys(groups));
  const memberIds = new Set<string>();
  const normalizedTabs = tabs.map((tab) => {
    const groupId = tab.tabGroupId;
    if (!groupId || !validGroupIds.has(groupId)) {
      const { tabGroupId: _removed, ...ungroupedTab } = tab;
      return ungroupedTab as TerminalTab;
    }
    memberIds.add(groupId);
    return tab;
  });

  const orderedTabs: TerminalTab[] = [];
  const emittedGroups = new Set<string>();
  for (const tab of normalizedTabs) {
    const groupId = tab.tabGroupId;
    if (!groupId) {
      orderedTabs.push(tab);
      continue;
    }
    if (emittedGroups.has(groupId)) {
      continue;
    }
    emittedGroups.add(groupId);
    orderedTabs.push(
      ...normalizedTabs.filter((candidate) => candidate.tabGroupId === groupId),
    );
  }

  const terminalTabGroups: TerminalTabGroups = {};
  for (const [groupId, definition] of Object.entries(groups)) {
    if (!memberIds.has(groupId)) {
      continue;
    }
    terminalTabGroups[groupId] = normalizeTerminalTabGroupDefinition(definition);
  }

  return { terminalTabGroups, terminalTabs: orderedTabs };
}

/**
 * 生成标签栏顶层项。未分组 Tab 各自成为 tab item，显式组即使只有一个成员
 * 也保留 group item，避免把用户创建的单成员组伪装成主机自动分组。
 */
export function buildTerminalTabBarItems(
  tabs: TerminalTab[],
  groups: TerminalTabGroups,
): TerminalTabBarItem[] {
  const items: TerminalTabBarItem[] = [];
  const emittedGroups = new Set<string>();
  for (const tab of tabs) {
    const groupId = tab.tabGroupId;
    if (!groupId || !groups[groupId]) {
      items.push({ kind: "tab", tab });
      continue;
    }
    if (emittedGroups.has(groupId)) {
      continue;
    }
    emittedGroups.add(groupId);
    items.push({
      definition: normalizeTerminalTabGroupDefinition(groups[groupId]),
      groupId,
      kind: "group",
      tabs: tabs.filter((candidate) => candidate.tabGroupId === groupId),
    });
  }
  return items;
}

/** 创建单成员显式组；新组 ID 由调用方的单调计数器提供。 */
export function createTerminalTabGroupState(
  state: TerminalTabGroupState,
  tabId: string,
  groupId: string,
  definition: Partial<TerminalTabGroupDefinition> = {},
): TerminalTabGroupState {
  if (!state.terminalTabs.some((tab) => tab.id === tabId) || !groupId.trim()) {
    return state;
  }
  const title = normalizeTerminalTabGroupDefinition(definition).title;
  const withoutTab = state.terminalTabs.map((tab) => {
    if (tab.id !== tabId) return tab;
    const { tabGroupId: _oldGroupId, ...ungroupedTab } = tab;
    return ungroupedTab as TerminalTab;
  });
  const nextTabs = withoutTab.map((tab) =>
    tab.id === tabId ? { ...tab, tabGroupId: groupId } : tab,
  );
  const nextGroups = {
    ...state.terminalTabGroups,
    [groupId]: normalizeTerminalTabGroupDefinition({ ...definition, title }),
  };
  return normalizeTerminalTabGroupState(nextTabs, nextGroups);
}

/** 修改组标题、颜色或折叠状态；组不存在时保持 no-op。 */
export function updateTerminalTabGroupState(
  state: TerminalTabGroupState,
  groupId: string,
  definition: Partial<TerminalTabGroupDefinition>,
): TerminalTabGroupState {
  if (!state.terminalTabGroups[groupId]) return state;
  return normalizeTerminalTabGroupState(state.terminalTabs, {
    ...state.terminalTabGroups,
    [groupId]: normalizeTerminalTabGroupDefinition(
      { ...state.terminalTabGroups[groupId], ...definition },
      state.terminalTabGroups[groupId].title,
    ),
  });
}

/** 持久化折叠状态但不触碰成员、顺序或活动终端。 */
export function setTerminalTabGroupCollapsedState(
  state: TerminalTabGroupState,
  groupId: string,
  collapsed: boolean,
): TerminalTabGroupState {
  return updateTerminalTabGroupState(state, groupId, { collapsed });
}

/** 将单个 Tab 移出显式组并清理空组。 */
export function removeTerminalTabFromGroupState(
  state: TerminalTabGroupState,
  tabId: string,
): TerminalTabGroupState {
  const tab = state.terminalTabs.find((candidate) => candidate.id === tabId);
  if (!tab?.tabGroupId) return state;
  const terminalTabs = state.terminalTabs.map((candidate) => {
    if (candidate.id !== tabId) return candidate;
    const { tabGroupId: _removed, ...ungrouped } = candidate;
    return ungrouped as TerminalTab;
  });
  return normalizeTerminalTabGroupState(terminalTabs, state.terminalTabGroups);
}

/** 取消整个分组但保留 Tab 的扁平顺序和运行态。 */
export function ungroupTerminalTabGroupState(
  state: TerminalTabGroupState,
  groupId: string,
): TerminalTabGroupState {
  if (!state.terminalTabGroups[groupId]) return state;
  const terminalTabs = state.terminalTabs.map((tab) => {
    if (tab.tabGroupId !== groupId) return tab;
    const { tabGroupId: _removed, ...ungrouped } = tab;
    return ungrouped as TerminalTab;
  });
  const terminalTabGroups = { ...state.terminalTabGroups };
  delete terminalTabGroups[groupId];
  return { terminalTabGroups, terminalTabs };
}

/**
 * 移动 Tab 并一次性决定目标组；目标过期或源不存在时 no-op，避免异步拖拽
 * 在 Tab 已关闭后误改活动终端。结果最后重新收拢组成员，保证连续性不变量。
 */
export function moveTerminalTabState(
  state: TerminalTabGroupState,
  request: TerminalTabMoveRequest,
): TerminalTabGroupState {
  const sourceIndex = state.terminalTabs.findIndex(
    (tab) => tab.id === request.tabId,
  );
  if (sourceIndex < 0) return state;
  if (request.targetTabId === request.tabId) return state;
  const source = state.terminalTabs[sourceIndex];
  const remaining = state.terminalTabs.filter((tab) => tab.id !== request.tabId);
  const target = request.targetTabId
    ? remaining.find((tab) => tab.id === request.targetTabId)
    : undefined;
  if (request.targetTabId && !target) return state;
  if (request.targetGroupId === "") return state;
  if (
    request.targetIndex !== undefined &&
    (!Number.isInteger(request.targetIndex) ||
      request.targetIndex < 0 ||
      request.targetIndex > state.terminalTabs.length)
  ) {
    return state;
  }

  const targetGroupId =
    request.targetGroupId !== undefined
      ? request.targetGroupId || undefined
      : target?.tabGroupId;
  if (targetGroupId && !state.terminalTabGroups[targetGroupId]) return state;
  // targetTabId 与显式 targetGroupId 必须属于同一层；否则异步或跨层拖放
  // 不能把 Tab 插入错误组后再被连续性归一化“吞掉”。
  if (
    target &&
    request.targetGroupId !== undefined &&
    targetGroupId !== target.tabGroupId
  ) {
    return state;
  }

  let insertIndex =
    typeof request.targetIndex === "number"
      ? projectFlatInsertionIndex(
          request.targetIndex,
          sourceIndex,
          state.terminalTabs.length,
          remaining.length,
        )
      : remaining.length;
  if (target) {
    insertIndex = remaining.findIndex((tab) => tab.id === target.id);
    if (request.position === "after") insertIndex += 1;
  }

  const movedTab = targetGroupId
    ? { ...source, tabGroupId: targetGroupId }
    : withoutTabGroupId(source);
  remaining.splice(insertIndex, 0, movedTab);
  return normalizeTerminalTabGroupState(remaining, state.terminalTabGroups);
}

/** 以连续块移动整组；目标组不会被合并，跨层非法目标保持 no-op。 */
export function moveTerminalTabGroupState(
  state: TerminalTabGroupState,
  request: TerminalTabGroupMoveRequest,
): TerminalTabGroupState {
  const memberIndexes = state.terminalTabs
    .map((tab, index) => (tab.tabGroupId === request.groupId ? index : -1))
    .filter((index) => index >= 0);
  if (!state.terminalTabGroups[request.groupId] || memberIndexes.length === 0) {
    return state;
  }
  if (request.targetGroupId === request.groupId) return state;
  if (
    request.targetGroupId !== undefined &&
    !state.terminalTabGroups[request.targetGroupId]
  ) {
    return state;
  }
  if (
    request.targetIndex !== undefined &&
    (!Number.isInteger(request.targetIndex) ||
      request.targetIndex < 0 ||
      request.targetIndex > state.terminalTabs.length)
  ) {
    return state;
  }
  const members = memberIndexes.map((index) => state.terminalTabs[index]);
  const remaining = state.terminalTabs.filter(
    (tab) => tab.tabGroupId !== request.groupId,
  );
  let insertIndex =
    typeof request.targetIndex === "number"
      ? projectFlatInsertionIndex(
          request.targetIndex,
          memberIndexes,
          state.terminalTabs.length,
          remaining.length,
        )
      : remaining.length;
  if (request.targetGroupId) {
    const targetIndexes = remaining
      .map((tab, index) => (tab.tabGroupId === request.targetGroupId ? index : -1))
      .filter((index) => index >= 0);
    // 目标定义可能在拖拽期间刚好失去最后一个成员；把这种过期目标视为
    // no-op，避免 Math.min/Math.max 空数组把整组插到不可预测的位置。
    if (targetIndexes.length === 0) return state;
    if (request.position === "before") insertIndex = Math.min(...targetIndexes);
    else insertIndex = Math.max(...targetIndexes) + 1;
  }
  remaining.splice(insertIndex, 0, ...members);
  return normalizeTerminalTabGroupState(remaining, state.terminalTabGroups);
}

/**
 * 把扁平 terminalTabs 的 gap 坐标投影到移除源项后的数组；拖回源块原位时，
 * 目标索引应扣除其左侧已移除项，否则同一位置会被误判成末尾移动。
 */
function projectFlatInsertionIndex(
  requestedIndex: number,
  removedIndexOrIndexes: number | readonly number[],
  originalLength: number,
  remainingLength: number,
) {
  const safeRequestedIndex = Number.isFinite(requestedIndex)
    ? Math.trunc(requestedIndex)
    : 0;
  const clampedIndex = Math.max(0, Math.min(safeRequestedIndex, originalLength));
  const removedIndexes =
    typeof removedIndexOrIndexes === "number"
      ? [removedIndexOrIndexes]
      : removedIndexOrIndexes;
  const removedBefore = removedIndexes.filter((index) => index < clampedIndex).length;
  return Math.max(0, Math.min(clampedIndex - removedBefore, remainingLength));
}

/** 通过结构复制移除可选组字段，避免把 undefined 序列化成持久化噪声。 */
function withoutTabGroupId(tab: TerminalTab): TerminalTab {
  const { tabGroupId: _removed, ...ungrouped } = tab;
  return ungrouped as TerminalTab;
}

/** 将旧 preference 转成 v3 显式组定义，供一次性迁移使用。 */
export function definitionFromLegacyPreference(
  preference: { title?: string; color?: TerminalTabGroupColor } | undefined,
  fallbackTitle: string,
): TerminalTabGroupDefinition {
  return normalizeTerminalTabGroupDefinition(
    { collapsed: false, ...preference },
    fallbackTitle,
  );
}
