// @author kongweiguang
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExternalAgentId, ExternalAgentWorkspaceStatus } from "../../../../src/lib/agentLauncherApi";import { unregisterTestTerminalPaneSessions } from "../../support/terminalSessionRegistry.testSupport";
import { tools } from "../../../../src/features/workspace/workspaceData";
import { AgentLauncherToolContent } from "../../../../src/features/tool-panel/AgentLauncherToolContent";
import { ToolPanel } from "../../../../src/features/tool-panel/ToolPanel";

const apiMocks = vi.hoisted(() => ({
  archiveAgentSession: vi.fn(),
  createAgentSession: vi.fn(),
  getExternalAgentWorkspaceStatus: vi.fn(),
  listAgentSessions: vi.fn(),
  prepareExternalAgentWorkspace: vi.fn(),
  rebindAgentSessionTarget: vi.fn(),
  updateAgentSession: vi.fn(),
}));

const terminalMocks = vi.hoisted(() => ({
  renderXtermPane: vi.fn(),
}));

const notificationMocks = vi.hoisted(() => ({
  currentDesktopNotificationVisibility: vi.fn(),
  sendDesktopNotification: vi.fn(),
}));

vi.mock("../../../../src/lib/agentLauncherApi", () => ({
  archiveAgentSession: (...args: unknown[]) =>
    apiMocks.archiveAgentSession(...args),
  agentSessionRecordAgentId: (record: {
    session: { agentId?: string; agent_id?: string };
  }) => record.session.agentId ?? record.session.agent_id,
  agentSessionRecordId: (record: { session: { agentSessionId?: string; agent_session_id?: string } }) =>
    record.session.agentSessionId ?? record.session.agent_session_id,
  agentSessionRecordStatus: (record: { session: { status?: string } }) =>
    record.session.status ?? "active",
  agentSessionRecordTarget: (record: { session: { target?: unknown } }) =>
    record.session.target,
  createAgentSession: (...args: unknown[]) =>
    apiMocks.createAgentSession(...args),
  getExternalAgentWorkspaceStatus: (...args: unknown[]) =>
    apiMocks.getExternalAgentWorkspaceStatus(...args),
  listAgentSessions: (...args: unknown[]) =>
    apiMocks.listAgentSessions(...args),
  prepareExternalAgentWorkspace: (...args: unknown[]) =>
    apiMocks.prepareExternalAgentWorkspace(...args),
  rebindAgentSessionTarget: (...args: unknown[]) =>
    apiMocks.rebindAgentSessionTarget(...args),
  updateAgentSession: (...args: unknown[]) =>
    apiMocks.updateAgentSession(...args),
}));

vi.mock("../../../../src/lib/fileDialogApi", () => ({
  openLocalDirectory: vi.fn(),
}));

vi.mock("../../../../src/lib/desktopNotificationApi", () => ({
  currentDesktopNotificationVisibility: () =>
    notificationMocks.currentDesktopNotificationVisibility(),
  sendDesktopNotification: (...args: unknown[]) =>
    notificationMocks.sendDesktopNotification(...args),
}));

vi.mock("../../../../src/features/terminal/XtermPane", () => ({
  XtermPane: (props: {
    args?: string[];
    cwd?: string;
    focused?: boolean;
    inputCompatibilityMode?: string;
    paneId?: string;
    shell?: string;
    shellAssistEnabled?: boolean;
    startupMessage?: string;
    title: string;
    transientStartupMessage?: boolean;
    onAgentSignal?: (signal: {
      agent: "codex" | "claude" | "gemini";
      agentSessionId?: string;
      status: "working" | "attention" | "finished" | "exited";
      terminalSessionId: string;
    }) => void;
    onSessionFinished?: (event: { durationMs: number; sessionId: string }) => void;
  }) => {
    terminalMocks.renderXtermPane(props);
    return (
      <div
        data-args={(props.args ?? []).join(" ")}
        data-cwd={props.cwd}
        data-focused={String(props.focused)}
        data-input-compatibility-mode={props.inputCompatibilityMode}
        data-pane-id={props.paneId}
        data-shell={props.shell}
        data-shell-assist-enabled={String(props.shellAssistEnabled)}
        data-startup-message={props.startupMessage}
        data-testid="agent-xterm"
        data-transient-startup-message={String(props.transientStartupMessage)}
      >
        {props.title}
      </div>
    );
  },
}));
vi.mock("../../../../src/features/logs/LogToolContent", () => ({
  LogToolContent: () => <div data-testid="logs-tool">Logs tool</div>,
}));

