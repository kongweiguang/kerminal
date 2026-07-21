// @author kongweiguang

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui/button";
import { ModalShell } from "../../components/ui/modal-shell";
import { UserFacingNotice } from "../../components/ui/user-facing-notice";
import {
  ackExternalSshLaunch,
  cancelExternalSshLaunch,
  inspectExternalLaunchHostKey,
  listenExternalSshLaunches,
  materializeExternalSshLaunch,
  takePendingExternalSshLaunches,
  trustExternalLaunchHostKey,
  type ExternalHostKeyInspection,
  type ExternalLaunchMaterializedTarget,
  type ExternalSshLaunchRequest,
} from "../../lib/externalLaunchApi";
import {
  buildUserFacingError,
  type UserFacingMessage,
} from "../../lib/userFacingMessage";
import { requestSshAuthPrompt } from "../ssh-auth/sshAuthPromptStore";
import { useWorkspaceStore } from "../workspace/state/index";
import { ExternalLaunchResolutionDialog } from "./ExternalLaunchResolutionDialog";
import {
  applyExternalSshLaunchMaterializedTarget,
  externalSshLaunchMachineId,
  externalSshLaunchNeedsUsername,
  externalSshLaunchSourceLabel,
  type ExternalSshLaunchResolvedRequest,
} from "./externalSshLaunchModel";

interface ExternalLaunchFailure {
  launch: ExternalSshLaunchResolvedRequest;
  message: UserFacingMessage;
}

interface ExternalLaunchNotice {
  message: UserFacingMessage;
}

interface ExternalLaunchSecurityConfirmation {
  hostKey: ExternalHostKeyInspection;
  launch: ExternalSshLaunchResolvedRequest;
  materialized: ExternalLaunchMaterializedTarget;
}

