// @author kongweiguang

import {
  ArrowDown,
  ArrowUp,
  Check,
  Eye,
  EyeOff,
  GripVertical,
  Loader2,
  PanelBottom,
  RotateCcw,
} from "lucide-react";
import { useEffect, useId, useRef, useState, type DragEvent } from "react";
import { Button } from "../../components/ui/button";
import { ModalShell } from "../../components/ui/modal-shell";
import { Select, type SelectOption } from "../../components/ui/select";
import { Switch } from "../../components/ui/switch";
import { cn } from "../../lib/cn";
import {
  defaultToolRailSettings,
  isToolRailToolId,
  normalizeToolRailSettings,
  toolRailDefinitions,
  type ToolRailPanelPlacement,
  type ToolRailPanelPlacements,
  type ToolRailSettings,
  type ToolRailToolId,
} from "./toolRailModel";

export interface ToolRailCustomizationDialogProps {
  onClose: () => void;
  onSave: (settings: ToolRailSettings) => Promise<void>;
  open: boolean;
  settings: ToolRailSettings;
}

type ToolRailSectionId = "main" | "bottom";

interface ToolRailDraftSections {
  main: ToolRailToolId[];
  bottom: ToolRailToolId[];
}

const toolPanelPlacementOptions: SelectOption[] = [
  { label: "贴靠右栏", value: "attached" },
  { label: "左侧栏", value: "left" },
  { label: "底部面板", value: "bottom" },
  { label: "自由浮窗", value: "center" },
];

/** 将全局顺序投影为两个视觉分区，底部成员关系不复制排序来源。 */
function splitToolRailSections(
  order: readonly ToolRailToolId[],
  bottom: readonly ToolRailToolId[],
): ToolRailDraftSections {
  const bottomIds = new Set(bottom);
  return {
    main: order.filter((toolId) => !bottomIds.has(toolId)),
    bottom: order.filter((toolId) => bottomIds.has(toolId)),
  };
}

/** 在单个分区中移动一个工具，统一拖拽和键盘按钮的边界行为。 */
function moveTool(
  order: readonly ToolRailToolId[],
  toolId: ToolRailToolId,
  targetIndex: number,
): ToolRailToolId[] {
  const sourceIndex = order.indexOf(toolId);
  if (sourceIndex < 0) {
    return [...order];
  }
  const nextOrder = [...order];
  nextOrder.splice(sourceIndex, 1);
  const boundedIndex = Math.max(0, Math.min(targetIndex, nextOrder.length));
  nextOrder.splice(boundedIndex, 0, toolId);
  return nextOrder;
}

/** 将未知保存错误转换为用户可理解且不暴露底层调用细节的提示。 */
function saveErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return "工具栏保存失败，请检查设置文件后重试。";
}

/**
 * 右击打开的工具栏编辑器只持有草稿；底部归属和打开位置都随一次保存原子提交，
 * 保存失败时保留草稿，避免用户重新编排。
 */
