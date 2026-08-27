// @author kongweiguang

import { Pin, Plus, Search, Server, SquareTerminal, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "../../lib/cn";
import {
  filterTerminalCreateOptions,
  type TerminalCreateHostOption,
  type TerminalCreateProfileOption,
} from "./terminalCreateMenuModel";
import { clampContextMenuPosition } from "./terminalTabChrome";

export interface TerminalCreatePanelPosition {
  x: number;
  y: number;
}

interface TerminalCreateButtonProps {
  buttonRef: RefObject<HTMLButtonElement | null>;
  canOpenPanel: boolean;
  onCreateDefault?: () => void;
  onRequestOpen: (position: TerminalCreatePanelPosition) => void;
  panelOpen: boolean;
  placement: "fixed" | "inline";
}

interface TerminalCreatePanelProps {
  hostOptions: readonly TerminalCreateHostOption[];
  onClose: () => void;
  onCreateProfile?: (profileId?: string) => void;
  onOpenConnection?: () => void;
  onOpenHost?: (machineId: string) => void;
  position: TerminalCreatePanelPosition;
  profileOptions: readonly TerminalCreateProfileOption[];
  triggerRef: RefObject<HTMLButtonElement | null>;
}

/**
 * 渲染可迁移的新建按钮：左键保持零打断快速新建，右键只负责请求打开独立
 * 选择面板，使按钮因 Tab 溢出迁移时不会带走面板状态。
 */
export function TerminalCreateButton({
  buttonRef,
  canOpenPanel,
  onCreateDefault,
  onRequestOpen,
  panelOpen,
  placement,
}: TerminalCreateButtonProps) {
  /**
   * 鼠标右键按指针位置打开面板；先做一次零尺寸夹取，完整尺寸在 portal
   * 挂载后再次计算。
   */
  const openCreatePanel = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      if (!canOpenPanel) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const rect = buttonRef.current?.getBoundingClientRect();
      const x = event.clientX || rect?.left || 0;
      const y = event.clientY || rect?.bottom || 0;
      onRequestOpen(clampContextMenuPosition(x, y, 0, 0));
    },
    [buttonRef, canOpenPanel, onRequestOpen],
  );

  /**
   * 保留 Enter/Space 的原生 button 行为；仅补齐 Windows 常用的菜单键与
   * Shift+F10，使完整目标选择不依赖鼠标。
   */
  const handleCreateButtonKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLButtonElement>) => {
      if (
        event.key !== "ContextMenu" &&
        !(event.shiftKey && event.key === "F10")
      ) {
        return;
      }
      event.preventDefault();
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!canOpenPanel || !rect) {
        return;
      }
      onRequestOpen(
        clampContextMenuPosition(rect.left, rect.bottom, 0, 0),
      );
    },
    [buttonRef, canOpenPanel, onRequestOpen],
  );

  return (
    <button
      aria-expanded={panelOpen ? true : undefined}
      aria-haspopup={canOpenPanel ? "dialog" : undefined}
      aria-label="新建临时终端"
      className="kerminal-focus-ring kerminal-pressable flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-control)] border-0 bg-transparent p-0 text-[var(--text-secondary)] shadow-none hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
      data-terminal-create-placement={placement}
      disabled={!onCreateDefault}
      onClick={onCreateDefault}
      onContextMenu={openCreatePanel}
      onKeyDown={handleCreateButtonKeyDown}
      ref={buttonRef}
      title="新建临时终端"
      type="button"
    >
      <Plus className="h-4 w-4" />
    </button>
  );
}

/**
 * 以 portal 承载可搜索、可固定的非模态选择面板；面板与触发按钮解耦后，即使
 * 加号因 Tab 溢出迁移到右侧操作区，固定状态和搜索上下文也不会丢失。
 */
