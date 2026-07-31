// @author kongweiguang

import { useSyncExternalStore } from "react";
import {
  Check,
  MousePointerClick,
  RotateCcw,
  Terminal,
  Type,
} from "lucide-react";
import { Select } from "../../../components/ui/select";
import { cn } from "../../../lib/cn";
import { terminalRendererRegistry } from "../../terminal/runtime/renderer/index";
import {
  terminalCursorStyleOptions,
  terminalFontOptions,
  terminalFontWeightOptions,
  terminalRendererTypeOptions,
  terminalRightClickBehaviorOptions,
  type AppSettings,
  type ResolvedTheme,
  type TerminalAppearance,
} from "../settingsModel";
import {
  NumberSetting,
  PolicyToggle,
  SettingsDisclosure,
} from "./shared-controls";
import {
  CursorStylePreview,
  TerminalAppearancePreview,
  TerminalSchemePicker,
} from "./terminal-preview";
import {
  buildTerminalRendererStatusView,
  isRetryableRendererFallback,
} from "./terminal-renderer-status";

interface TerminalSettingsSectionProps {
  normalizedSettings: AppSettings;
  revealRenderer?: boolean;
  resolvedTheme: ResolvedTheme;
  updateTerminal: (terminal: Partial<TerminalAppearance>) => void;
}

const terminalPanelClassName = "min-w-0 space-y-4";
const terminalSubpanelClassName =
  "kerminal-solid-surface min-w-0 rounded-[var(--radius-panel)] border p-4";

function terminalChoiceButtonClassName(selected: boolean, className?: string) {
  return cn(
    "kerminal-focus-ring kerminal-pressable rounded-[var(--radius-control)] border text-left transition",
    selected
      ? "border-sky-500/35 bg-[var(--surface-selected)] text-sky-700 ring-1 ring-sky-500/10 dark:border-sky-300/30 dark:text-sky-100 dark:ring-sky-300/10"
      : "kerminal-muted-surface text-zinc-600 hover:bg-[var(--surface-hover)] hover:text-zinc-950 dark:text-zinc-300 dark:hover:text-zinc-50",
    className,
  );
}