export function ToolRailCustomizationDialog({
  onClose,
  onSave,
  open,
  settings,
}: ToolRailCustomizationDialogProps) {
  const formId = useId();
  const wasOpenRef = useRef(false);
  const [draftOrder, setDraftOrder] = useState<ToolRailToolId[]>(
    defaultToolRailSettings.order,
  );
  const [draftHidden, setDraftHidden] = useState<ToolRailToolId[]>([]);
  const [draftBottom, setDraftBottom] = useState<ToolRailToolId[]>(
    defaultToolRailSettings.bottom,
  );
  const [draftPanelPlacements, setDraftPanelPlacements] =
    useState<ToolRailPanelPlacements>({
      ...defaultToolRailSettings.panelPlacements,
    });
  const [draggedToolId, setDraggedToolId] = useState<ToolRailToolId | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      const normalized = normalizeToolRailSettings(settings);
      setDraftOrder(normalized.order);
      setDraftHidden(normalized.hidden);
      setDraftBottom(normalized.bottom);
      setDraftPanelPlacements({ ...normalized.panelPlacements });
      setDraggedToolId(null);
      setError(null);
      setBusy(false);
    }
    wasOpenRef.current = open;
  }, [open, settings]);

  if (!open) {
    return null;
  }

  const visibleCount = draftOrder.length - draftHidden.length;
  const normalizedDraft = normalizeToolRailSettings({
    bottom: draftBottom,
    hidden: draftHidden,
    order: draftOrder,
    panelPlacements: draftPanelPlacements,
  });
  const dirty =
    JSON.stringify(normalizedDraft) !==
    JSON.stringify(normalizeToolRailSettings(settings));
  const atDefault =
    JSON.stringify(normalizedDraft) ===
    JSON.stringify(normalizeToolRailSettings(defaultToolRailSettings));
  const sections = splitToolRailSections(
    normalizedDraft.order,
    normalizedDraft.bottom,
  );

  /** 同步两个分区的顺序和底部成员关系，使保存 payload 始终是规范形态。 */
  const applySections = (
    main: readonly ToolRailToolId[],
    bottom: readonly ToolRailToolId[],
  ) => {
    setDraftOrder([...main, ...bottom]);
    setDraftBottom([...bottom]);
  };

  /** 切换显示状态，最后一个可见工具必须保留以维持恢复入口。 */
  const toggleVisibility = (toolId: ToolRailToolId) => {
    setDraftHidden((current) => {
      if (current.includes(toolId)) {
        return current.filter((item) => item !== toolId);
      }
      if (visibleCount <= 1) {
        return current;
      }
      return [...current, toolId];
    });
  };

  /** 每个工具单独保存内容宿主，切换一行不会改变其它工具的工作习惯。 */
  const setToolPanelPlacement = (
    toolId: ToolRailToolId,
    placement: ToolRailPanelPlacement,
  ) => {
    setDraftPanelPlacements((current) => ({
      ...current,
      [toolId]: placement,
    }));
  };

  /** 只在当前视觉分区内上移或下移，避免一个方向键动作意外改变固定语义。 */
  const moveBy = (toolId: ToolRailToolId, offset: number) => {
    const sectionId: ToolRailSectionId = draftBottom.includes(toolId)
      ? "bottom"
      : "main";
    const sectionOrder = sections[sectionId];
    const nextSectionOrder = moveTool(
      sectionOrder,
      toolId,
      sectionOrder.indexOf(toolId) + offset,
    );
    applySections(
      sectionId === "main" ? nextSectionOrder : sections.main,
      sectionId === "bottom" ? nextSectionOrder : sections.bottom,
    );
  };

  /** 固定或解除固定时把工具追加到目标分区，结果直观且不会打乱其余项目。 */
  const moveToSection = (
    toolId: ToolRailToolId,
    targetSectionId: ToolRailSectionId,
  ) => {
    const nextMain = sections.main.filter((item) => item !== toolId);
    const nextBottom = sections.bottom.filter((item) => item !== toolId);
    if (targetSectionId === "bottom") {
      nextBottom.push(toolId);
    } else {
      nextMain.push(toolId);
    }
    applySections(nextMain, nextBottom);
  };

  /** 从 React 状态或浏览器传输数据恢复拖拽源，兼容 WebView2 丢失中间状态的情况。 */
  const draggedIdFromEvent = (
    event: DragEvent<HTMLElement>,
  ): ToolRailToolId | null => {
    if (draggedToolId) {
      return draggedToolId;
    }
    const transferredId = event.dataTransfer.getData("text/plain");
    return isToolRailToolId(transferredId) ? transferredId : null;
  };

  /** 跨区拖放时把源插到目标行之前，同时删除源分区里的旧位置。 */
  const dropBefore = (
    targetId: ToolRailToolId,
    targetSectionId: ToolRailSectionId,
    event: DragEvent<HTMLElement>,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const sourceId = draggedIdFromEvent(event);
    setDraggedToolId(null);
    if (!sourceId || sourceId === targetId) {
      return;
    }
    const nextMain = sections.main.filter((item) => item !== sourceId);
    const nextBottom = sections.bottom.filter((item) => item !== sourceId);
    const targetOrder = targetSectionId === "main" ? nextMain : nextBottom;
    const targetIndex = targetOrder.indexOf(targetId);
    targetOrder.splice(targetIndex < 0 ? targetOrder.length : targetIndex, 0, sourceId);
    applySections(nextMain, nextBottom);
  };

  /** 放到分区空白处表示追加，给空底部区和触控板拖拽提供明确落点。 */
  const dropAtSectionEnd = (
    targetSectionId: ToolRailSectionId,
    event: DragEvent<HTMLElement>,
  ) => {
    event.preventDefault();
    const sourceId = draggedIdFromEvent(event);
    setDraggedToolId(null);
    if (sourceId) {
      moveToSection(sourceId, targetSectionId);
    }
  };

  /** 提交规范化草稿，并在持久化失败时保留弹窗和全部选择。 */
  const handleConfirm = async () => {
    if (busy || !dirty) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSave(normalizedDraft);
      onClose();
    } catch (saveError) {
      setError(saveErrorMessage(saveError));
    } finally {
      setBusy(false);
    }
  };

  /**
   * 两个分区使用相同的行模板；只有移动边界和固定状态不同，避免主区与底部区
   * 在无障碍名称、隐藏规则或拖拽反馈上产生漂移。
   */
  const renderSection = (
    sectionId: ToolRailSectionId,
    title: string,
    description: string,
  ) => {
    const sectionOrder = sections[sectionId];
    return (
      <section
        aria-label={title}
        className="rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--surface-muted)] p-1.5"
        data-tool-rail-editor-section={sectionId}
        onDragOver={(event) => {
          if (draggedToolId) {
            event.preventDefault();
          }
        }}
        onDrop={(event) => dropAtSectionEnd(sectionId, event)}
      >
        <div className="flex min-h-9 items-center justify-between gap-3 px-2 py-1">
          <div className="min-w-0">
            <h3 className="text-[12px] font-semibold text-[var(--text-primary)]">
              {title}
            </h3>
            <p className="text-[10px] leading-4 text-[var(--text-tertiary)]">
              {description}
            </p>
          </div>
          <span className="shrink-0 rounded-full bg-[var(--surface-content)] px-2 py-0.5 text-[10px] tabular-nums text-[var(--text-secondary)]">
            {sectionOrder.length}
          </span>
        </div>
        <div className="space-y-1" role="list">
          {sectionOrder.length === 0 ? (
            <div className="flex min-h-12 items-center justify-center rounded-[var(--radius-control)] border border-dashed border-[var(--border-subtle)] px-3 text-center text-[11px] text-[var(--text-tertiary)]">
              将工具拖到这里，或使用每行的固定按钮
            </div>
          ) : null}
          {sectionOrder.map((toolId, index) => {
            const definition = toolRailDefinitions.find(
              (item) => item.id === toolId,
            );
            if (!definition) {
              return null;
            }
            const visible = !draftHidden.includes(toolId);
            const isLastVisible = visible && visibleCount === 1;
            const pinned = sectionId === "bottom";

            return (
              <div
                className={cn(
                  "flex min-h-14 flex-wrap items-center gap-x-2 gap-y-1 rounded-[var(--radius-control)] border border-transparent px-2 py-1.5 transition",
                  visible
                    ? "bg-[var(--surface-content)]"
                    : "bg-[var(--surface-muted)] opacity-60",
                  draggedToolId === toolId &&
                    "ring-2 ring-[rgb(var(--app-accent)/0.35)]",
                )}
                data-tool-rail-item={toolId}
                key={toolId}
                onDragOver={(event) => {
                  if (draggedToolId && draggedToolId !== toolId) {
                    event.preventDefault();
                  }
                }}
                onDrop={(event) => dropBefore(toolId, sectionId, event)}
                role="listitem"
              >
                <button
                  aria-label={`拖动排序 ${definition.title}`}
                  className="kerminal-focus-ring flex h-8 w-7 shrink-0 cursor-grab items-center justify-center rounded-[var(--radius-control)] text-[var(--text-tertiary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] active:cursor-grabbing"
                  draggable={!busy}
                  onDragEnd={() => setDraggedToolId(null)}
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", toolId);
                    setDraggedToolId(toolId);
                  }}
                  type="button"
                >
                  <GripVertical className="h-4 w-4" />
                </button>
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-[var(--surface-muted)] text-[var(--text-secondary)]">
                  <definition.Icon className="h-4 w-4" />
                </div>
                <div className="min-w-32 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-[13px] font-medium text-[var(--text-primary)]">
                      {definition.title}
                    </span>
                    {pinned ? (
                      <span className="shrink-0 rounded bg-[rgb(var(--app-accent)/0.1)] px-1.5 py-0.5 text-[9px] font-medium text-[rgb(var(--app-accent))]">
                        底部
                      </span>
                    ) : null}
                  </div>
                  <div className="truncate text-[11px] text-[var(--text-secondary)]">
                    {definition.description}
                  </div>
                </div>
                <Select
                  aria-label={`打开位置 ${definition.title}`}
                  buttonClassName="text-[11px]"
                  className="w-28 shrink-0"
                  disabled={busy}
                  menuClassName="w-32"
                  onValueChange={(value) =>
                    setToolPanelPlacement(
                      toolId,
                      value as ToolRailPanelPlacement,
                    )
                  }
                  options={toolPanelPlacementOptions}
                  side={
                    sectionId === "bottom" ||
                    (sectionOrder.length > 2 &&
                      index >= sectionOrder.length - 2)
                      ? "top"
                      : "bottom"
                  }
                  size="sm"
                  value={draftPanelPlacements[toolId]}
                />
                <div className="flex shrink-0 items-center gap-0.5">
                  <Button
                    aria-label={`${pinned ? "移回主区域" : "固定到底部"} ${definition.title}`}
                    className={cn(
                      pinned &&
                        "bg-[var(--surface-selected)] text-[rgb(var(--app-accent))]",
                    )}
                    disabled={busy}
                    onClick={() =>
                      moveToSection(toolId, pinned ? "main" : "bottom")
                    }
                    size="icon"
                    title={pinned ? "移回主区域" : "固定到底部"}
                    type="button"
                    variant="ghost"
                  >
                    <PanelBottom className="h-4 w-4" />
                  </Button>
                  <Button
                    aria-label={`上移 ${definition.title}`}
                    disabled={busy || index === 0}
                    onClick={() => moveBy(toolId, -1)}
                    size="icon"
                    type="button"
                    variant="ghost"
                  >
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button
                    aria-label={`下移 ${definition.title}`}
                    disabled={busy || index === sectionOrder.length - 1}
                    onClick={() => moveBy(toolId, 1)}
                    size="icon"
                    type="button"
                    variant="ghost"
                  >
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                  <Switch
                    aria-label={`${visible ? "隐藏" : "显示"} ${definition.title}`}
                    checked={visible}
                    disabled={busy || isLastVisible}
                    onCheckedChange={() => toggleVisibility(toolId)}
                  />
                  {!visible ? (
                    <EyeOff
                      aria-hidden="true"
                      className="ml-1 h-3.5 w-3.5 text-[var(--text-tertiary)]"
                    />
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    );
  };

  return (
    <ModalShell
      description="每个工具都可独立设置显示、顺序、底部固定位置和内容打开方式。"
      footer={
        <>
          <Button
            disabled={busy}
            onClick={onClose}
            size="sm"
            type="button"
            variant="ghost"
          >
            取消
          </Button>
          <Button
            disabled={busy || !dirty}
            form={formId}
            size="sm"
            type="submit"
            variant="primary"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Check className="h-4 w-4" />
            )}
            {busy ? "保存中…" : "保存"}
          </Button>
        </>
      }
      maxWidthClassName="max-w-3xl"
      onClose={() => {
        if (!busy) {
          onClose();
        }
      }}
      open={open}
      size="large"
      title="自定义工具栏"
    >
      <form
        className="space-y-3"
        id={formId}
        onSubmit={(event) => {
          event.preventDefault();
          void handleConfirm();
        }}
      >
        <div className="flex items-center justify-between gap-3 text-[12px] text-[var(--text-secondary)]">
          <span aria-live="polite">
            已显示 {visibleCount} / {draftOrder.length} 个工具
          </span>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              disabled={busy || visibleCount === draftOrder.length}
              onClick={() => setDraftHidden([])}
              size="sm"
              type="button"
              variant="ghost"
            >
              <Eye className="h-3.5 w-3.5" />
              全部显示
            </Button>
            <Button
              disabled={busy || atDefault}
              onClick={() => {
                setDraftOrder([...defaultToolRailSettings.order]);
                setDraftHidden([...defaultToolRailSettings.hidden]);
                setDraftBottom([...defaultToolRailSettings.bottom]);
                setDraftPanelPlacements({
                  ...defaultToolRailSettings.panelPlacements,
                });
              }}
              size="sm"
              type="button"
              variant="ghost"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              恢复默认
            </Button>
          </div>
        </div>

        <div className="scrollbar-none max-h-[min(35rem,calc(100vh-225px))] space-y-2 overflow-y-auto pr-0.5">
          {renderSection("main", "主区域", "从上到下排列，可在空间不足时滚动")}
          {renderSection("bottom", "底部固定区", "始终贴在右栏底部，内部顺序仍可调整")}
        </div>

        {error ? (
          <p
            className="rounded-[var(--radius-control)] border border-rose-300/30 bg-rose-500/10 px-3 py-2 text-xs leading-5 text-rose-700 dark:text-rose-200"
            role="alert"
          >
            {error}
          </p>
        ) : null}
      </form>
    </ModalShell>
  );
}
