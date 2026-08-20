// @author kongweiguang

export const TERMINAL_KEYWORD_HIGHLIGHT_RULE_LIMIT = 64;
export const TERMINAL_KEYWORD_HIGHLIGHT_PATTERN_LIMIT = 256;
export const TERMINAL_KEYWORD_HIGHLIGHT_NOTE_LIMIT = 160;

export type TerminalKeywordHighlightMatchMode =
  | "literal"
  | "wholeWord"
  | "regex";

export type TerminalKeywordHighlightStyle =
  | "red"
  | "orange"
  | "yellow"
  | "green"
  | "cyan"
  | "blue"
  | "purple"
  | "pink"
  | "custom";

export interface TerminalKeywordHighlightColorPair {
  foreground?: string;
  background?: string;
}

export interface TerminalKeywordHighlightCustomColors {
  light: TerminalKeywordHighlightColorPair;
  dark: TerminalKeywordHighlightColorPair;
}

export interface TerminalKeywordHighlightRule {
  id: string;
  enabled: boolean;
  pattern: string;
  matchMode: TerminalKeywordHighlightMatchMode;
  caseSensitive: boolean;
  note: string;
  style: TerminalKeywordHighlightStyle;
  customColors?: TerminalKeywordHighlightCustomColors;
}

export interface TerminalKeywordHighlightSettings {
  enabled: boolean;
  rules: TerminalKeywordHighlightRule[];
}

export type TerminalKeywordHighlightPresetStyle = Exclude<
  TerminalKeywordHighlightStyle,
  "custom"
>;

export interface TerminalKeywordHighlightAdaptiveColors {
  light: Required<TerminalKeywordHighlightColorPair>;
  dark: Required<TerminalKeywordHighlightColorPair>;
}

export const terminalKeywordHighlightPresetStyles: readonly TerminalKeywordHighlightPresetStyle[] =
  ["red", "orange", "yellow", "green", "cyan", "blue", "purple", "pink"];

export const terminalKeywordHighlightPalette: Record<
  TerminalKeywordHighlightPresetStyle,
  TerminalKeywordHighlightAdaptiveColors
> = {
  red: {
    light: { foreground: "#991B1B", background: "#FEE2E2" },
    dark: { foreground: "#FCA5A5", background: "#450A0A" },
  },
  orange: {
    light: { foreground: "#9A3412", background: "#FFEDD5" },
    dark: { foreground: "#FDBA74", background: "#431407" },
  },
  yellow: {
    light: { foreground: "#854D0E", background: "#FEF9C3" },
    dark: { foreground: "#FDE047", background: "#422006" },
  },
  green: {
    light: { foreground: "#166534", background: "#DCFCE7" },
    dark: { foreground: "#86EFAC", background: "#052E16" },
  },
  cyan: {
    light: { foreground: "#155E75", background: "#CFFAFE" },
    dark: { foreground: "#67E8F9", background: "#083344" },
  },
  blue: {
    light: { foreground: "#1E40AF", background: "#DBEAFE" },
    dark: { foreground: "#93C5FD", background: "#172554" },
  },
  purple: {
    light: { foreground: "#6B21A8", background: "#F3E8FF" },
    dark: { foreground: "#D8B4FE", background: "#3B0764" },
  },
  pink: {
    light: { foreground: "#9D174D", background: "#FCE7F3" },
    dark: { foreground: "#F9A8D4", background: "#500724" },
  },
};

export const defaultTerminalKeywordHighlightSettings: TerminalKeywordHighlightSettings =
  {
    enabled: true,
    rules: [],
  };

/**
 * 对来自旧配置或前端缓存的规则做无副作用归一化；非法实体直接忽略，避免为了
 * 修复损坏数据而生成无法稳定复用的新 ID，同时保持列表顺序就是匹配优先级。
 */
export function normalizeTerminalKeywordHighlightSettings(
  settings: Partial<TerminalKeywordHighlightSettings> | undefined,
): TerminalKeywordHighlightSettings {
  const rules = Array.isArray(settings?.rules) ? settings.rules : [];
  const normalized: TerminalKeywordHighlightRule[] = [];
  const ids = new Set<string>();

  for (const candidate of rules.slice(0, TERMINAL_KEYWORD_HIGHLIGHT_RULE_LIMIT)) {
    const rule = normalizeTerminalKeywordHighlightRule(candidate);
    if (!rule || ids.has(rule.id)) {
      continue;
    }
    ids.add(rule.id);
    normalized.push(rule);
  }

  return {
    enabled:
      typeof settings?.enabled === "boolean"
        ? settings.enabled
        : defaultTerminalKeywordHighlightSettings.enabled,
    rules: normalized,
  };
}

/**
 * 解析单条规则时只处理同步结构约束；正则编译留给 RE2JS 匹配器，避免设置加载
 * 把安全正则引擎提前打入首屏 bundle。
 */
