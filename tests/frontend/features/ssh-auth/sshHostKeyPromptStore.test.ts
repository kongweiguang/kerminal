// @author kongweiguang

import { beforeEach, describe, expect, it } from "vitest";
import type { SshHostKeyInspection } from "../../../../src/lib/sshHostKeyApi";
import {
  createSshHostKeyPromptStore,
  type SshHostKeyPromptStore,
} from "../../../../src/features/ssh-host-key/sshHostKeyPromptStore";

const inspection: SshHostKeyInspection = {
  algorithm: "ssh-ed25519",
  fingerprint: "SHA256:host-key",
  host: "dev.example.com",
  hostId: "host-1",
  port: 22,
  status: "unknown",
};

describe("sshHostKeyPromptStore", () => {
  let store: SshHostKeyPromptStore;

  beforeEach(() => {
    store = createSshHostKeyPromptStore();
  });

  it("keeps concurrent targets isolated and resolves them in queue order", async () => {
    const first = store.request({ inspection, ownerId: "pane-1" });
    const secondInspection = { ...inspection, host: "next.example.com", hostId: "host-2" };
    const second = store.request({
      inspection: secondInspection,
      ownerId: "pane-2",
    });

    expect(store.getCurrent()?.options.inspection).toEqual(inspection);
    store.complete("ssh-host-key-prompt-1", inspection);
    await expect(first).resolves.toEqual(inspection);
    expect(store.getCurrent()?.options.inspection).toEqual(secondInspection);

    store.cancel("ssh-host-key-prompt-2");
    await expect(second).resolves.toBeNull();
  });

  it("cancels every pending item belonging to a closed pane owner", async () => {
    const pending = store.request({ inspection, ownerId: "closed-pane" });
    const unrelated = store.request({
      inspection: { ...inspection, hostId: "other-host" },
      ownerId: "other-pane",
    });

    store.cancelForOwner("closed-pane");
    await expect(pending).resolves.toBeNull();
    expect(store.getCurrent()?.options.ownerId).toBe("other-pane");
    store.cancel("ssh-host-key-prompt-2");
    await expect(unrelated).resolves.toBeNull();
  });

  it("rejects a prompt when trust returns a changed identity", async () => {
    const pending = store.request({ inspection });
    store.fail("ssh-host-key-prompt-1", new Error("SSH 主机密钥已变化"));
    await expect(pending).rejects.toThrow("SSH 主机密钥已变化");
  });
});
