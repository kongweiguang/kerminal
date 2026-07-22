import { invoke, isTauri } from "@tauri-apps/api/core";

export interface DiagnosticBundle {
  id: string;
  createdAt: string;
  fileName: string;
  path: string;
  bytesWritten: number;
  sections: string[];
  redacted: boolean;
}

export interface RuntimeHealthSnapshot {
  capturedAt: string;
  process: RuntimeProcessHealth;
  system: RuntimeSystemHealth;
  storage: RuntimeStorageHealth;
  sampling: RuntimeSamplingInfo;
  redacted: boolean;
}

export interface ManagedSshRuntimeSnapshot {
  activeChannels: number;
  activeSessions: number;
  generatedAt: string;
  recentLegacyFallbacks: ManagedSshLegacyFallbackSnapshot[];
  sessions: ManagedSshSessionSnapshot[];
}

export interface ManagedSshLegacyFallbackSnapshot {
  capability: string;
  count: number;
  lastAt: string;
  reason: string;
  target?: string | null;
}

export interface ManagedSshSessionSnapshot {
  activeChannels: number;
  channelCounts: Record<string, number>;
  createdAt: string;
  key: ManagedSshSessionKeySummary;
  lastError?: string | null;
  lastUsedAt: string;
  maxConcurrentExecChannels: number;
  openedChannels: number;
  pendingExecRequests: number;
  refCount: number;
  sessionId: string;
  state: "ready" | "closing" | "failed";
}

interface ManagedSshSessionKeySummary {
  jumps: string[];
  knownHostsProfile: string;
  proxyProfile?: string | null;
  runtimeFlags: string[];
  target: string;
}

type ConfigWatchBackend = "native" | "polling" | "unavailable";

type ConfigWatchDomain =
  | "settings"
  | "profiles"
  | "hosts"
  | "snippets"
  | "workflows";

type ConfigWatchStatus = "ready" | "invalid" | "watcher-unavailable";

export interface ConfigWatchStatusSnapshot {
  enabled: boolean;
  backend: ConfigWatchBackend;
  watchedRoots: string[];
  ignoredGlobs: string[];
  lastSequence: number;
  lastBatchAt?: string | null;
  lastDomains: ConfigWatchDomain[];
  lastStatus?: ConfigWatchStatus | null;
  lastError?: string | null;
  fallbackReason?: string | null;
}

interface RuntimeProcessHealth {
  pid: number;
  name: string;
  memoryBytes: number;
  virtualMemoryBytes: number;
  cpuUsagePercent: number;
  startedAtSeconds: number;
  uptimeSeconds: number;
  diskReadBytes: number;
  diskWrittenBytes: number;
}

interface RuntimeSystemHealth {
  os: string;
  arch: string;
  hostName?: string | null;
  kernelVersion?: string | null;
  osVersion?: string | null;
  cpuCount: number;
  globalCpuUsagePercent: number;
  cpuCoreUsagePercents: number[];
  totalMemoryBytes: number;
  usedMemoryBytes: number;
  availableMemoryBytes: number;
  totalSwapBytes: number;
  usedSwapBytes: number;
  uptimeSeconds: number;
  bootTimeSeconds: number;
  gpus: RuntimeGpuHealth[];
}

export interface RuntimeGpuHealth {
  name: string;
  vendor?: string | null;
  driverVersion?: string | null;
  memoryTotalBytes?: number | null;
  memoryUsedBytes?: number | null;
  utilizationPercent?: number | null;
  temperatureCelsius?: number | null;
}

export interface RuntimeStorageHealth {
  root: string;
  commandDatabaseFile: string;
  appLogFile: string;
  logs: string;
  diagnostics: string;
  rootSizeBytes: number;
  commandDatabaseFileSizeBytes: number;
  appLogFileSizeBytes: number;
  appLogMaxFileSizeBytes: number;
  appLogRotationKeepFiles: number;
}

interface RuntimeSamplingInfo {
  source: string;
  cpuSampleIntervalMs: number;
  cpuRefreshedTwice: boolean;
}

export async function createDiagnosticsBundle(): Promise<DiagnosticBundle> {
  if (!isTauri()) {
    return createBrowserPreviewBundle();
  }

  return invoke<DiagnosticBundle>("diagnostics_create_bundle");
}

export async function getRuntimeHealthSnapshot(): Promise<RuntimeHealthSnapshot> {
  if (!isTauri()) {
    return createBrowserPreviewRuntimeHealth();
  }

  return invoke<RuntimeHealthSnapshot>("diagnostics_runtime_health");
}

export async function getManagedSshRuntimeSnapshot(): Promise<ManagedSshRuntimeSnapshot> {
  if (!isTauri()) {
    return createBrowserPreviewManagedSshRuntime();
  }

  return invoke<ManagedSshRuntimeSnapshot>("diagnostics_managed_ssh_runtime");
}

