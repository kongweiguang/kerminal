// @author kongweiguang

import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "../../components/ui/resizable";
import { Fragment } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type {
  ResolvedTheme,
  TerminalAppearance,
} from "../settings/contracts/index";
import type {
  MachineGroup,
  TerminalLayoutNode,
  TerminalPane,
  TerminalSplitDirection,
} from "../workspace/contracts/index";
import { TerminalPaneErrorBoundary } from "./TerminalPaneErrorBoundary";
import { TerminalPaneCard } from "./TerminalPaneCard";
import type { TerminalRuntimeSlotChangeHandler } from "./terminalRuntimeSlots";
import type { TerminalSplitPaneOptions } from "./terminalSplitTargets";
import type { ConnectionState } from "./XtermPane.helpers";

interface TerminalPaneLayoutProps {
  draggingPaneId?: string;
  focusedPaneId: string;
  layout: TerminalLayoutNode;
  machineGroups?: MachineGroup[];
  panelGroupId?: string;
  onClosePane: (paneId: string) => void;
  onBeginPaneDrag?: (
    paneId: string,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => void;
  onConnectionStateChange?: (paneId: string, state: ConnectionState) => void;
  onCurrentCwdChange?: (paneId: string, cwd: string) => void;
  onFocusPane: (paneId: string) => void;
  onOpenLogs?: () => void;
  onOutputHistoryChange?: (
    paneId: string,
    outputHistory: string | undefined,
  ) => void;
  onSplitLayoutSizesChange?: (
    splitId: string,
    sizes: Record<string, number>,
  ) => void;
  onSplitPane?: (
    direction: TerminalSplitDirection,
    options?: TerminalSplitPaneOptions,
  ) => void;
  panesById: Map<string, TerminalPane>;
  resolvePaneLines?: (paneId: string) => string[];
  resolvePaneOutputHistory?: (paneId: string) => string | undefined;
  resolvedTheme: ResolvedTheme;
  runtimeMount?: "inline" | "slot";
  runtimeSlotsActive?: boolean;
  terminalAppearance: TerminalAppearance;
  onRuntimeSlotChange?: TerminalRuntimeSlotChangeHandler;
}

type NormalizedTerminalSplitLayout = Extract<
  TerminalLayoutNode,
  { type: "split" }
>;

function normalizeRootLayout(
  layout: TerminalLayoutNode,
): NormalizedTerminalSplitLayout {
  if (layout.type === "split") {
    return layout;
  }

  return {
    children: [layout],
    direction: "horizontal",
    id: `root-${layout.paneId}`,
    type: "split",
  };
}

function TerminalPaneLayoutNode({
  draggingPaneId,
  focusedPaneId,
  layout,
  machineGroups,
  panelGroupId,
  onBeginPaneDrag,
  onClosePane,
  onConnectionStateChange,
  onCurrentCwdChange,
  onFocusPane,
  onOpenLogs,
  onOutputHistoryChange,
  onSplitLayoutSizesChange,
  onSplitPane,
  panesById,
  resolvePaneLines,
  resolvePaneOutputHistory,
  resolvedTheme,
  runtimeMount,
  runtimeSlotsActive,
  terminalAppearance,
  onRuntimeSlotChange,
}: TerminalPaneLayoutProps) {
  if (layout.type !== "pane") {
    return (
      <TerminalPaneLayout
        focusedPaneId={focusedPaneId}
        draggingPaneId={draggingPaneId}
        layout={layout}
        machineGroups={machineGroups}
        panelGroupId={panelGroupId ?? layout.id}
        onBeginPaneDrag={onBeginPaneDrag}
        onClosePane={onClosePane}
        onConnectionStateChange={onConnectionStateChange}
        onCurrentCwdChange={onCurrentCwdChange}
        onFocusPane={onFocusPane}
        onOpenLogs={onOpenLogs}
        onOutputHistoryChange={onOutputHistoryChange}
        onSplitLayoutSizesChange={onSplitLayoutSizesChange}
        onSplitPane={onSplitPane}
        panesById={panesById}
        resolvePaneLines={resolvePaneLines}
        resolvePaneOutputHistory={resolvePaneOutputHistory}
        resolvedTheme={resolvedTheme}
        runtimeMount={runtimeMount}
        runtimeSlotsActive={runtimeSlotsActive}
        terminalAppearance={terminalAppearance}
        onRuntimeSlotChange={onRuntimeSlotChange}
      />
    );
  }

  const pane = panesById.get(layout.paneId);
  if (!pane) {
    return null;
  }

  return (
    <TerminalPaneErrorBoundary onOpenLogs={onOpenLogs} pane={pane}>
      <TerminalPaneCard
        dragging={pane.id === draggingPaneId}
        focused={pane.id === focusedPaneId}
        machineGroups={machineGroups}
        onBeginPaneDrag={onBeginPaneDrag}
        onClosePane={onClosePane}
        onConnectionStateChange={onConnectionStateChange}
        onCurrentCwdChange={onCurrentCwdChange}
        onFocusPane={onFocusPane}
        onOpenLogs={onOpenLogs}
        onOutputHistoryChange={onOutputHistoryChange}
        onSplitPane={onSplitPane}
        pane={pane}
        resolvePaneLines={resolvePaneLines}
        resolvePaneOutputHistory={resolvePaneOutputHistory}
        resolvedTheme={resolvedTheme}
        runtimeMount={runtimeMount}
        runtimeSlotActive={runtimeSlotsActive}
        terminalAppearance={terminalAppearance}
        onRuntimeSlotChange={onRuntimeSlotChange}
      />
    </TerminalPaneErrorBoundary>
  );
}

export function TerminalPaneLayout({
  draggingPaneId,
  focusedPaneId,
  layout,
  machineGroups,
  panelGroupId,
  onBeginPaneDrag,
  onClosePane,
  onConnectionStateChange,
  onCurrentCwdChange,
  onFocusPane,
  onOpenLogs,
  onOutputHistoryChange,
  onSplitLayoutSizesChange,
  onSplitPane,
  panesById,
  resolvePaneLines,
  resolvePaneOutputHistory,
  resolvedTheme,
  runtimeMount,
  runtimeSlotsActive = true,
  terminalAppearance,
  onRuntimeSlotChange,
}: TerminalPaneLayoutProps) {
  const normalizedLayout = normalizeRootLayout(layout);
  const resolvedPanelGroupId = panelGroupId ?? normalizedLayout.id;
  const childKeys = normalizedLayout.children.map((child) =>
    child.type === "pane" ? child.paneId : child.id,
  );
  const defaultLayout = normalizedLayout.sizes
    ? childKeys.every((key) => typeof normalizedLayout.sizes?.[key] === "number")
      ? normalizedLayout.sizes
      : undefined
    : undefined;

  return (
    <ResizablePanelGroup
      defaultLayout={defaultLayout}
      direction={normalizedLayout.direction}
      id={resolvedPanelGroupId}
      onLayoutChanged={(sizes) =>
        onSplitLayoutSizesChange?.(normalizedLayout.id, sizes)
      }
    >
      {normalizedLayout.children.map((child, index) => {
        const childKey = child.type === "pane" ? child.paneId : child.id;

        return (
          <Fragment key={childKey}>
            {index > 0 ? (
              <ResizableHandle
                aria-label="调整终端分屏大小"
                key={`handle-${childKey}`}
              />
            ) : null}
            <ResizablePanel
              defaultSize={`${100 / normalizedLayout.children.length}%`}
              id={childKey}
              key={childKey}
              minSize="20%"
            >
              <TerminalPaneLayoutNode
                focusedPaneId={focusedPaneId}
                draggingPaneId={draggingPaneId}
                layout={child}
                machineGroups={machineGroups}
                panelGroupId={child.type === "split" ? child.id : undefined}
                onBeginPaneDrag={onBeginPaneDrag}
                onClosePane={onClosePane}
                onConnectionStateChange={onConnectionStateChange}
                onCurrentCwdChange={onCurrentCwdChange}
                onFocusPane={onFocusPane}
                onOpenLogs={onOpenLogs}
                onOutputHistoryChange={onOutputHistoryChange}
                onSplitLayoutSizesChange={onSplitLayoutSizesChange}
                onSplitPane={onSplitPane}
                panesById={panesById}
                resolvePaneLines={resolvePaneLines}
                resolvePaneOutputHistory={resolvePaneOutputHistory}
                resolvedTheme={resolvedTheme}
                runtimeMount={runtimeMount}
                runtimeSlotsActive={runtimeSlotsActive}
                terminalAppearance={terminalAppearance}
                onRuntimeSlotChange={onRuntimeSlotChange}
              />
            </ResizablePanel>
          </Fragment>
        );
      })}
    </ResizablePanelGroup>
  );
}