export function normalizeTerminalKeywordHighlightRule(
  candidate: unknown,
): TerminalKeywordHighlightRule | null {
  if (!candidate || typeof candidate !== "object") {
    return null;
  }
  const source = candidate as Partial<TerminalKeywordHighlightRule>;
  const id = typeof source.id === "string" ? source.id.trim() : "";
  const pattern =
    typeof source.pattern === "string"
      ? truncateCodePoints(source.pattern, TERMINAL_KEYWORD_HIGHLIGHT_PATTERN_LIMIT)
      : "";
  if (!id || !pattern.trim()) {
    return null;
  }

  const style = normalizeTerminalKeywordHighlightStyle(source.style);
  const customColors = normalizeTerminalKeywordHighlightCustomColors(
    source.customColors,
  );
  const usableStyle = style === "custom" && !customColors ? "yellow" : style;

  return {
    id,
    enabled: typeof source.enabled === "boolean" ? source.enabled : true,
    pattern,
    matchMode: normalizeTerminalKeywordHighlightMatchMode(source.matchMode),
    caseSensitive:
      typeof source.caseSensitive === "boolean" ? source.caseSensitive : false,
    note:
      typeof source.note === "string"
        ? truncateCodePoints(source.note.trim(), TERMINAL_KEYWORD_HIGHLIGHT_NOTE_LIMIT)
        : "",
    style: usableStyle,
    ...(usableStyle === "custom" && customColors ? { customColors } : {}),
  };
}

/**
 * 将规则颜色解析为当前主题的稳定十六进制值；controller 只依赖该结果，不读取
 * DOM 主题变量，因而主题热切换时可以原子替换全部 decoration。
 */
export function terminalKeywordHighlightColorsForTheme(
  rule: Pick<TerminalKeywordHighlightRule, "style" | "customColors">,
  theme: "light" | "dark",
): TerminalKeywordHighlightColorPair {
  if (rule.style === "custom" && rule.customColors) {
    return rule.customColors[theme];
  }
  const style = rule.style === "custom" ? "yellow" : rule.style;
  return terminalKeywordHighlightPalette[style][theme];
}

/** 颜色契约刻意只接受完整的六位十六进制，避免浏览器与 xterm 对短写法解释不一致。 */
export function isTerminalKeywordHighlightHexColor(
  value: unknown,
): value is string {
  return typeof value === "string" && /^#[0-9A-Fa-f]{6}$/.test(value);
}

/** 自定义色必须在每个主题至少提供前景或背景，才能保证切换主题后规则仍可见。 */
export function isTerminalKeywordHighlightCustomColorsComplete(
  colors: TerminalKeywordHighlightCustomColors | undefined,
): colors is TerminalKeywordHighlightCustomColors {
  return Boolean(
    colors &&
      hasConfiguredColor(colors.light) &&
      hasConfiguredColor(colors.dark),
  );
}

/** 保留用户输入的 Unicode 字符边界，避免按 UTF-16 截断时切开 emoji 代理对。 */
function truncateCodePoints(value: string, limit: number): string {
  return Array.from(value).slice(0, limit).join("");
}

/** 只接受首版公开的三种匹配语义，未知值回退到最安全的纯文本匹配。 */
function normalizeTerminalKeywordHighlightMatchMode(
  value: unknown,
): TerminalKeywordHighlightMatchMode {
  return value === "wholeWord" || value === "regex" ? value : "literal";
}

/** 未知色板回退到对深浅主题均有高对比度的黄色方案。 */
function normalizeTerminalKeywordHighlightStyle(
  value: unknown,
): TerminalKeywordHighlightStyle {
  if (
    value === "custom" ||
    terminalKeywordHighlightPresetStyles.includes(
      value as TerminalKeywordHighlightPresetStyle,
    )
  ) {
    return value as TerminalKeywordHighlightStyle;
  }
  return "yellow";
}

/** 丢弃单个非法颜色，而不是把未知 CSS 值传入 xterm decoration。 */
function normalizeTerminalKeywordHighlightCustomColors(
  value: unknown,
): TerminalKeywordHighlightCustomColors | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const source = value as Partial<TerminalKeywordHighlightCustomColors>;
  const colors = {
    light: normalizeTerminalKeywordHighlightColorPair(source.light),
    dark: normalizeTerminalKeywordHighlightColorPair(source.dark),
  };
  return isTerminalKeywordHighlightCustomColorsComplete(colors)
    ? colors
    : undefined;
}

/** 将可选颜色统一为大写，确保序列化、预览与相等比较不会因大小写产生假变化。 */
function normalizeTerminalKeywordHighlightColorPair(
  value: unknown,
): TerminalKeywordHighlightColorPair {
  if (!value || typeof value !== "object") {
    return {};
  }
  const source = value as TerminalKeywordHighlightColorPair;
  const foreground = isTerminalKeywordHighlightHexColor(source.foreground)
    ? source.foreground.toUpperCase()
    : undefined;
  const background = isTerminalKeywordHighlightHexColor(source.background)
    ? source.background.toUpperCase()
    : undefined;
  return {
    ...(foreground ? { foreground } : {}),
    ...(background ? { background } : {}),
  };
}

/** 空对象代表跟随终端原色，只有至少配置一端时才算有效自定义主题。 */
function hasConfiguredColor(pair: TerminalKeywordHighlightColorPair): boolean {
  return Boolean(pair.foreground || pair.background);
}
