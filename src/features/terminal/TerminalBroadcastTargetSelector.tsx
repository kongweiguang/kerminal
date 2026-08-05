// @author kongweiguang

import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "../../lib/cn";
import type {
  BroadcastTargetMode,
  BroadcastTargetOption,
} from "./terminalBroadcastTargets";

interface TerminalBroadcastTargetSelectorProps {
  focusedPaneId: string;
  onTargetModeChange: (mode: BroadcastTargetMode) => void;
  onToggleCustomTarget: (paneId: string, selected: boolean) => void;
  selectedTargetPaneIds: string[];
  targetCount: number;
  targetMode: BroadcastTargetMode;
  targetOptions: BroadcastTargetOption[];
}

const modeLabels: Record<BroadcastTargetMode, string> = {
  all: "全部分屏",
  custom: "自定义",
  focused: "当前分屏",
};

function buildTargetSummaryLabel(
  mode: BroadcastTargetMode,
  targetCount: number,
) {
  return mode === "focused"
    ? modeLabels.focused
    : `${modeLabels[mode]} · ${targetCount}`;
}

function modeButtonClassName(active: boolean) {
  return cn(
    "kerminal-focus-ring kerminal-pressable flex w-full items-center justify-between rounded-xl px-3 py-2 text-left",
    active
      ? "bg-[var(--surface-selected)] text-sky-700 dark:text-sky-100"
      : "text-zinc-700 hover:bg-[var(--surface-hover)] hover:text-zinc-950 dark:text-zinc-200 dark:hover:text-zinc-50",
  );
}

export function TerminalBroadcastTargetSelector({
  focusedPaneId,
  onTargetModeChange,
  onToggleCustomTarget,
  selectedTargetPaneIds,
  targetCount,
  targetMode,
  targetOptions,
}: TerminalBroadcastTargetSelectorProps) {
  const [selectorOpen, setSelectorOpen] = useState(false);
  const selectorRef = useRef<HTMLDivElement>(null);
  const selectedTargetIds = useMemo(
    () => new Set(selectedTargetPaneIds),
    [selectedTargetPaneIds],
  );
  const focusedTarget = targetOptions.find(
    (target) => target.paneId === focusedPaneId,
  );
  const targetSummaryLabel = buildTargetSummaryLabel(
    targetMode,
    targetCount,
  );

  useEffect(() => {
    if (!selectorOpen) {
      return undefined;
    }

    const closeOnPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (selectorRef.current?.contains(target)) {
        return;
      }
      setSelectorOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectorOpen(false);
      }
    };
    window.addEventListener("pointerdown", closeOnPointerDown);
    window.addEventListener("keydown", closeOnEscape, true);
    return () => {
      window.removeEventListener("pointerdown", closeOnPointerDown);
      window.removeEventListener("keydown", closeOnEscape, true);
    };
  }, [selectorOpen]);

  const selectMode = (mode: BroadcastTargetMode) => {
    onTargetModeChange(mode);
    if (mode !== "custom") {
      setSelectorOpen(false);
    }
  };

  return (
    <div className="relative shrink-0" ref={selectorRef}>
      <button
        aria-expanded={selectorOpen}
        aria-haspopup="menu"
        aria-label={`发送目标：${targetSummaryLabel}`}
        className={cn(
          "kerminal-focus-ring kerminal-pressable flex h-9 items-center gap-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-hover)] px-2.5 text-xs font-medium text-zinc-700 shadow-sm shadow-black/5 transition-colors dark:text-zinc-200 dark:shadow-black/20",
          selectorOpen &&
            "border-sky-500/30 bg-[var(--surface-selected)] text-sky-700 dark:text-sky-100",
        )}
        onClick={() => setSelectorOpen((open) => !open)}
        title={`发送目标：${targetSummaryLabel}`}
        type="button"
      >
        <span className="whitespace-nowrap">{targetSummaryLabel}</span>
      </button>

      {selectorOpen ? (
        <div
          aria-label="发送目标选择"
          className="kerminal-floating-surface kerminal-floating-enter kerminal-layer-popover absolute left-0 top-[calc(100%+0.5rem)] w-80 max-w-[calc(100vw-2rem)] rounded-[var(--radius-card)] border p-2 text-[13px]"
          role="menu"
        >
          <div className="space-y-1">
            <button
              aria-pressed={targetMode === "focused"}
              className={modeButtonClassName(targetMode === "focused")}
              disabled={!focusedTarget}
              onClick={() => selectMode("focused")}
              type="button"
            >
              <span>{modeLabels.focused}</span>
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                {focusedTarget ? focusedTarget.title : "无当前目标"}
              </span>
            </button>
            <button
              aria-pressed={targetMode === "all"}
              className={modeButtonClassName(targetMode === "all")}
              disabled={targetOptions.length === 0}
              onClick={() => selectMode("all")}
              type="button"
            >
              <span>{modeLabels.all}</span>
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                {targetOptions.length} 个目标
              </span>
            </button>
            <button
              aria-pressed={targetMode === "custom"}
              className={modeButtonClassName(targetMode === "custom")}
              disabled={targetOptions.length === 0}
              onClick={() => selectMode("custom")}
              type="button"
            >
              <span>{modeLabels.custom}</span>
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                {selectedTargetPaneIds.length} 个已选
              </span>
            </button>
          </div>

          <div className="mt-2 border-t border-[var(--border-subtle)] pt-2">
            <div className="mb-1.5 flex items-center justify-between px-1 text-xs text-zinc-500 dark:text-zinc-400">
              <span>分屏目标</span>
            </div>
            <div className="max-h-64 space-y-1 overflow-y-auto">
              {targetOptions.length > 0 ? (
                targetOptions.map((target) => (
                  <label
                    className={cn(
                      "kerminal-focus-ring flex cursor-pointer items-center gap-2 rounded-xl px-2.5 py-2",
                      selectedTargetIds.has(target.paneId)
                        ? "bg-[var(--surface-selected)]"
                        : "hover:bg-[var(--surface-hover)]",
                    )}
                    key={target.paneId}
                  >
                    <input
                      checked={selectedTargetIds.has(target.paneId)}
                      className="h-4 w-4 shrink-0"
                      onChange={(event) =>
                        onToggleCustomTarget(
                          target.paneId,
                          event.currentTarget.checked,
                        )
                      }
                      type="checkbox"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-zinc-800 dark:text-zinc-100">
                        {target.title}
                      </span>
                      <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">
                        {target.subtitle}
                      </span>
                    </span>
                    <span className="rounded-md bg-[var(--surface-hover)] px-1.5 py-0.5 text-[10px] font-medium uppercase text-zinc-500 dark:text-zinc-400">
                      {target.mode}
                    </span>
                  </label>
                ))
              ) : (
                <div className="rounded-xl bg-[var(--surface-hover)] px-3 py-2 text-sm text-zinc-500 dark:text-zinc-400">
                  没有可发送的真实终端分屏。
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
