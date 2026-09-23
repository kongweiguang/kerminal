/**
 * SFTP transfer queue sync facade.
 *
 * @author kongweiguang
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { desktopRuntime } from "../../lib/desktopRuntimeApi";
import {
  listSftpTransfers,
  type SftpTransferSummary,
} from "../../lib/sftpApi";
import {
  buildUserFacingError,
  technicalDetailFromUnknown,
  type UserFacingMessage,
} from "../../lib/userFacingMessage";
import { runtimeCompatibilityDiagnostics } from "../../platform/runtime/compatibilityDiagnostics";
import { updateSftpRuntimeDiagnosticsTransfers } from "./sftpRuntimeDiagnostics";
import { sftpTransferMatchesViewScope } from "./sftp-tool-content/sftpTransferSyncModel";
import { mergeTransferSnapshot, replaceTransferQueue } from "./sftpTransferModel";

const SFTP_TRANSFER_UPDATED_EVENT = "sftp-transfer-updated";
const DEFAULT_POLL_INTERVAL_MS = 900;
const DEFAULT_EVENT_HEALTHY_POLL_INTERVAL_MS = 10_000;
const DEFAULT_EVENT_HEALTH_WINDOW_MS = 30_000;
const DEFAULT_HIDDEN_POLL_INTERVAL_MS = 10_000;

type VisibilityChangeSubscriber = (onChange: () => void) => () => void;

type SftpTransferUpdateListener = (
  onUpdate: (transfer: SftpTransferSummary) => void,
) => Promise<() => void>;

export interface UseSftpTransferQueueSyncOptions {
  active: boolean;
  eventChannelAvailable?: () => boolean;
  documentVisible?: () => boolean;
  eventHealthyPollIntervalMs?: number;
  eventHealthWindowMs?: number;
  hiddenPollIntervalMs?: number;
  listenToUpdates?: SftpTransferUpdateListener;
  pollIntervalMs?: number;
  subscribeToVisibilityChange?: VisibilityChangeSubscriber;
  viewScope?: string | null;
}

export interface SftpTransferQueueSyncState {
  clearQueueError: () => void;
  queueError: UserFacingMessage | null;
  refreshTransfers: () => Promise<void>;
  setQueueError: Dispatch<SetStateAction<UserFacingMessage | null>>;
  setTransfers: Dispatch<SetStateAction<SftpTransferSummary[]>>;
  transfers: SftpTransferSummary[];
}

const defaultEventChannelAvailable = () => desktopRuntime.mode === "desktop";
const defaultDocumentVisible = () =>
  typeof document === "undefined" || document.visibilityState === "visible";
const defaultSubscribeToVisibilityChange: VisibilityChangeSubscriber = (
  onChange,
) => {
  if (typeof document === "undefined") {
    return () => {};
  }
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
};

const defaultListenToUpdates: SftpTransferUpdateListener = async (onUpdate) => {
  return desktopRuntime.listen<SftpTransferSummary>(
    SFTP_TRANSFER_UPDATED_EVENT,
    onUpdate,
  );
};

/** 后台列表是任务集合权威来源，单项快照则按状态合并以抵御迟到事件。 */
export function useSftpTransferQueueSync({
  active,
  documentVisible = defaultDocumentVisible,
  eventHealthyPollIntervalMs = DEFAULT_EVENT_HEALTHY_POLL_INTERVAL_MS,
  eventHealthWindowMs = DEFAULT_EVENT_HEALTH_WINDOW_MS,
  eventChannelAvailable = defaultEventChannelAvailable,
  hiddenPollIntervalMs = DEFAULT_HIDDEN_POLL_INTERVAL_MS,
  listenToUpdates = defaultListenToUpdates,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  subscribeToVisibilityChange = defaultSubscribeToVisibilityChange,
  viewScope,
}: UseSftpTransferQueueSyncOptions): SftpTransferQueueSyncState {
  const [transfers, setTransfers] = useState<SftpTransferSummary[]>([]);
  const [queueError, setQueueError] = useState<UserFacingMessage | null>(null);
  const lastEventAtRef = useRef<number | null>(null);
  const reschedulePollRef = useRef<(() => void) | null>(null);

  const clearQueueError = useCallback(() => {
    setQueueError(null);
  }, []);

  useEffect(() => {
    updateSftpRuntimeDiagnosticsTransfers(transfers);
  }, [transfers]);

  const refreshTransfers = useCallback(async () => {
    if (!active) {
      return;
    }

    try {
      const nextTransfers = sanitizeSftpTransferSummaries(
        await listSftpTransfers(
          viewScope === undefined ? undefined : { viewScope },
        ),
      );
      setTransfers((current) => replaceTransferQueue(nextTransfers, current));
      setQueueError(null);
    } catch (error) {
      setQueueError(buildSftpTransferQueueError(error));
    }
  }, [active, viewScope]);

  useEffect(() => {
    if (!active) {
      return undefined;
    }

    let disposed = false;
    let pollInFlight = false;
    let timeoutId: number | undefined;
    lastEventAtRef.current = null;
    const loadTransfers = async () => {
      try {
        const nextTransfers = sanitizeSftpTransferSummaries(
          await listSftpTransfers(
            viewScope === undefined ? undefined : { viewScope },
          ),
        );
        if (!disposed) {
          setTransfers((current) => replaceTransferQueue(nextTransfers, current));
          setQueueError(null);
        }
      } catch (error) {
        if (!disposed) {
          setQueueError(buildSftpTransferQueueError(error));
        }
      }
    };

    const clearNextPoll = () => {
      if (timeoutId === undefined) {
        return;
      }
      window.clearTimeout(timeoutId);
      timeoutId = undefined;
    };
    const nextPollDelay = () =>
      sftpTransferQueuePollDelay({
        documentVisible: documentVisible(),
        eventChannelHealthy:
          eventChannelAvailable() &&
          sftpTransferEventChannelHealthy({
            eventHealthWindowMs,
            lastEventAt: lastEventAtRef.current,
            now: Date.now(),
          }),
        eventHealthyPollIntervalMs,
        hiddenPollIntervalMs,
        pollIntervalMs,
      });
    const scheduleNextPoll = () => {
      if (disposed) {
        return;
      }
      clearNextPoll();
      timeoutId = window.setTimeout(() => {
        timeoutId = undefined;
        void runPoll();
      }, nextPollDelay());
    };
    const runPoll = async () => {
      if (pollInFlight) {
        return;
      }
      pollInFlight = true;
      const eventChannelHealthy =
        eventChannelAvailable() &&
        sftpTransferEventChannelHealthy({
          eventHealthWindowMs,
          lastEventAt: lastEventAtRef.current,
          now: Date.now(),
        });
      runtimeCompatibilityDiagnostics.recordActivation(
        "sftp.transfer-polling",
        resolveSftpPollingCompatibilityReason({
          documentVisible: documentVisible(),
          eventChannelHealthy,
        }),
      );
      try {
        await loadTransfers();
      } finally {
        pollInFlight = false;
        scheduleNextPoll();
      }
    };
    const handleVisibilityChange = () => {
      clearNextPoll();
      if (documentVisible()) {
        void runPoll();
      } else {
        scheduleNextPoll();
      }
    };

    reschedulePollRef.current = scheduleNextPoll;
    void runPoll();
    const unsubscribeVisibility =
      subscribeToVisibilityChange(handleVisibilityChange);
    return () => {
      disposed = true;
      clearNextPoll();
      unsubscribeVisibility();
      if (reschedulePollRef.current === scheduleNextPoll) {
        reschedulePollRef.current = null;
      }
    };
  }, [
    active,
    documentVisible,
    eventChannelAvailable,
    eventHealthyPollIntervalMs,
    eventHealthWindowMs,
    hiddenPollIntervalMs,
    pollIntervalMs,
    subscribeToVisibilityChange,
    viewScope,
  ]);

  useEffect(() => {
    if (!active || !eventChannelAvailable()) {
      return undefined;
    }

    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listenToUpdates((transfer) => {
      if (disposed) {
        return;
      }
      if (!sftpTransferMatchesViewScope(transfer, viewScope)) {
        return;
      }
      lastEventAtRef.current = Date.now();
      setTransfers((current) =>
        mergeTransferSnapshot(current, sanitizeSftpTransferSummary(transfer)),
      );
      reschedulePollRef.current?.();
    })
      .then((nextUnlisten) => {
        if (disposed) {
          nextUnlisten();
          return;
        }
        unlisten = nextUnlisten;
      })
      .catch(() => {
        // Polling remains the fallback outside the Tauri event channel.
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [active, eventChannelAvailable, listenToUpdates, viewScope]);

  return {
    clearQueueError,
    queueError,
    refreshTransfers,
    setQueueError,
    setTransfers,
    transfers,
  };
}

/**
 * 为普通工作台构建稳定摘要，原始异常只保留在脱敏后的技术详情中。
 */
export function buildSftpTransferQueueError(error: unknown): UserFacingMessage {
  return buildUserFacingError(error, {
    detail: "现有传输记录已保留。",
    recoveryAction: "检查连接后刷新传输队列。",
    title: "无法同步传输队列",
  });
}

/**
 * 后端传输失败原因进入可展开详情前必须先脱敏。
 */
export function sanitizeSftpTransferSummary(
  transfer: SftpTransferSummary,
): SftpTransferSummary {
  if (!transfer.error) {
    return transfer;
  }
  return {
    ...transfer,
    error: technicalDetailFromUnknown(transfer.error),
  };
}

function sanitizeSftpTransferSummaries(
  transfers: SftpTransferSummary[],
): SftpTransferSummary[] {
  return transfers.map(sanitizeSftpTransferSummary);
}

export function sftpTransferEventChannelHealthy({
  eventHealthWindowMs,
  lastEventAt,
  now,
}: {
  eventHealthWindowMs: number;
  lastEventAt: number | null;
  now: number;
}) {
  return (
    lastEventAt !== null &&
    eventHealthWindowMs > 0 &&
    now - lastEventAt <= eventHealthWindowMs
  );
}

export function sftpTransferQueuePollDelay({
  documentVisible,
  eventChannelHealthy,
  eventHealthyPollIntervalMs,
  hiddenPollIntervalMs,
  pollIntervalMs,
}: {
  documentVisible: boolean;
  eventChannelHealthy: boolean;
  eventHealthyPollIntervalMs: number;
  hiddenPollIntervalMs: number;
  pollIntervalMs: number;
}) {
  const fallbackDelay = Math.max(1, pollIntervalMs);
  const visibleDelay = eventChannelHealthy
    ? Math.max(fallbackDelay, eventHealthyPollIntervalMs)
    : fallbackDelay;

  return documentVisible
    ? visibleDelay
    : Math.max(visibleDelay, hiddenPollIntervalMs);
}

function resolveSftpPollingCompatibilityReason({
  documentVisible,
  eventChannelHealthy,
}: {
  documentVisible: boolean;
  eventChannelHealthy: boolean;
}) {
  if (!documentVisible) {
    return "document-hidden";
  }
  if (eventChannelHealthy) {
    return "event-channel-healthy-safety-poll";
  }
  return "event-channel-unavailable";
}
