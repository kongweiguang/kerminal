// @author kongweiguang

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import type {
  ResolvedTheme,
  TerminalAppearance,
} from "../settings/contracts/index";
import type {
  MachineGroup,
  TerminalPane,
  TerminalTab,
  TerminalSplitDirection,
  TerminalSplitLayoutSizes,
} from "../workspace/contracts/index";
import { isTerminalSessionTab } from "../workspace/contracts/index";
import { collectPaneIds } from "../workspace/contracts/index";
import { cn } from "../../lib/cn";
import { TerminalEmptyState } from "./TerminalEmptyState";
import {
  TerminalPaneMoveDragPreview,
  TerminalPaneMoveOverlay,
  terminalPaneMoveIndicatorLabel,
  type TerminalPaneMoveIndicator,
} from "./TerminalPaneMoveOverlay";
import { TerminalPaneErrorBoundary } from "./TerminalPaneErrorBoundary";
import { TerminalPaneLayout } from "./TerminalPaneLayout";
import {
  TerminalSplitDropOverlay,
  type TerminalSplitDropIndicator,
} from "./TerminalSplitDropOverlay";
import {
  resolveTerminalPaneMoveDropTarget,
  resolveTerminalPaneMoveWorkspaceDropTarget,
  type TerminalPaneMoveDropCandidate,
  type TerminalPaneMoveScope,
  type TerminalPaneMoveDropTarget,
  type TerminalPaneMoveDropZone,
} from "./terminalPaneMoveDropZones";
import type { TerminalSplitPaneOptions } from "./terminalSplitTargets";
import { XtermPane } from "./XtermPane";
import type { ConnectionState } from "./XtermPane.helpers";

const terminalPaneCardAttribute = "data-terminal-pane-card";
const PANE_MOVE_DRAG_THRESHOLD_PX = 6;

interface TerminalRuntimePane {
  active: boolean;
  pane: TerminalPane;
  tabId: string;
}

interface TerminalPaneRuntimeSlot {
  active: boolean;
  element: HTMLElement;
}

interface TerminalPaneMoveDragState {
  active: boolean;
  currentX: number;
  currentY: number;
  originX: number;
  originY: number;
  pointerId: number;
  sourcePaneId: string;
}

interface TerminalWorkspaceContentProps {
  activeTab: TerminalTab | undefined;
  contentInsetStyle?: CSSProperties;
  focusedPaneId: string;
  machineGroups?: MachineGroup[];
  onClosePane: (paneId: string) => void;
  onCreateTerminal?: () => void;
  onFocusPane: (paneId: string) => void;
  onOpenAgentTool?: () => void;
  onOpenConnection?: () => void;
  onOpenLogs?: () => void;
  onMovePane?: (
    sourcePaneId: string,
    targetPaneId: string,
    placement: TerminalPaneMoveDropZone,
    scope?: TerminalPaneMoveScope,
  ) => void;
  onPaneConnectionStateChange?: (
    paneId: string,
    state: ConnectionState,
  ) => void;
  onPaneCurrentCwdChange?: (paneId: string, cwd: string) => void;
  onPaneOutputHistoryChange?: (
    paneId: string,
    outputHistory: string | undefined,
  ) => void;
  onSplitLayoutSizesChange?: (
    splitId: string,
    sizes: TerminalSplitLayoutSizes,
  ) => void;
  onSplitPane: (
    direction: TerminalSplitDirection,
    options?: TerminalSplitPaneOptions,
  ) => void;
  panesById: Map<string, TerminalPane>;
  resolvePaneLines?: (paneId: string) => string[];
  resolvePaneOutputHistory?: (paneId: string) => string | undefined;
  renderCustomTab?: (tab: TerminalTab, active: boolean) => ReactNode;
  resolvedTheme: ResolvedTheme;
  splitDropIndicator?: TerminalSplitDropIndicator | null;
  tabs: TerminalTab[];
  terminalAppearance: TerminalAppearance;
  terminalInset: number;
  workspacePaddingClass: string;
}

