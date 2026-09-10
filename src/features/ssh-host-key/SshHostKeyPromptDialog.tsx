// @author kongweiguang

import { Check, Fingerprint, ShieldAlert } from "lucide-react";
import { useId, type ReactNode } from "react";
import { Button } from "../../components/ui/button";
import { ModalShell } from "../../components/ui/modal-shell";
import type { SshHostKeyInspection } from "../../lib/sshHostKeyApi";
import { cn } from "../../lib/cn";
import {
  createSshHostKeyPromptViewModel,
  formatSshHostKeyPromptError,
} from "./sshHostKeyPromptModel";

interface SshHostKeyPromptDialogProps {
  busy?: boolean;
  error?: string | null;
  inspection: SshHostKeyInspection | null;
  onClose: () => void;
  onSubmit: () => void;
  open: boolean;
}

/**
 * 展示需要人工核对的 SSH 主机身份；ModalShell 负责 portal、焦点陷阱和主题变量继承，
 * 这里仅保留确认所需的最小信息，不提供绕过 changed 状态的按钮。
 */
export function SshHostKeyPromptDialog({
  busy = false,
  error,
  inspection,
  onClose,
  onSubmit,
  open,
}: SshHostKeyPromptDialogProps) {
  const formId = useId();
  if (!inspection) {
    return null;
  }

  const viewModel = createSshHostKeyPromptViewModel(inspection);
  const canTrust = inspection.status === "unknown";
  return (
    <ModalShell
      description={viewModel.targetLabel}
      footer={
        <>
          <Button disabled={busy} onClick={onClose} size="sm" type="button" variant="ghost">
            取消
          </Button>
          <Button
            disabled={busy || !canTrust}
            form={formId}
            size="sm"
            type="submit"
            variant="primary"
          >
            <Check className="h-4 w-4" />
            信任并连接
          </Button>
        </>
      }
      maxWidthClassName="max-w-xl"
      onClose={onClose}
      open={open}
      size="small"
      title="确认 SSH 主机身份"
    >
      <form
        className="space-y-3"
        id={formId}
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy && canTrust) {
            onSubmit();
          }
        }}
      >
        <div className="flex gap-3 rounded-[var(--radius-card)] border border-amber-400/25 bg-amber-500/10 p-3">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-300" />
          <p className="min-w-0 text-[13px] leading-5 text-amber-800 dark:text-amber-100">
            这是该主机当前观测到的服务端密钥。请通过可信渠道核对指纹后再继续。
          </p>
        </div>

        <div className="grid gap-2 rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--surface-content)] p-3 text-[13px]">
          <IdentityRow label="目标" value={viewModel.targetLabel} />
          <IdentityRow label="算法" value={viewModel.algorithm} />
          <IdentityRow
            icon={<Fingerprint className="h-3.5 w-3.5" />}
            label="SHA-256 指纹"
            value={viewModel.fingerprint}
            valueClassName="break-all font-mono text-xs"
          />
        </div>

        {error ? (
          <p className="text-xs leading-5 text-rose-600 dark:text-rose-300" role="alert">
            {formatSshHostKeyPromptError(error)}
          </p>
        ) : null}
      </form>
    </ModalShell>
  );
}

/** 用一致的标签和值布局展示身份字段，长 fingerprint 在窄窗口中换行而不撑破弹层。 */
function IdentityRow({
  icon,
  label,
  value,
  valueClassName,
}: {
  icon?: ReactNode;
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div className="grid min-w-0 gap-1 sm:grid-cols-[7rem_minmax(0,1fr)] sm:items-start sm:gap-3">
      <div className="flex items-center gap-1.5 text-xs font-medium text-[var(--text-secondary)]">
        {icon}
        {label}
      </div>
      <div className={cn("min-w-0 text-[var(--text-primary)]", valueClassName)}>
        {value}
      </div>
    </div>
  );
}
