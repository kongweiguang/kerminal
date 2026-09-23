/**
 * SFTP managed transfer queue facade tests.
 *
 * @author kongweiguang
 */

import { act, renderHook } from "@testing-library/react";
import type { SetStateAction } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SftpTransferSummary } from "../../../../src/lib/sftpApi";
import { useSftpManagedTransferQueue } from "../../../../src/features/sftp/useSftpManagedTransferQueue";

const sftpApiMock = vi.hoisted(() => ({
  cancelSftpTransfer: vi.fn(),
  clearCompletedSftpTransfers: vi.fn(),
  enqueueSftpTransfer: vi.fn(),
  retrySftpTransfer: vi.fn(),
}));

vi.mock("../../../../src/lib/sftpApi", async () => {
  const actual = await vi.importActual<typeof import("../../../../src/lib/sftpApi")>(
    "../../../../src/lib/sftpApi",
  );
  return {
    ...actual,
    cancelSftpTransfer: sftpApiMock.cancelSftpTransfer,
    clearCompletedSftpTransfers: sftpApiMock.clearCompletedSftpTransfers,
    enqueueSftpTransfer: sftpApiMock.enqueueSftpTransfer,
    retrySftpTransfer: sftpApiMock.retrySftpTransfer,
  };
});

describe("useSftpManagedTransferQueue", () => {
  beforeEach(() => {
    sftpApiMock.cancelSftpTransfer.mockReset();
    sftpApiMock.clearCompletedSftpTransfers.mockReset();
    sftpApiMock.enqueueSftpTransfer.mockReset();
    sftpApiMock.retrySftpTransfer.mockReset();
  });

  it("upserts a canceled transfer, reports success, and refreshes the queue", async () => {
    const canceledTransfer = transferSummary({
      cancelRequested: true,
      id: "transfer-running",
      status: "canceled",
      updatedAt: 5,
    });
    sftpApiMock.cancelSftpTransfer.mockResolvedValue(canceledTransfer);
    const transfersRef = {
      current: [
        transferSummary({ createdAt: 10, id: "transfer-new" }),
        transferSummary({ createdAt: 1, id: "transfer-running" }),
      ],
    };
    const onCancelSuccess = vi.fn();
    const onError = vi.fn();
    const refreshTransfers = vi.fn().mockResolvedValue(undefined);
    const setTransfers = createTransferSetter(transfersRef);

    const { result } = renderHook(() =>
      useSftpManagedTransferQueue({
        onCancelSuccess,
        onError,
        refreshTransfers,
        setTransfers,
      }),
    );

    await act(async () => {
      await result.current.cancelTransfer("transfer-running");
    });

    expect(sftpApiMock.cancelSftpTransfer).toHaveBeenCalledWith({
      transferId: "transfer-running",
    });
    expect(transfersRef.current.map((transfer) => transfer.id)).toEqual([
      "transfer-new",
      "transfer-running",
    ]);
    expect(transfersRef.current[1]).toMatchObject({
      cancelRequested: true,
      status: "canceled",
    });
    expect(onCancelSuccess).toHaveBeenCalledWith(canceledTransfer);
    expect(refreshTransfers).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it("reports cancel failures without mutating or refreshing the queue", async () => {
    sftpApiMock.cancelSftpTransfer.mockRejectedValue(new Error("offline"));
    const transfersRef = { current: [transferSummary()] };
    const onCancelSuccess = vi.fn();
    const onError = vi.fn();
    const refreshTransfers = vi.fn().mockResolvedValue(undefined);
    const setTransfers = createTransferSetter(transfersRef);

    const { result } = renderHook(() =>
      useSftpManagedTransferQueue({
        onCancelSuccess,
        onError,
        refreshTransfers,
        setTransfers,
      }),
    );

    await act(async () => {
      await result.current.cancelTransfer("transfer-running");
    });

    expect(setTransfers).toHaveBeenCalledTimes(2);
    expect(onCancelSuccess).not.toHaveBeenCalled();
    expect(refreshTransfers).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(new Error("offline"));
    expect(transfersRef.current.map((transfer) => transfer.id)).toEqual([
      "transfer-1",
    ]);
    expect(transfersRef.current[0]).toMatchObject({
      cancelRequested: false,
    });
    expect(transfersRef.current[0].phase).toBeUndefined();
  });

  it("replaces the queue with sorted clear-completed results", async () => {
    const remainingRunningTransfer = transferSummary({
      createdAt: 1,
      id: "transfer-running",
      status: "running",
    });
    const newerQueuedTransfer = transferSummary({
      createdAt: 10,
      id: "transfer-queued",
      status: "queued",
    });
    sftpApiMock.clearCompletedSftpTransfers.mockResolvedValue([
      remainingRunningTransfer,
      newerQueuedTransfer,
    ]);
    const transfersRef = {
      current: [
        transferSummary({ id: "transfer-finished", status: "succeeded" }),
      ],
    };
    const onClearSuccess = vi.fn();
    const onError = vi.fn();
    const setTransfers = createTransferSetter(transfersRef);

    const { result } = renderHook(() =>
      useSftpManagedTransferQueue({
        onClearSuccess,
        onError,
        setTransfers,
      }),
    );

    await act(async () => {
      await result.current.clearFinishedTransfers();
    });

    expect(sftpApiMock.clearCompletedSftpTransfers).toHaveBeenCalledTimes(1);
    expect(transfersRef.current.map((transfer) => transfer.id)).toEqual([
      "transfer-running",
      "transfer-queued",
    ]);
    expect(onClearSuccess).toHaveBeenCalledWith(transfersRef.current);
    expect(onError).not.toHaveBeenCalled();
  });

  it("scopes cancel and clear mutations to the active transfer view", async () => {
    const canceledTransfer = transferSummary({
      id: "transfer-running",
      status: "canceled",
      viewScope: "sftp-workbench:tab-a",
    });
    sftpApiMock.cancelSftpTransfer.mockResolvedValue(canceledTransfer);
    sftpApiMock.clearCompletedSftpTransfers.mockResolvedValue([]);
    const transfersRef = {
      current: [transferSummary({ id: "transfer-running" })],
    };
    const setTransfers = createTransferSetter(transfersRef);

    const { result } = renderHook(() =>
      useSftpManagedTransferQueue({
        setTransfers,
        viewScope: "sftp-workbench:tab-a",
      }),
    );

    await act(async () => {
      await result.current.cancelTransfer("transfer-running");
      await result.current.clearFinishedTransfers();
    });

    expect(sftpApiMock.cancelSftpTransfer).toHaveBeenCalledWith({
      transferId: "transfer-running",
      viewScope: "sftp-workbench:tab-a",
    });
    expect(sftpApiMock.clearCompletedSftpTransfers).toHaveBeenCalledWith({
      viewScope: "sftp-workbench:tab-a",
    });
  });

  it("retries a safely retryable failed transfer by id and refreshes the queue", async () => {
    const failedTransfer = transferSummary({
      conflictPolicy: "rename",
      id: "failed-download",
      status: "failed",
      viewScope: "old-scope",
    });
    const queuedRetry = transferSummary({
      conflictPolicy: "rename",
      id: "retry-download",
      status: "queued",
      viewScope: "sftp-workbench:tab-a",
    });
    sftpApiMock.retrySftpTransfer.mockResolvedValue(queuedRetry);
    const transfersRef = { current: [failedTransfer] };
    const onRetrySuccess = vi.fn();
    const onRetryUnavailable = vi.fn();
    const onError = vi.fn();
    const refreshTransfers = vi.fn().mockResolvedValue(undefined);
    const setTransfers = createTransferSetter(transfersRef);

    const { result } = renderHook(() =>
      useSftpManagedTransferQueue({
        onError,
        onRetrySuccess,
        onRetryUnavailable,
        refreshTransfers,
        setTransfers,
        viewScope: "sftp-workbench:tab-a",
      }),
    );

    await act(async () => {
      await result.current.retryTransfer(failedTransfer);
    });

    expect(sftpApiMock.retrySftpTransfer).toHaveBeenCalledWith({
      transferId: "failed-download",
      viewScope: "sftp-workbench:tab-a",
    });
    expect(transfersRef.current.map((transfer) => transfer.id)).toEqual([
      "retry-download",
      "failed-download",
    ]);
    expect(onRetrySuccess).toHaveBeenCalledWith(queuedRetry);
    expect(refreshTransfers).toHaveBeenCalledTimes(1);
    expect(onRetryUnavailable).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it("retries a safely retryable canceled transfer by id", async () => {
    const canceledTransfer = transferSummary({
      conflictPolicy: "overwrite",
      id: "canceled-upload",
      status: "canceled",
    });
    const queuedRetry = transferSummary({
      conflictPolicy: "overwrite",
      id: "retry-upload",
      status: "queued",
    });
    sftpApiMock.retrySftpTransfer.mockResolvedValue(queuedRetry);
    const transfersRef = { current: [canceledTransfer] };
    const setTransfers = createTransferSetter(transfersRef);

    const { result } = renderHook(() =>
      useSftpManagedTransferQueue({
        setTransfers,
      }),
    );

    await act(async () => {
      await result.current.retryTransfer(canceledTransfer);
    });

    expect(sftpApiMock.retrySftpTransfer).toHaveBeenCalledWith({
      transferId: "canceled-upload",
    });
    expect(transfersRef.current.map((transfer) => transfer.id)).toEqual([
      "retry-upload",
      "canceled-upload",
    ]);
  });

  it("reports non-retryable failed transfers without enqueueing", async () => {
    const failedRemoteCopy = transferSummary({
      conflictPolicy: "overwrite",
      operation: "remoteCopy",
      status: "failed",
    });
    const transfersRef = { current: [failedRemoteCopy] };
    const onRetryUnavailable = vi.fn();
    const setTransfers = createTransferSetter(transfersRef);

    const { result } = renderHook(() =>
      useSftpManagedTransferQueue({
        onRetryUnavailable,
        setTransfers,
      }),
    );

    await act(async () => {
      await result.current.retryTransfer(failedRemoteCopy);
    });

    expect(sftpApiMock.enqueueSftpTransfer).not.toHaveBeenCalled();
    expect(setTransfers).not.toHaveBeenCalled();
    expect(onRetryUnavailable).toHaveBeenCalledWith(
      "该传输类型暂不支持安全重试。",
    );
  });

  it("does not roll a terminal snapshot back when cancel fails late", async () => {
    let rejectCancel!: (error: Error) => void;
    sftpApiMock.cancelSftpTransfer.mockImplementation(() => new Promise((_, reject) => { rejectCancel = reject; }));
    const transfersRef = { current: [transferSummary({ status: "running" })] };
    const { result } = renderHook(() => useSftpManagedTransferQueue({ setTransfers: createTransferSetter(transfersRef) }));
    const pending = result.current.cancelTransfer("transfer-1");
    expect(transfersRef.current[0].cancelRequested).toBe(true);
    transfersRef.current = [{ ...transfersRef.current[0], status: "canceled" }];
    await act(async () => { rejectCancel(new Error("late failure")); await pending; });
    expect(transfersRef.current[0].status).toBe("canceled");
  });

  /**
   * 取消请求可能与新的服务端进度并行；失败回滚只能撤销乐观状态，不能倒退字节数。
   */
  it("preserves progress received while an unsuccessful cancel is pending", async () => {
    let rejectCancel!: (error: Error) => void;
    sftpApiMock.cancelSftpTransfer.mockImplementation(
      () => new Promise((_, reject) => { rejectCancel = reject; }),
    );
    const transfersRef = {
      current: [transferSummary({ bytesTransferred: 10, phase: "uploading", status: "running" })],
    };
    const { result } = renderHook(() =>
      useSftpManagedTransferQueue({ setTransfers: createTransferSetter(transfersRef) }),
    );
    const pending = result.current.cancelTransfer("transfer-1");
    transfersRef.current = [{
      ...transfersRef.current[0],
      bytesTransferred: 30,
      updatedAt: 2,
    }];

    await act(async () => { rejectCancel(new Error("offline")); await pending; });

    expect(transfersRef.current[0]).toMatchObject({
      bytesTransferred: 30,
      cancelRequested: false,
      phase: "uploading",
      status: "running",
      updatedAt: 2,
    });
  });

  it("gates concurrent retries and marks the predecessor immediately", async () => {
    let finishRetry!: (summary: SftpTransferSummary) => void;
    sftpApiMock.retrySftpTransfer.mockImplementation(() => new Promise((resolve) => { finishRetry = resolve; }));
    const failed = transferSummary({ status: "failed", conflictPolicy: "overwrite" });
    const transfersRef = { current: [failed] };
    const { result } = renderHook(() => useSftpManagedTransferQueue({ setTransfers: createTransferSetter(transfersRef) }));
    const pending = result.current.retryTransfer(failed);
    await result.current.retryTransfer(failed);
    expect(sftpApiMock.retrySftpTransfer).toHaveBeenCalledTimes(1);
    await act(async () => { finishRetry(transferSummary({ id: "successor" })); await pending; });
    expect(transfersRef.current.find((item) => item.id === failed.id)?.successorId).toBe("successor");
  });

  it("reports clear failures without replacing the queue", async () => {
    sftpApiMock.clearCompletedSftpTransfers.mockRejectedValue(
      new Error("clear failed"),
    );
    const transfersRef = { current: [transferSummary()] };
    const onClearSuccess = vi.fn();
    const onError = vi.fn();
    const setTransfers = createTransferSetter(transfersRef);

    const { result } = renderHook(() =>
      useSftpManagedTransferQueue({
        onClearSuccess,
        onError,
        setTransfers,
      }),
    );

    await act(async () => {
      await result.current.clearFinishedTransfers();
    });

    expect(setTransfers).not.toHaveBeenCalled();
    expect(onClearSuccess).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(new Error("clear failed"));
    expect(transfersRef.current.map((transfer) => transfer.id)).toEqual([
      "transfer-1",
    ]);
  });
});

function createTransferSetter(transfersRef: { current: SftpTransferSummary[] }) {
  return vi.fn((value: SetStateAction<SftpTransferSummary[]>) => {
    transfersRef.current =
      typeof value === "function" ? value(transfersRef.current) : value;
  });
}

function transferSummary(
  overrides: Partial<SftpTransferSummary> = {},
): SftpTransferSummary {
  return {
    bytesTransferred: 0,
    cancelRequested: false,
    createdAt: 1,
    direction: "upload",
    hostId: "host-right",
    id: "transfer-1",
    kind: "file",
    localPath: "/tmp/source.log",
    operation: "upload",
    remotePath: "/srv/source.log",
    source: {
      kind: "local",
      path: "/tmp/source.log",
    },
    status: "queued",
    target: {
      hostId: "host-right",
      hostLabel: "host-right",
      kind: "remote",
      path: "/srv/source.log",
    },
    transportMode: "singleHostSftp",
    updatedAt: 1,
    ...overrides,
  };
}
