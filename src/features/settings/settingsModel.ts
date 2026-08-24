// @author kongweiguang

import {
  defaultAppearanceSettings,
  defaultAppSettings,
  defaultDesktopNotificationSettings,
  defaultExternalLaunchSettings,
  defaultKeybindings,
  defaultSftpPerformanceSettings,
  defaultTerminalAppearance,
} from "./settingsDefaults";
import {
  normalizeAgentLauncherSettings,
  type AgentLauncherSettings,
} from "./agentLauncherSettings";
import {
  SFTP_GLOBAL_TRANSFERS_MAX,
  SFTP_GLOBAL_TRANSFERS_MIN,
  SFTP_HOST_TRANSFERS_MAX,
  SFTP_HOST_TRANSFERS_MIN,
  SFTP_PACKET_BYTES_MAX,
  SFTP_PACKET_BYTES_MIN,
  SFTP_PIPELINE_DEPTH_MAX,
  SFTP_PIPELINE_DEPTH_MIN,
  SFTP_TIMEOUT_SECONDS_MAX,
  SFTP_TIMEOUT_SECONDS_MIN,
  TERMINAL_INLINE_SUGGESTION_RETENTION_DAYS_MAX,
  TERMINAL_INLINE_SUGGESTION_RETENTION_DAYS_MIN,
} from "./settingsLimits";
import {
  normalizeToolRailSettings,
  type ToolRailSettings,
} from "../tool-panel";
import {
  normalizeTerminalKeywordHighlightSettings,
  type TerminalKeywordHighlightSettings,
} from "./terminalKeywordHighlightModel";

export * from "./agentLauncherSettings";

export {
  defaultAppSettings,
  defaultKeybindings,
  defaultTerminalAppearance,
} from "./settingsDefaults";
export {
  SFTP_GLOBAL_TRANSFERS_MAX,
  SFTP_GLOBAL_TRANSFERS_MIN,
  SFTP_HOST_TRANSFERS_MAX,
  SFTP_HOST_TRANSFERS_MIN,
  SFTP_PACKET_BYTES_MAX,
  SFTP_PACKET_BYTES_MIN,
  SFTP_PIPELINE_DEPTH_MAX,
  SFTP_PIPELINE_DEPTH_MIN,
  SFTP_TIMEOUT_SECONDS_MAX,
  SFTP_TIMEOUT_SECONDS_MIN,
} from "./settingsLimits";

export {
  backgroundImageFitOptions,
  interfaceDensityOptions,
  interfaceLanguageOptions,
  terminalColorSchemeOptions,
  terminalCursorStyleOptions,
  terminalFontOptions,
  terminalFontWeightOptions,
  terminalRendererTypeOptions,
  terminalRightClickBehaviorOptions,
} from "./settingsOptions";
export {
  isTerminalKeywordHighlightCustomColorsComplete,
  isTerminalKeywordHighlightHexColor,
  normalizeTerminalKeywordHighlightRule,
  terminalKeywordHighlightColorsForTheme,
  terminalKeywordHighlightPalette,
  terminalKeywordHighlightPresetStyles,
  TERMINAL_KEYWORD_HIGHLIGHT_NOTE_LIMIT,
  TERMINAL_KEYWORD_HIGHLIGHT_PATTERN_LIMIT,
  TERMINAL_KEYWORD_HIGHLIGHT_RULE_LIMIT,
} from "./terminalKeywordHighlightModel";
export type {
  TerminalKeywordHighlightColorPair,
  TerminalKeywordHighlightCustomColors,
  TerminalKeywordHighlightMatchMode,
  TerminalKeywordHighlightRule,
  TerminalKeywordHighlightSettings,
  TerminalKeywordHighlightStyle,
} from "./terminalKeywordHighlightModel";

export type ThemeMode = "dark" | "light" | "system";

export type ResolvedTheme = "dark" | "light";

export type InterfaceLanguage = "system" | "zhCN" | "enUS";
export type BackgroundImageFit = "cover" | "contain" | "tile";
export type InterfaceDensity = "compact" | "comfortable" | "spacious";
export type TerminalColorScheme =
  | "kerminal"
  | "tokyoNight"
  | "solarized"
  | "github";
