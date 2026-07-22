import { Network, Puzzle, ShieldCheck, Terminal } from "lucide-react";
import { Select } from "../../../components/ui/select";
import { Switch } from "../../../components/ui/switch";
import { cn } from "../../../lib/cn";
import type {
  AppSettings,
  TerminalCommandSuggestionPresentation,
  TerminalCommandSuggestionRemoteRefresh,
  TerminalInlineSuggestionAcceptKey,
  TerminalInlineSuggestionProductionHostPolicy,
  TerminalInlineSuggestionProviderSettings,
  TerminalInlineSuggestionSettings,
} from "../settingsModel";
import {
  commandSuggestionPresentationOptions,
  commandSuggestionRemoteRefreshOptions,
  inlineSuggestionAcceptKeyOptions,
  inlineSuggestionProductionHostPolicyOptions,
  inlineSuggestionProviderOptions,
} from "./options";
import {
  InlineSuggestionPolicyStatus,
  InlineSuggestionProviderToggle,
} from "./inline-suggestions";

interface CommandSuggestionSettingsSectionProps {
  normalizedSettings: AppSettings;
  updateTerminalInlineSuggestion: (
    inlineSuggestion: Partial<TerminalInlineSuggestionSettings>,
  ) => void;
  updateTerminalInlineSuggestionProvider: (
    provider: keyof TerminalInlineSuggestionProviderSettings,
    enabled: boolean,
  ) => void;
}

const suggestionsPanelClassName = "min-w-0";
const suggestionsSubpanelClassName =
  "kerminal-solid-surface rounded-[var(--radius-panel)] border p-4";
const suggestionsInsetPanelClassName = "min-w-0";

