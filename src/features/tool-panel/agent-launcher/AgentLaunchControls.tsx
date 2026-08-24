// @author kongweiguang

import { createPortal } from "react-dom";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type Ref,
} from "react";
import { ChevronDown, Loader2, ShieldOff, Unlink } from "lucide-react";
import { cn } from "../../../lib/cn";
import {
  agentPermissionSkipFlag,
  type AgentLaunchPermissionMode,
} from "./agentLauncherModel";
import type { AgentSelectorOption } from "./AgentSelector";

export type AgentLaunchTargetMode = "current" | "unbound";

interface AgentLaunchSplitButtonProps {
  actionState: string | null;
  disabled?: boolean;
  onLaunch: (
    permissionMode?: AgentLaunchPermissionMode,
    targetMode?: AgentLaunchTargetMode,
  ) => void;
  option: AgentSelectorOption | null;
  primaryButtonRef?: Ref<HTMLButtonElement>;
}

interface LaunchMenuPosition {
  left: number;
  side: "bottom" | "top";
  top: number;
}

const MENU_WIDTH = 164;
const MENU_GAP = 6;
const MENU_INSET = 8;
const MENU_ESTIMATED_HEIGHT = 88;

/**
 * 分裂按钮把最常用的当前 Tab 启动留在主按钮，低频权限/全局模式收纳在次级菜单。
 * 组件只上抛明确模式，不推导 scope 或修改会话状态。
 */
