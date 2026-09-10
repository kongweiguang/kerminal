// @author kongweiguang

import {
  getTerminalCommandError,
  createSshTerminalSession,
  type SshTerminalCreateRequest,
  type TerminalOutputEvent,
  type TerminalSessionSummary,
} from "../../lib/terminalApi";
import {
  submitSshAuthPromptResponse,
  type SshAuthPromptPlan,
  type SshAuthPromptRequest,
} from "../../lib/sshAuthApi";
import { requestSshAuthPrompt } from "../ssh-auth/state/index";
import {
  inspectSshHostKey,
  type SshHostKeyInspection,
} from "../../lib/sshHostKeyApi";
import {
  requestSshHostKeyTrust,
  validateTrustedSshHostKey,
} from "../ssh-host-key/state/index";
import { classifySshTerminalFailure } from "./terminalSshFailurePolicy";

const SSH_AUTH_TERMINAL_PROMPT_MAX_RETRIES = 1;
const SSH_HOST_KEY_RECOVERY_MAX_RETRIES = 1;

export interface SshTerminalSessionRecoveryOptions {
  isPromptOwnerActive?: () => boolean;
  promptOwnerId?: string;
}

/**
 * SSH session 创建失败时按错误类型恢复：认证只按 prompt plan 重试一次，未知主机 key
 * 先做只读 inspection，再经过全局确认队列和二次 fingerprint 校验后有限重试一次。
 * 两类计数分开，保证密码恢复仍可工作，同时任何异常组合都不会形成无限重试。
 */
export async function createSshTerminalSessionWithAuthRecovery(
  request: SshTerminalCreateRequest,
  onOutput: (event: TerminalOutputEvent) => void,
  promptForSecret: (prompt: SshAuthPromptRequest) => Promise<string | null>,
  options: SshTerminalSessionRecoveryOptions = {},
): Promise<TerminalSessionSummary> {
  let authAttempts = 0;
  let hostKeyAttempts = 0;
  for (;;) {
    // 每轮创建前重查 generation；关闭发生在 inspect/auth await 期间时不得再启动 session。
    ensurePromptOwnerActive(options, undefined);
    try {
      return await createSshTerminalSession(request, onOutput);
    } catch (error) {
      const promptPlan = sshAuthPromptPlanFromTerminalError(error);
      if (promptPlan) {
        if (authAttempts >= SSH_AUTH_TERMINAL_PROMPT_MAX_RETRIES) {
          throw error;
        }
        authAttempts += 1;
        const completed = await runSshTerminalAuthPromptPlan(
          promptPlan,
          request.hostId,
          promptForSecret,
        );
        if (!completed) {
          throw cancellationError("SSH 认证已取消。", error);
        }
        continue;
      }

      if (!isUnknownHostKeyFailure(error)) {
        throw error;
      }

      if (hostKeyAttempts >= SSH_HOST_KEY_RECOVERY_MAX_RETRIES) {
        throw error;
      }
      ensurePromptOwnerActive(options, error);
      hostKeyAttempts += 1;
      const inspection = await inspectSshHostKey({ hostId: request.hostId });
      // inspect 可能在 pane 关闭前已发出、关闭后才返回，必须在入队或重试前再次拦截。
      ensurePromptOwnerActive(options, error);
      validateHostKeyInspection(request.hostId, inspection);
      if (inspection.status === "changed") {
        throw errorWithCause("SSH 主机密钥已变化，已拒绝连接。", error);
      }
      if (inspection.status === "unknown") {
        const trusted = await requestSshHostKeyTrust({
          inspection,
          ownerId: options.promptOwnerId,
        });
        if (!trusted) {
          throw cancellationError("SSH 主机身份确认已取消。", error);
        }
        ensurePromptOwnerActive(options, error);
        const validationError = validateTrustedSshHostKey(inspection, trusted);
        if (validationError) {
          throw errorWithCause(validationError, error);
        }
      }
      // known 状态无需写入 known_hosts，但仍允许一次有限重试以覆盖策略/连接竞态。
    }
  }
}

/** 只有 failure policy 明确识别为未知 server key 时才启动 host-key 探测。 */
function isUnknownHostKeyFailure(error: unknown): boolean {
  const terminalError = getTerminalCommandError(error);
  const wrappedTerminalError =
    !terminalError && isRecord(error) && isRecord(error.terminalError)
      ? error.terminalError
      : null;
  const candidateMessage =
    (terminalError ?? wrappedTerminalError)?.message ??
    errorMessageFromUnknown(error);
  const message =
    typeof candidateMessage === "string"
      ? candidateMessage
      : errorMessageFromUnknown(error);
  return (
    (String(terminalError?.class) === "sshHostKeyUnknown") ||
    classifySshTerminalFailure(message)?.class === "unknownHostKey"
  );
}

