/**
 * @author kongweiguang
 */

import { Bookmark, ChevronDown, LoaderCircle, Trash2 } from "lucide-react";
import { createPortal } from "react-dom";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { cn } from "../../../lib/cn";
import type { SftpFileTarget } from "../sftp-tool-content/types";
import { sftpBookmarkTargetFromFileTarget } from "./sftpBookmarkTarget";
import { useSftpBookmarks } from "./useSftpBookmarks";

interface SftpBookmarkControlProps {
  currentPath: string;
  disabled?: boolean;
  fileTarget: SftpFileTarget;
  loadDirectory: (path: string) => Promise<void>;
}

interface BookmarkMenuPosition {
  left: number;
  top: number;
}

/** 远程路径栏的收藏切换和书签跳转菜单。 */
export function SftpBookmarkControl({
  currentPath,
  disabled = false,
  fileTarget,
  loadDirectory,
}: SftpBookmarkControlProps) {
  const target = sftpBookmarkTargetFromFileTarget(fileTarget);
  const {
    bookmarks,
    error,
    isBookmarked,
    loading,
    mutating,
    setBookmarked,
  } = useSftpBookmarks(target);
  const controlRef = useRef<HTMLDivElement>(null);
  const dropdownButtonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<BookmarkMenuPosition>();
  const bookmarked = isBookmarked(currentPath);

  const updateMenuPosition = useCallback(() => {
    const rect = controlRef.current?.getBoundingClientRect();
    if (!rect || typeof window === "undefined") {
      return;
    }
    const menuWidth = Math.min(320, Math.max(window.innerWidth - 16, 0));
    setMenuPosition({
      left: Math.max(8, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 8)),
      top: rect.bottom + 6,
    });
  }, []);

  useEffect(() => {
    if (!menuOpen) {
      return undefined;
    }
    updateMenuPosition();
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);
    return () => {
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [menuOpen, updateMenuPosition]);

  useEffect(() => {
    if (!menuOpen || !menuPosition) {
      return;
    }
    const firstMenuItem = menuRef.current?.querySelector<HTMLElement>(
      '[role="menuitem"]',
    );
    (firstMenuItem ?? menuRef.current)?.focus();
  }, [bookmarks.length, error, loading, menuOpen, menuPosition]);

  const closeMenu = useCallback(() => {
    setMenuOpen(false);
    dropdownButtonRef.current?.focus();
  }, []);

  const handleMenuKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeMenu();
        return;
      }

      if (
        !(["ArrowDown", "ArrowUp", "Home", "End"] as string[]).includes(
          event.key,
        )
      ) {
        return;
      }
      const menuItems = Array.from(
        menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [],
      );
      if (menuItems.length === 0) {
        return;
      }
      event.preventDefault();
      const currentIndex = menuItems.indexOf(
        document.activeElement as HTMLElement,
      );
      const nextIndex =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? menuItems.length - 1
            : (currentIndex + (event.key === "ArrowUp" ? -1 : 1) + menuItems.length) %
              menuItems.length;
      menuItems[nextIndex]?.focus();
    },
    [closeMenu],
  );

  useEffect(() => {
    if (!menuOpen || typeof document === "undefined") {
      return undefined;
    }
    const closeWhenOutside = (event: PointerEvent) => {
      const node = event.target;
      if (!(node instanceof Node)) {
        return;
      }
      if (controlRef.current?.contains(node) || menuRef.current?.contains(node)) {
        return;
      }
      closeMenu();
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeMenu();
      }
    };
    document.addEventListener("pointerdown", closeWhenOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeWhenOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [closeMenu, menuOpen]);

  const navigateToBookmark = useCallback(
    (path: string) => {
      closeMenu();
      void loadDirectory(path);
    },
    [closeMenu, loadDirectory],
  );

  return (
    <div
      className="kerminal-muted-surface flex h-8 shrink-0 overflow-hidden rounded-lg border"
      ref={controlRef}
    >
      <button
        aria-label={bookmarked ? "取消收藏当前远程路径" : "收藏当前远程路径"}
        aria-pressed={bookmarked}
        className="kerminal-focus-ring flex h-full w-8 items-center justify-center text-zinc-600 transition hover:bg-[var(--surface-hover)] hover:text-zinc-950 disabled:cursor-not-allowed disabled:opacity-50 dark:text-zinc-300 dark:hover:text-zinc-50"
        disabled={disabled || mutating}
        onClick={() => void setBookmarked(currentPath, !bookmarked)}
        title={bookmarked ? "取消收藏当前路径" : "收藏当前路径"}
        type="button"
      >
        {mutating ? (
          <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Bookmark
            className={cn(
              "h-3.5 w-3.5",
              bookmarked &&
                "fill-sky-500 text-sky-600 dark:fill-sky-300 dark:text-sky-200",
            )}
          />
        )}
      </button>
      <button
        aria-expanded={menuOpen}
        aria-controls={menuId}
        aria-haspopup="menu"
        aria-label="打开 SFTP 路径书签"
        className="kerminal-focus-ring flex h-full w-6 items-center justify-center border-l border-[var(--border-subtle)] text-zinc-500 transition hover:bg-[var(--surface-hover)] hover:text-zinc-950 disabled:cursor-not-allowed disabled:opacity-50 dark:text-zinc-400 dark:hover:text-zinc-50"
        disabled={disabled}
        onClick={() => {
          setMenuOpen((current) => {
            if (current) {
              dropdownButtonRef.current?.focus();
            }
            return !current;
          });
        }}
        ref={dropdownButtonRef}
        title="路径书签"
        type="button"
      >
        <ChevronDown className="h-3.5 w-3.5" />
      </button>

      {menuOpen && menuPosition && typeof document !== "undefined"
        ? createPortal(
            <div
              aria-label="SFTP 路径书签"
              className="kerminal-floating-surface kerminal-floating-enter kerminal-layer-popover fixed w-80 max-w-[calc(100vw-1rem)] overflow-hidden rounded-[var(--radius-card)] border p-1.5 text-[13px] text-[var(--text-primary)]"
              id={menuId}
              onKeyDown={handleMenuKeyDown}
              ref={menuRef}
              role="menu"
              tabIndex={-1}
              style={menuPosition}
            >
              <div className="px-2 py-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">
                路径书签
              </div>
              {loading ? (
                <div className="flex items-center gap-2 px-2 py-2 text-sm text-zinc-500 dark:text-zinc-400" role="status">
                  <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                  正在读取书签…
                </div>
              ) : null}
              {error ? (
                <div className="px-2 py-2 text-sm text-rose-700 dark:text-rose-200" role="alert">
                  {error}
                </div>
              ) : null}
              {!loading && !error && bookmarks.length === 0 ? (
                <div className="px-2 py-2 text-sm text-zinc-500 dark:text-zinc-400">
                  暂无书签；点击书签图标保存当前路径。
                </div>
              ) : null}
              {!loading && !error
                ? bookmarks.map((bookmark) => (
                    <div
                      className="group flex min-w-0 items-center gap-1 rounded-[var(--radius-control)] px-1 hover:bg-[var(--surface-hover)]"
                      key={bookmark.path}
                      role="none"
                    >
                      <button
                        className="kerminal-focus-ring min-w-0 flex-1 truncate rounded-[var(--radius-control)] px-1.5 py-1.5 text-left text-sm text-zinc-700 dark:text-zinc-200"
                        onClick={() => navigateToBookmark(bookmark.path)}
                        role="menuitem"
                        title={bookmark.path}
                        type="button"
                      >
                        {bookmark.path}
                      </button>
                      <button
                        aria-label={`删除书签 ${bookmark.path}`}
                        className="kerminal-focus-ring flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-control)] text-zinc-400 opacity-0 transition hover:bg-rose-500/10 hover:text-rose-600 group-hover:opacity-100 focus-visible:opacity-100 dark:text-zinc-500 dark:hover:text-rose-200"
                        disabled={mutating}
                        onClick={() => void setBookmarked(bookmark.path, false)}
                        role="menuitem"
                        title="删除书签"
                        type="button"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))
                : null}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