export function ExternalLaunchHost() {
  const openExternalSshLaunch = useWorkspaceStore(
    (state) => state.openExternalSshLaunch,
  );
  const openExternalSftpLaunch = useWorkspaceStore(
    (state) => state.openExternalSftpLaunch,
  );
  const openResolvedLaunch = useCallback(
    (launch: ExternalSshLaunchResolvedRequest) => {
      if (launch.intent?.kind === "sftpTransfer") {
        openExternalSftpLaunch(launch);
      } else {
        openExternalSshLaunch(launch);
      }
    },
    [openExternalSftpLaunch, openExternalSshLaunch],
  );
  const [queue, setQueue] = useState<ExternalSshLaunchRequest[]>([]);
  const [resolutionLaunch, setResolutionLaunch] =
    useState<ExternalSshLaunchRequest | null>(null);
  const [failedLaunch, setFailedLaunch] = useState<ExternalLaunchFailure | null>(
    null,
  );
  const [notice, setNotice] = useState<ExternalLaunchNotice | null>(null);
  const [securityConfirmation, setSecurityConfirmation] =
    useState<ExternalLaunchSecurityConfirmation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<UserFacingMessage | null>(null);
  const activeRef = useRef(true);
  const processingLaunchIdRef = useRef<string | null>(null);
  const knownLaunchIdsRef = useRef(new Set<string>());
  const enqueueLaunches = useCallback(
    (launches: ExternalSshLaunchRequest[]) => {
      if (!activeRef.current || launches.length === 0) {
        return;
      }
      const next: ExternalSshLaunchRequest[] = [];
      for (const launch of launches) {
        if (knownLaunchIdsRef.current.has(launch.id)) {
          continue;
        }
        knownLaunchIdsRef.current.add(launch.id);
        // WebView 重载后工作区 pane 仍可能存在，此时只补 ACK，不能重复物化和建 pane。
        const alreadyOpened = isExternalLaunchOpen(launch);
        if (alreadyOpened) {
          void ackExternalSshLaunch(launch.id).catch((nextError) => {
            if (!activeRef.current) {
              return;
            }
            const message = buildUserFacingError(nextError, {
              detail: "已打开的外部 SSH 请求尚未完成确认。",
              recoveryAction: "Kerminal 将在请求租约到期后再次恢复。",
              title: "外部 SSH 请求未确认",
            });
            setError(message);
            setNotice({ message });
          });
          continue;
        }
        next.push(launch);
      }
      if (next.length > 0) {
        setQueue((current) => [...current, ...next]);
      }
    },
    [],
  );

  const drainPendingLaunches = useCallback(async () => {
    try {
      const launches = await takePendingExternalSshLaunches();
      if (activeRef.current) {
        enqueueLaunches(launches);
      }
    } catch (nextError) {
      if (!activeRef.current) {
        return;
      }
      const message = buildUserFacingError(nextError, {
        detail: "Kerminal 暂时无法读取待处理的外部 SSH 请求。",
        recoveryAction: "请重新发起连接请求。",
        title: "外部 SSH 请求未读取",
      });
      setError(message);
      setNotice({ message });
    }
  }, [enqueueLaunches]);

  const openAndAckLaunch = useCallback(
    async (launch: ExternalSshLaunchResolvedRequest) => {
      processingLaunchIdRef.current = launch.id;
      setBusy(true);
      setError(null);
      setFailedLaunch(null);
      setNotice(null);
      try {
        // ACK 失败后 pane 已存在时只补确认，避免重试再次建 pane 和执行远程命令。
        if (isExternalLaunchOpen(launch)) {
          await ackExternalSshLaunch(launch.id);
          return;
        }
        const materialized = await materializeExternalLaunchWithPrompts(launch);
        validateMaterializedTarget(launch, materialized);
        if (!activeRef.current) {
          return;
        }
        const resolved = applyExternalSshLaunchMaterializedTarget(
          launch,
          materialized,
        );
        const hostKey = await inspectExternalLaunchHostKey(launch.id);
        validateHostKeyInspection(resolved, materialized, hostKey);
        validateVendorHostKeyAssertion(resolved, hostKey);
        if (!activeRef.current) {
          return;
        }
        if (hostKey.status === "changed") {
          throw new Error(
            "SSH 主机密钥已变化。请先核验目标身份并处理 known_hosts 冲突。",
          );
        }
        if (
          hostKey.status === "unknown" ||
          materialized.safety !== "known-non-production" ||
          Boolean(resolved.options.remoteCommand?.trim()) ||
          resolved.source.entrypoint === "protocol"
        ) {
          setSecurityConfirmation({ hostKey, launch: resolved, materialized });
          return;
        }
        if (!isExternalLaunchOpen(resolved)) {
          openResolvedLaunch(resolved);
        }
        await ackExternalSshLaunch(launch.id);
      } catch (nextError) {
        if (!activeRef.current) {
          return;
        }
        const message = buildUserFacingError(nextError, {
          detail: "该请求尚未打开。",
          recoveryAction: "可重试或取消该请求。",
          title: "外部 SSH 启动失败",
        });
        setError(message);
        setFailedLaunch({ launch, message });
      } finally {
        processingLaunchIdRef.current = null;
        if (activeRef.current) {
          setBusy(false);
        }
      }
    },
    [openResolvedLaunch],
  );

  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const startDelivery = async () => {
      try {
        const nextUnlisten = await listenExternalSshLaunches((payload) => {
          if (!activeRef.current) {
            return;
          }
          if (payload.kind === "queued") {
            void drainPendingLaunches();
          } else if (payload.message) {
            const message = buildUserFacingError(payload.message, {
              detail: "启动请求未通过接收校验。",
              recoveryAction: "请检查来源参数后重试。",
              title: "外部 SSH 请求未接收",
            });
            setError(message);
            setNotice({ message });
          }
        });
        if (disposed) {
          nextUnlisten();
          return;
        }
        unlisten = nextUnlisten;

        // listener ready 后双重 drain，封闭订阅建立前后事件交错造成的 lost-wakeup 窗口。
        await drainPendingLaunches();
        await Promise.resolve();
        if (!disposed) {
          await drainPendingLaunches();
        }
      } catch (nextError) {
        if (disposed) {
          return;
        }
        const message = buildUserFacingError(nextError, {
          detail: "Kerminal 暂时无法监听外部 SSH 请求。",
          recoveryAction: "请重新发起连接请求。",
          title: "外部 SSH 请求未接收",
        });
        setError(message);
        setNotice({ message });
      }
    };
    void startDelivery();
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [drainPendingLaunches]);

  useEffect(() => {
    if (
      busy ||
      resolutionLaunch ||
      securityConfirmation ||
      queue.length === 0 ||
      processingLaunchIdRef.current
    ) {
      return;
    }
    const nextLaunch = queue[0];
    if (!nextLaunch) {
      return;
    }
    setQueue(queue.slice(1));
    setError(null);
    setFailedLaunch(null);
    setNotice(null);
    if (externalSshLaunchNeedsUsername(nextLaunch)) {
      setResolutionLaunch(nextLaunch);
      return;
    }
    void openAndAckLaunch(nextLaunch as ExternalSshLaunchResolvedRequest);
  }, [busy, openAndAckLaunch, queue, resolutionLaunch, securityConfirmation]);

  const confirmSecurity = useCallback(async () => {
    if (!securityConfirmation || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (securityConfirmation.hostKey.status === "unknown") {
        const trustedHostKey = await trustExternalLaunchHostKey(
          securityConfirmation.launch.id,
          securityConfirmation.hostKey.fingerprint,
        );
        validateTrustedHostKey(
          securityConfirmation,
          trustedHostKey,
          securityConfirmation.hostKey.fingerprint,
        );
        if (!activeRef.current) {
          return;
        }
        setSecurityConfirmation((current) =>
          current?.launch.id === securityConfirmation.launch.id
            ? { ...current, hostKey: trustedHostKey }
            : current,
        );
      }
      if (!activeRef.current) {
        return;
      }
      if (!isExternalLaunchOpen(securityConfirmation.launch)) {
        openResolvedLaunch(securityConfirmation.launch);
      }
      await ackExternalSshLaunch(securityConfirmation.launch.id);
      if (activeRef.current) {
        setSecurityConfirmation(null);
      }
    } catch (nextError) {
      if (!activeRef.current) {
        return;
      }
      setError(
        buildUserFacingError(nextError, {
          detail: "主机身份或远程命令尚未确认。",
          recoveryAction: "重新核对 fingerprint 和目标后再试。",
          title: "外部 SSH 安全确认失败",
        }),
      );
    } finally {
      if (activeRef.current) {
        setBusy(false);
      }
    }
  }, [busy, openResolvedLaunch, securityConfirmation]);

  const cancelSecurity = useCallback(async () => {
    if (!securityConfirmation || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await cancelExternalSshLaunch(securityConfirmation.launch.id);
      if (activeRef.current) {
        setSecurityConfirmation(null);
      }
    } catch (nextError) {
      if (!activeRef.current) {
        return;
      }
      setError(
        buildUserFacingError(nextError, {
          detail: "该外部 SSH 请求仍在待处理列表中。",
          recoveryAction: "请稍后再次取消。",
          title: "请求未取消",
        }),
      );
    } finally {
      if (activeRef.current) {
        setBusy(false);
      }
    }
  }, [busy, securityConfirmation]);

  const cancelResolution = useCallback(async () => {
    if (!resolutionLaunch || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await cancelExternalSshLaunch(resolutionLaunch.id);
      if (activeRef.current) {
        setResolutionLaunch(null);
      }
    } catch (nextError) {
      if (!activeRef.current) {
        return;
      }
      setError(
        buildUserFacingError(nextError, {
          detail: "该外部 SSH 请求仍在待处理列表中。",
          recoveryAction: "请稍后再次取消。",
          title: "请求未取消",
        }),
      );
    } finally {
      if (activeRef.current) {
        setBusy(false);
      }
    }
  }, [busy, resolutionLaunch]);

  const resolveLaunch = useCallback(
    (launch: ExternalSshLaunchResolvedRequest) => {
      setResolutionLaunch(null);
      setNotice(null);
      void openAndAckLaunch(launch);
    },
    [openAndAckLaunch],
  );

  const retryFailedLaunch = useCallback(() => {
    if (!failedLaunch || busy) {
      return;
    }
    const launch = failedLaunch.launch;
    setFailedLaunch(null);
    setNotice(null);
    void openAndAckLaunch(launch);
  }, [busy, failedLaunch, openAndAckLaunch]);

  const cancelFailedLaunch = useCallback(async () => {
    if (!failedLaunch || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await cancelExternalSshLaunch(failedLaunch.launch.id);
      if (activeRef.current) {
        setFailedLaunch(null);
      }
    } catch (nextError) {
      if (!activeRef.current) {
        return;
      }
      setFailedLaunch({
        ...failedLaunch,
        message: buildUserFacingError(nextError, {
          detail: "该外部 SSH 请求仍在待处理列表中。",
          recoveryAction: "请稍后再次取消。",
          title: "请求未取消",
        }),
      });
    } finally {
      if (activeRef.current) {
        setBusy(false);
      }
    }
  }, [busy, failedLaunch]);

  return (
    <>
      <ExternalLaunchResolutionDialog
        busy={busy}
        error={resolutionLaunch ? error : null}
        launch={resolutionLaunch}
        onCancel={() => void cancelResolution()}
        onResolve={resolveLaunch}
        open={Boolean(resolutionLaunch)}
      />
      <ExternalLaunchSecurityDialog
        busy={busy}
        confirmation={securityConfirmation}
        error={securityConfirmation ? error : null}
        onCancel={() => void cancelSecurity()}
        onConfirm={() => void confirmSecurity()}
      />
      <ExternalLaunchFailureDialog
        busy={busy}
        failure={failedLaunch}
        onCancel={() => void cancelFailedLaunch()}
        onRetry={retryFailedLaunch}
      />
      <ExternalLaunchNoticeDialog
        notice={notice}
        onClose={() => setNotice(null)}
      />
    </>
  );
}

