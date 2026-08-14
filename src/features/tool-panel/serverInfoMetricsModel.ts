// @author kongweiguang

import type {
  ServerGpuInfo,
  ServerInfoSnapshot,
  ServerNpuInfo,
} from "../../lib/serverInfoApi";

interface NetworkTrafficSample {
  capturedAtMs?: number;
  receivedAtMs: number;
  snapshot: ServerInfoSnapshot;
}

export interface NetworkInterfaceTraffic {
  name: string;
  rxBytes?: number | null;
  rxBytesPerSecond?: number;
  txBytes?: number | null;
  txBytesPerSecond?: number;
}

export interface NetworkTrafficSnapshot {
  counterReset?: boolean;
  interfaces: NetworkInterfaceTraffic[];
  sampleDurationMs?: number;
  topInterface?: NetworkInterfaceTraffic;
  totalRxBytesPerSecond?: number;
  totalTxBytesPerSecond?: number;
}

export interface ServerInfoMetricsCache {
  cached(
    targetKey: string,
    cachedSnapshot?: ServerInfoSnapshot,
  ): NetworkTrafficSnapshot | null;
  update(
    targetKey: string,
    snapshot: ServerInfoSnapshot,
  ): NetworkTrafficSnapshot;
}

/** 创建实例级网络指标缓存，隔离窗口、目标和测试生命周期。 */
export function createServerInfoMetricsCache(): ServerInfoMetricsCache {
  const sampleCache = new Map<string, NetworkTrafficSample>();
  const rateCache = new Map<string, NetworkTrafficSnapshot>();
  return {
    cached(targetKey, cachedSnapshot) {
      return (
        rateCache.get(targetKey) ??
        (cachedSnapshot ? networkTrafficFromSnapshot(cachedSnapshot) : null)
      );
    },
    update(targetKey, snapshot) {
      const receivedAtMs = Date.now();
      const capturedAtMs = capturedAtMilliseconds(snapshot);
      const previous = sampleCache.get(targetKey);
      const sampleDurationMs = previous
        ? networkSampleDurationMs(previous, capturedAtMs, receivedAtMs)
        : undefined;
      const traffic = networkTrafficFromSnapshot(
        snapshot,
        previous?.snapshot,
        sampleDurationMs,
      );
      sampleCache.set(targetKey, { capturedAtMs, receivedAtMs, snapshot });
      rateCache.set(targetKey, traffic);
      return traffic;
    },
  };
}

export function coreUsages(snapshot: ServerInfoSnapshot) {
  const cpuCoreUsagePercents = numberValues(snapshot.cpuCoreUsagePercents);
  if (cpuCoreUsagePercents.length > 0) {
    return cpuCoreUsagePercents;
  }
  if (snapshot.cpuUsagePercent != null && snapshot.cpuCount != null) {
    return Array.from(
      { length: Number(snapshot.cpuCount) },
      () => snapshot.cpuUsagePercent ?? 0,
    );
  }
  return [];
}

export function loadAverageValues(value: ServerInfoSnapshot["loadAverage"]) {
  const values = numberValues(value);
  return values.length > 0 ? values : undefined;
}

function numberValues(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(
    (item): item is number => typeof item === "number" && Number.isFinite(item),
  );
}

export function formatLoadAverage(values?: number[]) {
  return values?.map((item) => item.toFixed(2)).join(" / ");
}

export function formatProcessSummary(snapshot: ServerInfoSnapshot) {
  if (snapshot.processCount == null) {
    return "-";
  }
  if (snapshot.runningProcessCount == null) {
    return `${snapshot.processCount} 个`;
  }
  return `${snapshot.processCount} 个 / 运行 ${snapshot.runningProcessCount}`;
}

export function percentOf(used?: number | null, total?: number | null) {
  if (used == null || total == null || total <= 0) {
    return undefined;
  }
  return (used / total) * 100;
}

