// @author kongweiguang

import { useCallback, useEffect, useRef, useState } from "react";
import { getRuntimeHealthSnapshot } from "../../lib/diagnosticsApi";
import {
  getServerInfoSnapshot,
  type ServerInfoSnapshot,
} from "../../lib/serverInfoApi";
import {
  buildUserFacingError,
  type UserFacingMessage,
} from "../../lib/userFacingMessage";
import {
  createServerInfoMetricsCache,
  type ServerInfoMetricsCache,
  type NetworkTrafficSnapshot,
} from "./serverInfoMetricsModel";
import { localServerInfoSnapshot } from "./localServerInfoModel";
import type { ServerInfoTargetContext } from "./serverInfoTargetModel";

export interface ServerInfoSnapshotRuntime {
  inFlight: Map<string, Promise<ServerInfoSnapshot>>;
  metrics: ServerInfoMetricsCache;
  snapshots: Map<string, ServerInfoSnapshot>;
}

/** 创建实例级采集缓存，测试与独立窗口无需清理进程级单例。 */
export function createServerInfoSnapshotRuntime(): ServerInfoSnapshotRuntime {
  return {
    inFlight: new Map(),
    metrics: createServerInfoMetricsCache(),
    snapshots: new Map(),
  };
}

const defaultServerInfoSnapshotRuntime = createServerInfoSnapshotRuntime();
const DEFAULT_REFRESH_INTERVAL_MS = 3_000;
const DEFAULT_HIDDEN_REFRESH_INTERVAL_MS = 30_000;

type VisibilityChangeSubscriber = (onChange: () => void) => () => void;

export const serverInfoRefreshOptions = [
  { label: "手动", value: 0 },
  { label: "1s", value: 1_000 },
  { label: "3s", value: 3_000 },
  { label: "5s", value: 5_000 },
  { label: "10s", value: 10_000 },
  { label: "30s", value: 30_000 },
  { label: "60s", value: 60_000 },
  { label: "5min", value: 300_000 },
];

export interface UseServerInfoSnapshotOptions {
  documentVisible?: () => boolean;
  hiddenRefreshIntervalMs?: number;
  runtime?: ServerInfoSnapshotRuntime;
  subscribeToVisibilityChange?: VisibilityChangeSubscriber;
}

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

