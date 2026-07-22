import { describe, expect, it } from "vitest";
import type { CommandSuggestionCandidate } from "../../../../src/lib/terminalSuggestionApi";
import { rankTerminalSuggestions } from "../../../../src/features/terminal/terminalSuggestionRanking";

describe("terminalSuggestionRanking", () => {
  it("adapts cached ranges to longer input and keeps ordering stable", () => {
    const ranked = rankTerminalSuggestions(
      [
        { cachedAt: 1, candidate: candidate({ id: "z", score: 0.8 }), stale: false },
        { cachedAt: 1, candidate: candidate({ id: "a", score: 0.8 }), stale: false },
      ],
      {
        contextKey: "ctx",
        cursor: 5,
        input: "git s",
        mode: "inline",
      },
    );

    expect(ranked).toHaveLength(1);
    expect(ranked[0]?.candidate).toMatchObject({
      replacementRange: { end: 5, start: 0 },
      suffix: "tatus --short",
    });
  });

  it("filters sensitive, dangerous inline, context-mismatched, and prefix-mismatched candidates", () => {
    const ranked = rankTerminalSuggestions(
      [
        { cachedAt: 1, candidate: candidate({ id: "s", sensitivity: "sensitive" }), stale: false },
        { cachedAt: 1, candidate: candidate({ id: "d", sensitivity: "dangerous" }), stale: false },
        { cachedAt: 1, candidate: candidate({ contextKey: "other", id: "c" }), stale: false },
        { cachedAt: 1, candidate: candidate({ id: "p", replacementText: "npm test" }), stale: false },
      ],
      { contextKey: "ctx", cursor: 3, input: "git", mode: "inline" },
    );
    expect(ranked).toEqual([]);
  });

  it("keeps panel activations out of inline suggestions", () => {
    const ranked = rankTerminalSuggestions(
      [{
        cachedAt: 1,
        candidate: candidate({
          activation: "openSnippetPanel",
          candidateKind: "snippet",
          id: "snippet:parameterized",
          provider: "snippet",
        }),
        stale: false,
      }],
      { contextKey: "ctx", cursor: 3, input: "git", mode: "inline" },
    );

    expect(ranked).toEqual([]);
  });

  it("keeps exact-query parameterized snippets in the menu without requiring a template prefix", () => {
    const cached = {
      cachedAt: 1,
      candidate: candidate({
        activation: "openSnippetPanel" as const,
        candidateKind: "snippet" as const,
        displayText: "HTTP 响应头",
        id: "snippet:http-head",
        provider: "snippet" as const,
        replacementText: "curl --head {{url}}",
        sourceId: "snippet.builtin.core.http_head",
        suffix: "",
      }),
      sourceCursor: 4,
      sourceInput: "http",
      stale: false,
    };

    expect(
      rankTerminalSuggestions([cached], {
        contextKey: "ctx",
        cursor: 4,
        input: "http",
        mode: "menu",
      }),
    ).toHaveLength(1);
    expect(
      rankTerminalSuggestions([cached], {
        contextKey: "ctx",
        cursor: 4,
        input: "curl",
        mode: "menu",
      }),
    ).toEqual([]);
  });

  it("deduplicates spec and snippet replacements without losing source explanations", () => {
    const ranked = rankTerminalSuggestions(
      [
        {
          cachedAt: 1,
          candidate: candidate({
            id: "spec:git-status",
            provider: "spec",
            score: 0.8,
            sourceExplanation: "Git 命令规范",
          }),
          stale: false,
        },
        {
          cachedAt: 1,
          candidate: candidate({
            candidateKind: "snippet",
            id: "snippet:git-status",
            provider: "snippet",
            score: 0.9,
            sourceExplanation: "内置 Git 片段",
          }),
          stale: false,
        },
      ],
      { contextKey: "ctx", cursor: 3, input: "git", mode: "menu" },
    );

    expect(ranked).toHaveLength(1);
    expect(ranked[0]?.candidate).toMatchObject({
      id: "snippet:git-status",
      mergedSourceExplanations: ["Git 命令规范", "内置 Git 片段"],
    });
  });
});

function candidate(
  overrides: Partial<CommandSuggestionCandidate> = {},
): CommandSuggestionCandidate {
  return {
    acceptBoundaries: [10, 17],
    allowedPresentations: ["inline", "menu"],
    displayText: "git status --short",
    id: "history:git-status",
    provider: "history",
    replacementRange: { end: 3, start: 0 },
    replacementText: "git status --short",
    score: 0.9,
    sensitivity: "normal",
    suffix: " status --short",
    ...overrides,
  };
}
