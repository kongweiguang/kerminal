// @author kongweiguang

import { describe, expect, it } from "vitest";
import type { SshAuthPromptRequest } from "../../../../src/lib/sshAuthApi";
import {
  buildSshAuthPromptSubmitRequest,
  canPersistSshAuthPrompt,
  createSshAuthPromptViewModel,
  validateSshAuthPromptValue,
} from "../../../../src/features/ssh-auth/sshAuthPromptModel";

const targetPasswordPrompt: SshAuthPromptRequest = {
  host: "dev.example.com",
  port: 22,
  promptId: "ssh-auth:target:kong@dev.example.com:22:password",
  reason: "target password is not stored",
  role: "target",
  secretKind: "password",
  username: "kong",
};

describe("sshAuthPromptModel", () => {
  it("builds target password prompt view state", () => {
    const model = createSshAuthPromptViewModel(targetPasswordPrompt, "host-1");

    expect(model).toMatchObject({
      canPersist: true,
      fieldKind: "password",
      fieldLabel: "密码",
      targetLabel: "kong@dev.example.com:22",
      title: "SSH 密码",
    });
  });

  it("allows every target SSH secret kind to persist", () => {
    expect(canPersistSshAuthPrompt(targetPasswordPrompt, "host-1")).toBe(true);
    expect(
      canPersistSshAuthPrompt(
        {
          ...targetPasswordPrompt,
          role: { jump: { index: 0 } },
        },
        "host-1",
      ),
    ).toBe(false);
    expect(
      canPersistSshAuthPrompt(
        {
          ...targetPasswordPrompt,
          secretKind: "keyPassphrase",
        },
        "host-1",
      ),
    ).toBe(true);
    expect(canPersistSshAuthPrompt(targetPasswordPrompt)).toBe(false);
  });

  it("builds submit request without leaking persistence when disabled", () => {
    expect(
      buildSshAuthPromptSubmitRequest({
        persistToHostId: "host-1",
        prompt: targetPasswordPrompt,
        rememberInVault: true,
        value: "secret-password",
      }),
    ).toEqual({
      persistToHostId: "host-1",
      promptId: targetPasswordPrompt.promptId,
      secretKind: "password",
      value: "secret-password",
    });

    expect(
      buildSshAuthPromptSubmitRequest({
        persistToHostId: "host-1",
        prompt: targetPasswordPrompt,
        rememberInVault: false,
        value: "secret-password",
      }),
    ).toEqual({
      promptId: targetPasswordPrompt.promptId,
      secretKind: "password",
      value: "secret-password",
    });
  });

  it("validates empty secrets and incomplete private keys", () => {
    expect(validateSshAuthPromptValue("password", " ")).toBe("密码不能为空。");
    expect(validateSshAuthPromptValue("privateKey", "abc")).toBe(
      "请输入完整私钥内容。",
    );
    expect(
      validateSshAuthPromptValue(
        "privateKey",
        "-----BEGIN OPENSSH PRIVATE KEY-----\nsecret\n-----END OPENSSH PRIVATE KEY-----",
      ),
    ).toBeNull();
  });
});
