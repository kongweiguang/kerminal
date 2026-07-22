import type { RemoteTargetRef } from "../../lib/targetModel";
import {
  recordTerminalSuggestionAuditEvent,
  type CommandSuggestionAuditRecordRequest,
  type CommandSuggestionProvider,
} from "../../lib/terminalSuggestionApi";
import type { TerminalAppearance } from "../settings/contracts/index";
import { remoteSuggestionHostId } from "./XtermPane.runtime.helpers";
import { terminalSuggestionProbeScheduler } from "./terminalSuggestionProbeScheduler";

type RecordAuditEvent = (
  request: CommandSuggestionAuditRecordRequest,
) => Promise<unknown>;

interface TerminalRemoteSuggestionProbeScheduler {
  scheduleGit: typeof terminalSuggestionProbeScheduler.scheduleGit;
  scheduleRemoteCommand: typeof terminalSuggestionProbeScheduler.scheduleRemoteCommand;
  scheduleRemoteHistory: typeof terminalSuggestionProbeScheduler.scheduleRemoteHistory;
  scheduleRemotePath: typeof terminalSuggestionProbeScheduler.scheduleRemotePath;
  setOwnerDisabled?: typeof terminalSuggestionProbeScheduler.setOwnerDisabled;
}

interface TerminalAppearanceRef {
  current: TerminalAppearance;
}

interface TerminalRemoteSuggestionPrewarmOptions {
  canScheduleProbe?: () => boolean;
  paneId: string;
  remoteHostId: string | undefined;
  remoteHostProduction: boolean;
  recordAuditEvent?: RecordAuditEvent;
  scheduler?: TerminalRemoteSuggestionProbeScheduler;
  target: RemoteTargetRef | undefined;
  terminalAppearanceRef: TerminalAppearanceRef;
}

interface RemoteProbeScheduleSkippedInput {
  cwd?: string;
  path?: string;
  provider: CommandSuggestionProvider;
  reason: string;
}

export function createTerminalRemoteSuggestionPrewarm({
  canScheduleProbe = () => true,
  paneId,
  recordAuditEvent = recordTerminalSuggestionAuditEvent,
  remoteHostId,
  remoteHostProduction,
  scheduler = terminalSuggestionProbeScheduler,
  target,
  terminalAppearanceRef,
}: TerminalRemoteSuggestionPrewarmOptions) {
  const recordScheduleSkipped = ({
    cwd,
    path,
    provider,
    reason,
  }: RemoteProbeScheduleSkippedInput) => {
    void recordAuditEvent({
      cwd,
      decision: "skipped",
      eventKind: "remoteProbeSchedule",
      metadata: {
        productionHost: String(remoteHostProduction),
        productionHostPolicy:
          terminalAppearanceRef.current.inlineSuggestion.productionHostPolicy,
      },
      paneId,
      path,
      provider,
      reason,
      remoteHostId,
      target: "ssh",
    }).catch(() => undefined);
  };
  const canUseSchedulerProbe = () => {
    const canSchedule = canScheduleProbe();
    scheduler.setOwnerDisabled?.(
      paneId,
      canSchedule ? null : "lifecycle-gate",
    );
    return canSchedule;
  };

  const scheduleGit = (path: string | undefined) => {
    const inlineSuggestion = terminalAppearanceRef.current.inlineSuggestion;
    const hostId = remoteSuggestionHostId(target, remoteHostId);
    const cwd = path?.trim();
    if (
      !canUseSchedulerProbe() ||
      !inlineSuggestion.enabled ||
      !inlineSuggestion.providers.git ||
      !hostId ||
      !cwd
    ) {
      return;
    }
    const skipReason = remoteProbeSkipReason(
      inlineSuggestion,
      remoteHostProduction,
    );
    if (skipReason) {
      recordScheduleSkipped({
        cwd,
        provider: "git",
        reason: skipReason,
      });
      return;
    }
    scheduler.scheduleGit({
      cwd,
      delayMs: 750,
      hostId,
      maxEntries: 500,
      ownerId: paneId,
      ttlSeconds: 60,
    });
  };

  const scheduleRemoteCommand = () => {
    const inlineSuggestion = terminalAppearanceRef.current.inlineSuggestion;
    const hostId = remoteSuggestionHostId(target, remoteHostId);
    if (
      !canUseSchedulerProbe() ||
      !inlineSuggestion.enabled ||
      !inlineSuggestion.providers.remoteCommand ||
      !hostId
    ) {
      return;
    }
    const skipReason = remoteProbeSkipReason(
      inlineSuggestion,
      remoteHostProduction,
    );
    if (skipReason) {
      recordScheduleSkipped({
        provider: "remoteCommand",
        reason: skipReason,
      });
      return;
    }
    scheduler.scheduleRemoteCommand({
      delayMs: 500,
      hostId,
      maxEntries: 1500,
      ownerId: paneId,
      ttlSeconds: 300,
    });
  };

  const scheduleRemoteHistory = () => {
    const inlineSuggestion = terminalAppearanceRef.current.inlineSuggestion;
    const hostId = remoteSuggestionHostId(target, remoteHostId);
    if (
      !canUseSchedulerProbe() ||
      !inlineSuggestion.enabled ||
      !inlineSuggestion.providers.history ||
      !hostId
    ) {
      return;
    }
    const skipReason = remoteProbeSkipReason(
      inlineSuggestion,
      remoteHostProduction,
    );
    if (skipReason) {
      recordScheduleSkipped({
        provider: "history",
        reason: skipReason,
      });
      return;
    }
    scheduler.scheduleRemoteHistory({
      delayMs: 650,
      hostId,
      maxEntries: 1000,
      ownerId: paneId,
      ttlSeconds: 900,
    });
  };

  const scheduleRemotePath = (path: string | undefined) => {
    const inlineSuggestion = terminalAppearanceRef.current.inlineSuggestion;
    const hostId = remoteSuggestionHostId(target, remoteHostId);
    const normalizedPath = path?.trim();
    if (
      !canUseSchedulerProbe() ||
      !inlineSuggestion.enabled ||
      !inlineSuggestion.providers.remotePath ||
      !hostId ||
      !normalizedPath
    ) {
      return;
    }
    const skipReason = remoteProbeSkipReason(
      inlineSuggestion,
      remoteHostProduction,
    );
    if (skipReason) {
      recordScheduleSkipped({
        path: normalizedPath,
        provider: "remotePath",
        reason: skipReason,
      });
      return;
    }
    scheduler.scheduleRemotePath({
      delayMs: 250,
      hostId,
      maxEntries: 250,
      ownerId: paneId,
      path: normalizedPath,
      ttlSeconds: 30,
    });
  };

  return {
    scheduleGit,
    scheduleRemoteCommand,
    scheduleRemoteHistory,
    scheduleRemotePath,
  };
}

function remoteProbeSkipReason(
  inlineSuggestion: TerminalAppearance["inlineSuggestion"],
  remoteHostProduction: boolean,
) {
  if (!inlineSuggestion.remoteProbeEnabled) {
    return "remote-probe-disabled";
  }
  if (
    remoteHostProduction &&
    inlineSuggestion.productionHostPolicy === "restricted"
  ) {
    return "production-host-restricted";
  }
  return undefined;
}
