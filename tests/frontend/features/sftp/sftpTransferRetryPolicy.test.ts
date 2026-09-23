/**
 * SFTP transfer retry policy tests.
 *
 * @author kongweiguang
 */

import { describe, expect, it } from "vitest";
import type { SftpTransferSummary } from "../../../../src/lib/sftpApi";
import { resolveSftpTransferRetry } from "../../../../src/features/sftp/sftpTransferRetryPolicy";

describe("resolveSftpTransferRetry", () => {
  it("returns only the source task id for a failed transfer", () => {
    const decision = resolveSftpTransferRetry(
      transferSummary({
        conflictPolicy: "rename",
        direction: "upload",
        status: "failed",
        viewScope: "sftp-workbench:tab-a",
      }),
    );

    expect(decision.canRetry).toBe(true);
    if (!decision.canRetry) {
      throw new Error("expected retryable transfer");
    }
    expect(decision.transferId).toBe("transfer-1");
    expect(decision.actionLabel).toBe("重新传输");
    expect(decision.statusMessage).toBe(
      "已请求重新传输；该任务没有可用断点。",
    );
  });

  it("only promises continuation when the backend confirms a resumable checkpoint", () => {
    const decision = resolveSftpTransferRetry(
      transferSummary({
        conflictPolicy: "overwrite",
        resumable: true,
        status: "failed",
      }),
    );

    expect(decision).toMatchObject({
      actionLabel: "继续传输",
      canRetry: true,
      transferId: "transfer-1",
    });
  });

  it("allows canceled transfers to be retried by id", () => {
    const decision = resolveSftpTransferRetry(
      transferSummary({
        conflictPolicy: "overwrite",
        status: "canceled",
      }),
    );

    expect(decision.canRetry).toBe(true);
    if (!decision.canRetry) {
      throw new Error("expected retryable canceled transfer");
    }
    expect(decision.transferId).toBe("transfer-1");
    expect(decision.actionLabel).toBe("重新传输");
  });

  it("closes the old retry entry after a successor has been created", () => {
    expect(
      resolveSftpTransferRetry(
        transferSummary({
          status: "failed",
          successorId: "transfer-successor",
        }),
      ),
    ).toMatchObject({
      canRetry: false,
      reason: "successorExists",
      statusMessage: "该任务已重新排队，请跟踪后继任务。",
    });
  });

  /** 回执不明时正式文件可能已提交，旧 retryable 标志也不得重新写入。 */
  it("never retries an uncertain commit", () => {
    expect(resolveSftpTransferRetry(transferSummary({
      failureKind: "commitUnknown",
      retryable: true,
      resumable: true,
      status: "failed",
    }))).toMatchObject({
      canRetry: false,
      reason: "commitUnknown",
    });
  });

  it("does not retry non-failed, remote-copy, or metadata-incomplete transfers", () => {
    expect(resolveSftpTransferRetry(transferSummary()).canRetry).toBe(false);
    expect(
      resolveSftpTransferRetry(
        transferSummary({
          conflictPolicy: "overwrite",
          operation: "remoteCopy",
          status: "failed",
        }),
      ),
    ).toMatchObject({
      canRetry: false,
      reason: "unsupportedOperation",
      statusMessage: "该传输类型暂不支持安全重试。",
    });
    expect(
      resolveSftpTransferRetry(
        transferSummary({
          conflictPolicy: undefined,
          status: "failed",
        }),
      ),
    ).toMatchObject({
      canRetry: false,
      reason: "missingConflictPolicy",
      statusMessage: "缺少原始冲突策略，不能安全重试。",
    });
  });
});

function transferSummary(
  overrides: Partial<SftpTransferSummary> = {},
): SftpTransferSummary {
  const remotePath = overrides.remotePath ?? "/srv/app.log";
  const localPath = overrides.localPath ?? "C:/downloads/app.log";

  return {
    bytesTransferred: 0,
    cancelRequested: false,
    createdAt: 1,
    direction: "download",
    hostId: "host-left",
    id: "transfer-1",
    kind: "file",
    localPath,
    operation: "download",
    remotePath,
    source: {
      hostId: "host-left",
      hostLabel: "host-left",
      kind: "remote",
      path: remotePath,
    },
    status: "queued",
    target: {
      kind: "local",
      path: localPath,
    },
    totalBytes: 1024,
    transportMode: "singleHostSftp",
    updatedAt: 1,
    ...overrides,
  };
}
