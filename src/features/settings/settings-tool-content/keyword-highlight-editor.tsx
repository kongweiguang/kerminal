// @author kongweiguang

import {
  Check,
  Loader2,
  RotateCcw,
  Trash2,
} from "lucide-react";
import type { CSSProperties, RefObject } from "react";
import { Button } from "../../../components/ui/button";
import { Switch } from "../../../components/ui/switch";
import { cn } from "../../../lib/cn";
import {
  isTerminalKeywordHighlightHexColor,
  terminalColorSchemeForTheme,
  terminalKeywordHighlightColorsForTheme,
  terminalKeywordHighlightPalette,
  terminalKeywordHighlightPresetStyles,
  TERMINAL_KEYWORD_HIGHLIGHT_NOTE_LIMIT,
  TERMINAL_KEYWORD_HIGHLIGHT_PATTERN_LIMIT,
  type ResolvedTheme,
  type TerminalAppearance,
  type TerminalKeywordHighlightColorPair,
  type TerminalKeywordHighlightCustomColors,
  type TerminalKeywordHighlightMatchMode,
  type TerminalKeywordHighlightRule,
  type TerminalKeywordHighlightStyle,
} from "../settingsModel";
import { xtermThemeFor } from "../terminalTheme";

const matchModeOptions: Array<{
  description: string;
  label: string;
  value: TerminalKeywordHighlightMatchMode;
}> = [
  { value: "literal", label: "文本", description: "按原文本片段匹配" },
  { value: "wholeWord", label: "整词", description: "使用 Unicode 单词边界" },
  { value: "regex", label: "正则", description: "使用安全 RE2 子集" },
];

const styleLabels: Record<TerminalKeywordHighlightStyle, string> = {
  red: "红色",
  orange: "橙色",
  yellow: "黄色",
  green: "绿色",
  cyan: "青色",
  blue: "蓝色",
  purple: "紫色",
  pink: "粉色",
  custom: "自定义",
};

interface KeywordHighlightRuleEditorProps {
  busy: boolean;
  draft: TerminalKeywordHighlightRule;
  error: string | null;
  isNew: boolean;
  keywordInputRef: RefObject<HTMLInputElement | null>;
  onCancel: () => void;
  onChange: (rule: TerminalKeywordHighlightRule) => void;
  onDelete: () => void;
  onSave: () => void;
  resolvedTheme: ResolvedTheme;
  terminal: TerminalAppearance;
}

/**
 * 呈现单条规则的局部草稿；所有输入只调用 `onChange`，持久化由上层在“保存规则”
 * 时统一提交，因此取消、正则校验失败和后端写入失败都不会污染全局设置。
 */
