/**
 * @author kongweiguang
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  listSftpBookmarks,
  normalizeSftpBookmarkPath,
  setSftpBookmark,
  type SftpBookmark,
  type SftpBookmarkTarget,
} from "../../../lib/sftpBookmarkApi";
import { sftpBookmarkTargetKey } from "./sftpBookmarkTarget";

interface SftpBookmarkState {
  bookmarks: SftpBookmark[];
  error: string | null;
  loading: boolean;
  mutating: boolean;
}

const initialState: SftpBookmarkState = {
  bookmarks: [],
  error: null,
  loading: true,
  mutating: false,
};

/** 管理单个 SFTP 文件浏览 target 的书签读写，并忽略过期请求结果。 */
export function useSftpBookmarks(target: SftpBookmarkTarget) {
  const kind = target.kind;
  const hostId = target.hostId;
  const containerId =
    target.kind === "dockerContainer" ? target.containerId : undefined;
  const runtime = target.kind === "dockerContainer" ? target.runtime : undefined;
  const stableTarget = useMemo(
    () =>
      kind === "ssh"
        ? { hostId: hostId.trim(), kind: "ssh" as const }
        : {
            containerId: containerId?.trim() ?? "",
            hostId: hostId.trim(),
            kind: "dockerContainer" as const,
            runtime: runtime ?? "docker",
          },
    [containerId, hostId, kind, runtime],
  );
  const targetKey = sftpBookmarkTargetKey(stableTarget);
  const targetKeyRef = useRef(targetKey);
  const requestIdRef = useRef(0);
  const [state, setState] = useState<SftpBookmarkState>(initialState);

  targetKeyRef.current = targetKey;

  useEffect(() => {
    const requestId = ++requestIdRef.current;
    let disposed = false;
    setState({ bookmarks: [], error: null, loading: true, mutating: false });
    void listSftpBookmarks(stableTarget).then(
      (bookmarks) => {
        if (disposed || requestId !== requestIdRef.current) {
          return;
        }
        setState({ bookmarks, error: null, loading: false, mutating: false });
      },
      (error: unknown) => {
        if (disposed || requestId !== requestIdRef.current) {
          return;
        }
        setState({
          bookmarks: [],
          error: bookmarkError(error, "无法读取 SFTP 路径书签。"),
          loading: false,
          mutating: false,
        });
      },
    );
    return () => {
      disposed = true;
    };
  }, [stableTarget]);

  const setBookmarked = useCallback(
    async (path: string, bookmarked: boolean) => {
      const requestKey = targetKey;
      const requestId = ++requestIdRef.current;
      setState((current) => ({ ...current, error: null, mutating: true }));
      try {
        const bookmarks = await setSftpBookmark({
          bookmarked,
          path: normalizeSftpBookmarkPath(path),
          target: stableTarget,
        });
        if (targetKeyRef.current !== requestKey || requestId !== requestIdRef.current) {
          return;
        }
        setState({ bookmarks, error: null, loading: false, mutating: false });
      } catch (error) {
        if (targetKeyRef.current !== requestKey || requestId !== requestIdRef.current) {
          return;
        }
        setState((current) => ({
          ...current,
          error: bookmarkError(error, "无法更新 SFTP 路径书签。"),
          mutating: false,
        }));
      }
    },
    [stableTarget, targetKey],
  );

  return {
    ...state,
    isBookmarked(path: string) {
      try {
        const normalized = normalizeSftpBookmarkPath(path);
        return state.bookmarks.some((bookmark) => bookmark.path === normalized);
      } catch {
        return false;
      }
    },
    setBookmarked,
  };
}

function bookmarkError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}