export function AgentLaunchSplitButton({
  actionState,
  disabled: externallyDisabled = false,
  onLaunch,
  option,
  primaryButtonRef,
}: AgentLaunchSplitButtonProps) {
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const firstMenuItemRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<LaunchMenuPosition | null>(
    null,
  );
  const busy = Boolean(option && actionState === option.key);
  const disabled =
    externallyDisabled ||
    !option ||
    actionState !== null ||
    Boolean(option.disabled);
  const skipFlag = option ? permissionSkipFlagForOption(option) : undefined;

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const closeOnPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !menuButtonRef.current?.contains(target) &&
        !menuRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      menuButtonRef.current?.focus();
    };

    const animationFrame = window.requestAnimationFrame(() =>
      firstMenuItemRef.current?.focus(),
    );
    window.addEventListener("pointerdown", closeOnPointerDown);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("pointerdown", closeOnPointerDown);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) {
      setMenuPosition(null);
      return undefined;
    }

    /** 启动菜单跟随箭头按钮并自动翻转，确保底部工具栏也能完整显示两项操作。 */
    const updateMenuPosition = () => {
      const trigger = menuButtonRef.current;
      if (!trigger) {
        return;
      }
      setMenuPosition(resolveLaunchMenuPosition(trigger.getBoundingClientRect()));
    };

    updateMenuPosition();
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);
    return () => {
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [open]);

  /** 菜单项执行后立即收起浮层，防止异步启动期间残留可重复点击入口。 */
  const launchFromMenu = (
    permissionMode: AgentLaunchPermissionMode,
    targetMode: AgentLaunchTargetMode = "current",
  ) => {
    setOpen(false);
    onLaunch(permissionMode, targetMode);
  };

  /** 箭头键直接打开菜单，让键盘用户不必先用 Enter 再寻找第一项。 */
  const handleMenuButtonKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
    }
  };

  /** 菜单内使用方向键循环聚焦；Tab 保留浏览器原生顺序并在焦点移动后收起浮层。 */
  const handleLaunchMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Tab") {
      window.setTimeout(() => setOpen(false), 0);
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
      return;
    }
    event.preventDefault();
    const menuItems = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ??
        [],
    );
    if (menuItems.length === 0) {
      return;
    }
    const currentIndex = menuItems.findIndex(
      (item) => item === document.activeElement,
    );
    const direction = event.key === "ArrowDown" ? 1 : -1;
    const nextIndex =
      (Math.max(currentIndex, 0) + direction + menuItems.length) %
      menuItems.length;
    menuItems[nextIndex]?.focus();
  };

  return (
    <div className="relative -ml-px flex shrink-0">
      <button
        aria-label={option ? `使用 ${option.name} 进入` : "进入 Agent"}
        className="kerminal-focus-ring kerminal-pressable inline-flex h-11 min-w-[58px] items-center justify-center border border-[rgb(var(--app-accent))] bg-[rgb(var(--app-accent))] px-3 text-xs font-semibold text-white transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
        disabled={disabled}
        onClick={() => onLaunch("default", "current")}
        ref={primaryButtonRef}
        title={option?.disabledReason}
        type="button"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "进入"}
      </button>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="打开 Agent 启动选项"
        className="kerminal-focus-ring kerminal-pressable inline-flex h-11 w-8 items-center justify-center rounded-r-[var(--radius-control)] border border-l border-[rgb(var(--app-accent))] bg-[rgb(var(--app-accent))] text-white transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={handleMenuButtonKeyDown}
        ref={menuButtonRef}
        type="button"
      >
        <ChevronDown
          aria-hidden="true"
          className={cn(
            "h-3.5 w-3.5 transition-transform duration-150",
            open ? "rotate-180" : "",
          )}
          strokeWidth={2}
        />
      </button>

      {open && menuPosition && option
        ? createPortal(
            <div
              aria-label={`${option.name} 启动选项`}
              className="kerminal-context-menu kerminal-agent-launch-menu kerminal-floating-enter kerminal-layer-popover fixed w-[164px]"
              data-side={menuPosition.side}
              onKeyDown={handleLaunchMenuKeyDown}
              ref={menuRef}
              role="menu"
              style={{ left: menuPosition.left, top: menuPosition.top }}
            >
              <div className="kerminal-context-menu-group">
                {skipFlag ? (
                  <button
                    aria-label={`跳过权限打开 ${option.name}`}
                    className="kerminal-context-menu-item kerminal-agent-launch-menu-item"
                    onClick={() => launchFromMenu("skipPermissions")}
                    ref={firstMenuItemRef}
                    role="menuitem"
                    title={`启动时附加 ${skipFlag}`}
                    type="button"
                  >
                    <span className="kerminal-context-menu-icon">
                      <ShieldOff />
                    </span>
                    <span className="kerminal-context-menu-label">
                      跳过权限打开
                    </span>
                  </button>
                ) : null}
                <button
                  aria-label={`允许 ${option.name} 操作整个 Kerminal`}
                  className="kerminal-context-menu-item kerminal-agent-launch-menu-item"
                  onClick={() => launchFromMenu("default", "unbound")}
                  ref={skipFlag ? undefined : firstMenuItemRef}
                  role="menuitem"
                  title="允许 Agent 操作所有标签、终端和 Kerminal 运行态"
                  type="button"
                >
                  <span className="kerminal-context-menu-icon">
                    <Unlink />
                  </span>
                  <span className="kerminal-context-menu-label">
                    操作整个 Kerminal
                  </span>
                </button>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

/**
 * 跳过权限只属于 Codex/Claude 的原生 CLI 能力；PI 与 Custom 不渲染无效入口，
 * 避免用户把“菜单里有选项”误解为后端会提供同等权限模式。
 */
function permissionSkipFlagForOption(option: AgentSelectorOption) {
  return option.agentId === "codex" || option.agentId === "claude"
    ? agentPermissionSkipFlag(option.agentId)
    : undefined;
}

/** 在目标控件附近选择上下展开方向，并将菜单水平位置限制在可视区域内。 */
function resolveLaunchMenuPosition(rect: DOMRect): LaunchMenuPosition {
  const viewportWidth = Math.max(window.innerWidth, MENU_WIDTH + MENU_INSET * 2);
  const viewportHeight = Math.max(
    window.innerHeight,
    MENU_ESTIMATED_HEIGHT + MENU_INSET * 2,
  );
  const availableBelow = viewportHeight - rect.bottom - MENU_GAP - MENU_INSET;
  const side =
    availableBelow >= MENU_ESTIMATED_HEIGHT || availableBelow >= rect.top
      ? "bottom"
      : "top";
  const left = Math.min(
    Math.max(MENU_INSET, rect.right - MENU_WIDTH),
    viewportWidth - MENU_WIDTH - MENU_INSET,
  );
  const top =
    side === "bottom"
      ? Math.min(
          rect.bottom + MENU_GAP,
          viewportHeight - MENU_ESTIMATED_HEIGHT - MENU_INSET,
        )
      : Math.max(MENU_INSET, rect.top - MENU_GAP - MENU_ESTIMATED_HEIGHT);
  return { left, side, top };
}
