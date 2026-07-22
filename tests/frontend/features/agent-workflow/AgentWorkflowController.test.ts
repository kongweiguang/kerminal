import { describe, expect, it, vi } from "vitest";
import type { AgentSessionRecord } from "../../../../src/lib/agentLauncherApi";
import type { TerminalAgentSignal } from "../../../../src/lib/terminalApi";
import {
  AgentWorkflowController,
  type AgentWorkflowPromptRequest,
  type AgentWorkflowTerminalSignalPort,
} from "../../../../src/features/agent-workflow";

function session(
  id: string,
  status: "active" | "archived" | "stale" = "active",
): AgentSessionRecord {
  return {
    session: {
      agentId: "codex",
      agentSessionId: id,
      launch: { args: [], cwd: "C:/repo", shell: "codex" },
      status,
      title: `Session ${id}`,
    },
  };
}

function signalPort() {
  let listener: ((signal: TerminalAgentSignal) => void) | undefined;
  const unsubscribe = vi.fn();
  const port: AgentWorkflowTerminalSignalPort = {
    subscribe(next) {
      listener = next;
      return unsubscribe;
    },
  };
  return {
    emit(signal: TerminalAgentSignal) {
      listener?.(signal);
    },
    port,
    unsubscribe,
  };
}

function harness(records: AgentSessionRecord[] = [session("agent-1")]) {
  let now = new Date("2026-07-11T08:00:00.000Z");
  const signals = signalPort();
  const sent: AgentWorkflowPromptRequest[] = [];
  const controller = new AgentWorkflowController(
    { listSessions: vi.fn().mockResolvedValue(records) },
    signals.port,
    {
      async send(request) {
        sent.push(request);
        return { accepted: true, transportId: "transport-1" };
      },
    },
    { now: () => now, previewTtlMs: 1_000 },
  );
  return {
    advance(ms: number) {
      now = new Date(now.getTime() + ms);
    },
    controller,
    sent,
    signals,
  };
}

