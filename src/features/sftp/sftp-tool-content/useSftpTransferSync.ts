/**
 * SFTP 传输快照与实时事件同步。
 *
 * @author kongweiguang
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  listSftpTransfers,
  type SftpTransferSummary,
} from "../../../lib/sftpApi";
import { desktopRuntime } from "../../../lib/desktopRuntimeApi";
import { replaceTransferQueue } from "../sftpTransferModel";
import { dockerContainerTransferHostId } from "./sftpDockerDirectTransferModel";
import { isRunningInTauriWebview } from "./sftpDragDropModel";
import {
  filterSftpTransfersForHost,
  mergeSftpTransferUpdateForHost,
  resolveSftpTransferCompletionEffects,
  sftpTransferMatchesViewScope,
} from "./sftpTransferSyncModel";
import { SFTP_TRANSFER_UPDATED_EVENT, type SftpFileTarget } from "./types";

const TRANSFER_POLL_INTERVAL_MS = 900;
const EVENT_HEALTHY_POLL_DELAY_MS = 10_000;

interface UseSftpTransferSyncOptions {
  active: boolean;
  currentPath: string;
  fileTarget: SftpFileTarget | null;
  loadDirectory: (path: string) => Promise<void>;
  viewScope?: string | null;
}

export function useSftpTransferSync({
  active,
  currentPath,
  fileTarget,
  loadDirectory,
  viewScope,
}: UseSftpTransferSyncOptions) {
  const [transfers, setTransfers] = useState<SftpTransferSummary[]>([]);
  const completedTransferIdsRef = useRef(new Set<string>());
  // 事件到达后，启动前的轮询快照不再有权覆盖该事件。
  const transferRevisionRef = useRef(0);
  const lastTransferEventAtRef = useRef<number | null>(null);
  const syncHostId = fileTarget?.kind === "ssh" ? fileTarget.hostId : undefined;
  const visibleHostId =
    fileTarget?.kind === "ssh"
      ? fileTarget.hostId
      : fileTarget?.kind === "dockerContainer"
        ? dockerContainerTransferHostId(fileTarget)
        : undefined;

  const visibleTransfers = useMemo(
    () => filterSftpTransfersForHost(transfers, visibleHostId, viewScope),
    [transfers, viewScope, visibleHostId],
  );

  const refreshTransfers = useCallback(async () => {
    if (!active) {
      setTransfers([]);
      return;
    }
    if (!syncHostId) {
      return;
    }
    const revisionAtRequestStart = transferRevisionRef.current;
    const nextTransfers = await listSftpTransfers(
      viewScope === undefined ? undefined : { viewScope },
    );
    if (revisionAtRequestStart === transferRevisionRef.current) {
      setTransfers(replaceTransferQueue(nextTransfers));
    }
  }, [active, syncHostId, viewScope]);

  useEffect(() => {
    completedTransferIdsRef.current.clear();
    transferRevisionRef.current += 1;
    lastTransferEventAtRef.current = null;
    setTransfers([]);
  }, [viewScope, visibleHostId]);

  useEffect(() => {
    if (!active) {
      setTransfers([]);
      return undefined;
    }
    if (!syncHostId) {
      return undefined;
    }

    let disposed = false;
    const loadTransfers = async () => {
      const revisionAtRequestStart = transferRevisionRef.current;
      try {
        const nextTransfers = await listSftpTransfers(
          viewScope === undefined ? undefined : { viewScope },
        );
        if (
          !disposed &&
          revisionAtRequestStart === transferRevisionRef.current
        ) {
          setTransfers(replaceTransferQueue(nextTransfers));
        }
      } catch {
        if (
          !disposed &&
          revisionAtRequestStart === transferRevisionRef.current
        ) {
          setTransfers([]);
        }
      }
    };

    void loadTransfers();
    const intervalId = window.setInterval(() => {
      const lastEventAt = lastTransferEventAtRef.current;
      if (
        lastEventAt !== null &&
        Date.now() - lastEventAt < EVENT_HEALTHY_POLL_DELAY_MS
      ) {
        return;
      }
      void loadTransfers();
    }, TRANSFER_POLL_INTERVAL_MS);
    return () => {
      disposed = true;
      window.clearInterval(intervalId);
    };
  }, [active, syncHostId, viewScope]);

  useEffect(() => {
    if (!active || !syncHostId || !isRunningInTauriWebview()) {
      return undefined;
    }

    let disposed = false;
    let unlisten: (() => void) | undefined;
    void desktopRuntime
      .listen<SftpTransferSummary>(SFTP_TRANSFER_UPDATED_EVENT, (transfer) => {
        if (disposed) {
          return;
        }
        if (
          transfer.hostId !== syncHostId ||
          !sftpTransferMatchesViewScope(transfer, viewScope)
        ) {
          return;
        }
        transferRevisionRef.current += 1;
        lastTransferEventAtRef.current = Date.now();
        setTransfers((current) =>
          mergeSftpTransferUpdateForHost({
            hostId: syncHostId,
            transfer,
            transfers: current,
            viewScope,
          }),
        );
      })
      .then((nextUnlisten) => {
        if (disposed) {
          nextUnlisten();
          return;
        }
        unlisten = nextUnlisten;
      })
      .catch(() => {
        // Polling remains the fallback when the Tauri event channel is unavailable.
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [active, syncHostId, viewScope]);

  useEffect(() => {
    const effects = resolveSftpTransferCompletionEffects({
      completedTransferIds: completedTransferIdsRef.current,
      currentPath,
      transfers: visibleTransfers,
    });
    completedTransferIdsRef.current = effects.completedTransferIds;
    if (effects.reloadPath) {
      void loadDirectory(effects.reloadPath);
    }
  }, [currentPath, loadDirectory, visibleTransfers]);

  return {
    refreshTransfers,
    setTransfers,
    transfers,
    visibleTransfers,
  };
}
