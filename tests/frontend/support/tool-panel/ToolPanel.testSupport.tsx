import { screen } from "@testing-library/react";
import { beforeEach, expect, vi } from "vitest";
import type { Machine, TerminalTab } from "../../../../src/features/workspace/types";
import type { WorkspaceContextProjection } from "../../../../src/features/workspace/context";
import { consumePendingAgentSendRequest } from "../agentSendRequestStore.testSupport";

const portForwardApiMocks = vi.hoisted(() => ({
  createPortForward: vi.fn(),
  listPortForwards: vi.fn(),
  stopPortForward: vi.fn(),
}));

const serverInfoApiMocks = vi.hoisted(() => ({
  getServerInfoSnapshot: vi.fn(),
}));
const diagnosticsApiMocks = vi.hoisted(() => ({
  createDiagnosticsBundle: vi.fn(),
  getManagedSshRuntimeSnapshot: vi.fn(),
  getRuntimeHealthSnapshot: vi.fn(),
}));
const tmuxApiMocks = vi.hoisted(() => ({
  tmuxAttachSession: vi.fn(),
  tmuxCreateSession: vi.fn(),
  tmuxDetachCurrent: vi.fn(),
  tmuxKillSession: vi.fn(),
  tmuxListSessions: vi.fn(),
  tmuxProbe: vi.fn(),
  tmuxRenameSession: vi.fn(),
}));

export {
  diagnosticsApiMocks,
  portForwardApiMocks,
  serverInfoApiMocks,
  tmuxApiMocks,
};

vi.mock("../../../../src/lib/portForwardApi", () => ({
  createPortForward: (...args: unknown[]) =>
    portForwardApiMocks.createPortForward(...args),
  listPortForwards: (...args: unknown[]) =>
    portForwardApiMocks.listPortForwards(...args),
  stopPortForward: (...args: unknown[]) =>
    portForwardApiMocks.stopPortForward(...args),
}));

vi.mock("../../../../src/lib/serverInfoApi", () => ({
  getServerInfoSnapshot: (...args: unknown[]) =>
    serverInfoApiMocks.getServerInfoSnapshot(...args),
}));
vi.mock("../../../../src/lib/diagnosticsApi", () => ({
  createDiagnosticsBundle: (...args: unknown[]) =>
    diagnosticsApiMocks.createDiagnosticsBundle(...args),
  getManagedSshRuntimeSnapshot: (...args: unknown[]) =>
    diagnosticsApiMocks.getManagedSshRuntimeSnapshot(...args),
  getRuntimeHealthSnapshot: (...args: unknown[]) =>
    diagnosticsApiMocks.getRuntimeHealthSnapshot(...args),
}));
vi.mock("../../../../src/lib/tmuxApi", () => ({
  tmuxAttachSession: (...args: unknown[]) =>
    tmuxApiMocks.tmuxAttachSession(...args),
  tmuxCreateSession: (...args: unknown[]) =>
    tmuxApiMocks.tmuxCreateSession(...args),
  tmuxDetachCurrent: (...args: unknown[]) =>
    tmuxApiMocks.tmuxDetachCurrent(...args),
  tmuxKillSession: (...args: unknown[]) =>
    tmuxApiMocks.tmuxKillSession(...args),
  tmuxListSessions: (...args: unknown[]) =>
    tmuxApiMocks.tmuxListSessions(...args),
  tmuxProbe: (...args: unknown[]) => tmuxApiMocks.tmuxProbe(...args),
  tmuxRenameSession: (...args: unknown[]) =>
    tmuxApiMocks.tmuxRenameSession(...args),
}));
vi.mock("../../../../src/features/sftp/MonacoTextEditor", () => ({
  MonacoTextEditor: () => <div data-testid="monaco-editor" />,
}));

export const sshMachine: Machine = {
  authType: "key",
  credentialRef: "C:/keys/prod_ed25519",
  description: "deploy@prod.internal:22",
  host: "prod.internal",
  id: "prod-api",
  kind: "ssh",
  name: "prod api",
  port: 22,
  production: true,
  status: "warning",
  tags: ["ssh", "prod"],
  username: "deploy",
};

