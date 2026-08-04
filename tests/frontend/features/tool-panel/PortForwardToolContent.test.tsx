// @author kongweiguang

import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PortForwardSummary } from "../../../../src/lib/portForwardApi";
import type { Machine, TerminalPane } from "../../../../src/features/workspace/types";
import { PortForwardToolContent } from "../../../../src/features/tool-panel/PortForwardToolContent";

const portForwardApiMocks = vi.hoisted(() => ({
  createPortForward: vi.fn(),
  deletePortForward: vi.fn(),
  listPortForwards: vi.fn(),
  startPortForward: vi.fn(),
  stopPortForward: vi.fn(),
}));

const terminalRegistryMocks = vi.hoisted(() => ({
  writePaneCommand: vi.fn(),
}));

const proxyAutoInjectionMocks = vi.hoisted(() => {
  const state = new Map<string, { sessionId: string }>();
  return {
    clearRemoteSocksAutoInjection: vi.fn(
      (hostId: string, _sessionId?: string) => state.delete(hostId),
    ),
    getRemoteSocksAutoInjection: vi.fn((hostId: string) =>
      state.get(hostId),
    ),
    isRemoteSocksAutoInjectionEnabled: vi.fn(
      ({ hostId, sessionId }: { hostId: string; sessionId: string }) =>
        state.get(hostId)?.sessionId === sessionId,
    ),
    reset: () => {
      state.clear();
    },
    setRemoteSocksAutoInjection: vi.fn(
      (injection: { hostId: string; sessionId: string }) => {
        state.set(injection.hostId, injection);
      },
    ),
  };
});

const desktopClipboardApiMocks = vi.hoisted(() => ({
  writeDesktopClipboardText: vi.fn(),
}));

vi.mock("../../../../src/lib/desktopClipboardApi", () => ({
  writeDesktopClipboardText: (...args: unknown[]) =>
    desktopClipboardApiMocks.writeDesktopClipboardText(...args),
}));

vi.mock("../../../../src/lib/portForwardApi", () => ({
  createPortForward: (...args: unknown[]) =>
    portForwardApiMocks.createPortForward(...args),
  deletePortForward: (...args: unknown[]) =>
    portForwardApiMocks.deletePortForward(...args),
  listPortForwards: (...args: unknown[]) =>
    portForwardApiMocks.listPortForwards(...args),
  startPortForward: (...args: unknown[]) =>
    portForwardApiMocks.startPortForward(...args),
  stopPortForward: (...args: unknown[]) =>
    portForwardApiMocks.stopPortForward(...args),
}));

vi.mock("../../../../src/features/terminal/terminalSessionRegistry", () => ({
  writePaneCommand: (...args: unknown[]) =>
    terminalRegistryMocks.writePaneCommand(...args),
}));

vi.mock("../../../../src/features/terminal/terminalProxyAutoInjection", () => ({
  clearRemoteSocksAutoInjection: (hostId: string, sessionId?: string) =>
    proxyAutoInjectionMocks.clearRemoteSocksAutoInjection(
      hostId,
      sessionId,
    ),
  getRemoteSocksAutoInjection: (hostId: string) =>
    proxyAutoInjectionMocks.getRemoteSocksAutoInjection(hostId),
  isRemoteSocksAutoInjectionEnabled: (request: {
    hostId: string;
    sessionId: string;
  }) => proxyAutoInjectionMocks.isRemoteSocksAutoInjectionEnabled(request),
  setRemoteSocksAutoInjection: (injection: {
    hostId: string;
    sessionId: string;
  }) => proxyAutoInjectionMocks.setRemoteSocksAutoInjection(injection),
}));

const sshMachine: Machine = {
  authType: "key",
  credentialRef: "C:/keys/prod_ed25519",
  description: "deploy@prod.internal:22",
  host: "prod.internal",
  id: "prod-api",
  kind: "ssh",
  name: "prod api",
  port: 22,
  status: "warning",
  tags: ["ssh", "prod"],
  username: "deploy",
};