export type TerminalCursorStyle = "block" | "bar" | "underline";
export type TerminalFontWeight = "normal" | "medium" | "bold";
export type TerminalRendererType = "auto" | "cpu" | "gpu";
export type TerminalRightClickBehavior = "none" | "paste" | "menu";
export type TerminalInlineSuggestionAcceptKey = "disabled" | "rightArrow";
export type TerminalCommandSuggestionPresentation =
  | "inline"
  | "inlineAndMenu"
  | "off";
type TerminalCommandSuggestionMenuShortcut = "ctrlSpace";
export type TerminalCommandSuggestionRemoteRefresh = "off" | "safe";
export type KeybindingScope = "global" | "terminal" | "workspace";
export type KeybindingPlatform = "windows" | "mac";
export type ExternalLaunchSourceTool =
  | "putty"
  | "mobaxterm"
  | "xshell"
  | "securecrt"
  | "openssh"
  | "sftp-client"
  | "kerminal-native";

export const externalLaunchSourceTools: ExternalLaunchSourceTool[] = [
  "putty",
  "mobaxterm",
  "xshell",
  "securecrt",
  "openssh",
  "sftp-client",
  "kerminal-native",
];

export interface TerminalInlineSuggestionProviderSettings {
  history: boolean;
  remotePath: boolean;
  remoteCommand: boolean;
  git: boolean;
  spec: boolean;
}

export interface TerminalInlineSuggestionSettings {
  enabled: boolean;
  acceptKey: TerminalInlineSuggestionAcceptKey;
  presentation: TerminalCommandSuggestionPresentation;
  menuShortcut: TerminalCommandSuggestionMenuShortcut;
  tabOpensMenu: boolean;
  partialAccept: boolean;
  remoteRefresh: TerminalCommandSuggestionRemoteRefresh;
  providers: TerminalInlineSuggestionProviderSettings;
  remoteProbeEnabled: boolean;
  auditRetentionDays: number;
  feedbackRetentionDays: number;
}

export interface TerminalAppearance {
  autoReconnect: boolean;
  colorScheme: TerminalColorScheme;
  cursorStyle: TerminalCursorStyle;
  fontFamily: string;
  fontSize: number;
  fontWeight: TerminalFontWeight;
  darkColorScheme: TerminalColorScheme;
  lightColorScheme: TerminalColorScheme;
  lineHeight: number;
  macOptionIsMeta: boolean;
  rendererType: TerminalRendererType;
  rightClickBehavior: TerminalRightClickBehavior;
  selectionCopy: boolean;
  showCommandBlockRail: boolean;
  showTabNumbers: boolean;
  confirmCloseTab: boolean;
  cursorBlink: boolean;
  inlineSuggestion: TerminalInlineSuggestionSettings;
  keywordHighlights: TerminalKeywordHighlightSettings;
  scrollback: number;
}

export interface AppearanceSettings {
  backgroundEnabled: boolean;
  backgroundFit: BackgroundImageFit;
  backgroundImagePath: string;
  backgroundOpacity: number;
  interfaceLanguage: InterfaceLanguage;
  windowOpacity: number;
}

export interface DesktopNotificationSettings {
  backgroundOnly: boolean;
  enabled: boolean;
  importantOnly: boolean;
  minDurationMs: number;
  throttleMs: number;
}

export interface ExternalLaunchSettings {
  enabled: boolean;
  acceptVendorArgs: boolean;
  autoOpenSftp: boolean;
  disabledTools: ExternalLaunchSourceTool[];
}

export interface KeybindingSetting {
  action: string;
  label: string;
  description: string;
  binding: string;
  windowsBinding: string;
  macBinding: string;
  scope: KeybindingScope;
  editable: boolean;
}

export interface SftpPerformanceSettings {
  globalTransfers: number;
  hostTransfers: number;
  pipelineDepth: number;
  packetBytes: number;
  timeoutSeconds: number;
}

export interface AppSettings {
  agentLauncher: AgentLauncherSettings;
  appearance: AppearanceSettings;
  desktopNotifications: DesktopNotificationSettings;
  externalLaunch: ExternalLaunchSettings;
  interfaceDensity: InterfaceDensity;
  themeMode: ThemeMode;
  terminal: TerminalAppearance;
  keybindings: KeybindingSetting[];
  sftp: SftpPerformanceSettings;
  toolRail: ToolRailSettings;
}

/**
 * 归一化跨版本 settings payload，并把右栏偏好与其他全局设置保持在同一快照中，
 * 这样旧 settings.toml 缺少 toolRail 时仍能无感升级。
 */
