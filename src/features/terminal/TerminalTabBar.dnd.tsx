// @author kongweiguang

import {
  closestCenter,
  DndContext,
  DragOverlay,
  pointerWithin,
  useDroppable,
  type CollisionDetection,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { ReactNode, Ref } from "react";
import { cn } from "../../lib/cn";
import type { TerminalTabDragActivatorProps } from "./terminalTabChrome";
import { prioritizeTerminalTabPointerTargetIds } from "./terminalTabDragModel";

interface DraggableTabItemProps {
  children: (props: TerminalTabDragActivatorProps) => ReactNode;
  disabled?: boolean;
  groupId?: string;
  label: string;
  tabId: string;
}

/**
 * Tab 外壳只注册排序矩阵，pointer listener 下沉到真实按钮，避免关闭、右键和普通点击
 * 启动拖拽，也避免为布局节点增加无效键盘焦点。
 */
export function DraggableTabItem({
  children,
  disabled = false,
  groupId,
  label,
  tabId,
}: DraggableTabItemProps) {
  if (disabled) return <div data-terminal-tab-id={tabId}>{children({})}</div>;
  return (
    <DraggableTabItemDnd groupId={groupId} label={label} tabId={tabId}>
      {children}
    </DraggableTabItemDnd>
  );
}

/** dnd-kit hook 只能在 DndContext 下调用，单 Tab 兼容路径由外层组件绕过本实现。 */
function DraggableTabItemDnd({
  children,
  groupId,
  label,
  tabId,
}: DraggableTabItemProps) {
  const sortable = useSortable({
    data: { groupId, kind: "tab", label, tabId },
    id: `tab:${tabId}`,
  });
  return (
    <div
      data-terminal-tab-id={tabId}
      ref={sortable.setNodeRef}
      style={{
        opacity: sortable.isDragging ? 0.35 : undefined,
        transform: CSS.Translate.toString(sortable.transform),
        transition: sortable.isDragging ? undefined : sortable.transition,
      }}
    >
      {children({
        dragActivatorRef: sortable.setActivatorNodeRef,
        dragAttributes: sortable.attributes,
        dragListeners: sortable.listeners,
      })}
    </div>
  );
}

interface DraggableGroupItemProps {
  children: (props: TerminalTabDragActivatorProps) => ReactNode;
  disabled?: boolean;
  groupId: string;
  label: string;
}

/** 整组外壳保持成员连续，组头按钮是唯一 activator，成员 Tab 不会触发父组拖拽。 */
export function DraggableGroupItem({
  children,
  disabled = false,
  groupId,
  label,
}: DraggableGroupItemProps) {
  if (disabled)
    return <div data-terminal-tab-group-id={groupId}>{children({})}</div>;
  return (
    <DraggableGroupItemDnd groupId={groupId} label={label}>
      {children}
    </DraggableGroupItemDnd>
  );
}

/** 组头拖动只注册父级排序节点，避免嵌套成员抢占事件。 */
function DraggableGroupItemDnd({
  children,
  groupId,
  label,
}: DraggableGroupItemProps) {
  const sortable = useSortable({
    data: { groupId, kind: "group", label },
    id: `group:${groupId}`,
  });
  return (
    <div
      data-terminal-tab-group-id={groupId}
      ref={sortable.setNodeRef}
      style={{
        opacity: sortable.isDragging ? 0.35 : undefined,
        transform: CSS.Translate.toString(sortable.transform),
        transition: sortable.isDragging ? undefined : sortable.transition,
      }}
    >
      {children({
        dragActivatorRef: sortable.setActivatorNodeRef,
        dragAttributes: sortable.attributes,
        dragListeners: sortable.listeners,
      })}
    </div>
  );
}

/** 顶层间隙是唯一的移出分组目标，避免两个未分组 Tab 覆盖时隐式建组。 */
export function DropGap({
  disabled = false,
  index,
}: {
  disabled?: boolean;
  index: number;
}) {
  return disabled ? (
    <DropGapView isOver={false} />
  ) : (
    <DropGapDnd index={index} />
  );
}

/** 只有 DnD 上下文存在时注册间隙，单 Tab 路径不调用 context hook。 */
function DropGapDnd({ index }: { index: number }) {
  const { isOver, setNodeRef } = useDroppable({
    data: { index, kind: "gap" },
    id: `gap:${index}`,
  });
  return <DropGapView isOver={isOver} ref={setNodeRef} />;
}

/** 间隙的视觉层和注册层分离，让禁用拖拽时仍保持稳定布局。 */
function DropGapView({
  isOver,
  ref,
}: {
  isOver: boolean;
  ref?: Ref<HTMLSpanElement>;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "h-8 w-2 shrink-0 rounded-full transition-colors",
        isOver ? "bg-sky-400/60" : "bg-transparent",
      )}
      ref={ref}
    />
  );
}

/** 没有可拖拽项时不创建 dnd-kit live region，避免和业务 status 提示冲突。 */
export function MaybeDndContext({
  children,
  enabled,
  ...props
}: React.ComponentProps<typeof DndContext> & { enabled: boolean }) {
  return enabled ? (
    <DndContext {...props}>{children}</DndContext>
  ) : (
    <>{children}</>
  );
}

/** SortableContext 只在 DndContext 已挂载时创建，兼容路径无需上下文。 */
export function MaybeSortableContext({
  children,
  enabled,
  ...props
}: React.ComponentProps<typeof SortableContext> & { enabled: boolean }) {
  return enabled ? (
    <SortableContext {...props}>{children}</SortableContext>
  ) : (
    <>{children}</>
  );
}

/** DragOverlay 不能脱离 DndContext；浮层使用主题变量继承三种主题。 */
export function MaybeDragOverlay({
  draggingLabel,
  enabled,
}: {
  draggingLabel: string | null;
  enabled: boolean;
}) {
  if (!enabled) return null;
  return (
    <DragOverlay>
      {draggingLabel ? (
        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-solid)] px-3 py-2 text-sm shadow-xl">
          {draggingLabel}
        </div>
      ) : null}
    </DragOverlay>
  );
}

/** 根据浮层中心相对目标中心决定前后插入，避免依赖 WebView2 中不稳定的原生 Drag API。 */
export function resolveDropPosition(
  event: Pick<DragEndEvent, "active" | "over">,
): "before" | "after" {
  const overRect = event.over?.rect;
  const activeRect = event.active.rect.current.translated;
  if (!overRect || !activeRect) return "after";
  return activeRect.left < overRect.left + overRect.width / 2
    ? "before"
    : "after";
}

/** pointerWithin 优先具体按钮或 gap，键盘和无指针场景再回退最近中心。 */
export const terminalTabCollisionDetection: CollisionDetection = (args) => {
  const collisions = pointerWithin(args);
  if (collisions.length === 0) return closestCenter(args);
  const prioritizedIds = new Set(
    prioritizeTerminalTabPointerTargetIds(
      collisions.map(({ id }) => String(id)),
    ),
  );
  return collisions.filter(({ id }) => prioritizedIds.has(String(id)));
};
