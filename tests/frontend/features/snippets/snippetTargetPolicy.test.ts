// @author kongweiguang

import { describe, expect, it } from "vitest";
import {
  createSnippetTargetSnapshot,
  isSnippetTargetSnapshotCurrent,
  resolveSnippetExecutionPolicy,
} from "../../../../src/features/snippets/snippetTargetPolicy";
import type { PaneSessionRecord } from "../../../../src/features/terminal/terminalSessionRegistry";

type SnapshotOverrides = Partial<{
  connectionGeneration: number;
  record: PaneSessionRecord;
}>;

function snapshot(overrides: SnapshotOverrides = {}) {
  return createSnippetTargetSnapshot({
    capturedAt: 100,
    connectionGeneration: 4,
    displayName: "prod-web-1",
    paneId: "pane-a",
    record: {
      connectionGeneration: 4,
      remoteHostId: "host-a",
      sessionId: "session-a",
      shell: "/bin/bash",
      target: "ssh",
    },
    ...overrides,
  });
}

describe("snippetTargetPolicy", () => {
  it("只冻结发送所需的目标身份，不携带环境识别结果", () => {
    expect(snapshot()).toEqual({
      capturedAt: 100,
      connectionGeneration: 4,
      displayName: "prod-web-1",
      paneId: "pane-a",
      sessionId: "session-a",
      targetId: "host-a",
    });
  });

  it("拒绝过期的 generation、session 和 target 绑定", () => {
    const original = snapshot();
    expect(isSnippetTargetSnapshotCurrent(original, snapshot())).toBe(true);
    expect(
      isSnippetTargetSnapshotCurrent(
        original,
        snapshot({ connectionGeneration: 5 }),
      ),
    ).toBe(false);
    expect(
      isSnippetTargetSnapshotCurrent(
        original,
        snapshot({
          record: {
            connectionGeneration: 5,
            remoteHostId: "host-b",
            sessionId: "session-b",
            target: "ssh",
          },
        }),
      ),
    ).toBe(false);
  });

  it("只读命令直接发送，敏感和变更命令进入确认", () => {
    expect(
      resolveSnippetExecutionPolicy({ risk: "inspect" }),
    ).toMatchObject({
      effectiveRisk: "inspect",
      requiresConfirmation: false,
      requiresStrongConfirmation: false,
    });
    expect(
      resolveSnippetExecutionPolicy({
        risk: "inspect",
        sensitive: true,
      }),
    ).toMatchObject({ requiresConfirmation: true });
    expect(
      resolveSnippetExecutionPolicy({ risk: "change" }),
    ).toMatchObject({ requiresConfirmation: true });
    expect(
      resolveSnippetExecutionPolicy({ risk: "unknown" }),
    ).toMatchObject({ requiresConfirmation: true });
  });

  it("破坏性命令保留目标名称强确认，旧 raw 片段提升为变更风险", () => {
    expect(
      resolveSnippetExecutionPolicy({
        risk: "destructive",
      }),
    ).toMatchObject({
      effectiveRisk: "destructive",
      requiresConfirmation: true,
      requiresStrongConfirmation: true,
    });
    expect(
      resolveSnippetExecutionPolicy({
        hasLegacyRaw: true,
        risk: "inspect",
      }),
    ).toMatchObject({ effectiveRisk: "change", requiresConfirmation: true });
  });
});
