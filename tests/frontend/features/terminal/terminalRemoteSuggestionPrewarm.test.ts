// @author kongweiguang

import { describe, expect, it, vi } from "vitest";
import type { CommandSuggestionAuditRecordRequest } from "../../../../src/lib/terminalSuggestionApi";
import { defaultTerminalAppearance } from "../../../../src/features/settings/settingsDefaults";
import type { TerminalAppearance } from "../../../../src/features/settings/settingsModel";
import { createTerminalRemoteSuggestionPrewarm } from "../../../../src/features/terminal/terminalRemoteSuggestionPrewarm";
import type { TerminalSuggestionProbeDisabledReason } from "../../../../src/features/terminal/terminalSuggestionProbePolicy";
import type {
  GitProbeRequest,
  RemoteCommandProbeRequest,
  RemoteHistoryProbeRequest,
  RemotePathProbeRequest,
} from "../../../../src/features/terminal/terminalSuggestionProbeScheduler";

type ScheduleGit = (request: GitProbeRequest) => boolean;
type ScheduleRemoteCommand = (request: RemoteCommandProbeRequest) => boolean;
type ScheduleRemoteHistory = (request: RemoteHistoryProbeRequest) => boolean;
type ScheduleRemotePath = (request: RemotePathProbeRequest) => boolean;
type SetOwnerDisabled = (
  ownerId: string,
  reason: TerminalSuggestionProbeDisabledReason | null,
) => void;
type RecordAuditEvent = (
  request: CommandSuggestionAuditRecordRequest,
) => Promise<unknown>;

function createScheduler() {
  return {
    scheduleGit: vi.fn<ScheduleGit>(() => true),
    scheduleRemoteCommand: vi.fn<ScheduleRemoteCommand>(() => true),
    scheduleRemoteHistory: vi.fn<ScheduleRemoteHistory>(() => true),
    scheduleRemotePath: vi.fn<ScheduleRemotePath>(() => true),
    setOwnerDisabled: vi.fn<SetOwnerDisabled>(),
  };
}

function createAppearanceRef(
  inlineSuggestion: Partial<TerminalAppearance["inlineSuggestion"]> = {},
) {
  return {
    current: {
      ...defaultTerminalAppearance,
      inlineSuggestion: {
        ...defaultTerminalAppearance.inlineSuggestion,
        ...inlineSuggestion,
        providers: {
          ...defaultTerminalAppearance.inlineSuggestion.providers,
          ...inlineSuggestion.providers,
        },
      },
    },
  };
}