export function normalizeAppSettings(
  settings?: Partial<AppSettings>,
): AppSettings {
  const agentLauncher = normalizeAgentLauncherSettings(settings?.agentLauncher);
  const appearance = settings?.appearance ?? defaultAppearanceSettings;
  const desktopNotifications =
    settings?.desktopNotifications ?? defaultDesktopNotificationSettings;
  const externalLaunch = normalizeExternalLaunch(settings?.externalLaunch);
  const terminal = settings?.terminal ?? defaultTerminalAppearance;
  const keybindings = normalizeKeybindings(settings?.keybindings);
  const sftp = settings?.sftp ?? defaultSftpPerformanceSettings;
  const toolRail = normalizeToolRailSettings(settings?.toolRail);
  const sftpGlobalTransfers = clampNumber(
    sftp.globalTransfers,
    SFTP_GLOBAL_TRANSFERS_MIN,
    SFTP_GLOBAL_TRANSFERS_MAX,
    defaultSftpPerformanceSettings.globalTransfers,
  );
  const sftpHostTransfers = Math.min(
    sftpGlobalTransfers,
    clampNumber(
      sftp.hostTransfers,
      SFTP_HOST_TRANSFERS_MIN,
      SFTP_HOST_TRANSFERS_MAX,
      defaultSftpPerformanceSettings.hostTransfers,
    ),
  );

  return {
    agentLauncher,
    appearance: {
      backgroundEnabled:
        appearance.backgroundEnabled ??
        defaultAppearanceSettings.backgroundEnabled,
      backgroundFit: normalizeBackgroundImageFit(appearance.backgroundFit),
      backgroundImagePath:
        typeof appearance.backgroundImagePath === "string"
          ? appearance.backgroundImagePath.trim().slice(0, 1024)
          : defaultAppearanceSettings.backgroundImagePath,
      backgroundOpacity: clampNumber(
        appearance.backgroundOpacity,
        0,
        100,
        defaultAppearanceSettings.backgroundOpacity,
      ),
      interfaceLanguage: normalizeInterfaceLanguage(
        appearance.interfaceLanguage,
      ),
      windowOpacity: clampNumber(
        appearance.windowOpacity,
        35,
        100,
        defaultAppearanceSettings.windowOpacity,
      ),
    },
    desktopNotifications: {
      backgroundOnly: readBoolean(
        desktopNotifications.backgroundOnly,
        defaultDesktopNotificationSettings.backgroundOnly,
      ),
      enabled: readBoolean(
        desktopNotifications.enabled,
        defaultDesktopNotificationSettings.enabled,
      ),
      importantOnly: readBoolean(
        desktopNotifications.importantOnly,
        defaultDesktopNotificationSettings.importantOnly,
      ),
      minDurationMs: normalizeBoundedInteger(
        desktopNotifications.minDurationMs,
        defaultDesktopNotificationSettings.minDurationMs,
        1_000,
        120_000,
      ),
      throttleMs: normalizeBoundedInteger(
        desktopNotifications.throttleMs,
        defaultDesktopNotificationSettings.throttleMs,
        0,
        600_000,
      ),
    },
    externalLaunch,
    interfaceDensity: normalizeInterfaceDensity(settings?.interfaceDensity),
    keybindings,
    sftp: {
      globalTransfers: sftpGlobalTransfers,
      hostTransfers: sftpHostTransfers,
      packetBytes: clampNumber(
        sftp.packetBytes,
        SFTP_PACKET_BYTES_MIN,
        SFTP_PACKET_BYTES_MAX,
        defaultSftpPerformanceSettings.packetBytes,
      ),
      pipelineDepth: clampNumber(
        sftp.pipelineDepth,
        SFTP_PIPELINE_DEPTH_MIN,
        SFTP_PIPELINE_DEPTH_MAX,
        defaultSftpPerformanceSettings.pipelineDepth,
      ),
      timeoutSeconds: clampNumber(
        sftp.timeoutSeconds,
        SFTP_TIMEOUT_SECONDS_MIN,
        SFTP_TIMEOUT_SECONDS_MAX,
        defaultSftpPerformanceSettings.timeoutSeconds,
      ),
    },
    toolRail,
    terminal: {
      autoReconnect:
        terminal.autoReconnect ?? defaultTerminalAppearance.autoReconnect,
      colorScheme: normalizeTerminalColorScheme(terminal.colorScheme),
      confirmCloseTab:
        terminal.confirmCloseTab ?? defaultTerminalAppearance.confirmCloseTab,
      cursorBlink:
        terminal.cursorBlink ?? defaultTerminalAppearance.cursorBlink,
      cursorStyle: normalizeTerminalCursorStyle(terminal.cursorStyle),
      darkColorScheme: normalizeTerminalColorScheme(
        terminal.darkColorScheme ?? terminal.colorScheme,
      ),
      fontFamily: terminal.fontFamily || defaultTerminalAppearance.fontFamily,
      fontSize: clampNumber(
        terminal.fontSize,
        10,
        24,
        defaultTerminalAppearance.fontSize,
      ),
      fontWeight: normalizeTerminalFontWeight(terminal.fontWeight),
      inlineSuggestion: normalizeTerminalInlineSuggestion(
        terminal.inlineSuggestion,
      ),
      keywordHighlights: normalizeTerminalKeywordHighlightSettings(
        terminal.keywordHighlights,
      ),
      lightColorScheme: normalizeTerminalColorScheme(
        terminal.lightColorScheme ?? terminal.colorScheme,
      ),
      lineHeight: clampNumber(
        terminal.lineHeight,
        1,
        1.8,
        defaultTerminalAppearance.lineHeight,
      ),
      macOptionIsMeta:
        terminal.macOptionIsMeta ?? defaultTerminalAppearance.macOptionIsMeta,
      rendererType: normalizeTerminalRendererType(terminal.rendererType),
      rightClickBehavior: normalizeTerminalRightClickBehavior(
        terminal.rightClickBehavior,
      ),
      scrollback: clampNumber(
        terminal.scrollback,
        1000,
        50000,
        defaultTerminalAppearance.scrollback,
      ),
      selectionCopy:
        terminal.selectionCopy ?? defaultTerminalAppearance.selectionCopy,
      showCommandBlockRail: readBoolean(
        terminal.showCommandBlockRail,
        defaultTerminalAppearance.showCommandBlockRail,
      ),
      showTabNumbers:
        terminal.showTabNumbers ?? defaultTerminalAppearance.showTabNumbers,
    },
    themeMode: normalizeThemeMode(settings?.themeMode),
  };
}