/** 后端返回的 host-key inspection 必须仍绑定当前 host，不能盲信 typed IPC payload。 */
function validateHostKeyInspection(
  hostId: string,
  inspection: SshHostKeyInspection,
) {
  if (
    !isRecord(inspection) ||
    inspection.hostId !== hostId ||
    typeof inspection.host !== "string" ||
    !inspection.host.trim() ||
    typeof inspection.algorithm !== "string" ||
    !inspection.algorithm.trim() ||
    typeof inspection.fingerprint !== "string" ||
    !inspection.fingerprint.startsWith("SHA256:") ||
    !["known", "unknown", "changed"].includes(inspection.status)
  ) {
    throw new Error("SSH 主机身份结果无效，已拒绝连接。");
  }
}

/** Pane 销毁或 generation 切换时，阻止晚到的 inspection/trust 结果继续重试连接。 */
function ensurePromptOwnerActive(
  options: SshTerminalSessionRecoveryOptions,
  cause: unknown,
) {
  if (options.isPromptOwnerActive && !options.isPromptOwnerActive()) {
    throw cancellationError("SSH 主机身份确认已取消。", cause);
  }
}

/** 创建带原始失败原因的取消错误，保留 UI 现有的失败展示链。 */
function cancellationError(message: string, cause: unknown) {
  return errorWithCause(message, cause);
}

/** 保留原始 IPC/SSH 失败，便于错误展示链和诊断区分阻断原因与恢复阶段。 */
function errorWithCause(message: string, cause: unknown) {
  const error = new Error(message);
  Object.defineProperty(error, "cause", {
    configurable: true,
    value: cause,
    writable: true,
  });
  return error;
}

/** 兼容旧版/非结构化 invoke rejection，供 failure policy 做脱敏字符串分类。 */
function errorMessageFromUnknown(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  if (isRecord(error) && typeof error.message === "string") {
    return error.message;
  }
  return String(error);
}

async function runSshTerminalAuthPromptPlan(
  promptPlan: SshAuthPromptPlan,
  hostId: string,
  promptForSecret: (prompt: SshAuthPromptRequest) => Promise<string | null>,
) {
  for (const prompt of promptPlan.prompts) {
    if (shouldReadSshAuthPromptInTerminal(prompt)) {
      const value = await promptForSecret(prompt);
      if (!value) {
        return false;
      }
      await submitSshAuthPromptResponse({
        promptId: prompt.promptId,
        secretKind: prompt.secretKind,
        value,
      });
      continue;
    }
    const receipt = await requestSshAuthPrompt({
      ...(prompt.role === "target" ? { persistToHostId: hostId } : {}),
      prompt,
    });
    if (!receipt) {
      return false;
    }
  }
  return true;
}

function shouldReadSshAuthPromptInTerminal(prompt: SshAuthPromptRequest) {
  return prompt.secretKind === "password" || prompt.secretKind === "keyPassphrase";
}

function sshAuthPromptPlanFromTerminalError(
  error: unknown,
): SshAuthPromptPlan | null {
  const terminalError = getTerminalCommandError(error);
  if (terminalError?.sshAuthPromptPlan) {
    return isSshAuthPromptPlan(terminalError.sshAuthPromptPlan)
      ? terminalError.sshAuthPromptPlan
      : null;
  }

  const wrappedTerminalError =
    isRecord(error) && isRecord(error.terminalError)
      ? error.terminalError
      : null;
  const wrappedPromptPlan = wrappedTerminalError?.sshAuthPromptPlan;
  return isSshAuthPromptPlan(wrappedPromptPlan) ? wrappedPromptPlan : null;
}

function isSshAuthPromptPlan(value: unknown): value is SshAuthPromptPlan {
  if (!isRecord(value) || !Array.isArray(value.prompts)) {
    return false;
  }
  return value.prompts.every(isSshAuthPromptRequest);
}

function isSshAuthPromptRequest(value: unknown): value is SshAuthPromptRequest {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.host === "string" &&
    typeof value.port === "number" &&
    typeof value.promptId === "string" &&
    typeof value.reason === "string" &&
    isSshAuthPromptRole(value.role) &&
    isSshSecretKind(value.secretKind) &&
    typeof value.username === "string"
  );
}

function isSshAuthPromptRole(value: unknown) {
  return (
    value === "target" ||
    (isRecord(value) &&
      isRecord(value.jump) &&
      typeof value.jump.index === "number")
  );
}

function isSshSecretKind(value: unknown) {
  return (
    value === "password" ||
    value === "privateKey" ||
    value === "keyPassphrase"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
