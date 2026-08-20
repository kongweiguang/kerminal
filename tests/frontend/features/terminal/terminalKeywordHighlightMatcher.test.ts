// @author kongweiguang

import { describe, expect, it } from "vitest";
import type { TerminalKeywordHighlightRule } from "../../../../src/features/settings/terminalKeywordHighlightModel";
import {
  compileTerminalKeywordHighlights,
  findTerminalKeywordHighlightMatches,
  validateTerminalKeywordHighlightRegex,
} from "../../../../src/features/terminal/terminalKeywordHighlightMatcher";

/** 构造启用的默认规则，便于每个测试只表达需要变化的匹配语义。 */
function rule(
  id: string,
  pattern: string,
  patch: Partial<TerminalKeywordHighlightRule> = {},
): TerminalKeywordHighlightRule {
  return {
    id,
    enabled: true,
    pattern,
    matchMode: "literal",
    caseSensitive: false,
    note: "",
    style: "yellow",
    ...patch,
  };
}

describe("terminalKeywordHighlightMatcher", () => {
  it("matches literal text case-insensitively with UTF-16 ranges", async () => {
    const compiled = await compileTerminalKeywordHighlights({
      enabled: true,
      rules: [rule("emoji", "🙂WARN")],
    });
    try {
      expect(findTerminalKeywordHighlightMatches(compiled, "x🙂warn y")).toEqual([
        expect.objectContaining({ start: 1, end: 7 }),
      ]);
    } finally {
      compiled.dispose();
    }
  });

  it("uses Unicode word boundaries instead of ASCII regex boundaries", async () => {
    const compiled = await compileTerminalKeywordHighlights({
      enabled: true,
      rules: [rule("word", "错误", { matchMode: "wholeWord" })],
    });
    try {
      expect(
        findTerminalKeywordHighlightMatches(
          compiled,
          "错误 错误码 pre错误 错误-post",
        ).map(({ start, end }) => ({ start, end })),
      ).toEqual([
        { start: 0, end: 2 },
        { start: 13, end: 15 },
      ]);
    } finally {
      compiled.dispose();
    }
  });

  it("executes safe regex and gives earlier overlapping rules priority", async () => {
    const compiled = await compileTerminalKeywordHighlights({
      enabled: true,
      rules: [
        rule("specific", "java-test"),
        rule("general", "java", { style: "red" }),
        rule("regex", String.raw`err(?:or)?\d+`, { matchMode: "regex" }),
      ],
    });
    try {
      const matches = findTerminalKeywordHighlightMatches(
        compiled,
        "java-test java error42 err7",
      );
      expect(matches.map(({ rule: matchRule, start, end }) => ({ id: matchRule.id, start, end }))).toEqual([
        { id: "specific", start: 0, end: 9 },
        { id: "general", start: 10, end: 14 },
        { id: "regex", start: 15, end: 22 },
        { id: "regex", start: 23, end: 27 },
      ]);
    } finally {
      compiled.dispose();
    }
  });

  it("rejects empty matches, lookarounds, and backreferences", async () => {
    await expect(validateTerminalKeywordHighlightRegex("a*")).resolves.toContain(
      "空匹配",
    );
    await expect(
      validateTerminalKeywordHighlightRegex("(?=error)"),
    ).resolves.toContain("前后查找");
    await expect(
      validateTerminalKeywordHighlightRegex(String.raw`(a)\1`),
    ).resolves.toContain("回溯引用");
  });
});
