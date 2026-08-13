// @author kongweiguang

import {
  useCallback,
  useRef,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { GripVertical, Terminal, X } from "lucide-react";
import { Button } from "../../components/ui/button";
import { cn } from "../../lib/cn";
import type {
  ResolvedTheme,
  TerminalAppearance,
} from "../settings/contracts/index";
import type {
  MachineGroup,
  TerminalPane,
  TerminalSplitDirection,
} from "../workspace/contracts/index";
import { XtermPane } from "./XtermPane";
import { TerminalSplitTargetSelector } from "./TerminalSplitTargetSelector";
import { buildTerminalPaneCardModel } from "./terminalPaneCardModel";
import type { TerminalSplitPaneOptions } from "./terminalSplitTargets";
import type { TerminalRuntimeSlotChangeHandler } from "./terminalRuntimeSlots";
import type { ConnectionState } from "./XtermPane.helpers";

interface TerminalPaneCardProps {
  dragging?: boolean;
  focused: boolean;
  machineGroups?: MachineGroup[];
  pane: TerminalPane;
  resolvedTheme: ResolvedTheme;
  runtimeMount?: "inline" | "slot";
  runtimeSlotActive?: boolean;
  terminalAppearance: TerminalAppearance;
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
  onRuntimeSlotChange?: TerminalRuntimeSlotChangeHandler;
  onSplitPane?: (
    direction: TerminalSplitDirection,
    options?: TerminalSplitPaneOptions,
  ) => void;
  resolvePaneLines?: (paneId: string) => string[];
  resolvePaneOutputHistory?: (paneId: string) => string | undefined;
}

export function TerminalPaneCard({
  dragging = false,
  focused,
  machineGroups = [],
  onBeginPaneDrag,
  onClosePane,
  onConnectionStateChange,
  onCurrentCwdChange,
  onFocusPane,
  onOpenLogs,
  onOutputHistoryChange,
  onRuntimeSlotChange,
  onSplitPane,
  pane,
  resolvePaneLines,
  resolvePaneOutputHistory,
  resolvedTheme,
  runtimeMount = "inline",
  runtimeSlotActive = true,
  terminalAppearance,
}: TerminalPaneCardProps) {
  const model = buildTerminalPaneCardModel(pane);
  const paneLines =
    model.renderKind === "runtime"
      ? pane.lines
      : (resolvePaneLines?.(pane.id) ?? pane.lines);
  /** 分屏前先把来源 pane 设为焦点，确保新布局继承用户刚操作的终端上下文。 */
  const splitPane = (
    direction: TerminalSplitDirection,
    options?: TerminalSplitPaneOptions,
  ) => {
    const splitOptions = { ...options, sourcePaneId: pane.id };
    onFocusPane(pane.id);
    onSplitPane?.(direction, splitOptions);
  };
  const runtimeSlotElementRef = useRef<HTMLDivElement | null>(null);
  /**
   * callback ref 同时撤销旧 host 并登记新 host，避免 React 替换节点时 registry
   * 在同一 pane 下保留两个都声称 active 的 slot。
   */
  const runtimeSlotRef = useCallback(
    (element: HTMLDivElement | null) => {
      const previousElement = runtimeSlotElementRef.current;
      if (previousElement && previousElement !== element) {
        onRuntimeSlotChange?.(
          pane.id,
          previousElement,
          runtimeSlotActive,
          false,
        );
      }
      runtimeSlotElementRef.current = element;
      if (element) {
        onRuntimeSlotChange?.(pane.id, element, runtimeSlotActive, true);
      }
    },
    [onRuntimeSlotChange, pane.id, runtimeSlotActive],
  );

  return (
    <section
      aria-label={model.ariaLabel}
      className={cn(
        "kerminal-terminal-surface flex h-full min-h-0 flex-col overflow-hidden rounded-[var(--radius-panel)] border transition-[opacity,transform,box-shadow] duration-[180ms] ease-out",
        dragging &&
          "scale-[0.985] opacity-35 ring-2 ring-dashed ring-sky-400/70",
      )}
      data-terminal-pane-card={pane.id}
      data-dragging={dragging || undefined}
      data-focused={focused || undefined}
      onClick={() => onFocusPane(pane.id)}
    >
      <div className="kerminal-terminal-header flex h-9 shrink-0 items-center justify-between border-b px-3">
        <div className="flex min-w-0 items-center gap-2">
          {onBeginPaneDrag ? (
            <button
              aria-label={`拖动 ${model.title} 分屏调整位置`}
              className={cn(
                "kerminal-focus-ring flex h-7 w-6 shrink-0 cursor-grab items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-[var(--surface-hover)] hover:text-zinc-700 active:cursor-grabbing dark:text-zinc-500 dark:hover:text-zinc-200",
                dragging &&
                  "bg-sky-400/10 text-sky-700 dark:text-sky-100",
              )}
              onClick={(event) => event.stopPropagation()}
              onContextMenu={(event) => event.stopPropagation()}
              onPointerDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onFocusPane(pane.id);
                onBeginPaneDrag(pane.id, event);
              }}
              title={`拖动 ${model.title} 分屏调整位置`}
              type="button"
            >
              <GripVertical className="h-4 w-4" />
            </button>
          ) : null}
          {pane.status !== "online" ? (
            <span
              aria-label={
                pane.status === "warning" ? "连接警告" : "连接已断开"
              }
              className={cn(
                "h-2.5 w-2.5 rounded-full",
                pane.status === "warning" ? "bg-amber-400" : "bg-red-400",
              )}
              title={pane.status === "warning" ? "连接警告" : "连接已断开"}
            />
          ) : null}
          <span className="truncate text-sm font-medium text-zinc-800 dark:text-zinc-200">
            {model.title}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {model.latencyLabel ? (
            <span className="mr-0.5 rounded-lg bg-emerald-400/10 px-2 py-1 text-xs text-emerald-300">
              {model.latencyLabel}
            </span>
          ) : null}
          <div
            className="flex items-center gap-1 opacity-80 transition-opacity hover:opacity-100"
            onClick={(event) => event.stopPropagation()}
            onContextMenu={(event) => event.stopPropagation()}
          >
            <TerminalSplitTargetSelector
              buttonClassName="h-8 w-8 rounded-lg"
              direction="horizontal"
              labelPrefix={model.title}
              machineGroups={machineGroups}
              menuAlign="end"
              onSplitPane={splitPane}
            />
            <TerminalSplitTargetSelector
              buttonClassName="h-8 w-8 rounded-lg"
              direction="vertical"
              labelPrefix={model.title}
              machineGroups={machineGroups}
              menuAlign="end"
              onSplitPane={splitPane}
            />
          </div>
          <Button
            aria-label={model.closeAriaLabel}
            onClick={(event) => {
              event.stopPropagation();
              onClosePane(pane.id);
            }}
            className="h-8 w-8 rounded-lg"
            size="icon"
            variant="ghost"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      {model.renderKind === "runtime" && runtimeMount === "slot" ? (
        <div
          className="flex min-h-0 flex-1"
          data-terminal-pane-runtime-slot={pane.id}
          ref={runtimeSlotRef}
        />
      ) : model.renderKind === "runtime" ? (
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
            onConnectionStateChange?.(pane.id, state)
          }
          onCurrentCwdChange={(cwd) => onCurrentCwdChange?.(pane.id, cwd)}
          onOpenLogs={onOpenLogs}
          onOutputHistoryChange={(outputHistory) =>
            onOutputHistoryChange?.(pane.id, outputHistory)
          }
          onSplitPane={splitPane}
          outputHistory={pane.outputHistory}
          resolveInitialOutputHistory={() =>
            resolvePaneOutputHistory?.(pane.id) ?? pane.outputHistory
          }
          resolvedTheme={resolvedTheme}
          shell={pane.shell}
          target={pane.target}
          terminalAppearance={terminalAppearance}
          title={pane.title}
        />
      ) : (
        <pre className="kerminal-terminal-preview min-h-0 flex-1 overflow-auto p-4 font-mono text-[13px] leading-6 text-zinc-800 dark:text-zinc-200">
          {paneLines.map((line, index) => (
            <code className="block" key={`${pane.id}-${index}-${line}`}>
              {line}
            </code>
          ))}
          <code className="mt-2 flex items-center gap-2 text-rose-300">
            <Terminal className="h-3.5 w-3.5" />
            {pane.prompt}
          </code>
        </pre>
      )}
    </section>
  );
}
