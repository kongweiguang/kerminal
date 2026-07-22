import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { vi } from "vitest";
import type { TerminalOutputEvent } from "../../../../src/lib/terminalApi";
import { defaultAppSettings } from "../../../../src/features/settings/settingsModel";
import { consumePendingAgentSendRequest } from "../../support/agentSendRequestStore.testSupport";
import { resetWorkspaceStore } from "../../support/workspace/workspaceStore.testSupport";
import {
  getKerminalShellTestMocks,
  remoteHostTree,
  testSshOptions,
} from "../../support/app/KerminalShell.testSupport.tsx";

export const mocks = getKerminalShellTestMocks();
const hoistedWindowChromeMocks = vi.hoisted(() => ({
  frameState: "normal" as "fullscreen" | "maximized" | "normal",
  platform: "browser" as "browser" | "linux" | "macos" | "windows",
}));
export const windowChromeMocks = hoistedWindowChromeMocks;

vi.mock("../../../../src/lib/desktopPlatform", () => ({
  resolveDesktopPlatform: () => windowChromeMocks.platform,
}));

vi.mock("../../../../src/lib/useTauriWindowFrameState", () => ({
  useTauriWindowFrameState: () => windowChromeMocks.frameState,
}));

export async function findExpandedSidebarMachine(name: RegExp) {
  const sidebar = screen.getByRole("complementary", { name: "主机侧边栏" });
  await waitFor(() => {
    if (within(sidebar).queryByRole("button", { name })) {
      return;
    }
    const hasCollapsedGroup = within(sidebar)
      .queryAllByRole("button")
      .some((button) => button.getAttribute("aria-expanded") === "false");
    if (!hasCollapsedGroup) {
      throw new Error("Waiting for sidebar machine groups to load.");
    }
  });
  const visibleMachine = within(sidebar).queryByRole("button", { name });
  if (visibleMachine) {
    return visibleMachine;
  }
  const collapsedGroupButtons = within(sidebar)
    .queryAllByRole("button")
    .filter((button) => button.getAttribute("aria-expanded") === "false");
  await act(async () => {
    for (const button of collapsedGroupButtons) {
      fireEvent.click(button);
    }
  });
  return within(sidebar).findByRole("button", { name });
}

