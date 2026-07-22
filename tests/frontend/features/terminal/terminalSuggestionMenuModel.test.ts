import { describe, expect, it } from "vitest";
import type { CommandSuggestionCandidate } from "../../../../src/lib/terminalSuggestionApi";
import {
  createTerminalSuggestionMenuState,
  reduceTerminalSuggestionMenuState,
  resolveTerminalSuggestionMenuKeyIntent,
  TERMINAL_SUGGESTION_MENU_MAX_ITEMS,
  terminalSuggestionMenuCandidateView,
} from "../../../../src/features/terminal/terminalSuggestionMenuModel";

describe("terminalSuggestionMenuModel", () => {
  it("caps menu candidates at eight and removes sensitive or inline-only entries", () => {
    const state = createTerminalSuggestionMenuState({
      candidates: [
        candidate({ id: "sensitive", sensitivity: "sensitive" }),
        candidate({ allowedPresentations: ["inline"], id: "inline" }),
        ...Array.from({ length: 10 }, (_, index) =>
          candidate({ id: `menu-${index}` }),
        ),
      ],
      open: true,
    });

    expect(state.candidates).toHaveLength(TERMINAL_SUGGESTION_MENU_MAX_ITEMS);
    expect(state.candidates[0]?.id).toBe("menu-0");
    expect(state.open).toBe(true);
  });

  it("opens, wraps navigation, preserves selection across refresh, and closes", () => {
    let state = reduceTerminalSuggestionMenuState(
      createTerminalSuggestionMenuState(),
      { candidates: [candidate({ id: "a" }), candidate({ id: "b" })], type: "open" },
    );
    state = reduceTerminalSuggestionMenuState(state, {
      direction: -1,
      type: "move",
    });
    expect(state.selectedIndex).toBe(1);

    state = reduceTerminalSuggestionMenuState(state, {
      candidates: [candidate({ id: "b" }), candidate({ id: "c" })],
      stale: true,
      type: "candidates",
    });
    expect(state.selectedIndex).toBe(0);
    expect(state.stale).toBe(true);
    expect(reduceTerminalSuggestionMenuState(state, { type: "close" }).open).toBe(false);
  });

  it("maps Ctrl+Space, arrows, Enter, Right, and Escape to pure intents", () => {
    const closed = createTerminalSuggestionMenuState();
    expect(
      resolveTerminalSuggestionMenuKeyIntent(closed, {
        ctrlKey: true,
        key: " ",
      }),
    ).toEqual({ type: "open" });

    const open = createTerminalSuggestionMenuState({
      candidates: [candidate({ id: "a" }), candidate({ id: "b" })],
      open: true,
    });
    expect(
      resolveTerminalSuggestionMenuKeyIntent(open, { key: "ArrowUp" }),
    ).toEqual({ index: 1, type: "move" });
    expect(
      resolveTerminalSuggestionMenuKeyIntent(open, { key: "Enter" }),
    ).toMatchObject({ candidate: { id: "a" }, type: "accept" });
    expect(
      resolveTerminalSuggestionMenuKeyIntent(open, { key: "ArrowRight" }),
    ).toMatchObject({ candidate: { id: "a" }, type: "accept" });
    expect(
      resolveTerminalSuggestionMenuKeyIntent(open, { key: "Escape" }),
    ).toEqual({ type: "close" });
    expect(
      resolveTerminalSuggestionMenuKeyIntent(open, {
        isComposing: true,
        key: "Escape",
      }),
    ).toBeNull();

    const parameterized = createTerminalSuggestionMenuState({
      candidates: [
        candidate({
          activation: "openSnippetPanel",
          candidateKind: "snippet",
        }),
      ],
      open: true,
    });
    expect(
      resolveTerminalSuggestionMenuKeyIntent(parameterized, { key: "Enter" }),
    ).toMatchObject({
      candidate: { id: "candidate" },
      type: "openSnippetPanel",
    });
  });

  it("derives provider, danger, description, and stale presentation", () => {
    expect(
      terminalSuggestionMenuCandidateView(
        candidate({
          description: "删除目录",
          metadata: { stale: true },
          provider: "remoteCommand",
          sensitivity: "dangerous",
        }),
        false,
      ),
    ).toMatchObject({
      dangerous: true,
      description: "删除目录",
      providerLabel: "远端命令",
      stale: true,
    });

    expect(
      terminalSuggestionMenuCandidateView(
        candidate({ provider: "snippet" }),
        false,
      ).providerLabel,
    ).toBe("片段");
    expect(
      terminalSuggestionMenuCandidateView(
        candidate({
          activation: "openSnippetPanel",
          candidateKind: "snippet",
          metadata: { origin: "user" },
          provider: "snippet",
        }),
        false,
      ).providerLabel,
    ).toBe("我的片段 · 配置");
  });
});

function candidate(
  overrides: Partial<CommandSuggestionCandidate> = {},
): CommandSuggestionCandidate {
  return {
    acceptBoundaries: [4],
    allowedPresentations: ["inline", "menu"],
    contextKey: "ctx",
    displayText: "git status",
    id: "candidate",
    provider: "history",
    replacementRange: { end: 3, start: 0 },
    replacementText: "git status",
    score: 0.9,
    sensitivity: "normal",
    suffix: " status",
    ...overrides,
  };
}
