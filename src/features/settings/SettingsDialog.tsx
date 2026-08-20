// @author kongweiguang

import { useEffect, useRef, useState } from "react";
import { ModalShell } from "../../components/ui/modal-shell";
import {
  SettingsToolContent,
  type SettingsSaveState,
  type SettingsSectionId,
} from "./SettingsToolContent";
import type { AppSettings } from "./settingsModel";

interface SettingsDialogProps {
  initialSectionId?: SettingsSectionId;
  open: boolean;
  saveError?: string | null;
  saveState?: SettingsSaveState;
  settings: AppSettings;
  onClose: () => void;
  onConfirmedSettingsChange?: (settings: AppSettings) => Promise<AppSettings>;
  onSettingsChange: (settings: AppSettings) => void;
}

export function SettingsDialog({
  initialSectionId,
  onClose,
  onConfirmedSettingsChange,
  onSettingsChange,
  open,
  saveError,
  saveState,
  settings,
}: SettingsDialogProps) {
  const [draftSettings, setDraftSettings] = useState(settings);
  const [draftDirty, setDraftDirty] = useState(false);
  const [externalChangeNotice, setExternalChangeNotice] = useState<
    string | null
  >(null);
  const wasOpenRef = useRef(false);
  const lastSettingsFingerprintRef = useRef(settingsFingerprint(settings));

  useEffect(() => {
    const nextFingerprint = settingsFingerprint(settings);
    if (!open) {
      wasOpenRef.current = false;
      lastSettingsFingerprintRef.current = nextFingerprint;
      setDraftDirty(false);
      setExternalChangeNotice(null);
      return;
    }

    if (!wasOpenRef.current) {
      wasOpenRef.current = true;
      lastSettingsFingerprintRef.current = nextFingerprint;
      setDraftSettings(settings);
      setDraftDirty(false);
      setExternalChangeNotice(null);
      return;
    }

    if (nextFingerprint === lastSettingsFingerprintRef.current) {
      return;
    }
    lastSettingsFingerprintRef.current = nextFingerprint;

    if (!draftDirty || nextFingerprint === settingsFingerprint(draftSettings)) {
      setDraftSettings(settings);
      setDraftDirty(false);
      setExternalChangeNotice(null);
      return;
    }

    setExternalChangeNotice(
      "设置已在外部更新，当前编辑内容已保留。",
    );
  }, [draftDirty, draftSettings, open, settings]);

  useEffect(() => {
    if (open && saveState === "saved") {
      setDraftDirty(false);
    }
  }, [open, saveState]);

  const handleSettingsChange = (nextSettings: AppSettings) => {
    setDraftSettings(nextSettings);
    setDraftDirty(true);
    setExternalChangeNotice(null);
    onSettingsChange(nextSettings);
  };

  /**
   * 需要局部草稿的设置等待持久化成功后再替换对话框快照；失败时不触碰草稿，
   * 使关键词规则编辑器可以保留用户输入并直接重试。
   */
  const handleConfirmedSettingsChange = async (nextSettings: AppSettings) => {
    if (!onConfirmedSettingsChange) {
      handleSettingsChange(nextSettings);
      return nextSettings;
    }
    const storedSettings = await onConfirmedSettingsChange(nextSettings);
    setDraftSettings(storedSettings);
    setDraftDirty(false);
    setExternalChangeNotice(null);
    return storedSettings;
  };

  return (
    <ModalShell
      onClose={onClose}
      open={open}
      panelClassName="h-[min(780px,calc(100vh-48px))]"
      size="wide"
      title="设置"
    >
      <SettingsToolContent
        externalChangeNotice={externalChangeNotice}
        initialSectionId={initialSectionId}
        onConfirmedSettingsChange={handleConfirmedSettingsChange}
        onSettingsChange={handleSettingsChange}
        saveError={saveError}
        saveState={saveState}
        settings={draftSettings}
      />
    </ModalShell>
  );
}

function settingsFingerprint(settings: AppSettings) {
  return JSON.stringify(settings);
}
