// @author kongweiguang

import { Columns2, PanelBottom, Search } from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Button } from "../../components/ui/button";
import { cn } from "../../lib/cn";
import type {
  MachineGroup,
  TerminalSplitDirection,
} from "../workspace/contracts/index";
import {
  createSplitTargetOptions,
  type SplitTargetOption,
  type TerminalSplitPaneOptions,
} from "./terminalSplitTargets";

interface TerminalSplitTargetSelectorProps {
  buttonClassName?: string;
  direction: TerminalSplitDirection;
  labelPrefix?: string;
  menuAlign?: "start" | "end";
  machineGroups: MachineGroup[];
  onSplitPane: (
    direction: TerminalSplitDirection,
    options?: TerminalSplitPaneOptions,
  ) => void;
}

const directionLabels: Record<TerminalSplitDirection, string> = {
  horizontal: "左右分屏",
  vertical: "上下分屏",
};

const kindLabels: Record<SplitTargetOption["kind"], string> = {
  dockerContainer: "container",
  local: "local",
  serial: "serial",
  ssh: "ssh",
  telnet: "telnet",
};

const statusDotClassNames: Record<SplitTargetOption["status"], string> = {
  offline: "bg-zinc-400",
  online: "bg-emerald-400",
  warning: "bg-amber-400",
};
const menuViewportInset = 12;

function groupTargetsByGroup(targets: SplitTargetOption[]) {
  const groups: Array<{
    groupId: string;
    groupTitle: string;
    targets: SplitTargetOption[];
  }> = [];

  for (const target of targets) {
    const existing = groups.find((group) => group.groupId === target.groupId);
    if (existing) {
      existing.targets.push(target);
      continue;
    }
    groups.push({
      groupId: target.groupId,
      groupTitle: target.groupTitle,
      targets: [target],
    });
  }

  return groups;
}

function matchesSearch(target: SplitTargetOption, query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return true;
  }

  return [
    target.title,
    target.subtitle,
    target.hostLabel,
    target.groupTitle,
    target.kind,
  ].some((value) => value.toLowerCase().includes(normalizedQuery));
}

