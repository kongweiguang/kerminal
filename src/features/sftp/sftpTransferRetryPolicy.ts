/**
 * SFTP transfer retry policy.
 *
 * @author kongweiguang
 */

import type { SftpTransferSummary } from "../../lib/sftpApi";

export type SftpTransferRetryDecision =
  | {
      canRetry: true;
      actionLabel: "继续传输" | "重新传输";
      statusMessage: string;
      transferId: string;
    }
  | {
      canRetry: false;
      reason:
        | "notFailed"
        | "unsupportedOperation"
        | "unsupportedTransport"
        | "missingConflictPolicy"
        | "missingRequestMetadata"
        | "notRetryable"
        | "commitUnknown"
        | "successorExists";
      statusMessage: string;
    };

/**
 * 只判断旧摘要是否允许发起按 ID 的恢复请求；路径和断点不能由前端重新拼装。
 * 只有后端明确报告 resumable=true 才承诺继续传输；提交回执不明时禁止二次写入。
 *
 * @author kongweiguang
 */
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

  // 提交回执丢失时，正式文件可能已经存在；即便旧摘要误报 retryable 也不再发起写入。
  if (transfer.failureKind === "commitUnknown") {
    return {
      canRetry: false,
      reason: "commitUnknown",
      statusMessage: "提交结果待核对，请先检查目标文件。",
    };
  }

  if (transfer.retryable === false) {
    return {
      canRetry: false,
      reason: "notRetryable",
      statusMessage: "该传输任务当前不可重试。",
    };
  }

  if (transfer.successorId) {
    return {
      canRetry: false,
      reason: "successorExists",
      statusMessage: "该任务已重新排队，请跟踪后继任务。",
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
    actionLabel: transfer.resumable === true ? "继续传输" : "重新传输",
    transferId: transfer.id,
    statusMessage:
      transfer.resumable !== true
        ? "已请求重新传输；该任务没有可用断点。"
        : "已重新加入传输队列；将优先尝试断点续传。",
  };
}