export function networkTrafficFromSnapshot(
  snapshot: ServerInfoSnapshot,
  previousSnapshot?: ServerInfoSnapshot,
  sampleDurationMs?: number,
): NetworkTrafficSnapshot {
  const currentInterfaces = normalizedNetworkInterfaces(snapshot);
  const previousInterfaces = new Map(
    normalizedNetworkInterfaces(previousSnapshot).map((networkInterface) => [
      networkInterface.name,
      networkInterface,
    ]),
  );
  const sampleSeconds =
    sampleDurationMs && sampleDurationMs > 0
      ? sampleDurationMs / 1000
      : undefined;
  const counterReset = currentInterfaces.some((networkInterface) => {
    const previous = previousInterfaces.get(networkInterface.name);
    return (
      counterDecreased(networkInterface.rxBytes, previous?.rxBytes) ||
      counterDecreased(networkInterface.txBytes, previous?.txBytes)
    );
  });
  const unsortedInterfaces = currentInterfaces.map((networkInterface) => {
    const previous = previousInterfaces.get(networkInterface.name);
    return {
      ...networkInterface,
      rxBytesPerSecond: bytesPerSecond(
        networkInterface.rxBytes,
        previous?.rxBytes,
        sampleSeconds,
      ),
      txBytesPerSecond: bytesPerSecond(
        networkInterface.txBytes,
        previous?.txBytes,
        sampleSeconds,
      ),
    };
  });
  const interfaces = rankedNetworkInterfaces(unsortedInterfaces);
  const totalRxBytesPerSecond =
    bytesPerSecond(
      snapshot.networkRxBytes,
      previousSnapshot?.networkRxBytes,
      sampleSeconds,
    ) ??
    sumKnownRates(
      interfaces.map((networkInterface) => networkInterface.rxBytesPerSecond),
    );
  const totalTxBytesPerSecond =
    bytesPerSecond(
      snapshot.networkTxBytes,
      previousSnapshot?.networkTxBytes,
      sampleSeconds,
    ) ??
    sumKnownRates(
      interfaces.map((networkInterface) => networkInterface.txBytesPerSecond),
    );

  return {
    counterReset,
    interfaces,
    sampleDurationMs: sampleSeconds ? sampleDurationMs : undefined,
    topInterface: interfaces[0],
    totalRxBytesPerSecond,
    totalTxBytesPerSecond,
  };
}

function counterDecreased(current?: number | null, previous?: number | null) {
  return current != null && previous != null && current < previous;
}

function normalizedNetworkInterfaces(
  snapshot?: ServerInfoSnapshot,
): NetworkInterfaceTraffic[] {
  if (!snapshot) {
    return [];
  }
  const networkInterfaces = Array.isArray(snapshot.networkInterfaces)
    ? snapshot.networkInterfaces
    : [];
  if (networkInterfaces.length > 0) {
    return networkInterfaces.map((networkInterface) => ({
      name: networkInterface.name,
      rxBytes: networkInterface.rxBytes,
      txBytes: networkInterface.txBytes,
    }));
  }
  if (snapshot.networkRxBytes != null || snapshot.networkTxBytes != null) {
    return [
      {
        name: "全部接口",
        rxBytes: snapshot.networkRxBytes,
        txBytes: snapshot.networkTxBytes,
      },
    ];
  }
  return [];
}

function bytesPerSecond(
  current?: number | null,
  previous?: number | null,
  sampleSeconds?: number,
) {
  if (
    current == null ||
    previous == null ||
    sampleSeconds == null ||
    sampleSeconds <= 0
  ) {
    return undefined;
  }
  const delta = current - previous;
  return delta >= 0 ? delta / sampleSeconds : undefined;
}

function sumKnownRates(values: Array<number | undefined>) {
  const knownValues = values.filter(
    (value): value is number => value !== undefined && Number.isFinite(value),
  );
  if (knownValues.length === 0) {
    return undefined;
  }
  return knownValues.reduce((total, value) => total + value, 0);
}

function rankedNetworkInterfaces(interfaces: NetworkInterfaceTraffic[]) {
  const hasRateSample = interfaces.some(
    (networkInterface) =>
      networkInterface.rxBytesPerSecond !== undefined ||
      networkInterface.txBytesPerSecond !== undefined,
  );
  return [...interfaces].sort(
    (left, right) =>
      networkTrafficScore(right, hasRateSample) -
      networkTrafficScore(left, hasRateSample),
  );
}

function networkTrafficScore(
  networkInterface: NetworkInterfaceTraffic,
  hasRateSample: boolean,
) {
  const rateScore =
    (networkInterface.rxBytesPerSecond ?? 0) +
    (networkInterface.txBytesPerSecond ?? 0);
  if (hasRateSample) {
    return rateScore;
  }
  return (networkInterface.rxBytes ?? 0) + (networkInterface.txBytes ?? 0);
}

function capturedAtMilliseconds(snapshot: ServerInfoSnapshot) {
  const seconds = Number(snapshot.capturedAt);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return undefined;
  }
  return seconds * 1000;
}

function networkSampleDurationMs(
  previous: NetworkTrafficSample,
  capturedAtMs: number | undefined,
  receivedAtMs: number,
) {
  if (
    capturedAtMs !== undefined &&
    previous.capturedAtMs !== undefined &&
    capturedAtMs > previous.capturedAtMs
  ) {
    return capturedAtMs - previous.capturedAtMs;
  }
  return receivedAtMs > previous.receivedAtMs
    ? receivedAtMs - previous.receivedAtMs
    : undefined;
}

