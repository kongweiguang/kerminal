import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsToolContent } from "../../../../src/features/settings/SettingsToolContent";
import { defaultAppSettings, type AppSettings } from "../../../../src/features/settings/settingsModel";
import { xtermThemeFor } from "../../../../src/features/settings/terminalTheme";
import { terminalRendererRegistry } from "../../../../src/features/terminal/terminalRendererRegistry";

const fileDialogMock = vi.hoisted(() => ({
  openLocalDirectory: vi.fn(),
  selectLocalFile: vi.fn(),
}));
const diagnosticsApiMock = vi.hoisted(() => ({
  getManagedSshRuntimeSnapshot: vi.fn(),
}));
const terminalRuntimeDiagnosticsStoreMock = vi.hoisted(() => ({
  collectTerminalRuntimePerformanceSnapshot: vi.fn(),
  subscribeTerminalRuntimeDiagnostics: vi.fn(),
}));
const mcpServerApiMock = vi.hoisted(() => ({
  getMcpHttpServerStatus: vi.fn(),
  startMcpHttpServer: vi.fn(),
  stopMcpHttpServer: vi.fn(),
}));
const terminalSuggestionApiMock = vi.hoisted(() => ({
  cleanupTerminalSuggestionDiagnostics: vi.fn(),
  getTerminalSuggestionTelemetryExport: vi.fn(),
  getTerminalSuggestionTelemetrySummary: vi.fn(),
  refreshTerminalGitSuggestions: vi.fn(),
  refreshTerminalRemoteCommandSuggestions: vi.fn(),
  refreshTerminalRemoteHistorySuggestions: vi.fn(),
  refreshTerminalRemotePathSuggestions: vi.fn(),
}));
const updaterApiMock = vi.hoisted(() => ({
  checkForAppUpdate: vi.fn(),
  installPendingAppUpdate: vi.fn(),
}));

vi.mock("../../../../src/lib/fileDialogApi", () => ({
  openLocalDirectory: fileDialogMock.openLocalDirectory,
  selectLocalFile: fileDialogMock.selectLocalFile,
}));
vi.mock("../../../../src/lib/diagnosticsApi", async () => {
  const actual = await vi.importActual("../../../../src/lib/diagnosticsApi");
  return {
    ...actual,
    getManagedSshRuntimeSnapshot: diagnosticsApiMock.getManagedSshRuntimeSnapshot,
  };
});
vi.mock(
  "../../../../src/features/terminal/terminalRuntimeDiagnosticsStore",
  () => terminalRuntimeDiagnosticsStoreMock,
);
vi.mock("../../../../src/lib/mcpServerApi", () => mcpServerApiMock);
vi.mock("../../../../src/lib/terminalSuggestionApi", () => terminalSuggestionApiMock);
vi.mock("../../../../src/lib/updaterApi", () => updaterApiMock);

