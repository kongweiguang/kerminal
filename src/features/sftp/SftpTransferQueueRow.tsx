/**
 * SFTP 传输队列的紧凑任务行。
 *
 * @author kongweiguang
 */

import {
  ChevronDown,
  ChevronUp,
  Download,
  RefreshCw,
  Upload,
  X,
} from "lucide-react";
import { useId, useState } from "react";
import { Button } from "../../components/ui/button";
import { cn } from "../../lib/cn";
import type { SftpTransferSummary } from "../../lib/sftpApi";
import {
  canCancelTransfer,
  formatTransferBytes,
  transferFailureMessage,
  transferInlineSpeedLabel,
  transferMethodLabel,
  transferPathSummary,
  transferPercentLabel,
  transferProgressPercent,
  transferStatusClassName,
  transferStatusLabel,
  transferTitle,
} from "./sftpTransferModel";
import { resolveSftpTransferRetry } from "./sftpTransferRetryPolicy";

interface SftpTransferQueueRowProps {
  onCancel: (transferId: string) => void;
  onRetry?: (transfer: SftpTransferSummary) => void;
  transfer: SftpTransferSummary;
}

/**
 * 保持普通任务为单行摘要，仅在无进度失败时直接露出原因和唯一恢复动作。
 *
 * 长路径、字节明细仍按需展开，避免正常队列因错误说明而持续增高；但网络失联不能藏在
 * 详情里，否则用户无法判断刷新图标是否会安全地从断点继续。
 */
