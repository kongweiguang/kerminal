// @author kongweiguang

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  SettingsSaveState,
  SettingsSectionId,
} from "../features/settings/SettingsToolContent";
import type { AppSettings } from "../features/settings/settingsModel";
import { getSettings, updateSettings } from "../features/settings/settingsApi";
import { DEFAULT_SETTINGS_SECTION_ID } from "./KerminalShell.static";

interface UseKerminalShellSettingsOptions {
  setSettings: (settings: AppSettings) => void;
}

/** 为普通设置和工具栏确认式保存提供同一份并发序列化与错误状态。 */
export function useKerminalShellSettings({
  setSettings,
}: UseKerminalShellSettingsOptions) {
  const [settingsLoadError, setSettingsLoadError] = useState<string | null>(
    null,
  );
  const [settingsSaveError, setSettingsSaveError] = useState<string | null>(
    null,
  );
  const [settingsSaveState, setSettingsSaveState] =
    useState<SettingsSaveState>("idle");
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const [settingsInitialSectionId, setSettingsInitialSectionId] =
    useState<SettingsSectionId>(DEFAULT_SETTINGS_SECTION_ID);
  const settingsSaveRequestRef = useRef(0);
  const settingsDialogDirtyRef = useRef(false);
  const settingsDialogOpenRef = useRef(settingsDialogOpen);
  const settingsSaveStateRef = useRef<SettingsSaveState>(settingsSaveState);
  settingsDialogOpenRef.current = settingsDialogOpen;
  settingsSaveStateRef.current = settingsSaveState;

  useEffect(() => {
    let cancelled = false;

    getSettings()
      .then((storedSettings) => {
        if (cancelled) {
          return;
        }
        setSettings(storedSettings);
        setSettingsLoadError(null);
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setSettingsLoadError("设置加载失败，已使用默认本地设置。");
      });

    return () => {
      cancelled = true;
    };
  }, [setSettings]);

  /**
   * 统一 settings 写入竞态：普通设置页保持原有乐观预览，工具栏编辑器则等待
   * 持久化成功后再提交，避免取消或失败时 rail 已经半更新。
   */
  const persistSettings = useCallback(
    async (nextSettings: AppSettings, optimistic: boolean) => {
      settingsSaveRequestRef.current += 1;
      const requestId = settingsSaveRequestRef.current;
      if (optimistic) {
        setSettings(nextSettings);
      }
      setSettingsSaveState("saving");
      setSettingsSaveError(null);

      try {
        const storedSettings = await updateSettings(nextSettings);
        if (requestId === settingsSaveRequestRef.current) {
          setSettings(storedSettings);
          setSettingsSaveState("saved");
        }
        return storedSettings;
      } catch (error: unknown) {
        if (requestId === settingsSaveRequestRef.current) {
          setSettingsSaveState("error");
          setSettingsSaveError(
            error instanceof Error ? error.message : String(error),
          );
        }
        throw error;
      }
    },
    [setSettings],
  );

  /** 普通设置页的兼容入口，错误仍由既有设置状态展示，不产生未处理 rejection。 */
  const handleSettingsChange = useCallback(
    (nextSettings: AppSettings) => {
      void persistSettings(nextSettings, true).catch(() => undefined);
    },
    [persistSettings],
  );

  /** 工具栏编辑器使用确认式保存，只有后端返回成功后才更新全局设置。 */
  const handleConfirmedSettingsChange = useCallback(
    (nextSettings: AppSettings) => persistSettings(nextSettings, false),
    [persistSettings],
  );

  const handleSettingsDialogChange = useCallback(
    (nextSettings: AppSettings) => {
      settingsDialogDirtyRef.current = true;
      handleSettingsChange(nextSettings);
    },
    [handleSettingsChange],
  );

  const handleSettingsDialogClose = useCallback(() => {
    settingsDialogDirtyRef.current = false;
    settingsDialogOpenRef.current = false;
    setSettingsDialogOpen(false);
  }, []);

  const openSettingsTool = useCallback(
    (sectionId: SettingsSectionId = DEFAULT_SETTINGS_SECTION_ID) => {
      settingsDialogDirtyRef.current = false;
      settingsDialogOpenRef.current = true;
      setSettingsInitialSectionId(sectionId);
      setSettingsDialogOpen(true);
    },
    [],
  );

  return {
    handleSettingsChange,
    handleConfirmedSettingsChange,
    handleSettingsDialogChange,
    handleSettingsDialogClose,
    openSettingsTool,
    settingsDialogDirtyRef,
    settingsDialogOpen,
    settingsDialogOpenRef,
    settingsInitialSectionId,
    settingsLoadError,
    settingsSaveError,
    settingsSaveState,
    settingsSaveStateRef,
  };
}