export function TerminalWorkspaceContent({
  activeTab,
  contentInsetStyle,
  focusedPaneId,
  machineGroups,
  onClosePane,
  onCreateTerminal,
  onFocusPane,
  onOpenAgentTool,
  onOpenConnection,
  onOpenLogs,
  onMovePane,
  onPaneConnectionStateChange,
  onPaneCurrentCwdChange,
  onPaneOutputHistoryChange,
  onSplitLayoutSizesChange,
  onSplitPane,
  panesById,
  resolvePaneLines,
  resolvePaneOutputHistory,
  renderCustomTab,
  resolvedTheme,
  splitDropIndicator,
  tabs,
  terminalAppearance,
  terminalInset,
  workspacePaddingClass,
}: TerminalWorkspaceContentProps) {
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const [runtimeSlots, setRuntimeSlots] = useState<
    Record<string, TerminalPaneRuntimeSlot[]>
  >({});
  const [paneMoveDrag, setPaneMoveDrag] =
    useState<TerminalPaneMoveDragState | null>(null);
  const [paneMoveTarget, setPaneMoveTarget] =
    useState<TerminalPaneMoveDropTarget | null>(null);
  const paneMovePointerOwnerRef = useRef<HTMLButtonElement | null>(null);
  const runtimePanes = useMemo(
    () => resolveTerminalRuntimePanes(tabs, activeTab, panesById),
    [activeTab, panesById, tabs],
  );
  const activePaneIds = useMemo(
    () => (isTerminalSessionTab(activeTab) ? collectPaneIds(activeTab.layout) : []),
    [activeTab],
  );
  const registerRuntimeSlot = useCallback(
    (paneId: string, element: HTMLElement | null, active: boolean) => {
      setRuntimeSlots((current) => {
        if (!element) {
          return current;
        }
        const existingSlots = current[paneId] ?? [];
        const slotsWithoutElement = existingSlots.filter(
          (slot) => slot.element !== element,
        );
        const nextSlots = [...slotsWithoutElement, { active, element }];
        if (nextSlots.length === existingSlots.length) {
          const unchanged =
            nextSlots.length === 0 ||
            nextSlots.every((slot, index) => {
              const currentSlot = existingSlots[index];
              return (
                currentSlot?.element === slot.element &&
                currentSlot.active === slot.active
              );
            });
          if (unchanged) {
            return current;
          }
        }
        const next = { ...current };
        if (nextSlots.length > 0) {
          next[paneId] = nextSlots;
        } else {
          delete next[paneId];
        }
        return next;
      });
    },
    [],
  );
  const paneMoveIndicator = useMemo<TerminalPaneMoveIndicator | null>(() => {
    if (!paneMoveDrag?.active || !paneMoveTarget) {
      return null;
    }
    const targetTitle = panesById.get(paneMoveTarget.paneId)?.title;
    if (paneMoveTarget.scope === "pane" && !targetTitle) {
      return null;
    }
    return {
      scope: paneMoveTarget.scope,
      targetTitle,
      zone: paneMoveTarget.zone,
    };
  }, [paneMoveDrag, paneMoveTarget, panesById]);
  const paneMoveSourcePane = paneMoveDrag?.active
    ? panesById.get(paneMoveDrag.sourcePaneId)
    : undefined;
  const paneMovePreviewLines =
    paneMoveDrag?.active && paneMoveDrag.sourcePaneId
      ? (resolvePaneLines?.(paneMoveDrag.sourcePaneId) ??
          paneMoveSourcePane?.lines ??
          [])
      : [];
  const paneMovePreview =
    paneMoveDrag?.active && typeof document !== "undefined"
      ? createPortal(
          <TerminalPaneMoveDragPreview
            hint={
              paneMoveIndicator
                ? terminalPaneMoveIndicatorLabel(paneMoveIndicator)
                : undefined
            }
            lines={paneMovePreviewLines}
            title={paneMoveSourcePane?.title ?? "终端分屏"}
            x={paneMoveDrag.currentX}
            y={paneMoveDrag.currentY}
          />,
          document.body,
        )
      : null;
  const releasePaneMovePointerCapture = useCallback((pointerId?: number) => {
    const pointerOwner = paneMovePointerOwnerRef.current;
    if (
      pointerOwner &&
      pointerId !== undefined &&
      pointerOwner.hasPointerCapture?.(pointerId)
    ) {
      pointerOwner.releasePointerCapture(pointerId);
    }
    paneMovePointerOwnerRef.current = null;
  }, []);
  const resolvePaneMoveTarget = useCallback(
    (
      sourcePaneId: string,
      point: { clientX: number; clientY: number },
    ): TerminalPaneMoveDropTarget | null => {
      const workspace = workspaceRef.current;
      if (!workspace) {
        return null;
      }

      const workspaceTarget = resolveTerminalPaneMoveWorkspaceDropTarget(
        activePaneIds,
        sourcePaneId,
        workspace.getBoundingClientRect(),
        point,
        { inset: 96 },
      );
      if (workspaceTarget) {
        return workspaceTarget;
      }

      const candidates: TerminalPaneMoveDropCandidate[] = [];
      workspace
        .querySelectorAll<HTMLElement>(`[${terminalPaneCardAttribute}]`)
        .forEach((card) => {
          const paneId = card.dataset.terminalPaneCard;
          if (!paneId || !activePaneIds.includes(paneId)) {
            return;
          }
          candidates.push({ paneId, rect: card.getBoundingClientRect() });
        });

      return resolveTerminalPaneMoveDropTarget(candidates, sourcePaneId, point);
    },
    [activePaneIds],
  );
  const cancelPaneMoveDrag = useCallback((pointerId?: number) => {
    releasePaneMovePointerCapture(pointerId);
    setPaneMoveDrag(null);
    setPaneMoveTarget(null);
  }, [releasePaneMovePointerCapture]);

  const beginPaneMoveDrag = useCallback(
    (paneId: string, event: ReactPointerEvent<HTMLButtonElement>) => {
      if (
        !onMovePane ||
        activePaneIds.length <= 1 ||
        !activePaneIds.includes(paneId)
      ) {
        return;
      }

      setPaneMoveDrag({
        active: false,
        currentX: event.clientX,
        currentY: event.clientY,
        originX: event.clientX,
        originY: event.clientY,
        pointerId: event.pointerId,
        sourcePaneId: paneId,
      });
      setPaneMoveTarget(null);
      event.currentTarget.setPointerCapture?.(event.pointerId);
      paneMovePointerOwnerRef.current = event.currentTarget;
    },
    [activePaneIds, onMovePane],
  );

  useEffect(() => {
    cancelPaneMoveDrag();
  }, [activeTab?.id, cancelPaneMoveDrag]);

  useEffect(() => {
    if (!paneMoveDrag || !onMovePane) {
      return undefined;
    }

    const handleWindowBlur = () => cancelPaneMoveDrag(paneMoveDrag.pointerId);

    const movedFarEnough = (event: PointerEvent) =>
      paneMoveDrag.active ||
      Math.hypot(
        event.clientX - paneMoveDrag.originX,
        event.clientY - paneMoveDrag.originY,
      ) >= PANE_MOVE_DRAG_THRESHOLD_PX;

    const updateTarget = (event: PointerEvent) => {
      const target = resolvePaneMoveTarget(paneMoveDrag.sourcePaneId, {
        clientX: event.clientX,
        clientY: event.clientY,
      });
      setPaneMoveTarget(target);
      return target;
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (event.pointerId !== paneMoveDrag.pointerId) {
        return;
      }
      if (!movedFarEnough(event)) {
        return;
      }

      event.preventDefault();
      setPaneMoveDrag((current) =>
        current?.pointerId === paneMoveDrag.pointerId
          ? {
              ...current,
              active: true,
              currentX: event.clientX,
              currentY: event.clientY,
            }
          : current,
      );
      updateTarget(event);
    };

    const handlePointerUp = (event: PointerEvent) => {
      if (event.pointerId !== paneMoveDrag.pointerId) {
        return;
      }

      event.preventDefault();
      const target = movedFarEnough(event) ? updateTarget(event) : null;
      if (target) {
        onMovePane(
          paneMoveDrag.sourcePaneId,
          target.paneId,
          target.zone,
          target.scope,
        );
      }
      cancelPaneMoveDrag(paneMoveDrag.pointerId);
    };

    const handlePointerCancel = (event: PointerEvent) => {
      if (event.pointerId === paneMoveDrag.pointerId) {
        cancelPaneMoveDrag(paneMoveDrag.pointerId);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        cancelPaneMoveDrag(paneMoveDrag.pointerId);
      }
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerCancel);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("blur", handleWindowBlur);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerCancel);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("blur", handleWindowBlur);
      releasePaneMovePointerCapture(paneMoveDrag.pointerId);
    };
  }, [
    cancelPaneMoveDrag,
    onMovePane,
    paneMoveDrag,
    releasePaneMovePointerCapture,
    resolvePaneMoveTarget,
  ]);

  return (
    <div
      className={cn(
        "relative min-h-0 flex-1 transition-[margin-right] duration-200 ease-out",
        workspacePaddingClass,
      )}
      data-terminal-workspace-content
      ref={workspaceRef}
      style={contentInsetStyle}
    >
      {splitDropIndicator ? (
        <TerminalSplitDropOverlay indicator={splitDropIndicator} />
      ) : null}
      {paneMoveIndicator ? (
        <TerminalPaneMoveOverlay indicator={paneMoveIndicator} />
      ) : null}
      {paneMovePreview}
      {runtimePanes.map(({ active, pane, tabId }) => {
        const slot = resolveRuntimeSlot(runtimeSlots[pane.id], active);
        if (!slot) {
          return null;
        }

        return (
          <TerminalRuntimePortal
            focused={active && pane.id === focusedPaneId}
            key={pane.id}
            onFocusPane={onFocusPane}
            onOpenLogs={onOpenLogs}
            onPaneConnectionStateChange={onPaneConnectionStateChange}
            onPaneCurrentCwdChange={onPaneCurrentCwdChange}
            onPaneOutputHistoryChange={onPaneOutputHistoryChange}
            onSplitPane={onSplitPane}
            pane={pane}
            resolvePaneOutputHistory={resolvePaneOutputHistory}
            resolvedTheme={resolvedTheme}
            slot={slot}
            tabId={tabId}
            terminalAppearance={terminalAppearance}
          />
        );
      })}
      {tabs.length > 0 ? (
        tabs.map((tab) => {
          const active = tab.id === activeTab?.id;
          return (
            <div
              aria-hidden={!active || undefined}
              className={cn(
                "absolute min-h-0",
                active
                  ? "pointer-events-auto z-10"
                  : "pointer-events-none invisible z-0",
              )}
              key={tab.id}
              style={{ inset: terminalInset }}
            >
              {isTerminalSessionTab(tab) ? (
                <TerminalPaneLayout
                  focusedPaneId={active ? focusedPaneId : ""}
                  draggingPaneId={
                    paneMoveDrag?.active ? paneMoveDrag.sourcePaneId : undefined
                  }
                  layout={tab.layout}
                  machineGroups={machineGroups}
                  panelGroupId={tab.id}
                  onBeginPaneDrag={
                    active && onMovePane && activePaneIds.length > 1
                      ? beginPaneMoveDrag
                      : undefined
                  }
                  onClosePane={onClosePane}
                  onConnectionStateChange={onPaneConnectionStateChange}
                  onCurrentCwdChange={onPaneCurrentCwdChange}
                  onFocusPane={onFocusPane}
                  onOpenLogs={onOpenLogs}
                  onOutputHistoryChange={onPaneOutputHistoryChange}
                  onSplitLayoutSizesChange={onSplitLayoutSizesChange}
                  onSplitPane={onSplitPane}
                  panesById={panesById}
                  resolvePaneLines={resolvePaneLines}
                  resolvePaneOutputHistory={resolvePaneOutputHistory}
                  resolvedTheme={resolvedTheme}
                  runtimeMount="slot"
                  runtimeSlotsActive={active}
                  terminalAppearance={terminalAppearance}
                  onRuntimeSlotChange={registerRuntimeSlot}
                />
              ) : (
                (renderCustomTab?.(tab, active) ?? (
                  <div className="kerminal-solid-surface flex h-full items-center justify-center rounded-[var(--radius-card)] border text-sm text-zinc-500 dark:text-zinc-400">
                    此标签暂不可用。
                  </div>
                ))
              )}
            </div>
          );
        })
      ) : (
        <TerminalEmptyState
          onCreateTerminal={onCreateTerminal}
          onOpenAgentTool={onOpenAgentTool}
          onOpenConnection={onOpenConnection}
        />
      )}
    </div>
  );
}

