// @author kongweiguang

import type {
  SshAuthPromptRequest,
  SshAuthPromptResponseRequest,
  SshAuthSecretKind,
} from "../../lib/sshAuthApi";

type SshAuthPromptFieldKind = "password" | "textarea";

export interface SshAuthPromptViewModel {
  canPersist: boolean;
  fieldKind: SshAuthPromptFieldKind;
  fieldLabel: string;
  helperText: string;
  persistLabel: string;
  targetLabel: string;
  title: string;
}

export interface BuildSshAuthPromptSubmitRequestInput {
  persistToHostId?: string;
  prompt: SshAuthPromptRequest;
  rememberInVault: boolean;
  value: string;
}

export function createSshAuthPromptViewModel(
  prompt: SshAuthPromptRequest,
  persistToHostId?: string,
): SshAuthPromptViewModel {
  const secretLabel = sshAuthSecretLabel(prompt.secretKind);
  return {
    canPersist: canPersistSshAuthPrompt(prompt, persistToHostId),
    fieldKind: sshAuthPromptFieldKind(prompt.secretKind),
    fieldLabel: secretLabel,
    helperText: createSshAuthPromptHelperText(prompt),
    persistLabel: "保存到 encrypted vault",
    targetLabel: `${prompt.username}@${prompt.host}:${prompt.port}`,
    title: `SSH ${secretLabel}`,
  };
}

export function buildSshAuthPromptSubmitRequest({
  persistToHostId,
  prompt,
  rememberInVault,
  value,
}: BuildSshAuthPromptSubmitRequestInput): SshAuthPromptResponseRequest {
  const trimmedPersistToHostId =
    rememberInVault && canPersistSshAuthPrompt(prompt, persistToHostId)
      ? persistToHostId?.trim()
      : undefined;
  return {
    ...(trimmedPersistToHostId ? { persistToHostId: trimmedPersistToHostId } : {}),
    promptId: prompt.promptId,
    secretKind: prompt.secretKind,
    value,
  };
}

export function validateSshAuthPromptValue(
  secretKind: SshAuthSecretKind,
  value: string,
) {
  if (!value.trim()) {
    return `${sshAuthSecretLabel(secretKind)}不能为空。`;
  }
  if (secretKind === "privateKey" && !looksLikePrivateKey(value)) {
    return "请输入完整私钥内容。";
  }
  return null;
}

export function canPersistSshAuthPrompt(
  prompt: SshAuthPromptRequest,
  persistToHostId?: string,
) {
  return (
    isTargetPrompt(prompt) &&
    Boolean(persistToHostId?.trim()) &&
    (prompt.secretKind === "password" ||
      prompt.secretKind === "privateKey" ||
      prompt.secretKind === "keyPassphrase")
  );
}

function sshAuthPromptFieldKind(
  secretKind: SshAuthSecretKind,
): SshAuthPromptFieldKind {
  return secretKind === "privateKey" ? "textarea" : "password";
}

export function formatSshAuthPromptError(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "SSH 认证失败。";
}

function createSshAuthPromptHelperText(prompt: SshAuthPromptRequest) {
  const role = isTargetPrompt(prompt) ? "目标主机" : "跳板机";
  return `${role}需要${sshAuthSecretLabel(prompt.secretKind)}。`;
}

function isTargetPrompt(prompt: SshAuthPromptRequest) {
  return prompt.role === "target";
}

function looksLikePrivateKey(value: string) {
  return /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/.test(value);
}

function sshAuthSecretLabel(secretKind: SshAuthSecretKind) {
  switch (secretKind) {
    case "password":
      return "密码";
    case "privateKey":
      return "私钥";
    case "keyPassphrase":
      return "私钥 passphrase";
  }
}
