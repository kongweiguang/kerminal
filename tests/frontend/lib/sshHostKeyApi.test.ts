// @author kongweiguang

import { beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  isTauri: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => apiMocks.invoke(...args),
  isTauri: () => apiMocks.isTauri(),
}));

describe("sshHostKeyApi", () => {
  beforeEach(() => {
    vi.resetModules();
    apiMocks.invoke.mockReset();
    apiMocks.isTauri.mockReset();
  });

  it("uses the typed inspect and trust commands in Tauri", async () => {
    apiMocks.isTauri.mockReturnValue(true);
    apiMocks.invoke
      .mockResolvedValueOnce({
        algorithm: "ssh-ed25519",
        fingerprint: "SHA256:before",
        host: "dev.example.com",
        hostId: "host-1",
        port: 22,
        status: "unknown",
      })
      .mockResolvedValueOnce({
        algorithm: "ssh-ed25519",
        fingerprint: "SHA256:before",
        host: "dev.example.com",
        hostId: "host-1",
        port: 22,
        status: "known",
      });
    const { inspectSshHostKey, trustSshHostKey } = await import(
      "../../../src/lib/sshHostKeyApi"
    );

    await expect(inspectSshHostKey({ hostId: "host-1" })).resolves.toMatchObject({
      status: "unknown",
    });
    await expect(
      trustSshHostKey({
        expectedFingerprint: "SHA256:before",
        hostId: "host-1",
      }),
    ).resolves.toMatchObject({ status: "known" });

    expect(apiMocks.invoke).toHaveBeenNthCalledWith(1, "ssh_host_key_inspect", {
      hostId: "host-1",
    });
    expect(apiMocks.invoke).toHaveBeenNthCalledWith(2, "ssh_host_key_trust", {
      expectedFingerprint: "SHA256:before",
      hostId: "host-1",
    });
  });

  it("returns a stable known preview identity without invoking Tauri", async () => {
    apiMocks.isTauri.mockReturnValue(false);
    const { inspectSshHostKey, trustSshHostKey } = await import(
      "../../../src/lib/sshHostKeyApi"
    );

    await expect(inspectSshHostKey({ hostId: "host-preview" })).resolves.toEqual({
      algorithm: "ssh-ed25519",
      fingerprint: "SHA256:browser-preview",
      host: "preview.invalid",
      hostId: "host-preview",
      port: 22,
      status: "known",
    });
    await expect(
      trustSshHostKey({
        expectedFingerprint: "SHA256:browser-preview",
        hostId: "host-preview",
      }),
    ).resolves.toMatchObject({ status: "known" });
    expect(apiMocks.invoke).not.toHaveBeenCalled();
  });
});