function isExternalLaunchOpen(
  launch: ExternalSshLaunchRequest | ExternalSshLaunchResolvedRequest,
): boolean {
  const machineId = externalSshLaunchMachineId(launch);
  const state = useWorkspaceStore.getState();
  return launch.intent?.kind === "sftpTransfer"
    ? state.terminalTabs.some(
        (tab) =>
          tab.kind === "sftpTransfer" && tab.externalLaunchId === launch.id,
      )
    : state.terminalPanes.some((pane) => pane.machineId === machineId);
}

async function materializeExternalLaunchWithPrompts(
  launch: ExternalSshLaunchResolvedRequest,
): Promise<ExternalLaunchMaterializedTarget> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const outcome = await materializeExternalSshLaunch({
      launchId: launch.id,
      username: launch.target.username,
    });
    if (!("status" in outcome)) {
      return outcome as unknown as ExternalLaunchMaterializedTarget;
    }
    if (outcome.status === "ready") {
      return outcome.target;
    }
    if (outcome.status === "rejected") {
      throw new Error(outcome.message);
    }
    for (const prompt of outcome.promptPlan.prompts) {
      const receipt = await requestSshAuthPrompt({
        defaultRememberInVault: false,
        prompt,
      });
      if (!receipt) {
        throw new Error("SSH 认证已取消，该外部启动请求尚未打开。");
      }
    }
  }
  throw new Error("SSH 认证未能完成，请检查凭据类型后重试。");
}