describe("SettingsToolContent appearance preview theme resolution", () => {
  beforeEach(() => {
    fileDialogMock.openLocalDirectory.mockReset();
    fileDialogMock.openLocalDirectory.mockResolvedValue(undefined);
    fileDialogMock.selectLocalFile.mockReset();
    fileDialogMock.selectLocalFile.mockResolvedValue(null);
    diagnosticsApiMock.getManagedSshRuntimeSnapshot.mockReset();
    diagnosticsApiMock.getManagedSshRuntimeSnapshot.mockResolvedValue(
      managedSshRuntimeSnapshot(),
    );
    terminalRuntimeDiagnosticsStoreMock.collectTerminalRuntimePerformanceSnapshot.mockReset();
    terminalRuntimeDiagnosticsStoreMock.collectTerminalRuntimePerformanceSnapshot.mockResolvedValue(
      runtimePerformanceSnapshot(),
    );
    terminalRuntimeDiagnosticsStoreMock.subscribeTerminalRuntimeDiagnostics.mockReset();
    terminalRuntimeDiagnosticsStoreMock.subscribeTerminalRuntimeDiagnostics.mockReturnValue(
      vi.fn(),
    );
    mcpServerApiMock.getMcpHttpServerStatus.mockReset();
    mcpServerApiMock.getMcpHttpServerStatus.mockResolvedValue({
      bindAddress: "127.0.0.1",
      endpoint: null,
      localOnly: true,
      port: null,
      running: false,
    });
    mcpServerApiMock.startMcpHttpServer.mockReset();
    mcpServerApiMock.startMcpHttpServer.mockResolvedValue({
      bindAddress: "127.0.0.1",
      endpoint: "http://127.0.0.1:30456/mcp",
      localOnly: true,
      port: 30456,
      running: true,
    });
    mcpServerApiMock.stopMcpHttpServer.mockReset();
    mcpServerApiMock.stopMcpHttpServer.mockResolvedValue({
      bindAddress: "127.0.0.1",
      endpoint: null,
      localOnly: true,
      port: null,
      running: false,
    });
    terminalSuggestionApiMock.cleanupTerminalSuggestionDiagnostics.mockReset();
    terminalSuggestionApiMock.cleanupTerminalSuggestionDiagnostics.mockResolvedValue(
      {
        auditEventsDeleted: 0,
        feedbackDeleted: 0,
        generatedAtUnixMs: 1760000000300,
        providerCacheDeleted: 0,
        telemetryRowsDeleted: 0,
      },
    );
    terminalSuggestionApiMock.getTerminalSuggestionTelemetryExport.mockReset();
    terminalSuggestionApiMock.getTerminalSuggestionTelemetryExport.mockResolvedValue(
      {
        auditEvents: [],
        generatedAtUnixMs: 1760000000200,
        persisted: {
          generatedAtUnixMs: 1760000000200,
          providers: [],
          startedAtUnixMs: 1760000000000,
          totalCandidateCount: 0,
          totalQueryCount: 0,
        },
        runtime: {
          generatedAtUnixMs: 1760000000200,
          providers: [],
          startedAtUnixMs: 1760000000100,
          totalCandidateCount: 0,
          totalQueryCount: 0,
        },
      },
    );
    terminalSuggestionApiMock.getTerminalSuggestionTelemetrySummary.mockReset();
    terminalSuggestionApiMock.getTerminalSuggestionTelemetrySummary.mockResolvedValue(
      {
        generatedAtUnixMs: 1760000000100,
        providers: [],
        startedAtUnixMs: 1760000000000,
        totalCandidateCount: 0,
        totalQueryCount: 0,
      },
    );
    terminalSuggestionApiMock.refreshTerminalGitSuggestions.mockReset();
    terminalSuggestionApiMock.refreshTerminalGitSuggestions.mockResolvedValue([]);
    terminalSuggestionApiMock.refreshTerminalRemoteCommandSuggestions.mockReset();
    terminalSuggestionApiMock.refreshTerminalRemoteCommandSuggestions.mockResolvedValue([]);
    terminalSuggestionApiMock.refreshTerminalRemoteHistorySuggestions.mockReset();
    terminalSuggestionApiMock.refreshTerminalRemoteHistorySuggestions.mockResolvedValue([]);
    terminalSuggestionApiMock.refreshTerminalRemotePathSuggestions.mockReset();
    terminalSuggestionApiMock.refreshTerminalRemotePathSuggestions.mockResolvedValue([]);
    updaterApiMock.checkForAppUpdate.mockReset();
    updaterApiMock.checkForAppUpdate.mockResolvedValue({ kind: "up-to-date" });
    updaterApiMock.installPendingAppUpdate.mockReset();
    updaterApiMock.installPendingAppUpdate.mockResolvedValue(undefined);
    delete document.documentElement.dataset.theme;
    mockPrefersDark(false);
  });

  afterEach(() => {
    cleanup();
    delete document.documentElement.dataset.theme;
    vi.unstubAllGlobals();
  });

  it("uses the document dark theme when system mode has no explicit resolved theme", () => {
    document.documentElement.dataset.theme = "dark";
    mockPrefersDark(false);

    render(
      <SettingsToolContent
        initialSectionId="settings-terminal"
        onSettingsChange={vi.fn()}
        settings={systemThemeSettings()}
      />,
    );

    expect(screen.getByLabelText("终端字体预览")).toHaveStyle({
      backgroundColor: xtermThemeFor("dark", "tokyoNight").background,
      color: xtermThemeFor("dark", "tokyoNight").foreground,
    });
  });

  it("uses the document light theme before matchMedia when system mode has no explicit resolved theme", () => {
    document.documentElement.dataset.theme = "light";
    mockPrefersDark(true);

    render(
      <SettingsToolContent
        initialSectionId="settings-terminal"
        onSettingsChange={vi.fn()}
        settings={systemThemeSettings()}
      />,
    );

    expect(screen.getByLabelText("终端字体预览")).toHaveStyle({
      backgroundColor: xtermThemeFor("light", "github").background,
      color: xtermThemeFor("light", "github").foreground,
    });
  });

  it("falls back to matchMedia when the document theme is not available", () => {
    mockPrefersDark(true);

    render(
      <SettingsToolContent
        initialSectionId="settings-terminal"
        onSettingsChange={vi.fn()}
        settings={systemThemeSettings()}
      />,
    );

    expect(screen.getByLabelText("终端字体预览")).toHaveStyle({
      backgroundColor: xtermThemeFor("dark", "tokyoNight").background,
      color: xtermThemeFor("dark", "tokyoNight").foreground,
    });
  });

  it("uses the explicit resolved system theme for the terminal appearance preview", () => {
    const expectedTheme = xtermThemeFor("light", "github");

    render(
      <SettingsToolContent
        initialSectionId="settings-terminal"
        onSettingsChange={vi.fn()}
        resolvedTheme="light"
        settings={systemThemeSettings()}
      />,
    );

    expect(screen.getByLabelText("终端字体预览")).toHaveStyle({
      backgroundColor: expectedTheme.background,
      color: expectedTheme.foreground,
    });
  });

  it("saves terminal renderer mode changes", async () => {
    const user = userEvent.setup();
    const onSettingsChange = vi.fn();

    render(
      <SettingsToolContent
        initialSectionId="settings-terminal"
        onSettingsChange={onSettingsChange}
        settings={systemThemeSettings()}
      />,
    );

    expect(screen.getByText("终端渲染")).toBeInTheDocument();
    expect(screen.queryByText("GPU 分屏")).not.toBeInTheDocument();
    expect(screen.queryByText("输出待写入")).not.toBeInTheDocument();
    expect(screen.queryByTestId("managed-ssh-runtime-diagnostics")).not.toBeInTheDocument();
    expect(screen.queryByText("默认启用门禁阻断")).not.toBeInTheDocument();
    expect(screen.queryByText("Managed sessions")).not.toBeInTheDocument();
    expect(screen.queryByText("Fallback reasons")).not.toBeInTheDocument();
    expect(screen.queryByText("runtime-unwired")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /保持默认渲染路径/ }),
    ).not.toBeVisible();

    await user.click(screen.getByText("终端渲染"));

    expect(
      screen.getByRole("button", { name: /保持默认渲染路径/ }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: /保持默认渲染路径/ }),
    ).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: /保持默认渲染路径/ }));
    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        terminal: expect.objectContaining({ rendererType: "cpu" }),
      }),
    );

    await user.click(screen.getByRole("button", { name: /强制尝试 WebGL/ }));
    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        terminal: expect.objectContaining({ rendererType: "gpu" }),
      }),
    );

    await user.click(screen.getByRole("button", { name: /失败时自动回退/ }));
    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        terminal: expect.objectContaining({ rendererType: "auto" }),
      }),
    );
  });

  it("retries only renderer panes that entered fallback", async () => {
    const user = userEvent.setup();
    const retryGpu = vi.fn();
    terminalRendererRegistry.updateMode("auto");
    const unregister = terminalRendererRegistry.registerPane({
      controller: {
        attach: vi.fn(),
        dispose: vi.fn(),
        getState: () => ({
          backend: "cpu",
          fallbackReason: "context-lost",
          mode: "auto",
        }),
        retryGpu,
        updateMode: vi.fn(),
      },
      focused: true,
      paneId: "settings-retry-pane",
      visible: true,
    });

    try {
      terminalRendererRegistry.recordPaneFailure(
        "settings-retry-pane",
        "context-lost",
      );
      render(
        <SettingsToolContent
          initialSectionId="settings-terminal"
          onSettingsChange={vi.fn()}
          settings={systemThemeSettings()}
        />,
      );

      await user.click(screen.getByText("终端渲染"));
      await user.click(
        screen.getByRole("button", { name: "重新尝试 GPU" }),
      );

      expect(retryGpu).toHaveBeenCalledTimes(1);
    } finally {
      unregister();
      terminalRendererRegistry.updateMode("gpu");
      terminalRendererRegistry.updateMode("cpu");
    }
  });

  it("allows a global auto fallback to retry every GPU-capable pane", async () => {
    const user = userEvent.setup();
    const retryGpu = [vi.fn(), vi.fn(), vi.fn()];
    terminalRendererRegistry.updateMode("auto");
    const unregister = retryGpu.map((retry, index) =>
      terminalRendererRegistry.registerPane({
        controller: {
          attach: vi.fn(),
          canAttemptGpu: () => true,
          dispose: vi.fn(),
          getState: () => ({
            backend: "cpu",
            mode: "auto",
          }),
          retryGpu: retry,
          updateMode: vi.fn(),
        },
        paneId: `settings-global-retry-${index}`,
      }),
    );

    try {
      for (let index = 0; index < retryGpu.length; index += 1) {
        terminalRendererRegistry.recordPaneFailure(
          `settings-global-retry-${index}`,
          "load-failed",
        );
      }
      expect(terminalRendererRegistry.getSnapshot().suggestedFallback).toBe(
        "cpu",
      );
      render(
        <SettingsToolContent
          initialSectionId="settings-terminal"
          onSettingsChange={vi.fn()}
          settings={systemThemeSettings()}
        />,
      );

      await user.click(screen.getByText("终端渲染"));
      await user.click(
        screen.getByRole("button", { name: "重新尝试 GPU" }),
      );

      for (const retry of retryGpu) {
        expect(retry).toHaveBeenCalledTimes(1);
      }
      expect(
        terminalRendererRegistry.getSnapshot().suggestedFallback,
      ).toBeUndefined();
    } finally {
      unregister.forEach((dispose) => dispose());
      terminalRendererRegistry.updateMode("gpu");
      terminalRendererRegistry.updateMode("cpu");
    }
  });

  it("searches settings and opens the matching section", async () => {
    const user = userEvent.setup();

    render(
      <SettingsToolContent
        onSettingsChange={vi.fn()}
        settings={systemThemeSettings()}
      />,
    );

    await user.type(screen.getByLabelText("搜索设置"), "WebGL");
    await user.click(screen.getByRole("button", { name: "打开设置项：终端渲染" }));

    expect(screen.getByText("终端渲染")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /强制尝试 WebGL/ })).toBeInTheDocument();
    expect(screen.queryByText("GPU 分屏")).not.toBeInTheDocument();
    expect(screen.getByLabelText("搜索设置")).toHaveValue("");
  });

  it("does not expose runtime diagnostics in settings search", async () => {
    const user = userEvent.setup();

    render(
      <SettingsToolContent
        onSettingsChange={vi.fn()}
        settings={systemThemeSettings()}
      />,
    );

    await user.type(screen.getByLabelText("搜索设置"), "默认启用");

    expect(screen.queryByRole("button", { name: "打开设置项：运行诊断" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("managed-ssh-runtime-diagnostics")).not.toBeInTheDocument();
    expect(screen.queryByText("Queue depth")).not.toBeInTheDocument();
    expect(screen.queryByText("authentication")).not.toBeInTheDocument();
    expect(screen.getByLabelText("搜索设置")).toHaveValue("默认启用");

    await user.clear(screen.getByLabelText("搜索设置"));
    await user.type(screen.getByLabelText("搜索设置"), "遥测");

    expect(screen.queryByRole("button", { name: "打开设置项：提示诊断" })).not.toBeInTheDocument();
    expect(screen.queryByText("灰色提示诊断")).not.toBeInTheDocument();
    expect(screen.queryByText("审计保留")).not.toBeInTheDocument();
  });

  it("searches external launch setup while hiding alias generation and shim controls", async () => {
    const user = userEvent.setup();

    render(
      <SettingsToolContent
        onSettingsChange={vi.fn()}
        settings={systemThemeSettings()}
      />,
    );

    await user.type(screen.getByLabelText("搜索设置"), "跳板机");
    await user.click(
      screen.getByRole("button", { name: "打开设置项：外部 SSH 启动" }),
    );

    expect(screen.getByText("外部 SSH 启动")).toBeInTheDocument();
    expect(screen.getByText("Kerminal URL")).toBeInTheDocument();
    expect(screen.getByText(/kerminal:\/\/ssh\?host=/)).toBeInTheDocument();
    expect(
      screen.getAllByText(/<PASSWORD_FROM_PLATFORM>/).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText(/kerminal\.exe -ssh/)).toHaveClass(
      "whitespace-pre-wrap",
      "break-all",
    );
    expect(
      screen.queryByText(/KERM_FIXTURE_PASSWORD_DO_NOT_USE/),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("兼容启动器")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "生成全部" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "删除已管理" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "打开目录" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("switch", { name: "启用本地 shim bridge" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "允许 PuTTY" })).toBeVisible();
  });

  it("updates external launch policy controls without exposing shim controls", async () => {
    const user = userEvent.setup();
    const onSettingsChange = vi.fn();

    render(
      <SettingsToolContent
        initialSectionId="settings-external-launch"
        onSettingsChange={onSettingsChange}
        settings={systemThemeSettings()}
      />,
    );

    expect(screen.getByText("外部 SSH 启动")).toBeInTheDocument();
    expect(screen.queryByText("兼容启动器")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("switch", { name: "启用本地 shim bridge" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "允许 PuTTY" })).not.toBeVisible();

    await user.click(
      screen.getByRole("switch", { name: "启用外部 SSH 启动" }),
    );
    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        externalLaunch: expect.objectContaining({
          enabled: false,
        }),
      }),
    );

    await user.click(
      screen.getByRole("switch", { name: "接受常见终端参数" }),
    );
    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        externalLaunch: expect.objectContaining({
          acceptVendorArgs: false,
        }),
      }),
    );

    await user.click(
      screen.getByRole("switch", { name: "连接后自动打开 SFTP" }),
    );
    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        externalLaunch: expect.objectContaining({
          autoOpenSftp: true,
        }),
      }),
    );

    await user.click(screen.getByText("参数兼容性"));

    const puttyPersonaSwitch = screen.getByRole("switch", {
      name: "允许 PuTTY",
    });
    expect(puttyPersonaSwitch).toBeVisible();
    expect(puttyPersonaSwitch).toHaveAttribute("data-state", "checked");

    await user.click(puttyPersonaSwitch);
    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        externalLaunch: expect.objectContaining({
          disabledTools: ["putty"],
        }),
      }),
    );
  });
});

