import { describe, expect, it } from "vitest";
import type { CommandSuggestionCandidate } from "../../../../src/lib/terminalSuggestionApi";
import { createTerminalSuggestionViewState } from "../../../../src/features/terminal/terminalSuggestionModel";
import { reduceTerminalSuggestionState } from "../../../../src/features/terminal/terminalSuggestionStateMachine";

describe("terminalSuggestionStateMachine", () => {
  it("keeps cached candidates visible while a request starts", () => {
    const visible = reduceTerminalSuggestionState(
      createTerminalSuggestionViewState(),
      {
        candidates: [candidate()],
        generation: 1,
        stale: false,
        type: "candidates",
      },
    );
    const requesting = reduceTerminalSuggestionState(visible, {
      type: "request-started",
    });

    expect(requesting.phase).toBe("requesting");
    expect(requesting.inlineSuffix).toBe(" status --short");
  });

  it("clears all visible state when lifecycle is disabled", () => {
    const state = reduceTerminalSuggestionState(
      createTerminalSuggestionViewState({ candidates: [candidate()] }),
      { generation: 4, type: "disabled" },
    );
    expect(state).toMatchObject({
      candidates: [],
      generation: 4,
      inlineCandidate: null,
      phase: "disabled",
    });
  });
});

function candidate(): CommandSuggestionCandidate {
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
  };
}
