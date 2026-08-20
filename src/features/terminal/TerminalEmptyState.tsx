// @author kongweiguang

import kerminalLogoUrl from "../../assets/kerminal-logo.svg";
import { cn } from "../../lib/cn";

export interface TerminalEmptyStateProps {
  backgroundImageVisible?: boolean;
  onCreateTerminal?: () => void;
  onOpenAgentTool?: () => void;
  onOpenConnection?: () => void;
}

/** 空工作区沿用终端玻璃表面，避免启用背景时中央仍被整块实色占满。 */
export function TerminalEmptyState({
  backgroundImageVisible = false,
}: TerminalEmptyStateProps) {
  return (
    <div
      className={cn(
        "flex h-full items-center justify-center rounded-[var(--radius-card)] border p-6 text-zinc-700 dark:text-zinc-200",
        backgroundImageVisible
          ? "kerminal-terminal-surface"
          : "kerminal-solid-surface",
      )}
    >
      <div className="mx-auto flex w-full max-w-sm flex-col items-center text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-[var(--radius-card)] border border-[var(--border-subtle)] p-3">
          <img
            alt="Kerminal"
            className="h-10 w-10"
            draggable={false}
            src={kerminalLogoUrl}
          />
        </div>
        <p className="mt-4 text-sm font-medium leading-6 text-zinc-500 dark:text-zinc-400">
          光标还没闪，AI 已经开始脑补命令了。
        </p>
      </div>
    </div>
  );
}
