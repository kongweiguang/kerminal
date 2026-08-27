// @author kongweiguang

import { Check, Layers2 } from "lucide-react";
import type { RefObject } from "react";
import { createPortal } from "react-dom";
import { cn } from "../../lib/cn";
import type { TerminalAppearance } from "../settings/contracts/index";
import type {
  MachineStatus,
  TerminalTab,
} from "../workspace/contracts/index";
import {
  terminalTabStatusDotClassName,
  type TerminalTabGroup,
} from "./terminalTabChrome";
import { TerminalTabAttention } from "./TerminalTabAttention";
import type { TerminalTabPresentation } from "./terminalTabPresentationModel";

const terminalFloatingPanelClassName =
  "kerminal-floating-surface kerminal-floating-enter kerminal-layer-popover fixed border text-[13px]";
const terminalOverviewItemClassName =
  "kerminal-focus-ring kerminal-pressable flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left";
const terminalOverviewIdleClassName =
  "text-zinc-700 hover:bg-[var(--surface-hover)] hover:text-zinc-950 dark:text-zinc-200 dark:hover:text-zinc-50";

interface TerminalTabOverviewMenuProps {
  activeTabId: string;
  menuRef: RefObject<HTMLDivElement | null>;
  onSelectTab: (tabId: string) => void;
  open: boolean;
  position: {
    x: number;
    y: number;
  };
  tabGroups: TerminalTabGroup[];
  tabs: TerminalTab[];
  tabStatusById: ReadonlyMap<string, MachineStatus>;
  tabPresentationById: ReadonlyMap<string, TerminalTabPresentation>;
  terminalAppearance: TerminalAppearance;
}

/**
 * 展示扁平 Tab 顺序和显式组数量；未分组 Tab 仅作为普通行呈现，避免把单 Tab
 * 再包装成主机组，同时由 portal 继承全局 surface 主题变量。
 */
export function TerminalTabOverviewMenu({
  activeTabId,
  menuRef,
  onSelectTab,
  open,
  position,
  tabGroups,
  tabs,
  tabStatusById,
  tabPresentationById,
  terminalAppearance,
}: TerminalTabOverviewMenuProps) {
  if (!open || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      aria-label="所有终端标签"
      className={cn(
        terminalFloatingPanelClassName,
        "w-72 overflow-hidden rounded-[var(--radius-card)]",
      )}
      onClick={(event) => event.stopPropagation()}
      ref={menuRef}
      role="menu"
      style={{ left: position.x, top: position.y }}
    >
      <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-3 py-2.5">
        <div className="font-medium text-zinc-950 dark:text-zinc-50">
          标签分组
        </div>
        <div className="rounded-full bg-[var(--surface-hover)] px-2 py-0.5 text-xs text-zinc-500 dark:text-zinc-400">
          {tabGroups.filter((group) => group.grouped).length} 组 / {tabs.length} 个
        </div>
      </div>
      <div className="max-h-[min(70vh,420px)] overflow-y-auto p-1.5">
        {tabGroups.map((group) => {
          return (
            <div
            aria-label={group.grouped ? `${group.title} 标签组` : undefined}
              className="py-1"
              key={group.id}
              role={group.grouped ? "group" : undefined}
            >
              {group.grouped ? <div className="flex items-center gap-2 px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.08em] text-zinc-500 dark:text-zinc-400">
                <span
                  aria-hidden="true"
                  className={cn(
                    "h-[18px] w-[3px] shrink-0 rounded-full",
                    group.identityAccent.accentClassName,
                  )}
                  data-terminal-identity-accent={group.identityAccent.color}
                  data-terminal-identity-source={group.identityAccent.source}
                />
                <Layers2 className="h-3.5 w-3.5 shrink-0 opacity-80" />
                <span className="min-w-0 flex-1 truncate normal-case tracking-normal">
                  {group.title}
                </span>
                <span className="rounded-full bg-[var(--surface-hover)] px-1.5 py-0.5 text-[10px] font-medium leading-none">
                  {group.tabs.length} 个
                </span>
              </div> : null}
              <div className={cn("space-y-0.5", !group.grouped && "pt-0") }>
                {group.tabs.map((tab) => {
                  const active = tab.id === activeTabId;
                  const tabIndex = tabs.findIndex(
                    (candidate) => candidate.id === tab.id,
                  );
                  const title =
                    terminalAppearance.showTabNumbers && tabIndex >= 0
                      ? `${tabIndex + 1} · ${tab.title}`
                      : tab.title;
                  const statusDotClassName = terminalTabStatusDotClassName(
                    tab,
                    tabStatusById.get(tab.id),
                  );
                  const presentation = tabPresentationById.get(tab.id);
                  return (
                    <button
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        terminalOverviewItemClassName,
                        group.grouped ? "pl-5" : "pl-2.5",
                        active
                          ? "bg-[var(--surface-selected)] text-sky-700 dark:text-sky-100"
                          : terminalOverviewIdleClassName,
                      )}
                      key={tab.id}
                      onClick={() => onSelectTab(tab.id)}
                      role="menuitem"
                      type="button"
                    >
                      {statusDotClassName ? (
                        <span
                          className={cn(
                            "h-2 w-2 shrink-0 rounded-full",
                            statusDotClassName,
                          )}
                        />
                      ) : null}
                      <span className="min-w-0 flex-1 truncate">{title}</span>
                      {presentation ? (
                        <TerminalTabAttention
                          attention={presentation.attention}
                          count={
                            presentation.attention !== "none"
                              ? presentation.attentionCount
                              : presentation.progressCount
                          }
                          label={presentation.statusLabel}
                          progress={presentation.progress}
                        />
                      ) : null}
                      {active ? (
                        <Check className="h-3.5 w-3.5 shrink-0" />
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>,
    document.body,
  );
}