export function KeywordHighlightRuleEditor({
  busy,
  draft,
  error,
  isNew,
  keywordInputRef,
  onCancel,
  onChange,
  onDelete,
  onSave,
  resolvedTheme,
  terminal,
}: KeywordHighlightRuleEditorProps) {
  const terminalTheme = xtermThemeFor(
    resolvedTheme,
    terminalColorSchemeForTheme(terminal, resolvedTheme),
  );
  const colors = terminalKeywordHighlightColorsForTheme(draft, resolvedTheme);
  const previewStyle = {
    backgroundColor: colors.background,
    color: colors.foreground,
  } satisfies CSSProperties;

  /** 切换到自定义时复制当前色板，保证两个主题立即都有可见且可编辑的起点。 */
  const chooseStyle = (style: TerminalKeywordHighlightStyle) => {
    if (style !== "custom") {
      onChange({ ...draft, style });
      return;
    }
    const customColors =
      draft.customColors ?? clonePresetColors(draft.style);
    onChange({ ...draft, style, customColors });
  };

  /** 更新单个主题颜色时深拷贝两层对象，避免草稿与已保存配置共享可变引用。 */
  const updateCustomColor = (
    theme: ResolvedTheme,
    key: keyof TerminalKeywordHighlightColorPair,
    value: string | undefined,
  ) => {
    const customColors = draft.customColors ?? clonePresetColors("yellow");
    onChange({
      ...draft,
      customColors: {
        ...customColors,
        [theme]: {
          ...customColors[theme],
          [key]: value,
        },
      },
    });
  };

  return (
    <section
      aria-label={isNew ? "新建关键词高亮规则" : "编辑关键词高亮规则"}
      className="kerminal-solid-surface min-w-0 rounded-[var(--radius-card)] border p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">
            {isNew ? "新建规则" : "编辑规则"}
          </h3>
          <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">
            保存成功后立即应用到所有普通终端；全屏 TUI 不参与高亮。
          </p>
        </div>
        <label className="flex shrink-0 items-center gap-2 text-xs text-[var(--text-secondary)]">
          启用规则
          <Switch
            aria-label="启用当前关键词高亮规则"
            checked={draft.enabled}
            disabled={busy}
            onCheckedChange={(enabled) => onChange({ ...draft, enabled })}
          />
        </label>
      </div>

      <div className="mt-4 space-y-4">
        <label className="block">
          <span className="flex items-center justify-between gap-3 text-xs font-medium text-[var(--text-secondary)]">
            <span>关键词或表达式</span>
            <span>{Array.from(draft.pattern).length} / {TERMINAL_KEYWORD_HIGHLIGHT_PATTERN_LIMIT}</span>
          </span>
          <input
            aria-describedby={error ? "keyword-highlight-editor-error" : undefined}
            aria-invalid={Boolean(error)}
            autoComplete="off"
            className="kerminal-field-surface kerminal-focus-ring mt-1 h-10 w-full rounded-[var(--radius-control)] border px-3 font-mono text-sm text-[var(--text-primary)] outline-none"
            disabled={busy}
            onChange={(event) =>
              onChange({
                ...draft,
                pattern: truncateCodePoints(
                  event.currentTarget.value,
                  TERMINAL_KEYWORD_HIGHLIGHT_PATTERN_LIMIT,
                ),
              })
            }
            placeholder="例如 error、java-test 或 error|exception"
            ref={keywordInputRef}
            value={draft.pattern}
          />
        </label>

        <fieldset>
          <legend className="text-xs font-medium text-[var(--text-secondary)]">
            匹配模式
          </legend>
          <div
            aria-label="关键词匹配模式"
            className="kerminal-field-surface mt-1 grid grid-cols-3 rounded-[var(--radius-control)] border p-1"
            role="radiogroup"
          >
            {matchModeOptions.map((option) => {
              const selected = draft.matchMode === option.value;
              return (
                <button
                  aria-checked={selected}
                  className={cn(
                    "kerminal-focus-ring min-h-9 rounded-[calc(var(--radius-control)-4px)] px-2 text-xs font-medium transition-colors motion-reduce:transition-none",
                    selected
                      ? "bg-[var(--surface-selected)] text-sky-700 shadow-sm dark:text-sky-100"
                      : "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]",
                  )}
                  disabled={busy}
                  key={option.value}
                  onClick={() =>
                    onChange({ ...draft, matchMode: option.value })
                  }
                  role="radio"
                  title={option.description}
                  type="button"
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </fieldset>

        <label className="flex min-h-10 items-center justify-between gap-3 rounded-[var(--radius-control)] border border-[var(--border-subtle)] bg-[var(--surface-content)] px-3 text-xs text-[var(--text-secondary)]">
          <span>
            <span className="block font-medium text-[var(--text-primary)]">区分大小写</span>
            <span className="mt-0.5 block">关闭时使用 Unicode 大小写匹配</span>
          </span>
          <Switch
            aria-label="区分关键词大小写"
            checked={draft.caseSensitive}
            disabled={busy}
            onCheckedChange={(caseSensitive) =>
              onChange({ ...draft, caseSensitive })
            }
          />
        </label>

        <label className="block">
          <span className="flex items-center justify-between gap-3 text-xs font-medium text-[var(--text-secondary)]">
            <span>备注</span>
            <span>{Array.from(draft.note).length} / {TERMINAL_KEYWORD_HIGHLIGHT_NOTE_LIMIT}</span>
          </span>
          <textarea
            className="kerminal-field-surface kerminal-focus-ring mt-1 min-h-20 w-full resize-y rounded-[var(--radius-control)] border px-3 py-2 text-sm leading-5 text-[var(--text-primary)] outline-none"
            disabled={busy}
            onChange={(event) =>
              onChange({
                ...draft,
                note: truncateCodePoints(
                  event.currentTarget.value,
                  TERMINAL_KEYWORD_HIGHLIGHT_NOTE_LIMIT,
                ),
              })
            }
            placeholder="可选，用于说明规则用途"
            value={draft.note}
          />
        </label>

        <fieldset>
          <legend className="text-xs font-medium text-[var(--text-secondary)]">
            自适应色板
          </legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {terminalKeywordHighlightPresetStyles.map((style) => {
              const selected = draft.style === style;
              const swatch = terminalKeywordHighlightPalette[style][resolvedTheme];
              return (
                <button
                  aria-label={`使用${styleLabels[style]}高亮色板`}
                  aria-pressed={selected}
                  className={cn(
                    "kerminal-focus-ring flex h-9 min-w-9 items-center justify-center rounded-[var(--radius-control)] border p-1.5 transition-transform focus-visible:outline-none motion-reduce:transition-none",
                    selected
                      ? "border-[rgb(var(--app-accent))] ring-2 ring-[rgb(var(--app-accent)/0.18)]"
                      : "border-[var(--border-subtle)] hover:scale-105",
                  )}
                  disabled={busy}
                  key={style}
                  onClick={() => chooseStyle(style)}
                  title={styleLabels[style]}
                  type="button"
                >
                  <span
                    aria-hidden="true"
                    className="h-full w-full rounded-md border border-[var(--border-subtle)]"
                    style={{
                      backgroundColor: swatch.background,
                      color: swatch.foreground,
                    }}
                  />
                </button>
              );
            })}
            <button
              aria-pressed={draft.style === "custom"}
              className={cn(
                "kerminal-focus-ring h-9 rounded-[var(--radius-control)] border px-3 text-xs font-medium",
                draft.style === "custom"
                  ? "border-[rgb(var(--app-accent))] bg-[var(--surface-selected)] text-sky-700 dark:text-sky-100"
                  : "border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]",
              )}
              disabled={busy}
              onClick={() => chooseStyle("custom")}
              type="button"
            >
              自定义
            </button>
          </div>
        </fieldset>

        {draft.style === "custom" && draft.customColors ? (
          <div className="grid gap-3 md:grid-cols-2">
            {(["light", "dark"] as const).map((theme) => (
              <CustomThemeColorEditor
                colors={draft.customColors?.[theme] ?? {}}
                disabled={busy}
                key={theme}
                label={theme === "light" ? "浅色主题" : "深色主题"}
                onChange={(key, value) => updateCustomColor(theme, key, value)}
              />
            ))}
          </div>
        ) : null}

        <div>
          <div className="text-xs font-medium text-[var(--text-secondary)]">
            终端效果预览
          </div>
          <div
            aria-label="关键词高亮终端效果预览"
            className="mt-2 overflow-hidden rounded-[var(--radius-card)] border border-[var(--border-subtle)] p-4 font-mono text-[13px] leading-6 shadow-inner"
            style={{
              backgroundColor: terminalTheme.background,
              color: terminalTheme.foreground,
              fontFamily: terminal.fontFamily,
            }}
          >
            <div style={{ color: terminalTheme.green }}>$ tail -f app.log</div>
            <div>
              <span style={{ color: terminalTheme.cyan }}>[12:34:56]</span>{" "}
              service returned{" "}
              <span className="rounded-[3px] px-0.5" style={previewStyle}>
                {draft.pattern || "Highlight"}
              </span>
            </div>
          </div>
        </div>

        {error ? (
          <p
            className="rounded-[var(--radius-control)] border border-rose-300/30 bg-rose-500/10 px-3 py-2 text-xs leading-5 text-rose-700 dark:text-rose-200"
            id="keyword-highlight-editor-error"
            role="alert"
          >
            {error}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border-subtle)] pt-4">
          {!isNew ? (
            <Button
              disabled={busy}
              onClick={onDelete}
              size="sm"
              type="button"
              variant="danger"
            >
              <Trash2 className="h-4 w-4" />
              删除规则
            </Button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <Button
              disabled={busy}
              onClick={onCancel}
              size="sm"
              type="button"
              variant="ghost"
            >
              <RotateCcw className="h-4 w-4" />
              取消
            </Button>
            <Button
              disabled={busy}
              onClick={onSave}
              size="sm"
              type="button"
              variant="primary"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Check className="h-4 w-4" />}
              {busy ? "保存中…" : "保存规则"}
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

interface CustomThemeColorEditorProps {
  colors: TerminalKeywordHighlightColorPair;
  disabled: boolean;
  label: string;
  onChange: (
    key: keyof TerminalKeywordHighlightColorPair,
    value: string | undefined,
  ) => void;
}

/** 每个主题的前景/背景控制同时提供原生色盘和可清空文本框，兼顾快捷选择与跟随终端。 */
function CustomThemeColorEditor({
  colors,
  disabled,
  label,
  onChange,
}: CustomThemeColorEditorProps) {
  return (
    <fieldset className="rounded-[var(--radius-control)] border border-[var(--border-subtle)] bg-[var(--surface-content)] p-3">
      <legend className="px-1 text-xs font-medium text-[var(--text-primary)]">
        {label}
      </legend>
      <div className="space-y-2">
        {(["foreground", "background"] as const).map((key) => {
          const value = colors[key];
          const fallback = key === "foreground" ? "#E5E7EB" : "#374151";
          return (
            <label className="grid grid-cols-[52px_34px_minmax(0,1fr)_32px] items-center gap-2" key={key}>
              <span className="text-xs text-[var(--text-secondary)]">
                {key === "foreground" ? "文字" : "背景"}
              </span>
              <input
                aria-label={`${label}${key === "foreground" ? "文字" : "背景"}色盘`}
                className="kerminal-focus-ring h-8 w-8 cursor-pointer rounded-lg border border-[var(--border-subtle)] bg-transparent p-0.5"
                disabled={disabled}
                onChange={(event) => onChange(key, event.currentTarget.value.toUpperCase())}
                type="color"
                value={value ?? fallback}
              />
              <input
                aria-label={`${label}${key === "foreground" ? "文字" : "背景"}颜色`}
                className="kerminal-field-surface kerminal-focus-ring h-8 min-w-0 rounded-lg border px-2 font-mono text-xs uppercase text-[var(--text-primary)] outline-none"
                disabled={disabled}
                onChange={(event) => {
                  const next = event.currentTarget.value.toUpperCase().slice(0, 7);
                  onChange(key, next || undefined);
                }}
                placeholder="跟随终端"
                spellCheck={false}
                value={value ?? ""}
              />
              <button
                aria-label={`重置${label}${key === "foreground" ? "文字" : "背景"}颜色`}
                className="kerminal-focus-ring flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-tertiary)] hover:bg-[var(--surface-hover)]"
                disabled={disabled || !value}
                onClick={() => onChange(key, undefined)}
                title="跟随终端原色"
                type="button"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
              {value && !isTerminalKeywordHighlightHexColor(value) ? (
                <span className="col-start-2 col-span-3 text-[11px] text-rose-600 dark:text-rose-300">
                  使用 #RRGGBB
                </span>
              ) : null}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/** 从预设复制出可独立编辑的 light/dark 颜色对象。 */
function clonePresetColors(
  style: TerminalKeywordHighlightStyle,
): TerminalKeywordHighlightCustomColors {
  const preset = terminalKeywordHighlightPalette[
    style === "custom" ? "yellow" : style
  ];
  return {
    light: { ...preset.light },
    dark: { ...preset.dark },
  };
}

/** 按 Unicode 标量截断输入，避免 emoji 被 HTML maxLength 的 UTF-16 计数提前截断。 */
function truncateCodePoints(value: string, limit: number): string {
  return Array.from(value).slice(0, limit).join("");
}
