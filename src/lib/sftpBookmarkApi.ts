/**
 * @author kongweiguang
 */

import { invoke, isTauri } from "@tauri-apps/api/core";
import type { RemoteTargetRef } from "./targetModel";

export type SftpBookmarkTarget = Extract<
  RemoteTargetRef,
  { kind: "ssh" | "dockerContainer" }
>;

export interface SftpBookmark {
  createdAtUnixMs: number;
  path: string;
}

export interface SftpBookmarkSetRequest {
  bookmarked: boolean;
  path: string;
  target: SftpBookmarkTarget;
}

const browserBookmarks = new Map<string, SftpBookmark[]>();

/** 列出当前可浏览远程目标的路径书签。 */
export async function listSftpBookmarks(
  target: SftpBookmarkTarget,
): Promise<SftpBookmark[]> {
  if (isTauri()) {
    return invoke<SftpBookmark[]>("sftp_bookmark_list", {
      request: { target },
    });
  }
  return browserBookmarksFor(target);
}

/** 设置远程路径的收藏状态，并返回该目标的最新书签列表。 */
export async function setSftpBookmark(
  request: SftpBookmarkSetRequest,
): Promise<SftpBookmark[]> {
  if (isTauri()) {
    return invoke<SftpBookmark[]>("sftp_bookmark_set", { request });
  }

  const targetKey = bookmarkTargetKey(request.target);
  const path = normalizeSftpBookmarkPath(request.path);
  const current = browserBookmarks.get(targetKey) ?? [];
  const exists = current.some((bookmark) => bookmark.path === path);
  const next = request.bookmarked
    ? (exists
      ? current
      : [{ createdAtUnixMs: Date.now(), path }, ...current])
    : current.filter((bookmark) => bookmark.path !== path);
  browserBookmarks.set(targetKey, next);
  return cloneBookmarks(next);
}

/** 让浏览器预览与 Rust 边界使用相同的 POSIX 路径规范化规则。 */
export function normalizeSftpBookmarkPath(path: string): string {
  if (/\p{C}/u.test(path)) {
    throw new Error("SFTP 书签路径不能包含控制字符");
  }
  const normalized = path.trim().replace(/\\/g, "/");
  const withRoot = normalized.startsWith("/") ? normalized : `/${normalized}`;
  const collapsed = withRoot.replace(/\/{2,}/g, "/") || "/";
  return collapsed.length > 1 ? collapsed.replace(/\/+$/g, "") : collapsed;
}

function browserBookmarksFor(target: SftpBookmarkTarget): SftpBookmark[] {
  return cloneBookmarks(browserBookmarks.get(bookmarkTargetKey(target)) ?? []);
}

function cloneBookmarks(bookmarks: SftpBookmark[]): SftpBookmark[] {
  return [...bookmarks]
    .sort(
      (left, right) =>
        right.createdAtUnixMs - left.createdAtUnixMs ||
        left.path.localeCompare(right.path),
    )
    .map((bookmark) => ({ ...bookmark }));
}

function bookmarkTargetKey(target: SftpBookmarkTarget): string {
  if (target.kind === "ssh") {
    return `ssh:${target.hostId.trim()}`;
  }
  return `${target.runtime ?? "docker"}:${target.hostId.trim()}:${target.containerId.trim()}`;
}