export function formatTrafficRate(value?: number, emptyLabel = "-") {
  if (value === undefined || Number.isNaN(value)) {
    return emptyLabel;
  }
  return `${formatBytes(value)}/s`;
}

export function formatPercent(value?: number | null) {
  if (value == null || Number.isNaN(value)) {
    return "-";
  }
  return `${value.toFixed(1)}%`;
}

export function formatBytes(value?: number | null) {
  if (value == null || Number.isNaN(value)) {
    return "-";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  let amount = value;
  let index = 0;
  while (amount >= 1024 && index < units.length - 1) {
    amount /= 1024;
    index += 1;
  }
  return `${amount.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

export function gpuMemoryLabel(gpu: ServerGpuInfo) {
  if (gpu.memoryUsedBytes !== undefined && gpu.memoryUsedBytes !== null) {
    return `${formatBytes(gpu.memoryUsedBytes)} / ${formatBytes(
      gpu.memoryTotalBytes ?? undefined,
    )}`;
  }
  if (gpu.memoryTotalBytes !== undefined && gpu.memoryTotalBytes !== null) {
    return `总计 ${formatBytes(gpu.memoryTotalBytes)}`;
  }
  return "-";
}

/** 优先展示 NPU 的 HBM，避免把板载通用内存误当成模型可用显存。 */
export function npuMemoryLabel(npu: ServerNpuInfo) {
  if (npu.hbmUsedBytes != null || npu.hbmTotalBytes != null) {
    return `HBM ${formatBytes(npu.hbmUsedBytes)} / ${formatBytes(
      npu.hbmTotalBytes,
    )}`;
  }
  if (npu.memoryUsedBytes != null || npu.memoryTotalBytes != null) {
    return `内存 ${formatBytes(npu.memoryUsedBytes)} / ${formatBytes(
      npu.memoryTotalBytes,
    )}`;
  }
  return "内存 -";
}

/** 仅在远端实际支持 npu-smi 时显示 NPU 区域，避免普通主机堆叠无意义空卡片。 */
export function shouldShowNpuCard(snapshot: ServerInfoSnapshot) {
  return (
    (snapshot.npus?.length ?? 0) > 0 ||
    (snapshot.npuProbeStatus != null &&
      snapshot.npuProbeStatus !== "no_probe_command")
  );
}

function primaryGpuPercent(gpus: ServerGpuInfo[]) {
  const usageGpu = gpus.find(
    (gpu) =>
      gpu.utilizationPercent !== undefined && gpu.utilizationPercent !== null,
  );
  if (
    usageGpu?.utilizationPercent !== undefined &&
    usageGpu.utilizationPercent !== null
  ) {
    return usageGpu.utilizationPercent;
  }

  const memoryGpu = gpus.find(
    (gpu) =>
      percentOf(
        gpu.memoryUsedBytes ?? undefined,
        gpu.memoryTotalBytes ?? undefined,
      ) !== undefined,
  );
  return memoryGpu
    ? percentOf(
        memoryGpu.memoryUsedBytes ?? undefined,
        memoryGpu.memoryTotalBytes ?? undefined,
      )
    : undefined;
}

export function serverGpuSummaryValue(gpus: ServerGpuInfo[]) {
  const percent = primaryGpuPercent(gpus);
  return percent !== undefined ? formatPercent(percent) : `${gpus.length} 张`;
}

export function gpuCardHelper(
  snapshot: ServerInfoSnapshot,
  gpus: ServerGpuInfo[],
) {
  if (gpus.length === 0) {
    return "0 张显卡";
  }
  if (
    gpus.length > 0 &&
    (snapshot.gpuProbeStatus === "lspci" ||
      snapshot.gpuProbeStatus === "nvidia_smi_list")
  ) {
    return `${gpus.length} 张设备，仅静态识别`;
  }
  return `${gpus.length} 张显卡`;
}

export function formatTimestamp(value?: string | null) {
  if (!value) {
    return "-";
  }
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return value;
  }
  return new Date(seconds * 1000).toLocaleTimeString("zh-CN", {
    hour12: false,
  });
}

export function formatUptime(seconds?: number | null) {
  if (seconds == null || Number.isNaN(seconds)) {
    return undefined;
  }
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  if (days > 0) {
    return `${days} 天 ${hours} 小时`;
  }
  if (hours > 0) {
    return `${hours} 小时 ${minutes} 分钟`;
  }
  return `${minutes} 分钟`;
}
