// @author kongweiguang

import { useEffect, useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { cn } from "../../lib/cn";
import { selectLocalFile } from "../../lib/fileDialogApi";
import {
  normalizeAppSettings,
  type KeybindingPlatform,
  type ResolvedTheme,
  type TerminalKeywordHighlightSettings,
  type ThemeMode,
} from "./settingsModel";
import { createSettingsDraftController } from "./settingsDraftController";
import { shortcutPlatform } from "./keybindingUtils";
import { AboutSettingsSection } from "./settings-tool-content/about-section";
import { AppearanceSettingsSection } from "./settings-tool-content/appearance-section";
import { CommandSuggestionSettingsSection } from "./settings-tool-content/command-suggestions-section";
import { DesktopSettingsSection } from "./settings-tool-content/desktop-section";
import { ExternalLaunchSettingsSection } from "./settings-tool-content/external-launch-section";
import { KeybindingsSettingsSection } from "./settings-tool-content/keybindings-section";
import { KeywordHighlightsSettingsSection } from "./settings-tool-content/keyword-highlights-section";
import { McpSkillsSettingsSection } from "./settings-tool-content/mcp-section";
import {
  settingsSearchEntries,
  settingsSections,
} from "./settings-tool-content/options";
import { SettingsSaveNotice } from "./settings-tool-content/shared-controls";
import { SftpSettingsSection } from "./settings-tool-content/sftp-section";
import { SyncSettingsSection } from "./settings-tool-content/sync-section";
import { TerminalSettingsSection } from "./settings-tool-content/terminal-section";
import {
  type SettingsToolContentProps,
  type VisibleSettingsSectionId,
} from "./settings-tool-content/types";

export type {
  SettingsSaveState,
  SettingsSectionId,
} from "./settings-tool-content/types";

type SettingsSearchEntry = (typeof settingsSearchEntries)[number];
const defaultVisibleSettingsSectionId =
  settingsSections[0]?.id ?? "settings-appearance";

export function SettingsToolContent({
  externalChangeNotice,
  initialSectionId,
  onConfirmedSettingsChange,
  onSettingsChange,
  resolvedTheme,
  saveError,
  saveState = "idle",
  settings,
}: SettingsToolContentProps) {
  const resolvedInitialSectionId =
    resolveVisibleSettingsSectionId(initialSectionId);
  const [activeSectionId, setActiveSectionId] =
    useState<VisibleSettingsSectionId>(resolvedInitialSectionId);
  const [selectedKeybindingPlatform, setSelectedKeybindingPlatform] =
    useState<KeybindingPlatform>(() => shortcutPlatform());
  const [settingsSearchQuery, setSettingsSearchQuery] = useState("");
  const [pendingSearchTargetId, setPendingSearchTargetId] = useState<
    string | null
  >(null);
  const [revealedSearchTargetId, setRevealedSearchTargetId] = useState<
    string | null
  >(null);
  const normalizedSettings = normalizeAppSettings(settings);
  const selectedKeybindingPlatformLabel =
    selectedKeybindingPlatform === "mac" ? "macOS" : "Windows";
  const previewResolvedTheme =
    resolvedTheme ?? resolveSettingsPreviewTheme(normalizedSettings.themeMode);
  const trimmedSettingsSearchQuery = settingsSearchQuery.trim();
  const settingsSearchResults = useMemo(
    () => searchSettings(trimmedSettingsSearchQuery),
    [trimmedSettingsSearchQuery],
  );
  const draftController = createSettingsDraftController(
    normalizedSettings,
    onSettingsChange,
  );

  useEffect(() => {
    setActiveSectionId(resolvedInitialSectionId);
  }, [resolvedInitialSectionId]);

  useEffect(() => {
    if (!pendingSearchTargetId) {
      return;
    }

    const focusTarget = () => {
      const target = document.getElementById(pendingSearchTargetId);
      if (!target) {
        setPendingSearchTargetId(null);
        return;
      }

      target.scrollIntoView?.({
        behavior: "smooth",
        block: "start",
      });
      target.focus?.({
        preventScroll: true,
      });
      setPendingSearchTargetId(null);
    };

    if (typeof window.requestAnimationFrame !== "function") {
      const timeout = window.setTimeout(focusTarget, 0);
      return () => window.clearTimeout(timeout);
    }

    const frame = window.requestAnimationFrame(focusTarget);
    return () => window.cancelAnimationFrame(frame);
  }, [activeSectionId, pendingSearchTargetId]);

  const {
    replace: updateSettings,
    updateAppearance,
    updateDesktopNotifications,
    updateExternalLaunch,
    updateSftp,
    updateTerminal,
    updateTerminalInlineSuggestion,
    updateTerminalInlineSuggestionProvider,
  } = draftController;

  const chooseBackgroundImage = () => {
    void selectLocalFile().then((backgroundImagePath) => {
      if (!backgroundImagePath) {
        return;
      }
      updateAppearance({
        backgroundEnabled: true,
        backgroundImagePath,
      });
    });
  };

  /**
   * 规则表单使用确认式保存：真实应用等待 TOML 成功后才返回终端设置；测试或旧调用
   * 方未提供该入口时退化为现有同步更新行为，保持 SettingsToolContent 的兼容性。
   */
  const saveKeywordHighlights = async (
    keywordHighlights: TerminalKeywordHighlightSettings,
  ): Promise<TerminalKeywordHighlightSettings> => {
    const nextSettings = normalizeAppSettings({
      ...normalizedSettings,
      terminal: { ...normalizedSettings.terminal, keywordHighlights },
    });
    if (!onConfirmedSettingsChange) {
      onSettingsChange(nextSettings);
      return nextSettings.terminal.keywordHighlights;
    }
    const storedSettings = await onConfirmedSettingsChange(nextSettings);
    return normalizeAppSettings(storedSettings).terminal.keywordHighlights;
  };

  const navigateToSearchResult = (result: SettingsSearchEntry) => {
    setActiveSectionId(result.sectionId);
    setPendingSearchTargetId(result.targetId);
    setRevealedSearchTargetId(result.targetId);
    setSettingsSearchQuery("");
  };

  return (
    <section className="grid gap-4 lg:grid-cols-[190px_minmax(0,1fr)]">
      <nav
        aria-label="设置分类"
        className="border-b border-[var(--border-subtle)] pb-4 lg:sticky lg:top-0 lg:self-start lg:border-b-0 lg:border-r lg:pb-0 lg:pr-4"
      >
        <div>
          <label className="kerminal-field-surface flex h-9 items-center gap-2 rounded-[var(--radius-control)] border px-2 text-[13px] text-[var(--text-primary)]">
            <Search className="h-4 w-4 shrink-0 text-zinc-400" />
            <input
              aria-label="搜索设置"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-zinc-400 dark:placeholder:text-zinc-500"
              onChange={(event) =>
                setSettingsSearchQuery(event.currentTarget.value)
              }
              placeholder="搜索设置"
              value={settingsSearchQuery}
            />
            {settingsSearchQuery ? (
              <button
                aria-label="清除设置搜索"
                className="kerminal-focus-ring kerminal-pressable flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-zinc-500 hover:bg-[var(--surface-hover)] dark:text-zinc-300"
                onClick={() => setSettingsSearchQuery("")}
                type="button"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </label>

          {trimmedSettingsSearchQuery ? (
            <div className="mt-2 space-y-1">
              {settingsSearchResults.length > 0 ? (
                settingsSearchResults.map((result) => (
                  <button
                    aria-label={`打开设置项：${result.title}`}
                    className="kerminal-focus-ring kerminal-pressable block w-full rounded-[var(--radius-control)] px-2.5 py-2 text-left text-[13px] text-[var(--text-primary)] transition hover:bg-[var(--surface-hover)]"
                    key={`${result.sectionId}:${result.targetId}:${result.title}`}
                    onClick={() => navigateToSearchResult(result)}
                    type="button"
                  >
                    <span className="block truncate font-medium">
                      {result.title}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-zinc-500 dark:text-zinc-400">
                      {sectionLabelFor(result.sectionId)} ·{" "}
                      {result.description}
                    </span>
                  </button>
                ))
              ) : (
                <div className="rounded-[var(--radius-control)] px-2.5 py-3 text-xs leading-5 text-[var(--text-secondary)]">
                  没有找到匹配设置。
                </div>
              )}
            </div>
          ) : (
            <div className="mt-2 space-y-1">
              {settingsSections.map((section) => {
                const Icon = section.icon;
                const selected = activeSectionId === section.id;

                return (
                  <button
                    aria-controls={`${section.id}-panel`}
                    aria-label={`打开设置分类：${section.label}`}
                    aria-pressed={selected}
                    className={cn(
                      "kerminal-focus-ring kerminal-pressable flex min-h-10 w-full items-center gap-2 rounded-[var(--radius-control)] px-2 py-1.5 text-left text-[13px]",
                      selected
                        ? "bg-[var(--surface-selected)] text-sky-700 dark:text-sky-100"
                        : "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]",
                    )}
                    key={section.id}
                    onClick={() => {
                      setActiveSectionId(section.id);
                      setRevealedSearchTargetId(null);
                    }}
                    type="button"
                  >
                    <span
                      className={cn(
                        "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                        selected
                          ? "bg-[var(--surface-selected)] text-sky-700 dark:text-sky-100"
                          : "bg-[var(--surface-muted)] text-[var(--text-secondary)]",
                      )}
                    >
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 truncate font-medium">
                      {section.label}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </nav>

      <div className="min-w-0 space-y-4">
        {externalChangeNotice ? (
          <div
            className="rounded-[var(--radius-control)] border border-amber-300/25 bg-amber-400/10 px-3 py-2 text-xs leading-5 text-amber-800 dark:border-amber-300/20 dark:bg-amber-400/10 dark:text-amber-100"
            role="status"
          >
            {externalChangeNotice}
          </div>
        ) : null}

        {activeSectionId === "settings-appearance" ? (
          <AppearanceSettingsSection
            chooseBackgroundImage={chooseBackgroundImage}
            normalizedSettings={normalizedSettings}
            updateAppearance={updateAppearance}
            updateSettings={updateSettings}
          />
        ) : null}

        {activeSectionId === "settings-terminal" ? (
          <TerminalSettingsSection
            normalizedSettings={normalizedSettings}
            revealRenderer={
              revealedSearchTargetId === "settings-terminal-renderer-panel"
            }
            resolvedTheme={previewResolvedTheme}
            updateTerminal={updateTerminal}
          />
        ) : null}

        {activeSectionId === "settings-keyword-highlights" ? (
          <KeywordHighlightsSettingsSection
            onChange={(keywordHighlights) =>
              updateTerminal({ keywordHighlights })
            }
            onSave={saveKeywordHighlights}
            resolvedTheme={previewResolvedTheme}
            terminal={normalizedSettings.terminal}
          />
        ) : null}

        {activeSectionId === "settings-suggestions" ? (
          <CommandSuggestionSettingsSection
            normalizedSettings={normalizedSettings}
            updateTerminalInlineSuggestion={updateTerminalInlineSuggestion}
            updateTerminalInlineSuggestionProvider={
              updateTerminalInlineSuggestionProvider
            }
          />
        ) : null}

        {activeSectionId === "settings-mcp" ? (
          <div className="space-y-4" id="settings-mcp-panel">
            <McpSkillsSettingsSection
              desktopNotifications={normalizedSettings.desktopNotifications}
              revealConnectionInfo={
                revealedSearchTargetId === "settings-mcp-connection-info"
              }
            />
          </div>
        ) : null}

        {activeSectionId === "settings-sync" ? <SyncSettingsSection /> : null}

        {activeSectionId === "settings-desktop" ? (
          <DesktopSettingsSection
            normalizedSettings={normalizedSettings}
            updateDesktopNotifications={updateDesktopNotifications}
          />
        ) : null}

        {activeSectionId === "settings-sftp" ? (
          <SftpSettingsSection
            normalizedSettings={normalizedSettings}
            updateSftp={updateSftp}
          />
        ) : null}

        {activeSectionId === "settings-external-launch" ? (
          <ExternalLaunchSettingsSection
            externalLaunch={normalizedSettings.externalLaunch}
            revealCompatibility={
              revealedSearchTargetId ===
              "settings-external-launch-compatibility"
            }
            updateExternalLaunch={updateExternalLaunch}
          />
        ) : null}

        {activeSectionId === "settings-keybindings" ? (
          <KeybindingsSettingsSection
            normalizedSettings={normalizedSettings}
            selectedKeybindingPlatform={selectedKeybindingPlatform}
            selectedKeybindingPlatformLabel={selectedKeybindingPlatformLabel}
            setSelectedKeybindingPlatform={setSelectedKeybindingPlatform}
            updateSettings={updateSettings}
          />
        ) : null}

        {activeSectionId === "settings-about" ? (
          <AboutSettingsSection
            desktopNotifications={normalizedSettings.desktopNotifications}
          />
        ) : null}

        <SettingsSaveNotice saveError={saveError} saveState={saveState} />
      </div>
    </section>
  );
}

function resolveSettingsPreviewTheme(themeMode: ThemeMode): ResolvedTheme {
  if (themeMode === "dark" || themeMode === "light") {
    return themeMode;
  }

  if (typeof document !== "undefined") {
    const documentTheme = document.documentElement.dataset.theme;
    if (documentTheme === "dark" || documentTheme === "light") {
      return documentTheme;
    }
  }

  if (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-color-scheme: dark)").matches
  ) {
    return "dark";
  }

  return "light";
}

function searchSettings(query: string): SettingsSearchEntry[] {
  if (!query) {
    return [];
  }

  const normalizedQuery = query.toLocaleLowerCase();
  return settingsSearchEntries
    .filter((entry) =>
      [
        entry.title,
        entry.description,
        sectionLabelFor(entry.sectionId),
        ...entry.keywords,
      ]
        .join(" ")
        .toLocaleLowerCase()
        .includes(normalizedQuery),
    )
    .slice(0, 8);
}

function sectionLabelFor(sectionId: VisibleSettingsSectionId): string {
  return (
    settingsSections.find((section) => section.id === sectionId)?.label ??
    "设置"
  );
}

/**
 * 设置入口可能来自持久化状态或跨模块消息，运行时值不一定仍属于当前菜单。
 * 统一回退到菜单第一项，避免没有选中项时右侧内容完全为空。
 */
function resolveVisibleSettingsSectionId(
  sectionId: VisibleSettingsSectionId | null | undefined,
): VisibleSettingsSectionId {
  return (
    settingsSections.find((section) => section.id === sectionId)?.id ??
    defaultVisibleSettingsSectionId
  );
}
