// @author kongweiguang

import type { RE2JS as Re2Pattern } from "re2js";
import type {
  TerminalKeywordHighlightRule,
  TerminalKeywordHighlightSettings,
} from "../settings/contracts/index";

export interface TerminalKeywordHighlightTextMatch {
  start: number;
  end: number;
  rule: TerminalKeywordHighlightRule;
}

interface CompiledTerminalKeywordHighlightRule {
  rule: TerminalKeywordHighlightRule;
  find(text: string, limit: number): Array<{ start: number; end: number }>;
  dispose(): void;
}

export interface CompiledTerminalKeywordHighlights {
  rules: CompiledTerminalKeywordHighlightRule[];
  errors: ReadonlyMap<string, string>;
  dispose(): void;
}

let re2ModulePromise: Promise<typeof import("re2js")> | null = null;

/**
 * 仅在存在启用规则时加载 RE2JS；同一窗口内共享模块 Promise，避免多窗格同时启用
 * 高亮时重复触发 chunk 请求，同时仍让默认空配置不增加首屏执行成本。
 */
async function loadRe2Module(): Promise<typeof import("re2js")> {
  re2ModulePromise ??= import("re2js");
  return re2ModulePromise;
}

/**
 * 编译当前启用规则并保留原数组顺序；单条非法规则隔离为错误，不阻断其它规则，
 * 持久化边界仍会拒绝非法配置，因此该容错只服务于运行时热更新安全。
 */
export async function compileTerminalKeywordHighlights(
  settings: TerminalKeywordHighlightSettings,
): Promise<CompiledTerminalKeywordHighlights> {
  const enabledRules = settings.enabled
    ? settings.rules.filter((rule) => rule.enabled && rule.pattern.length > 0)
    : [];
  if (enabledRules.length === 0) {
    return emptyCompiledHighlights();
  }

  const { RE2JS } = await loadRe2Module();
  const rules: CompiledTerminalKeywordHighlightRule[] = [];
  const errors = new Map<string, string>();
  for (const rule of enabledRules) {
    try {
      rules.push(compileRule(RE2JS, rule));
    } catch (error) {
      errors.set(rule.id, matcherErrorMessage(error));
    }
  }
  return {
    rules,
    errors,
    dispose: () => {
      for (const rule of rules) {
        rule.dispose();
      }
      rules.length = 0;
    },
  };
}

/**
 * 按规则顺序汇总匹配并占用 UTF-16 区间；先出现的规则先写占用位，因此重叠时
 * 上方规则稳定获胜，同一规则内部仍保留从左到右的自然顺序。
 */
export function findTerminalKeywordHighlightMatches(
  compiled: CompiledTerminalKeywordHighlights,
  text: string,
  limit = 1_000,
): TerminalKeywordHighlightTextMatch[] {
  if (!text || limit <= 0 || compiled.rules.length === 0) {
    return [];
  }
  const occupied = new Uint8Array(text.length);
  const matches: TerminalKeywordHighlightTextMatch[] = [];

  for (const compiledRule of compiled.rules) {
    const remaining = limit - matches.length;
    if (remaining <= 0) {
      break;
    }
    for (const match of compiledRule.find(text, remaining)) {
      if (match.end <= match.start || overlapsOccupied(occupied, match)) {
        continue;
      }
      occupied.fill(1, match.start, match.end);
      matches.push({ ...match, rule: compiledRule.rule });
      if (matches.length >= limit) {
        break;
      }
    }
  }
  return matches.sort((left, right) => left.start - right.start);
}

/**
 * 编辑器保存前使用与 controller 相同的编译路径校验正则；返回可直接展示的错误
 * 文本而不是抛出，避免异步 chunk 或语法错误离开表单事件边界。
 */
export async function validateTerminalKeywordHighlightRegex(
  pattern: string,
): Promise<string | null> {
  const structuralError = terminalKeywordHighlightRegexStructureError(pattern);
  if (structuralError) {
    return structuralError;
  }
  try {
    const { RE2JS } = await loadRe2Module();
    const compiled = RE2JS.compile(pattern);
    try {
      if (canProduceEmptyMatch(compiled)) {
        return "正则不能产生空匹配。";
      }
    } finally {
      compiled.reset();
    }
    return null;
  } catch (error) {
    return `正则无效：${matcherErrorMessage(error)}`;
  }
}

/** 先拒绝回溯引用、前后查找和内联标志，使前端与 Rust 只接受同一 RE2 子集。 */
function terminalKeywordHighlightRegexStructureError(
  pattern: string,
): string | null {
  if (containsUnsupportedGroup(pattern) || containsBackreference(pattern)) {
    return "不支持回溯引用、前后查找或内联标志。";
  }
  return null;
}

