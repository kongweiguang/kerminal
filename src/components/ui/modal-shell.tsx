// @author kongweiguang

import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "../../lib/cn";
import { Button } from "./button";

interface ModalShellProps {
  backdrop?: "glass" | "solid";
  bodyClassName?: string;
  children: ReactNode;
  description?: string;
  footer?: ReactNode;
  headerActions?: ReactNode;
  layout?: "default" | "fullscreen" | "workspace";
  size?: "compact" | "small" | "medium" | "large" | "wide";
  maxWidthClassName?: string;
  open: boolean;
  panelClassName?: string;
  title: string;
  onClose: () => void;
}

const modalSizeClassNames = {
  compact: {
    maxHeight: "max-h-[min(18rem,calc(100vh-48px))]",
    width: "max-w-md",
  },
  small: {
    maxHeight: "max-h-[min(24rem,calc(100vh-48px))]",
    width: "max-w-lg",
  },
  medium: {
    maxHeight: "max-h-[min(34rem,calc(100vh-48px))]",
    width: "max-w-2xl",
  },
  large: {
    maxHeight: "max-h-[min(44rem,calc(100vh-48px))]",
    width: "max-w-5xl",
  },
  wide: {
    maxHeight: "max-h-[min(780px,calc(100vh-48px))]",
    width: "max-w-6xl",
  },
} satisfies Record<
  NonNullable<ModalShellProps["size"]>,
  { maxHeight: string; width: string }
>;

const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

const activeModalStack: string[] = [];
let previousBodyOverflow = "";

function isTopModal(modalId: string) {
  return activeModalStack[activeModalStack.length - 1] === modalId;
}

function getFocusableElements(panel: HTMLElement) {
  return Array.from(panel.querySelectorAll<HTMLElement>(focusableSelector)).filter(
    (element) => !element.hidden && element.getAttribute("aria-hidden") !== "true",
  );
}

function hasHeightConstraintClassName(className?: string) {
  return /(?:^|\s)(?:h-|max-h-)/.test(className ?? "");
}

/**
 * 全屏 overlay 共用的顶部窗口拖拽条。
 *
 * Tauri 会为 `data-tauri-drag-region` 注入拖拽和双击最大化逻辑；
 * 这里不再额外监听双击，避免 Windows/Linux 连续切换两次窗口状态。
 */
export function WindowDragStrip() {
  return (
    <div
      aria-hidden="true"
      className="absolute inset-x-0 top-0 z-[1] h-3"
      data-tauri-drag-region
      data-window-drag-strip=""
    />
  );
}

