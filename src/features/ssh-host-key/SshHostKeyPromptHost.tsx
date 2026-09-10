// @author kongweiguang

import { useCallback, useEffect, useRef, useState } from "react";
import { trustSshHostKey } from "../../lib/sshHostKeyApi";
import { SshHostKeyPromptDialog } from "./SshHostKeyPromptDialog";
import {
  cancelSshHostKeyPrompt,
  completeSshHostKeyPrompt,
  failSshHostKeyPrompt,
  type SshHostKeyPromptStore,
  useCurrentSshHostKeyPrompt,
} from "./sshHostKeyPromptStore";
import {
  formatSshHostKeyPromptError,
  validateTrustedSshHostKey,
} from "./sshHostKeyPromptModel";

/**
 * 全局消费 host-key 确认队列；每次 trust 返回都按当前 queue id 校验，避免旧请求晚到后污染新目标。
 */
export function SshHostKeyPromptHost({
  store,
}: {
  store?: SshHostKeyPromptStore;
}) {
  const current = useCurrentSshHostKeyPrompt(store);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currentPromptIdRef = useRef<string | null>(null);
  currentPromptIdRef.current = current?.id ?? null;

  useEffect(() => {
    currentPromptIdRef.current = current?.id ?? null;
    setBusy(false);
    setError(null);
  }, [current?.id]);

  /** 只允许取消当前仍处于 unknown 且未提交的确认，避免绕过 busy 状态结束请求。 */
  const closePrompt = useCallback(() => {
    if (!current || busy || current.options.inspection.status !== "unknown") {
      return;
    }
    (store?.cancel ?? cancelSshHostKeyPrompt)(current.id);
  }, [busy, current, store]);

  /** 提交前再次检查 busy 与 unknown，防止重复点击或非法调用触发 trust 副作用。 */
  const submitPrompt = useCallback(async () => {
    if (!current || busy || current.options.inspection.status !== "unknown") {
      return;
    }
    setBusy(true);
    setError(null);
    const expected = current.options.inspection;
    try {
      const trusted = await trustSshHostKey({
        expectedFingerprint: expected.fingerprint,
        hostId: expected.hostId,
      });
      if (currentPromptIdRef.current !== current.id) {
        return;
      }
      const validationError = validateTrustedSshHostKey(expected, trusted);
      if (validationError) {
        throw new Error(validationError);
      }
      (store?.complete ?? completeSshHostKeyPrompt)(current.id, trusted);
    } catch (nextError) {
      if (currentPromptIdRef.current !== current.id) {
        return;
      }
      const message = formatSshHostKeyPromptError(nextError);
      setError(message);
      // The request remains visible after a transient trust error, but a changed key is
      // terminal for this prompt and must not be retried through the same confirmation.
      if (isTerminalHostKeyError(message)) {
        (store?.fail ?? failSshHostKeyPrompt)(current.id, new Error(message));
      }
    } finally {
      if (currentPromptIdRef.current === current.id) {
        setBusy(false);
      }
    }
  }, [busy, current, store]);

  return (
    <SshHostKeyPromptDialog
      busy={busy}
      error={error}
      inspection={current?.options.inspection ?? null}
      onClose={closePrompt}
      onSubmit={() => void submitPrompt()}
      open={Boolean(current)}
    />
  );
}

/** 后端明确拒绝 key 变化/绑定不一致时结束当前请求，不允许在同一确认上循环尝试。 */
function isTerminalHostKeyError(message: string) {
  return /主机.*(?:变化|不一致)|(?:host key|fingerprint).*(?:changed|mismatch)/i.test(
    message,
  );
}