/**
 * 后端物化结果必须仍绑定当前 requestId，并保持 safety/production 不变量。
 * 这是前端最后一道过期响应防线，不能让旧请求或降级后的安全级别进入工作区。
 */
function validateMaterializedTarget(
  launch: ExternalSshLaunchResolvedRequest,
  materialized: ExternalLaunchMaterializedTarget,
): void {
  const expectedTargetId = externalSshLaunchMachineId(launch);
  const validSafety = [
    "restricted-unknown",
    "known-non-production",
    "production",
  ].includes(materialized.safety);
  const validAuthType = ["password", "key", "agent"].includes(
    materialized.authType,
  );
  const expectedProduction = materialized.safety !== "known-non-production";
  if (
    !validSafety ||
    !validAuthType ||
    materialized.launchId !== launch.id ||
    materialized.targetId !== expectedTargetId ||
    !materialized.host.trim() ||
    !Number.isInteger(materialized.port) ||
    materialized.port < 1 ||
    materialized.port > 65_535 ||
    materialized.production !== expectedProduction
  ) {
    throw new Error("物化目标与当前启动请求不一致，已拒绝连接。");
  }
}

/** 主机身份确认必须精确绑定本次物化后的 host、port 和 launch。 */
function validateHostKeyInspection(
  launch: ExternalSshLaunchResolvedRequest,
  materialized: ExternalLaunchMaterializedTarget,
  inspection: ExternalHostKeyInspection,
): void {
  const validStatus = ["known", "unknown", "changed"].includes(
    inspection.status,
  );
  if (
    !validStatus ||
    inspection.launchId !== launch.id ||
    inspection.host !== materialized.host ||
    inspection.port !== materialized.port ||
    !inspection.algorithm.trim() ||
    !inspection.fingerprint.startsWith("SHA256:")
  ) {
    throw new Error("主机身份结果与当前启动请求不一致，已拒绝连接。");
  }
}

