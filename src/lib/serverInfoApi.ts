// @author kongweiguang

import { invoke, isTauri } from "@tauri-apps/api/core";
import type { RemoteTargetRef } from "./targetModel";

export interface ServerInfoRequest {
  hostId: string;
  target: RemoteTargetRef;
}

export interface ServerInfoSnapshot {
  hostId: string;
  hostName: string;
  host: string;
  port: number;
  username: string;
  hostname?: string | null;
  os?: string | null;
  architecture?: string | null;
  kernel?: string | null;
  uptimeSeconds?: number | null;
  loadAverage?: number[] | null;
  cpuUsagePercent?: number | null;
  cpuCount?: number | null;
  cpuModel?: string | null;
  cpuCoreUsagePercents?: number[] | null;
  processCount?: number | null;
  runningProcessCount?: number | null;
  memoryTotalBytes?: number | null;
  memoryUsedBytes?: number | null;
  memoryAvailableBytes?: number | null;
  memoryBuffersBytes?: number | null;
  memoryCachedBytes?: number | null;
  swapTotalBytes?: number | null;
  swapUsedBytes?: number | null;
  diskTotalBytes?: number | null;
  diskUsedBytes?: number | null;
  diskAvailableBytes?: number | null;
  diskMount?: string | null;
  disks?: ServerDiskInfo[] | null;
  networkRxBytes?: number | null;
  networkTxBytes?: number | null;
  networkInterfaces?: ServerNetworkInterfaceInfo[] | null;
  topProcesses?: ServerProcessInfo[] | null;
  gpuProbeStatus?: string | null;
  gpus?: ServerGpuInfo[] | null;
  npuProbeStatus?: string | null;
  npus?: ServerNpuInfo[] | null;
  capturedAt: string;
}

interface ServerDiskInfo {
  filesystem: string;
  mount: string;
  totalBytes?: number | null;
  usedBytes?: number | null;
  availableBytes?: number | null;
}

interface ServerNetworkInterfaceInfo {
  name: string;
  rxBytes?: number | null;
  txBytes?: number | null;
}

interface ServerProcessInfo {
  pid: number;
  name: string;
  cpuUsagePercent?: number | null;
  memoryPercent?: number | null;
  memoryBytes?: number | null;
}

export interface ServerGpuInfo {
  name: string;
  vendor?: string | null;
  driverVersion?: string | null;
  memoryTotalBytes?: number | null;
  memoryUsedBytes?: number | null;
  utilizationPercent?: number | null;
  temperatureCelsius?: number | null;
}

export interface ServerNpuInfo {
  id: number;
  chipId?: number | null;
  name: string;
  health?: string | null;
  busId?: string | null;
  utilizationPercent?: number | null;
  memoryTotalBytes?: number | null;
  memoryUsedBytes?: number | null;
  hbmTotalBytes?: number | null;
  hbmUsedBytes?: number | null;
  powerWatts?: number | null;
  temperatureCelsius?: number | null;
}

export async function getServerInfoSnapshot(
  request: ServerInfoRequest,
): Promise<ServerInfoSnapshot> {
  if (!isTauri()) {
    return browserPreviewSnapshot(request);
  }

  return invoke<ServerInfoSnapshot>("server_info_snapshot", { request });
}

