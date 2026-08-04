// @author kongweiguang

import { describe, expect, it } from "vitest";
import type { ExternalSshLaunchRequest } from "../../../../src/lib/externalLaunchApi";
import {
  applyExternalSshLaunchMaterializedTarget,
  externalSshLaunchAuthType,
  externalSshLaunchDescription,
  externalSshLaunchDisplayName,
  externalSshLaunchIdFromMachineId,
  externalSshLaunchMachineId,
  externalSshLaunchNeedsUsername,
  isExternalSshMachineId,
  resolveExternalSshLaunchUsername,
} from "../../../../src/features/external-launch/externalSshLaunchModel";

describe("externalSshLaunchModel", () => {
  it("detects missing usernames and returns a resolved launch", () => {
    const launch = createLaunch({ username: undefined });

    expect(externalSshLaunchNeedsUsername(launch)).toBe(true);
    const resolved = resolveExternalSshLaunchUsername(launch, "  deploy ");

    expect(resolved.target.username).toBe("deploy");
    expect(externalSshLaunchNeedsUsername(resolved)).toBe(false);
    expect(() => resolveExternalSshLaunchUsername(launch, "   ")).toThrow(
      "SSH username is required",
    );
  });

  it("creates stable display metadata for workspace temporary machines", () => {
    const launch = createLaunch({
      displayName: "Production shell",
      hasPassword: false,
      identityFile: "C:/keys/prod.pem",
      username: "root",
    });

    expect(externalSshLaunchDisplayName(launch)).toBe("Production shell");
    expect(externalSshLaunchDescription(launch)).toBe(
      "root@example.internal:2202 · PuTTY",
    );
    expect(externalSshLaunchAuthType(launch)).toBe("key");
    expect(externalSshLaunchMachineId(launch)).toBe("external:launch-1");
  });

  it("parses temporary external machine ids without matching saved hosts", () => {
    expect(isExternalSshMachineId("external:launch-1")).toBe(true);
    expect(externalSshLaunchIdFromMachineId("external:launch-1")).toBe(
      "launch-1",
    );
    expect(isExternalSshMachineId("host-lab")).toBe(false);
    expect(externalSshLaunchIdFromMachineId("host-lab")).toBeNull();
  });

  it("prefers password metadata over key and agent fallbacks", () => {
    expect(
      externalSshLaunchAuthType(
        createLaunch({ hasPassword: true, identityFile: "C:/keys/prod.pem" }),
      ),
    ).toBe("password");
    expect(
      externalSshLaunchAuthType(
        createLaunch({ agent: true, hasPassword: false }),
      ),
    ).toBe("agent");
  });

  it("uses materialized target details after backend intake resolves the launch", () => {
    const launch = resolveExternalSshLaunchUsername(
      createLaunch({
        displayName: "Parser target",
        hasPassword: true,
        username: "parsed-user",
      }),
      "parsed-user",
    );

    const materialized = applyExternalSshLaunchMaterializedTarget(launch, {
      authType: "agent",
      displayName: "Materialized target",
      host: "materialized.internal",
      launchId: "launch-1",
      port: 2202,
      safety: "known",
      targetId: "external:launch-1",
      username: "resolved-user",
    });

    expect(materialized.target).toMatchObject({
      host: "materialized.internal",
      port: 2202,
      username: "resolved-user",
    });
    expect(externalSshLaunchAuthType(materialized)).toBe("agent");
    expect(externalSshLaunchDisplayName(materialized)).toBe(
      "Materialized target",
    );
    expect(externalSshLaunchDescription(materialized)).toBe(
      "resolved-user@materialized.internal:2202 · PuTTY",
    );
    expect(externalSshLaunchMachineId(materialized)).toBe("external:launch-1");
  });
});

function createLaunch(
  overrides: {
    agent?: boolean;
    displayName?: string;
    hasPassword?: boolean;
    identityFile?: string;
    username?: string;
  } = {},
): ExternalSshLaunchRequest {
  return {
    auth: {
      agent: overrides.agent ?? false,
      hasKeyPassphrase: false,
      hasPassword: overrides.hasPassword ?? true,
      identityFile: overrides.identityFile,
      passwordFilePresent: false,
    },
    diagnostics: {
      argvRedacted: ["putty.exe", "-ssh", "root@example.internal"],
      parser: "putty",
      rawHash: "abc123",
      warnings: [],
    },
    id: "launch-1",
    options: {
      displayName: overrides.displayName,
      openSftp: false,
    },
    receivedAt: "1760000000",
    source: {
      entrypoint: "single-instance",
      tool: "putty",
    },
    target: {
      host: "example.internal",
      port: 2202,
      route: [],
      username: overrides.username,
    },
  };
}