describe("AgentLauncherToolContent", () => {
  beforeEach(() => {
    apiMocks.archiveAgentSession.mockReset();
    apiMocks.createAgentSession.mockReset();
    apiMocks.getExternalAgentWorkspaceStatus.mockReset();
    apiMocks.listAgentSessions.mockReset();
    apiMocks.prepareExternalAgentWorkspace.mockReset();
    apiMocks.rebindAgentSessionTarget.mockReset();
    apiMocks.updateAgentSession.mockReset();
    terminalMocks.renderXtermPane.mockClear();
    notificationMocks.currentDesktopNotificationVisibility.mockReset();
    notificationMocks.sendDesktopNotification.mockReset();
    notificationMocks.currentDesktopNotificationVisibility.mockReturnValue(
      "hidden",
    );
    notificationMocks.sendDesktopNotification.mockResolvedValue({
      reason: "will-send",
      requestedPermission: false,
      sent: true,
    });
    unregisterTestTerminalPaneSessions();
    apiMocks.getExternalAgentWorkspaceStatus.mockResolvedValue(workspaceStatus());
    apiMocks.listAgentSessions.mockResolvedValue({
      diagnostics: [],
      sessions: [],
    });
    apiMocks.archiveAgentSession.mockResolvedValue({
      session: {
        agentSessionId: "ags-archived",
        launch: { args: [], cwd: "", shell: "" },
        status: "archived",
        title: "Archived",
      },
    });
    apiMocks.updateAgentSession.mockImplementation(
      async (agentSessionId: string, request: { title?: string }) => ({
        session: {
          agentId: "codex",
          agentSessionId,
          launch: { args: [], cwd: "", shell: "codex" },
          status: "active",
          title: request.title ?? "Codex",
        },
      }),
    );
    apiMocks.createAgentSession.mockImplementation(
      async ({
        agentId,
        target,
      }: {
        agentId: string;
        target?: unknown;
      }) => ({
        session: {
          agentId,
          agentSessionId: `ags-${agentId}`,
          launch: {
            args: [],
            commandLabel: agentId,
            cwd: `C:/Users/me/.kerminal/agents/sessions/ags-${agentId}`,
            shell: agentId,
          },
          sessionRoot: `C:/Users/me/.kerminal/agents/sessions/ags-${agentId}`,
          target,
          title: agentId === "claude" ? "Claude" : agentId === "custom" ? "Custom" : "Codex",
          workspaceRoot: "C:/Users/me/.kerminal",
        },
      }),
    );
    apiMocks.prepareExternalAgentWorkspace.mockImplementation(
      async (request: {
        agentId: ExternalAgentId;
        agentSessionId: string;
        customCommand?: string;
      }) => {
        const command = request.customCommand ?? request.agentId;
        const title =
          request.agentId === "claude"
            ? "Claude"
            : request.agentId === "custom"
              ? "Custom"
              : "Codex";
        return {
          agentId: request.agentId,
          agentSessionId: request.agentSessionId,
          args: [
            "-NoLogo",
            "-NoProfile",
            "-NoExit",
            "-Command",
            command,
          ],
          cwd: `C:/Users/me/.kerminal/agents/sessions/${request.agentSessionId}`,
          env: {
            KERMINAL_AGENT_SESSION_ID: request.agentSessionId,
            KERMINAL_MCP_ENDPOINT: `http://127.0.0.1:37657/mcp/agents/${request.agentSessionId}`,
          },
          message: `${title} workspace prepared.`,
          shell: "pwsh.exe",
          title,
        };
      },
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("removes the mounted agent terminal when its workspace tab closes", async () => {
    const user = userEvent.setup();
    const tabA = terminalTab("tab-a");
    const tabB = terminalTab("tab-b");
    const { rerender } = renderAgentLauncher({
      activeTab: tabA,
      terminalTabs: [tabA, tabB],
    });

    await user.click(await screen.findByRole("button", { name: "Open Codex" }));
    await waitFor(() => {
      expect(apiMocks.prepareExternalAgentWorkspace).toHaveBeenCalledWith({
        agentId: "codex",
        agentSessionId: "ags-codex",
        resumeProviderSession: false,
      });
    });
    expect(screen.getByTestId("agent-xterm")).toHaveAttribute(
      "data-cwd",
      "C:/Users/me/.kerminal/agents/sessions/ags-codex",
    );

    rerender(
      <AgentLauncherToolContent activeTab={tabB} terminalTabs={[tabB]} />,
    );

    expect(screen.queryByTestId("agent-xterm")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open Codex" })).toBeInTheDocument();
  });

  it("sends a desktop notification when an enabled agent terminal finishes", async () => {
    const user = userEvent.setup();

    renderAgentLauncher({
      desktopNotifications: {
        backgroundOnly: true,
        enabled: true,
        importantOnly: false,
        minDurationMs: 10_000,
        throttleMs: 30_000,
      },
    });

    await user.click(await screen.findByRole("button", { name: "Open Codex" }));
    await waitFor(() => {
      expect(apiMocks.prepareExternalAgentWorkspace).toHaveBeenCalledTimes(1);
    });

    const terminalCalls = terminalMocks.renderXtermPane.mock.calls;
    const terminalProps = terminalCalls[terminalCalls.length - 1]?.[0] as
      | {
          onSessionFinished?: (event: {
            durationMs: number;
            sessionId: string;
          }) => void;
        }
      | undefined;
    expect(terminalProps?.onSessionFinished).toEqual(expect.any(Function));

    act(() => {
      terminalProps?.onSessionFinished?.({
        durationMs: 12_500,
        sessionId: "term-agent-codex",
      });
    });

    expect(notificationMocks.sendDesktopNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        event: {
          agentName: "Codex",
          durationMs: 12_500,
          exitCode: null,
          kind: "agent.process.finished",
          notificationKey: "agent.process.finished:ags-codex",
        },
        permissionPrompt: "important-event",
        settings: expect.objectContaining({ enabled: true }),
        visibility: "hidden",
      }),
    );
    expect(
      JSON.stringify(notificationMocks.sendDesktopNotification.mock.calls[0][0]),
    ).not.toContain("C:/Users/me/.kerminal");
    expect(
      JSON.stringify(notificationMocks.sendDesktopNotification.mock.calls[0][0]),
    ).not.toContain("KERMINAL_MCP_ENDPOINT");
    expect(
      JSON.stringify(notificationMocks.sendDesktopNotification.mock.calls[0][0]),
    ).not.toContain("-NoLogo");
  });

  it("renders from ToolPanel as the external agent launcher", async () => {
    render(
      <ToolPanel
        activeTab={terminalTab("tab-main")}
        activeTool="agentLauncher"
        onActiveToolChange={vi.fn()}
        tools={tools}
      />,
    );

    expect(await screen.findByRole("button", { name: "Open Codex" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open Claude" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open Custom Agent" })).toBeInTheDocument();
  });

  it("keeps a launched agent terminal while switching right-panel tools", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <ToolPanel
        activeTab={terminalTab("tab-main")}
        activeTool="agentLauncher"
        onActiveToolChange={vi.fn()}
        tools={tools}
      />,
    );

    await user.click(await screen.findByRole("button", { name: "Open Codex" }));

    await waitFor(() => {
      expect(apiMocks.createAgentSession).toHaveBeenCalledTimes(1);
      expect(apiMocks.prepareExternalAgentWorkspace).toHaveBeenCalledTimes(1);
    });
    expect(await screen.findByTestId("agent-xterm")).toHaveAttribute(
      "data-cwd",
      "C:/Users/me/.kerminal/agents/sessions/ags-codex",
    );

    rerender(
      <ToolPanel
        activeTab={terminalTab("tab-main")}
        activeTool="logs"
        onActiveToolChange={vi.fn()}
        tools={tools}
      />,
    );

    expect(await screen.findByTestId("logs-tool")).toBeInTheDocument();
    expect(screen.getByTestId("agent-xterm")).toHaveAttribute(
      "data-cwd",
      "C:/Users/me/.kerminal/agents/sessions/ags-codex",
    );

    rerender(
      <ToolPanel
        activeTab={terminalTab("tab-main")}
        activeTool="agentLauncher"
        onActiveToolChange={vi.fn()}
        tools={tools}
      />,
    );

    expect(screen.getByTestId("agent-xterm")).toHaveAttribute(
      "data-cwd",
      "C:/Users/me/.kerminal/agents/sessions/ags-codex",
    );
    expect(apiMocks.createAgentSession).toHaveBeenCalledTimes(1);
    expect(apiMocks.prepareExternalAgentWorkspace).toHaveBeenCalledTimes(1);
  });

  it("launches a user supplied custom CLI command inside the right panel", async () => {
    const user = userEvent.setup();
    apiMocks.prepareExternalAgentWorkspace.mockImplementationOnce(async (request) => ({
      agentId: "custom",
      agentSessionId: request.agentSessionId,
      args: [
        "-NoLogo",
        "-NoProfile",
        "-NoExit",
        "-Command",
        "kimi --fast",
      ],
      cwd: "C:/Users/me/.kerminal/agents/sessions/ags-custom",
      message: "Custom workspace prepared.",
      shell: "pwsh.exe",
      title: "Custom Agent",
    }));

    renderAgentLauncher();

    await user.click(await screen.findByRole("button", { name: "Open Custom Agent" }));
    await user.type(screen.getByRole("textbox", { name: "Custom agent command" }), "kimi --fast");
    await user.click(
      screen.getByRole("button", { name: "Open custom agent command" }),
    );

    await waitFor(() => {
      expect(apiMocks.createAgentSession).toHaveBeenCalledWith({
        agentId: "custom",
        scope: {
          kind: "tab",
          tabId: "tab-main",
        },
        title: "Custom · 当前 Tab · 1 个终端 · tab-main",
      });
      expect(apiMocks.prepareExternalAgentWorkspace).toHaveBeenCalledWith({
        agentId: "custom",
        agentSessionId: "ags-custom",
        customCommand: "kimi --fast",
      });
    });
    expect(await screen.findByTestId("agent-xterm")).toHaveAttribute("data-shell", "pwsh.exe");
    expect(screen.getByTestId("agent-xterm")).toHaveAttribute(
      "data-args",
      "-NoLogo -NoProfile -NoExit -Command kimi --fast",
    );
    expect(screen.getByTestId("agent-terminal-command")).toHaveTextContent(
      "kimi --fast · C:/Users/me/.kerminal/agents/sessions/ags-custom",
    );
  });

  it("keeps the custom launch submit disabled for an empty command", async () => {
    const user = userEvent.setup();

    renderAgentLauncher();

    await user.click(await screen.findByRole("button", { name: "Open Custom Agent" }));

    expect(
      screen.getByRole("button", { name: "Open custom agent command" }),
    ).toBeDisabled();

    await user.keyboard("{Enter}");

    expect(apiMocks.prepareExternalAgentWorkspace).not.toHaveBeenCalled();
  });

  it("persists an edited Kerminal session title", async () => {
    const user = userEvent.setup();
    apiMocks.listAgentSessions.mockResolvedValue({
      diagnostics: [],
      sessions: [
        {
          session: {
            agentId: "codex",
            agentSessionId: "ags-title",
            launch: { args: [], cwd: "", shell: "codex" },
            scope: { kind: "tab", tabId: "tab-main" },
            status: "active",
            title: "旧标题",
          },
        },
      ],
    });

    renderAgentLauncher();

    await user.click(
      await screen.findByRole("button", { name: "重命名 旧标题" }),
    );
    const input = screen.getByRole("textbox", { name: "会话标题" });
    await user.clear(input);
    await user.type(input, "发布检查");
    await user.click(screen.getByRole("button", { name: "保存标题" }));

    await waitFor(() => {
      expect(apiMocks.updateAgentSession).toHaveBeenCalledWith("ags-title", {
        title: "发布检查",
      });
    });
  });

  it("keeps Agent runtime failures in collapsed technical details", async () => {
    const user = userEvent.setup();
    apiMocks.getExternalAgentWorkspaceStatus.mockRejectedValueOnce(
      new Error(
        'managed session failed at C:\\private\\agent.json with "token": "agent-secret"',
      ),
    );

    renderAgentLauncher();

    expect(await screen.findByText("无法读取 Agent 状态")).toBeVisible();
    expect(screen.getByText("请确认 Kerminal 服务可用后重试。")).toBeVisible();
    expect(screen.getByRole("button", { name: "重试" })).toBeVisible();
    const detail = screen.getByText(/managed session failed/);
    expect(detail.closest("details")).not.toHaveAttribute("open");
    expect(detail).not.toHaveTextContent("agent-secret");

    await user.click(screen.getByText("技术详情"));
    expect(detail.closest("details")).toHaveAttribute("open");
  });

});

