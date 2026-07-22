import { describe, expect, it } from "vitest";
import {
  buildCompatibilityMetricSnapshot,
  compatibilityRegistry,
  evaluateCompatibilityActivation,
  SILENT_CATCH_DIAGNOSTICS_POLICY,
  validateCompatibilityRegistry,
} from "../../../../src/architecture/compatibility/compatibilityRegistry";

const expectedIds = [
  "command-history.empty-scope-clear",
  "config-watcher.polling",
  "diagnostics.silent-catch-policy",
  "managed-ssh.legacy-fallback",
  "runtime.browser-preview",
  "sftp.transfer-polling",
  "snippet.schema-v1",
  "startup.dynamic-import-retry",
  "terminal.gpu-fallback",
  "terminal.xterm-webview-patch",
  "workspace.schema-v1-migration",
];

describe("compatibility registry", () => {
  it("keeps the complete governed inventory in one manifest", () => {
    expect(validateCompatibilityRegistry(compatibilityRegistry)).toEqual([]);
    expect(compatibilityRegistry.map((entry) => entry.id).sort()).toEqual(
      expectedIds,
    );
  });

  it("fails closed for unregistered activation reasons", () => {
    expect(
      evaluateCompatibilityActivation("terminal.gpu-fallback", "context-lost"),
    ).toMatchObject({ allowed: true });
    expect(
      evaluateCompatibilityActivation(
        "managed-ssh.legacy-fallback",
        "authentication-failed",
      ),
    ).toMatchObject({ allowed: false });
    expect(() =>
      evaluateCompatibilityActivation("unknown.compatibility", "anything"),
    ).toThrow(/未登记/);
  });

  it("publishes aggregate-only metrics without caller details", () => {
    const snapshot = buildCompatibilityMetricSnapshot([
      {
        activationCount: 2,
        failureCount: 1,
        id: "sftp.transfer-polling",
        labels: {
          outcome: "fallback",
          path: "C:/Users/example/.ssh/id_ed25519",
          secret: "do-not-serialize",
        },
      },
    ]);
    const serialized = JSON.stringify(snapshot).toLowerCase();

    expect(snapshot.entries).toEqual([
      {
        activationCount: 2,
        category: "runtime-fallback",
        failureCount: 1,
        id: "sftp.transfer-polling",
        lifecycle: "supported-mode",
      },
    ]);
    expect(serialized).not.toContain("id_ed25519");
    expect(serialized).not.toContain("do-not-serialize");
    expect(serialized).not.toContain("labels");
  });

  it("requires silent catches to choose an explicit diagnostic disposition", () => {
    expect(SILENT_CATCH_DIAGNOSTICS_POLICY.allowedDispositions).toEqual([
      "aggregate-counter",
      "best-effort-ignore",
      "user-visible",
    ]);
    expect(SILENT_CATCH_DIAGNOSTICS_POLICY.forbiddenPayloads).toEqual(
      expect.arrayContaining(["error-message", "filesystem-path", "secret"]),
    );
    expect(
      compatibilityRegistry.find(
        (entry) => entry.id === "diagnostics.silent-catch-policy",
      )?.allowedReasons,
    ).toEqual(SILENT_CATCH_DIAGNOSTICS_POLICY.allowedDispositions);
  });

  it("rejects malformed inventory metadata", () => {
    expect(
      validateCompatibilityRegistry([
        {
          ...compatibilityRegistry[0],
          allowedReasons: ["invalid reason with spaces"],
          id: ".invalid",
        },
      ]),
    ).not.toEqual([]);
  });
});
