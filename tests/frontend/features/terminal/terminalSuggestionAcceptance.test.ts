import { describe, expect, it } from "vitest";
import type { CommandSuggestionCandidate } from "../../../../src/lib/terminalSuggestionApi";
import { resolveTerminalSuggestionAcceptance } from "../../../../src/features/terminal/terminalSuggestionAcceptance";

describe("terminalSuggestionAcceptance", () => {
  it("accepts the whole Unicode replacement without overwriting text after the cursor", () => {
    const result = resolveTerminalSuggestionAcceptance({
      candidate: candidate({
        acceptBoundaries: [8, 10],
        replacementRange: { start: 5, end: 7 },
        replacementText: "echo 服务器/日志",
      }),
      cursor: 7,
      input: "echo 服务 --keep",
      unit: "all",
    });

    expect(result).toMatchObject({
      feedbackKind: "all",
      insertedText: "器/日志",
      nextInput: "echo 服务器/日志 --keep",
    });
  });

  it.each([
    ["quoted Unix path", "cat \"/srv/ap", "cat \"/srv/app/logs\"", [14], "p/"],
    ["escaped path", "cd /srv/my\\ f", "cd /srv/my\\ files/logs", [18], "iles/"],
    ["Windows path", "cd C:\\Users\\ko", "cd C:\\Users\\kong\\src", [16], "ng"],
    ["option value", "git --work-tree=/sr", "git --work-tree=/srv/app", [20], "v"],
  ])("uses backend boundaries for %s", (_name, input, replacementText, acceptBoundaries, insertedText) => {
    const cursor = Array.from(input).length;
    const result = resolveTerminalSuggestionAcceptance({
      candidate: candidate({
        acceptBoundaries,
        replacementRange: { start: 0, end: cursor },
        replacementText,
      }),
      cursor,
      input,
      unit: "partial",
    });
    expect(result?.insertedText).toBe(insertedText);
    expect(result?.feedbackKind).toBe("partial");
  });

  it("does not invent a boundary or accept a range ending outside the cursor", () => {
    expect(
      resolveTerminalSuggestionAcceptance({
        candidate: candidate({ acceptBoundaries: [] }),
        cursor: 3,
        input: "git",
        unit: "partial",
      }),
    ).toBeNull();
    expect(
      resolveTerminalSuggestionAcceptance({
        candidate: candidate({ replacementRange: { start: 0, end: 2 } }),
        cursor: 3,
        input: "git",
        unit: "all",
      }),
    ).toBeNull();
  });

  it("uses the nearest valid backend boundary even when payload order is unstable", () => {
    expect(
      resolveTerminalSuggestionAcceptance({
        candidate: candidate({ acceptBoundaries: [17, 10] }),
        cursor: 3,
        input: "git",
        unit: "partial",
      })?.acceptedBoundary,
    ).toBe(10);
  });

  it("never converts openSnippetPanel activation into terminal text", () => {
    expect(
      resolveTerminalSuggestionAcceptance({
        candidate: candidate({
          activation: "openSnippetPanel",
          candidateKind: "snippet",
        }),
        cursor: 3,
        input: "git",
        unit: "all",
      }),
    ).toBeNull();
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