describe("AgentWorkflowController", () => {
  it("按归档、终端信号、repository 的顺序解决来源冲突", async () => {
    const active = harness([
      session("active"),
      session("archived", "archived"),
    ]);
    await active.controller.refresh();
    active.signals.emit({
      agent: "codex",
      agentSessionId: "active",
      status: "attention",
      terminalSessionId: "terminal-active",
    });
    active.signals.emit({
      agent: "codex",
      agentSessionId: "archived",
      status: "working",
      terminalSessionId: "terminal-archived",
    });

    expect(active.controller.getSnapshot().sessions).toMatchObject([
      { runtimeStatus: "waitingForUser", statusSource: "terminalSignal" },
      { runtimeStatus: "done", statusSource: "repository" },
    ]);
  });

  it("刷新成功清除 stale，失败时保留旧快照并标记 stale", async () => {
    const signals = signalPort();
    const listSessions = vi
      .fn()
      .mockResolvedValueOnce([session("agent-1")])
      .mockRejectedValueOnce(new Error("offline"));
    const controller = new AgentWorkflowController(
      { listSessions },
      signals.port,
      { send: vi.fn() },
    );

    await controller.refresh();
    expect(controller.getSnapshot()).toMatchObject({
      errorCode: undefined,
      loading: false,
      stale: false,
    });
    await controller.refresh();
    expect(controller.getSnapshot()).toMatchObject({
      errorCode: "repository-refresh-failed",
      sessions: [{ agentSessionId: "agent-1", runtimeStatus: "stale" }],
      stale: true,
    });
  });

  it("typed terminal signal 更新 badge 所需的派生状态", async () => {
    const test = harness();
    await test.controller.refresh();
    test.signals.emit({
      agent: "codex",
      agentSessionId: "agent-1",
      status: "finished",
      terminalSessionId: "terminal-1",
    });
    expect(test.controller.getSnapshot().sessions[0]).toMatchObject({
      runtimeStatus: "done",
      terminalSessionId: "terminal-1",
    });
  });

  it("预览仅在确认时发送，并支持取消与过期", async () => {
    const test = harness();
    const confirmed = test.controller.createSendPreview({
      kind: "selection",
      sessionId: "agent-1",
      text: "inspect this",
    });
    await expect(
      test.controller.confirmSendPreview(confirmed.id),
    ).resolves.toEqual({
      outcome: "sent",
      transportId: "transport-1",
    });
    expect(test.sent).toEqual([
      { sessionId: "agent-1", submit: true, text: "inspect this" },
    ]);

    const cancelled = test.controller.createSendPreview({
      kind: "diagnostic",
      sessionId: "agent-1",
      text: "cancel me",
    });
    expect(test.controller.cancelSendPreview(cancelled.id)).toEqual({
      outcome: "cancelled",
    });
    expect(test.sent).toHaveLength(1);

    const expired = test.controller.createSendPreview({
      kind: "artifact",
      sessionId: "agent-1",
      text: "expire me",
    });
    test.advance(1_000);
    await expect(
      test.controller.confirmSendPreview(expired.id),
    ).resolves.toEqual({
      outcome: "expired",
    });
    expect(test.sent).toHaveLength(1);

    expect(test.controller.getHistoryMetadata()).toMatchObject([
      {
        action: "context",
        outcome: "expired",
        previewKind: "artifact",
      },
      {
        action: "context",
        outcome: "cancelled",
        previewKind: "diagnostic",
      },
      {
        action: "selection",
        outcome: "sent",
        previewKind: "selection",
      },
    ]);
  });

  it("排队发送保留 preview kind，并使用 queued action/outcome", async () => {
    const test = harness();
    const preview = test.controller.createSendPreview({
      kind: "commandBlock",
      sessionId: "agent-1",
      text: "echo queued",
    });

    await expect(
      test.controller.confirmSendPreview(preview.id, false),
    ).resolves.toEqual({
      outcome: "sent",
      transportId: "transport-1",
    });
    expect(test.controller.getHistoryMetadata()).toMatchObject([
      {
        action: "queued",
        outcome: "queued",
        previewKind: "commandBlock",
        submit: false,
      },
    ]);
  });

  it("dispose 会中止 pending send，迟到完成不得写回 metadata", async () => {
    const signals = signalPort();
    let resolveSend:
      | ((result: { accepted: boolean; transportId?: string }) => void)
      | undefined;
    let observedSignal: AbortSignal | undefined;
    const controller = new AgentWorkflowController(
      { listSessions: vi.fn().mockResolvedValue([]) },
      signals.port,
      {
        send(_request, context) {
          observedSignal = context?.signal;
          return new Promise((resolve) => {
            resolveSend = resolve;
          });
        },
      },
    );
    const preview = controller.createSendPreview({
      kind: "selection",
      sessionId: "agent-1",
      text: "pending secret body",
    });
    const resolution = controller.confirmSendPreview(preview.id);

    controller.dispose();
    expect(observedSignal?.aborted).toBe(true);
    resolveSend?.({ accepted: true, transportId: "late" });

    await expect(resolution).resolves.toEqual({ outcome: "cancelled" });
    expect(controller.getHistoryMetadata()).toEqual([]);
    expect(controller.getSnapshot()).toMatchObject({
      disposed: true,
      sessions: [],
    });
  });

  it("queue/history metadata 按明确容量淘汰旧记录", async () => {
    const signals = signalPort();
    const controller = new AgentWorkflowController(
      { listSessions: vi.fn().mockResolvedValue([]) },
      signals.port,
      {
        async send() {
          return { accepted: true };
        },
      },
      { historyMetadataLimit: 2, queueMetadataLimit: 2 },
    );

    for (let index = 1; index <= 3; index += 1) {
      controller.recordQueueMetadata({
        createdAt: `2026-07-11T08:00:0${index}.000Z`,
        id: `queue-${index}`,
        sessionId: "agent-1",
        submit: true,
        textBytes: index,
      });
      const preview = controller.createSendPreview({
        kind: "selection",
        sessionId: "agent-1",
        text: `body-${index}`,
      });
      await controller.confirmSendPreview(preview.id);
    }

    expect(controller.getQueueMetadata().map((item) => item.id)).toEqual([
      "queue-2",
      "queue-3",
    ]);
    expect(controller.getHistoryMetadata().map((item) => item.id)).toEqual([
      "agent-workflow-preview-3",
      "agent-workflow-preview-2",
    ]);
    expect(JSON.stringify(controller.getHistoryMetadata())).not.toContain(
      "body-",
    );
  });

  it("queue/history metadata 变化会发布不含正文的新快照", async () => {
    const test = harness();
    const snapshots = vi.fn();
    test.controller.subscribe(snapshots);

    test.controller.recordQueueMetadata({
      createdAt: "2026-07-11T08:00:00.000Z",
      id: "queue-1",
      sessionId: "agent-1",
      submit: true,
      textBytes: 11,
    });
    const preview = test.controller.createSendPreview({
      kind: "selection",
      sessionId: "agent-1",
      text: "private prompt body",
    });
    await test.controller.confirmSendPreview(preview.id);

    expect(snapshots).toHaveBeenCalledTimes(2);
    const snapshot = test.controller.getSnapshot();
    expect(snapshot.queueMetadata).toHaveLength(1);
    expect(snapshot.historyMetadata).toMatchObject([
      { action: "selection", outcome: "sent", textBytes: 19 },
    ]);
    expect(JSON.stringify(snapshot)).not.toContain("private prompt body");
  });

  it("发送预览执行基础脱敏并按 UTF-8 32KiB 边界截断", () => {
    const test = harness();
    const preview = test.controller.createSendPreview({
      kind: "commandBlock",
      sessionId: "agent-1",
      text: `password=hunter2\nBearer abc.def.ghi\nsk-${"a".repeat(40)}\n${"中".repeat(20_000)}`,
    });

    expect(preview.text).not.toContain("hunter2");
    expect(preview.text).not.toContain("abc.def.ghi");
    expect(preview.text).not.toContain(`sk-${"a".repeat(40)}`);
    expect(preview.redacted).toBe(true);
    expect(preview.truncated).toBe(true);
    expect(new TextEncoder().encode(preview.text).length).toBeLessThanOrEqual(
      32 * 1024,
    );
  });

  it("queue/history 只保留 metadata，dispose 清理并停止接收 signal", async () => {
    const test = harness();
    await test.controller.refresh();
    test.controller.recordQueueMetadata({
      createdAt: "2026-07-11T08:00:00.000Z",
      id: "queue-1",
      sessionId: "agent-1",
      submit: true,
      textBytes: 128,
    });
    const preview = test.controller.createSendPreview({
      kind: "selection",
      sessionId: "agent-1",
      text: "secret body",
    });
    await test.controller.confirmSendPreview(preview.id);

    expect(JSON.stringify(test.controller.getQueueMetadata())).not.toContain(
      "secret body",
    );
    expect(JSON.stringify(test.controller.getHistoryMetadata())).not.toContain(
      "secret body",
    );

    test.controller.dispose();
    expect(test.signals.unsubscribe).toHaveBeenCalledOnce();
    expect(test.controller.getSnapshot()).toMatchObject({
      disposed: true,
      sessions: [],
      stale: true,
    });
    expect(test.controller.getQueueMetadata()).toEqual([]);
    expect(test.controller.getHistoryMetadata()).toEqual([]);
    expect(() =>
      test.controller.createSendPreview({
        kind: "selection",
        sessionId: "agent-1",
        text: "after dispose",
      }),
    ).toThrow(/disposed/);
  });
});
