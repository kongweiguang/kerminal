// @author kongweiguang

import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SshHostKeyInspection } from "../../../../src/lib/sshHostKeyApi";
import { SshHostKeyPromptHost } from "../../../../src/features/ssh-host-key/SshHostKeyPromptHost";
import {
  createSshHostKeyPromptStore,
  type SshHostKeyPromptStore,
} from "../../../../src/features/ssh-host-key/sshHostKeyPromptStore";

const apiMocks = vi.hoisted(() => ({
  trustSshHostKey: vi.fn(),
}));

vi.mock("../../../../src/lib/sshHostKeyApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../src/lib/sshHostKeyApi")>()),
  trustSshHostKey: (...args: unknown[]) => apiMocks.trustSshHostKey(...args),
}));

const unknownInspection: SshHostKeyInspection = {
  algorithm: "ssh-ed25519",
  fingerprint: "SHA256:host-key",
  host: "dev.example.com",
  hostId: "host-1",
  port: 22,
  status: "unknown",
};

describe("SshHostKeyPromptHost", () => {
  let store: SshHostKeyPromptStore;

  beforeEach(() => {
    apiMocks.trustSshHostKey.mockReset();
    store = createSshHostKeyPromptStore();
  });

  afterEach(() => {
    let current = store.getCurrent();
    while (current) {
      store.cancel(current.id);
      current = store.getCurrent();
    }
  });

  it("trusts the displayed fingerprint and resolves the queued request", async () => {
    const user = userEvent.setup();
    const trusted = { ...unknownInspection, status: "known" as const };
    apiMocks.trustSshHostKey.mockResolvedValue(trusted);
    render(<SshHostKeyPromptHost store={store} />);

    const result = store.request({ inspection: unknownInspection, ownerId: "pane-1" });
    await user.click(await screen.findByRole("button", { name: "信任并连接" }));

    expect(apiMocks.trustSshHostKey).toHaveBeenCalledWith({
      expectedFingerprint: unknownInspection.fingerprint,
      hostId: unknownInspection.hostId,
    });
    await expect(result).resolves.toEqual(trusted);
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "确认 SSH 主机身份" })).toBeNull(),
    );
  });

  it("rejects a changed identity returned during confirmation", async () => {
    const user = userEvent.setup();
    apiMocks.trustSshHostKey.mockResolvedValue({
      ...unknownInspection,
      fingerprint: "SHA256:changed-key",
      status: "changed",
    });
    render(<SshHostKeyPromptHost store={store} />);

    const result = store.request({ inspection: unknownInspection });
    const rejected = expect(result).rejects.toThrow("SSH 主机密钥已变化");
    await user.click(await screen.findByRole("button", { name: "信任并连接" }));

    await rejected;
    expect(screen.queryByRole("dialog", { name: "确认 SSH 主机身份" })).toBeNull();
  });

  it("ignores a late trust result after the owner is canceled", async () => {
    const user = userEvent.setup();
    let resolveTrust: ((inspection: SshHostKeyInspection) => void) | undefined;
    const pendingTrust = new Promise<SshHostKeyInspection>((resolve) => {
      resolveTrust = resolve;
    });
    apiMocks.trustSshHostKey.mockReturnValue(pendingTrust);
    render(<SshHostKeyPromptHost store={store} />);

    const firstResult = store.request({
      inspection: unknownInspection,
      ownerId: "closed-pane",
    });
    const secondInspection = {
      ...unknownInspection,
      host: "next.example.com",
      hostId: "host-2",
    };
    const secondResult = store.request({
      inspection: secondInspection,
      ownerId: "next-pane",
    });
    await user.click(await screen.findByRole("button", { name: "信任并连接" }));
    await act(async () => {
      store.cancelForOwner("closed-pane");
    });

    await expect(firstResult).resolves.toBeNull();
    await waitFor(() =>
      expect(screen.getByRole("dialog", { name: "确认 SSH 主机身份" })).toHaveTextContent(
        "next.example.com:22",
      ),
    );
    await act(async () => {
      resolveTrust?.({ ...unknownInspection, status: "known" });
      await pendingTrust;
    });
    await waitFor(() =>
      expect(store.getCurrent()?.options.inspection).toEqual(secondInspection),
    );
    expect(screen.getByRole("button", { name: "信任并连接" })).toBeEnabled();

    await act(async () => {
      store.cancelForOwner("next-pane");
    });
    await expect(secondResult).resolves.toBeNull();
  });
});