interface TerminalRuntimePortalProps {
  focused: boolean;
  onFocusPane: (paneId: string) => void;
  onOpenLogs?: () => void;
  onPaneConnectionStateChange?: (
    paneId: string,
    state: ConnectionState,
  ) => void;
  onPaneCurrentCwdChange?: (paneId: string, cwd: string) => void;
  onPaneOutputHistoryChange?: (
    paneId: string,
    outputHistory: string | undefined,
  ) => void;
  onSplitPane: (
    direction: TerminalSplitDirection,
    options?: TerminalSplitPaneOptions,
  ) => void;
  pane: TerminalPane;
  resolvePaneOutputHistory?: (paneId: string) => string | undefined;
  resolvedTheme: ResolvedTheme;
  slot: TerminalPaneRuntimeSlot;
  tabId: string;
  terminalAppearance: TerminalAppearance;
}

function TerminalRuntimePortal({
  focused,
  onFocusPane,
  onOpenLogs,
  onPaneConnectionStateChange,
  onPaneCurrentCwdChange,
  onPaneOutputHistoryChange,
  onSplitPane,
  pane,
  resolvePaneOutputHistory,
  resolvedTheme,
  slot,
  tabId,
  terminalAppearance,
}: TerminalRuntimePortalProps) {
  const hostRef = useRef<HTMLElement | null>(null);
  if (!hostRef.current && typeof document !== "undefined") {
    const host = document.createElement("div");
    host.className = "flex h-full min-h-0 w-full";
    host.dataset.terminalPaneRuntimeHost = pane.id;
    hostRef.current = host;
  }

  const host = hostRef.current;
  useLayoutEffect(() => {
    if (!host) {
      return undefined;
    }

    host.dataset.terminalPaneRuntimeHost = pane.id;
    host.className = "flex h-full min-h-0 w-full";
    if (host.parentElement !== slot.element) {
      slot.element.append(host);
    }

    return () => {
      if (host.parentElement === slot.element) {
        host.remove();
      }
    };
  }, [host, pane.id, slot.element]);

  const splitPane = useCallback(
    (direction: TerminalSplitDirection, options?: TerminalSplitPaneOptions) => {
      const splitOptions = { ...options, sourcePaneId: pane.id };
      onFocusPane(pane.id);
      onSplitPane(direction, splitOptions);
    },
    [onFocusPane, onSplitPane, pane.id],
  );

  if (!host) {
    return null;
  }

  return createPortal(
    <TerminalPaneErrorBoundary onOpenLogs={onOpenLogs} pane={pane}>
      <XtermPane
        args={pane.args}
        currentCwd={pane.currentCwd}
        cwd={pane.cwd}
        env={pane.env}
        focused={focused}
        paneId={pane.id}
        profileId={pane.profileId}
        remoteCommand={pane.remoteCommand}
        remoteHostId={pane.remoteHostId}
        onConnectionStateChange={(state) =>
          onPaneConnectionStateChange?.(pane.id, state)
        }
        onCurrentCwdChange={(cwd) => onPaneCurrentCwdChange?.(pane.id, cwd)}
        onOpenLogs={onOpenLogs}
        onOutputHistoryChange={(outputHistory) =>
          onPaneOutputHistoryChange?.(pane.id, outputHistory)
        }
        onSplitPane={splitPane}
        outputHistory={pane.outputHistory}
        resolveInitialOutputHistory={() =>
          resolvePaneOutputHistory?.(pane.id) ?? pane.outputHistory
        }
        resolvedTheme={resolvedTheme}
        shell={pane.shell}
        target={pane.target}
        tabId={tabId}
        terminalAppearance={terminalAppearance}
        title={pane.title}
        visible={slot.active}
      />
    </TerminalPaneErrorBoundary>,
    host,
    pane.id,
  );
}