/** 管理本机、SSH 主机或容器的系统信息快照、缓存与定时刷新。 */
export function useServerInfoSnapshot(
  targetContext: ServerInfoTargetContext | undefined,
  {
    documentVisible = defaultDocumentVisible,
    hiddenRefreshIntervalMs = DEFAULT_HIDDEN_REFRESH_INTERVAL_MS,
    runtime = defaultServerInfoSnapshotRuntime,
    subscribeToVisibilityChange = defaultSubscribeToVisibilityChange,
  }: UseServerInfoSnapshotOptions = {},
) {
  const selectedTargetKey = targetContext?.cacheKey;
  const [error, setError] = useState<UserFacingMessage | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshIntervalMs, setRefreshIntervalMs] = useState(
    DEFAULT_REFRESH_INTERVAL_MS,
  );
  const [snapshot, setSnapshot] = useState<ServerInfoSnapshot | null>(() =>
    selectedTargetKey
      ? (runtime.snapshots.get(selectedTargetKey) ?? null)
      : null,
  );
  const [networkTraffic, setNetworkTraffic] =
    useState<NetworkTrafficSnapshot | null>(() =>
      selectedTargetKey
        ? runtime.metrics.cached(
            selectedTargetKey,
            runtime.snapshots.get(selectedTargetKey),
          )
        : null,
    );
  const loadingRef = useRef(false);
  const requestIdRef = useRef(0);

  const refresh = useCallback(
    async (options?: { force?: boolean }) => {
      if (!targetContext) {
        requestIdRef.current += 1;
        loadingRef.current = false;
        setLoading(false);
        return;
      }
      if (loadingRef.current) {
        return;
      }
      const cachedSnapshot = runtime.snapshots.get(targetContext.cacheKey);
      if (cachedSnapshot && !options?.force) {
        setSnapshot(cachedSnapshot);
        setNetworkTraffic(
          runtime.metrics.cached(targetContext.cacheKey, cachedSnapshot),
        );
        return;
      }

      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      loadingRef.current = true;
      setLoading(true);
      setError(null);
      try {
        let snapshotRequest = runtime.inFlight.get(targetContext.cacheKey);
        if (!snapshotRequest) {
          snapshotRequest = loadTargetSnapshot(targetContext).finally(() => {
            runtime.inFlight.delete(targetContext.cacheKey);
          });
          runtime.inFlight.set(targetContext.cacheKey, snapshotRequest);
        }
        const nextSnapshot = await snapshotRequest;
        if (requestIdRef.current === requestId) {
          const nextNetworkTraffic = runtime.metrics.update(
            targetContext.cacheKey,
            nextSnapshot,
          );
          runtime.snapshots.set(targetContext.cacheKey, nextSnapshot);
          setSnapshot(nextSnapshot);
          setNetworkTraffic(nextNetworkTraffic);
        }
      } catch (nextError) {
        if (requestIdRef.current === requestId) {
          const localTarget = targetContext.target.kind === "local";
          setError(
            buildUserFacingError(nextError, {
              recoveryAction: localTarget
                ? "请稍后重试。"
                : "请检查连接后重试。",
              title: localTarget
                ? "无法读取本机系统信息"
                : "无法读取服务器信息",
            }),
          );
        }
      } finally {
        if (requestIdRef.current === requestId) {
          loadingRef.current = false;
          setLoading(false);
        }
      }
    },
    [runtime, targetContext],
  );

  useEffect(() => {
    setError(null);
    if (selectedTargetKey) {
      const cachedSnapshot = runtime.snapshots.get(selectedTargetKey) ?? null;
      setSnapshot(cachedSnapshot);
      setNetworkTraffic(
        runtime.metrics.cached(selectedTargetKey, cachedSnapshot ?? undefined),
      );
      setLoading(false);
      if (!cachedSnapshot) {
        void refresh({ force: true });
      }
    } else {
      setLoading(false);
      setSnapshot(null);
      setNetworkTraffic(null);
    }
    return () => {
      requestIdRef.current += 1;
      loadingRef.current = false;
      if (selectedTargetKey) {
        // 收起面板或切换目标后允许重新采集；挂起的旧请求不能永久占住目标。
        runtime.inFlight.delete(selectedTargetKey);
      }
    };
  }, [refresh, runtime, selectedTargetKey]);

  useEffect(() => {
    if (!selectedTargetKey || refreshIntervalMs <= 0) {
      return undefined;
    }

    let disposed = false;
    let refreshInFlight = false;
    let timeoutId: number | undefined;
    const clearNextRefresh = () => {
      if (timeoutId === undefined) {
        return;
      }
      window.clearTimeout(timeoutId);
      timeoutId = undefined;
    };
    const scheduleNextRefresh = () => {
      if (disposed) {
        return;
      }
      clearNextRefresh();
      const delay = resolveServerInfoRefreshDelay({
        documentVisible: documentVisible(),
        hiddenRefreshIntervalMs,
        refreshIntervalMs,
      });
      if (delay === null) {
        return;
      }
      timeoutId = window.setTimeout(() => {
        timeoutId = undefined;
        void runRefresh();
      }, delay);
    };
    const runRefresh = async () => {
      if (refreshInFlight) {
        return;
      }
      refreshInFlight = true;
      try {
        await refresh({ force: true });
      } finally {
        refreshInFlight = false;
        scheduleNextRefresh();
      }
    };
    const handleVisibilityChange = () => {
      clearNextRefresh();
      if (documentVisible()) {
        void runRefresh();
      } else {
        scheduleNextRefresh();
      }
    };

    scheduleNextRefresh();
    const unsubscribeVisibility =
      subscribeToVisibilityChange(handleVisibilityChange);

    return () => {
      disposed = true;
      clearNextRefresh();
      unsubscribeVisibility();
    };
  }, [
    documentVisible,
    hiddenRefreshIntervalMs,
    refresh,
    refreshIntervalMs,
    selectedTargetKey,
    subscribeToVisibilityChange,
  ]);

  return {
    error,
    loading,
    networkTraffic,
    refresh,
    refreshIntervalMs,
    setRefreshIntervalMs,
    snapshot,
  };
}

/** 按目标边界选择只读采集源，本机不经过只支持 SSH/容器的远程 IPC。 */
async function loadTargetSnapshot(targetContext: ServerInfoTargetContext) {
  if (targetContext.target.kind === "local") {
    const runtimeSnapshot = await getRuntimeHealthSnapshot();
    return localServerInfoSnapshot(runtimeSnapshot, targetContext.hostId);
  }

  return getServerInfoSnapshot({
    hostId: targetContext.hostId,
    target: targetContext.target,
  });
}

export function resolveServerInfoRefreshDelay({
  documentVisible,
  hiddenRefreshIntervalMs,
  refreshIntervalMs,
}: {
  documentVisible: boolean;
  hiddenRefreshIntervalMs: number;
  refreshIntervalMs: number;
}) {
  if (refreshIntervalMs <= 0) {
    return null;
  }
  const visibleDelay = Math.max(1, refreshIntervalMs);
  return documentVisible
    ? visibleDelay
    : Math.max(visibleDelay, hiddenRefreshIntervalMs);
}