function browserPreviewSnapshot(
  request: ServerInfoRequest,
): ServerInfoSnapshot {
  const target = request.target;
  const nowSeconds = Math.floor(Date.now() / 1000);
  const trafficOffsetBytes = (nowSeconds % 86_400) * 1024;
  const containerName =
    target?.kind === "dockerContainer"
      ? target.containerName || target.containerId.slice(0, 12)
      : undefined;
  return {
    architecture: "x86_64",
    capturedAt: nowSeconds.toString(),
    cpuCount: 4,
    cpuCoreUsagePercents: [8.2, 12.4, 16.8, 11.6],
    cpuModel: "AMD EPYC Preview",
    cpuUsagePercent: 12.4,
    diskMount: "/",
    diskAvailableBytes: 46 * 1024 * 1024 * 1024,
    diskTotalBytes: 64 * 1024 * 1024 * 1024,
    diskUsedBytes: 18 * 1024 * 1024 * 1024,
    disks: [
      {
        availableBytes: 46 * 1024 * 1024 * 1024,
        filesystem: "/dev/vda1",
        mount: "/",
        totalBytes: 64 * 1024 * 1024 * 1024,
        usedBytes: 18 * 1024 * 1024 * 1024,
      },
      {
        availableBytes: 180 * 1024 * 1024 * 1024,
        filesystem: "/dev/vdb1",
        mount: "/data",
        totalBytes: 256 * 1024 * 1024 * 1024,
        usedBytes: 76 * 1024 * 1024 * 1024,
      },
    ],
    gpus: [
      {
        driverVersion: "555.42",
        memoryTotalBytes: 24 * 1024 * 1024 * 1024,
        memoryUsedBytes: 6 * 1024 * 1024 * 1024,
        name: "NVIDIA RTX 4090",
        temperatureCelsius: 54,
        utilizationPercent: 36.5,
        vendor: "NVIDIA",
      },
    ],
    gpuProbeStatus: "nvidia_smi",
    npus: [
      {
        busId: "0000:06:00.0",
        chipId: 0,
        hbmTotalBytes: 32 * 1024 * 1024 * 1024,
        hbmUsedBytes: 2659 * 1024 * 1024,
        health: "OK",
        id: 2,
        name: "910B4",
        powerWatts: 84,
        temperatureCelsius: 44,
        utilizationPercent: 0,
      },
    ],
    npuProbeStatus: "npu_smi",
    host:
      target?.kind === "dockerContainer"
        ? `${target.runtime ?? "docker"}:${target.containerId.slice(0, 12)}`
        : "preview.internal",
    hostId: request.hostId,
    hostName: containerName ?? "浏览器预览主机",
    hostname: containerName ?? "preview-dev",
    kernel: "6.8.0-preview",
    loadAverage: [0.18, 0.24, 0.31],
    memoryTotalBytes: 8 * 1024 * 1024 * 1024,
    memoryUsedBytes: 3 * 1024 * 1024 * 1024,
    memoryAvailableBytes: 5 * 1024 * 1024 * 1024,
    memoryBuffersBytes: 256 * 1024 * 1024,
    memoryCachedBytes: 1500 * 1024 * 1024,
    networkInterfaces: [
      {
        name: "eth0",
        rxBytes: 10_345_678 + trafficOffsetBytes * 2,
        txBytes: 7_765_432 + trafficOffsetBytes,
      },
      {
        name: "tailscale0",
        rxBytes: 2_000_000 + Math.floor(trafficOffsetBytes / 4),
        txBytes: 1_000_000 + Math.floor(trafficOffsetBytes / 8),
      },
      {
        name: "lo",
        rxBytes: 800_000 + Math.floor(trafficOffsetBytes / 16),
        txBytes: 800_000 + Math.floor(trafficOffsetBytes / 16),
      },
    ],
    networkRxBytes: 13_145_678 + trafficOffsetBytes * 2,
    networkTxBytes: 9_565_432 + trafficOffsetBytes,
    os: "Linux",
    port: 22,
    processCount: 142,
    runningProcessCount: 3,
    swapTotalBytes: 2 * 1024 * 1024 * 1024,
    swapUsedBytes: 0,
    topProcesses: [
      {
        cpuUsagePercent: 8.2,
        memoryBytes: 72 * 1024 * 1024,
        memoryPercent: 1.4,
        name: "node",
        pid: 4201,
      },
      {
        cpuUsagePercent: 2.8,
        memoryBytes: 38 * 1024 * 1024,
        memoryPercent: 0.7,
        name: "sshd",
        pid: 988,
      },
    ],
    uptimeSeconds: 186_400,
    username: "deploy",
  };
}
