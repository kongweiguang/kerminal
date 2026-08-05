// @author kongweiguang

import { vi } from "vitest";
import type {
  ExternalHostKeyInspection,
  ExternalLaunchMaterializedTarget,
  ExternalSshLaunchRequest,
} from "../../../../src/lib/externalLaunchApi";
import { useWorkspaceStore } from "../../../../src/features/workspace/workspaceStore";

export function spyOnOpenExternalSshLaunch() {
  const originalOpen = useWorkspaceStore.getState().openExternalSshLaunch;
  const openSpy = vi.fn((launch: Parameters<typeof originalOpen>[0]) =>
    originalOpen(launch),
  );
  useWorkspaceStore.setState({ openExternalSshLaunch: openSpy });
  return openSpy;
}

export function createLaunch({
  entrypoint = "single-instance",
  id = "launch-1",
  remoteCommand,
  intent,
  username,
}: {
  entrypoint?: ExternalSshLaunchRequest["source"]["entrypoint"];
  id?: string;
  remoteCommand?: string;
  intent?: ExternalSshLaunchRequest["intent"];
  username: string | undefined;
}): ExternalSshLaunchRequest {
  return {
    auth: {
      agent: false,
      hasKeyPassphrase: false,
      hasPassword: true,
      passwordFilePresent: false,
    },
    diagnostics: {
      argvRedacted: ["putty.exe", "-ssh", "example.internal"],
      parser: "putty",
      rawHash: "abc123",
      warnings: [],
    },
    id,
    intent,
    options: {
      openSftp: false,
      remoteCommand,
    },
    receivedAt: "1760000000",
    source: {
      entrypoint,
      tool: "putty",
    },
    target: {
      host: "example.internal",
      port: 22,
      route: [],
      username,
    },
  };
}

export function materializedTarget(
  overrides: Partial<ExternalLaunchMaterializedTarget> = {},
): ExternalLaunchMaterializedTarget {
  return {
    authType: "agent",
    displayName: "Materialized SSH target",
    host: "materialized.internal",
    launchId: "launch-1",
    port: 2202,
    safety: "known",
    targetId: "external:launch-1",
    username: "resolved-user",
    ...overrides,
  };
}

export function knownHostKeyInspection(): ExternalHostKeyInspection {
  return {
    algorithm: "ssh-ed25519",
    fingerprint: "SHA256:test-fingerprint",
    host: "materialized.internal",
    launchId: "launch-1",
    port: 2202,
    status: "known",
  };
}

export function unknownHostKeyInspection(): ExternalHostKeyInspection {
  return {
    ...knownHostKeyInspection(),
    status: "unknown",
  };
}
