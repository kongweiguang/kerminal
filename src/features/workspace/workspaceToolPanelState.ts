// @author kongweiguang

import { isToolId, type ToolId } from "./types";

const UNBOUND_TOOL_PANEL_TAB_ID = "__kerminal_tool_panel_unbound__";

export type ActiveToolByTabId = Record<string, ToolId>;

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

/** 更新当前 Tab 的右栏选择；收起只删除当前 Tab 的记录。 */
export function setActiveToolForCurrentTabState(
  state: WorkspaceToolPanelState,
  activeTool: ToolId | null,
): Pick<WorkspaceToolPanelState, "activeTool" | "activeToolByTabId"> {
  const scopeId = toolPanelTabScopeId(state.activeTabId);
  const activeToolByTabId = { ...state.activeToolByTabId };
  if (activeTool) {
    activeToolByTabId[scopeId] = activeTool;
  } else {
    delete activeToolByTabId[scopeId];
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
  return {
    ...patch,
    activeTool: activeToolForTab(activeToolByTabId, nextTabId),
    activeToolByTabId,
  };
}
