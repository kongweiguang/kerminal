// @author kongweiguang

import { ChevronDown } from "lucide-react";
import {
  closestCenter,
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { useCallback, useMemo, useRef, useState } from "react";
import type {
  CSSProperties,
  MouseEvent as ReactMouseEvent,
  RefObject,
  WheelEvent as ReactWheelEvent,
} from "react";
import { cn } from "../../lib/cn";
import type { TerminalProfile } from "../../lib/profileApi";
import type { TerminalAppearance } from "../settings/contracts/index";
import type {
  MachineGroup,
  MachineStatus,
  TerminalTab,
  TerminalTabGroups,
  WorkspaceFileDirtyState,
} from "../workspace/contracts/index";
import {
  TerminalCreateButton,
  TerminalCreatePanel,
  type TerminalCreatePanelPosition,
} from "./TerminalCreateMenu";
import {
  buildTerminalCreateHostOptions,
  buildTerminalCreateProfileOptions,
} from "./terminalCreateMenuModel";
import {
  TerminalTabButton,
  TerminalTabGroupHeader,
  type TerminalTabContextMenuPayload,
  type TerminalTabDragActivatorProps,
  type TerminalTabGroup,
} from "./terminalTabChrome";
import {
  resolveTerminalTabGroupPresentation,
  resolveTerminalTabPresentation,
  type TerminalTabPresentation,
} from "./terminalTabPresentationModel";
import type {
  TerminalTabGroupMoveRequest,
  TerminalTabMoveRequest,
} from "../workspace/contracts/index";
import {
  prioritizeTerminalTabPointerTargetIds,
  resolveTerminalTabDragCommand,
  type TerminalTabDragSource,
  type TerminalTabDragTarget,
} from "./terminalTabDragModel";

interface TerminalTabBarProps {
  activeTabId: string;
  collapsedGroupIds: ReadonlySet<string>;
  heightClassName: string;
  machineGroups: readonly MachineGroup[];
  onOpenContextMenu: (
    event: ReactMouseEvent,
    payload: TerminalTabContextMenuPayload,
  ) => void;
  onCreateTerminal?: (profileId?: string) => void;
  onOpenConnection?: () => void;
  onOpenSavedTerminal?: (machineId: string) => void;
  onMoveTerminalTab?: (request: TerminalTabMoveRequest) => void;
  onMoveTerminalTabGroup?: (request: TerminalTabGroupMoveRequest) => void;
  onRequestCloseTab: (tabId: string) => void;
  onSelectTab: (tabId: string) => void;
  onToggleGroup: (groupId: string) => void;
  onToggleOverview: (event: ReactMouseEvent) => void;
  onWheel: (event: ReactWheelEvent<HTMLDivElement>) => void;
  overviewButtonRef: RefObject<HTMLButtonElement | null>;
  overviewOpen: boolean;
  profiles: readonly TerminalProfile[];
  rightTitleBarInset: number;
  shouldShowOverview: boolean;
  style?: CSSProperties;
  tabGroups: TerminalTabGroup[];
  terminalTabGroups?: TerminalTabGroups;
  tabListRef: RefObject<HTMLDivElement | null>;
  tabPresentationById: ReadonlyMap<string, TerminalTabPresentation>;
  tabs: TerminalTab[];
  tabStatusById: ReadonlyMap<string, MachineStatus>;
  terminalAppearance: TerminalAppearance;
  workspaceFileDirtyState: WorkspaceFileDirtyState;
}

/** 终端标签栏的纯展示与命令转发层，避免工作区组件继续膨胀。 */
export function TerminalTabBar({
  activeTabId,
  collapsedGroupIds,
  heightClassName,
  machineGroups,
  onCreateTerminal,
  onOpenConnection,
  onOpenContextMenu,
  onOpenSavedTerminal,
  onMoveTerminalTab,
  onMoveTerminalTabGroup,
  onRequestCloseTab,
  onSelectTab,
  onToggleGroup,
  onToggleOverview,
  onWheel,
  overviewButtonRef,
  overviewOpen,
  profiles,
  rightTitleBarInset,
  shouldShowOverview,
  style,
  tabGroups,
  tabListRef,
  tabPresentationById,
  tabs,
  tabStatusById,
  terminalAppearance,
  workspaceFileDirtyState,
}: TerminalTabBarProps) {
  const createButtonRef = useRef<HTMLButtonElement>(null);
  const [createPanelPosition, setCreatePanelPosition] =
    useState<TerminalCreatePanelPosition | null>(null);
  const [draggingLabel, setDraggingLabel] = useState<string | null>(null);
  const [dragAnnouncement, setDragAnnouncement] = useState("");
  // 单个未分组 Tab 没有可执行的排序动作，避免为旧兼容渲染路径注入
  // dnd-kit 的全局 role=status live region；出现第二个 Tab 或显式组后再启用完整拖拽上下文。
  const dragEnabled =
    tabs.length > 1 || tabGroups.some((group) => group.grouped);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );
  const hostCreateOptions = useMemo(
    () => buildTerminalCreateHostOptions(machineGroups),
    [machineGroups],
  );
  const profileCreateOptions = useMemo(
    () => buildTerminalCreateProfileOptions(profiles),
    [profiles],
  );
  const canOpenCreatePanel = Boolean(
    profileCreateOptions.length > 0 ||
      hostCreateOptions.length > 0 ||
      onOpenConnection,
  );
  /** 关闭由 TabBar 持有的面板，使按钮迁移时不会绑定到失效组件状态。 */
  const closeCreatePanel = useCallback(() => {
    setCreatePanelPosition(null);
  }, []);
  /** 记录拖拽开始；PointerSensor 自己负责拦截 pointerup 后的即时 click。 */
  const handleDragStart = useCallback((event: DragStartEvent) => {
    const data = event.active.data.current as { label?: string } | undefined;
    setDraggingLabel(data?.label ?? "标签");
  }, []);
  /** 取消拖拽只清理浮层，不能额外吞掉下一次普通点击。 */
  const handleDragCancel = useCallback(() => {
    setDraggingLabel(null);
  }, []);
  /**
   * 在 drop 前同步宣告候选目标，让键盘/辅助技术用户知道当前会移入哪组或哪一位；
   * 这里只更新 aria-live，不提前改 store，取消或过期 drop 仍保持纯 no-op。
   */
  const handleDragOver = useCallback((event: DragOverEvent) => {
    const activeData = event.active.data.current as
      | { kind?: "tab" | "group"; tabId?: string; groupId?: string }
      | undefined;
    const overData = event.over?.data.current as
      | {
          kind?: "tab" | "group" | "gap";
          label?: string;
          tabId?: string;
          groupId?: string;
          index?: number;
        }
      | undefined;
    if (!activeData?.kind || !overData?.kind) return;
    const position = resolveDropPosition(event);
    if (activeData.kind === "tab" && activeData.tabId) {
      if (overData.kind === "gap") {
        setDragAnnouncement(`移出分组，移动到第 ${(overData.index ?? 0) + 1} 位`);
      } else if (overData.kind === "group" && overData.groupId) {
        setDragAnnouncement(`移入标签组 ${overData.label ?? overData.groupId}`);
      } else if (overData.kind === "tab" && overData.tabId) {
        setDragAnnouncement(
          `移动到标签 ${overData.label ?? overData.tabId} ${position === "before" ? "前" : "后"}`,
        );
      }
    } else if (activeData.kind === "group" && activeData.groupId) {
      if (overData.kind === "gap") {
        setDragAnnouncement(`移动标签组到第 ${(overData.index ?? 0) + 1} 位`);
      } else if (overData.kind === "group" && overData.groupId) {
        setDragAnnouncement(
          `移动标签组到 ${overData.label ?? overData.groupId} ${position === "before" ? "前" : "后"}`,
        );
      } else if (overData.kind === "tab" && overData.tabId) {
        setDragAnnouncement(
          `移动标签组到 ${overData.label ?? overData.tabId} ${position === "before" ? "前" : "后"}`,
        );
      }
    }
  }, []);
  /** 组拖到成员 Tab 时仍按顶层块解析，不能把整组误并入目标组。 */
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setDraggingLabel(null);
      const activeData = event.active.data.current as
        | (TerminalTabDragSource & { label?: string })
        | undefined;
      const overData = event.over?.data.current as
        | (TerminalTabDragTarget & { label?: string })
        | undefined;
      if (!activeData?.kind || !overData?.kind) return;
      const position = resolveDropPosition(event);
      const command = resolveTerminalTabDragCommand({
        active: activeData,
        over: overData,
        position,
        tabGroups: tabGroups.map((group) => ({
          grouped: group.grouped,
          id: group.id,
          tabs: group.tabs,
        })),
        tabs,
      });
      if (!command) return;
      if ("tabId" in command) {
        onMoveTerminalTab?.(command);
      } else {
        onMoveTerminalTabGroup?.(command);
      }
      if (overData.kind === "gap") {
        setDragAnnouncement(
          `${activeData.kind === "group" ? "移动标签组" : "移出分组，移动标签"}到第 ${(overData.index ?? 0) + 1} 位`,
        );
      } else if (overData.kind === "group") {
        setDragAnnouncement(`移入标签组 ${overData.label ?? overData.groupId}`);
      } else {
        setDragAnnouncement(
          `移动到标签 ${overData.label ?? overData.tabId} ${position === "before" ? "前" : "后"}`,
        );
      }
    },
    [onMoveTerminalTab, onMoveTerminalTabGroup, tabGroups, tabs],
  );
  /** 键盘排序按当前层级解析：组内 Tab 只换组内位置，未分组 Tab 在顶层移动。 */
  const handleTabListKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (!event.ctrlKey || !event.shiftKey) return;
      if (event.key !== "PageUp" && event.key !== "PageDown") return;
      const target = event.target as HTMLElement;
      const tabId = target.closest<HTMLElement>("[data-terminal-tab-id]")?.dataset
        .terminalTabId;
      const groupId = target.closest<HTMLElement>("[data-terminal-tab-group-id]")
        ?.dataset.terminalTabGroupId;
      const direction = event.key === "PageUp" ? "before" : "after";
      if (tabId) {
        const group = tabGroups.find((candidate) =>
          candidate.tabs.some((tab) => tab.id === tabId),
        );
        if (group?.grouped) {
          const index = group.tabs.findIndex((tab) => tab.id === tabId);
          const sibling = group.tabs[index + (direction === "before" ? -1 : 1)];
          if (sibling) {
            event.preventDefault();
            onMoveTerminalTab?.({
              position: direction,
              tabId,
              targetGroupId: group.id,
              targetTabId: sibling.id,
            });
          }
        } else if (group) {
          const groupIndex = tabGroups.findIndex(
            (candidate) => candidate.id === group.id,
          );
          const siblingGroup =
            tabGroups[groupIndex + (direction === "before" ? -1 : 1)];
          const siblingTab = siblingGroup?.tabs[0];
          if (siblingTab) {
            event.preventDefault();
            if (siblingGroup.grouped) {
              const siblingStartIndex = tabs.findIndex(
                (tab) => tab.id === siblingTab.id,
              );
              onMoveTerminalTab?.({
                tabId,
                targetGroupId: null,
                targetIndex:
                  siblingStartIndex +
                  (direction === "after" ? siblingGroup.tabs.length : 0),
              });
            } else {
              onMoveTerminalTab?.({
                position: direction,
                tabId,
                targetGroupId: null,
                targetTabId: siblingTab.id,
              });
            }
          }
        }
      } else if (groupId) {
        const index = tabGroups.findIndex((group) => group.id === groupId);
        const sibling = tabGroups[index + (direction === "before" ? -1 : 1)];
        if (sibling) {
          event.preventDefault();
          onMoveTerminalTabGroup?.({
            groupId,
            position: direction,
            ...(sibling.grouped
              ? { targetGroupId: sibling.id }
              : {
                  targetIndex: tabs.findIndex(
                    (tab) => tab.id === sibling.tabs[0]?.id,
                  ) + (direction === "after" ? 1 : 0),
                }),
          });
        }
      }
    },
    [onMoveTerminalTab, onMoveTerminalTabGroup, tabGroups, tabs],
  );

  return (
    <>
      <MaybeDndContext
        collisionDetection={terminalTabCollisionDetection}
        enabled={dragEnabled}
        onDragCancel={handleDragCancel}
        onDragEnd={handleDragEnd}
        onDragOver={handleDragOver}
        onDragStart={handleDragStart}
        sensors={sensors}
      >
      <MaybeSortableContext
        enabled={dragEnabled}
        items={tabGroups.flatMap((group) =>
          group.grouped
            ? [`group:${group.id}`]
            : group.tabs.map((tab) => `tab:${tab.id}`),
        )}
        strategy={horizontalListSortingStrategy}
      >
      <div
        className={cn(
          "kerminal-material-nav relative z-20 flex items-center border-b border-[var(--border-subtle)] shadow-[inset_0_-1px_0_var(--border-subtle)]",
          heightClassName,
        )}
        style={{ ...style, paddingRight: rightTitleBarInset }}
      >
      <div className="flex min-w-0 flex-1 items-center self-stretch">
        <div
          aria-label="终端标签栏"
          className="scrollbar-none flex min-w-0 max-w-full flex-[0_1_auto] items-center gap-1 overflow-x-auto overflow-y-hidden overscroll-x-contain"
          onWheel={onWheel}
          onKeyDown={handleTabListKeyDown}
          ref={tabListRef}
        >
        <DropGap disabled={!dragEnabled} index={0} />
        {tabGroups.map((group) => {
          const collapsed = collapsedGroupIds.has(group.id);
          const groupActive = group.tabs.some(
            (tab) => tab.id === activeTabId,
          );
          const groupPresentation = resolveTerminalTabGroupPresentation(
            group.tabs.map(
              (tab) =>
                tabPresentationById.get(tab.id) ??
                resolveTerminalTabPresentation([]),
            ),
            !collapsed,
          );
          const groupStartIndex = Math.max(
            0,
            tabs.findIndex((tab) => tab.id === group.tabs[0]?.id),
          );
          if (!group.grouped) {
            return group.tabs.flatMap((tab) => [
              <DraggableTabItem
                disabled={!dragEnabled}
                groupId={undefined}
                key={tab.id}
                label={tab.title}
                tabId={tab.id}
              >
                {(dragProps) => (
                  <TerminalTabButton
                    {...dragProps}
                    active={tab.id === activeTabId}
                    identityAccent={group.identityAccent}
                    onCloseTab={onRequestCloseTab}
                    onContextMenu={(event) =>
                      onOpenContextMenu(event, { tabId: tab.id, type: "tab" })
                    }
                    onSelectTab={onSelectTab}
                    presentation={tabPresentationById.get(tab.id)}
                    showClose
                    status={tabStatusById.get(tab.id)}
                    tab={tab}
                    tabNumber={
                      terminalAppearance.showTabNumbers
                        ? tabs.findIndex((candidate) => candidate.id === tab.id) + 1
                        : undefined
                    }
                    workspaceFileDirty={workspaceFileDirtyState[tab.id]}
                  />
                )}
              </DraggableTabItem>,
              <DropGap
                disabled={!dragEnabled}
                index={tabs.findIndex((candidate) => candidate.id === tab.id) + 1}
                key={`gap:tab:${tab.id}`}
              />,
            ]);
          }

          return [
            (
            <DraggableGroupItem
              disabled={!dragEnabled}
              groupId={group.id}
              key={group.id}
              label={group.title}
            >
              {(dragProps) => (
                <div className="relative flex h-9 shrink-0 items-center gap-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-solid)] px-1 shadow-sm shadow-black/5 dark:shadow-black/20">
                  <TerminalTabGroupHeader
                    {...dragProps}
                    active={collapsed && groupActive}
                    collapsed={collapsed}
                    group={group}
                    onContextMenu={(event) =>
                      onOpenContextMenu(event, { groupId: group.id, type: "group" })
                    }
                    onToggle={() => onToggleGroup(group.id)}
                    presentation={groupPresentation}
                  />
                  {!collapsed ? (
                    <MaybeSortableContext
                      enabled={dragEnabled}
                      items={group.tabs.map((tab) => `tab:${tab.id}`)}
                      strategy={horizontalListSortingStrategy}
                    >
                      {group.tabs.map((tab) => (
                        <DraggableTabItem
                          disabled={!dragEnabled}
                          groupId={group.id}
                          key={tab.id}
                          label={tab.title}
                          tabId={tab.id}
                        >
                          {(tabDragProps) => (
                            <TerminalTabButton
                              {...tabDragProps}
                              active={tab.id === activeTabId}
                              compact
                              onCloseTab={onRequestCloseTab}
                              onContextMenu={(event) =>
                                onOpenContextMenu(event, {
                                  tabId: tab.id,
                                  type: "tab",
                                })
                              }
                              onSelectTab={onSelectTab}
                              presentation={tabPresentationById.get(tab.id)}
                              showClose
                              status={tabStatusById.get(tab.id)}
                              tab={tab}
                              tabNumber={
                                terminalAppearance.showTabNumbers
                                  ? tabs.findIndex(
                                      (candidate) => candidate.id === tab.id,
                                    ) + 1
                                  : undefined
                              }
                              workspaceFileDirty={workspaceFileDirtyState[tab.id]}
                            />
                          )}
                        </DraggableTabItem>
                      ))}
                    </MaybeSortableContext>
                  ) : null}
                </div>
              )}
            </DraggableGroupItem>
            ),
            <DropGap
              disabled={!dragEnabled}
              index={groupStartIndex + group.tabs.length}
              key={`gap:${group.id}`}
            />,
          ];
        })}
        {!shouldShowOverview ? (
          <TerminalCreateButton
            buttonRef={createButtonRef}
            canOpenPanel={canOpenCreatePanel}
            onCreateDefault={onCreateTerminal}
            onRequestOpen={setCreatePanelPosition}
            panelOpen={Boolean(createPanelPosition)}
            placement="inline"
          />
        ) : null}
        </div>
        <div
          aria-hidden="true"
          className="h-full min-w-3 flex-1"
          data-tauri-drag-region
        />
      </div>
      {shouldShowOverview ? (
        <div
          className="relative z-20 flex shrink-0 items-center gap-1 pl-1"
          data-terminal-tab-actions
        >
          <button
            aria-expanded={overviewOpen}
            aria-label="查看所有标签"
            className={cn(
              "kerminal-focus-ring kerminal-pressable kerminal-muted-surface flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-control)] border border-[var(--border-subtle)] text-[var(--text-secondary)] shadow-sm shadow-black/10 hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] dark:shadow-black/30",
              overviewOpen &&
                "border-sky-500/30 bg-[var(--surface-selected)] text-sky-700 dark:text-sky-100",
            )}
            onClick={onToggleOverview}
            ref={overviewButtonRef}
            title="查看所有标签"
            type="button"
          >
            <ChevronDown className="h-4 w-4" />
          </button>
          <TerminalCreateButton
            buttonRef={createButtonRef}
            canOpenPanel={canOpenCreatePanel}
            onCreateDefault={onCreateTerminal}
            onRequestOpen={setCreatePanelPosition}
            panelOpen={Boolean(createPanelPosition)}
            placement="fixed"
          />
        </div>
      ) : null}
      </div>
      </MaybeSortableContext>
      <div aria-live="polite" className="sr-only">
        {dragAnnouncement}
      </div>
      <MaybeDragOverlay enabled={dragEnabled} draggingLabel={draggingLabel} />
      </MaybeDndContext>
      {createPanelPosition ? (
        <TerminalCreatePanel
          hostOptions={hostCreateOptions}
          onClose={closeCreatePanel}
          onCreateProfile={onCreateTerminal}
          onOpenConnection={onOpenConnection}
          onOpenHost={onOpenSavedTerminal}
          position={createPanelPosition}
          profileOptions={profileCreateOptions}
          triggerRef={createButtonRef}
        />
      ) : null}
    </>
  );
}

