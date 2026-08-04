// @author kongweiguang

import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { SshAuthPromptPlan } from "./sshAuthApi";

export const EXTERNAL_SSH_LAUNCH_EVENT = "kerminal-external-ssh-launch";

type ExternalLaunchSourceTool =
  | "putty"
  | "mobaxterm"
  | "xshell"
  | "securecrt"
  | "openssh"
  | "sftp-client"
  | "kerminal-native";

type ExternalLaunchEntrypoint =
  "direct-argv" | "single-instance" | "protocol" | "session-file";

type ExternalLaunchEventKind = "queued" | "rejected";

interface ExternalLaunchSource {
  tool: ExternalLaunchSourceTool;
  entrypoint: ExternalLaunchEntrypoint;
  persona?: string;
  argv0?: string;
}
interface ExternalSshRouteHop {
  host: string;
  port: number;
  username?: string;
}

interface ExternalSshTarget {
  host: string;
  port: number;
  username?: string;
  route: ExternalSshRouteHop[];
}

interface ExternalSshAuthMetadata {
  hasPassword: boolean;
  hasKeyPassphrase: boolean;
  identityFile?: string;
  passwordFilePresent: boolean;
  agent: boolean;
}

interface ExternalSshLaunchOptions {
  displayName?: string;
  remoteCommand?: string;
  remoteCommandFile?: string;
  openSftp: boolean;
  sessionName?: string;
}

interface ExternalLaunchRequestDiagnostics {
  parser: string;
  argvRedacted: string[];
  rawHash: string;
  warnings: string[];
}

export interface ExternalSshLaunchRequest {
  id: string;
  source: ExternalLaunchSource;
  receivedAt: string;
  target: ExternalSshTarget;
  intent?:
    | { kind: "sshTerminal" }
    | {
        kind: "sftpTransfer";
        remotePath?: string;
        selectedEntry?: string;
        hostKeyAssertion?: string;
      };
  auth: ExternalSshAuthMetadata;
  options: ExternalSshLaunchOptions;
  diagnostics: ExternalLaunchRequestDiagnostics;
}

export interface ExternalLaunchMaterializeRequest {
  launchId: string;
  username?: string;
}

export interface ExternalLaunchMaterializedTarget {
  launchId: string;
  targetId: string;
  displayName: string;
  host: string;
  port: number;
  username: string;
  authType: "password" | "key" | "agent";
  safety: "restricted-unknown" | "known";
}

export type ExternalLaunchMaterializeOutcome =
  | { status: "ready"; target: ExternalLaunchMaterializedTarget }
  | { status: "promptRequired"; promptPlan: SshAuthPromptPlan }
  | { status: "rejected"; message: string };

export interface ExternalHostKeyInspection {
  algorithm: string;
  fingerprint: string;
  host: string;
  launchId: string;
  port: number;
  status: "known" | "unknown" | "changed";
}

interface ExternalLaunchTargetSummary {
  host: string;
  port: number;
  username?: string;
  displayName: string;
}

export interface ExternalLaunchEventPayload {
  kind: ExternalLaunchEventKind;
  launchId?: string;
  sourceTool?: ExternalLaunchSourceTool;
  entrypoint: ExternalLaunchEntrypoint;
  target?: ExternalLaunchTargetSummary;
  pendingCount: number;
  message?: string;
}

interface ExternalLaunchPolicySnapshot {
  enabled: boolean;
  acceptVendorArgs: boolean;
  autoOpenSftp: boolean;
  disabledTools: ExternalLaunchSourceTool[];
  pendingCapacity: number;
  claimLeaseMs: number;
}

interface ExternalLaunchIntakeSnapshot {
  pendingCount: number;
  pendingRequestHashes: string[];
  claimedCount: number;
  claimedRequestHashes: string[];
  acceptedCount: number;
  rejectedCount: number;
  noopCount: number;
  policy: ExternalLaunchPolicySnapshot;
  lastRejection?: {
    entrypoint: ExternalLaunchEntrypoint;
    sourceTool?: ExternalLaunchSourceTool;
    message: string;
    argCount: number;
    rawHash: string;
    cwdPresent: boolean;
  };
  health: ExternalLaunchRuntimeHealthSnapshot;
}

interface ExternalLaunchRuntimeHealthSnapshot {
  backpressureCount: number;
  expiryCount: number;
  cancelCount: number;
  oldestLaunchAgeMs: number;
  lastIntakeLatencyMs?: number;
}

interface ExternalLaunchTaskSnapshot {
  queuedCount: number;
  inFlightCount: number;
  connectedCount: number;
  cancelledCount: number;
  deadlineCount: number;
  lateCleanupCount: number;
  completedCount: number;
  oldestTaskAgeMs: number;
  lastConnectLatencyMs?: number;
}

interface ExternalLaunchSecretSnapshot {
  activeSecretCount: number;
  requestHashes: string[];
}

export interface ExternalLaunchSnapshot {
  intake: ExternalLaunchIntakeSnapshot;
  secrets: ExternalLaunchSecretSnapshot;
  tasks: ExternalLaunchTaskSnapshot;
}

export async function takePendingExternalSshLaunches(): Promise<
  ExternalSshLaunchRequest[]
> {
  if (isTauri()) {
    return invoke<ExternalSshLaunchRequest[]>("external_launch_take_pending");
  }
  return [];
}

export async function ackExternalSshLaunch(launchId: string): Promise<number> {
  if (isTauri()) {
    return invoke<number>("external_launch_ack", { launchId });
  }
  validateBrowserPreviewLaunchId(launchId);
  return 0;
}

