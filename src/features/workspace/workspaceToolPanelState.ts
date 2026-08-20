// @author kongweiguang

import { isToolId, type ToolId } from "./types";

const UNBOUND_TOOL_PANEL_TAB_ID = "__kerminal_tool_panel_unbound__";

/**
 * Tab 的右栏状态：缺少 key 表示尚未初始化，null 表示用户明确收起。
 * 两者不能合并，否则新 Tab 会在切换时意外把 Agent 右栏关掉，或把用户
 * 明确收起的右栏重新打开。
 */
export type ActiveToolByTabId = Record<string, ToolId | null>;

/**
 * 每个 Tab 保存有序的已打开工具；顺序同时表达最近激活关系，最后一项是当前
 * 交互目标。具体停靠方向由 Shell 使用最新全局设置解析，避免配置变化后状态陈旧。
 */
export type OpenToolsByTabId = Record<string, ToolId[]>;

export interface WorkspaceToolPanelState {
  activeTabId: string;
  activeTool: ToolId | null;
  activeToolByTabId: ActiveToolByTabId;
  openTools: ToolId[];
  openToolsByTabId: OpenToolsByTabId;
}

export type WorkspaceTabTransitionPatch = Partial<
  Omit<WorkspaceToolPanelState, "activeToolByTabId" | "openToolsByTabId">
> &
  Record<string, unknown>;

/** 右栏可在空工作区使用，但空工作区与任何真实 Tab 都不共享状态。 */
function toolPanelTabScopeId(tabId: string | null | undefined): string {
  return tabId?.trim() || UNBOUND_TOOL_PANEL_TAB_ID;
}

export function activeToolForTab(
  activeToolByTabId: ActiveToolByTabId,
  tabId: string | null | undefined,
): ToolId | null {
  const toolId = activeToolByTabId[toolPanelTabScopeId(tabId)];
  return toolId && isToolId(toolId) ? toolId : null;
}

/** 外部或旧状态只保留有效且不重复的工具，防止一个内容实例被投影到多个槽位。 */
function normalizeOpenTools(openTools: readonly ToolId[]): ToolId[] {
  const normalized: ToolId[] = [];
  for (const toolId of openTools) {
    if (isToolId(toolId) && !normalized.includes(toolId)) {
      normalized.push(toolId);
    }
  }
  return normalized;
}

/** 读取指定 Tab 的已打开工具；未知值按空集合处理而不是恢复任意旧面板。 */
function openToolsForTab(
  openToolsByTabId: OpenToolsByTabId,
  tabId: string | null | undefined,
): ToolId[] {
  return normalizeOpenTools(
    openToolsByTabId[toolPanelTabScopeId(tabId)] ?? [],
  );
}

/**
 * 原子更新当前 Tab 的打开集合和最近活动工具。调用方负责按最新位置配置消除
 * 同方向冲突；这里仅维护 Tab 隔离、顺序和 activeTool 的一致性。
 */
export function setOpenToolsForCurrentTabState(
  state: WorkspaceToolPanelState,
  openTools: readonly ToolId[],
  requestedActiveTool?: ToolId | null,
): Pick<
  WorkspaceToolPanelState,
  "activeTool" | "activeToolByTabId" | "openTools" | "openToolsByTabId"
> {
  const normalizedOpenTools = normalizeOpenTools(openTools);
  const activeTool =
    requestedActiveTool && normalizedOpenTools.includes(requestedActiveTool)
      ? requestedActiveTool
      : (normalizedOpenTools[normalizedOpenTools.length - 1] ?? null);
  const scopeId = toolPanelTabScopeId(state.activeTabId);
  return {
    activeTool,
    activeToolByTabId: {
      ...state.activeToolByTabId,
      [scopeId]: activeTool,
    },
    openTools: normalizedOpenTools,
    openToolsByTabId: {
      ...state.openToolsByTabId,
      [scopeId]: normalizedOpenTools,
    },
  };
}

