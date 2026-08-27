// @author kongweiguang

import { ChevronRight } from "lucide-react";
import {
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type Ref,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "../../lib/cn";

interface TerminalTabGroupMenuOption {
  id: string;
  title: string;
}

/**
 * 移动到组使用独立 portal，避免根菜单裁剪长列表；fixed 坐标会按视口翻转，
 * 并将方向键焦点限制在子菜单层，兼顾窄窗口和键盘导航。
 */
export function TerminalTabMoveToGroupMenu({
  groups,
  onMoveToGroup,
}: {
  groups: readonly TerminalTabGroupMenuOption[];
  onMoveToGroup: (groupId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const submenuRef = useRef<HTMLDivElement>(null);

  /** 根据触发按钮和实际子菜单尺寸选择方向，保证菜单不越出当前视口。 */
  const updatePosition = () => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const triggerRect = trigger.getBoundingClientRect();
    const submenuRect = submenuRef.current?.getBoundingClientRect();
    const width = submenuRect?.width || 232;
    const height =
      submenuRect?.height || Math.min(window.innerHeight * 0.7, 360);
    const margin = 8;
    const placeRight =
      triggerRect.right + margin + width <= window.innerWidth - margin;
    const left = placeRight
      ? triggerRect.right + margin
      : Math.max(margin, triggerRect.left - margin - width);
    const top = Math.min(
      Math.max(margin, triggerRect.top),
      Math.max(margin, window.innerHeight - height - margin),
    );
    setPosition({ left: Math.round(left), top: Math.round(top) });
  };

  /** 打开后定位并聚焦首个可用组，窗口变化时持续修正 portal 位置。 */
  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
    const frame = window.requestAnimationFrame(() =>
      submenuRef.current
        ?.querySelector<HTMLButtonElement>('[role="menuitem"]:not([disabled])')
        ?.focus(),
    );
    const handleViewportChange = () => updatePosition();
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [open]);

  /** 子菜单只在自身可用项间循环，Escape 和左键关闭并归还焦点。 */
  const handleSubmenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"]:not([disabled])',
      ),
    );
    const currentIndex = items.indexOf(
      document.activeElement as HTMLButtonElement,
    );
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      const delta = event.key === "ArrowDown" ? 1 : -1;
      if (items.length > 0)
        items[(currentIndex + delta + items.length) % items.length]?.focus();
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      event.stopPropagation();
      (event.key === "Home" ? items[0] : items[items.length - 1])?.focus();
    } else if (event.key === "Escape" || event.key === "ArrowLeft") {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  return (
    <>
      <div className="relative" role="none">
        <TerminalTabMenuItem
          ariaExpanded={open}
          ariaHasPopup="menu"
          buttonRef={triggerRef}
          label="移动到标签组"
          onClick={() => setOpen(true)}
          onMouseEnter={() => setOpen(true)}
          onKeyDown={(event) => {
            if (
              event.key === "ArrowRight" ||
              event.key === "Enter" ||
              event.key === " "
            ) {
              event.preventDefault();
              setOpen(true);
            } else if (event.key === "Escape" || event.key === "ArrowLeft")
              setOpen(false);
          }}
          rightIcon={
            <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-65" />
          }
        />
      </div>
      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              aria-label="移动到标签组"
              className="kerminal-context-menu kerminal-floating-enter kerminal-layer-popover fixed z-[1000] w-56 max-h-[min(70vh,360px)] overflow-y-auto"
              onClick={(event) => event.stopPropagation()}
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onKeyDown={handleSubmenuKeyDown}
              ref={submenuRef}
              role="menu"
              style={position}
            >
              <div className="px-2 py-1 text-xs font-medium text-zinc-500 dark:text-zinc-400">
                选择标签组
              </div>
              {groups.map((group) => (
                <TerminalTabMenuItem
                  key={group.id}
                  label={`移入「${group.title}」`}
                  onClick={() => onMoveToGroup(group.id)}
                />
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

interface TerminalTabMenuItemProps {
  ariaExpanded?: boolean;
  ariaHasPopup?: boolean | "menu";
  buttonRef?: Ref<HTMLButtonElement>;
  danger?: boolean;
  disabled?: boolean;
  label: string;
  onClick: () => void;
  onKeyDown?: (event: ReactKeyboardEvent<HTMLButtonElement>) => void;
  onMouseEnter?: () => void;
  rightIcon?: ReactNode;
}

/** 菜单项统一处理方向键焦点移动，同时保留浏览器原生 Enter/Space click 语义。 */
export function TerminalTabMenuItem({
  ariaExpanded,
  ariaHasPopup,
  buttonRef,
  danger = false,
  disabled,
  label,
  onClick,
  onKeyDown,
  onMouseEnter,
  rightIcon,
}: TerminalTabMenuItemProps) {
  /** 在当前 menu 层内移动焦点，不依赖浏览器对 role=menu 的非一致默认实现。 */
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    onKeyDown?.(event);
    if (
      event.defaultPrevented ||
      !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)
    )
      return;
    const menu = event.currentTarget.closest<HTMLElement>('[role="menu"]');
    if (!menu) return;
    const items = Array.from(
      menu.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"]:not([disabled])',
      ),
    ).filter((item) => item.closest('[role="menu"]') === menu);
    const index = items.indexOf(event.currentTarget);
    if (index < 0 || items.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? items.length - 1
          : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) %
            items.length;
    items[next]?.focus();
  };
  return (
    <button
      aria-expanded={ariaExpanded}
      aria-haspopup={ariaHasPopup}
      className={cn(
        "kerminal-context-menu-item",
        danger && "kerminal-context-menu-item--danger",
      )}
      disabled={disabled}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      onMouseEnter={onMouseEnter}
      ref={buttonRef}
      role="menuitem"
      type="button"
    >
      <span className="kerminal-context-menu-label">{label}</span>
      {ariaHasPopup ? <span className="sr-only">子菜单</span> : null}
      {rightIcon}
    </button>
  );
}
