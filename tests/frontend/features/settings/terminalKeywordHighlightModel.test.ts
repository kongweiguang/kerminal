// @author kongweiguang

import { describe, expect, it } from "vitest";
import {
  defaultTerminalKeywordHighlightSettings,
  normalizeTerminalKeywordHighlightRule,
  normalizeTerminalKeywordHighlightSettings,
  terminalKeywordHighlightColorsForTheme,
  TERMINAL_KEYWORD_HIGHLIGHT_NOTE_LIMIT,
  TERMINAL_KEYWORD_HIGHLIGHT_PATTERN_LIMIT,
  TERMINAL_KEYWORD_HIGHLIGHT_RULE_LIMIT,
} from "../../../../src/features/settings/terminalKeywordHighlightModel";

describe("terminalKeywordHighlightModel", () => {
  it("keeps old settings compatible with an enabled empty rule list", () => {
    expect(normalizeTerminalKeywordHighlightSettings(undefined)).toEqual(
      defaultTerminalKeywordHighlightSettings,
    );
  });

  it("normalizes limits, unicode text, duplicate ids, and custom colors", () => {
    const settings = normalizeTerminalKeywordHighlightSettings({
      enabled: false,
      rules: [
        {
          id: " primary ",
          enabled: true,
          pattern: "🙂".repeat(TERMINAL_KEYWORD_HIGHLIGHT_PATTERN_LIMIT + 2),
          matchMode: "wholeWord",
          caseSensitive: true,
          note: " 注 ".repeat(TERMINAL_KEYWORD_HIGHLIGHT_NOTE_LIMIT),
          style: "custom",
          customColors: {
            light: { background: "#aabbcc" },
            dark: { foreground: "#ddeeff" },
          },
        },
        {
          id: "primary",
          enabled: true,
          pattern: "duplicate",
          matchMode: "literal",
          caseSensitive: false,
          note: "",
          style: "red",
        },
        ...Array.from({ length: TERMINAL_KEYWORD_HIGHLIGHT_RULE_LIMIT }, (_, index) => ({
          id: `rule-${index}`,
          enabled: true,
          pattern: `value-${index}`,
          matchMode: "literal" as const,
          caseSensitive: false,
          note: "",
          style: "yellow" as const,
        })),
      ],
    });

    expect(settings.enabled).toBe(false);
    expect(settings.rules).toHaveLength(TERMINAL_KEYWORD_HIGHLIGHT_RULE_LIMIT - 1);
    expect(Array.from(settings.rules[0].pattern)).toHaveLength(
      TERMINAL_KEYWORD_HIGHLIGHT_PATTERN_LIMIT,
    );
    expect(Array.from(settings.rules[0].note).length).toBeLessThanOrEqual(
      TERMINAL_KEYWORD_HIGHLIGHT_NOTE_LIMIT,
    );
    expect(settings.rules[0]).toMatchObject({
      id: "primary",
      customColors: {
        light: { background: "#AABBCC" },
        dark: { foreground: "#DDEEFF" },
      },
    });
  });

  it("falls back from incomplete custom colors and resolves adaptive presets", () => {
    const rule = normalizeTerminalKeywordHighlightRule({
      id: "warn",
      pattern: "WARN",
      style: "custom",
      customColors: {
        light: { background: "#FF0000" },
        dark: {},
      },
    });

    expect(rule?.style).toBe("yellow");
    expect(
      terminalKeywordHighlightColorsForTheme(
        { style: "blue" },
        "dark",
      ),
    ).toEqual({ foreground: "#93C5FD", background: "#172554" });
  });
});
