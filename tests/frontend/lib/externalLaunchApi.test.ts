// @author kongweiguang

import { beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  isTauri: vi.fn(),
  listen: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => apiMocks.invoke(...args),
  isTauri: () => apiMocks.isTauri(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => apiMocks.listen(...args),
}));

describe("externalLaunchApi", () => {
  beforeEach(() => {
    vi.resetModules();
    apiMocks.invoke.mockReset();
    apiMocks.isTauri.mockReset();
    apiMocks.listen.mockReset();
  });

  it("calls the external launch Tauri commands", async () => {
    apiMocks.isTauri.mockReturnValue(true);
    apiMocks.invoke
      .mockResolvedValueOnce([{ id: "launch-1" }])
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce({ targetId: "external:launch-1" })
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce({
        intake: { pendingCount: 0 },
        secrets: { activeSecretCount: 0 },
      });
    const {
      ackExternalSshLaunch,
      cancelExternalSshLaunch,
      closeExternalSshLaunch,
      getExternalLaunchSnapshot,
      materializeExternalSshLaunch,
      takePendingExternalSshLaunches,
    } = await import("../../../src/lib/externalLaunchApi");

    await expect(takePendingExternalSshLaunches()).resolves.toEqual([
      { id: "launch-1" },
    ]);
    await expect(ackExternalSshLaunch("launch-1")).resolves.toBe(1);
    await expect(
      materializeExternalSshLaunch({ launchId: "launch-1", username: "deploy" }),
    ).resolves.toEqual({ targetId: "external:launch-1" });
    await expect(cancelExternalSshLaunch("launch-2")).resolves.toBe(2);
    await expect(closeExternalSshLaunch("launch-3")).resolves.toBe(3);
    await expect(getExternalLaunchSnapshot()).resolves.toMatchObject({
      intake: { pendingCount: 0 },
    });

    expect(apiMocks.invoke).toHaveBeenNthCalledWith(
      1,
      "external_launch_take_pending",
    );
    expect(apiMocks.invoke).toHaveBeenNthCalledWith(2, "external_launch_ack", {
      launchId: "launch-1",
    });
    expect(apiMocks.invoke).toHaveBeenNthCalledWith(
      3,
      "external_launch_materialize",
      { request: { launchId: "launch-1", username: "deploy" } },
    );
    expect(apiMocks.invoke).toHaveBeenNthCalledWith(
      4,
      "external_launch_cancel",
      { launchId: "launch-2" },
    );
    expect(apiMocks.invoke).toHaveBeenNthCalledWith(
      5,
      "external_launch_close",
      { launchId: "launch-3" },
    );
    expect(apiMocks.invoke).toHaveBeenNthCalledWith(
      6,
      "external_launch_snapshot",
    );
  });

  it("listens to queued external launch events and filters invalid payloads", async () => {
    apiMocks.isTauri.mockReturnValue(true);
    const unlisten = vi.fn();
    const handler = vi.fn();
    let listener:
      ((event: { payload?: Record<string, unknown> }) => void) | undefined;
    apiMocks.listen.mockImplementation(async (_event, callback) => {
      listener = callback as typeof listener;
      return unlisten;
    });
    const { EXTERNAL_SSH_LAUNCH_EVENT, listenExternalSshLaunches } =
      await import("../../../src/lib/externalLaunchApi");

    const returnedUnlisten = await listenExternalSshLaunches(handler);

    expect(apiMocks.listen).toHaveBeenCalledWith(
      EXTERNAL_SSH_LAUNCH_EVENT,
      expect.any(Function),
    );
    listener?.({
      payload: {
        entrypoint: "single-instance",
        kind: "queued",
        launchId: "launch-1",
        pendingCount: 1,
      },
    });
    listener?.({
      payload: {
        entrypoint: "single-instance",
        kind: "queued",
        pendingCount: "1",
      },
    });
    listener?.({});
    returnedUnlisten();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "queued", launchId: "launch-1" }),
    );
    expect(unlisten).toHaveBeenCalled();
  });

  it("uses empty browser preview behavior without secrets or Tauri calls", async () => {
    apiMocks.isTauri.mockReturnValue(false);
    const {
      ackExternalSshLaunch,
      getExternalLaunchSnapshot,
      listenExternalSshLaunches,
      materializeExternalSshLaunch,
      takePendingExternalSshLaunches,
    } = await import("../../../src/lib/externalLaunchApi");

    await expect(takePendingExternalSshLaunches()).resolves.toEqual([]);
    await expect(ackExternalSshLaunch("launch-1")).resolves.toBe(0);
    await expect(
      materializeExternalSshLaunch({ launchId: "launch-1", username: "deploy" }),
    ).resolves.toMatchObject({
      status: "ready",
      target: {
        targetId: "external:launch-1",
        username: "deploy",
      },
    });
    await expect(getExternalLaunchSnapshot()).resolves.toMatchObject({
      intake: {
        pendingCount: 0,
        policy: {
          acceptVendorArgs: true,
          autoOpenSftp: false,
          disabledTools: [],
          enabled: true,
        },
      },
      secrets: { activeSecretCount: 0 },
    });
    const unlisten = await listenExternalSshLaunches(vi.fn());
    unlisten();

    expect(apiMocks.invoke).not.toHaveBeenCalled();
    expect(apiMocks.listen).not.toHaveBeenCalled();
  });

  it("rejects invalid browser preview launch ids", async () => {
    apiMocks.isTauri.mockReturnValue(false);
    const { cancelExternalSshLaunch } =
      await import("../../../src/lib/externalLaunchApi");

    await expect(cancelExternalSshLaunch("  ")).rejects.toThrow(
      "External SSH launch id cannot be empty",
    );
    await expect(cancelExternalSshLaunch("bad\nid")).rejects.toThrow(
      "External SSH launch id cannot contain newline",
    );
  });
});
