import { describe, expect, it } from "vitest";
import {
  adaptAgentPromptHistoryMetadata,
  adaptAgentPromptQueueMetadata,
  resolveAgentWorkflowBadge,
  resolveAgentWorkflowSessionSnapshot,
  truncateAgentWorkflowPreview,
} from "../../../../src/features/agent-workflow";

describe("agentWorkflowModel", () => {
  it("提供稳定的 badge 模型", () => {
    expect(resolveAgentWorkflowBadge("running")).toEqual({
      label: "运行中",
      status: "running",
      tone: "running",
    });
    expect(resolveAgentWorkflowBadge("failed").tone).toBe("danger");
    expect(resolveAgentWorkflowBadge("waitingForUser").tone).toBe("waiting");
  });

  it("不会在多字节字符中间产生损坏文本", () => {
    const result = truncateAgentWorkflowPreview("中文测试", 5);
    expect(result.truncated).toBe(true);
    expect(result.text).toBe("中");
    expect(result.byteLength).toBe(3);
  });

  it("将既有 queue/history 模型适配为无正文 metadata", () => {
    const queue = {
      createdAt: "2026-07-11T08:00:00.000Z",
      id: "queue-1",
      submit: true,
      text: "sensitive body",
    };
    const history = { ...queue, action: "selection" as const };

    expect(adaptAgentPromptQueueMetadata("agent-1", queue)).toEqual({
      createdAt: queue.createdAt,
      id: "queue-1",
      sessionId: "agent-1",
      submit: true,
      textBytes: 14,
    });
    expect(
      adaptAgentPromptHistoryMetadata("agent-1", history, "sent"),
    ).toMatchObject({
      action: "selection",
      outcome: "sent",
      textBytes: 14,
    });
    expect(
      JSON.stringify(adaptAgentPromptHistoryMetadata("agent-1", history, "sent")),
    ).not.toContain("sensitive body");
  });

  it("会话快照保留标题、目标和最近活动时间", () => {
    expect(
      resolveAgentWorkflowSessionSnapshot({
        record: {
          session: {
            agentId: "codex",
            agentSessionId: "ags-1",
            createdAt: "2026-07-11T08:00:00.000Z",
            launch: { args: [], cwd: "/workspace", shell: "codex" },
            status: "active",
            target: {
              cwd: "/srv/app",
              liveStatus: "ready",
              targetRef: "ssh:prod",
            },
            title: "生产排障",
            updatedAt: "2026-07-12T08:00:00.000Z",
          },
        },
      }),
    ).toMatchObject({
      agentSessionId: "ags-1",
      createdAt: "2026-07-11T08:00:00.000Z",
      target: {
        cwd: "/srv/app",
        liveStatus: "ready",
        targetRef: "ssh:prod",
      },
      title: "生产排障",
      updatedAt: "2026-07-12T08:00:00.000Z",
    });
  });
});
