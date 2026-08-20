// @author kongweiguang

import type { AppSettings, ResolvedTheme } from "../settingsModel";

export type SettingsSaveState = "idle" | "saving" | "saved" | "error";
export type McpHttpServerLoadState = "idle" | "loading" | "error";

export interface SettingsToolContentProps {
  externalChangeNotice?: string | null;
  initialSectionId?: VisibleSettingsSectionId;
  resolvedTheme?: ResolvedTheme;
  settings: AppSettings;
  saveError?: string | null;
  saveState?: SettingsSaveState;
  onConfirmedSettingsChange?: (settings: AppSettings) => Promise<AppSettings>;
  onSettingsChange: (settings: AppSettings) => void;
}

export type SettingsSectionId =
  | "settings-appearance"
  | "settings-terminal"
  | "settings-keyword-highlights"
  | "settings-suggestions"
  | "settings-external-launch"
  | "settings-desktop"
  | "settings-mcp"
  | "settings-sync"
  | "settings-sftp"
  | "settings-keybindings"
  | "settings-about";

export type VisibleSettingsSectionId = SettingsSectionId;
