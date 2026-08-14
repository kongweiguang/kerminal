// @author kongweiguang

import { describe, expect, it } from "vitest";
import type { ServerInfoSnapshot } from "../../../../src/lib/serverInfoApi";
import {
  createServerInfoMetricsCache,
  coreUsages,
  formatBytes,
  formatTrafficRate,
  formatUptime,
  gpuCardHelper,
  gpuMemoryLabel,
  networkTrafficFromSnapshot,
  npuMemoryLabel,
  serverGpuSummaryValue,
  shouldShowNpuCard,
} from "../../../../src/features/tool-panel/serverInfoMetricsModel";

function snapshot(
  overrides: Partial<ServerInfoSnapshot> = {},
): ServerInfoSnapshot {
  return {
    capturedAt: "100",
    host: "prod.internal",
    hostId: "prod-api",
    hostName: "prod api",
    port: 22,
    username: "deploy",
    ...overrides,
  };
}

describe("serverInfoMetricsModel", () => {
  it("builds a fallback network interface from aggregate counters", () => {
    const traffic = networkTrafficFromSnapshot(
      snapshot({
        networkRxBytes: 4096,
        networkTxBytes: 2048,
      }),
    );

    expect(traffic.interfaces).toEqual([
      {
        name: "全部接口",
        rxBytes: 4096,
        rxBytesPerSecond: undefined,
        txBytes: 2048,
        txBytesPerSecond: undefined,
      },
    ]);
    expect(traffic.topInterface?.name).toBe("全部接口");
    expect(traffic.totalRxBytesPerSecond).toBeUndefined();
    expect(traffic.totalTxBytesPerSecond).toBeUndefined();
  });

  it("computes network rates and ranks interfaces by sampled traffic", () => {
    const previous = snapshot({
      networkInterfaces: [
        { name: "eth0", rxBytes: 1_000, txBytes: 1_000 },
        { name: "tailscale0", rxBytes: 5_000, txBytes: 100 },
      ],
      networkRxBytes: 6_000,
      networkTxBytes: 1_100,
    });
    const current = snapshot({
      networkInterfaces: [
        { name: "eth0", rxBytes: 3_000, txBytes: 1_400 },
        { name: "tailscale0", rxBytes: 5_200, txBytes: 900 },
      ],
      networkRxBytes: 8_200,
      networkTxBytes: 2_300,
    });

    const traffic = networkTrafficFromSnapshot(current, previous, 2_000);

    expect(traffic.sampleDurationMs).toBe(2_000);
    expect(traffic.totalRxBytesPerSecond).toBe(1_100);
    expect(traffic.totalTxBytesPerSecond).toBe(600);
    expect(traffic.interfaces.map((networkInterface) => networkInterface.name)).toEqual([
      "eth0",
      "tailscale0",
    ]);
    expect(traffic.interfaces[0]).toMatchObject({
      rxBytesPerSecond: 1_000,
      txBytesPerSecond: 200,
    });
  });

  it("isolates cached network traffic by cache instance", () => {
    const cache = createServerInfoMetricsCache();

    cache.update(
      "prod-api",
      snapshot({
        capturedAt: "10",
        networkRxBytes: 100,
        networkTxBytes: 200,
      }),
    );
    const traffic = cache.update(
      "prod-api",
      snapshot({
        capturedAt: "12",
        networkRxBytes: 300,
        networkTxBytes: 260,
      }),
    );

    expect(traffic.sampleDurationMs).toBe(2_000);
    expect(traffic.totalRxBytesPerSecond).toBe(100);
    expect(traffic.totalTxBytesPerSecond).toBe(30);
    expect(cache.cached("prod-api")?.totalRxBytesPerSecond).toBe(100);

    expect(createServerInfoMetricsCache().cached("prod-api")).toBeNull();
  });

  it("formats byte, rate, uptime, cpu and gpu summaries", () => {
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatTrafficRate(2048)).toBe("2.0 KB/s");
    expect(formatTrafficRate(undefined, "等待采样")).toBe("等待采样");
    expect(formatUptime(90_000)).toBe("1 天 1 小时");
    expect(coreUsages(snapshot({ cpuCount: 3, cpuUsagePercent: 12.5 }))).toEqual([
      12.5,
      12.5,
      12.5,
    ]);
    expect(
      gpuMemoryLabel({
        memoryTotalBytes: 8 * 1024,
        memoryUsedBytes: 2 * 1024,
        name: "GPU",
      }),
    ).toBe("2.0 KB / 8.0 KB");
    expect(
      serverGpuSummaryValue([
        {
          memoryTotalBytes: 8 * 1024,
          memoryUsedBytes: 2 * 1024,
          name: "GPU",
        },
      ]),
    ).toBe("25.0%");
    expect(serverGpuSummaryValue([])).toBe("0 张");
    expect(gpuCardHelper(snapshot({ gpuProbeStatus: "no_probe_command" }), [])).toBe(
      "0 张显卡",
    );
    expect(
      npuMemoryLabel({
        hbmTotalBytes: 32 * 1024,
        hbmUsedBytes: 2659,
        id: 2,
        name: "910B4",
      }),
    ).toBe("HBM 2.6 KB / 32.0 KB");
    expect(
      shouldShowNpuCard(
        snapshot({ npuProbeStatus: "npu_smi", npus: [{ id: 2, name: "910B4" }] }),
      ),
    ).toBe(true);
    expect(shouldShowNpuCard(snapshot())).toBe(false);
  });

  it("keeps all per-core samples for 64-core hosts", () => {
    const cores = Array.from({ length: 64 }, (_, index) => index + 0.5);

    expect(coreUsages(snapshot({ cpuCoreUsagePercents: cores }))).toEqual(cores);
  });

  it("marks a network counter reset instead of reporting a negative rate", () => {
    const traffic = networkTrafficFromSnapshot(
      snapshot({
        networkInterfaces: [{ name: "eth0", rxBytes: 100, txBytes: 200 }],
      }),
      snapshot({
        networkInterfaces: [
          { name: "eth0", rxBytes: 1_000, txBytes: 2_000 },
        ],
      }),
      1_000,
    );

    expect(traffic.counterReset).toBe(true);
    expect(traffic.interfaces[0].rxBytesPerSecond).toBeUndefined();
    expect(traffic.interfaces[0].txBytesPerSecond).toBeUndefined();
  });
});