export function TerminalSplitTargetSelector({
  buttonClassName,
  direction,
  labelPrefix,
  menuAlign = "start",
  machineGroups,
  onSplitPane,
}: TerminalSplitTargetSelectorProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [menuPosition, setMenuPosition] = useState({ left: 0, top: 0 });
  const selectorRef = useRef<HTMLDivElement>(null);
  const splitLabel = directionLabels[direction];
  const buttonLabel = labelPrefix ? `${labelPrefix} ${splitLabel}` : splitLabel;
  const targetOptions = useMemo(
    () => createSplitTargetOptions(machineGroups),
    [machineGroups],
  );
  const filteredTargets = useMemo(
    () => targetOptions.filter((target) => matchesSearch(target, searchQuery)),
    [searchQuery, targetOptions],
  );
  const targetGroups = useMemo(
    () => groupTargetsByGroup(filteredTargets),
    [filteredTargets],
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
      if (
        selectorRef.current?.contains(target) ||
        menuRef.current?.contains(target)
      ) {
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

  useLayoutEffect(() => {
    if (!selectorOpen || typeof window === "undefined") {
      return;
    }

    const button = selectorRef.current;
    const menu = menuRef.current;
    if (!button || !menu) {
      return;
    }

    const buttonRect = button.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const unclampedLeft =
      menuAlign === "end"
        ? buttonRect.right - menuRect.width
        : buttonRect.left;
    const maxLeft = Math.max(
      menuViewportInset,
      window.innerWidth - menuRect.width - menuViewportInset,
    );
    const maxTop = Math.max(
      menuViewportInset,
      window.innerHeight - menuRect.height - menuViewportInset,
    );
    setMenuPosition({
      left: Math.max(menuViewportInset, Math.min(unclampedLeft, maxLeft)),
      top: Math.max(
        menuViewportInset,
        Math.min(buttonRect.bottom + 8, maxTop),
      ),
    });
  }, [menuAlign, selectorOpen, targetGroups.length]);

  const splitCurrentTarget = () => {
    onSplitPane(direction);
  };

  const openTargetSelector = () => {
    if (targetOptions.length === 0) {
      return;
    }
    setSelectorOpen(true);
  };

  const openTargetSelectorFromSecondaryButton = (
    event: Pick<MouseEvent, "button" | "preventDefault">,
  ) => {
    if (event.button !== 2) {
      return;
    }
    event.preventDefault();
    openTargetSelector();
  };

  const splitTarget = (target: SplitTargetOption) => {
    onSplitPane(direction, { targetMachineId: target.id });
    setSelectorOpen(false);
    setSearchQuery("");
  };

  const Icon = direction === "horizontal" ? Columns2 : PanelBottom;

  return (
    <div className="relative shrink-0" ref={selectorRef}>
      <Button
        aria-expanded={selectorOpen}
        aria-haspopup="menu"
        aria-label={buttonLabel}
        onClick={splitCurrentTarget}
        onContextMenu={(event) => {
          event.preventDefault();
          openTargetSelector();
        }}
        onMouseDown={(event) => {
          openTargetSelectorFromSecondaryButton(event);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ContextMenu") {
            event.preventDefault();
            openTargetSelector();
          }
        }}
        className={buttonClassName}
        size="icon"
        title={`${buttonLabel}；右键选择主机`}
        variant="secondary"
      >
        <Icon className="h-4 w-4" />
      </Button>

      {selectorOpen && typeof document !== "undefined"
        ? createPortal(
            <div
              aria-label={`${splitLabel}目标选择`}
              className="kerminal-floating-surface kerminal-floating-enter kerminal-layer-overlay fixed w-[22rem] max-w-[calc(100vw-2rem)] rounded-[var(--radius-card)] border p-2 text-[13px]"
              ref={menuRef}
              role="menu"
              style={menuPosition}
            >
              <div className="px-1 pb-2">
                <div className="text-sm font-medium text-zinc-950 dark:text-zinc-50">
                  选择主机分屏
                </div>
                <div className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                  {splitLabel}到指定目标
                </div>
              </div>

              <label className="relative block">
                <span className="sr-only">搜索分屏主机</span>
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
                <input
                  autoFocus
                  className="kerminal-field-surface h-9 w-full rounded-xl border py-1 pl-8 pr-3 text-sm text-zinc-950 placeholder:text-zinc-400 dark:text-zinc-100 dark:placeholder:text-zinc-600"
                  onChange={(event) => setSearchQuery(event.currentTarget.value)}
                  placeholder="搜索主机、协议或分组"
                  value={searchQuery}
                />
              </label>

              <div className="mt-2 max-h-72 space-y-2 overflow-y-auto">
                {targetGroups.length > 0 ? (
                  targetGroups.map((group) => (
                    <div key={group.groupId}>
                      <div className="px-1.5 py-1 text-xs font-medium text-zinc-500 dark:text-zinc-400">
                        {group.groupTitle}
                      </div>
                      <div className="space-y-1">
                        {group.targets.map((target) => (
                          <button
                            className="kerminal-focus-ring kerminal-pressable flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-zinc-700 hover:bg-[var(--surface-hover)] hover:text-zinc-950 dark:text-zinc-200 dark:hover:text-zinc-50"
                            key={target.id}
                            onClick={() => splitTarget(target)}
                            role="menuitem"
                            type="button"
                          >
                            <span
                              aria-hidden="true"
                              className={cn(
                                "h-2 w-2 shrink-0 rounded-full",
                                statusDotClassNames[target.status],
                              )}
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-medium">
                                {target.title}
                              </span>
                              <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">
                                {target.subtitle || target.id}
                              </span>
                            </span>
                            <span className="rounded-md bg-[var(--surface-hover)] px-1.5 py-0.5 text-[10px] font-medium uppercase text-zinc-500 dark:text-zinc-400">
                              {kindLabels[target.kind]}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="rounded-xl bg-[var(--surface-hover)] px-3 py-2 text-sm text-zinc-500 dark:text-zinc-400">
                    没有匹配的终端主机。
                  </div>
                )}
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