export function TerminalCreatePanel({
  hostOptions,
  onClose,
  onCreateProfile,
  onOpenConnection,
  onOpenHost,
  position,
  profileOptions,
  triggerRef,
}: TerminalCreatePanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [pinned, setPinned] = useState(false);
  const [query, setQuery] = useState("");
  const [resolvedPosition, setResolvedPosition] = useState(position);
  const filteredOptions = useMemo(
    () => filterTerminalCreateOptions(profileOptions, hostOptions, query),
    [hostOptions, profileOptions, query],
  );

  /** 根据面板实际尺寸夹取坐标，搜索改变列表高度后也重新校正。 */
  const syncPanelPosition = useCallback(() => {
    const panel = panelRef.current;
    if (!panel) {
      return;
    }
    const rect = panel.getBoundingClientRect();
    setResolvedPosition(
      clampContextMenuPosition(
        position.x,
        position.y,
        panel.offsetWidth || rect.width,
        panel.offsetHeight || rect.height,
      ),
    );
  }, [position]);

  useLayoutEffect(() => {
    syncPanelPosition();
  }, [
    filteredOptions.hosts.length,
    filteredOptions.profiles.length,
    syncPanelPosition,
  ]);

  useEffect(() => {
    searchInputRef.current?.focus();
  }, [position]);

  useEffect(() => {
    /** 未固定时保持轻量 popover 语义；固定后允许切换 Tab 或连续创建。 */
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (
        !pinned &&
        target instanceof Node &&
        !panelRef.current?.contains(target)
      ) {
        onClose();
      }
    };
    /** Escape 始终关闭面板并把键盘焦点还给当前可见的加号。 */
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      onClose();
      triggerRef.current?.focus();
    };
    /** 固定面板在 resize 后重新夹取；普通面板继续自动关闭。 */
    const handleResize = () => {
      if (pinned) {
        syncPanelPosition();
      } else {
        onClose();
      }
    };

    window.addEventListener("pointerdown", closeOnOutsidePointer, true);
    window.addEventListener("keydown", closeOnEscape, true);
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("pointerdown", closeOnOutsidePointer, true);
      window.removeEventListener("keydown", closeOnEscape, true);
      window.removeEventListener("resize", handleResize);
    };
  }, [onClose, pinned, syncPanelPosition, triggerRef]);

  /**
   * 搜索框中的上下方向键进入结果列表；列表内继续循环导航，Home/End 不抢占
   * 搜索框原生光标行为，Tab 仍使用标准焦点顺序。
   */
  const handlePanelKeyDown = (
    event: ReactKeyboardEvent<HTMLDivElement>,
  ) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      return;
    }
    if (
      event.target === searchInputRef.current &&
      (event.key === "Home" || event.key === "End")
    ) {
      return;
    }
    const items = Array.from(
      panelRef.current?.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"]:not(:disabled)',
      ) ?? [],
    );
    if (items.length === 0) {
      return;
    }
    event.preventDefault();
    const activeIndex = items.indexOf(
      document.activeElement as HTMLButtonElement,
    );
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? items.length - 1
          : event.key === "ArrowUp"
            ? activeIndex < 0
              ? items.length - 1
              : (activeIndex - 1 + items.length) % items.length
            : activeIndex < 0
              ? 0
              : (activeIndex + 1) % items.length;
    items[nextIndex]?.focus();
  };

  /** 未固定时先关闭再执行；固定态保留筛选和位置，支持连续打开多个目标。 */
  const runAction = (action?: () => void) => {
    if (!pinned) {
      onClose();
    }
    action?.();
  };

  /** 显式关闭会恢复加号焦点；外部点击关闭则保留用户刚选择的新焦点。 */
  const closeAndRestoreFocus = () => {
    onClose();
    triggerRef.current?.focus();
  };

  const panel = (
    <div
      aria-label="新建终端"
      className="kerminal-context-menu kerminal-floating-enter kerminal-layer-popover fixed w-[min(320px,calc(100vw-16px))]"
      data-terminal-create-pinned={pinned ? "true" : "false"}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={handlePanelKeyDown}
      ref={panelRef}
      role="dialog"
      style={{ left: resolvedPosition.x, top: resolvedPosition.y }}
    >
      <div className="flex h-9 items-center gap-2 border-b border-[var(--border-subtle)] px-2 pb-1">
        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-[var(--text-primary)]">
          新建终端
        </span>
        <button
          aria-label={pinned ? "取消固定终端面板" : "固定终端面板"}
          aria-pressed={pinned}
          className={cn(
            "kerminal-focus-ring kerminal-pressable flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-control)] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]",
            pinned && "bg-[var(--surface-selected)] text-[var(--text-primary)]",
          )}
          onClick={() => setPinned((current) => !current)}
          title={pinned ? "取消固定" : "固定面板"}
          type="button"
        >
          <Pin className={cn("h-3.5 w-3.5", pinned && "fill-current")} />
        </button>
        <button
          aria-label="关闭终端面板"
          className="kerminal-focus-ring kerminal-pressable flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-control)] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
          onClick={closeAndRestoreFocus}
          title="关闭"
          type="button"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="relative px-1 py-2">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-tertiary)]" />
        <input
          aria-label="搜索终端或主机"
          className="kerminal-focus-ring h-8 w-full rounded-[var(--radius-control)] border border-[var(--border-subtle)] bg-[var(--surface-field)] pl-8 pr-8 text-xs text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder="搜索 Profile 或主机"
          ref={searchInputRef}
          spellCheck={false}
          value={query}
        />
        {query ? (
          <button
            aria-label="清除终端搜索"
            className="kerminal-focus-ring kerminal-pressable absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-[var(--radius-control)] text-[var(--text-tertiary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
            onClick={() => {
              setQuery("");
              searchInputRef.current?.focus();
            }}
            title="清除搜索"
            type="button"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
        <span aria-live="polite" className="sr-only">
          {filteredOptions.profiles.length + filteredOptions.hosts.length} 个结果
        </span>
      </div>
      <div
        aria-label="终端目标"
        className="max-h-[min(340px,calc(100vh-152px))] overflow-y-auto overscroll-contain"
        role="menu"
      >
        <TerminalCreateMenuGroup label="本地 Profile">
          {filteredOptions.profiles.length > 0 ? (
            filteredOptions.profiles.map((profile) => (
              <button
                className="kerminal-context-menu-item"
                disabled={!onCreateProfile}
                key={profile.id}
                onClick={() =>
                  runAction(() => onCreateProfile?.(profile.id))
                }
                role="menuitem"
                type="button"
              >
                <span className="kerminal-context-menu-icon">
                  <SquareTerminal />
                </span>
                <span className="kerminal-context-menu-label flex min-w-0 flex-col items-start">
                  <span className="max-w-full truncate">{profile.name}</span>
                  <span className="max-w-full truncate text-[10px] text-[var(--text-tertiary)]">
                    {profile.shell}
                  </span>
                </span>
                {profile.isDefault ? (
                  <span className="kerminal-context-menu-shortcut">默认</span>
                ) : null}
              </button>
            ))
          ) : (
            <TerminalCreateMenuEmpty
              label={query ? "没有匹配的 Profile" : "暂无本地 Profile"}
            />
          )}
        </TerminalCreateMenuGroup>
        <TerminalCreateMenuGroup label="已保存主机">
          {filteredOptions.hosts.length > 0 ? (
            filteredOptions.hosts.map((host) => (
              <button
                className="kerminal-context-menu-item"
                disabled={!onOpenHost}
                key={host.id}
                onClick={() => runAction(() => onOpenHost?.(host.id))}
                role="menuitem"
                type="button"
              >
                <span className="kerminal-context-menu-icon">
                  <Server />
                </span>
                <span className="kerminal-context-menu-label flex min-w-0 flex-col items-start">
                  <span className="max-w-full truncate">{host.name}</span>
                  <span className="max-w-full truncate text-[10px] text-[var(--text-tertiary)]">
                    {host.groupName} · {host.detail}
                  </span>
                </span>
              </button>
            ))
          ) : (
            <TerminalCreateMenuEmpty
              label={query ? "没有匹配的主机" : "暂无可打开的主机"}
            />
          )}
        </TerminalCreateMenuGroup>
        {onOpenConnection ? (
          <div className="kerminal-context-menu-group">
            <button
              className="kerminal-context-menu-item"
              onClick={() => runAction(onOpenConnection)}
              role="menuitem"
              type="button"
            >
              <span className="kerminal-context-menu-icon">
                <Plus />
              </span>
              <span className="kerminal-context-menu-label">添加连接...</span>
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );

  return typeof document === "undefined"
    ? panel
    : createPortal(panel, document.body);
}

/** 为面板分组提供可访问名称，同时复用统一分隔样式。 */
function TerminalCreateMenuGroup({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <div aria-label={label} className="kerminal-context-menu-group" role="group">
      <div className="px-2 pb-1 pt-1 text-[10px] font-medium text-[var(--text-tertiary)]">
        {label}
      </div>
      {children}
    </div>
  );
}

/** 空分组保留结构说明，但不伪装成可执行 menuitem。 */
function TerminalCreateMenuEmpty({ label }: { label: string }) {
  return (
    <div className="px-2 py-1.5 text-[11px] text-[var(--text-tertiary)]">
      {label}
    </div>
  );
}