export function SftpTransferQueueRow({
  onCancel,
  onRetry,
  transfer,
}: SftpTransferQueueRowProps) {
  const detailId = useId();
  const [detailExpanded, setDetailExpanded] = useState(false);
  const progress = transferProgressPercent(transfer);
  const canCancel = canCancelTransfer(transfer);
  const retryDecision =
    transfer.status === "failed" || transfer.status === "canceled"
      ? resolveSftpTransferRetry(transfer)
      : null;
  const showRetryUnavailable =
    retryDecision &&
    !retryDecision.canRetry &&
    transfer.transportMode === "singleHostSftp";
  const DirectionIcon = transfer.direction === "upload" ? Upload : Download;
  const DetailIcon = detailExpanded ? ChevronUp : ChevronDown;
  const directionLabel = transfer.direction === "upload" ? "上传" : "下载";
  const title = transferTitle(transfer);
  const isIdleTimeout = transfer.failureKind === "idleTimeout";
  const failureMessage = transferFailureMessage(transfer);

  return (
    <div
      aria-label={`SFTP ${directionLabel} ${title}`}
      className={cn(
        "kerminal-muted-surface rounded-lg border px-2.5 py-1.5 transition-opacity",
        transfer.status === "succeeded" &&
          "opacity-70 hover:opacity-100 focus-within:opacity-100",
      )}
      role="group"
    >
      <div className="flex min-w-0 items-center gap-2">
        <span
          className={cn(
            "flex h-6 w-6 shrink-0 items-center justify-center rounded-md",
            transfer.status === "failed"
              ? "bg-rose-500/10 text-rose-500 dark:text-rose-300"
              : transfer.status === "succeeded"
                ? "bg-emerald-500/10 text-emerald-500 dark:text-emerald-300"
                : "bg-sky-500/10 text-sky-500 dark:text-sky-300",
          )}
          title={directionLabel}
        >
          <DirectionIcon aria-hidden="true" className="h-3.5 w-3.5" />
        </span>
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-zinc-900 dark:text-zinc-100">
          {title}
        </span>
        <span
          className={cn(
            "shrink-0 rounded-md border px-1.5 py-0.5 text-[10px]",
            transferStatusClassName(transfer.status),
          )}
        >
          {transferStatusLabel(transfer.status, transfer.phase)}
        </span>
        <span className="w-12 shrink-0 text-right font-mono text-[11px] text-zinc-600 dark:text-zinc-300">
          {transferPercentLabel(transfer)}
        </span>
        <span
          className="w-14 shrink-0 truncate text-right font-mono text-[10px] text-zinc-500 dark:text-zinc-400"
          title={transferInlineSpeedLabel(transfer)}
        >
          {transferInlineSpeedLabel(transfer)}
        </span>
        <Button
          aria-controls={detailId}
          aria-expanded={detailExpanded}
          aria-label={`${detailExpanded ? "收起" : "查看"}传输详情 ${title}`}
          className="kerminal-muted-surface h-6 w-6 shrink-0 rounded-md border px-0 text-zinc-600 hover:bg-[var(--surface-hover)] dark:text-zinc-300"
          onClick={() => setDetailExpanded((current) => !current)}
          size="sm"
          title={detailExpanded ? "收起详情" : "查看详情"}
          type="button"
          variant="ghost"
        >
          <DetailIcon aria-hidden="true" className="h-3 w-3" />
        </Button>
        {retryDecision?.canRetry && onRetry && !isIdleTimeout ? (
          <Button
            aria-label={`重试传输 ${title}`}
            className="kerminal-muted-surface h-6 w-6 shrink-0 rounded-md border px-0 text-zinc-600 hover:bg-[var(--surface-hover)] dark:text-zinc-300"
            onClick={() => onRetry(transfer)}
            size="sm"
            title="重新加入传输队列；将优先尝试断点续传"
            type="button"
            variant="ghost"
          >
            <RefreshCw aria-hidden="true" className="h-3 w-3" />
          </Button>
        ) : null}
        {canCancel ? (
          <Button
            aria-label={`取消传输 ${title}`}
            className="kerminal-muted-surface h-6 w-6 shrink-0 rounded-md border px-0 text-zinc-600 hover:bg-[var(--surface-hover)] dark:text-zinc-300"
            onClick={() => onCancel(transfer.id)}
            size="sm"
            title="取消传输"
            type="button"
            variant="ghost"
          >
            <X aria-hidden="true" className="h-3 w-3" />
          </Button>
        ) : null}
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        <div
          aria-label={`传输进度 ${title}`}
          aria-valuemax={100}
          aria-valuemin={0}
          aria-valuenow={Math.round(progress)}
          className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--surface-muted)]"
          role="progressbar"
        >
          <div
            className={cn(
              "h-full rounded-full transition-all",
              transfer.status === "failed"
                ? "bg-rose-500"
                : transfer.status === "canceled"
                  ? "bg-zinc-400"
                  : transfer.status === "succeeded"
                    ? "bg-emerald-500"
                    : "bg-sky-500",
            )}
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
      {isIdleTimeout && failureMessage ? (
        <div className="mt-1.5 flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-[var(--radius-control)] border border-rose-500/20 bg-rose-500/8 px-2 py-1 text-[11px] text-rose-700 dark:border-rose-300/20 dark:bg-rose-400/10 dark:text-rose-200">
          <span className="min-w-0 flex-1 break-words" role="alert">
            {failureMessage}
          </span>
          {retryDecision?.canRetry && onRetry ? (
            <Button
              aria-label={`继续传输 ${title}`}
              className="h-6 shrink-0 gap-1 rounded-[var(--radius-control)] border border-current/25 bg-transparent px-2 text-[11px] text-current hover:bg-rose-500/10 dark:hover:bg-rose-300/10"
              onClick={() => onRetry(transfer)}
              size="sm"
              type="button"
              variant="ghost"
            >
              <RefreshCw aria-hidden="true" className="h-3 w-3" />
              继续传输
            </Button>
          ) : null}
        </div>
      ) : null}
      {detailExpanded ? (
        <div
          className="mt-2 grid gap-1 border-t border-[var(--border-subtle)] pt-2 text-[11px] text-zinc-500 dark:text-zinc-400"
          id={detailId}
        >
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span>{transferMethodLabel(transfer)}</span>
            <span className="font-mono">{formatTransferBytes(transfer)}</span>
          </div>
          <div className="break-all font-mono" title={transferPathSummary(transfer)}>
            {transferPathSummary(transfer)}
          </div>
          {failureMessage && !isIdleTimeout ? (
            <div className="break-words text-rose-600 dark:text-rose-300">
              {failureMessage}
            </div>
          ) : null}
          {showRetryUnavailable ? (
            <div className="break-words text-amber-700 dark:text-amber-200">
              不能安全重试：{retryDecision.statusMessage}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
