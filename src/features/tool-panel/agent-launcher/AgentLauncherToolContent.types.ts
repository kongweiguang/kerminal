// @author kongweiguang

import type { DesktopNotificationSettings } from "../../../lib/desktopNotificationPolicy";
import type {
  AppSettings,
  ResolvedTheme,
  TerminalAppearance,
} from "../../settings/contracts/index";
import type {
  TerminalPane,
  TerminalTab,
} from "../../workspace/contracts/index";

export interface AgentLauncherToolContentProps {
  activeTab?: TerminalTab;
  desktopNotifications?: DesktopNotificationSettings;
  focusedPane?: TerminalPane;
  onConfirmedSettingsChange?: (
    nextSettings: AppSettings,
  ) => Promise<AppSettings>;
  resolvedTheme?: ResolvedTheme;
  settings?: AppSettings;
  terminalAppearance?: TerminalAppearance;
  terminalPanes?: TerminalPane[];
  terminalTabs?: TerminalTab[];
}
