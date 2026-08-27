// @author kongweiguang

import {
  useCallback,
  useEffect,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";

import type { SettingsSaveState } from "../features/settings/SettingsToolContent";
import type { WorkspaceShellLayout } from "../features/workspace/workspaceSession";
import { listProfiles, type TerminalProfile } from "../lib/profileApi";
import { reapOrphanTerminalSessions } from "../lib/terminalApi";
import type { ConfigRefreshCoordinator } from "./configRefreshCoordinator";
import { useKerminalConfigEvents } from "./useKerminalConfigEvents";
import { useWorkspaceSessionPersistence } from "./useWorkspaceSessionPersistence";

interface UseKerminalShellStartupSyncOptions {
  configRefreshCoordinator: ConfigRefreshCoordinator;
  handleWorkspaceShellLayoutRestored: (layout: WorkspaceShellLayout) => void;
  refreshRemoteHostTree: () => Promise<void>;
  settingsDialogDirtyRef: MutableRefObject<boolean>;
  settingsSaveState: SettingsSaveState;
  setProfileLoadError: Dispatch<SetStateAction<string | null>>;
  setProfiles: (profiles: TerminalProfile[]) => void;
  setWorkspaceSessionPersistenceNotice: Dispatch<SetStateAction<string | null>>;
  setShellNoticeVisible: Dispatch<SetStateAction<boolean>>;
  shellNoticeMessage: string | null;
  workspaceShellLayout: WorkspaceShellLayout;
}

/** 集中管理主壳启动同步，避免把生命周期细节堆积在页面编排组件中。 */
export function useKerminalShellStartupSync({
  configRefreshCoordinator,
  handleWorkspaceShellLayoutRestored,
  refreshRemoteHostTree,
  settingsDialogDirtyRef,
  settingsSaveState,
  setProfileLoadError,
  setProfiles,
  setWorkspaceSessionPersistenceNotice,
  setShellNoticeVisible,
  shellNoticeMessage,
  workspaceShellLayout,
}: UseKerminalShellStartupSyncOptions) {
  const reapLocalOrphanTerminalSessions = useCallback(async () => {
    try {
      const diagnostics = await reapOrphanTerminalSessions();
      if (diagnostics.reapedCount > 0) {
        console.info("Kerminal local PTY orphan reaper completed", diagnostics);
      }
    } catch (error) {
      console.warn("Kerminal local PTY orphan reaper failed", error);
    }
  }, []);

  useWorkspaceSessionPersistence({
    beforeRestore: reapLocalOrphanTerminalSessions,
    onPersistenceBlocked: setWorkspaceSessionPersistenceNotice,
    onShellLayoutRestored: handleWorkspaceShellLayoutRestored,
    shellLayout: workspaceShellLayout,
  });
  useKerminalConfigEvents({ coordinator: configRefreshCoordinator });

  useEffect(() => {
    if (settingsSaveState === "saved") {
      settingsDialogDirtyRef.current = false;
    }
  }, [settingsDialogDirtyRef, settingsSaveState]);

  useEffect(() => {
    if (!shellNoticeMessage) {
      setShellNoticeVisible(false);
      return undefined;
    }

    setShellNoticeVisible(true);
    const timer = window.setTimeout(() => {
      setShellNoticeVisible(false);
    }, 4200);
    return () => window.clearTimeout(timer);
  }, [setShellNoticeVisible, shellNoticeMessage]);

  useEffect(() => {
    let cancelled = false;

    listProfiles()
      .then((nextProfiles) => {
        if (!cancelled) {
          setProfiles(nextProfiles);
          setProfileLoadError(null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setProfileLoadError("终端配置加载失败，已使用默认本地配置。");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [setProfileLoadError, setProfiles]);

  useEffect(() => {
    void refreshRemoteHostTree();
  }, [refreshRemoteHostTree]);
}
