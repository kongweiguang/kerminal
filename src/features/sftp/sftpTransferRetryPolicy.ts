/**
 * SFTP transfer retry policy.
 *
 * @author kongweiguang
 */

import type {
  SftpManagedTransferRequest,
  SftpTransferSummary,
} from "../../lib/sftpApi";

export type SftpTransferRetryDecision =
  | {
      canRetry: true;
      request: SftpManagedTransferRequest;
      statusMessage: string;
    }
  | {
      canRetry: false;
      reason:
        | "notFailed"
        | "unsupportedOperation"
        | "unsupportedTransport"
        | "missingConflictPolicy"
        | "missingRequestMetadata";
      statusMessage: string;
    };

export function resolveSftpTransferRetry(
  transfer: SftpTransferSummary,
): SftpTransferRetryDecision {
  if (transfer.status !== "failed" && transfer.status !== "canceled") {
    return {
      canRetry: false,
      reason: "notFailed",
      statusMessage: "只有失败或已取消的传输任务可以重试。",
    };
  }

  if (transfer.operation !== "upload" && transfer.operation !== "download") {
    return {
      canRetry: false,
      reason: "unsupportedOperation",
      statusMessage: "该传输类型暂不支持安全重试。",
    };
  }

  if (transfer.transportMode !== "singleHostSftp") {
    return {
      canRetry: false,
      reason: "unsupportedTransport",
      statusMessage: "该传输方式暂不支持安全重试。",
    };
  }

  if (!transfer.conflictPolicy) {
    return {
      canRetry: false,
      reason: "missingConflictPolicy",
      statusMessage: "缺少原始冲突策略，不能安全重试。",
    };
  }

  if (!transfer.hostId || !transfer.remotePath || !transfer.localPath) {
    return {
      canRetry: false,
      reason: "missingRequestMetadata",
      statusMessage: "缺少原始传输请求信息，不能安全重试。",
    };
  }

  return {
    canRetry: true,
    request: {
      conflictPolicy: transfer.conflictPolicy,
      direction: transfer.direction,
      hostId: transfer.hostId,
      kind: transfer.kind,
      localPath: transfer.localPath,
      remotePath: transfer.remotePath,
      viewScope: transfer.viewScope ?? null,
      idleTimeoutSeconds: transfer.idleTimeoutSeconds,
    },
    statusMessage:
      "已重新加入传输队列；将优先尝试断点续传。",
  };
}