export function resetKerminalShellTestState() {
  vi.clearAllMocks();
  document.documentElement.classList.remove("dark");
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-density");
  document.documentElement.removeAttribute("data-language");
  document.documentElement.removeAttribute("lang");
  window.localStorage.clear();
  resetWorkspaceStore();
  consumePendingAgentSendRequest();
  windowChromeMocks.frameState = "normal";
  windowChromeMocks.platform = "browser";
  mocks.workspaceSessionApi.loadWorkspaceSessionFile.mockReset();
  mocks.workspaceSessionApi.saveWorkspaceSessionFile.mockReset();
  mocks.workspaceSessionApi.loadWorkspaceSessionFile.mockResolvedValue(null);
  mocks.workspaceSessionApi.saveWorkspaceSessionFile.mockResolvedValue(
    undefined,
  );
  mocks.appTitleBar.renderCount = 0;
  mocks.nativeMenuApi.listenNativeMenuActions.mockResolvedValue(
    () => undefined,
  );
  mocks.profileApi.createProfile.mockResolvedValue({
    args: [],
    createdAt: "test",
    env: {},
    id: "profile-created",
    isDefault: false,
    name: "Created Shell",
    shell: "test-shell",
    sortOrder: 20,
    updatedAt: "test",
  });
  mocks.profileApi.detectShells.mockResolvedValue([]);
  mocks.profileApi.listProfiles.mockResolvedValue([]);
  mocks.profileApi.updateProfile.mockImplementation(async (request) => ({
    args: request.args,
    createdAt: "test",
    cwd: request.cwd,
    env: request.env,
    id: request.id,
    isDefault: request.setDefault,
    name: request.name,
    shell: request.shell,
    sortOrder: request.sortOrder,
    updatedAt: "updated",
  }));
  mocks.dockerApi.listDockerContainers.mockResolvedValue([]);
  mocks.connectionApi.openSavedRdpConnection.mockReset();
  mocks.connectionApi.openSavedRdpConnection.mockResolvedValue({
    launched: true,
    message: "RDP launched",
  });
  mocks.dockerApi.fetchDockerContainerStats.mockResolvedValue({
    blockIo: "0B / 0B",
    containerId: "c0ffee1234567890",
    cpuPercent: "0.42%",
    hostId: "db980b17-2ed0-44e5-b72a-6ecadf788439",
    memoryPercent: "4.1%",
    memoryUsage: "42MiB / 1GiB",
    networkIo: "1kB / 2kB",
    pids: "7",
    raw: '{"CPUPerc":"0.42%"}',
    runtime: "docker",
  });
  mocks.dockerApi.inspectDockerContainer.mockResolvedValue({
    command: ["serve"],
    containerId: "c0ffee1234567890",
    entrypoint: ["/entrypoint.sh"],
    hostId: "db980b17-2ed0-44e5-b72a-6ecadf788439",
    id: "c0ffee1234567890",
    image: "kerminal/api:latest",
    labels: {},
    name: "api",
    networks: ["bridge"],
    ports: ["0.0.0.0:8080->80/tcp"],
    rawJson: "{}",
    running: true,
    runtime: "docker",
    status: "running",
  });
  mocks.remoteHostApi.listRemoteHostTree.mockResolvedValue(remoteHostTree);
  mocks.remoteWorkspaceEditorTransport.readRemoteWorkspaceTextFile.mockReset();
  mocks.remoteWorkspaceEditorTransport.writeRemoteWorkspaceTextFile.mockReset();
  mocks.remoteWorkspaceEditorTransport.readRemoteWorkspaceTextFile.mockResolvedValue(
    {
      binary: false,
      bytesRead: 16,
      content: "name: kerminal\n",
      encoding: "utf-8",
      hostId: "db980b17-2ed0-44e5-b72a-6ecadf788439",
      lineEnding: "lf",
      maxBytes: 10 * 1024 * 1024,
      path: "/opt/app/docker-compose.yml",
      readonly: true,
      revision: { size: 16 },
      truncated: false,
    },
  );
  mocks.remoteWorkspaceEditorTransport.writeRemoteWorkspaceTextFile.mockResolvedValue(
    {
      bytesWritten: 18,
      encoding: "utf-8",
      hostId: "db980b17-2ed0-44e5-b72a-6ecadf788439",
      lineEnding: "lf",
      path: "/opt/app/docker-compose.yml",
      revision: { size: 18 },
    },
  );
  mocks.remoteHostApi.createRemoteHost.mockResolvedValue({
    authType: "agent",
    createdAt: "test",
    groupId: "30fbc381-2884-4b75-9f88-0e28f31ca8b0",
    host: "172.16.41.60",
    id: "host-copy",
    name: "172.16.41.60 副本",
    port: 22,
    production: false,
    sshOptions: testSshOptions,
    sortOrder: 20,
    tags: ["ssh", "bbb"],
    updatedAt: "test",
    username: "ubuntu",
  });
  mocks.remoteHostApi.updateRemoteHost.mockImplementation(
    async (request) => ({
      authType: request.authType,
      createdAt: "test",
      credentialRef: request.credentialRef,
      groupId: request.groupId,
      host: request.host,
      id: request.id,
      name: request.name,
      port: request.port ?? 22,
      production: request.production ?? false,
      sshOptions: request.sshOptions,
      sortOrder: request.sortOrder,
      tags: request.tags ?? [],
      updatedAt: "test",
      username: request.username,
    }),
  );
  mocks.remoteHostApi.updateRemoteHostGroup.mockImplementation(
    async (request) => ({
      createdAt: "test",
      id: request.id,
      name: request.name,
      sortOrder: request.sortOrder,
      updatedAt: "test",
    }),
  );
  mocks.settingsApi.getSettings.mockResolvedValue(defaultAppSettings);
  mocks.settingsApi.updateSettings.mockImplementation(
    async (settings) => settings,
  );
  mocks.terminalApi.createTerminalSession.mockImplementation(
    async (_request, onOutput: (event: TerminalOutputEvent) => void) => {
      onOutput({
        data: "local ready",
        kind: "data",
        sessionId: "session-local",
      });
      return {
        cols: 80,
        id: "session-local",
        rows: 24,
        shell: "test-shell",
        status: "running",
      };
    },
  );
  mocks.terminalApi.createSshTerminalSession.mockImplementation(
    async (_request, onOutput: (event: TerminalOutputEvent) => void) => {
      onOutput({
        data: "ssh ready",
        kind: "data",
        sessionId: "session-ssh",
      });
      return {
        cols: 80,
        id: "session-ssh",
        rows: 24,
        shell: "ssh",
        status: "running",
      };
    },
  );
  mocks.terminalApi.getTerminalLogState.mockResolvedValue({
    active: false,
    bytesWritten: 0,
  });
  mocks.terminalApi.listTerminalSessions.mockResolvedValue([]);
  mocks.terminalApi.closeTerminal.mockResolvedValue(undefined);
  mocks.terminalApi.reapOrphanTerminalSessions.mockResolvedValue({
    elapsedMs: 0,
    reapedCount: 0,
    sessionIds: [],
  });
  mocks.terminalApi.resizeTerminal.mockResolvedValue(undefined);
  mocks.diagnosticsApi.createDiagnosticsBundle.mockResolvedValue({
    bytesWritten: 2048,
    createdAt: "1710000000",
    fileName: "diagnostics-1710000000.json",
    id: "diagnostics-1",
    path: "C:/Users/me/.kerminal/diagnostics/diagnostics-1710000000.json",
    redacted: true,
    sections: ["app", "paths"],
  });
  mocks.diagnosticsApi.getManagedSshRuntimeSnapshot.mockResolvedValue({
    activeChannels: 0,
    activeSessions: 0,
    generatedAt: "1",
    recentLegacyFallbacks: [],
    sessions: [],
  });
  mocks.serverInfoApi.getServerInfoSnapshot.mockResolvedValue({
    architecture: "x86_64",
    capturedAt: "1781763088",
    cpuCount: 32,
    cpuCoreUsagePercents: [],
    cpuUsagePercent: 8.1,
    diskMount: "/",
    diskTotalBytes: 64 * 1024 * 1024 * 1024,
    diskUsedBytes: 16 * 1024 * 1024 * 1024,
    gpus: [],
    host: "172.16.41.60",
    hostId: "db980b17-2ed0-44e5-b72a-6ecadf788439",
    hostName: "172.16.41.60",
    hostname: "bwy-host",
    kernel: "6.8.0",
    loadAverage: [0.1, 0.2, 0.3],
    memoryTotalBytes: 8 * 1024 * 1024 * 1024,
    memoryUsedBytes: 4 * 1024 * 1024 * 1024,
    networkRxBytes: 1024,
    networkTxBytes: 2048,
    os: "Linux",
    port: 22,
    swapTotalBytes: 2 * 1024 * 1024 * 1024,
    swapUsedBytes: 0,
    uptimeSeconds: 90_000,
    username: "ubuntu",
  });
}