function normalizeKeybindings(
  keybindings: Partial<KeybindingSetting>[] | undefined,
): KeybindingSetting[] {
  if (!keybindings || keybindings.length === 0) {
    return defaultKeybindings;
  }

  const defaultsByAction = new Map(
    defaultKeybindings.map((keybinding) => [keybinding.action, keybinding]),
  );
  const normalizedByAction = new Map<string, KeybindingSetting>();

  for (const keybinding of defaultKeybindings) {
    normalizedByAction.set(keybinding.action, keybinding);
  }

  for (const keybinding of keybindings) {
    if (!keybinding || typeof keybinding.action !== "string") {
      continue;
    }

    const fallback = defaultsByAction.get(keybinding.action);
    const windowsBinding = readString(keybinding.windowsBinding);
    const macBinding = readString(keybinding.macBinding);
    if (!windowsBinding || !macBinding) {
      continue;
    }
    const binding = readString(keybinding.binding) || windowsBinding;

    normalizedByAction.set(keybinding.action, {
      action: keybinding.action,
      binding,
      description:
        readString(keybinding.description) || fallback?.description || "",
      editable: keybinding.editable ?? fallback?.editable ?? false,
      label:
        readString(keybinding.label) || fallback?.label || keybinding.action,
      macBinding,
      scope:
        normalizeKeybindingScope(keybinding.scope) ??
        fallback?.scope ??
        "global",
      windowsBinding,
    });
  }

  return [
    ...defaultKeybindings.map(
      (keybinding) => normalizedByAction.get(keybinding.action) ?? keybinding,
    ),
    ...[...normalizedByAction.values()].filter(
      (keybinding) => !defaultsByAction.has(keybinding.action),
    ),
  ];
}

function normalizeExternalLaunch(
  settings: Partial<ExternalLaunchSettings> | undefined,
): ExternalLaunchSettings {
  return {
    acceptVendorArgs: readBoolean(
      settings?.acceptVendorArgs,
      defaultExternalLaunchSettings.acceptVendorArgs,
    ),
    autoOpenSftp: readBoolean(
      settings?.autoOpenSftp,
      defaultExternalLaunchSettings.autoOpenSftp,
    ),
    disabledTools: normalizeExternalLaunchDisabledTools(
      settings?.disabledTools,
    ),
    enabled: readBoolean(
      settings?.enabled,
      defaultExternalLaunchSettings.enabled,
    ),
  };
}