function validateVendorHostKeyAssertion(
  launch: ExternalSshLaunchResolvedRequest,
  inspection: ExternalHostKeyInspection,
): void {
  if (launch.intent?.kind !== "sftpTransfer") {
    return;
  }
  const assertion = launch.intent.hostKeyAssertion?.trim();
  if (!assertion) {
    return;
  }
  const fingerprint = assertion.match(/SHA256:[A-Za-z0-9+/_=-]+/)?.[0];
  if (!fingerprint || fingerprint !== inspection.fingerprint) {
    throw new Error("外部 SFTP 参数中的主机指纹与 Kerminal 二次探测结果不匹配。");
  }
}

function validateTrustedHostKey(
  confirmation: ExternalLaunchSecurityConfirmation,
  trusted: ExternalHostKeyInspection,
  expectedFingerprint: string,
): void {
  validateHostKeyInspection(
    confirmation.launch,
    confirmation.materialized,
    trusted,
  );
  if (
    trusted.status !== "known" ||
    trusted.fingerprint !== expectedFingerprint
  ) {
    throw new Error("主机指纹确认结果已变化，已拒绝连接。");
  }
}

function ExternalLaunchSecurityDialog({
  busy,
  confirmation,
  error,
  onCancel,
  onConfirm,
}: {
  busy: boolean;
  confirmation: ExternalLaunchSecurityConfirmation | null;
  error: UserFacingMessage | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!confirmation) {
    return null;
  }
  const { hostKey, launch, materialized } = confirmation;
  const remoteCommand = launch.options.remoteCommand?.trim();
  return (
    <ModalShell
      description={`${launch.target.username}@${hostKey.host}:${hostKey.port}`}
      footer={
        <>
          <Button disabled={busy} onClick={onCancel} size="sm" variant="ghost">
            取消该请求
          </Button>
          <Button disabled={busy} onClick={onConfirm} size="sm" type="button">
            {hostKey.status === "unknown" ? "信任并连接" : "确认并连接"}
          </Button>
        </>
      }
      maxWidthClassName="max-w-xl"
      onClose={onCancel}
      open
      size="small"
      title="确认外部 SSH 目标"
    >
      <div className="space-y-3 text-[13px] text-[var(--text-secondary)]">
        <div className="divide-y divide-[var(--border-subtle)] overflow-hidden rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--surface-content)]">
          {hostKey.status === "unknown" ? (
            <div className="px-3 py-2.5">
              <div className="font-medium text-[var(--text-primary)]">
                首次连接主机指纹
              </div>
              <div className="mt-1 text-xs">{hostKey.algorithm}</div>
              <div className="mt-1 break-all font-mono text-xs text-[var(--text-primary)]">
                {hostKey.fingerprint}
              </div>
            </div>
          ) : null}
          {materialized.safety === "production" ? (
            <div className="bg-amber-500/10 px-3 py-2.5 text-amber-800 dark:text-amber-100">
              <div className="font-medium">生产目标</div>
              <div className="mt-1 text-xs">
                该连接按生产主机保护，确认后才会创建终端。
              </div>
            </div>
          ) : null}
          {materialized.safety === "restricted-unknown" ? (
            <div className="bg-amber-500/10 px-3 py-2.5 text-amber-800 dark:text-amber-100">
              <div className="font-medium">受限的未知目标</div>
              <div className="mt-1 text-xs">
                该目标未精确匹配已保存的非生产主机，默认按受限目标保护。
              </div>
            </div>
          ) : null}
          {launch.source.entrypoint === "protocol" ? (
            <div className="px-3 py-2.5">
              <div className="font-medium text-[var(--text-primary)]">
                系统协议链接
              </div>
              <div className="mt-1 text-xs">
                此请求由外部链接发起，请确认目标与来源符合预期。
              </div>
            </div>
          ) : null}
          {remoteCommand ? (
            <div className="px-3 py-2.5">
              <div className="font-medium text-[var(--text-primary)]">
                连接后执行命令
              </div>
              <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-all rounded-[var(--radius-control)] bg-[var(--surface-field)] p-2 font-mono text-xs">
                {remoteCommand}
              </pre>
            </div>
          ) : null}
        </div>
        {error ? <UserFacingNotice message={error} /> : null}
      </div>
    </ModalShell>
  );
}