export function ModalShell({
  backdrop = "glass",
  bodyClassName,
  children,
  description,
  footer,
  headerActions,
  layout = "default",
  maxWidthClassName,
  onClose,
  open,
  panelClassName,
  size = "medium",
  title,
}: ModalShellProps) {
  const titleId = useId();
  const descriptionId = useId();
  const modalId = useId();
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  const fullscreen = layout === "fullscreen";
  const workspace = layout === "workspace";
  const solidBackdrop = backdrop === "solid";
  const sizeClassNames = modalSizeClassNames[size];
  const resolvedMaxWidthClassName =
    maxWidthClassName ??
    (fullscreen || workspace ? "max-w-none" : sizeClassNames.width);
  const presetMaxHeightClassName =
    fullscreen || workspace
      ? null
      : hasHeightConstraintClassName(maxWidthClassName) ||
          hasHeightConstraintClassName(panelClassName)
        ? null
        : sizeClassNames.maxHeight;

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    activeModalStack.push(modalId);

    // body portal 共享滚动锁；嵌套弹框关闭时不能提前恢复页面滚动。
    if (activeModalStack.length === 1) {
      previousBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }

    const focusInitialElement = () => {
      const panel = panelRef.current;
      if (!panel || !isTopModal(modalId)) {
        return;
      }
      // React autoFocus 会先于 RAF 生效；已有合法焦点时不能再抢回关闭按钮。
      if (
        document.activeElement instanceof HTMLElement &&
        document.activeElement !== panel &&
        panel.contains(document.activeElement)
      ) {
        return;
      }
      const autofocus = panel.querySelector<HTMLElement>("[autofocus]");
      const firstFocusable = getFocusableElements(panel)[0];
      (autofocus ?? firstFocusable ?? panel).focus();
    };
    const animationFrame = window.requestAnimationFrame(focusInitialElement);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isTopModal(modalId)) {
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") {
        return;
      }

      const panel = panelRef.current;
      if (!panel) {
        return;
      }
      const focusable = getFocusableElements(panel);
      if (focusable.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("keydown", handleKeyDown, true);
      const stackIndex = activeModalStack.lastIndexOf(modalId);
      if (stackIndex >= 0) {
        activeModalStack.splice(stackIndex, 1);
      }
      if (activeModalStack.length === 0) {
        document.body.style.overflow = previousBodyOverflow;
      }
      if (previouslyFocused?.isConnected) {
        previouslyFocused.focus();
      }
    };
  }, [modalId, open]);

  if (!open) {
    return null;
  }

  return createPortal(
    <div
      data-compositor={backdrop}
      className={cn(
        "kerminal-layer-dialog fixed inset-0 flex",
        !solidBackdrop && "backdrop-blur-md",
        workspace
          ? "items-center justify-center bg-zinc-950/24 p-3 dark:bg-[rgb(9_9_11_/_0.52)] sm:p-6"
          : "bg-zinc-950/30 dark:bg-black/48",
        fullscreen
          ? "items-stretch justify-center px-1 pb-1 pt-3 sm:px-2 sm:pb-2 sm:pt-3"
          : !workspace && "items-center justify-center p-4",
      )}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && isTopModal(modalId)) {
          onClose();
        }
      }}
    >
      <WindowDragStrip />
      <section
        ref={panelRef}
        aria-describedby={description ? descriptionId : undefined}
        aria-labelledby={titleId}
        aria-modal="true"
        className={cn(
          "kerminal-floating-enter relative z-10 flex w-full flex-col overflow-hidden text-zinc-950 dark:text-zinc-50",
          workspace || solidBackdrop
            ? "kerminal-solid-surface rounded-[var(--radius-dialog)] border bg-[var(--surface-overlay)]"
            : "kerminal-floating-surface rounded-[var(--radius-dialog)] border",
          fullscreen
            ? "h-full max-h-none"
            : workspace
              ? "h-[min(700px,calc(100vh-72px))] max-h-[calc(100vh-40px)] w-[min(1100px,calc(100vw-48px))]"
              : presetMaxHeightClassName,
          resolvedMaxWidthClassName,
          panelClassName,
        )}
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        tabIndex={-1}
      >
        <header
          className={cn(
            "flex shrink-0 items-start justify-between gap-4 border-b border-[var(--border-subtle)]",
            workspace ? "px-4 py-3" : "px-5 py-4",
          )}
        >
          <div className="min-w-0">
            <h2 className="text-[17px] font-semibold leading-6" id={titleId}>
              {title}
            </h2>
            {description ? (
              <p
                className="mt-1 text-[13px] leading-5 text-zinc-500 dark:text-zinc-400"
                id={descriptionId}
              >
                {description}
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {headerActions}
            <Button
              aria-label="关闭弹窗"
              onClick={onClose}
              size="icon"
              type="button"
              variant="ghost"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </header>
        <div
          className={cn(
            fullscreen || workspace
              ? "min-h-0 flex-1 overflow-hidden p-3"
              : "scrollbar-none min-h-0 flex-auto overflow-y-auto px-5 py-4",
            bodyClassName,
          )}
        >
          {children}
        </div>
        {footer ? (
          <footer className="flex shrink-0 justify-end gap-2 border-t border-[var(--border-subtle)] px-5 py-4">
            {footer}
          </footer>
        ) : null}
      </section>
    </div>,
    document.body,
  );
}