function normalizeExternalLaunchDisabledTools(
  value: unknown,
): ExternalLaunchSourceTool[] {
  if (!Array.isArray(value)) {
    return defaultExternalLaunchSettings.disabledTools;
  }
  const normalized: ExternalLaunchSourceTool[] = [];
  for (const item of value) {
    const tool = normalizeExternalLaunchSourceTool(item);
    if (tool && !normalized.includes(tool)) {
      normalized.push(tool);
    }
  }
  return normalized;
}

function normalizeExternalLaunchSourceTool(
  value: unknown,
): ExternalLaunchSourceTool | null {
  return typeof value === "string" &&
    externalLaunchSourceTools.includes(value as ExternalLaunchSourceTool)
    ? (value as ExternalLaunchSourceTool)
    : null;
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function readBoolean(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeOptionalNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeBoundedInteger(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
) {
  const numberValue = normalizeOptionalNumber(value);
  if (numberValue === null) {
    return fallback;
  }
  return Math.min(Math.max(Math.trunc(numberValue), min), max);
}

function normalizeTerminalInlineSuggestion(
  settings: Partial<TerminalInlineSuggestionSettings> | undefined,
): TerminalInlineSuggestionSettings {
  const defaults = defaultTerminalAppearance.inlineSuggestion;
  const providers: Partial<TerminalInlineSuggestionProviderSettings> =
    settings?.providers ?? {};
  const enabled = readBoolean(settings?.enabled, defaults.enabled);
  const remoteProbeEnabled = readBoolean(
    settings?.remoteProbeEnabled,
    defaults.remoteProbeEnabled,
  );
  const presentation = normalizeTerminalCommandSuggestionPresentation(
    settings?.presentation,
    enabled,
  );
  const remoteRefresh = normalizeTerminalCommandSuggestionRemoteRefresh(
    settings?.remoteRefresh,
    remoteProbeEnabled,
  );
  return {
    acceptKey: normalizeTerminalInlineSuggestionAcceptKey(settings?.acceptKey),
    enabled: enabled && presentation !== "off",
    presentation,
    menuShortcut: normalizeTerminalCommandSuggestionMenuShortcut(
      settings?.menuShortcut,
    ),
    tabOpensMenu: readBoolean(
      settings?.tabOpensMenu,
      defaults.tabOpensMenu,
    ),
    partialAccept: readBoolean(
      settings?.partialAccept,
      defaults.partialAccept,
    ),
    remoteRefresh,
    providers: {
      git: readBoolean(providers.git, defaults.providers.git),
      history: readBoolean(providers.history, defaults.providers.history),
      remoteCommand: readBoolean(
        providers.remoteCommand,
        defaults.providers.remoteCommand,
      ),
      remotePath: readBoolean(
        providers.remotePath,
        defaults.providers.remotePath,
      ),
      spec: readBoolean(providers.spec, defaults.providers.spec),
    },
    remoteProbeEnabled: remoteProbeEnabled && remoteRefresh !== "off",
    auditRetentionDays: normalizeBoundedInteger(
      settings?.auditRetentionDays,
      defaults.auditRetentionDays,
      TERMINAL_INLINE_SUGGESTION_RETENTION_DAYS_MIN,
      TERMINAL_INLINE_SUGGESTION_RETENTION_DAYS_MAX,
    ),
    feedbackRetentionDays: normalizeBoundedInteger(
      settings?.feedbackRetentionDays,
      defaults.feedbackRetentionDays,
      TERMINAL_INLINE_SUGGESTION_RETENTION_DAYS_MIN,
      TERMINAL_INLINE_SUGGESTION_RETENTION_DAYS_MAX,
    ),
  };
}

function normalizeTerminalCommandSuggestionPresentation(
  value: TerminalCommandSuggestionPresentation | undefined,
  legacyEnabled: boolean,
): TerminalCommandSuggestionPresentation {
  if (!legacyEnabled) {
    return "off";
  }
  if (value === "inline" || value === "inlineAndMenu" || value === "off") {
    return value;
  }
  return defaultTerminalAppearance.inlineSuggestion.presentation;
}

function normalizeTerminalCommandSuggestionMenuShortcut(
  value: TerminalCommandSuggestionMenuShortcut | undefined,
): TerminalCommandSuggestionMenuShortcut {
  return value === "ctrlSpace"
    ? value
    : defaultTerminalAppearance.inlineSuggestion.menuShortcut;
}

function normalizeTerminalCommandSuggestionRemoteRefresh(
  value: TerminalCommandSuggestionRemoteRefresh | undefined,
  legacyEnabled: boolean,
): TerminalCommandSuggestionRemoteRefresh {
  if (!legacyEnabled) {
    return "off";
  }
  return value === "off" || value === "safe"
    ? value
    : defaultTerminalAppearance.inlineSuggestion.remoteRefresh;
}

function normalizeTerminalInlineSuggestionAcceptKey(
  value: TerminalInlineSuggestionAcceptKey | undefined,
): TerminalInlineSuggestionAcceptKey {
  if (value === "disabled" || value === "rightArrow") {
    return value;
  }
  return defaultTerminalAppearance.inlineSuggestion.acceptKey;
}

function normalizeKeybindingScope(
  value: KeybindingScope | undefined,
): KeybindingScope | undefined {
  if (value === "global" || value === "terminal" || value === "workspace") {
    return value;
  }
  return undefined;
}

export function terminalColorSchemeForTheme(
  terminal: TerminalAppearance,
  resolvedTheme: ResolvedTheme,
) {
  return resolvedTheme === "light"
    ? terminal.lightColorScheme
    : terminal.darkColorScheme;
}

export function terminalFontWeightValue(fontWeight: TerminalFontWeight) {
  if (fontWeight === "bold") {
    return 600;
  }
  if (fontWeight === "medium") {
    return 500;
  }
  return 400;
}

function normalizeInterfaceLanguage(
  value: InterfaceLanguage | undefined,
): InterfaceLanguage {
  if (value === "system" || value === "zhCN" || value === "enUS") {
    return value;
  }
  return defaultAppearanceSettings.interfaceLanguage;
}

function normalizeBackgroundImageFit(
  value: BackgroundImageFit | undefined,
): BackgroundImageFit {
  if (value === "cover" || value === "contain" || value === "tile") {
    return value;
  }
  return defaultAppearanceSettings.backgroundFit;
}

function normalizeThemeMode(value: ThemeMode | undefined): ThemeMode {
  if (value === "dark" || value === "light" || value === "system") {
    return value;
  }
  return defaultAppSettings.themeMode;
}

function normalizeInterfaceDensity(
  value: InterfaceDensity | undefined,
): InterfaceDensity {
  if (value === "compact" || value === "comfortable" || value === "spacious") {
    return value;
  }
  return defaultAppSettings.interfaceDensity;
}

function normalizeTerminalColorScheme(
  value: TerminalColorScheme | undefined,
): TerminalColorScheme {
  if (
    value === "kerminal" ||
    value === "tokyoNight" ||
    value === "solarized" ||
    value === "github"
  ) {
    return value;
  }
  return defaultTerminalAppearance.colorScheme;
}

function normalizeTerminalCursorStyle(
  value: TerminalCursorStyle | undefined,
): TerminalCursorStyle {
  if (value === "block" || value === "bar" || value === "underline") {
    return value;
  }
  return defaultTerminalAppearance.cursorStyle;
}

function normalizeTerminalFontWeight(
  value: TerminalFontWeight | undefined,
): TerminalFontWeight {
  if (value === "normal" || value === "medium" || value === "bold") {
    return value;
  }
  return defaultTerminalAppearance.fontWeight;
}

function normalizeTerminalRendererType(
  value: TerminalRendererType | undefined,
): TerminalRendererType {
  if (value === "auto" || value === "cpu" || value === "gpu") {
    return value;
  }
  return defaultTerminalAppearance.rendererType;
}

function normalizeTerminalRightClickBehavior(
  value: TerminalRightClickBehavior | undefined,
): TerminalRightClickBehavior {
  if (value === "none" || value === "paste" || value === "menu") {
    return value;
  }
  return defaultTerminalAppearance.rightClickBehavior;
}

export function resolveThemeMode(
  themeMode: ThemeMode,
  systemPrefersDark: boolean,
): ResolvedTheme {
  if (themeMode === "system") {
    return systemPrefersDark ? "dark" : "light";
  }
  return themeMode;
}

function clampNumber(
  value: number | undefined,
  min: number,
  max: number,
  fallback: number,
) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return fallback;
  }
  return Math.min(Math.max(value, min), max);
}
