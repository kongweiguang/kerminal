import { describe, expect, it, vi } from "vitest";
import type { CommandSuggestionCandidate } from "../../../../src/lib/terminalSuggestionApi";
import { TerminalSuggestionCache } from "../../../../src/features/terminal/terminalSuggestionCache";
import { TerminalSuggestionController } from "../../../../src/features/terminal/terminalSuggestionController";
import { TerminalSuggestionRuntimeBridge } from "../../../../src/features/terminal/terminalSuggestionRuntimeBridge";

describe("TerminalSuggestionRuntimeBridge", () => {
  it("routes keys and lifecycle without exposing terminal objects to the controller", () => {
    const cache = new TerminalSuggestionCache();
    cache.put({
      candidates: [candidate()],
      contextKey: "ctx",
      cursor: 3,
      input: "git",
      mode: "inline",
      now: Date.now(),
      paneId: "pane-a",
    });
    const controller = new TerminalSuggestionController({
      cache,
      paneId: "pane-a",
      requestSuggestions: vi.fn().mockResolvedValue([]),
    });
    const bridge = new TerminalSuggestionRuntimeBridge(controller);
    bridge.sync({ contextKey: "ctx", cursor: 3, input: "git" });

    expect(bridge.handleKey({ altKey: true, key: "ArrowRight" })).toMatchObject({
      acceptance: { feedbackKind: "partial" },
      action: "accept-partial",
      handled: true,
    });
    bridge.setLifecycle({ imeComposing: true });
    expect(bridge.handleKey({ key: "ArrowRight" })).toEqual({ handled: false });
    bridge.setLifecycle({ imeComposing: false });
    expect(controller.getSnapshot().inlineSuffix).toBe(" --short");
    bridge.sessionClosed();
    expect(controller.getSnapshot().phase).toBe("disabled");
    bridge.dispose();
    expect(controller.getSnapshot().phase).toBe("disposed");
  });

  it("lets Right reach xterm when no safely applicable candidate survives ranking", () => {
    const cache = new TerminalSuggestionCache();
    cache.put({
      candidates: [
        candidate({
          replacementText: "npm test",
        }),
      ],
      contextKey: "ctx",
      cursor: 3,
      input: "git",
      mode: "inline",
      now: Date.now(),
      paneId: "pane-a",
    });
    const controller = new TerminalSuggestionController({
      cache,
      paneId: "pane-a",
      requestSuggestions: vi.fn().mockResolvedValue([]),
    });
    const bridge = new TerminalSuggestionRuntimeBridge(controller);
    bridge.sync({ contextKey: "ctx", cursor: 3, input: "git" });

    expect(bridge.handleKey({ key: "ArrowRight" })).toEqual({
      handled: false,
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
