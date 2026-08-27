// @author kongweiguang

import type {
  TerminalTab,
  TerminalTabGroupMoveRequest,
  TerminalTabMoveRequest,
} from "../workspace/contracts/index";

/** 拖拽源只携带稳定业务 ID，避免把 React 节点或临时索引带进状态命令。 */
export type TerminalTabDragSource =
  | { kind: "tab"; tabId: string; groupId?: string }
  | { kind: "group"; groupId: string };

/** 拖拽目标的三种视觉层级：具体 Tab、组头和扁平顶层 gap。 */
export type TerminalTabDragTarget =
  | { kind: "tab"; tabId: string; groupId?: string }
  | { kind: "group"; groupId: string }
  | { kind: "gap"; index: number };

/**
 * 嵌套 sortable 会让指针同时命中成员 Tab 与外层组；具体 Tab 或顶层 gap
 * 必须优先，否则同一坐标会因 droppable 注册顺序不同而偶发退化成“加入组尾”。
 */
export function prioritizeTerminalTabPointerTargetIds(
  targetIds: string[],
): string[] {
  const specificTargetIds = targetIds.filter(
    (id) => id.startsWith("tab:") || id.startsWith("gap:"),
  );
  return specificTargetIds.length > 0 ? specificTargetIds : targetIds;
}

export interface TerminalTabDragResolutionInput {
  active: TerminalTabDragSource;
  over: TerminalTabDragTarget;
  position: "before" | "after";
  tabGroups: readonly TerminalTabDragGroupSnapshot[];
  tabs: readonly TerminalTab[];
}

/** 只读的组快照，避免 drag model 依赖展示组件的循环类型。 */
interface TerminalTabDragGroupSnapshot {
  grouped?: boolean;
  id: string;
  tabs: readonly Pick<TerminalTab, "id">[];
}

export type TerminalTabDragCommand =
  | TerminalTabMoveRequest
  | TerminalTabGroupMoveRequest;

/**
 * 将 dnd-kit 的稳定源/目标 ID转换为 Store 领域命令。
 *
 * 该边界集中校验 stale、跨层和同位置 drop；组件只负责碰撞检测和宣告，
 * 这样异步关闭 Tab 或组后，过期的 pointer drop 不会误改当前工作区。
 */
export function resolveTerminalTabDragCommand({
  active,
  over,
  position,
  tabGroups,
  tabs,
}: TerminalTabDragResolutionInput): TerminalTabDragCommand | null {
  const tabIds = new Set(tabs.map((tab) => tab.id));
  const groupsById = new Map(
    tabGroups.map((group) => [group.id, group] as const),
  );
  const tabGroupById = new Map<string, string | undefined>();
  for (const group of tabGroups) {
    if (group.grouped === false) continue;
    for (const tab of group.tabs) {
      if (tabIds.has(tab.id)) {
        tabGroupById.set(tab.id, group.id);
      }
    }
  }

  if (active.kind === "tab") {
    if (!tabIds.has(active.tabId)) return null;
    if (over.kind === "gap") {
      if (!isValidFlatGap(over.index, tabs.length)) return null;
      const sourceIndex = tabs.findIndex((tab) => tab.id === active.tabId);
      const sourceGroupId = tabGroupById.get(active.tabId);
      // gap 的 index 是原始扁平数组边界；源项两侧边界都代表原位。
      if (
        sourceGroupId === undefined &&
        (over.index === sourceIndex || over.index === sourceIndex + 1)
      ) {
        return null;
      }
      return {
        tabId: active.tabId,
        targetGroupId: null,
        targetIndex: over.index,
      };
    }

    if (over.kind === "group") {
      const targetGroup = groupsById.get(over.groupId);
      if (!targetGroup || targetGroup.tabs.length === 0) return null;
      const sourceGroupId = tabGroupById.get(active.tabId);
      if (
        sourceGroupId === over.groupId &&
        targetGroup.tabs[targetGroup.tabs.length - 1]?.id === active.tabId
      ) {
        return null;
      }
      return { tabId: active.tabId, targetGroupId: over.groupId };
    }

    if (!tabIds.has(over.tabId) || over.tabId === active.tabId) return null;
    const targetGroupId =
      over.groupId ?? tabGroupById.get(over.tabId) ?? undefined;
    if (targetGroupId && !groupsById.has(targetGroupId)) return null;
    const sourceGroupId = tabGroupById.get(active.tabId);
    const sourceIndex = tabs.findIndex((tab) => tab.id === active.tabId);
    const targetIndex = tabs.findIndex((tab) => tab.id === over.tabId);
    if (
      sourceGroupId === targetGroupId &&
      ((position === "before" && targetIndex === sourceIndex + 1) ||
        (position === "after" && targetIndex === sourceIndex - 1))
    ) {
      return null;
    }
    return {
      position,
      tabId: active.tabId,
      targetGroupId: targetGroupId ?? null,
      targetTabId: over.tabId,
    };
  }

  const sourceGroup = groupsById.get(active.groupId);
  if (!sourceGroup || sourceGroup.tabs.length === 0) return null;
  if (over.kind === "group") {
    if (over.groupId === active.groupId || !groupsById.has(over.groupId)) {
      return null;
    }
    return {
      groupId: active.groupId,
      position,
      targetGroupId: over.groupId,
    };
  }
  if (over.kind === "gap") {
    if (!isValidFlatGap(over.index, tabs.length)) return null;
    const sourceIndexes = sourceGroup.tabs
      .map((tab) => tabs.findIndex((candidate) => candidate.id === tab.id))
      .filter((index) => index >= 0);
    if (sourceIndexes.length === 0) return null;
    const sourceStart = Math.min(...sourceIndexes);
    const sourceEnd = Math.max(...sourceIndexes) + 1;
    if (over.index === sourceStart || over.index === sourceEnd) return null;
    return { groupId: active.groupId, targetIndex: over.index };
  }

  if (!tabIds.has(over.tabId) || over.groupId === active.groupId) {
    // 组拖到自己的成员上仍然只是同组块，不能伪造一次合并。
    return null;
  }
  const targetGroupId =
    over.groupId ?? tabGroupById.get(over.tabId) ?? undefined;
  if (targetGroupId) {
    if (!groupsById.has(targetGroupId)) return null;
    return {
      groupId: active.groupId,
      position,
      targetGroupId,
    };
  }
  const targetIndex = tabs.findIndex((tab) => tab.id === over.tabId);
  if (targetIndex < 0) return null;
  return {
    groupId: active.groupId,
    targetIndex: targetIndex + (position === "after" ? 1 : 0),
  };
}

/** gap 只接受整数扁平边界，拒绝 dnd-kit 在节点过期时可能保留的异常索引。 */
function isValidFlatGap(index: number, tabCount: number): boolean {
  return Number.isInteger(index) && index >= 0 && index <= tabCount;
}