const stageSshMachine: Machine = {
  ...sshMachine,
  credentialRef: "C:/keys/stage_ed25519",
  description: "deploy@stage.internal:22",
  host: "stage.internal",
  id: "stage-api",
  name: "stage api",
  status: "online",
  tags: ["ssh", "stage"],
};

const localMachine: Machine = {
  description: "默认本地配置",
  id: "local-powershell",
  kind: "local",
  name: "PowerShell",
  status: "online",
  tags: ["local"],
};

const containerMachine: Machine = {
  containerId: "container-api",
  containerName: "api",
  description: "api on prod api",
  id: "docker:prod-api:container-api",
  kind: "dockerContainer",
  name: "api",
  parentMachineId: "prod-api",
  runtime: "docker",
  status: "online",
  tags: ["container", "docker"],
  target: {
    containerId: "container-api",
    containerName: "api",
    hostId: "prod-api",
    kind: "dockerContainer",
    runtime: "docker",
  },
};

const focusedSshPane: TerminalPane = {
  id: "pane-prod",
  lines: [],
  machineId: "prod-api",
  mode: "ssh",
  prompt: "$",
  remoteHostId: "prod-api",
  status: "online",
  title: "prod api",
};

function networkAssistSession(
  overrides: Partial<PortForwardSummary> = {},
): PortForwardSummary {
  return {
    bindHost: "127.0.0.1",
    createdAt: "1",
    hostId: "prod-api",
    hostName: "prod api",
    id: "forward-network",
    kind: "remoteDynamic",
    name: "远端 SOCKS",
    origin: "user",
    proxyProtocol: "socks5",
    proxyUrl: "socks5h://127.0.0.1:18080",
    remoteBindHost: "127.0.0.1",
    sourcePort: 18080,
    status: "running",
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, reject, resolve };
}