function systemThemeSettings(): AppSettings {
  return {
    ...defaultAppSettings,
    terminal: {
      ...defaultAppSettings.terminal,
      colorScheme: "tokyoNight",
      darkColorScheme: "tokyoNight",
      lightColorScheme: "github",
    },
    themeMode: "system",
  };
}
function mockPrefersDark(matches: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    addEventListener: vi.fn(),
    addListener: vi.fn(),
    dispatchEvent: vi.fn(),
    matches: query === "(prefers-color-scheme: dark)" ? matches : false,
    media: query,
    onchange: null,
    removeEventListener: vi.fn(),
    removeListener: vi.fn(),
	  }));
	}

function runtimePerformanceSnapshot() {
  return {
    generatedAt: "2026-07-06T00:40:00.000Z",
    managedSsh: managedSshRuntimeSnapshot(),
    schemaVersion: 1,
    sftp: {
      preflight: {
        active: 0,
        cancelRequested: false,
        completed: 0,
        concurrencyLimit: 4,
        failed: 0,
        queued: 1,
      },
      transfers: {
        activeTransfers: 0,
        failedRecent: 0,
        prunedCompleted: 0,
        recentCompleted: 0,
      },
    },
    ssh: {
      activeConnections: 1,
      errorClasses: {
        authentication: 1,
      },
      failedRecent: 1,
      reconnecting: 1,
    },
    suggestions: {
      activeTasks: 0,
      disabledReasons: {},
      inFlight: 0,
      maxConcurrent: 2,
      queued: 1,
    },
  };
}

function managedSshRuntimeSnapshot() {
  return {
    activeChannels: 3,
    activeSessions: 1,
    generatedAt: "1760000000",
    recentLegacyFallbacks: [
      {
        capability: "sftp",
        count: 1,
        lastAt: "1760000001",
        reason: "runtime-unwired",
        target: "deploy@example.internal:22",
      },
    ],
    sessions: [
      {
        activeChannels: 3,
        channelCounts: {
          exec: 1,
          shell: 1,
          sftp: 1,
        },
        createdAt: "1760000000",
        key: {
          jumps: [],
          knownHostsProfile: "default",
          proxyProfile: null,
          runtimeFlags: ["test"],
          target: "deploy@example.internal:22",
        },
        lastError: null,
        lastUsedAt: "1760000001",
        maxConcurrentExecChannels: 4,
        openedChannels: 3,
        pendingExecRequests: 2,
        refCount: 1,
        sessionId: "managed-session-1",
        state: "ready",
      },
    ],
  };
}