export const sshTerminalTab: TerminalTab = {
  id: "tab-prod-api",
  layout: { paneId: "pane-prod-api", type: "pane" },
  machineId: sshMachine.id,
  title: sshMachine.name,
};

export const focusedSshPane = {
  id: "pane-prod-api",
  lines: [],
  machineId: sshMachine.id,
  mode: "ssh" as const,
  prompt: "$",
  remoteHostId: sshMachine.id,
  status: "online" as const,
  title: sshMachine.name,
};

export const secondarySshMachine: Machine = {
  authType: "agent",
  description: "ops@staging.internal:22",
  host: "staging.internal",
  id: "staging-api",
  kind: "ssh",
  name: "staging api",
  port: 22,
  production: false,
  status: "online",
  tags: ["ssh", "staging"],
  username: "ops",
};

export const secondarySshTab: TerminalTab = {
  id: "tab-staging-api",
  layout: { paneId: "pane-staging-api", type: "pane" },
  machineId: secondarySshMachine.id,
  title: secondarySshMachine.name,
};

export const secondarySshPane = {
  id: "pane-staging-api",
  lines: [],
  machineId: secondarySshMachine.id,
  mode: "ssh" as const,
  prompt: "$",
  remoteHostId: secondarySshMachine.id,
  status: "online" as const,
  title: secondarySshMachine.name,
};

export const contextWorkspaceProjection: WorkspaceContextProjection = {
  schemaVersion: 1,
  revision: 1,
  generatedAt: "2026-07-11T08:00:00.000Z",
  activeTabId: sshTerminalTab.id,
  focusedPaneId: focusedSshPane.id,
  machine: {
    id: sshMachine.id,
    name: sshMachine.name,
    kind: "ssh",
    status: "online",
    production: true,
    groupId: "production",
  },
  target: {
    id: sshMachine.id,
    kind: "ssh",
    label: sshMachine.host ?? sshMachine.name,
    production: true,
  },
  location: {
    cwd: "/srv/app",
    cwdSource: "osc7",
    pathStyle: "posix",
    confidence: "high",
  },
  subject: {
    id: focusedSshPane.id,
    kind: "terminalPane",
    title: focusedSshPane.title,
  },
  resources: {
    tabs: [
      {
        id: sshTerminalTab.id,
        title: sshTerminalTab.title,
        kind: "terminal",
        active: true,
      },
    ],
    panes: [
      {
        id: focusedSshPane.id,
        title: focusedSshPane.title,
        machineId: sshMachine.id,
        mode: "ssh",
        status: "online",
        focused: true,
      },
    ],
    activeTabPaneIds: [focusedSshPane.id],
    workspaceFileCount: 0,
    dirtyWorkspaceFileCount: 0,
    sftpRevealRequest: null,
  },
  runtime: {
    connectionStatus: "online",
    paneMode: "ssh",
    latencyMs: null,
    tmuxAttached: false,
  },
  agent: { sessionId: null, status: "unavailable" },
  freshness: {
    state: "fresh",
    sources: [{ source: "workspace", status: "available", revision: 1 }],
  },
  diagnostics: [],
};

const emptyManagedSshSnapshot = {
  activeChannels: 0,
  activeSessions: 0,
  generatedAt: "1",
  recentLegacyFallbacks: [],
  sessions: [],
};

export const readyManagedSshSnapshot = {
  activeChannels: 2,
  activeSessions: 1,
  generatedAt: "1",
  recentLegacyFallbacks: [],
  sessions: [
    {
      activeChannels: 2,
      channelCounts: {
        exec: 1,
        sftp: 1,
      },
      createdAt: "1",
      key: {
        jumps: [],
        knownHostsProfile: "default",
        proxyProfile: null,
        runtimeFlags: ["native"],
        target: "deploy@prod.internal:22",
      },
      lastError: null,
      lastUsedAt: "1",
      maxConcurrentExecChannels: 4,
      openedChannels: 3,
      pendingExecRequests: 0,
      refCount: 1,
      sessionId: "managed-prod-api",
      state: "ready" as const,
    },
  ],
};

