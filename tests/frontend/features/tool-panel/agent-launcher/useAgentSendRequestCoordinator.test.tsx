import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createAgentSendRequestStore,
  type AgentSendRequestStore,
  useAgentSendRequestSnapshot,
} from "../../../../../src/features/agent-workflow/agentSendRequestStore";
import { useAgentSendRequestCoordinator } from "../../../../../src/features/tool-panel/agent-launcher/useAgentSendRequestCoordinator";
import type { AgentTerminalSession } from "../../../../../src/features/tool-panel/agent-launcher/AgentTerminalView";
import type {
  TerminalPane,
  TerminalTab,
} from "../../../../../src/features/workspace/types";

const activeTab = {
  id: "tab-1",
  title: "生产终端",
} as TerminalTab;
const targetPane = {
  id: "pane-1",
  title: "prod-api",
} as TerminalPane;
const session: AgentTerminalSession = {
  agentId: "codex",
  agentSessionId: "agent-session-1",
  args: [],
  commandLabel: "codex",
  cwd: "C:/workspace",
  permissionMode: "default",
  shell: "powershell.exe",
  status: "running",
  tabId: "tab-1",
  target: {
    paneId: "pane-1",
    tabId: "tab-1",
  },
  title: "Codex",
};

describe("useAgentSendRequestCoordinator", () => {
  let store: AgentSendRequestStore;

  beforeEach(() => {
    store = createAgentSendRequestStore();
  });

  it("activates the matching session and creates a preview", async () => {
    const createPreview = vi.fn(() => true);
    const onActivateSession = vi.fn();
    const setActionError = vi.fn();

    renderHook(() => {
      const request = useAgentSendRequestSnapshot(store).request;
      useAgentSendRequestCoordinator({
        activeTab,
        agentScopeId: "tab-1",
        createPreview,
        consumeRequest: store.consume,
        onActivateSession,
        request,
        sessions: [session],
        setActionError,
        targetPane,
      });
    });

    act(() => {
      store.request({
        paneId: "pane-1",
        source: "selection",
        tabId: "tab-1",
      });
    });

    await waitFor(() => {
      expect(createPreview).toHaveBeenCalledWith("selection", {
        activeTab,
        focusedPane: targetPane,
        session,
      });
    });
    expect(onActivateSession).toHaveBeenCalledWith(
      "tab-1",
      "agent-session-1",
    );
    expect(store.getSnapshot().request).toBeNull();
  });

  it("routes another pane in the same tab into that tab's active assistant", async () => {
    const paneB = { ...targetPane, id: "pane-2", title: "prod-worker" };
    const createPreview = vi.fn(() => true);
    const onActivateSession = vi.fn();

    renderHook(() => {
      const request = useAgentSendRequestSnapshot(store).request;
      useAgentSendRequestCoordinator({
        activeTab,
        agentScopeId: "tab-1",
        createPreview,
        consumeRequest: store.consume,
        onActivateSession,
        request,
        sessions: [session],
        setActionError: vi.fn(),
        targetPane: paneB,
      });
    });

    act(() => {
      store.request({
        paneId: "pane-2",
        source: "context",
        tabId: "tab-1",
      });
    });

    await waitFor(() =>
      expect(createPreview).toHaveBeenCalledWith(
        "context",
        expect.objectContaining({ focusedPane: paneB, session }),
      ),
    );
    expect(onActivateSession).toHaveBeenCalledWith(
      "tab-1",
      "agent-session-1",
    );
  });

  it("优先把内容发送到当前正在查看的 Agent 会话", async () => {
    const historicalSession = {
      ...session,
      agentSessionId: "agent-session-history",
    };
    const currentSession = {
      ...session,
      agentSessionId: "agent-session-current",
    };
    const createPreview = vi.fn(() => true);
    const onActivateSession = vi.fn();

    renderHook(() => {
      const request = useAgentSendRequestSnapshot(store).request;
      useAgentSendRequestCoordinator({
        activeTab,
        agentScopeId: "tab-1",
        createPreview,
        consumeRequest: store.consume,
        onActivateSession,
        preferredSessionId: currentSession.agentSessionId,
        request,
        sessions: [historicalSession, currentSession],
        setActionError: vi.fn(),
        targetPane,
      });
    });

    act(() => {
      store.request({
        paneId: "pane-1",
        source: "selection",
        tabId: "tab-1",
      });
    });

    await waitFor(() =>
      expect(createPreview).toHaveBeenCalledWith(
        "selection",
        expect.objectContaining({ session: currentSession }),
      ),
    );
    expect(onActivateSession).toHaveBeenCalledWith(
      "tab-1",
      currentSession.agentSessionId,
    );
  });

  it("存在多个历史会话且没有当前会话时不自动选择", async () => {
    const createPreview = vi.fn(() => true);
    const onActivateSession = vi.fn();

    renderHook(() => {
      const request = useAgentSendRequestSnapshot(store).request;
      useAgentSendRequestCoordinator({
        activeTab,
        agentScopeId: "tab-1",
        createPreview,
        consumeRequest: store.consume,
        onActivateSession,
        request,
        sessions: [
          session,
          { ...session, agentSessionId: "agent-session-history" },
        ],
        setActionError: vi.fn(),
        targetPane,
      });
    });

    act(() => {
      store.request({
        paneId: "pane-1",
        source: "context",
        tabId: "tab-1",
      });
    });

    await waitFor(() =>
      expect(store.getSnapshot().request).not.toBeNull(),
    );
    expect(createPreview).not.toHaveBeenCalled();
    expect(onActivateSession).not.toHaveBeenCalled();
  });

  it("keeps the short-lived request while waiting for a matching conversation", async () => {
    const setActionError = vi.fn();

    renderHook(() => {
      const request = useAgentSendRequestSnapshot(store).request;
      useAgentSendRequestCoordinator({
        activeTab,
        agentScopeId: "tab-1",
        createPreview: vi.fn(() => true),
        consumeRequest: store.consume,
        onActivateSession: vi.fn(),
        request,
        sessions: [],
        setActionError,
        targetPane,
      });
    });

    act(() => {
      store.request({
        paneId: "pane-1",
        source: "context",
        tabId: "tab-1",
      });
    });

    await waitFor(() => expect(setActionError).toHaveBeenCalledWith(null));
    expect(store.getSnapshot().request).toMatchObject({
      paneId: "pane-1",
      source: "context",
      tabId: "tab-1",
    });
  });

  it("does not route a request into an unbound conversation", async () => {
    const createPreview = vi.fn(() => true);
    const onActivateSession = vi.fn();
    const setActionError = vi.fn();
    const unboundSession = {
      ...session,
      agentSessionId: "agent-session-unbound",
      target: undefined,
    };

    renderHook(() => {
      const request = useAgentSendRequestSnapshot(store).request;
      useAgentSendRequestCoordinator({
        activeTab,
        agentScopeId: "tab-1",
        createPreview,
        consumeRequest: store.consume,
        onActivateSession,
        request,
        sessions: [unboundSession],
        setActionError,
        targetPane,
      });
    });

    act(() => {
      store.request({
        paneId: "pane-1",
        source: "selection",
        tabId: "tab-1",
      });
    });

    await waitFor(() => expect(setActionError).toHaveBeenCalledWith(null));
    expect(createPreview).not.toHaveBeenCalled();
    expect(onActivateSession).not.toHaveBeenCalled();
    expect(store.getSnapshot().request).not.toBeNull();
  });

  it("cancels the request when the user leaves its source tab", async () => {
    const createPreview = vi.fn(() => true);
    const onActivateSession = vi.fn();
    const setActionError = vi.fn();
    const otherTab = { id: "tab-2", title: "其他终端" } as TerminalTab;

    renderHook(() => {
      const request = useAgentSendRequestSnapshot(store).request;
      useAgentSendRequestCoordinator({
        activeTab: otherTab,
        agentScopeId: "tab-2",
        createPreview,
        consumeRequest: store.consume,
        onActivateSession,
        request,
        sessions: [session],
        setActionError,
        targetPane,
      });
    });

    act(() => {
      store.request({
        paneId: "pane-1",
        source: "context",
        tabId: "tab-1",
      });
    });

    await waitFor(() => {
      expect(setActionError).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "发送请求已取消",
        }),
      );
    });
    expect(createPreview).not.toHaveBeenCalled();
    expect(onActivateSession).not.toHaveBeenCalled();
    expect(store.getSnapshot().request).toBeNull();
  });

  it("keeps preview failures visible instead of opening the terminal view", async () => {
    const createPreview = vi.fn(() => false);
    const onActivateSession = vi.fn();

    renderHook(() => {
      const request = useAgentSendRequestSnapshot(store).request;
      useAgentSendRequestCoordinator({
        activeTab,
        agentScopeId: "tab-1",
        createPreview,
        consumeRequest: store.consume,
        onActivateSession,
        request,
        sessions: [session],
        setActionError: vi.fn(),
        targetPane,
      });
    });

    act(() => {
      store.request({
        paneId: "pane-1",
        source: "selection",
        tabId: "tab-1",
      });
    });

    await waitFor(() => {
      expect(createPreview).toHaveBeenCalled();
    });
    expect(onActivateSession).not.toHaveBeenCalled();
    expect(store.getSnapshot().request).toBeNull();
  });
});