export async function getConfigWatchStatus(): Promise<ConfigWatchStatusSnapshot> {
  if (!isTauri()) {
    return createBrowserPreviewConfigWatchStatus();
  }

  return invoke<ConfigWatchStatusSnapshot>("config_watch_status");
}

function createBrowserPreviewBundle(): DiagnosticBundle {
  const createdAt = Math.floor(Date.now() / 1000).toString();
  const id = `browser-preview-${Date.now().toString(36)}`;
  const fileName = `diagnostics-${createdAt}-preview.json`;

  return {
    bytesWritten: 2048,
    createdAt,
    fileName,
    id,
    path: `browser-preview://diagnostics/${fileName}`,
    redacted: true,
    sections: [
      "app",
      "environment",
      "runtimeHealth",
      "paths",
      "logs",
      "commandDatabase",
      "settings",
      "terminalSessions",
    ],
  };
}

function createBrowserPreviewRuntimeHealth(): RuntimeHealthSnapshot {
  const capturedAt = Math.floor(Date.now() / 1000).toString();

  return {
    capturedAt,
    process: {
      cpuUsagePercent: 3.6,
      diskReadBytes: 12 * 1024 * 1024,
      diskWrittenBytes: 4 * 1024 * 1024,
      memoryBytes: 186 * 1024 * 1024,
      name: "kerminal-browser-preview",
      pid: 1425,
      startedAtSeconds: Number(capturedAt) - 1840,
      uptimeSeconds: 1840,
      virtualMemoryBytes: 520 * 1024 * 1024,
    },
    redacted: true,
    sampling: {
      cpuRefreshedTwice: true,
      cpuSampleIntervalMs: 200,
      source: "browser-preview",
    },
    storage: {
      appLogFile: "browser-preview://.kerminal/logs/kerminal.log",
      appLogFileSizeBytes: 64 * 1024,
      appLogMaxFileSizeBytes: 1_000_000,
      appLogRotationKeepFiles: 5,
      commandDatabaseFile: "browser-preview://.kerminal/data/command.sqlite",
      commandDatabaseFileSizeBytes: 768 * 1024,
      diagnostics: "browser-preview://.kerminal/diagnostics",
      logs: "browser-preview://.kerminal/logs",
      root: "browser-preview://.kerminal",
      rootSizeBytes: 16 * 1024 * 1024,
    },
    system: {
      arch: "x86_64",
      availableMemoryBytes: 9 * 1024 * 1024 * 1024,
      bootTimeSeconds: Number(capturedAt) - 86_400,
      cpuCoreUsagePercents: [10.4, 15.6, 10.9, 12.7, 17.9, 20.6, 20.0, 12.4],
      cpuCount: 8,
      globalCpuUsagePercent: 18.4,
      gpus: [
        {
          driverVersion: "preview",
          memoryTotalBytes: 8 * 1024 * 1024 * 1024,
          memoryUsedBytes: 2.6 * 1024 * 1024 * 1024,
          name: "NVIDIA GeForce RTX 4060",
          temperatureCelsius: 48,
          utilizationPercent: 22.5,
          vendor: "NVIDIA",
        },
      ],
      hostName: "本机预览",
      kernelVersion: "preview",
      os: "Browser Preview",
      osVersion: "1425",
      totalMemoryBytes: 16 * 1024 * 1024 * 1024,
      totalSwapBytes: 2 * 1024 * 1024 * 1024,
      uptimeSeconds: 86_400,
      usedMemoryBytes: 7 * 1024 * 1024 * 1024,
      usedSwapBytes: 256 * 1024 * 1024,
    },
  };
}

function createBrowserPreviewManagedSshRuntime(): ManagedSshRuntimeSnapshot {
  const generatedAt = Math.floor(Date.now() / 1000).toString();

  return {
    activeChannels: 2,
    activeSessions: 1,
    generatedAt,
    recentLegacyFallbacks: [],
    sessions: [
      {
        activeChannels: 2,
        channelCounts: {
          exec: 3,
          shell: 1,
          sftp: 2,
        },
        createdAt: generatedAt,
        key: {
          jumps: [],
          knownHostsProfile: "default",
          proxyProfile: null,
          runtimeFlags: ["browser-preview"],
          target: "preview@managed-ssh.local:22",
        },
        lastError: null,
        lastUsedAt: generatedAt,
        maxConcurrentExecChannels: 4,
        openedChannels: 6,
        pendingExecRequests: 0,
        refCount: 1,
        sessionId: "managed-ssh-preview",
        state: "ready",
      },
    ],
  };
}

function createBrowserPreviewConfigWatchStatus(): ConfigWatchStatusSnapshot {
  return {
    backend: "unavailable",
    enabled: false,
    fallbackReason: "browser-preview",
    ignoredGlobs: [
      "agents/**",
      "backups/**",
      "data/**",
      "workspace/**",
    ],
    lastBatchAt: null,
    lastDomains: [],
    lastError: null,
    lastSequence: 0,
    lastStatus: null,
    watchedRoots: [".", "profiles", "hosts", "snippets", "workflows"],
  };
}
