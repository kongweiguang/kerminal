import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentWorkflowController } from "../../../../../src/features/agent-workflow";
import {
  archiveAgentSession,
  type AgentSessionRecord,
} from "../../../../../src/lib/agentLauncherApi";
import type { UserFacingMessage } from "../../../../../src/lib/userFacingMessage";
import { useAgentSessionDelete } from "../../../../../src/features/tool-panel/agent-launcher/useAgentSessionDelete";
import type { AgentTerminalSession } from "../../../../../src/features/tool-panel/agent-launcher/AgentTerminalView";

vi.mock("../../../../../src/lib/agentLauncherApi", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../../../src/lib/agentLauncherApi")>();
  return {
    ...actual,
    archiveAgentSession: vi.fn(),
  };
});

const runtimeSession: AgentTerminalSession = {
  agentId: "codex",
  agentSessionId: "agent-session-delete",
  args: [],
  commandLabel: "codex",
  cwd: "C:/workspace",
  permissionMode: "default",
  shell: "powershell.exe",
  status: "running",
  tabId: "tab-1",
  title: "待删除会话",
};

const persistedSession: AgentSessionRecord = {
  session: {
    agentId: "codex",
    agentSessionId: runtimeSession.agentSessionId,
    launch: {
      args: [],
      cwd: "C:/workspace",
      shell: "powershell.exe",
    },
    status: "active",
    title: runtimeSession.title,
  },
};

describe("useAgentSessionDelete", () => {
  beforeEach(() => {
    vi.mocked(archiveAgentSession).mockReset();
    vi.mocked(archiveAgentSession).mockResolvedValue({
      ...persistedSession,
      session: { ...persistedSession.session, status: "archived" },
    });
  });

  it("归档记录后同步清理当前会话、预览和侧栏映射", async () => {
    const cancelPreview = vi.fn();
    const refresh = vi.fn().mockResolvedValue(undefined);
    const onDeleted = vi.fn();
    const controller = {
      refresh,
    } as unknown as AgentWorkflowController;

    const { result } = renderHook(() => {
      const [runtimeSessions, setRuntimeSessions] = useState({
        [runtimeSession.agentSessionId]: runtimeSession,
      });
      const [persistedSessions, setPersistedSessions] = useState([
        persistedSession,
      ]);
      const [activeSessionIdByTabId, setActiveSessionIdByTabId] = useState<
        Record<string, string | undefined>
      >({
        "tab-1": runtimeSession.agentSessionId,
      });
      const [viewByTabId, setViewByTabId] = useState<
        Record<string, "launcher" | "terminal" | undefined>
      >({
        "tab-1": "terminal",
      });
      const [actionError, setActionError] =
        useState<UserFacingMessage | null>(null);
      const deletion = useAgentSessionDelete({
        activeSessionIdByTabId,
        cancelPreview,
        controller,
        onDeleted,
        preview: {
          byteLength: 4,
          createdAt: "2026-07-12T00:00:00.000Z",
          expiresAt: "2099-07-12T00:01:00.000Z",
          id: "preview-delete",
          kind: "selection",
          redacted: false,
          sessionId: runtimeSession.agentSessionId,
          text: "test",
          truncated: false,
        },
        setActionError,
        setActiveSessionIdByTabId,
        setPersistedSessions,
        setRuntimeSessions,
        setViewByTabId,
      });
      return {
        ...deletion,
        actionError,
        activeSessionIdByTabId,
        persistedSessions,
        runtimeSessions,
        viewByTabId,
      };
    });

    await act(async () => {
      expect(
        await result.current.deleteSession(runtimeSession.agentSessionId),
      ).toBe(true);
    });

    expect(archiveAgentSession).toHaveBeenCalledWith(
      runtimeSession.agentSessionId,
    );
    expect(cancelPreview).toHaveBeenCalledWith("preview-delete");
    expect(result.current.runtimeSessions).toEqual({});
    expect(result.current.persistedSessions).toEqual([]);
    expect(result.current.activeSessionIdByTabId).toEqual({});
    expect(result.current.viewByTabId).toEqual({ "tab-1": "launcher" });
    expect(result.current.actionError).toBeNull();
    expect(onDeleted).toHaveBeenCalledWith(runtimeSession.agentSessionId);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