describe("PortForwardToolContent", () => {
  beforeEach(() => {
    portForwardApiMocks.createPortForward.mockReset();
    portForwardApiMocks.deletePortForward.mockReset();
    portForwardApiMocks.listPortForwards.mockReset();
    portForwardApiMocks.listPortForwards.mockResolvedValue([]);
    portForwardApiMocks.startPortForward.mockReset();
    portForwardApiMocks.startPortForward.mockResolvedValue(networkAssistSession());
    portForwardApiMocks.stopPortForward.mockReset();
    portForwardApiMocks.stopPortForward.mockResolvedValue(true);
    terminalRegistryMocks.writePaneCommand.mockReset();
    terminalRegistryMocks.writePaneCommand.mockResolvedValue({
      paneId: "pane-prod",
      sent: true,
    });
    proxyAutoInjectionMocks.reset();
    proxyAutoInjectionMocks.clearRemoteSocksAutoInjection.mockClear();
    proxyAutoInjectionMocks.getRemoteSocksAutoInjection.mockClear();
    proxyAutoInjectionMocks.isRemoteSocksAutoInjectionEnabled.mockClear();
    proxyAutoInjectionMocks.setRemoteSocksAutoInjection.mockClear();
    desktopClipboardApiMocks.writeDesktopClipboardText.mockReset();
    desktopClipboardApiMocks.writeDesktopClipboardText.mockResolvedValue({
      ok: true,
    });
  });

  it("switches scenarios and keeps fields owned by host or local endpoints", async () => {
    const user = userEvent.setup();
    render(<PortForwardToolContent selectedMachine={sshMachine} />);

    expect(await screen.findByText("SSH 隧道")).toBeInTheDocument();
    expect(screen.queryByLabelText("主机目标地址")).not.toBeInTheDocument();

    const addTunnelButton = screen.getByRole("button", { name: "添加隧道" });
    expect(addTunnelButton).toHaveClass("bg-sky-500");

    await user.click(addTunnelButton);

    expect(
      await screen.findByRole("dialog", { name: "添加 SSH 隧道" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "开启隧道" })).toHaveClass(
      "bg-sky-500",
    );
    expect(
      screen.getByLabelText("主机目标地址"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("本机监听端口")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /暴露本机服务/ }));

    expect(screen.getByText("主机监听")).toBeInTheDocument();
    expect(screen.getByLabelText("主机监听端口")).toBeInTheDocument();
    expect(screen.getByLabelText("本机目标地址")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /SOCKS \/ 高级/ }));

    expect(screen.getByRole("button", { name: "本机 -D" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "远端 SOCKS" })).toBeInTheDocument();
  });

  it("keeps raw tunnel failures collapsed behind a recovery message", async () => {
    const user = userEvent.setup();
    portForwardApiMocks.listPortForwards.mockRejectedValueOnce(
      new Error(
        "managed_runtime lease poisoned token=forward-internal-secret",
      ),
    );

    render(<PortForwardToolContent selectedMachine={sshMachine} />);

    expect(await screen.findByText("无法读取隧道")).toBeVisible();
    expect(screen.getByText("请确认 SSH 连接可用后重试。")).toBeVisible();
    const technicalDetail = screen.getByText(/managed_runtime lease poisoned/);
    expect(technicalDetail.closest("details")).not.toHaveAttribute("open");
    expect(
      screen.queryByText(/forward-internal-secret/),
    ).not.toBeInTheDocument();

    await user.click(screen.getByText("技术详情"));

    expect(technicalDetail.closest("details")).toHaveAttribute("open");
  });

  it("creates a tunnel from the add dialog and closes the dialog", async () => {
    const user = userEvent.setup();
    portForwardApiMocks.createPortForward.mockResolvedValue({
      bindHost: "127.0.0.1",
      createdAt: "1",
      hostId: "prod-api",
      hostName: "prod api",
      id: "forward-created",
      kind: "local",
      name: "PostgreSQL 隧道",
      sourcePort: 15432,
      status: "running",
      targetHost: "127.0.0.1",
      targetPort: 5432,
    });

    render(<PortForwardToolContent selectedMachine={sshMachine} />);

    await user.click(await screen.findByRole("button", { name: "添加隧道" }));
    await user.type(screen.getByLabelText("名称"), "PostgreSQL 隧道");
    await user.click(screen.getByRole("button", { name: "开启隧道" }));

    await waitFor(() =>
      expect(portForwardApiMocks.createPortForward).toHaveBeenCalledWith(
        expect.objectContaining({
          hostId: "prod-api",
          kind: "local",
          name: "PostgreSQL 隧道",
          sourcePort: 15432,
          targetPort: 5432,
        }),
      ),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "添加 SSH 隧道" }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByText("隧道会话已创建。")).toBeInTheDocument();
  });

  it("filters sessions to the selected SSH host", async () => {
    portForwardApiMocks.listPortForwards.mockResolvedValue([
      networkAssistSession({ id: "forward-prod", name: "Prod proxy" }),
      networkAssistSession({
        hostId: "stage-api",
        id: "forward-stage",
        name: "Stage proxy",
      }),
    ]);

    render(<PortForwardToolContent selectedMachine={sshMachine} />);

    expect(await screen.findByText("Prod proxy")).toBeInTheDocument();
    expect(
      screen.queryByText(/脚本只写当前用户 home/),
    ).not.toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "展开 Prod proxy 详情" }),
    );
    expect(screen.getByText(/脚本只写当前用户 home/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "复制配置脚本" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "复制撤销脚本" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Stage proxy")).not.toBeInTheDocument();
  });

  it("copies remote SOCKS scripts through the desktop clipboard facade", async () => {
    const user = userEvent.setup();
    portForwardApiMocks.listPortForwards.mockResolvedValue([
      networkAssistSession(),
    ]);

    render(<PortForwardToolContent selectedMachine={sshMachine} />);

    await user.click(
      await screen.findByRole("button", { name: "复制配置脚本" }),
    );

    expect(
      desktopClipboardApiMocks.writeDesktopClipboardText,
    ).toHaveBeenCalledWith(expect.stringContaining("ALL_PROXY"));
    expect(screen.getByText("已复制地址。")).toBeInTheDocument();
  });

  it("injects SOCKS proxy exports into the focused same-host SSH pane", async () => {
    const user = userEvent.setup();
    portForwardApiMocks.listPortForwards.mockResolvedValue([
      networkAssistSession(),
    ]);

    render(
      <PortForwardToolContent
        focusedPane={focusedSshPane}
        selectedMachine={sshMachine}
      />,
    );

    await user.click(await screen.findByRole("button", { name: "注入代理环境" }));

    await waitFor(() =>
      expect(terminalRegistryMocks.writePaneCommand).toHaveBeenCalledWith({
        command: expect.stringContaining(
          "ALL_PROXY='socks5h://127.0.0.1:18080'",
        ),
        paneId: "pane-prod",
        source: "tool",
      }),
    );
  });

  it("disables current-pane injection when the focused SSH pane belongs to a different host", async () => {
    portForwardApiMocks.listPortForwards.mockResolvedValue([
      networkAssistSession(),
    ]);

    render(
      <PortForwardToolContent
        focusedPane={{
          ...focusedSshPane,
          machineId: "stage-api",
          remoteHostId: "stage-api",
        }}
        selectedMachine={sshMachine}
      />,
    );

    expect(
      await screen.findByRole("button", { name: "注入代理环境" }),
    ).toBeDisabled();
  });

  it("toggles later same-host SSH terminals auto-use for a network assist session", async () => {
    const user = userEvent.setup();
    portForwardApiMocks.listPortForwards.mockResolvedValue([
      networkAssistSession(),
    ]);

    render(<PortForwardToolContent selectedMachine={sshMachine} />);

    const enableButton = await screen.findByRole("button", {
      name: "新终端自动使用",
    });
    await user.click(enableButton);

    expect(
      proxyAutoInjectionMocks.setRemoteSocksAutoInjection,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        hostId: "prod-api",
        proxyUrl: "socks5h://127.0.0.1:18080",
        sessionId: "forward-network",
      }),
    );
    expect(
      screen.getByRole("button", { name: "关闭新终端自动使用" }),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "关闭新终端自动使用" }),
    );

    expect(
      proxyAutoInjectionMocks.clearRemoteSocksAutoInjection,
    ).toHaveBeenCalledWith("prod-api", "forward-network");
  });

  it("stops a running tunnel without deleting its saved configuration", async () => {
    const user = userEvent.setup();
    portForwardApiMocks.listPortForwards
      .mockResolvedValueOnce([networkAssistSession()])
      .mockResolvedValueOnce([networkAssistSession({ status: "exited" })]);

    render(<PortForwardToolContent selectedMachine={sshMachine} />);

    await user.click(await screen.findByRole("button", { name: "停止隧道" }));

    expect(portForwardApiMocks.stopPortForward).toHaveBeenCalledWith(
      "forward-network",
    );
    expect(portForwardApiMocks.deletePortForward).not.toHaveBeenCalled();
    expect(await screen.findByText("隧道已停止，配置仍保留。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "启动隧道" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "删除隧道" })).toBeInTheDocument();
  });

  it("starts an exited saved tunnel for the same host", async () => {
    const user = userEvent.setup();
    portForwardApiMocks.listPortForwards
      .mockResolvedValueOnce([networkAssistSession({ status: "exited" })])
      .mockResolvedValueOnce([networkAssistSession()]);

    render(<PortForwardToolContent selectedMachine={sshMachine} />);

    await user.click(await screen.findByRole("button", { name: "启动隧道" }));

    expect(portForwardApiMocks.startPortForward).toHaveBeenCalledWith(
      "forward-network",
    );
    expect(await screen.findByText("远端 SOCKS 已启动。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "停止隧道" })).toBeInTheDocument();
  });

  it("deletes a saved tunnel only when the delete action is used", async () => {
    const user = userEvent.setup();
    portForwardApiMocks.deletePortForward.mockResolvedValue(true);
    portForwardApiMocks.listPortForwards
      .mockResolvedValueOnce([networkAssistSession({ status: "exited" })])
      .mockResolvedValueOnce([]);

    render(<PortForwardToolContent selectedMachine={sshMachine} />);

    await user.click(await screen.findByRole("button", { name: "删除隧道" }));

    expect(portForwardApiMocks.deletePortForward).toHaveBeenCalledWith(
      "forward-network",
    );
    expect(await screen.findByText("隧道配置已删除。")).toBeInTheDocument();
    expect(screen.queryByText("主机网络助手")).not.toBeInTheDocument();
  });

  it("keeps restored auto-use until sessions finish loading", async () => {
    proxyAutoInjectionMocks.setRemoteSocksAutoInjection({
      hostId: "prod-api",
      sessionId: "forward-network",
    });
    proxyAutoInjectionMocks.setRemoteSocksAutoInjection.mockClear();
    portForwardApiMocks.listPortForwards.mockResolvedValue([
      networkAssistSession(),
    ]);

    render(<PortForwardToolContent selectedMachine={sshMachine} />);

    expect(
      await screen.findByRole("button", { name: "关闭新终端自动使用" }),
    ).toBeInTheDocument();
    expect(
      proxyAutoInjectionMocks.clearRemoteSocksAutoInjection,
    ).not.toHaveBeenCalled();
  });

  it("does not reuse restored auto-use when the persisted tunnel is exited", async () => {
    proxyAutoInjectionMocks.setRemoteSocksAutoInjection({
      hostId: "prod-api",
      sessionId: "forward-network",
    });
    proxyAutoInjectionMocks.setRemoteSocksAutoInjection.mockClear();
    portForwardApiMocks.listPortForwards.mockResolvedValue([
      networkAssistSession({ status: "exited" }),
    ]);

    render(
      <PortForwardToolContent
        focusedPane={focusedSshPane}
        selectedMachine={sshMachine}
      />,
    );

    expect(await screen.findByText("已退出")).toBeInTheDocument();
    await waitFor(() =>
      expect(
        proxyAutoInjectionMocks.clearRemoteSocksAutoInjection,
      ).toHaveBeenCalledWith("prod-api", "forward-network"),
    );
    expect(
      screen.getByRole("button", { name: "注入代理环境" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "新终端自动使用" }),
    ).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: "复制配置脚本" }),
    ).not.toBeInTheDocument();
  });

  it("shows an SSH-only empty state for non SSH machines", async () => {
    render(<PortForwardToolContent selectedMachine={localMachine} />);

    expect(await screen.findByText("SSH 隧道")).toBeInTheDocument();
    expect(screen.getByText(/请选择 SSH 主机/)).toBeInTheDocument();
  });

  it("does not load SSH tunnel sessions for container targets", async () => {
    render(<PortForwardToolContent selectedMachine={containerMachine} />);

    expect(await screen.findByText("SSH 隧道")).toBeInTheDocument();
    expect(screen.getByText(/当前容器目标不支持/)).toBeInTheDocument();
    expect(portForwardApiMocks.listPortForwards).not.toHaveBeenCalled();
  });

  it("does not render a default development host badge", async () => {
    render(
      <PortForwardToolContent
        selectedMachine={{
          ...sshMachine,
          credentialRef: "C:/keys/dev_ed25519",
          description: "dev@dev.internal:22",
          host: "dev.internal",
          id: "dev-api",
          name: "dev api",
          status: "online",
          tags: ["ssh", "dev"],
          username: "dev",
        }}
      />,
    );

    expect(await screen.findByText("SSH 隧道")).toBeInTheDocument();
    expect(screen.queryByText("开发主机")).not.toBeInTheDocument();
  });

  it("shows GatewayPorts and exposure warnings for non-loopback remote binds", async () => {
    const user = userEvent.setup();
    render(<PortForwardToolContent selectedMachine={sshMachine} />);

    await user.click(await screen.findByRole("button", { name: "添加隧道" }));
    await user.click(screen.getByRole("button", { name: /SOCKS \/ 高级/ }));
    await user.click(screen.getByRole("button", { name: "远端 SOCKS" }));
    await user.click(screen.getByRole("combobox", { name: "主机监听范围" }));
    await user.click(screen.getByRole("option", { name: "全部接口 (0.0.0.0)" }));

    expect(screen.getByText(/GatewayPorts/)).toBeInTheDocument();
    expect(screen.getByText(/主机监听 0\.0\.0\.0 会扩大暴露范围/)).toBeInTheDocument();
  });

  it("does not list while inactive and reloads the current host when reopened", async () => {
    portForwardApiMocks.listPortForwards.mockResolvedValue([
      networkAssistSession({
        hostId: "stage-api",
        id: "forward-stage",
        name: "Stage proxy",
      }),
    ]);
    const { rerender } = render(
      <PortForwardToolContent active={false} selectedMachine={sshMachine} />,
    );

    await act(async () => undefined);
    expect(portForwardApiMocks.listPortForwards).not.toHaveBeenCalled();

    rerender(
      <PortForwardToolContent active selectedMachine={stageSshMachine} />,
    );

    expect(await screen.findByText("Stage proxy")).toBeInTheDocument();
    expect(portForwardApiMocks.listPortForwards).toHaveBeenCalledTimes(1);
  });

  it("keeps the fast current host list when the previous host resolves later", async () => {
    const slowProd = deferred<PortForwardSummary[]>();
    const fastStage = deferred<PortForwardSummary[]>();
    portForwardApiMocks.listPortForwards
      .mockReturnValueOnce(slowProd.promise)
      .mockReturnValueOnce(fastStage.promise);

    const { rerender } = render(
      <PortForwardToolContent active selectedMachine={sshMachine} />,
    );
    await waitFor(() =>
      expect(portForwardApiMocks.listPortForwards).toHaveBeenCalledTimes(1),
    );

    rerender(
      <PortForwardToolContent active selectedMachine={stageSshMachine} />,
    );
    await waitFor(() =>
      expect(portForwardApiMocks.listPortForwards).toHaveBeenCalledTimes(2),
    );

    await act(async () => {
      fastStage.resolve([
        networkAssistSession({
          hostId: "stage-api",
          id: "forward-stage",
          name: "Stage proxy",
        }),
      ]);
      await fastStage.promise;
    });
    expect(await screen.findByText("Stage proxy")).toBeInTheDocument();

    await act(async () => {
      slowProd.resolve([
        networkAssistSession({ id: "forward-prod", name: "Prod proxy" }),
      ]);
      await slowProd.promise;
    });
    expect(screen.getByText("Stage proxy")).toBeInTheDocument();
    expect(screen.queryByText("Prod proxy")).not.toBeInTheDocument();
  });

  it("closes and resets the target-bound dialog when the host changes", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <PortForwardToolContent active selectedMachine={sshMachine} />,
    );

    await user.click(await screen.findByRole("button", { name: "添加隧道" }));
    await user.type(screen.getByLabelText("名称"), "Prod draft");

    rerender(
      <PortForwardToolContent active selectedMachine={stageSshMachine} />,
    );
    expect(
      screen.queryByRole("dialog", { name: "添加 SSH 隧道" }),
    ).not.toBeInTheDocument();
    expect(portForwardApiMocks.createPortForward).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "添加隧道" }));
    expect(screen.getByLabelText("名称")).toHaveValue("");
  });

  it("does not apply an old host action result to the newly selected host", async () => {
    const user = userEvent.setup();
    const slowStart = deferred<PortForwardSummary>();
    portForwardApiMocks.startPortForward.mockReturnValueOnce(slowStart.promise);
    portForwardApiMocks.listPortForwards
      .mockResolvedValueOnce([networkAssistSession({ status: "exited" })])
      .mockResolvedValueOnce([
        networkAssistSession({
          hostId: "stage-api",
          id: "forward-stage",
          name: "Stage proxy",
        }),
      ]);

    const { rerender } = render(
      <PortForwardToolContent active selectedMachine={sshMachine} />,
    );
    await user.click(await screen.findByRole("button", { name: "启动隧道" }));
    await waitFor(() =>
      expect(portForwardApiMocks.startPortForward).toHaveBeenCalledWith(
        "forward-network",
      ),
    );

    rerender(
      <PortForwardToolContent active selectedMachine={stageSshMachine} />,
    );
    expect(await screen.findByText("Stage proxy")).toBeInTheDocument();

    await act(async () => {
      slowStart.resolve(networkAssistSession());
      await slowStart.promise;
    });
    expect(screen.getByText("Stage proxy")).toBeInTheDocument();
    expect(screen.queryByText("主机网络助手 已启动。")).not.toBeInTheDocument();
    expect(portForwardApiMocks.listPortForwards).toHaveBeenCalledTimes(2);
  });
});