/**
 * Tab 的拖拽壳只注册 droppable/排序矩阵，pointer listener 下沉到真实 Tab 按钮；
 * 这样关闭按钮、右键和普通点击不会启动父级拖拽，也不会增加无效键盘焦点。
 */
function DraggableTabItem({
  children,
  disabled = false,
  groupId,
  label,
  tabId,
}: {
  children: (props: TerminalTabDragActivatorProps) => React.ReactNode;
  disabled?: boolean;
  groupId?: string;
  label: string;
  tabId: string;
}) {
  if (disabled) {
    return (
      <div data-terminal-tab-id={tabId}>
        {children({})}
      </div>
    );
  }
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
}: {
  children: (props: TerminalTabDragActivatorProps) => React.ReactNode;
  groupId?: string;
  label: string;
  tabId: string;
}) {
  const id = `tab:${tabId}`;
  const sortable = useSortable({
    data: { groupId, kind: "tab", label, tabId },
    id,
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

/** 整组拖拽壳保持组成员连续，组头按钮是唯一的父级 activator。 */
function DraggableGroupItem({
  children,
  disabled = false,
  groupId,
  label,
}: {
  children: (props: TerminalTabDragActivatorProps) => React.ReactNode;
  disabled?: boolean;
  groupId: string;
  key?: string;
  label: string;
}) {
  if (disabled) {
    return (
      <div data-terminal-tab-group-id={groupId}>
        {children({})}
      </div>
    );
  }
  return (
    <DraggableGroupItemDnd groupId={groupId} label={label}>
      {children}
    </DraggableGroupItemDnd>
  );
}

/** 组头拖动仅注册父级排序节点，activator 绑定组头按钮避免嵌套成员抢事件。 */
function DraggableGroupItemDnd({
  children,
  groupId,
  label,
}: {
  children: (props: TerminalTabDragActivatorProps) => React.ReactNode;
  groupId: string;
  label: string;
}) {
  const id = `group:${groupId}`;
  const sortable = useSortable({
    data: { groupId, kind: "group", label },
    id,
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

/** 顶层间隙是唯一的“移出分组” drop target，避免未分组 Tab 互相覆盖隐式建组。 */
function DropGap({ disabled = false, index }: { disabled?: boolean; index: number }) {
  if (disabled) {
    return <DropGapView isOver={false} />;
  }
  return <DropGapDnd index={index} />;
}

/** 只有 dnd 上下文存在时注册间隙，避免单 Tab 渲染路径调用 context hook。 */
function DropGapDnd({ index }: { index: number }) {
  const { isOver, setNodeRef } = useDroppable({
    data: { index, kind: "gap" },
    id: `gap:${index}`,
  });
  return <DropGapView isOver={isOver} ref={setNodeRef} />;
}

/** 间隙的视觉层与 drop 注册层分离，保证禁用拖拽时仍保留稳定布局。 */
const DropGapView = ({
  isOver,
  ref,
}: {
  isOver: boolean;
  ref?: React.Ref<HTMLSpanElement>;
}) => (
  <span
    aria-hidden="true"
    className={cn(
      "h-8 w-2 shrink-0 rounded-full transition-colors",
      isOver ? "bg-sky-400/60" : "bg-transparent",
    )}
    ref={ref}
  />
);

/** 没有可拖拽项时不创建 dnd-kit live region，避免与业务 status 提示冲突。 */
function MaybeDndContext({
  children,
  enabled,
  ...props
}: React.ComponentProps<typeof DndContext> & { enabled: boolean }) {
  if (!enabled) return <>{children}</>;
  return <DndContext {...props}>{children}</DndContext>;
}

/** SortableContext 仅在 DndContext 已挂载时创建，保证兼容路径无需 dnd-kit context。 */
function MaybeSortableContext({
  children,
  enabled,
  ...props
}: React.ComponentProps<typeof SortableContext> & { enabled: boolean }) {
  if (!enabled) return <>{children}</>;
  return <SortableContext {...props}>{children}</SortableContext>;
}

/** DragOverlay 同样不能脱离 DndContext 使用，禁用路径直接返回空节点。 */
function MaybeDragOverlay({
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

/** 根据浮层中心相对目标中心决定前后插入，避免依赖不稳定的原生 Drag API。 */
function resolveDropPosition(
  event: Pick<DragEndEvent, "active" | "over">,
): "before" | "after" {
  const overRect = event.over?.rect;
  const activeRect = event.active.rect.current.translated;
  if (!overRect || !activeRect) return "after";
  return activeRect.left < overRect.left + overRect.width / 2
    ? "before"
    : "after";
}

/** pointerWithin 命中具体按钮或 gap 时优先使用它，键盘/无指针场景再回退最近中心。 */
const terminalTabCollisionDetection: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  if (pointerCollisions.length > 0) {
    const prioritizedIds = new Set(
      prioritizeTerminalTabPointerTargetIds(
        pointerCollisions.map((collision) => String(collision.id)),
      ),
    );
    return pointerCollisions.filter((collision) =>
      prioritizedIds.has(String(collision.id)),
    );
  }
  return closestCenter(args);
};