function resolveRuntimeSlot(
  slots: TerminalPaneRuntimeSlot[] | undefined,
  active: boolean,
) {
  if (!slots?.length) {
    return undefined;
  }
  if (active) {
    return findLastRuntimeSlot(slots, true) ?? slots[slots.length - 1];
  }
  return findLastRuntimeSlot(slots, false) ?? slots[slots.length - 1];
}

function findLastRuntimeSlot(
  slots: TerminalPaneRuntimeSlot[],
  active: boolean,
) {
  for (let index = slots.length - 1; index >= 0; index -= 1) {
    if (slots[index].active === active) {
      return slots[index];
    }
  }
  return undefined;
}

function resolveTerminalRuntimePanes(
  tabs: TerminalTab[],
  activeTab: TerminalTab | undefined,
  panesById: Map<string, TerminalPane>,
): TerminalRuntimePane[] {
  const activePaneIds = new Set(
    isTerminalSessionTab(activeTab) ? collectPaneIds(activeTab.layout) : [],
  );
  const runtimePanes: TerminalRuntimePane[] = [];
  const seenPaneIds = new Set<string>();

  for (const tab of tabs) {
    if (!isTerminalSessionTab(tab)) {
      continue;
    }
    for (const paneId of collectPaneIds(tab.layout)) {
      if (seenPaneIds.has(paneId)) {
        continue;
      }
      seenPaneIds.add(paneId);
      const pane = panesById.get(paneId);
      if (pane) {
        runtimePanes.push({
          active: activePaneIds.has(paneId),
          pane,
          tabId: tab.id,
        });
      }
    }
  }

  return runtimePanes;
}
