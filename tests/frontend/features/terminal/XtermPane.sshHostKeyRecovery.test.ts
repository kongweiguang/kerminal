// @author kongweiguang

import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  SshAuthPromptRequest,
  SshAuthPromptPlan,
} from "../../../../src/lib/sshAuthApi";
import type {
  SshHostKeyInspection,
} from "../../../../src/lib/sshHostKeyApi";
import type { SshTerminalCreateRequest } from "../../../../src/lib/terminalApi";

const mocks = vi.hoisted(() => ({
  createSshTerminalSession: vi.fn(),
  inspectSshHostKey: vi.fn(),
  requestSshHostKeyTrust: vi.fn(),
  submitSshAuthPromptResponse: vi.fn(),
}));

vi.mock("../../../../src/lib/terminalApi", () => ({
  createSshTerminalSession: (...args: unknown[]) =>
    mocks.createSshTerminalSession(...args),
  getTerminalCommandError: (error: unknown) =>
    error && typeof error === "object" && "terminalError" in error
      ? (error as { terminalError: unknown }).terminalError
      : undefined,
}));

vi.mock("../../../../src/lib/sshHostKeyApi", () => ({
  inspectSshHostKey: (...args: unknown[]) => mocks.inspectSshHostKey(...args),
}));

vi.mock("../../../../src/lib/sshAuthApi", () => ({
  submitSshAuthPromptResponse: (...args: unknown[]) =>
    mocks.submitSshAuthPromptResponse(...args),
}));

vi.mock(
  "../../../../src/features/ssh-host-key/state/index",
  async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../../src/features/ssh-host-key/state/index")>()),
    requestSshHostKeyTrust: (...args: unknown[]) =>
      mocks.requestSshHostKeyTrust(...args),
  }),
);

const request: SshTerminalCreateRequest = {
  cols: 80,
  hostId: "host-1",
  rows: 24,
};

const unknownInspection: SshHostKeyInspection = {
  algorithm: "ssh-ed25519",
  fingerprint: "SHA256:host-key",
  host: "dev.example.com",
  hostId: "host-1",
  port: 22,
  status: "unknown",
};

const knownInspection: SshHostKeyInspection = {
  ...unknownInspection,
  status: "known",
};

const changedInspection: SshHostKeyInspection = {
  ...unknownInspection,
  fingerprint: "SHA256:changed-key",
  status: "changed",
};

const output = vi.fn();
const promptForSecret = vi.fn<(prompt: SshAuthPromptRequest) => Promise<string | null>>();

