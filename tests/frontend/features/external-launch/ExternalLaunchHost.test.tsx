// @author kongweiguang

import { StrictMode } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ExternalLaunchEventPayload,
  ExternalHostKeyInspection,
  ExternalLaunchMaterializedTarget,
} from "../../../../src/lib/externalLaunchApi";
import { ExternalLaunchHost } from "../../../../src/features/external-launch/ExternalLaunchHost";
import {
  useWorkspaceStore,
} from "../../../../src/features/workspace/workspaceStore";
import { resetWorkspaceStore } from "../../support/workspace/workspaceStore.testSupport";
import {
  createLaunch,
  knownHostKeyInspection,
  materializedTarget,
  spyOnOpenExternalSshLaunch,
  unknownHostKeyInspection,
} from "./ExternalLaunchHost.testSupport";

const apiMocks = vi.hoisted(() => ({
  ackExternalSshLaunch: vi.fn(),
  cancelExternalSshLaunch: vi.fn(),
  inspectExternalLaunchHostKey: vi.fn(),
  listenExternalSshLaunches: vi.fn(),
  materializeExternalSshLaunch: vi.fn(),
  takePendingExternalSshLaunches: vi.fn(),
  trustExternalLaunchHostKey: vi.fn(),
  requestSshAuthPrompt: vi.fn(),
}));

vi.mock(
  "../../../../src/features/ssh-auth/state/index",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../../../../src/features/ssh-auth/state/index")
    >()),
    requestSshAuthPrompt: (...args: unknown[]) =>
      apiMocks.requestSshAuthPrompt(...args),
  }),
);

let externalLaunchListener:
  | ((payload: ExternalLaunchEventPayload) => void)
  | undefined;

vi.mock("../../../../src/lib/externalLaunchApi", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../../../src/lib/externalLaunchApi")
  >()),
  ackExternalSshLaunch: (...args: unknown[]) =>
    apiMocks.ackExternalSshLaunch(...args),
  cancelExternalSshLaunch: (...args: unknown[]) =>
    apiMocks.cancelExternalSshLaunch(...args),
  inspectExternalLaunchHostKey: (...args: unknown[]) =>
    apiMocks.inspectExternalLaunchHostKey(...args),
  listenExternalSshLaunches: (...args: unknown[]) =>
    apiMocks.listenExternalSshLaunches(...args),
  materializeExternalSshLaunch: (...args: unknown[]) =>
    apiMocks.materializeExternalSshLaunch(...args),
  takePendingExternalSshLaunches: (...args: unknown[]) =>
    apiMocks.takePendingExternalSshLaunches(...args),
  trustExternalLaunchHostKey: (...args: unknown[]) =>
    apiMocks.trustExternalLaunchHostKey(...args),
}));