function ExternalLaunchNoticeDialog({
  notice,
  onClose,
}: {
  notice: ExternalLaunchNotice | null;
  onClose: () => void;
}) {
  if (!notice) {
    return null;
  }

  return (
    <ModalShell
      footer={
        <Button onClick={onClose} size="sm" type="button">
          知道了
        </Button>
      }
      maxWidthClassName="max-w-lg"
      onClose={onClose}
      open
      size="small"
      title="外部 SSH 启动未接收"
    >
      <UserFacingNotice message={notice.message} />
    </ModalShell>
  );
}

function ExternalLaunchFailureDialog({
  busy,
  failure,
  onCancel,
  onRetry,
}: {
  busy: boolean;
  failure: ExternalLaunchFailure | null;
  onCancel: () => void;
  onRetry: () => void;
}) {
  if (!failure) {
    return null;
  }
  const { launch, message } = failure;
  const description = `${externalSshLaunchSourceLabel(launch)} · ${launch.target.username}@${launch.target.host}:${launch.target.port}`;

  return (
    <ModalShell
      description={description}
      footer={
        <>
          <Button disabled={busy} onClick={onCancel} size="sm" variant="ghost">
            取消该请求
          </Button>
          <Button disabled={busy} onClick={onRetry} size="sm" type="button">
            重试
          </Button>
        </>
      }
      maxWidthClassName="max-w-lg"
      onClose={onCancel}
      open
      size="small"
      title="外部 SSH 启动失败"
    >
      <UserFacingNotice message={message} />
    </ModalShell>
  );
}