export const localMachine: Machine = {
  description: "默认本地配置",
  id: "local-powershell",
  kind: "local",
  latencyMs: 1,
  name: "PowerShell",
  status: "online",
  tags: ["local", "dev"],
};

export const containerMachine: Machine = {
  containerId: "c0ffee1234567890",
  containerName: "api",
  description: "prod api / api",
  id: "docker:prod-api:c0ffee1234567890",
  kind: "dockerContainer",
  name: "api",
  parentMachineId: "prod-api",
  runtime: "docker",
  status: "online",
  tags: ["container", "docker"],
  target: {
    containerId: "c0ffee1234567890",
    containerName: "api",
    hostId: "prod-api",
    kind: "dockerContainer",
    runtime: "docker",
    workdir: "/app",
  },
};

export function assertNoManagedSshAvailabilityNotice() {
  expect(
    screen.queryByLabelText("Managed SSH runtime 状态"),
  ).not.toBeInTheDocument();
  expect(screen.queryByText("Managed reusable")).not.toBeInTheDocument();
  expect(screen.queryByText("Legacy terminal only")).not.toBeInTheDocument();
  expect(screen.queryByText("Auth required")).not.toBeInTheDocument();
  expect(screen.queryByText("Host key required")).not.toBeInTheDocument();
  expect(
    screen.queryByText(/右侧工具不能把 PTY 连接当作可复用 runtime/),
  ).not.toBeInTheDocument();
}

  beforeEach(() => {
    consumePendingAgentSendRequest();
    portForwardApiMocks.createPortForward.mockReset();
    portForwardApiMocks.listPortForwards.mockReset();
    portForwardApiMocks.stopPortForward.mockReset();
    portForwardApiMocks.listPortForwards.mockResolvedValue([]);
    portForwardApiMocks.createPortForward.mockResolvedValue({
      bindHost: "127.0.0.1",
      createdAt: "1",
      hostId: "prod-api",
      hostName: "prod api",
      id: "forward-new",
      kind: "local",
      name: "PostgreSQL 隧道",
      sourcePort: 15432,
      status: "running",
      targetHost: "127.0.0.1",
      targetPort: 5432,
    });
    portForwardApiMocks.stopPortForward.mockResolvedValue(true);
    serverInfoApiMocks.getServerInfoSnapshot.mockReset();
    serverInfoApiMocks.getServerInfoSnapshot.mockResolvedValue({
      architecture: "x86_64",
      capturedAt: "1",
      cpuCount: 4,
      cpuCoreUsagePercents: [9.5, 17.25, 0, 22.75],
      cpuModel: "AMD EPYC 7B13",
      cpuUsagePercent: 12.4,
      diskMount: "/",
      diskTotalBytes: 64 * 1024 * 1024 * 1024,
      diskUsedBytes: 16 * 1024 * 1024 * 1024,
      disks: [
        {
          availableBytes: 48 * 1024 * 1024 * 1024,
          filesystem: "/dev/sda1",
          mount: "/",
          totalBytes: 64 * 1024 * 1024 * 1024,
          usedBytes: 16 * 1024 * 1024 * 1024,
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
      host: "prod.internal",
      hostId: "prod-api",
      hostName: "prod api",
      hostname: "prod-api-01",
      kernel: "6.8.0",
      loadAverage: [0.1, 0.2, 0.3],
      memoryTotalBytes: 8 * 1024 * 1024 * 1024,
      memoryUsedBytes: 4 * 1024 * 1024 * 1024,
      memoryBuffersBytes: 256 * 1024 * 1024,
      memoryCachedBytes: 1024 * 1024 * 1024,
      networkInterfaces: [
        {
          name: "eth0",
          rxBytes: 1024,
          txBytes: 2048,
        },
      ],
      networkRxBytes: 1024,
      networkTxBytes: 2048,
      os: "Linux",
      port: 22,
      processCount: 154,
      runningProcessCount: 3,
      swapTotalBytes: 2 * 1024 * 1024 * 1024,
      swapUsedBytes: 0,
      topProcesses: [
        {
          cpuUsagePercent: 8.2,
          memoryBytes: 73_400_320,
          memoryPercent: 1.4,
          name: "kerminal-agent",
          pid: 101,
        },
      ],
      uptimeSeconds: 90_000,
      username: "deploy",
    });
    diagnosticsApiMocks.getRuntimeHealthSnapshot.mockReset();
    diagnosticsApiMocks.getManagedSshRuntimeSnapshot.mockReset();
    diagnosticsApiMocks.getManagedSshRuntimeSnapshot.mockResolvedValue(
      emptyManagedSshSnapshot,
    );
    diagnosticsApiMocks.createDiagnosticsBundle.mockReset();
    diagnosticsApiMocks.createDiagnosticsBundle.mockResolvedValue({
      bytesWritten: 2048,
      createdAt: "1710000000",
      fileName: "diagnostics-1710000000.json",
      id: "diagnostics-1",
      path: "C:/Users/me/.kerminal/diagnostics/diagnostics-1710000000.json",
      redacted: true,
      sections: ["app", "paths"],
    });
    diagnosticsApiMocks.getRuntimeHealthSnapshot.mockResolvedValue({
      capturedAt: "1",
      process: {
        cpuUsagePercent: 3.6,
        diskReadBytes: 1024,
        diskWrittenBytes: 2048,
        memoryBytes: 186 * 1024 * 1024,
        name: "kerminal",
        pid: 1425,
        startedAtSeconds: 1,
        uptimeSeconds: 1840,
        virtualMemoryBytes: 520 * 1024 * 1024,
      },
      redacted: true,
      sampling: {
        cpuRefreshedTwice: true,
        cpuSampleIntervalMs: 200,
        source: "sysinfo",
      },
      storage: {
        appLogFile: "C:/Users/me/.kerminal/logs/kerminal.log",
        appLogFileSizeBytes: 64 * 1024,
        appLogMaxFileSizeBytes: 1_000_000,
        appLogRotationKeepFiles: 5,
        commandDatabaseFile: "C:/Users/me/.kerminal/data/command.sqlite",
        commandDatabaseFileSizeBytes: 768 * 1024,
        diagnostics: "C:/Users/me/.kerminal/diagnostics",
        logs: "C:/Users/me/.kerminal/logs",
        root: "C:/Users/me/.kerminal",
        rootSizeBytes: 16 * 1024 * 1024,
      },
      system: {
        arch: "x86_64",
        availableMemoryBytes: 9 * 1024 * 1024 * 1024,
        bootTimeSeconds: 1,
        cpuCoreUsagePercents: [10.4, 15.6, 10.9, 12.7],
        cpuCount: 4,
        globalCpuUsagePercent: 18.4,
        gpus: [
          {
            driverVersion: "preview",
            memoryTotalBytes: 8 * 1024 * 1024 * 1024,
            memoryUsedBytes: 2 * 1024 * 1024 * 1024,
            name: "NVIDIA GeForce RTX 4060",
            temperatureCelsius: 48,
            utilizationPercent: 22.5,
            vendor: "NVIDIA",
          },
        ],
        hostName: "devbox",
        kernelVersion: "10",
        os: "Windows",
        osVersion: "11",
        totalMemoryBytes: 16 * 1024 * 1024 * 1024,
        totalSwapBytes: 2 * 1024 * 1024 * 1024,
        uptimeSeconds: 86_400,
        usedMemoryBytes: 7 * 1024 * 1024 * 1024,
        usedSwapBytes: 256 * 1024 * 1024,
      },
    });
    tmuxApiMocks.tmuxProbe.mockReset();
    tmuxApiMocks.tmuxProbe.mockResolvedValue({
      available: true,
      target: { kind: "ssh", hostId: "prod-api" },
      targetRef: "ssh:prod-api",
      version: "tmux 3.4",
    });
    tmuxApiMocks.tmuxListSessions.mockReset();
    tmuxApiMocks.tmuxListSessions.mockResolvedValue([]);
    tmuxApiMocks.tmuxAttachSession.mockReset();
    tmuxApiMocks.tmuxCreateSession.mockReset();
    tmuxApiMocks.tmuxDetachCurrent.mockReset();
    tmuxApiMocks.tmuxKillSession.mockReset();
    tmuxApiMocks.tmuxRenameSession.mockReset();
  });

