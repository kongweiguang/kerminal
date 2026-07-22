// @author kongweiguang

import {
  AlertTriangle,
  ChevronDown,
  Copy,
  Network,
  Pencil,
  Play,
  Square,
  Terminal,
  Trash2,
  Wifi,
} from "lucide-react";
import { useId, useMemo, useState } from "react";
import { Button } from "../../../components/ui/button";
import { cn } from "../../../lib/cn";
import type { PortForwardSummary } from "../../../lib/portForwardApi";
import {
  buildUserProxySetupScript,
  buildUserProxyUndoScript,
  copyAddressForSession,
  isRemoteDynamicSocks,
  proxyUrlForSession,
  sessionDirectionLabel,
  sessionHostEndpoint,
  sessionLocalEndpoint,
  sessionOrigin,
} from "./portForwardWorkbenchModel";

export function PortForwardSessionList({
  autoInjectionSessionId,
  canInject,
  injectDisabledReason,
  loading,
  onCopy,
  onDelete,
  onEdit,
  onInject,
  onStart,
  onStop,
  onToggleAutoUse,
  sessions,
}: {
  autoInjectionSessionId?: string;
  canInject: boolean;
  injectDisabledReason: string;
  loading: boolean;
  onCopy: (value: string) => Promise<void>;
  onDelete: (forwardId: string) => Promise<void>;
  onEdit: (session: PortForwardSummary) => void;
  onInject: (session: PortForwardSummary) => Promise<void>;
  onStart: (forwardId: string) => Promise<void>;
  onStop: (forwardId: string) => Promise<void>;
  onToggleAutoUse: (session: PortForwardSummary) => void;
  sessions: PortForwardSummary[];
}) {
  return (
    <section
      aria-label="隧道会话"
      className="kerminal-solid-surface rounded-[var(--radius-card)] border p-2"
    >
      {loading ? (
        <div className="px-2 py-1.5 text-right text-xs text-zinc-500 dark:text-zinc-400">
          正在同步
        </div>
      ) : null}
      {sessions.length === 0 ? (
        <div className="px-2 py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
          当前主机暂无隧道会话。
        </div>
      ) : (
        <div className="space-y-2">
          {sessions.map((session) => (
            <PortForwardSessionRow
              canInject={canInject}
              autoUseEnabled={autoInjectionSessionId === session.id}
              injectDisabledReason={injectDisabledReason}
              key={session.id}
              onCopy={onCopy}
              onDelete={onDelete}
              onEdit={onEdit}
              onInject={onInject}
              onStart={onStart}
              onStop={onStop}
              onToggleAutoUse={onToggleAutoUse}
              session={session}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function PortForwardSessionRow({
  autoUseEnabled,
  canInject,
  injectDisabledReason,
  onCopy,
  onDelete,
  onEdit,
  onInject,
  onStart,
  onStop,
  onToggleAutoUse,
  session,
}: {
  autoUseEnabled: boolean;
  canInject: boolean;
  injectDisabledReason: string;
  onCopy: (value: string) => Promise<void>;
  onDelete: (forwardId: string) => Promise<void>;
  onEdit: (session: PortForwardSummary) => void;
  onInject: (session: PortForwardSummary) => Promise<void>;
  onStart: (forwardId: string) => Promise<void>;
  onStop: (forwardId: string) => Promise<void>;
  onToggleAutoUse: (session: PortForwardSummary) => void;
  session: PortForwardSummary;
}) {
  const isRemoteSocks = isRemoteDynamicSocks(session);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const detailsId = useId();
  const proxyUrl = proxyUrlForSession(session);
  const activeProxyUrl = session.status === "running" ? proxyUrl : undefined;
  const inactiveRemoteSocksReason =
    session.status === "running"
      ? undefined
      : "该隧道已退出，请重新启动后再使用远端 SOCKS。";
  const effectiveInjectDisabledReason =
    inactiveRemoteSocksReason ?? injectDisabledReason;
  const userSetupScript = useMemo(
    () =>
      session.status === "running" ? buildUserProxySetupScript(session) : undefined,
    [session],
  );
  const userUndoScript = useMemo(
    () => buildUserProxyUndoScript(session),
    [session],
  );
  const route = sessionRoute(session);
  const recentFailure =
    session.status === "running" ? session.runtime?.recentFailure : undefined;
  return (
    <article className="kerminal-muted-surface rounded-xl border p-3">
      <div className="flex items-start gap-3">
        {isRemoteSocks ? (
          <Wifi className="mt-0.5 h-4 w-4 shrink-0 text-sky-600 dark:text-sky-300" />
        ) : (
          <Network className="mt-0.5 h-4 w-4 shrink-0 text-sky-600 dark:text-sky-300" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <div className="truncate text-sm font-semibold text-zinc-950 dark:text-zinc-100">
              {session.name}
            </div>
            <StatusBadge status={session.status} />
          </div>
          <div className="mt-2 flex min-w-0 items-center gap-2 font-mono text-[11px] text-zinc-700 dark:text-zinc-200">
            <span className="truncate">{route.from}</span>
            <span aria-hidden="true" className="shrink-0 text-zinc-400">
              →
            </span>
            <span className="truncate">{route.to}</span>
          </div>
          {recentFailure ? (
            <div
              aria-label="最近一次转发失败"
              className="mt-3 rounded-lg border border-amber-400/30 bg-amber-400/10 px-2.5 py-2 text-amber-900 dark:border-amber-300/25 dark:bg-amber-300/10 dark:text-amber-100"
              role="alert"
            >
              <div className="flex items-center gap-1.5 text-[11px] font-medium">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                最近一次连接失败，隧道仍在监听
              </div>
              <p className="mt-1 break-words font-mono text-[11px] leading-4">
                {recentFailure}
              </p>
            </div>
          ) : null}
          {detailsOpen ? (
            <div className="mt-3 space-y-2" id={detailsId}>
              <div className="grid gap-2 text-xs min-[520px]:grid-cols-2">
                <SessionFact
                  label="方向"
                  value={sessionDirectionLabel(session)}
                />
                <SessionFact
                  label="来源"
                  value={originLabel(sessionOrigin(session))}
                />
                <SessionFact
                  label="主机端点"
                  value={sessionHostEndpoint(session)}
                />
                <SessionFact
                  label="本机端点"
                  value={sessionLocalEndpoint(session)}
                />
              </div>
              {proxyUrl ? (
                <div className="break-all rounded-lg bg-[var(--surface-field)] px-2 py-1.5 font-mono text-[11px] text-zinc-600 dark:text-zinc-300">
                  {proxyUrl}
                </div>
              ) : null}
              {isRemoteSocks && userSetupScript && userUndoScript ? (
                <div className="rounded-lg border border-sky-300/15 bg-sky-400/10 px-2 py-2 text-[11px] leading-4 text-sky-800 dark:text-sky-100">
                  脚本只写当前用户 home，不需要 root；提供备份和撤销脚本。
                </div>
              ) : null}
            </div>
          ) : null}
          {isRemoteSocks && (!canInject || inactiveRemoteSocksReason) ? (
            <div className="mt-2 text-[11px] leading-4 text-amber-700 dark:text-amber-200">
              {effectiveInjectDisabledReason}
            </div>
          ) : null}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          aria-controls={detailsId}
          aria-expanded={detailsOpen}
          aria-label={`${detailsOpen ? "收起" : "展开"} ${session.name} 详情`}
          onClick={() => setDetailsOpen((current) => !current)}
          size="icon"
          title={`${detailsOpen ? "收起" : "展开"}完整信息`}
          variant="secondary"
        >
          <ChevronDown
            className={cn(
              "h-4 w-4 transition-transform",
              detailsOpen && "rotate-180",
            )}
          />
        </Button>
        <Button
          aria-label="复制地址"
          onClick={() => void onCopy(copyAddressForSession(session))}
          size="icon"
          title="复制地址"
          variant="secondary"
        >
          <Copy className="h-4 w-4" />
        </Button>
        <Button
          aria-label="编辑隧道"
          onClick={() => onEdit(session)}
          size="icon"
          title="编辑隧道"
          variant="secondary"
        >
          <Pencil className="h-4 w-4" />
        </Button>
        {isRemoteSocks ? (
          <Button
            aria-label="注入代理环境"
            disabled={!canInject || !activeProxyUrl}
            onClick={() => void onInject(session)}
            size="icon"
            title={
              activeProxyUrl
                ? canInject
                  ? "注入当前终端"
                  : injectDisabledReason
                : effectiveInjectDisabledReason
            }
            variant="secondary"
          >
            <Terminal className="h-4 w-4" />
          </Button>
        ) : null}
        {isRemoteSocks ? (
          <Button
            aria-label={autoUseEnabled ? "关闭新终端自动使用" : "新终端自动使用"}
            disabled={!activeProxyUrl}
            onClick={() => onToggleAutoUse(session)}
            size="icon"
            title={
              activeProxyUrl
                ? "控制新 SSH 终端自动使用代理"
                : inactiveRemoteSocksReason ?? "该会话没有可用于新终端的代理地址"
            }
            variant={autoUseEnabled ? "primary" : "secondary"}
          >
            <Terminal className="h-4 w-4" />
          </Button>
        ) : null}
        {isRemoteSocks && userSetupScript ? (
          <Button
            aria-label="复制配置脚本"
            onClick={() => void onCopy(userSetupScript)}
            size="icon"
            title="复制用户级配置脚本，需在远端终端手动执行"
            variant="secondary"
          >
            <Copy className="h-4 w-4" />
          </Button>
        ) : null}
        {isRemoteSocks && userUndoScript ? (
          <Button
            aria-label="复制撤销脚本"
            onClick={() => void onCopy(userUndoScript)}
            size="icon"
            title="复制撤销脚本，需在远端终端手动执行"
            variant="secondary"
          >
            <Copy className="h-4 w-4" />
          </Button>
        ) : null}
        {session.status === "running" ? (
          <Button
            aria-label="停止隧道"
            onClick={() => void onStop(session.id)}
            size="icon"
            title="停止隧道"
            variant="secondary"
          >
            <Square className="h-4 w-4" />
          </Button>
        ) : (
          <Button
            aria-label="启动隧道"
            onClick={() => void onStart(session.id)}
            size="icon"
            title="启动隧道"
            variant="secondary"
          >
            <Play className="h-4 w-4" />
          </Button>
        )}
        <Button
          aria-label="删除隧道"
          className="border-rose-300/30 text-rose-700 hover:bg-rose-500/10 dark:text-rose-300"
          onClick={() => void onDelete(session.id)}
          size="icon"
          title="删除隧道"
          variant="secondary"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </article>
  );
}

function SessionFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
        {label}
      </div>
      <div className="truncate font-mono text-[11px] text-zinc-800 dark:text-zinc-200">
        {value}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: PortForwardSummary["status"] }) {
  return (
    <span
      className={cn(
        "rounded-lg px-2 py-1 text-[11px]",
        status === "running"
          ? "bg-emerald-400/10 text-emerald-700 dark:text-emerald-200"
          : "bg-zinc-500/10 text-zinc-500 dark:text-zinc-400",
      )}
    >
      {status === "running" ? "运行中" : "已退出"}
    </span>
  );
}

function originLabel(origin: ReturnType<typeof sessionOrigin>) {
  if (origin === "mcpTool") {
    return "MCP 工具";
  }
  if (origin === "hostPreset") {
    return "主机预设";
  }
  return "手动";
}

function sessionRoute(session: PortForwardSummary) {
  const localEndpoint = sessionLocalEndpoint(session);
  const hostEndpoint = sessionHostEndpoint(session);
  const hostToLocal =
    session.kind === "remote" || session.kind === "remoteDynamic";
  return hostToLocal
    ? { from: hostEndpoint, to: localEndpoint }
    : { from: localEndpoint, to: hostEndpoint };
}