/** 兼容单面板调用方；新 Shell 使用 setOpenToolsForCurrentTabState 支持多方向并开。 */
export function setActiveToolForCurrentTabState(
  state: WorkspaceToolPanelState,
  activeTool: ToolId | null,
): Pick<
  WorkspaceToolPanelState,
  "activeTool" | "activeToolByTabId" | "openTools" | "openToolsByTabId"
> {
  return setOpenToolsForCurrentTabState(
    state,
    activeTool ? [activeTool] : [],
    activeTool,
  );
}

/** 所有改变 activeTabId 的 action 都通过这里恢复新 Tab 的右栏投影。 */
export function withToolPanelTabTransition<
  Patch extends WorkspaceTabTransitionPatch,
>(
  state: WorkspaceToolPanelState,
  patch: Patch,
  forcedTool?: ToolId | null,
): Patch &
  Pick<
    WorkspaceToolPanelState,
    "activeTool" | "activeToolByTabId" | "openTools" | "openToolsByTabId"
  > {
  const nextTabId = patch.activeTabId ?? state.activeTabId;
  const nextScopeId = toolPanelTabScopeId(nextTabId);
  const hasExplicitOpenTools = Object.prototype.hasOwnProperty.call(
    state.openToolsByTabId,
    nextScopeId,
  );
  const hasExplicitActiveTool = Object.prototype.hasOwnProperty.call(
    state.activeToolByTabId,
    nextScopeId,
  );
  const inheritedOpenTools = hasExplicitOpenTools
    ? openToolsForTab(state.openToolsByTabId, nextTabId)
    : hasExplicitActiveTool
      ? (() => {
          const toolId = activeToolForTab(state.activeToolByTabId, nextTabId);
          return toolId ? [toolId] : [];
        })()
      : state.openTools;
  const inheritedActiveTool = hasExplicitActiveTool
    ? activeToolForTab(state.activeToolByTabId, nextTabId)
    : (inheritedOpenTools[inheritedOpenTools.length - 1] ?? null);

  if (forcedTool !== undefined) {
    const nextOpenTools = forcedTool
      ? [...inheritedOpenTools.filter((toolId) => toolId !== forcedTool), forcedTool]
      : [];
    const nextState = setOpenToolsForCurrentTabState(
      { ...state, activeTabId: nextTabId },
      nextOpenTools,
      forcedTool,
    );
    return { ...patch, ...nextState };
  }
  const nextState = setOpenToolsForCurrentTabState(
    { ...state, activeTabId: nextTabId },
    inheritedOpenTools,
    inheritedActiveTool,
  );
  return { ...patch, ...nextState };
}

/** Tab 关闭是右栏状态唯一的自动清理边界。 */
export function withClosedToolPanelTab<
  Patch extends WorkspaceTabTransitionPatch,
>(
  state: WorkspaceToolPanelState,
  patch: Patch,
  closedTabId: string,
): Patch &
  Pick<
    WorkspaceToolPanelState,
    "activeTool" | "activeToolByTabId" | "openTools" | "openToolsByTabId"
  > {
  const activeToolByTabId = { ...state.activeToolByTabId };
  const openToolsByTabId = { ...state.openToolsByTabId };
  delete activeToolByTabId[toolPanelTabScopeId(closedTabId)];
  delete openToolsByTabId[toolPanelTabScopeId(closedTabId)];
  const nextTabId = patch.activeTabId ?? state.activeTabId;
  const nextScopeId = toolPanelTabScopeId(nextTabId);
  const hasExplicitOpenTools = Object.prototype.hasOwnProperty.call(
    openToolsByTabId,
    nextScopeId,
  );
  const nextOpenTools = hasExplicitOpenTools
    ? openToolsForTab(openToolsByTabId, nextTabId)
    : state.openTools;
  const requestedActiveTool = Object.prototype.hasOwnProperty.call(
    activeToolByTabId,
    nextScopeId,
  )
    ? activeToolForTab(activeToolByTabId, nextTabId)
    : state.activeTool;
  const nextState = setOpenToolsForCurrentTabState(
    {
      ...state,
      activeTabId: nextTabId,
      activeToolByTabId,
      openToolsByTabId,
    },
    nextOpenTools,
    requestedActiveTool,
  );
  return { ...patch, ...nextState };
}