export function TerminalSettingsSection({
  normalizedSettings,
  revealRenderer = false,
  resolvedTheme,
  updateTerminal,
}: TerminalSettingsSectionProps) {
  const rendererSnapshot = useSyncExternalStore(
    terminalRendererRegistry.subscribe,
    terminalRendererRegistry.getSnapshot,
    terminalRendererRegistry.getSnapshot,
  );
  const rendererStatus = buildTerminalRendererStatusView(rendererSnapshot);
  const retryableRendererPaneIds = rendererSnapshot.panes
    .filter(
      (pane) =>
        isRetryableRendererFallback(pane.fallbackReason) || pane.circuitOpen,
    )
    .map((pane) => pane.paneId);
  const retryGlobalRendererFallback =
    rendererSnapshot.suggestedFallback === "cpu";
  const canRetryGpu =
    rendererSnapshot.requestedMode !== "cpu" &&
    (retryGlobalRendererFallback || retryableRendererPaneIds.length > 0);

  return (
    <section className={terminalPanelClassName} id="settings-terminal-panel">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <section
          className={terminalSubpanelClassName}
          id="settings-terminal-theme-panel"
          tabIndex={-1}
        >
            <div className="flex items-center gap-2 text-sm font-medium text-zinc-800 dark:text-zinc-200">
              <Terminal className="h-4 w-4 text-zinc-400" />
              终端主题
            </div>
            <div className="mt-4 space-y-4">
              <TerminalSchemePicker
                label="浅色终端主题"
                onSelect={(lightColorScheme) =>
                  updateTerminal({ colorScheme: lightColorScheme, lightColorScheme })
                }
                value={normalizedSettings.terminal.lightColorScheme}
              />
              <TerminalSchemePicker
                label="暗色终端主题"
                onSelect={(darkColorScheme) =>
                  updateTerminal({ colorScheme: darkColorScheme, darkColorScheme })
                }
                value={normalizedSettings.terminal.darkColorScheme}
              />
            </div>
        </section>

        <section
          className={terminalSubpanelClassName}
          id="settings-terminal-font-panel"
          tabIndex={-1}
        >
            <div className="flex items-center gap-2 text-sm font-medium text-zinc-800 dark:text-zinc-200">
              <Type className="h-4 w-4 text-zinc-400" />
              字体配置
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1.4fr)_minmax(96px,0.7fr)_minmax(96px,0.7fr)]">
              <label className="block">
                <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                  终端字体
                </span>
                <Select
                  aria-label="终端字体"
                  className="mt-1"
                  onValueChange={(fontFamily) => updateTerminal({ fontFamily })}
                  options={terminalFontOptions}
                  value={normalizedSettings.terminal.fontFamily}
                />
              </label>
              <NumberSetting
                label="字号"
                max={24}
                min={10}
                onChange={(fontSize) => updateTerminal({ fontSize })}
                suffix="px"
                value={normalizedSettings.terminal.fontSize}
              />
              <NumberSetting
                label="行高"
                max={1.8}
                min={1}
                onChange={(lineHeight) => updateTerminal({ lineHeight })}
                step={0.05}
                value={normalizedSettings.terminal.lineHeight}
              />
              <label className="block md:col-span-3">
                <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                  字重
                </span>
                <Select
                  aria-label="终端字重"
                  className="mt-1"
                  onValueChange={(fontWeight) =>
                    updateTerminal({
                      fontWeight: fontWeight as TerminalAppearance["fontWeight"],
                    })
                  }
                  options={terminalFontWeightOptions}
                  value={normalizedSettings.terminal.fontWeight}
                />
              </label>
            </div>
            <TerminalAppearancePreview
              resolvedTheme={resolvedTheme}
              terminal={normalizedSettings.terminal}
            />
        </section>
      </div>

      <SettingsDisclosure
        reveal={revealRenderer}
        summary={rendererStatus.badgeLabel}
        targetId="settings-terminal-renderer-panel"
        title="终端渲染"
      >
        <div
          className={cn(
            "rounded-[var(--radius-control)] border px-3 py-2 text-xs leading-5",
            rendererStatus.tone === "warning"
              ? "border-amber-400/35 bg-amber-50 text-amber-800 dark:border-amber-300/25 dark:bg-amber-400/10 dark:text-amber-100"
              : "kerminal-solid-surface text-zinc-500 dark:text-zinc-400",
          )}
        >
          {rendererStatus.detail}
        </div>

        {canRetryGpu ? (
          <button
            aria-label="重新尝试 GPU"
            className="kerminal-focus-ring kerminal-pressable mt-3 inline-flex h-9 items-center gap-2 rounded-[var(--radius-control)] border border-amber-400/35 bg-amber-400/10 px-3 text-[13px] font-medium text-amber-800 transition hover:bg-amber-400/15 dark:border-amber-300/25 dark:text-amber-100"
            onClick={() => {
              if (retryGlobalRendererFallback) {
                terminalRendererRegistry.retryGpu();
                return;
              }
              for (const paneId of retryableRendererPaneIds) {
                terminalRendererRegistry.retryGpu(paneId);
              }
            }}
            type="button"
          >
            <RotateCcw className="h-4 w-4" />
            重新尝试 GPU
          </button>
        ) : null}

        <div className="mt-4 grid gap-2 md:grid-cols-3">
          {terminalRendererTypeOptions.map((option) => {
            const selected =
              normalizedSettings.terminal.rendererType === option.value;
            return (
              <button
                aria-pressed={selected}
                className={terminalChoiceButtonClassName(selected, "min-h-24 p-3")}
                key={option.value}
                onClick={() => updateTerminal({ rendererType: option.value })}
                type="button"
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold">{option.label}</span>
                  {selected ? <Check className="h-4 w-4" /> : null}
                </span>
                <span className="mt-1 block text-xs leading-5 opacity-80">
                  {option.description}
                </span>
              </button>
            );
          })}
        </div>
      </SettingsDisclosure>

      <section
        className={terminalSubpanelClassName}
        id="settings-terminal-interaction-panel"
        tabIndex={-1}
      >
          <div className="flex items-center gap-2 text-sm font-medium text-zinc-800 dark:text-zinc-200">
            <MousePointerClick className="h-4 w-4 text-zinc-400" />
            终端交互
          </div>
          <div className="mt-4">
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              <PolicyToggle
                checked={normalizedSettings.terminal.selectionCopy}
                icon={MousePointerClick}
                label="选中复制"
                onChange={(selectionCopy) => updateTerminal({ selectionCopy })}
              />
              <PolicyToggle
                checked={normalizedSettings.terminal.showTabNumbers}
                icon={Terminal}
                label="显示标签序号"
                onChange={(showTabNumbers) => updateTerminal({ showTabNumbers })}
              />
              <PolicyToggle
                checked={normalizedSettings.terminal.cursorBlink}
                icon={Type}
                label="光标闪烁"
                onChange={(cursorBlink) => updateTerminal({ cursorBlink })}
              />
              <PolicyToggle
                checked={normalizedSettings.terminal.showCommandBlockRail}
                icon={Terminal}
                label="显示命令色条"
                onChange={(showCommandBlockRail) =>
                  updateTerminal({ showCommandBlockRail })
                }
              />
              <PolicyToggle
                checked={normalizedSettings.terminal.confirmCloseTab}
                icon={RotateCcw}
                label="关闭标签前确认"
                onChange={(confirmCloseTab) =>
                  updateTerminal({ confirmCloseTab })
                }
              />
              <PolicyToggle
                checked={normalizedSettings.terminal.autoReconnect}
                icon={RotateCcw}
                label="自动重连"
                onChange={(autoReconnect) => updateTerminal({ autoReconnect })}
              />
            </div>
            <div className="mt-3 grid items-end gap-3 md:grid-cols-2 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.25fr)_minmax(0,1fr)]">
              <div>
                <div className="mb-1 text-xs font-medium text-zinc-500 dark:text-zinc-400">
                  键盘
                </div>
                <PolicyToggle
                  checked={normalizedSettings.terminal.macOptionIsMeta}
                  icon={Terminal}
                  label="将 macOS Option 键作为 Meta 键"
                  onChange={(macOptionIsMeta) =>
                    updateTerminal({ macOptionIsMeta })
                  }
                />
              </div>
              <label className="block">
                <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                  右键行为
                </span>
                <Select
                  aria-label="终端右键行为"
                  className="mt-1"
                  onValueChange={(rightClickBehavior) =>
                    updateTerminal({
                      rightClickBehavior:
                        rightClickBehavior as TerminalAppearance["rightClickBehavior"],
                    })
                  }
                  options={terminalRightClickBehaviorOptions}
                  value={normalizedSettings.terminal.rightClickBehavior}
                />
              </label>
              <NumberSetting
                label="滚屏缓冲"
                max={50000}
                min={1000}
                onChange={(scrollback) => updateTerminal({ scrollback })}
                step={500}
                suffix="行"
                value={normalizedSettings.terminal.scrollback}
              />
            </div>
          </div>
      </section>

      <section
        className={terminalSubpanelClassName}
        id="settings-terminal-cursor-panel"
        tabIndex={-1}
      >
          <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            光标形态
          </div>
          <div className="mt-3 grid gap-3 lg:grid-cols-3">
            {terminalCursorStyleOptions.map((option) => {
              const selected =
                normalizedSettings.terminal.cursorStyle === option.value;
              return (
                <button
                  aria-label={`${option.label}光标：${option.description}`}
                  aria-pressed={selected}
                  className={terminalChoiceButtonClassName(selected, "p-3.5")}
                  key={option.value}
                  onClick={() => updateTerminal({ cursorStyle: option.value })}
                  type="button"
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold">{option.label}</span>
                    {selected ? <Check className="h-4 w-4" /> : null}
                  </span>
                  <span className="mt-1.5 block min-h-10 text-xs leading-5 opacity-80">
                    {option.description}
                  </span>
                  <CursorStylePreview
                    blink={normalizedSettings.terminal.cursorBlink}
                    cursorStyle={option.value}
                  />
                </button>
              );
            })}
          </div>
      </section>
    </section>
  );
}