describe("ExternalLaunchHost", () => {
  beforeEach(() => {
    resetWorkspaceStore();
    apiMocks.ackExternalSshLaunch.mockReset();
    apiMocks.cancelExternalSshLaunch.mockReset();
    apiMocks.inspectExternalLaunchHostKey.mockReset();
    apiMocks.listenExternalSshLaunches.mockReset();
    apiMocks.materializeExternalSshLaunch.mockReset();
    apiMocks.takePendingExternalSshLaunches.mockReset();
    apiMocks.trustExternalLaunchHostKey.mockReset();
    apiMocks.requestSshAuthPrompt.mockReset();
    externalLaunchListener = undefined;
    apiMocks.ackExternalSshLaunch.mockResolvedValue(1);
    apiMocks.cancelExternalSshLaunch.mockResolvedValue(1);
    apiMocks.inspectExternalLaunchHostKey.mockResolvedValue(
      knownHostKeyInspection(),
    );
    apiMocks.listenExternalSshLaunches.mockImplementation((listener) => {
      externalLaunchListener = listener as (
        payload: ExternalLaunchEventPayload,
      ) => void;
      return Promise.resolve(() => undefined);
    });
    apiMocks.materializeExternalSshLaunch.mockResolvedValue(materializedTarget());
    apiMocks.trustExternalLaunchHostKey.mockResolvedValue(
      knownHostKeyInspection(),
    );
    apiMocks.requestSshAuthPrompt.mockResolvedValue({
      promptId: "prompt-1",
      secretKind: "password",
    });
  });

  it("drains pending launches, opens resolved SSH tabs, and acknowledges them", async () => {
    const openSpy = spyOnOpenExternalSshLaunch();
    apiMocks.takePendingExternalSshLaunches.mockResolvedValue([
      createLaunch({ username: "deploy" }),
    ]);

    render(<ExternalLaunchHost />);

    await waitFor(() =>
      expect(apiMocks.ackExternalSshLaunch).toHaveBeenCalledWith("launch-1"),
    );
    expect(apiMocks.materializeExternalSshLaunch).toHaveBeenCalledWith({
      launchId: "launch-1",
      username: "deploy",
    });
    expect(openSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "launch-1",
        materialized: expect.objectContaining({
          displayName: "Materialized SSH target",
          host: "materialized.internal",
          port: 2202,
          username: "resolved-user",
        }),
        target: expect.objectContaining({
          host: "materialized.internal",
          port: 2202,
          username: "resolved-user",
        }),
      }),
    );
    expect(
      apiMocks.materializeExternalSshLaunch.mock.invocationCallOrder[0],
    ).toBeLessThan(openSpy.mock.invocationCallOrder[0]);
    expect(openSpy.mock.invocationCallOrder[0]).toBeLessThan(
      apiMocks.ackExternalSshLaunch.mock.invocationCallOrder[0],
    );
    const state = useWorkspaceStore.getState();
    expect(state.terminalPanes[0]).toMatchObject({
      machineId: "external:launch-1",
      mode: "ssh",
      prompt: "resolved-user@materialized.internal:~$",
      remoteHostId: "external:launch-1",
    });
    const lastGroup = state.machineGroups[state.machineGroups.length - 1];
    expect(lastGroup?.machines[lastGroup.machines.length - 1]).toMatchObject({
      authType: "agent",
      host: "materialized.internal",
      name: "Materialized SSH target",
      port: 2202,
      username: "resolved-user",
    });
    expect(
      apiMocks.listenExternalSshLaunches.mock.invocationCallOrder[0],
    ).toBeLessThan(
      apiMocks.takePendingExternalSshLaunches.mock.invocationCallOrder[0],
    );
    expect(apiMocks.takePendingExternalSshLaunches).toHaveBeenCalledTimes(2);
  });

  it("opens SFTP intent only in the transfer workbench and deduplicates delivery", async () => {
    const launch = createLaunch({
      intent: {
        kind: "sftpTransfer",
        remotePath: "/srv/releases/",
        selectedEntry: "artifact.zip",
      },
      username: "deploy",
    });
    apiMocks.takePendingExternalSshLaunches.mockResolvedValue([launch, launch]);

    render(<ExternalLaunchHost />);

    await waitFor(() =>
      expect(apiMocks.ackExternalSshLaunch).toHaveBeenCalledWith("launch-1"),
    );
    const state = useWorkspaceStore.getState();
    expect(state.terminalPanes).toHaveLength(0);
    expect(
      state.terminalTabs.filter(
        (tab) => tab.kind === "sftpTransfer" && tab.externalLaunchId === "launch-1",
      ),
    ).toHaveLength(1);
  });

  it("uses the global session-only SSH prompt before retrying materialization", async () => {
    apiMocks.takePendingExternalSshLaunches.mockResolvedValue([
      createLaunch({ username: "deploy" }),
    ]);
    apiMocks.materializeExternalSshLaunch
      .mockResolvedValueOnce({
        promptPlan: {
          prompts: [
            {
              host: "example.internal",
              port: 22,
              promptId: "prompt-1",
              reason: "password required",
              role: "target",
              secretKind: "password",
              username: "deploy",
            },
          ],
        },
        status: "promptRequired",
      })
      .mockResolvedValueOnce({ status: "ready", target: materializedTarget() });

    render(<ExternalLaunchHost />);

    await waitFor(() =>
      expect(apiMocks.ackExternalSshLaunch).toHaveBeenCalledWith("launch-1"),
    );
    expect(apiMocks.requestSshAuthPrompt).toHaveBeenCalledWith({
      defaultRememberInVault: false,
      prompt: expect.objectContaining({ promptId: "prompt-1" }),
    });
    expect(apiMocks.materializeExternalSshLaunch).toHaveBeenCalledTimes(2);
  });

  it("double-drain and duplicate queued events create at most one pane", async () => {
    const launch = createLaunch({ username: "deploy" });
    const openSpy = spyOnOpenExternalSshLaunch();
    apiMocks.takePendingExternalSshLaunches.mockResolvedValue([launch]);

    render(<ExternalLaunchHost />);

    await waitFor(() => expect(externalLaunchListener).toBeDefined());
    await act(async () => {
      externalLaunchListener?.({
        entrypoint: "single-instance",
        kind: "queued",
        launchId: launch.id,
        pendingCount: 1,
        sourceTool: "putty",
      });
      externalLaunchListener?.({
        entrypoint: "single-instance",
        kind: "queued",
        launchId: launch.id,
        pendingCount: 1,
        sourceTool: "putty",
      });
    });

    await waitFor(() =>
      expect(apiMocks.ackExternalSshLaunch).toHaveBeenCalledWith(launch.id),
    );
    await waitFor(() =>
      expect(
        apiMocks.takePendingExternalSshLaunches.mock.calls.length,
      ).toBeGreaterThanOrEqual(4),
    );
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(useWorkspaceStore.getState().terminalPanes).toHaveLength(1);
  });

  it("StrictMode effect replay does not materialize or open a launch twice", async () => {
    const openSpy = spyOnOpenExternalSshLaunch();
    apiMocks.takePendingExternalSshLaunches.mockResolvedValue([
      createLaunch({ username: "deploy" }),
    ]);

    render(
      <StrictMode>
        <ExternalLaunchHost />
      </StrictMode>,
    );

    await waitFor(() =>
      expect(apiMocks.ackExternalSshLaunch).toHaveBeenCalledWith("launch-1"),
    );
    expect(apiMocks.materializeExternalSshLaunch).toHaveBeenCalledTimes(1);
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(useWorkspaceStore.getState().terminalPanes).toHaveLength(1);
  });

  it("WebView host remount recognizes an already opened launch", async () => {
    const openSpy = spyOnOpenExternalSshLaunch();
    apiMocks.takePendingExternalSshLaunches.mockResolvedValue([
      createLaunch({ username: "deploy" }),
    ]);
    const first = render(<ExternalLaunchHost />);
    await waitFor(() => expect(openSpy).toHaveBeenCalledTimes(1));
    first.unmount();

    render(<ExternalLaunchHost />);

    await waitFor(() =>
      expect(
        apiMocks.takePendingExternalSshLaunches.mock.calls.length,
      ).toBeGreaterThanOrEqual(4),
    );
    expect(apiMocks.materializeExternalSshLaunch).toHaveBeenCalledTimes(1);
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(useWorkspaceStore.getState().terminalPanes).toHaveLength(1);
  });

  it("does not let an unmounted host finish an in-flight materialization", async () => {
    const openSpy = spyOnOpenExternalSshLaunch();
    let resolveFirstMaterialization:
      | ((target: ExternalLaunchMaterializedTarget) => void)
      | undefined;
    const firstMaterialization = new Promise<ExternalLaunchMaterializedTarget>(
      (resolve) => {
        resolveFirstMaterialization = resolve;
      },
    );
    apiMocks.materializeExternalSshLaunch
      .mockImplementationOnce(() => firstMaterialization)
      .mockResolvedValue(materializedTarget());
    apiMocks.takePendingExternalSshLaunches.mockResolvedValue([
      createLaunch({ username: "deploy" }),
    ]);

    const first = render(<ExternalLaunchHost />);
    await waitFor(() =>
      expect(apiMocks.materializeExternalSshLaunch).toHaveBeenCalledTimes(1),
    );
    first.unmount();
    render(<ExternalLaunchHost />);

    await waitFor(() => expect(openSpy).toHaveBeenCalledTimes(1));
    await act(async () => {
      resolveFirstMaterialization?.(materializedTarget());
      await firstMaterialization;
    });

    expect(apiMocks.materializeExternalSshLaunch).toHaveBeenCalledTimes(2);
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(useWorkspaceStore.getState().terminalPanes).toHaveLength(1);
  });

  it("shows a username resolution dialog and cancels unresolved launches", async () => {
    const user = userEvent.setup();
    apiMocks.takePendingExternalSshLaunches.mockResolvedValue([
      createLaunch({ username: undefined }),
    ]);

    render(<ExternalLaunchHost />);
    await screen.findByRole("dialog", { name: "补全 SSH 用户名" });
    await user.click(screen.getByRole("button", { name: "取消" }));

    await waitFor(() =>
      expect(apiMocks.cancelExternalSshLaunch).toHaveBeenCalledWith("launch-1"),
    );
    expect(useWorkspaceStore.getState().terminalPanes).toHaveLength(0);
  });

  it("resolves missing usernames before opening and acknowledging the launch", async () => {
    const user = userEvent.setup();
    const openSpy = spyOnOpenExternalSshLaunch();
    apiMocks.takePendingExternalSshLaunches.mockResolvedValue([
      createLaunch({ username: undefined }),
    ]);

    render(<ExternalLaunchHost />);
    await user.type(await screen.findByLabelText("用户名"), "ops");
    await user.click(screen.getByRole("button", { name: "打开" }));

    await waitFor(() =>
      expect(apiMocks.ackExternalSshLaunch).toHaveBeenCalledWith("launch-1"),
    );
    expect(apiMocks.materializeExternalSshLaunch).toHaveBeenCalledWith({
      launchId: "launch-1",
      username: "ops",
    });
    expect(openSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "launch-1",
        target: expect.objectContaining({
          host: "materialized.internal",
          username: "resolved-user",
        }),
      }),
    );
    expect(
      apiMocks.materializeExternalSshLaunch.mock.invocationCallOrder[0],
    ).toBeLessThan(openSpy.mock.invocationCallOrder[0]);
    expect(openSpy.mock.invocationCallOrder[0]).toBeLessThan(
      apiMocks.ackExternalSshLaunch.mock.invocationCallOrder[0],
    );
    const state = useWorkspaceStore.getState();
    expect(state.terminalPanes[0]).toMatchObject({
      machineId: "external:launch-1",
      prompt: "resolved-user@materialized.internal:~$",
    });
  });

  it("requires an explicit fingerprint decision for an unknown host key", async () => {
    const user = userEvent.setup();
    const openSpy = spyOnOpenExternalSshLaunch();
    const inspection = unknownHostKeyInspection();
    apiMocks.inspectExternalLaunchHostKey.mockResolvedValue(inspection);
    apiMocks.trustExternalLaunchHostKey.mockResolvedValue({
      ...inspection,
      status: "known",
    });
    apiMocks.takePendingExternalSshLaunches.mockResolvedValue([
      createLaunch({ username: "deploy" }),
    ]);

    render(<ExternalLaunchHost />);

    expect(
      await screen.findByRole("dialog", { name: "确认外部 SSH 目标" }),
    ).toBeInTheDocument();
    expect(screen.getByText("SHA256:test-fingerprint")).toBeVisible();
    expect(openSpy).not.toHaveBeenCalled();
    expect(apiMocks.ackExternalSshLaunch).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "信任并连接" }));

    await waitFor(() =>
      expect(apiMocks.trustExternalLaunchHostKey).toHaveBeenCalledWith(
        "launch-1",
        "SHA256:test-fingerprint",
      ),
    );
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(apiMocks.ackExternalSshLaunch).toHaveBeenCalledWith("launch-1");
  });

  it("cancels an unknown host key prompt without trusting or opening", async () => {
    const user = userEvent.setup();
    const openSpy = spyOnOpenExternalSshLaunch();
    apiMocks.inspectExternalLaunchHostKey.mockResolvedValue(
      unknownHostKeyInspection(),
    );
    apiMocks.takePendingExternalSshLaunches.mockResolvedValue([
      createLaunch({ username: "deploy" }),
    ]);

    render(<ExternalLaunchHost />);
    await screen.findByRole("dialog", { name: "确认外部 SSH 目标" });
    await user.click(screen.getByRole("button", { name: "取消该请求" }));

    await waitFor(() =>
      expect(apiMocks.cancelExternalSshLaunch).toHaveBeenCalledWith("launch-1"),
    );
    expect(apiMocks.trustExternalLaunchHostKey).not.toHaveBeenCalled();
    expect(openSpy).not.toHaveBeenCalled();
    expect(apiMocks.ackExternalSshLaunch).not.toHaveBeenCalled();
  });

  it("hard-fails a changed host key without exposing a trust action", async () => {
    const openSpy = spyOnOpenExternalSshLaunch();
    apiMocks.inspectExternalLaunchHostKey.mockResolvedValue({
      ...knownHostKeyInspection(),
      status: "changed",
    });
    apiMocks.takePendingExternalSshLaunches.mockResolvedValue([
      createLaunch({ username: "deploy" }),
    ]);

    render(<ExternalLaunchHost />);

    expect(
      await screen.findByRole("dialog", { name: "外部 SSH 启动失败" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/主机密钥已变化/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "信任并连接" })).toBeNull();
    expect(apiMocks.trustExternalLaunchHostKey).not.toHaveBeenCalled();
    expect(openSpy).not.toHaveBeenCalled();
    expect(apiMocks.ackExternalSshLaunch).not.toHaveBeenCalled();
  });

  it("fails closed when the host-key adapter reports a revoked status", async () => {
    const openSpy = spyOnOpenExternalSshLaunch();
    apiMocks.inspectExternalLaunchHostKey.mockResolvedValue({
      ...knownHostKeyInspection(),
      status: "revoked" as ExternalHostKeyInspection["status"],
    });
    apiMocks.takePendingExternalSshLaunches.mockResolvedValue([
      createLaunch({ username: "deploy" }),
    ]);

    render(<ExternalLaunchHost />);

    expect(
      await screen.findByRole("dialog", { name: "外部 SSH 启动失败" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/主机身份结果与当前启动请求不一致/)).toBeInTheDocument();
    expect(apiMocks.trustExternalLaunchHostKey).not.toHaveBeenCalled();
    expect(openSpy).not.toHaveBeenCalled();
    expect(apiMocks.ackExternalSshLaunch).not.toHaveBeenCalled();
  });

  it.each([
    {
      production: true,
      safety: "production" as const,
      warning: "生产目标",
    },
    {
      production: true,
      safety: "restricted-unknown" as const,
      warning: "受限的未知目标",
    },
  ])(
    "requires confirmation for a $safety target with a known host key",
    async ({ production, safety, warning }) => {
      const user = userEvent.setup();
      const openSpy = spyOnOpenExternalSshLaunch();
      apiMocks.materializeExternalSshLaunch.mockResolvedValue(
        materializedTarget({ production, safety }),
      );
      apiMocks.takePendingExternalSshLaunches.mockResolvedValue([
        createLaunch({ username: "deploy" }),
      ]);

      render(<ExternalLaunchHost />);

      await screen.findByRole("dialog", { name: "确认外部 SSH 目标" });
      expect(screen.getByText(warning)).toBeVisible();
      expect(openSpy).not.toHaveBeenCalled();
      await user.click(screen.getByRole("button", { name: "确认并连接" }));

      await waitFor(() => expect(openSpy).toHaveBeenCalledTimes(1));
      expect(apiMocks.trustExternalLaunchHostKey).not.toHaveBeenCalled();
      expect(apiMocks.ackExternalSshLaunch).toHaveBeenCalledWith("launch-1");
    },
  );

  it.each([
    {
      launch: createLaunch({ entrypoint: "protocol", username: "deploy" }),
      visibleReason: "系统协议链接",
    },
    {
      launch: createLaunch({
        remoteCommand: "printf external-command-canary",
        username: "deploy",
      }),
      visibleReason: "连接后执行命令",
    },
  ])(
    "requires confirmation for $visibleReason even on a known non-production target",
    async ({ launch, visibleReason }) => {
      const user = userEvent.setup();
      const openSpy = spyOnOpenExternalSshLaunch();
      apiMocks.takePendingExternalSshLaunches.mockResolvedValue([launch]);

      render(<ExternalLaunchHost />);

      await screen.findByRole("dialog", { name: "确认外部 SSH 目标" });
      expect(screen.getByText(visibleReason)).toBeVisible();
      expect(openSpy).not.toHaveBeenCalled();
      await user.click(screen.getByRole("button", { name: "确认并连接" }));

      await waitFor(() => expect(openSpy).toHaveBeenCalledTimes(1));
      expect(apiMocks.ackExternalSshLaunch).toHaveBeenCalledWith("launch-1");
    },
  );

  it("rejects a host-key inspection that is not bound to the current launch", async () => {
    const openSpy = spyOnOpenExternalSshLaunch();
    apiMocks.inspectExternalLaunchHostKey.mockResolvedValue({
      ...knownHostKeyInspection(),
      launchId: "stale-launch",
    });
    apiMocks.takePendingExternalSshLaunches.mockResolvedValue([
      createLaunch({ username: "deploy" }),
    ]);

    render(<ExternalLaunchHost />);

    expect(
      await screen.findByRole("dialog", { name: "外部 SSH 启动失败" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/当前启动请求不一致/)).toBeInTheDocument();
    expect(openSpy).not.toHaveBeenCalled();
    expect(apiMocks.ackExternalSshLaunch).not.toHaveBeenCalled();
  });

  it("retries ACK after opening a confirmed target without creating another pane", async () => {
    const user = userEvent.setup();
    const openSpy = spyOnOpenExternalSshLaunch();
    apiMocks.materializeExternalSshLaunch.mockResolvedValue(
      materializedTarget({ production: true, safety: "production" }),
    );
    apiMocks.ackExternalSshLaunch
      .mockRejectedValueOnce(new Error("ack temporarily unavailable"))
      .mockResolvedValue(1);
    apiMocks.takePendingExternalSshLaunches.mockResolvedValue([
      createLaunch({ username: "deploy" }),
    ]);

    render(<ExternalLaunchHost />);
    await screen.findByRole("dialog", { name: "确认外部 SSH 目标" });
    await user.click(screen.getByRole("button", { name: "确认并连接" }));
    await screen.findByText("外部 SSH 安全确认失败");
    expect(openSpy).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "确认并连接" }));

    await waitFor(() => expect(apiMocks.ackExternalSshLaunch).toHaveBeenCalledTimes(2));
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(useWorkspaceStore.getState().terminalPanes).toHaveLength(1);
  });

  it("retries a direct-launch ACK without materializing or opening again", async () => {
    const user = userEvent.setup();
    const openSpy = spyOnOpenExternalSshLaunch();
    apiMocks.ackExternalSshLaunch
      .mockRejectedValueOnce(new Error("ack temporarily unavailable"))
      .mockResolvedValue(1);
    apiMocks.takePendingExternalSshLaunches.mockResolvedValue([
      createLaunch({ username: "deploy" }),
    ]);

    render(<ExternalLaunchHost />);
    await screen.findByRole("dialog", { name: "外部 SSH 启动失败" });
    expect(openSpy).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "重试" }));

    await waitFor(() => expect(apiMocks.ackExternalSshLaunch).toHaveBeenCalledTimes(2));
    expect(apiMocks.materializeExternalSshLaunch).toHaveBeenCalledTimes(1);
    expect(apiMocks.inspectExternalLaunchHostKey).toHaveBeenCalledTimes(1);
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(useWorkspaceStore.getState().terminalPanes).toHaveLength(1);
  });

  it("rejects a trust result when the fingerprint changed during confirmation", async () => {
    const user = userEvent.setup();
    const openSpy = spyOnOpenExternalSshLaunch();
    apiMocks.inspectExternalLaunchHostKey.mockResolvedValue(
      unknownHostKeyInspection(),
    );
    apiMocks.trustExternalLaunchHostKey.mockResolvedValue({
      ...knownHostKeyInspection(),
      fingerprint: "SHA256:changed-during-confirmation",
    });
    apiMocks.takePendingExternalSshLaunches.mockResolvedValue([
      createLaunch({ username: "deploy" }),
    ]);

    render(<ExternalLaunchHost />);
    await screen.findByRole("dialog", { name: "确认外部 SSH 目标" });
    await user.click(screen.getByRole("button", { name: "信任并连接" }));

    expect(await screen.findByText("外部 SSH 安全确认失败")).toBeVisible();
    expect(screen.getByText(/主机指纹确认结果已变化/)).toBeInTheDocument();
    expect(openSpy).not.toHaveBeenCalled();
    expect(apiMocks.ackExternalSshLaunch).not.toHaveBeenCalled();
  });

  it("shows a recoverable failure dialog when materialization fails", async () => {
    const user = userEvent.setup();
    const openSpy = spyOnOpenExternalSshLaunch();
    apiMocks.materializeExternalSshLaunch.mockRejectedValue(
      new Error("Unknown server key token=external-launch-secret"),
    );
    apiMocks.takePendingExternalSshLaunches.mockResolvedValue([
      createLaunch({ username: "deploy" }),
    ]);

    render(<ExternalLaunchHost />);

    await waitFor(() =>
      expect(apiMocks.materializeExternalSshLaunch).toHaveBeenCalledWith({
        launchId: "launch-1",
        username: "deploy",
      }),
    );
    expect(openSpy).not.toHaveBeenCalled();
    expect(apiMocks.ackExternalSshLaunch).not.toHaveBeenCalled();
    expect(useWorkspaceStore.getState().terminalPanes).toHaveLength(0);
    expect(
      await screen.findByRole("dialog", { name: "外部 SSH 启动失败" }),
    ).toBeInTheDocument();
    expect(screen.getByText("可重试或取消该请求。")).toBeVisible();
    const technicalDetail = screen.getByText(/Unknown server key/);
    expect(technicalDetail.closest("details")).not.toHaveAttribute("open");
    expect(screen.queryByText(/external-launch-secret/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "取消该请求" }));

    await waitFor(() =>
      expect(apiMocks.cancelExternalSshLaunch).toHaveBeenCalledWith("launch-1"),
    );
  });

  it("shows visible feedback when an external launch event is rejected before pending intake", async () => {
    apiMocks.takePendingExternalSshLaunches.mockResolvedValue([]);

    render(<ExternalLaunchHost />);

    await waitFor(() => expect(externalLaunchListener).toBeDefined());
    await act(async () => {
      externalLaunchListener?.({
        entrypoint: "single-instance",
        kind: "rejected",
        message: "no external SSH launch arguments detected",
        pendingCount: 0,
        sourceTool: "mobaxterm",
      });
    });

    expect(
      await screen.findByRole("dialog", { name: "外部 SSH 启动未接收" }),
    ).toBeInTheDocument();
    expect(screen.getByText("外部 SSH 请求未接收")).toBeVisible();
    const technicalDetail = screen.getByText(
      "no external SSH launch arguments detected",
    );
    expect(technicalDetail.closest("details")).not.toHaveAttribute("open");
  });

  it("shows visible feedback when draining pending launches fails", async () => {
    apiMocks.takePendingExternalSshLaunches.mockRejectedValue(
      new Error("external launch intake unavailable"),
    );

    render(<ExternalLaunchHost />);

    expect(
      await screen.findByRole("dialog", { name: "外部 SSH 启动未接收" }),
    ).toBeInTheDocument();
    expect(screen.getByText("外部 SSH 请求未读取")).toBeVisible();
    const technicalDetail = screen.getByText(
      /external launch intake unavailable/,
    );
    expect(technicalDetail.closest("details")).not.toHaveAttribute("open");
    expect(useWorkspaceStore.getState().terminalPanes).toHaveLength(0);
  });
});
