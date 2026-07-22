import "@testing-library/jest-dom/vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ContextInspectorToolContent } from "../../../../../src/features/tool-panel/context-inspector";
import type { WorkspaceContextProjection } from "../../../../../src/features/workspace/context";

const agentApiMocks = vi.hoisted(() => ({
  listAgentSessions: vi.fn(),
}));

vi.mock("../../../../../src/lib/agentLauncherApi", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../../../../src/lib/agentLauncherApi")
  >()),
  listAgentSessions: agentApiMocks.listAgentSessions,
}));

function context(
  overrides: Partial<WorkspaceContextProjection> = {},
): WorkspaceContextProjection {
  return {
    schemaVersion: 1,
    revision: 7,
    generatedAt: "2026-07-11T08:00:00.000Z",
    activeTabId: "tab-1",
    focusedPaneId: "pane-1",
    machine: {
      id: "host-1",
      name: "Production API",
      kind: "ssh",
      status: "online",
      production: true,
      groupId: "group-1",
    },
    target: {
      id: "host-1",
      kind: "ssh",
      label: "api.example.test",
      production: true,
      hostLabel: "api.example.test",
    },
    location: {
      cwd: "/srv/app/a-very-long-directory-name-that-must-wrap",
      cwdSource: "osc7",
      pathStyle: "posix",
      confidence: "medium",
    },
    subject: {
      kind: "terminalPane",
      id: "pane-1",
      title: "API shell",
    },
    resources: {
      tabs: [{ id: "tab-1", title: "API", kind: "terminal", active: true }],
      panes: [
        {
          id: "pane-1",
          title: "shell",
          machineId: "host-1",
          mode: "ssh",
          status: "online",
          focused: true,
        },
      ],
      activeTabPaneIds: ["pane-1"],
      workspaceFileCount: 2,
      dirtyWorkspaceFileCount: 1,
      sftpRevealRequest: null,
    },
    runtime: {
      connectionStatus: "online",
      paneMode: "ssh",
      latencyMs: 28,
      tmuxAttached: false,
    },
    agent: { sessionId: null, status: "unavailable" },
    freshness: {
      state: "partial",
      sources: [
        { source: "workspace", status: "available", revision: 7 },
        { source: "runtime", status: "error", diagnosticId: "runtime-error" },
      ],
    },
    diagnostics: [
      {
        id: "runtime-error",
        code: "source-error",
        severity: "warning",
        summary: "运行态暂时不可用，已保留其它上下文。",
        source: "runtime",
        recoverable: true,
      },
    ],
    ...overrides,
  };
}