export async function materializeExternalSshLaunch(
  request: ExternalLaunchMaterializeRequest,
): Promise<ExternalLaunchMaterializeOutcome> {
  validateBrowserPreviewLaunchId(request.launchId);
  if (isTauri()) {
    return invoke<ExternalLaunchMaterializeOutcome>("external_launch_materialize", {
      request,
    });
  }
  return {
    status: "ready",
    target: {
      authType: "agent",
      displayName: `External ${request.launchId}`,
      host: "preview.invalid",
      launchId: request.launchId,
      port: 22,
      safety: "restricted-unknown",
      targetId: `external:${request.launchId}`,
      username: request.username ?? "preview",
    },
  };
}

export interface ExternalLaunchDeepLinkStatus {
  registered: boolean;
  scheme: string;
  supported: boolean;
}

export async function inspectExternalLaunchHostKey(
  launchId: string,
): Promise<ExternalHostKeyInspection> {
  validateBrowserPreviewLaunchId(launchId);
  if (isTauri()) {
    return invoke<ExternalHostKeyInspection>("external_launch_host_key_inspect", {
      launchId,
    });
  }
  return {
    algorithm: "ssh-ed25519",
    fingerprint: "SHA256:browser-preview",
    host: "preview.invalid",
    launchId,
    port: 22,
    status: "known",
  };
}

export async function trustExternalLaunchHostKey(
  launchId: string,
  expectedFingerprint: string,
): Promise<ExternalHostKeyInspection> {
  validateBrowserPreviewLaunchId(launchId);
  if (isTauri()) {
    return invoke<ExternalHostKeyInspection>("external_launch_host_key_trust", {
      expectedFingerprint,
      launchId,
    });
  }
  return {
    algorithm: "ssh-ed25519",
    fingerprint: expectedFingerprint,
    host: "preview.invalid",
    launchId,
    port: 22,
    status: "known",
  };
}

export async function cancelExternalSshLaunch(
  launchId: string,
): Promise<number> {
  if (isTauri()) {
    return invoke<number>("external_launch_cancel", { launchId });
  }
  validateBrowserPreviewLaunchId(launchId);
  return 0;
}

export async function closeExternalSshLaunch(
  launchId: string,
): Promise<number> {
  if (isTauri()) {
    return invoke<number>("external_launch_close", { launchId });
  }
  validateBrowserPreviewLaunchId(launchId);
  return 0;
}

export async function getExternalLaunchSnapshot(): Promise<ExternalLaunchSnapshot> {
  if (isTauri()) {
    return invoke<ExternalLaunchSnapshot>("external_launch_snapshot");
  }
  return {
    intake: {
      acceptedCount: 0,
      claimedCount: 0,
      claimedRequestHashes: [],
      noopCount: 0,
      pendingCount: 0,
      pendingRequestHashes: [],
      health: {
        backpressureCount: 0,
        cancelCount: 0,
        expiryCount: 0,
        oldestLaunchAgeMs: 0,
      },
      policy: {
        acceptVendorArgs: true,
        autoOpenSftp: false,
        disabledTools: [],
        enabled: true,
        pendingCapacity: 128,
        claimLeaseMs: 30_000,
      },
      rejectedCount: 0,
    },
    secrets: {
      activeSecretCount: 0,
      requestHashes: [],
    },
    tasks: {
      cancelledCount: 0,
      completedCount: 0,
      connectedCount: 0,
      deadlineCount: 0,
      inFlightCount: 0,
      lateCleanupCount: 0,
      oldestTaskAgeMs: 0,
      queuedCount: 0,
    },
  };
}

export async function getExternalLaunchDeepLinkStatus(): Promise<ExternalLaunchDeepLinkStatus> {
  if (isTauri()) {
    return invoke<ExternalLaunchDeepLinkStatus>("external_launch_deep_link_status");
  }
  return { registered: false, scheme: "kerminal", supported: false };
}

export async function registerExternalLaunchDeepLink(): Promise<ExternalLaunchDeepLinkStatus> {
  if (isTauri()) {
    return invoke<ExternalLaunchDeepLinkStatus>("external_launch_deep_link_register");
  }
  return { registered: false, scheme: "kerminal", supported: false };
}

export async function unregisterExternalLaunchDeepLink(): Promise<ExternalLaunchDeepLinkStatus> {
  if (isTauri()) {
    return invoke<ExternalLaunchDeepLinkStatus>("external_launch_deep_link_unregister");
  }
  return { registered: false, scheme: "kerminal", supported: false };
}

export async function listenExternalSshLaunches(
  handler: (payload: ExternalLaunchEventPayload) => void,
): Promise<UnlistenFn> {
  if (!isTauri()) {
    return () => undefined;
  }
  return listen<ExternalLaunchEventPayload>(
    EXTERNAL_SSH_LAUNCH_EVENT,
    (event) => {
      if (isExternalLaunchEventPayload(event.payload)) {
        handler(event.payload);
      }
    },
  );
}

function isExternalLaunchEventPayload(
  payload: unknown,
): payload is ExternalLaunchEventPayload {
  if (typeof payload !== "object" || payload === null) {
    return false;
  }
  const value = payload as Partial<ExternalLaunchEventPayload>;
  return (
    (value.kind === "queued" || value.kind === "rejected") &&
    typeof value.entrypoint === "string" &&
    typeof value.pendingCount === "number"
  );
}

function validateBrowserPreviewLaunchId(launchId: string) {
  if (!launchId.trim()) {
    throw new Error("External SSH launch id cannot be empty");
  }
  if (launchId.includes("\n") || launchId.includes("\r")) {
    throw new Error("External SSH launch id cannot contain newline");
  }
}
