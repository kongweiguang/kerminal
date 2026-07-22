/**
 * @author kongweiguang
 */

import "../../support/tool-panel/ToolPanel.testSupport";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { tools } from "../../../../src/features/workspace/workspaceData";
import { ToolPanel } from "../../../../src/features/tool-panel/ToolPanel";
import {
  assertNoManagedSshAvailabilityNotice,
  containerMachine,
  diagnosticsApiMocks,
  focusedSshPane,
  localMachine,
  portForwardApiMocks,
  readyManagedSshSnapshot,
  secondarySshMachine,
  secondarySshPane,
  secondarySshTab,
  serverInfoApiMocks,
  sshMachine,
  sshTerminalTab,
  tmuxApiMocks,
} from "../../support/tool-panel/ToolPanel.testSupport";

describe("ToolPanel target tools", () => {
  it("falls back to the bound pane cwd until a live SSH cwd arrives", async () => {
    const paneWithBootstrapCwd = {
      ...focusedSshPane,
      currentCwd: undefined,
      cwd: "/srv/bootstrap",
    };
    const view = render(
      <ToolPanel
        activeTool="sftp"
        activeMachine={sshMachine}
        focusedPane={paneWithBootstrapCwd}
        onActiveToolChange={vi.fn()}
        tools={tools}
      />,
    );

    const user = userEvent.setup();
    await user.click(
      await screen.findByRole(
        "button",
        { name: "跟随终端目录" },
        { timeout: 10000 },
      ),
    );
    await waitFor(() =>
      expect(screen.getByLabelText("当前远程路径")).toHaveValue(
        "/srv/bootstrap",
      ),
    );

    view.rerender(
      <ToolPanel
        activeTool="sftp"
        activeMachine={sshMachine}
        focusedPane={{ ...paneWithBootstrapCwd, currentCwd: "/srv/live" }}
        onActiveToolChange={vi.fn()}
        tools={tools}
      />,
    );

    await waitFor(() =>
      expect(screen.getByLabelText("当前远程路径")).toHaveValue("/srv/live"),
    );
  });

it("opens the tmux tool from the rail", async () => {
  const user = userEvent.setup();
  const onActiveToolChange = vi.fn();

  const { rerender } = render(
    <ToolPanel
      activeTool={null}
      activeMachine={sshMachine}
      activeTab={sshTerminalTab}
      onActiveToolChange={onActiveToolChange}
      tools={tools}
    />,
  );

  await user.click(screen.getByRole("button", { name: "打开 tmux" }));
  expect(onActiveToolChange).toHaveBeenCalledWith("tmux");

  rerender(
    <ToolPanel
      activeTool="tmux"
      activeMachine={sshMachine}
      activeTab={sshTerminalTab}
      onActiveToolChange={onActiveToolChange}
      tools={tools}
    />,
  );

  expect(await screen.findByText("tmux 3.4")).toBeInTheDocument();
  expect(screen.getByText("暂无会话")).toBeInTheDocument();
});

it("uses the selected host for tmux only when no tab or pane is active", async () => {
  render(
    <ToolPanel
      activeTool="tmux"
      onActiveToolChange={vi.fn()}
      selectedMachine={sshMachine}
      tools={tools}
    />,
  );

  expect(await screen.findByText("tmux 3.4")).toBeInTheDocument();
  expect(tmuxApiMocks.tmuxProbe).toHaveBeenCalledWith({
    target: { target: { hostId: "prod-api", kind: "ssh" } },
  });
});

it("pauses hidden target tools and refreshes the current host when reopened", async () => {
  const onActiveToolChange = vi.fn();
  const view = render(
    <ToolPanel
      activeMachine={sshMachine}
      activeTab={sshTerminalTab}
      activeTool="tmux"
      focusedPane={focusedSshPane}
      onActiveToolChange={onActiveToolChange}
      selectedMachine={sshMachine}
      tools={tools}
    />,
  );

  expect(await screen.findByText("tmux 3.4")).toBeInTheDocument();
  expect(tmuxApiMocks.tmuxProbe).toHaveBeenCalledTimes(1);

  view.rerender(
    <ToolPanel
      activeMachine={secondarySshMachine}
      activeTab={secondarySshTab}
      activeTool="system"
      focusedPane={secondarySshPane}
      onActiveToolChange={onActiveToolChange}
      selectedMachine={secondarySshMachine}
      tools={tools}
    />,
  );

  expect(
    await screen.findByText("远程服务器", undefined, { timeout: 10000 }),
  ).toBeInTheDocument();
  expect(tmuxApiMocks.tmuxProbe).toHaveBeenCalledTimes(1);

  view.rerender(
    <ToolPanel
      activeMachine={secondarySshMachine}
      activeTab={secondarySshTab}
      activeTool="tmux"
      focusedPane={secondarySshPane}
      onActiveToolChange={onActiveToolChange}
      selectedMachine={secondarySshMachine}
      tools={tools}
    />,
  );

  await waitFor(() => expect(tmuxApiMocks.tmuxProbe).toHaveBeenCalledTimes(2));
  expect(tmuxApiMocks.tmuxProbe).toHaveBeenLastCalledWith({
    target: { target: { hostId: "staging-api", kind: "ssh" } },
  });
});
it("does not show managed SSH availability notices for SSH right-side tools", async () => {
  diagnosticsApiMocks.getManagedSshRuntimeSnapshot.mockResolvedValue(
    readyManagedSshSnapshot,
  );

  let view = render(
    <ToolPanel
      activeTool="system"
      activeMachine={sshMachine}
      onActiveToolChange={vi.fn()}
      tools={tools}
    />,
  );

  await waitFor(() =>
    expect(serverInfoApiMocks.getServerInfoSnapshot).toHaveBeenCalled(),
  );

  expect(
    screen.queryByLabelText("Managed SSH runtime 状态"),
  ).not.toBeInTheDocument();
  expect(screen.queryByText("Managed reusable")).not.toBeInTheDocument();
  expect(
    screen.queryByText(/当前 SSH 目标已有 ready managed session/),
  ).not.toBeInTheDocument();
  expect(
    diagnosticsApiMocks.getManagedSshRuntimeSnapshot,
  ).not.toHaveBeenCalled();

  view.unmount();
  view = render(
    <ToolPanel
      activeTool="sftp"
      activeMachine={sshMachine}
      focusedPane={focusedSshPane}
      onActiveToolChange={vi.fn()}
      tools={tools}
    />,
  );

  expect(
    await screen.findByLabelText("当前远程路径", {}, { timeout: 10000 }),
  ).toBeInTheDocument();
  assertNoManagedSshAvailabilityNotice();
  expect(
    diagnosticsApiMocks.getManagedSshRuntimeSnapshot,
  ).not.toHaveBeenCalled();

  view.unmount();
  view = render(
    <ToolPanel
      activeTool="ports"
      activeMachine={sshMachine}
      focusedPane={focusedSshPane}
      onActiveToolChange={vi.fn()}
      tools={tools}
    />,
  );

  await waitFor(() =>
    expect(portForwardApiMocks.listPortForwards).toHaveBeenCalled(),
  );

  expect(
    screen.queryByLabelText("Managed SSH runtime 状态"),
  ).not.toBeInTheDocument();
  expect(screen.queryByText("Legacy terminal only")).not.toBeInTheDocument();
  expect(
    screen.queryByText(/右侧工具不能把 PTY 连接当作可复用 runtime/),
  ).not.toBeInTheDocument();
  expect(
    diagnosticsApiMocks.getManagedSshRuntimeSnapshot,
  ).not.toHaveBeenCalled();

  view.unmount();
  render(
    <ToolPanel
      activeTool="tmux"
      activeMachine={sshMachine}
      focusedPane={focusedSshPane}
      onActiveToolChange={vi.fn()}
      tools={tools}
    />,
  );

  expect(await screen.findByText("tmux 3.4")).toBeInTheDocument();
  assertNoManagedSshAvailabilityNotice();
  expect(
    diagnosticsApiMocks.getManagedSshRuntimeSnapshot,
  ).not.toHaveBeenCalled();
});
it("shows the local file browser for local machines", async () => {
  render(
    <ToolPanel
      activeTool="sftp"
      activeMachine={localMachine}
      onActiveToolChange={vi.fn()}
      tools={tools}
    />,
  );

  expect(
    await screen.findByText("本地文件", undefined, { timeout: 5000 }),
  ).toBeInTheDocument();
  expect(screen.getByText("本机文件系统")).toBeInTheDocument();
  expect(screen.getByLabelText("当前本地路径")).toBeInTheDocument();
});

it("renders the shared remote file panel for an active container machine", async () => {
  render(
    <ToolPanel
      activeTool="sftp"
      activeMachine={containerMachine}
      onActiveToolChange={vi.fn()}
      tools={tools}
    />,
  );

  expect(
    await screen.findByText("docker:prod-api:api", undefined, {
      timeout: 5000,
    }),
  ).toBeInTheDocument();
  expect(
    await screen.findByText("package.json", undefined, { timeout: 5000 }),
  ).toBeInTheDocument();
  expect(screen.queryByText("SFTP 文件浏览")).not.toBeInTheDocument();
});

it("shows an empty port forwarding state for non SSH machines", async () => {
  render(
    <ToolPanel
      activeTool="ports"
      activeMachine={localMachine}
      onActiveToolChange={vi.fn()}
      tools={tools}
    />,
  );

  expect(await screen.findByText("SSH 隧道")).toBeInTheDocument();
  expect(screen.getByText(/请选择 SSH 主机/)).toBeInTheDocument();
});

it("creates and stops a local port forward for the active SSH host", async () => {
  const user = userEvent.setup();
  portForwardApiMocks.listPortForwards
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([
      {
        bindHost: "127.0.0.1",
        createdAt: "1",
        hostId: "prod-api",
        hostName: "prod api",
        id: "forward-1",
        kind: "local",
        name: "PostgreSQL 隧道",
        sourcePort: 15432,
        status: "running",
        targetHost: "127.0.0.1",
        targetPort: 5432,
      },
    ])
    .mockResolvedValueOnce([]);
  portForwardApiMocks.createPortForward.mockResolvedValueOnce({
    bindHost: "127.0.0.1",
    createdAt: "1",
    hostId: "prod-api",
    hostName: "prod api",
    id: "forward-1",
    kind: "local",
    name: "PostgreSQL 隧道",
    sourcePort: 15432,
    status: "running",
    targetHost: "127.0.0.1",
    targetPort: 5432,
  });

  render(
    <ToolPanel
      activeTool="ports"
      activeMachine={sshMachine}
      onActiveToolChange={vi.fn()}
      tools={tools}
    />,
  );

  await user.click(
    await screen.findByRole(
      "button",
      { name: "添加隧道" },
      { timeout: 5000 },
    ),
  );
  await user.type(await screen.findByLabelText("名称"), "PostgreSQL 隧道");
  await user.click(screen.getByRole("button", { name: "开启隧道" }));

  expect(portForwardApiMocks.createPortForward).toHaveBeenCalledWith(
    expect.objectContaining({
      bindHost: "127.0.0.1",
      hostId: "prod-api",
      kind: "local",
      name: "PostgreSQL 隧道",
      sourcePort: 15432,
      targetHost: "127.0.0.1",
      targetPort: 5432,
    }),
  );
  expect(await screen.findByText("PostgreSQL 隧道")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "停止隧道" }));

  expect(portForwardApiMocks.stopPortForward).toHaveBeenCalledWith(
    "forward-1",
  );
});
});