function renderAgentLauncher(
  props: Partial<Parameters<typeof AgentLauncherToolContent>[0]> = {},
) {
  return render(
    <AgentLauncherToolContent
      activeTab={terminalTab("tab-main")}
      {...props}
    />,
  );
}

function terminalTab(id: string) {
  return {
    id,
    layout: { paneId: `pane-${id}`, type: "pane" },
    machineId: "local",
    title: id,
  } as never;
}

function workspaceStatus(): ExternalAgentWorkspaceStatus {
  return {
    agents: {
      claude: {
        cliCommand: "claude",
        configPath: "C:/Users/me/.kerminal/.mcp.json",
        configReady: false,
        id: "claude",
        installed: true,
        statusDetail: "Claude CLI detected. MCP config needs refresh.",
        title: "Claude",
      },
      codex: {
        cliCommand: "codex",
        configPath: "C:/Users/me/.kerminal/.codex/config.toml",
        configReady: true,
        id: "codex",
        installed: true,
        statusDetail: "Codex CLI detected.",
        title: "Codex",
      },
      custom: {
        cliCommand: "",
        configPath: "",
        configReady: false,
        id: "custom",
        installed: false,
        statusDetail: "Configure a custom agent command first.",
        title: "Custom",
      },
    },
    mcpEndpoint: "http://127.0.0.1:37657/mcp",
    mcpServerRunning: true,
    workspaceDir: "C:/Users/me/.kerminal",
  };
}
