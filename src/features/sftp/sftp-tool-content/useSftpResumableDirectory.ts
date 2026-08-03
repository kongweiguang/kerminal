// @author kongweiguang

import { useEffect, type MutableRefObject } from "react";
import type { SftpRemoteBrowserState } from "./sftpRemoteBrowserModel";

interface UseSftpResumableDirectoryOptions {
  active: boolean;
  currentPath?: string;
  initialPath?: string;
  loadDirectory: (path: string) => Promise<void>;
  onCurrentPathChange?: (path: string) => void;
  stateRef: MutableRefObject<SftpRemoteBrowserState>;
}

/** 发布已确认目录，并在隐藏期间换目标后补做首次加载。 */
export function useSftpResumableDirectory({
  active,
  currentPath,
  initialPath,
  loadDirectory,
  onCurrentPathChange,
  stateRef,
}: UseSftpResumableDirectoryOptions) {
  useEffect(() => {
    if (currentPath) {
      onCurrentPathChange?.(currentPath);
    }
  }, [currentPath, onCurrentPathChange]);

  useEffect(() => {
    const current = stateRef.current;
    if (active && initialPath && !current.listing && !current.loading) {
      void loadDirectory(initialPath);
    }
  }, [active, initialPath, loadDirectory, stateRef]);
}
