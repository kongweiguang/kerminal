// @author kongweiguang

import { Send } from "lucide-react";
import type { CSSProperties, KeyboardEvent } from "react";
import { Button } from "../../components/ui/button";
import { cn } from "../../lib/cn";
import {
  canBroadcastCommand,
  type BroadcastCommandAnalysis,
} from "./broadcastCommandPolicy";
import { TerminalBroadcastTargetSelector } from "./TerminalBroadcastTargetSelector";
import type {
  BroadcastTargetMode,
  BroadcastTargetOption,
} from "./terminalBroadcastTargets";

interface TerminalBroadcastBarProps {
  analysis: BroadcastCommandAnalysis;
  draft: string;
  error: string | null;
  focusedPaneId: string;
  onDraftChange: (draft: string) => void;
  onRequestBroadcast: () => void;
  onTargetModeChange: (mode: BroadcastTargetMode) => void;
  onToggleCustomTarget: (paneId: string, selected: boolean) => void;
  selectedTargetPaneIds: string[];
  sending: boolean;
  status: string | null;
  style?: CSSProperties;
  targetMode: BroadcastTargetMode;
  targetOptions: BroadcastTargetOption[];
  toolbarPaddingClass: string;
}

/** 广播栏与终端正文共享双侧 inset，确保左右面板并开时目标和输入仍可操作。 */
export function TerminalBroadcastBar({
  analysis,
  draft,
  error,
  focusedPaneId,
  onDraftChange,
  onRequestBroadcast,
  onTargetModeChange,
  onToggleCustomTarget,
  selectedTargetPaneIds,
  sending,
  status,
  style,
  targetMode,
  targetOptions,
  toolbarPaddingClass,
}: TerminalBroadcastBarProps) {
  const sendLabel =
    analysis.targetCount > 0
      ? `发送到 ${analysis.targetCount} 个目标`
      : "没有可发送目标";

  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    onRequestBroadcast();
  };

  return (
    <>
      <div
        className={cn(
          "flex items-center gap-2 border-b border-[var(--border-subtle)] transition-[margin-left,margin-right] duration-200 ease-out",
          toolbarPaddingClass,
        )}
        data-terminal-workspace-inset
        style={style}
      >
        <TerminalBroadcastTargetSelector
          focusedPaneId={focusedPaneId}
          onTargetModeChange={onTargetModeChange}
          onToggleCustomTarget={onToggleCustomTarget}
          selectedTargetPaneIds={selectedTargetPaneIds}
          targetCount={analysis.targetCount}
          targetMode={targetMode}
          targetOptions={targetOptions}
        />
        <label className="sr-only" htmlFor="broadcast-command">
          批量命令
        </label>
        <input
          className="kerminal-field-surface h-9 min-w-0 flex-1 rounded-xl border px-3 font-mono text-sm text-zinc-950 placeholder:text-zinc-400 dark:text-zinc-100 dark:placeholder:text-zinc-600"
          id="broadcast-command"
          onChange={(event) => onDraftChange(event.currentTarget.value)}
          onKeyDown={handleInputKeyDown}
          placeholder="向所选目标发送命令..."
          value={draft}
        />
        <span className="hidden shrink-0 rounded-lg bg-[var(--surface-hover)] px-2 py-1 text-xs text-zinc-500 dark:text-zinc-400 xl:inline">
          {analysis.targetCount} 个目标
        </span>
        <Button
          aria-label={sending ? "发送中" : sendLabel}
          disabled={!canBroadcastCommand(analysis) || sending}
          onClick={onRequestBroadcast}
          size="icon"
          title={sending ? "发送中" : sendLabel}
          variant="primary"
        >
          <Send className="h-4 w-4" />
        </Button>
      </div>

      {status || error ? (
        <div
          className={cn(
            "border-b border-[var(--border-subtle)] px-3 py-2 text-sm transition-[margin-left,margin-right] duration-200 ease-out",
            error
              ? "bg-rose-500/10 text-rose-700 dark:text-rose-100"
              : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-100",
          )}
          role={error ? "alert" : "status"}
          style={style}
        >
          {error ?? status}
        </div>
      ) : null}
    </>
  );
}