describe("createTerminalRemoteSuggestionPrewarm", () => {
  it("schedules enabled ssh probes with normalized cwd and path", () => {
    const scheduler = createScheduler();
    const prewarm = createTerminalRemoteSuggestionPrewarm({
      paneId: "pane-a",
      remoteHostId: "prod",
      scheduler,
      target: { hostId: "prod", kind: "ssh" },
      terminalAppearanceRef: createAppearanceRef(),
    });

    prewarm.scheduleGit(" /srv/app ");
    prewarm.scheduleRemoteCommand();
    prewarm.scheduleRemoteHistory();
    prewarm.scheduleRemotePath(" /srv/app/bin ");

    expect(scheduler.scheduleGit).toHaveBeenCalledWith({
      cwd: "/srv/app",
      delayMs: 750,
      hostId: "prod",
      maxEntries: 500,
      ownerId: "pane-a",
      ttlSeconds: 60,
    });
    expect(scheduler.scheduleRemoteCommand).toHaveBeenCalledWith({
      delayMs: 500,
      hostId: "prod",
      maxEntries: 1500,
      ownerId: "pane-a",
      ttlSeconds: 300,
    });
    expect(scheduler.scheduleRemoteHistory).toHaveBeenCalledWith({
      delayMs: 650,
      hostId: "prod",
      maxEntries: 1000,
      ownerId: "pane-a",
      ttlSeconds: 900,
    });
    expect(scheduler.scheduleRemotePath).toHaveBeenCalledWith({
      delayMs: 250,
      hostId: "prod",
      maxEntries: 250,
      ownerId: "pane-a",
      path: "/srv/app/bin",
      ttlSeconds: 30,
    });
    expect(scheduler.setOwnerDisabled).toHaveBeenCalledWith("pane-a", null);
  });

  it("does not schedule remote probes for non-ssh terminal targets", () => {
    const scheduler = createScheduler();
    const recordAuditEvent = vi.fn<RecordAuditEvent>().mockResolvedValue({
      recorded: true,
    });
    const prewarm = createTerminalRemoteSuggestionPrewarm({
      paneId: "pane-a",
      recordAuditEvent,
      remoteHostId: "prod",
      scheduler,
      target: {
        containerId: "container-a",
        hostId: "prod",
        kind: "dockerContainer",
      },
      terminalAppearanceRef: createAppearanceRef(),
    });

    prewarm.scheduleRemoteCommand();
    prewarm.scheduleRemoteHistory();
    prewarm.scheduleRemotePath("/srv/app");
    prewarm.scheduleGit("/srv/app");

    expect(scheduler.scheduleRemoteCommand).not.toHaveBeenCalled();
    expect(scheduler.scheduleRemoteHistory).not.toHaveBeenCalled();
    expect(scheduler.scheduleRemotePath).not.toHaveBeenCalled();
    expect(scheduler.scheduleGit).not.toHaveBeenCalled();
    expect(recordAuditEvent).not.toHaveBeenCalled();
  });

  it("does not schedule or audit probes when lifecycle gate is closed", () => {
    const scheduler = createScheduler();
    const recordAuditEvent = vi.fn<RecordAuditEvent>().mockResolvedValue({
      recorded: true,
    });
    const prewarm = createTerminalRemoteSuggestionPrewarm({
      canScheduleProbe: () => false,
      paneId: "pane-a",
      recordAuditEvent,
      remoteHostId: "prod",
      scheduler,
      target: { hostId: "prod", kind: "ssh" },
      terminalAppearanceRef: createAppearanceRef(),
    });

    prewarm.scheduleGit("/srv/app");
    prewarm.scheduleRemoteCommand();
    prewarm.scheduleRemoteHistory();
    prewarm.scheduleRemotePath("/srv/app");

    expect(scheduler.scheduleGit).not.toHaveBeenCalled();
    expect(scheduler.scheduleRemoteCommand).not.toHaveBeenCalled();
    expect(scheduler.scheduleRemoteHistory).not.toHaveBeenCalled();
    expect(scheduler.scheduleRemotePath).not.toHaveBeenCalled();
    expect(recordAuditEvent).not.toHaveBeenCalled();
    expect(scheduler.setOwnerDisabled).toHaveBeenCalledWith(
      "pane-a",
      "lifecycle-gate",
    );
  });

  it("records skipped audit events when remote probes are disabled", () => {
    const scheduler = createScheduler();
    const recordAuditEvent = vi.fn<RecordAuditEvent>().mockResolvedValue({
      recorded: true,
    });
    const prewarm = createTerminalRemoteSuggestionPrewarm({
      paneId: "pane-a",
      recordAuditEvent,
      remoteHostId: "prod",
      scheduler,
      target: { hostId: "prod", kind: "ssh" },
      terminalAppearanceRef: createAppearanceRef({
        remoteProbeEnabled: false,
      }),
    });

    prewarm.scheduleRemotePath(" /srv/app ");

    expect(scheduler.scheduleRemotePath).not.toHaveBeenCalled();
    expect(recordAuditEvent).toHaveBeenCalledWith({
      decision: "skipped",
      eventKind: "remoteProbeSchedule",
      paneId: "pane-a",
      path: "/srv/app",
      provider: "remotePath",
      reason: "remote-probe-disabled",
      remoteHostId: "prod",
      target: "ssh",
    });
  });
});
