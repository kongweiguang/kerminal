import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
const isTauriMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  isTauri: () => isTauriMock(),
}));

describe("terminalSuggestionApi", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    isTauriMock.mockReset();
    vi.resetModules();
  });

  it("invokes the Tauri suggestion command with a normalized request", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValue([]);
    const { listTerminalSuggestions } = await import("../../../src/lib/terminalSuggestionApi");

    await listTerminalSuggestions({
      cursor: 900,
      cwd: " /srv/app ",
      input: "git status",
      limit: 99,
      providers: ["history", "git", "history"],
      remoteHostId: " host-prod ",
      target: "ssh",
    });

    expect(invokeMock).toHaveBeenCalledWith("command_suggestion_list", {
      request: {
        cursor: 10,
        cwd: "/srv/app",
        input: "git status",
        limit: 50,
        mode: "inline",
        providers: ["history", "git"],
        remoteHostId: "host-prod",
        target: "ssh",
      },
    });
  });

  it("normalizes menu request generation and context key", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValue([]);
    const { listTerminalSuggestions } = await import(
      "../../../src/lib/terminalSuggestionApi"
    );

    await listTerminalSuggestions({
      contextKey: " ssh:host-prod:/srv ",
      cursor: 2,
      generation: 7,
      input: "服务",
      mode: "menu",
    });

    expect(invokeMock).toHaveBeenCalledWith("command_suggestion_list", {
      request: expect.objectContaining({
        contextKey: "ssh:host-prod:/srv",
        cursor: 2,
        generation: 7,
        input: "服务",
        mode: "menu",
      }),
    });
  });

  it("normalizes legacy candidates to inline-only whole acceptance", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValue([
      {
        displayText: "echo 服务器",
        id: "history-unicode",
        provider: "history",
        replacementRange: { end: 7, start: 0 },
        replacementText: "echo 服务器",
        score: 0.9,
        sensitivity: "normal",
        suffix: "务器",
      },
    ]);
    const { listTerminalSuggestions } = await import(
      "../../../src/lib/terminalSuggestionApi"
    );

    const suggestions = await listTerminalSuggestions({
      cursor: 7,
      input: "echo 服务",
    });

    expect(suggestions[0]).toMatchObject({
      acceptBoundaries: [],
      activation: "insert",
      allowedPresentations: ["inline"],
      candidateKind: "command",
      replacementRange: { end: 7, start: 0 },
    });
  });

  it("normalizes snippet activation and merged source explanations", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValue([
      {
        activation: "openSnippetPanel",
        allowedPresentations: ["menu"],
        candidateKind: "snippet",
        displayText: "查看服务日志",
        id: "snippet:service-logs",
        mergedSourceExplanations: [" 命令规范 ", "个人片段", "个人片段"],
        provider: "snippet",
        replacementRange: { end: 3, start: 0 },
        replacementText: "journalctl -u {{service}}",
        score: 0.9,
        sensitivity: "normal",
        sourceExplanation: " 内置运维片段 ",
        sourceId: " builtin.service-logs ",
        suffix: "",
      },
    ]);
    const { listTerminalSuggestions } = await import(
      "../../../src/lib/terminalSuggestionApi"
    );

    const [suggestion] = await listTerminalSuggestions({
      cursor: 3,
      input: "jou",
      mode: "menu",
    });

    expect(suggestion).toMatchObject({
      activation: "openSnippetPanel",
      candidateKind: "snippet",
      mergedSourceExplanations: ["命令规范", "个人片段"],
      provider: "snippet",
      sourceExplanation: "内置运维片段",
      sourceId: "builtin.service-logs",
    });
  });

  it("forces dangerous candidates to menu-only presentation", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValue([
      {
        acceptBoundaries: [8],
        allowedPresentations: ["inline", "menu"],
        displayText: "rm -rf ./build",
        id: "history-dangerous",
        provider: "history",
        replacementRange: { end: 5, start: 0 },
        replacementText: "rm -rf ./build",
        score: 0.2,
        sensitivity: "dangerous",
        suffix: "f ./build",
      },
    ]);
    const { listTerminalSuggestions } = await import(
      "../../../src/lib/terminalSuggestionApi"
    );

    const suggestions = await listTerminalSuggestions({
      cursor: 5,
      input: "rm -r",
    });

    expect(suggestions[0]?.allowedPresentations).toEqual(["menu"]);
  });

  it("falls back to whole acceptance for invalid range or boundary", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValue([
      {
        acceptBoundaries: [8, 999],
        allowedPresentations: ["inline", "menu"],
        displayText: "echo 服务器/日志",
        id: "history-invalid-range",
        provider: "history",
        replacementRange: { end: 99, start: 8 },
        replacementText: "echo 服务器/日志",
        score: 0.9,
        sensitivity: "normal",
        suffix: "器/日志",
      },
    ]);
    const { listTerminalSuggestions } = await import(
      "../../../src/lib/terminalSuggestionApi"
    );

    const suggestions = await listTerminalSuggestions({
      cursor: 7,
      input: "echo 服务",
    });

    expect(suggestions[0]).toMatchObject({
      acceptBoundaries: [],
      replacementRange: { end: 7, start: 0 },
    });
  });

  it("preserves valid Unicode code-point boundaries", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValue([
      {
        acceptBoundaries: [8, 10],
        allowedPresentations: ["inline", "menu"],
        contextKey: " ssh:host-prod:/srv ",
        displayText: "echo 服务器/日志",
        id: "history-unicode-boundaries",
        provider: "history",
        replacementRange: { end: 7, start: 5 },
        replacementText: "echo 服务器/日志",
        score: 0.9,
        sensitivity: "normal",
        suffix: "器/日志",
      },
    ]);
    const { listTerminalSuggestions } = await import(
      "../../../src/lib/terminalSuggestionApi"
    );

    const suggestions = await listTerminalSuggestions({
      contextKey: "ssh:host-prod:/srv",
      cursor: 7,
      input: "echo 服务",
    });

    expect(suggestions[0]).toMatchObject({
      acceptBoundaries: [8, 10],
      contextKey: "ssh:host-prod:/srv",
      replacementRange: { end: 7, start: 5 },
    });
  });

  it("uses command history as the browser preview provider", async () => {
    isTauriMock.mockReturnValue(false);
    const { listTerminalSuggestions } = await import("../../../src/lib/terminalSuggestionApi");

    const suggestions = await listTerminalSuggestions({
      cursor: 3,
      input: "git",
      target: "local",
    });

    expect(suggestions).toEqual([
      expect.objectContaining({
        displayText: "git status --short",
        provider: "history",
        replacementText: "git status --short",
        suffix: " status --short",
      }),
    ]);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("invokes the Tauri remote path refresh command with normalized limits", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValue({
      cachedAtUnixMs: 1760000000000,
      entryCount: 2,
      hostId: "host-prod",
      path: "/srv/app",
      ttlSeconds: 300,
    });
    const { refreshTerminalRemotePathSuggestions } =
      await import("../../../src/lib/terminalSuggestionApi");

    await refreshTerminalRemotePathSuggestions({
      hostId: " host-prod ",
      maxEntries: 5000,
      path: " /srv/app ",
      ttlSeconds: 999,
    });

    expect(invokeMock).toHaveBeenCalledWith(
      "command_suggestion_refresh_remote_paths",
      {
        request: {
          hostId: "host-prod",
          maxEntries: 1000,
          path: "/srv/app",
          ttlSeconds: 300,
        },
      },
    );
  });

  it("invokes the Tauri remote command refresh command with normalized limits", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValue({
      cachedAtUnixMs: 1760000000000,
      commandCount: 100,
      hostId: "host-prod",
      ttlSeconds: 3600,
    });
    const { refreshTerminalRemoteCommandSuggestions } =
      await import("../../../src/lib/terminalSuggestionApi");

    await refreshTerminalRemoteCommandSuggestions({
      hostId: " host-prod ",
      maxEntries: 9999,
      ttlSeconds: 9999,
    });

    expect(invokeMock).toHaveBeenCalledWith(
      "command_suggestion_refresh_remote_commands",
      {
        request: {
          hostId: "host-prod",
          maxEntries: 5000,
          ttlSeconds: 3600,
        },
      },
    );
  });

  it("invokes the Tauri remote history refresh command with normalized limits", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValue({
      cachedAtUnixMs: 1760000000000,
      commandCount: 42,
      hostId: "host-prod",
      ttlSeconds: 86400,
    });
    const { refreshTerminalRemoteHistorySuggestions } = await import(
      "../../../src/lib/terminalSuggestionApi"
    );

    await refreshTerminalRemoteHistorySuggestions({
      hostId: " host-prod ",
      maxEntries: 9999,
      ttlSeconds: 999999,
    });

    expect(invokeMock).toHaveBeenCalledWith(
      "command_suggestion_refresh_remote_history",
      {
        request: {
          hostId: "host-prod",
          maxEntries: 5000,
          ttlSeconds: 86400,
        },
      },
    );
  });

  it("invokes the Tauri git refresh command with normalized limits", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValue({
      cachedAtUnixMs: 1760000000000,
      cwd: "/srv/app",
      entryCount: 12,
      hostId: "host-prod",
      repoRoot: "/srv/app",
      ttlSeconds: 600,
    });
    const { refreshTerminalGitSuggestions } =
      await import("../../../src/lib/terminalSuggestionApi");

    await refreshTerminalGitSuggestions({
      cwd: " /srv/app ",
      hostId: " host-prod ",
      maxEntries: 9999,
      ttlSeconds: 9999,
    });

    expect(invokeMock).toHaveBeenCalledWith(
      "command_suggestion_refresh_git_refs",
      {
        request: {
          cwd: "/srv/app",
          hostId: "host-prod",
          maxEntries: 5000,
          ttlSeconds: 600,
        },
      },
    );
  });

  it("invokes the Tauri suggestion feedback command with normalized context", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValue({ recorded: true, id: "feedback-1" });
    const { recordTerminalSuggestionFeedback } = await import(
      "../../../src/lib/terminalSuggestionApi"
    );

    await recordTerminalSuggestionFeedback({
      action: "accepted",
      cwd: " /srv/app ",
      input: "git",
      paneId: " pane-1 ",
      provider: "history",
      remoteHostId: " host-prod ",
      replacementText: "git status",
      sessionId: " session-1 ",
      shell: " bash ",
      sourceId: " history-1 ",
      target: "ssh",
    });

    expect(invokeMock).toHaveBeenCalledWith(
      "command_suggestion_record_feedback",
      {
        request: {
          action: "accepted",
          cwd: "/srv/app",
          input: "git",
          paneId: "pane-1",
          provider: "history",
          remoteHostId: "host-prod",
          replacementText: "git status",
          sessionId: "session-1",
          shell: "bash",
          sourceId: "history-1",
          target: "ssh",
        },
      },
    );
  });

  it("skips empty suggestion feedback before invoking Tauri", async () => {
    isTauriMock.mockReturnValue(true);
    const { recordTerminalSuggestionFeedback } = await import(
      "../../../src/lib/terminalSuggestionApi"
    );

    const result = await recordTerminalSuggestionFeedback({
      action: "dismissed",
      input: "",
      provider: "history",
      replacementText: "git status",
    });

    expect(result).toEqual({
      recorded: false,
      skipReason: "empty-command",
    });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("invokes the Tauri suggestion audit command with normalized context", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValue({ eventId: "audit-1", recorded: true });
    const { recordTerminalSuggestionAuditEvent } = await import(
      "../../../src/lib/terminalSuggestionApi"
    );

    await recordTerminalSuggestionAuditEvent({
      decision: "skipped",
      eventKind: "remoteProbeSchedule",
      metadata: {
        " productionHost ": " true ",
      },
      paneId: " pane-1 ",
      provider: "remoteCommand",
      reason: " production-host-restricted ",
      remoteHostId: " host-prod ",
      target: "ssh",
    });

    expect(invokeMock).toHaveBeenCalledWith(
      "command_suggestion_record_audit_event",
      {
        request: {
          decision: "skipped",
          eventKind: "remoteProbeSchedule",
          metadata: {
            productionHost: "true",
          },
          paneId: "pane-1",
          provider: "remoteCommand",
          reason: "production-host-restricted",
          remoteHostId: "host-prod",
          target: "ssh",
        },
      },
    );
  });

  it("invokes the Tauri suggestion telemetry command", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValue({
      generatedAtUnixMs: 1760000000001,
      providers: [],
      startedAtUnixMs: 1760000000000,
      totalCandidateCount: 0,
      totalQueryCount: 0,
    });
    const { getTerminalSuggestionTelemetrySummary } = await import(
      "../../../src/lib/terminalSuggestionApi"
    );

    await getTerminalSuggestionTelemetrySummary();

    expect(invokeMock).toHaveBeenCalledWith(
      "command_suggestion_telemetry_summary",
    );
  });

  it("invokes the Tauri suggestion telemetry export command", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValue({
      auditEvents: [],
      generatedAtUnixMs: 1760000000002,
      persisted: {
        generatedAtUnixMs: 1760000000002,
        providers: [],
        startedAtUnixMs: 1760000000000,
        totalCandidateCount: 0,
        totalQueryCount: 0,
      },
      runtime: {
        generatedAtUnixMs: 1760000000002,
        providers: [],
        startedAtUnixMs: 1760000000001,
        totalCandidateCount: 0,
        totalQueryCount: 0,
      },
    });
    const { getTerminalSuggestionTelemetryExport } = await import(
      "../../../src/lib/terminalSuggestionApi"
    );

    await getTerminalSuggestionTelemetryExport();

    expect(invokeMock).toHaveBeenCalledWith(
      "command_suggestion_telemetry_export",
    );
  });

  it("invokes the Tauri suggestion diagnostics cleanup command with normalized retention", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValue({
      auditEventsDeleted: 1,
      feedbackDeleted: 2,
      generatedAtUnixMs: 1760000000000,
      providerCacheDeleted: 3,
      telemetryRowsDeleted: 4,
    });
    const { cleanupTerminalSuggestionDiagnostics } = await import(
      "../../../src/lib/terminalSuggestionApi"
    );

    await cleanupTerminalSuggestionDiagnostics({
      auditRetentionDays: 0,
      feedbackRetentionDays: 99999,
      pruneExpiredProviderCache: false,
      resetPersistedTelemetry: true,
    });

    expect(invokeMock).toHaveBeenCalledWith(
      "command_suggestion_cleanup_diagnostics",
      {
        request: {
          auditRetentionDays: 1,
          feedbackRetentionDays: 3650,
          pruneAuditEvents: true,
          pruneExpiredProviderCache: false,
          pruneFeedback: true,
          resetPersistedTelemetry: true,
        },
      },
    );
  });

  it("returns no browser suggestions when history provider is disabled", async () => {
    isTauriMock.mockReturnValue(false);
    const { listTerminalSuggestions } = await import("../../../src/lib/terminalSuggestionApi");

    const suggestions = await listTerminalSuggestions({
      cursor: 3,
      input: "git",
      providers: ["git"],
      target: "local",
    });

    expect(suggestions).toEqual([]);
  });
});
