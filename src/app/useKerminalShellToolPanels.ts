// @author kongweiguang

import { useCallback, useEffect, useMemo } from "react";
import {
  isToolRailToolId,
  normalizeOpenToolPanels,
  openToolPanel,
  resolveOpenToolPanels,
  type ToolRailSettings,
} from "../features/tool-panel";
import type { ToolId } from "../features/workspace/types";
import type { WorkspaceState } from "../features/workspace/workspaceStore";

/** 比较有序集合而非仅比较成员，确保最近活动工具的替换优先级也能写回 Store。 */
function sameToolOrder(left: readonly ToolId[], right: readonly ToolId[]) {
  return (
    left.length === right.length &&
    left.every((toolId, index) => toolId === right[index])
  );
}

/**
 * 将 Tab 级打开集合投影到最新的逐工具位置配置。同方向后打开者替换旧项，不同
 * 方向并行；设置改变造成冲突时也在这里一次性收敛，Store 不持有易陈旧的方向。
 */
export function useKerminalShellToolPanels({
  activeTool,
  compactShell,
  openTools,
  setOpenTools,
  settings,
}: {
  activeTool: ToolId | null;
  compactShell: boolean;
  openTools: readonly ToolId[];
  setOpenTools: WorkspaceState["setOpenTools"];
  settings: ToolRailSettings;
}) {
  const normalizedOpenTools = useMemo(
    () => normalizeOpenToolPanels(openTools, settings),
    [openTools, settings],
  );
  const openPanels = useMemo(
    () => resolveOpenToolPanels(normalizedOpenTools, settings),
    [normalizedOpenTools, settings],
  );

  useEffect(() => {
    if (sameToolOrder(openTools, normalizedOpenTools)) {
      return;
    }
    setOpenTools(
      normalizedOpenTools,
      activeTool &&
        isToolRailToolId(activeTool) &&
        normalizedOpenTools.some((toolId) => toolId === activeTool)
        ? activeTool
        : undefined,
    );
  }, [activeTool, normalizedOpenTools, openTools, setOpenTools]);

  /** 系统流程和快捷键始终打开目标；已打开时只提升最近活动顺序。 */
  const openTool = useCallback(
    (toolId: ToolId) => {
      if (!isToolRailToolId(toolId)) {
        return;
      }
      const nextOpenTools = openToolPanel(
        normalizedOpenTools,
        toolId,
        settings,
        compactShell,
      );
      setOpenTools(nextOpenTools, toolId);
    }, [compactShell, normalizedOpenTools, setOpenTools, settings],
  );

  /** 关闭只影响指定工具所在槽位，其余方向和资源生命周期保持不变。 */
  const closeTool = useCallback(
    (toolId: ToolId) => {
      const nextOpenTools = normalizedOpenTools.filter(
        (candidate) => candidate !== toolId,
      );
      setOpenTools(
        nextOpenTools,
        activeTool === toolId ? undefined : activeTool,
      );
    }, [activeTool, normalizedOpenTools, setOpenTools],
  );

  /**
   * Rail 点击在桌面端切换独立槽位；紧凑抽屉若目标已在后台打开则先把它置前，
   * 再次点击当前工具才收起，避免窄窗口中出现“已选中却看不到”的状态。
   */
  const toggleTool = useCallback(
    (toolId: ToolId) => {
      if (!isToolRailToolId(toolId)) {
        return;
      }
      if (normalizedOpenTools.includes(toolId)) {
        if (compactShell && activeTool !== toolId) {
          setOpenTools(normalizedOpenTools, toolId);
          return;
        }
        closeTool(toolId);
        return;
      }
      openTool(toolId);
    }, [
      activeTool,
      closeTool,
      compactShell,
      normalizedOpenTools,
      openTool,
      setOpenTools,
    ],
  );

  /** 终端聚焦快捷键保留原有“一次收起全部工具”语义。 */
  const closeAllTools = useCallback(() => {
    setOpenTools([], null);
  }, [setOpenTools]);

  return {
    closeAllTools,
    closeTool,
    openPanels,
    openTool,
    openTools: normalizedOpenTools,
    toggleTool,
  };
}