export function CommandSuggestionSettingsSection({
  normalizedSettings,
  updateTerminalInlineSuggestion,
  updateTerminalInlineSuggestionProvider,
}: CommandSuggestionSettingsSectionProps) {
  const inlineSuggestion = normalizedSettings.terminal.inlineSuggestion;

  return (
    <section
      className={suggestionsPanelClassName}
      id="settings-suggestions-panel"
      tabIndex={-1}
    >
      <section
        className={suggestionsSubpanelClassName}
        id="settings-command-suggestions-policy-panel"
        tabIndex={-1}
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-subtle)] pb-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-sm font-medium text-zinc-800 dark:text-zinc-200">
              <Terminal className="h-4 w-4 text-zinc-400" />
              命令灰色提示
            </div>
          </div>
          <div
            className={cn(
              "flex min-w-[220px] items-center justify-between gap-3 rounded-[var(--radius-control)] border px-3 py-2",
              inlineSuggestion.enabled
                ? "border-sky-500/30 bg-[var(--surface-selected)] text-sky-800 dark:border-sky-300/25 dark:text-sky-100"
                : "bg-[var(--surface-content)] text-[var(--text-secondary)]",
            )}
          >
            <span className="truncate text-xs font-semibold">
              {inlineSuggestion.enabled ? "已启用" : "已暂停"}
            </span>
            <Switch
              aria-label="启用灰色提示"
              checked={inlineSuggestion.enabled}
              onCheckedChange={(enabled) =>
                updateTerminalInlineSuggestion({
                  enabled,
                  presentation: enabled ? "inlineAndMenu" : "off",
                })
              }
            />
          </div>
        </div>

        <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(260px,0.72fr)]">
          <div className={suggestionsInsetPanelClassName}>
            <div className="flex items-center gap-2 text-xs font-semibold text-zinc-600 dark:text-zinc-300">
              <ShieldCheck className="h-3.5 w-3.5 text-zinc-400" />
              策略与接受
            </div>
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              <label className="block rounded-[var(--radius-control)] border border-[var(--border-subtle)] bg-[var(--surface-content)] px-3 py-2">
                <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                  展示方式
                </span>
                <Select
                  aria-label="命令建议展示方式"
                  className="mt-1"
                  onValueChange={(value) =>
                    updateTerminalInlineSuggestion({
                      enabled: value !== "off",
                      presentation:
                        value as TerminalCommandSuggestionPresentation,
                    })
                  }
                  options={[...commandSuggestionPresentationOptions]}
                  value={inlineSuggestion.presentation}
                />
              </label>
              <label className="block rounded-[var(--radius-control)] border border-[var(--border-subtle)] bg-[var(--surface-content)] px-3 py-2">
                <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                  接受按键
                </span>
                <Select
                  aria-label="灰色提示接受按键"
                  className="mt-1"
                  onValueChange={(value) =>
                    updateTerminalInlineSuggestion({
                      acceptKey: value as TerminalInlineSuggestionAcceptKey,
                    })
                  }
                  options={inlineSuggestionAcceptKeyOptions}
                  value={inlineSuggestion.acceptKey}
                />
              </label>
              <label className="block rounded-[var(--radius-control)] border border-[var(--border-subtle)] bg-[var(--surface-content)] px-3 py-2">
                <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                  远端刷新
                </span>
                <Select
                  aria-label="命令建议远端刷新"
                  className="mt-1"
                  onValueChange={(value) =>
                    updateTerminalInlineSuggestion({
                      remoteProbeEnabled: value !== "off",
                      remoteRefresh:
                        value as TerminalCommandSuggestionRemoteRefresh,
                    })
                  }
                  options={[...commandSuggestionRemoteRefreshOptions]}
                  value={inlineSuggestion.remoteRefresh}
                />
              </label>
              <label className="block rounded-[var(--radius-control)] border border-[var(--border-subtle)] bg-[var(--surface-content)] px-3 py-2">
                <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                  生产主机策略
                </span>
                <Select
                  aria-label="灰色提示生产主机策略"
                  className="mt-1"
                  onValueChange={(value) =>
                    updateTerminalInlineSuggestion({
                      productionHostPolicy:
                        value as TerminalInlineSuggestionProductionHostPolicy,
                    })
                  }
                  options={inlineSuggestionProductionHostPolicyOptions}
                  value={inlineSuggestion.productionHostPolicy}
                />
              </label>
              <div className="flex min-h-10 items-center justify-between gap-3 rounded-[var(--radius-control)] border border-[var(--border-subtle)] bg-[var(--surface-content)] px-3 py-2 text-[13px] text-[var(--text-primary)]">
                <span className="min-w-0 truncate">允许 Alt+Right 分段接受</span>
                <Switch
                  aria-label="允许分段接受命令建议"
                  checked={inlineSuggestion.partialAccept}
                  onCheckedChange={(partialAccept) =>
                    updateTerminalInlineSuggestion({ partialAccept })
                  }
                />
              </div>
              <div className="flex min-h-10 items-center justify-between gap-3 rounded-[var(--radius-control)] border border-[var(--border-subtle)] bg-[var(--surface-content)] px-3 py-2 text-[13px] text-[var(--text-primary)]">
                <span className="min-w-0 truncate">允许 Tab 打开候选列表</span>
                <Switch
                  aria-label="允许 Tab 打开命令建议列表"
                  checked={inlineSuggestion.tabOpensMenu}
                  onCheckedChange={(tabOpensMenu) =>
                    updateTerminalInlineSuggestion({ tabOpensMenu })
                  }
                />
              </div>
              <div className="flex min-h-10 items-center justify-between gap-3 rounded-[var(--radius-control)] border border-[var(--border-subtle)] bg-[var(--surface-content)] px-3 py-2 text-[13px] text-[var(--text-primary)] md:col-span-2">
                <span className="flex min-w-0 items-center gap-2">
                  <Network className="h-4 w-4 shrink-0 text-zinc-400" />
                  <span className="min-w-0 truncate text-left leading-5">
                    允许远端只读探测
                  </span>
                </span>
                <Switch
                  aria-label="允许远端只读探测"
                  checked={inlineSuggestion.remoteProbeEnabled}
                  onCheckedChange={(remoteProbeEnabled) =>
                    updateTerminalInlineSuggestion({
                      remoteProbeEnabled,
                      remoteRefresh: remoteProbeEnabled ? "safe" : "off",
                    })
                  }
                />
              </div>
            </div>
            <InlineSuggestionPolicyStatus inlineSuggestion={inlineSuggestion} />
          </div>

          <div
            className={suggestionsInsetPanelClassName}
            id="settings-command-suggestions-providers-panel"
            tabIndex={-1}
          >
            <div className="flex items-center gap-2 text-xs font-semibold text-zinc-600 dark:text-zinc-300">
              <Puzzle className="h-3.5 w-3.5 text-zinc-400" />
              Provider 开关
            </div>
            <div className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-2 xl:grid-cols-1">
              {inlineSuggestionProviderOptions.map((option) => (
                <InlineSuggestionProviderToggle
                  checked={inlineSuggestion.providers[option.key]}
                  icon={option.icon}
                  key={option.key}
                  label={option.label}
                  onChange={(enabled) =>
                    updateTerminalInlineSuggestionProvider(option.key, enabled)
                  }
                />
              ))}
            </div>
          </div>
        </div>
      </section>
    </section>
  );
}
