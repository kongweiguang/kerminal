// @author kongweiguang

import { isToolId, type ToolId } from "./types";

const UNBOUND_TOOL_PANEL_TAB_ID = "__kerminal_tool_panel_unbound__";

/**
 * Tab 的右栏状态：缺少 key 表示尚未初始化，null 表示用户明确收起。
 * 两者不能合并，否则新 Tab 会在切换时意外把 Agent 右栏关掉，或把用户
 * 明确收起的右栏重新打开。
 */
export type ActiveToolByTabId = Record<string, ToolId | null>;

export interface WorkspaceToolPanelState {
  activeTabId: string;
  activeTool: ToolId | null;
  activeToolByTabId: ActiveToolByTabId;
}

export type WorkspaceTabTransitionPatch = Partial<
  Omit<WorkspaceToolPanelState, "activeToolByTabId">
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

/** 更新当前 Tab 的右栏选择；收起记录为当前 Tab 的明确关闭意图。 */
export function setActiveToolForCurrentTabState(
  state: WorkspaceToolPanelState,
  activeTool: ToolId | null,
): Pick<WorkspaceToolPanelState, "activeTool" | "activeToolByTabId"> {
  const scopeId = toolPanelTabScopeId(state.activeTabId);
  const activeToolByTabId = { ...state.activeToolByTabId };
  if (activeTool) {
    activeToolByTabId[scopeId] = activeTool;
  } else {
    activeToolByTabId[scopeId] = null;
  }
  return { activeTool, activeToolByTabId };
}

/** 所有改变 activeTabId 的 action 都通过这里恢复新 Tab 的右栏投影。 */
export function withToolPanelTabTransition<
  Patch extends WorkspaceTabTransitionPatch,
>(
  state: WorkspaceToolPanelState,
  patch: Patch,
  forcedTool?: ToolId | null,
): Patch & Pick<WorkspaceToolPanelState, "activeTool" | "activeToolByTabId"> {
  const nextTabId = patch.activeTabId ?? state.activeTabId;
  if (forcedTool !== undefined) {
    const nextState = setActiveToolForCurrentTabState(
      { ...state, activeTabId: nextTabId },
      forcedTool,
    );
    return { ...patch, ...nextState };
  }
  const nextScopeId = toolPanelTabScopeId(nextTabId);
  const hasExplicitState = Object.prototype.hasOwnProperty.call(
    state.activeToolByTabId,
    nextScopeId,
  );
  if (!hasExplicitState && state.activeTool) {
    return {
      ...patch,
      activeTool: state.activeTool,
      activeToolByTabId: {
        ...state.activeToolByTabId,
        [nextScopeId]: state.activeTool,
      },
    };
  }
  return {
    ...patch,
    activeTool: activeToolForTab(state.activeToolByTabId, nextTabId),
    activeToolByTabId: state.activeToolByTabId,
  };
}

/** Tab 关闭是右栏状态唯一的自动清理边界。 */
export function withClosedToolPanelTab<
  Patch extends WorkspaceTabTransitionPatch,
>(
  state: WorkspaceToolPanelState,
  patch: Patch,
  closedTabId: string,
): Patch & Pick<WorkspaceToolPanelState, "activeTool" | "activeToolByTabId"> {
  const activeToolByTabId = { ...state.activeToolByTabId };
  delete activeToolByTabId[toolPanelTabScopeId(closedTabId)];
  const nextTabId = patch.activeTabId ?? state.activeTabId;
  const nextScopeId = toolPanelTabScopeId(nextTabId);
  const hasExplicitState = Object.prototype.hasOwnProperty.call(
    activeToolByTabId,
    nextScopeId,
  );
  if (!hasExplicitState && state.activeTool) {
    activeToolByTabId[nextScopeId] = state.activeTool;
  }
  const nextActiveTool = hasExplicitState
    ? activeToolForTab(activeToolByTabId, nextTabId)
    : state.activeTool;
  return {
    ...patch,
    activeTool: nextActiveTool,
    activeToolByTabId,
  };
}