describe("ContextInspectorToolContent", () => {
  beforeEach(() => {
    agentApiMocks.listAgentSessions.mockReset();
    agentApiMocks.listAgentSessions.mockResolvedValue({
      diagnostics: [],
      sessions: [],
    });
  });

  it("优先展示摘要，并在展开后保留全部只读分区", async () => {
    const user = userEvent.setup();
    render(<ContextInspectorToolContent context={context()} />);

    const summary = screen.getByRole("region", { name: "当前上下文摘要" });
    expect(within(summary).getByText("当前目标")).toBeVisible();
    expect(within(summary).getByText("当前目录")).toBeVisible();
    expect(screen.getByText("需要注意")).toBeVisible();

    await user.click(screen.getByText("工作区详情"));
    await user.click(screen.getByText("技术状态"));

    for (const heading of [
      "机器",
      "目标",
      "页签与窗格",
      "位置",
      "资源",
      "运行态",
      "Agent",
      "新鲜度",
      "诊断",
    ]) {
      expect(screen.getByRole("heading", { name: heading })).toBeVisible();
    }
    const diagnostics = screen.getAllByText(
      "运行态暂时不可用，已保留其它上下文。",
    );
    expect(diagnostics[diagnostics.length - 1]).toBeVisible();
    expect(screen.getAllByText("生产目标")).toHaveLength(2);
  });

  it("动作和可用跳转只转发稳定 id", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    const onNavigate = vi.fn();
    render(
      <ContextInspectorToolContent
        actions={[
          {
            id: "terminal.split",
            title: "拆分终端",
            effect: "local",
            available: true,
            priority: 10,
          },
        ]}
        context={context()}
        isNavigationAvailable={(navigationId) =>
          navigationId.startsWith("location:")
        }
        onAction={onAction}
        onNavigate={onNavigate}
      />,
    );

    await user.click(screen.getByRole("button", { name: "拆分终端" }));
    const summary = screen.getByRole("region", { name: "当前上下文摘要" });
    await user.click(within(summary).getByRole("button", { name: /当前目录/ }));

    expect(onAction).toHaveBeenCalledWith("terminal.split");
    expect(onNavigate).toHaveBeenCalledWith(
      "location:/srv/app/a-very-long-directory-name-that-must-wrap",
    );
  });

  it("未被集成层支持的 navigationId 只显示为只读文本", async () => {
    const user = userEvent.setup();
    render(
      <ContextInspectorToolContent
        context={context()}
        isNavigationAvailable={(navigationId) =>
          navigationId.startsWith("tab:")
        }
        onNavigate={vi.fn()}
      />,
    );

    await user.click(screen.getByText("工作区详情"));
    expect(screen.getByRole("button", { name: /活动页签/ })).toBeVisible();
    expect(screen.queryByRole("button", { name: /当前目录/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /焦点窗格/ })).toBeNull();
    expect(
      screen.getAllByText(
        "/srv/app/a-very-long-directory-name-that-must-wrap",
      ),
    ).toHaveLength(2);
  });

  it("disabled action 不触发回调且显示原因", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    render(
      <ContextInspectorToolContent
        actions={[
          {
            id: "remote.stop",
            title: "停止服务",
            effect: "remote",
            available: false,
            disabledReason: "需要现有确认流程",
          },
        ]}
        context={context()}
        onAction={onAction}
      />,
    );

    const button = screen.getByRole("button", { name: "停止服务" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", "需要现有确认流程");
    await user.click(button);
    expect(onAction).not.toHaveBeenCalled();
  });

  it("autoFocus、Home 和 End 使用稳定焦点顺序", () => {
    render(
      <ContextInspectorToolContent
        actions={[
          {
            id: "first",
            title: "首个动作",
            effect: "read",
            available: true,
          },
        ]}
        autoFocus
        context={context()}
        isNavigationAvailable={() => true}
        onNavigate={() => undefined}
      />,
    );

    const first = screen.getByRole("button", { name: "首个动作" });
    const summary = screen.getByRole("region", { name: "当前上下文摘要" });
    const currentDirectory = within(summary).getByRole("button", {
      name: /当前目录/,
    });
    expect(first).toHaveFocus();
    fireEvent.keyDown(first, { key: "End" });
    expect(currentDirectory).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: "Home" });
    expect(first).toHaveFocus();
  });

  it("首屏显示当前 pane 的真实 Agent 会话且不回退到其它会话", async () => {
    agentApiMocks.listAgentSessions.mockResolvedValue({
      diagnostics: [],
      sessions: [
        {
          session: {
            agentSessionId: "agent-other",
            agentId: "claude",
            title: "其它目标会话",
            status: "active",
            launch: { args: [], cwd: "/tmp", shell: "claude" },
            target: { paneId: "pane-other", tabId: "tab-other" },
          },
        },
        {
          session: {
            agentSessionId: "agent-unbound",
            agentId: "codex",
            title: "未绑定会话",
            status: "active",
            launch: { args: [], cwd: "/tmp", shell: "codex" },
          },
        },
        {
          session: {
            agentSessionId: "agent-current",
            agentId: "codex",
            title: "API 故障排查",
            status: "active",
            updatedAt: "2026-07-12T01:00:00.000Z",
            launch: { args: [], cwd: "/srv/app", shell: "codex" },
            target: { paneId: "pane-1", tabId: "tab-1", liveStatus: "ready" },
          },
        },
      ],
    });

    render(<ContextInspectorToolContent context={context()} />);

    const summary = screen.getByRole("region", { name: "当前上下文摘要" });
    await waitFor(() => {
      expect(within(summary).getByText("API 故障排查 · 进行中")).toBeVisible();
    });
    expect(within(summary).queryByText("其它目标会话")).not.toBeInTheDocument();
    expect(within(summary).queryByText("未绑定会话")).not.toBeInTheDocument();
  });

  it("提醒按 error、warning、info 排序并使用错误语义样式", () => {
    render(
      <ContextInspectorToolContent
        context={context({
          diagnostics: [
            {
              id: "info-first",
              code: "source-loading",
              severity: "info",
              summary: "正在刷新运行态。",
              source: "runtime",
              recoverable: true,
            },
            {
              id: "warning-second",
              code: "source-stale",
              severity: "warning",
              summary: "终端快照较旧。",
              source: "terminal",
              recoverable: true,
            },
            {
              id: "error-last",
              code: "source-error",
              severity: "error",
              summary: "当前目标连接失败。",
              source: "workspace",
              recoverable: true,
            },
          ],
        })}
      />,
    );

    const alert = screen.getByRole("alert", { name: "上下文提醒" });
    expect(within(alert).getByText("需要处理")).toBeVisible();
    expect(within(alert).getByText("当前目标连接失败。")).toBeVisible();
    expect(alert).toHaveAttribute("data-tone", "danger");
    expect(within(alert).queryByText("正在刷新运行态。")).not.toBeInTheDocument();
  });
});
