/**
 * Shared facade for SFTP managed transfer queue mutations.
 *
 * @author kongweiguang
 */

import {
  useCallback,
  useRef,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  cancelSftpTransfer,
  clearCompletedSftpTransfers,
  retrySftpTransfer,
  type SftpTransferSummary,
} from "../../lib/sftpApi";
import { resolveSftpTransferRetry } from "./sftpTransferRetryPolicy";
import { mergeTransferSnapshot, replaceTransferQueue } from "./sftpTransferModel";

type UseSftpManagedTransferQueueArgs = {
  onCancelSuccess?: (summary: SftpTransferSummary) => void;
  onClearSuccess?: (transfers: SftpTransferSummary[]) => void;
  onError?: (error: unknown) => void;
  onRetrySuccess?: (summary: SftpTransferSummary) => void;
  onRetryUnavailable?: (message: string) => void;
  refreshTransfers?: () => Promise<void>;
  setTransfers: Dispatch<SetStateAction<SftpTransferSummary[]>>;
  viewScope?: string | null;
};

/**
 * 请求级门闩阻止同一任务重复取消或重试；取消失败只撤销乐观标记，
 * 不得把等待网络期间收到的字节进度或终态回滚到旧快照。
 */
export function useSftpManagedTransferQueue({
  onCancelSuccess,
  onClearSuccess,
  onError,
  onRetrySuccess,
  onRetryUnavailable,
  refreshTransfers,
  setTransfers,
  viewScope,
}: UseSftpManagedTransferQueueArgs) {
  const cancelingTransferIdsRef = useRef(new Set<string>());
  const retryingTransferIdsRef = useRef(new Set<string>());
  const cancelTransfer = useCallback(
    async (transferId: string) => {
      if (cancelingTransferIdsRef.current.has(transferId)) {
        return;
      }
      cancelingTransferIdsRef.current.add(transferId);
      let previousTransfer: SftpTransferSummary | undefined;
      setTransfers((current) =>
        current.map((transfer) => {
          if (transfer.id !== transferId || (transfer.status !== "queued" && transfer.status !== "running")) {
            return transfer;
          }
          previousTransfer = transfer;
          return {
            ...transfer,
            cancelRequested: true,
            phase: "canceling",
            speedBytesPerSecond: 0,
          };
        }),
      );
      try {
        const summary = await cancelSftpTransfer(
          viewScope === undefined ? { transferId } : { transferId, viewScope },
        );
        setTransfers((current) => mergeTransferSnapshot(current, summary));
        onCancelSuccess?.(summary);
        void refreshTransfers?.();
      } catch (error) {
        // React 可能在异步异常到达后才执行乐观 setter，因而不能只依赖闭包捕获的旧快照。
        // 仅回滚仍处于 canceling 的同一任务，绝不覆盖期间已经落地的终态。
        setTransfers((current) =>
          current.map((transfer) => {
            if (
              transfer.id !== transferId ||
              (transfer.status !== "queued" && transfer.status !== "running") ||
              !transfer.cancelRequested ||
              transfer.phase !== "canceling"
            ) {
              return transfer;
            }
            return {
              ...transfer,
              cancelRequested: false,
              phase: previousTransfer?.phase,
              speedBytesPerSecond: undefined,
            };
          }),
        );
        onError?.(error);
      } finally {
        cancelingTransferIdsRef.current.delete(transferId);
      }
    },
    [onCancelSuccess, onError, refreshTransfers, setTransfers, viewScope],
  );

  const clearFinishedTransfers = useCallback(async () => {
    try {
      const nextTransfers = replaceTransferQueue(
        await (viewScope === undefined
          ? clearCompletedSftpTransfers()
          : clearCompletedSftpTransfers({ viewScope })),
      );
      setTransfers(nextTransfers);
      onClearSuccess?.(nextTransfers);
    } catch (error) {
      onError?.(error);
    }
  }, [onClearSuccess, onError, setTransfers, viewScope]);

  const retryTransfer = useCallback(
    async (transfer: SftpTransferSummary) => {
      const decision = resolveSftpTransferRetry(transfer);
      if (!decision.canRetry) {
        onRetryUnavailable?.(decision.statusMessage);
        return;
      }
      if (retryingTransferIdsRef.current.has(transfer.id)) {
        return;
      }
      retryingTransferIdsRef.current.add(transfer.id);

      try {
        const summary = await retrySftpTransfer(
          viewScope === undefined
            ? { transferId: decision.transferId }
            : { transferId: decision.transferId, viewScope },
        );
        setTransfers((current) => mergeTransferSnapshot(current.map((item) =>
          item.id === transfer.id ? { ...item, successorId: summary.id } : item,
        ), summary));
        onRetrySuccess?.(summary);
        void refreshTransfers?.();
      } catch (error) {
        onError?.(error);
      } finally {
        retryingTransferIdsRef.current.delete(transfer.id);
      }
    },
    [
      onError,
      onRetrySuccess,
      onRetryUnavailable,
      refreshTransfers,
      setTransfers,
      viewScope,
    ],
  );

  return { cancelTransfer, clearFinishedTransfers, retryTransfer };
}
