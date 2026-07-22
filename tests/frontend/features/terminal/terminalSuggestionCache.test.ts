import { describe, expect, it } from "vitest";
import type { CommandSuggestionCandidate } from "../../../../src/lib/terminalSuggestionApi";
import { TerminalSuggestionCache } from "../../../../src/features/terminal/terminalSuggestionCache";

describe("TerminalSuggestionCache", () => {
  it("enforces pane bucket, bucket candidate, and global candidate limits", () => {
    const cache = new TerminalSuggestionCache({
      maxBucketsPerPane: 2,
      maxCandidates: 3,
      maxCandidatesPerBucket: 2,
      staleTtlMs: 1000,
      ttlMs: 100,
    });
    for (let index = 0; index < 3; index += 1) {
      cache.put({
        candidates: [
          candidate({ id: `a-${index}-1` }),
          candidate({ id: `a-${index}-2` }),
          candidate({ id: `a-${index}-3` }),
        ],
        contextKey: "ctx",
        cursor: index + 1,
        input: `g${index}`,
        mode: "inline",
        now: index,
        paneId: "pane-a",
      });
    }

    expect(cache.stats()).toMatchObject({
      bucketCount: 1,
      candidateCount: 2,
      evictions: 2,
      paneCount: 1,
    });
  });

  it("isolates panes and reports fresh, stale, and expired reads", () => {
    const cache = new TerminalSuggestionCache({
      staleTtlMs: 200,
      ttlMs: 50,
    });
    cache.put({
      candidates: [candidate()],
      contextKey: "ctx",
      cursor: 3,
      input: "git",
      mode: "inline",
      now: 0,
      paneId: "pane-a",
    });

    expect(cache.get({ contextKey: "ctx", mode: "inline", now: 10, paneId: "pane-b" })).toEqual([]);
    expect(cache.get({ contextKey: "ctx", mode: "inline", now: 60, paneId: "pane-a" })[0]?.stale).toBe(true);
    expect(cache.get({ contextKey: "ctx", mode: "inline", now: 201, paneId: "pane-a" })).toEqual([]);
    expect(cache.stats()).toMatchObject({
      expiredBuckets: 1,
      misses: 2,
      staleHits: 1,
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
