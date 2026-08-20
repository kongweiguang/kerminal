// @author kongweiguang

import type { KeyboardEvent, SyntheticEvent } from "react";
import type { InterfaceDensity } from "../settings/contracts/index";
import { Button } from "../../components/ui/button";
import { cn } from "../../lib/cn";
import type { ToolId, ToolSummary } from "../workspace/contracts/index";
import {
  resolveToolRailSections,
  toolRailDefinitionFor,
  type ToolRailSettings,
} from "./toolRailModel";

export interface ToolRailProps {
  activeTool: ToolId | null;
  activeTools?: readonly ToolId[];
  drawerOpen?: boolean;
  interfaceDensity?: InterfaceDensity;
  onActiveToolChange: (toolId: ToolId) => void;
  onOpenToolRailCustomization?: () => void;
  settings?: ToolRailSettings | null;
  tools: readonly ToolSummary[];
  variant: "panel" | "shell";
}

/**
 * 两种窗口布局共用的右栏按钮宿主；显示策略集中在 resolver，避免紧凑态和桌面态
 * 逐渐产生不同的排序、隐藏和右击行为。
 */
export function ToolRail({
  activeTool,
  activeTools = activeTool ? [activeTool] : [],
  drawerOpen = false,
  interfaceDensity = "comfortable",
  onActiveToolChange,
  onOpenToolRailCustomization,
  settings,
  tools,
  variant,
}: ToolRailProps) {
  const railSections = resolveToolRailSections(tools, settings, activeTools);
  const activeToolIds = new Set(activeTools);
  const railToolCount = railSections.main.length + railSections.bottom.length;
  const compactDensity = interfaceDensity === "compact";
  const spaciousDensity = interfaceDensity === "spacious";
  const panelRailClassName = compactDensity
    ? "flex w-11 shrink-0 flex-col items-center overflow-hidden py-2.5"
    : spaciousDensity
      ? "flex w-14 shrink-0 flex-col items-center overflow-hidden py-4"
      : "flex w-12 shrink-0 flex-col items-center overflow-hidden py-3";
  const panelButtonClassName = compactDensity
    ? "h-7 w-7 rounded-lg"
    : spaciousDensity
      ? "h-9 w-9 rounded-lg"
      : "h-8 w-8 rounded-lg";
  const railClassName =
    variant === "panel"
      ? cn(
          panelRailClassName,
          drawerOpen && "border-l border-[var(--border-subtle)]",
        )
      : "flex w-full min-w-0 flex-col items-center overflow-hidden py-2.5";

  /** 右击和键盘菜单键都打开编辑器，且不触发当前工具的左键行为。 */
  const openCustomizer = (event: SyntheticEvent) => {
    event.preventDefault();
    event.stopPropagation();
    onOpenToolRailCustomization?.();
  };

  /** 没有可见按钮时仍让 rail 能通过键盘恢复，避免配置把入口彻底隐藏。 */
  const handleRailKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) {
      openCustomizer(event);
    }
  };

  /**
   * 两个视觉分区共享完全一致的按钮行为；分区只负责定位，不改变工具选择、
   * 临时显示隐藏活动项或 Agent 内容生命周期。
   */
  const renderToolButton = (tool: ToolSummary) => {
    const definition = toolRailDefinitionFor(tool.id);
    const Icon = definition?.Icon;
    if (!Icon) {
      return null;
    }
    const selected = activeToolIds.has(tool.id);
    const buttonClassName =
      variant === "panel"
        ? panelButtonClassName
        : "h-[var(--density-control-height)] w-[var(--density-control-height)] rounded-[var(--radius-control)]";

    return (
      <Button
        aria-label={`${selected ? "收起" : "打开"} ${tool.title}`}
        aria-pressed={selected}
        className={cn(
          buttonClassName,
          selected &&
            "bg-[var(--surface-selected)] text-sky-700 shadow-sm shadow-sky-500/10 dark:text-sky-100",
        )}
        data-shell-tool-id={tool.id}
        key={tool.id}
        onClick={() => onActiveToolChange(tool.id)}
        size="icon"
        title={tool.title}
        type="button"
        variant="ghost"
      >
        <Icon className="h-4 w-4" />
      </Button>
    );
  };

  return (
    <nav
      aria-label="工具栏"
      className={railClassName}
      onContextMenu={openCustomizer}
      onKeyDown={handleRailKeyDown}
      tabIndex={railToolCount === 0 ? 0 : undefined}
    >
      <div
        aria-label="主要工具"
        className="scrollbar-none flex min-h-0 w-full flex-1 flex-col items-center gap-1.5 overflow-y-auto"
        data-tool-rail-section="main"
        role="group"
      >
        {railSections.main.map(renderToolButton)}
      </div>
      {railSections.bottom.length > 0 ? (
        <div
          aria-label="底部工具"
          className={cn(
            "scrollbar-none flex max-h-[55%] w-full shrink-0 flex-col items-center gap-1.5 overflow-y-auto pt-1.5",
            railSections.main.length > 0 &&
              "border-t border-[var(--border-subtle)]",
          )}
          data-tool-rail-section="bottom"
          role="group"
        >
          {railSections.bottom.map(renderToolButton)}
        </div>
      ) : null}
    </nav>
  );
}