/** 将纯文本通过 RE2 quote 编译，统一大小写与 Unicode 索引语义而不启用 JS RegExp。 */
function compileRule(
  RE2JS: typeof import("re2js")["RE2JS"],
  rule: TerminalKeywordHighlightRule,
): CompiledTerminalKeywordHighlightRule {
  const structuralError =
    rule.matchMode === "regex"
      ? terminalKeywordHighlightRegexStructureError(rule.pattern)
      : null;
  if (structuralError) {
    throw new Error(structuralError);
  }
  const expression =
    rule.matchMode === "regex" ? rule.pattern : RE2JS.quote(rule.pattern);
  const flags = rule.caseSensitive ? 0 : RE2JS.CASE_INSENSITIVE;
  const pattern = RE2JS.compile(expression, flags);
  if (canProduceEmptyMatch(pattern)) {
    pattern.reset();
    throw new Error("正则不能产生空匹配。");
  }

  return {
    rule,
    find: (text, limit) => {
      const matcher = pattern.matcher(text);
      const matches: Array<{ start: number; end: number }> = [];
      while (matches.length < limit && matcher.find()) {
        const start = matcher.start();
        const end = matcher.end();
        if (
          end > start &&
          (rule.matchMode !== "wholeWord" || isUnicodeWholeWord(text, start, end))
        ) {
          matches.push({ start, end });
        }
      }
      return matches;
    },
    dispose: () => pattern.reset(),
  };
}

/**
 * 零宽断言可能只在非空上下文命中，因此除空串外再覆盖字母、数字、下划线、
 * 空白与 CJK 边界；controller 最终仍会丢弃任何意外的 start === end 结果。
 */
function canProduceEmptyMatch(pattern: Re2Pattern): boolean {
  const probes = ["", "a", "0", "_", " ", "\n", "中", "ERROR", "a中0_ ERROR"];
  return probes.some((probe) => {
    const matcher = pattern.matcher(probe);
    while (matcher.find()) {
      if (matcher.start() === matcher.end()) {
        return true;
      }
    }
    return false;
  });
}

/** Unicode 整词把字母、数字和下划线视为词元，覆盖中文且不依赖 ASCII `\b`。 */
function isUnicodeWholeWord(text: string, start: number, end: number): boolean {
  return !isWordCharacter(codePointBefore(text, start)) &&
    !isWordCharacter(codePointAt(text, end));
}

/** 从 UTF-16 位置向前读取完整 code point，避免把代理对的一半当作边界字符。 */
function codePointBefore(text: string, index: number): string | null {
  if (index <= 0) {
    return null;
  }
  const low = text.charCodeAt(index - 1);
  const start = low >= 0xdc00 && low <= 0xdfff ? index - 2 : index - 1;
  return text.slice(Math.max(0, start), index);
}

/** 从 UTF-16 位置读取完整 code point，供整词右边界判断。 */
function codePointAt(text: string, index: number): string | null {
  if (index >= text.length) {
    return null;
  }
  const value = text.codePointAt(index);
  return value === undefined ? null : String.fromCodePoint(value);
}

/** 词元定义显式使用 Unicode 属性，避免中文相邻文字被误判为独立整词。 */
function isWordCharacter(value: string | null): boolean {
  return value !== null && /^[\p{L}\p{N}_]$/u.test(value);
}

/** 对已占用区间做早退扫描，规则最多 64 条且单行受 xterm 列数约束。 */
function overlapsOccupied(
  occupied: Uint8Array,
  match: { start: number; end: number },
): boolean {
  for (let index = match.start; index < match.end; index += 1) {
    if (occupied[index] === 1) {
      return true;
    }
  }
  return false;
}

/** 识别任何未转义的 `(?...)`，仅允许普通非捕获组 `(?:...)`。 */
function containsUnsupportedGroup(pattern: string): boolean {
  for (let index = 0; index < pattern.length - 1; index += 1) {
    if (pattern[index] !== "(" || pattern[index + 1] !== "?") {
      continue;
    }
    let slashCount = 0;
    for (let cursor = index - 1; cursor >= 0 && pattern[cursor] === "\\"; cursor -= 1) {
      slashCount += 1;
    }
    if (slashCount % 2 === 0 && pattern[index + 2] !== ":") {
      return true;
    }
  }
  return false;
}

/** 识别未转义的 `\1` 至 `\9` 与 `\k`，与 Rust 存储校验保持相同边界。 */
function containsBackreference(pattern: string): boolean {
  for (let index = 0; index < pattern.length; index += 1) {
    if (!/[1-9k]/.test(pattern[index])) {
      continue;
    }
    let slashCount = 0;
    for (let cursor = index - 1; cursor >= 0 && pattern[cursor] === "\\"; cursor -= 1) {
      slashCount += 1;
    }
    if (slashCount % 2 === 1) {
      return true;
    }
  }
  return false;
}

/** 空编译结果仍提供统一 dispose 接口，简化 controller 的原子替换路径。 */
function emptyCompiledHighlights(): CompiledTerminalKeywordHighlights {
  return {
    rules: [],
    errors: new Map(),
    dispose: () => undefined,
  };
}

/** 不暴露第三方异常类型和堆栈，只提取用户可修复的语法信息。 */
function matcherErrorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : "无法编译关键词高亮规则。";
}