describe("createSshTerminalSessionWithAuthRecovery host-key policy", () => {
  beforeEach(() => {
    mocks.createSshTerminalSession.mockReset();
    mocks.inspectSshHostKey.mockReset();
    mocks.requestSshHostKeyTrust.mockReset();
    mocks.submitSshAuthPromptResponse.mockReset();
    output.mockReset();
    promptForSecret.mockReset();
    promptForSecret.mockResolvedValue("secret");
  });

  it("inspects an unknown key, waits for confirmation, then retries once", async () => {
    const trusted = { ...unknownInspection, status: "known" as const };
    mocks.createSshTerminalSession
      .mockRejectedValueOnce(new Error("Unknown server key"))
      .mockResolvedValueOnce({ id: "session-1" });
    mocks.inspectSshHostKey.mockResolvedValue(unknownInspection);
    mocks.requestSshHostKeyTrust.mockResolvedValue(trusted);

    const { createSshTerminalSessionWithAuthRecovery } = await import(
      "../../../../src/features/terminal/XtermPane.sshAuthRecovery"
    );
    await expect(
      createSshTerminalSessionWithAuthRecovery(request, output, promptForSecret, {
        promptOwnerId: "pane-1",
      }),
    ).resolves.toEqual({ id: "session-1" });

    expect(mocks.inspectSshHostKey).toHaveBeenCalledWith({ hostId: "host-1" });
    expect(mocks.requestSshHostKeyTrust).toHaveBeenCalledWith({
      inspection: unknownInspection,
      ownerId: "pane-1",
    });
    expect(mocks.createSshTerminalSession).toHaveBeenCalledTimes(2);
  });

  it("cancels without trusting or retrying when the confirmation is declined", async () => {
    mocks.createSshTerminalSession.mockRejectedValueOnce(
      new Error("Unknown server key"),
    );
    mocks.inspectSshHostKey.mockResolvedValue(unknownInspection);
    mocks.requestSshHostKeyTrust.mockResolvedValue(null);

    const { createSshTerminalSessionWithAuthRecovery } = await import(
      "../../../../src/features/terminal/XtermPane.sshAuthRecovery"
    );
    await expect(
      createSshTerminalSessionWithAuthRecovery(request, output, promptForSecret),
    ).rejects.toThrow("SSH 主机身份确认已取消");
    expect(mocks.createSshTerminalSession).toHaveBeenCalledTimes(1);
  });

  it("blocks a changed inspection without opening a trust prompt", async () => {
    mocks.createSshTerminalSession.mockRejectedValueOnce(
      new Error("Unknown server key"),
    );
    mocks.inspectSshHostKey.mockResolvedValue(changedInspection);

    const { createSshTerminalSessionWithAuthRecovery } = await import(
      "../../../../src/features/terminal/XtermPane.sshAuthRecovery"
    );
    await expect(
      createSshTerminalSessionWithAuthRecovery(request, output, promptForSecret),
    ).rejects.toThrow("SSH 主机密钥已变化");
    expect(mocks.requestSshHostKeyTrust).not.toHaveBeenCalled();
    expect(mocks.createSshTerminalSession).toHaveBeenCalledTimes(1);
  });

  it("retries once for an already-known inspection and then respects the bound", async () => {
    mocks.createSshTerminalSession
      .mockRejectedValueOnce(new Error("Unknown server key"))
      .mockResolvedValueOnce({ id: "session-known" });
    mocks.inspectSshHostKey.mockResolvedValue(knownInspection);

    const { createSshTerminalSessionWithAuthRecovery } = await import(
      "../../../../src/features/terminal/XtermPane.sshAuthRecovery"
    );
    await expect(
      createSshTerminalSessionWithAuthRecovery(request, output, promptForSecret),
    ).resolves.toEqual({ id: "session-known" });
    expect(mocks.requestSshHostKeyTrust).not.toHaveBeenCalled();
    expect(mocks.createSshTerminalSession).toHaveBeenCalledTimes(2);
  });

  it("does not inspect a healthy known host or non-host-key failure", async () => {
    mocks.createSshTerminalSession.mockResolvedValueOnce({ id: "session-ok" });
    const { createSshTerminalSessionWithAuthRecovery } = await import(
      "../../../../src/features/terminal/XtermPane.sshAuthRecovery"
    );
    await createSshTerminalSessionWithAuthRecovery(request, output, promptForSecret);
    expect(mocks.inspectSshHostKey).not.toHaveBeenCalled();

    mocks.createSshTerminalSession.mockReset();
    mocks.createSshTerminalSession.mockRejectedValueOnce(
      new Error("Permission denied (publickey,password)"),
    );
    await expect(
      createSshTerminalSessionWithAuthRecovery(request, output, promptForSecret),
    ).rejects.toThrow("Permission denied");
    expect(mocks.inspectSshHostKey).not.toHaveBeenCalled();
  });

  it("keeps password recovery independent and bounded to its existing retry", async () => {
    const authPlan: SshAuthPromptPlan = {
      prompts: [
        {
          host: "dev.example.com",
          port: 22,
          promptId: "ssh-auth:target:deploy@dev.example.com:22:password",
          reason: "passwordPrompt",
          role: "target",
          secretKind: "password",
          username: "deploy",
        },
      ],
    };
    mocks.createSshTerminalSession
      .mockRejectedValueOnce({
        terminalError: {
          class: "sshAuthRequired",
          message: "SSH 认证需要用户输入",
          operation: "createSession",
          recovery: "userActionRequired",
          retryable: false,
          sshAuthPromptPlan: authPlan,
        },
      })
      .mockResolvedValueOnce({ id: "session-auth" });

    const { createSshTerminalSessionWithAuthRecovery } = await import(
      "../../../../src/features/terminal/XtermPane.sshAuthRecovery"
    );
    await expect(
      createSshTerminalSessionWithAuthRecovery(request, output, promptForSecret),
    ).resolves.toEqual({ id: "session-auth" });
    expect(mocks.inspectSshHostKey).not.toHaveBeenCalled();
    expect(mocks.submitSshAuthPromptResponse).toHaveBeenCalledWith({
      promptId: authPlan.prompts[0].promptId,
      secretKind: "password",
      value: "secret",
    });
  });

  it("continues the legacy auth prompt plan after host-key trust", async () => {
    const authPlan: SshAuthPromptPlan = {
      prompts: [
        {
          host: "dev.example.com",
          port: 22,
          promptId: "ssh-auth:target:deploy@dev.example.com:22:password",
          reason: "passwordPrompt",
          role: "target",
          secretKind: "password",
          username: "deploy",
        },
      ],
    };
    mocks.createSshTerminalSession
      .mockRejectedValueOnce(new Error("Unknown server key"))
      .mockRejectedValueOnce({
        terminalError: {
          class: "sshAuthRequired",
          message: "SSH 认证需要用户输入",
          operation: "createSession",
          recovery: "userActionRequired",
          retryable: false,
          sshAuthPromptPlan: authPlan,
        },
      })
      .mockResolvedValueOnce({ id: "session-host-key-and-auth" });
    mocks.inspectSshHostKey.mockResolvedValue(unknownInspection);
    mocks.requestSshHostKeyTrust.mockResolvedValue({
      ...unknownInspection,
      status: "known",
    });

    const { createSshTerminalSessionWithAuthRecovery } = await import(
      "../../../../src/features/terminal/XtermPane.sshAuthRecovery"
    );
    await expect(
      createSshTerminalSessionWithAuthRecovery(request, output, promptForSecret),
    ).resolves.toEqual({ id: "session-host-key-and-auth" });

    expect(mocks.inspectSshHostKey).toHaveBeenCalledTimes(1);
    expect(mocks.requestSshHostKeyTrust).toHaveBeenCalledTimes(1);
    expect(promptForSecret).toHaveBeenCalledWith(authPlan.prompts[0]);
    expect(mocks.submitSshAuthPromptResponse).toHaveBeenCalledWith({
      promptId: authPlan.prompts[0].promptId,
      secretKind: "password",
      value: "secret",
    });
    expect(mocks.createSshTerminalSession).toHaveBeenCalledTimes(3);
  });

  it("stops after an inspect that returns after the pane owner closes", async () => {
    let resolveInspection: ((inspection: SshHostKeyInspection) => void) | undefined;
    const deferredInspection = new Promise<SshHostKeyInspection>((resolve) => {
      resolveInspection = resolve;
    });
    let active = true;
    mocks.createSshTerminalSession.mockRejectedValueOnce(
      new Error("Unknown server key"),
    );
    mocks.inspectSshHostKey.mockReturnValue(deferredInspection);

    const { createSshTerminalSessionWithAuthRecovery } = await import(
      "../../../../src/features/terminal/XtermPane.sshAuthRecovery"
    );
    const pending = createSshTerminalSessionWithAuthRecovery(
      request,
      output,
      promptForSecret,
      { isPromptOwnerActive: () => active, promptOwnerId: "pane-closed" },
    );
    await vi.waitFor(() => expect(mocks.inspectSshHostKey).toHaveBeenCalled());
    active = false;
    resolveInspection?.(unknownInspection);

    await expect(pending).rejects.toThrow("SSH 主机身份确认已取消");
    expect(mocks.requestSshHostKeyTrust).not.toHaveBeenCalled();
    expect(mocks.createSshTerminalSession).toHaveBeenCalledTimes(1);
  });

  it("stops retrying after one accepted unknown-key recovery", async () => {
    mocks.createSshTerminalSession
      .mockRejectedValueOnce(new Error("Unknown server key"))
      .mockRejectedValueOnce(new Error("Unknown server key"));
    mocks.inspectSshHostKey.mockResolvedValue(unknownInspection);
    mocks.requestSshHostKeyTrust.mockResolvedValue({
      ...unknownInspection,
      status: "known",
    });

    const { createSshTerminalSessionWithAuthRecovery } = await import(
      "../../../../src/features/terminal/XtermPane.sshAuthRecovery"
    );
    await expect(
      createSshTerminalSessionWithAuthRecovery(request, output, promptForSecret),
    ).rejects.toThrow("Unknown server key");
    expect(mocks.inspectSshHostKey).toHaveBeenCalledTimes(1);
    expect(mocks.requestSshHostKeyTrust).toHaveBeenCalledTimes(1);
    expect(mocks.createSshTerminalSession).toHaveBeenCalledTimes(2);
  });
});
