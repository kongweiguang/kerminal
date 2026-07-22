import { Plus, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "../../components/ui/button";
import { ModalShell } from "../../components/ui/modal-shell";
import { UserFacingNotice } from "../../components/ui/user-facing-notice";
import { cn } from "../../lib/cn";
import { writeDesktopClipboardText } from "../../lib/desktopClipboardApi";
import {
  createPortForward,
  deletePortForward,
  listPortForwards,
  startPortForward,
  stopPortForward,
  type PortForwardSummary,
} from "../../lib/portForwardApi";
import {
  buildUserFacingError,
  type UserFacingMessage,
} from "../../lib/userFacingMessage";
import { writePaneCommand } from "../terminal/session/index";
import {
  clearRemoteSocksAutoInjection,
  getRemoteSocksAutoInjection,
  isRemoteSocksAutoInjectionEnabled,
  setRemoteSocksAutoInjection,
  type RemoteSocksAutoInjection,
} from "../terminal/runtime/proxy/index";
import type { Machine, TerminalPane } from "../workspace/contracts/index";
import {
  ExposureWarning,
  FieldInput,
  RouteEditor,
} from "./port-forward/PortForwardRouteEditor";
import { PortForwardSessionList } from "./port-forward/PortForwardSessionList";
import {
  buildPortForwardCreateRequest,
  metadataFromCreateRequest,
  type PortForwardSessionMetadata,
} from "./port-forward/portForwardCreateRequestModel";
import {
  buildRemoteSocksCommand,
  flowForScenario,
  isLegacyHttpNetworkAssist,
  opensshForScenario,
  portForwardScenarioOptions,
  proxyUrlForSession,
  resolveBindHost,
} from "./port-forward/portForwardWorkbenchModel";
import { usePortForwardForm } from "./port-forward/usePortForwardForm";
import { usePortForwardLifecycle } from "./port-forward/usePortForwardLifecycle";
import { PortForwardEndpointFields } from "./port-forward/PortForwardEndpointFields";

interface PortForwardToolContentProps {
  active?: boolean;
  focusedPane?: TerminalPane;
  selectedMachine?: Machine;
}

export function PortForwardToolContent({
  active = true,
  focusedPane,
  selectedMachine,
}: PortForwardToolContentProps) {
  const selectedHostId =
    selectedMachine?.kind === "ssh" ? selectedMachine.id : undefined;
  const [error, setError] = useState<UserFacingMessage | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [dialogHostId, setDialogHostId] = useState<string | null>(null);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [sessions, setSessions] = useState<PortForwardSummary[]>([]);
  const [sessionsLoadedHostId, setSessionsLoadedHostId] = useState<
    string | null
  >(null);
  const [sessionMetadata, setSessionMetadata] = useState<
    Record<string, PortForwardSessionMetadata>
  >({});
  const [autoInjection, setAutoInjection] = useState<
    RemoteSocksAutoInjection | undefined
  >(() =>
    selectedHostId
      ? getRemoteSocksAutoInjection(selectedHostId)
      : undefined,
  );

  const form = usePortForwardForm(selectedHostId);
  const {
    applySession,
    hostTargetHost,
    hostTargetPort,
    localBindMode,
    localCustomBindHost,
    localListenPort,
    localSocksPort,
    localTargetHost,
    localTargetPort,
    name,
    remoteBindMode,
    remoteCustomBindHost,
    remoteListenPort,
    scenario,
    setName,
    setScenario,
    socksMode,
  } = form;
  const {
    beginListRequest,
    captureBinding,
    invalidateListRequests,
    isCurrentBinding,
    isCurrentListRequest,
    runAction,
  } = usePortForwardLifecycle({
    active,
    hostId: selectedHostId,
    onError: setError,
    onLoadingChange: setLoading,
    onNotice: setNotice,
  });

  const localBindHost = resolveBindHost(localBindMode, localCustomBindHost);
  const remoteBindHost = resolveBindHost(remoteBindMode, remoteCustomBindHost);
  const enrichedSessions = useMemo(
    () =>
      sessions.map((session) =>
        sessionMetadata[session.id]
          ? {
              ...session,
              ...sessionMetadata[session.id],
              bindHost: session.bindHost,
              sourcePort: session.sourcePort,
              status: session.status,
            }
          : session,
      ),
    [sessionMetadata, sessions],
  );

  const selectedHostSessions = useMemo(
    () =>
      selectedMachine?.kind === "ssh"
        ? enrichedSessions.filter(
            (session) => session.hostId === selectedMachine.id,
          )
        : [],
    [enrichedSessions, selectedMachine],
  );

  useEffect(() => {
    if (!selectedHostId) {
      setAutoInjection(undefined);
      return;
    }
    const current = getRemoteSocksAutoInjection(selectedHostId);
    if (!current) {
      setAutoInjection(undefined);
      return;
    }
    if (sessionsLoadedHostId !== selectedHostId) {
      setAutoInjection(current);
      return;
    }
    if (
      !selectedHostSessions.some(
        (session) =>
          session.id === current.sessionId &&
          session.status === "running" &&
          proxyUrlForSession(session),
      )
    ) {
      clearRemoteSocksAutoInjection(selectedHostId, current.sessionId);
      setAutoInjection(undefined);
      return;
    }
    setAutoInjection(current);
  }, [selectedHostId, selectedHostSessions, sessionsLoadedHostId]);

  useEffect(() => {
    setCreateDialogOpen(false);
    setDialogHostId(null);
    setEditingSessionId(null);
    setError(null);
    setNotice(null);
    setLoading(false);
    setSessions([]);
    setSessionsLoadedHostId(null);
    setSessionMetadata({});
  }, [selectedHostId]);

  const canInjectIntoFocusedPane =
    selectedMachine?.kind === "ssh" &&
    focusedPane?.mode === "ssh" &&
    (focusedPane.remoteHostId === selectedMachine.id ||
      focusedPane.machineId === selectedMachine.id);
  const injectDisabledReason = !focusedPane
    ? "无法注入当前终端，请手动粘贴。"
    : "聚焦终端不是当前 SSH 主机。";

  const refresh = useCallback(async () => {
    const token = beginListRequest();
    if (!token || !selectedHostId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setSessionsLoadedHostId(null);
    setError(null);
    try {
      const nextSessions = await listPortForwards();
      if (isCurrentListRequest(token)) {
        setSessions(nextSessions);
        setSessionsLoadedHostId(selectedHostId);
      }
    } catch (nextError) {
      if (isCurrentListRequest(token)) {
        setError(
          buildUserFacingError(nextError, {
            detail: "当前主机的端口转发列表暂时不可用。",
            recoveryAction: "请确认 SSH 连接可用后重试。",
            title: "无法读取隧道",
          }),
        );
      }
    } finally {
      if (isCurrentListRequest(token)) {
        setLoading(false);
      }
    }
  }, [beginListRequest, isCurrentListRequest, selectedHostId]);

  useEffect(() => {
    void refresh();
    return invalidateListRequests;
  }, [invalidateListRequests, refresh]);

  if (!selectedMachine || selectedMachine.kind !== "ssh") {
    const message =
      selectedMachine?.kind === "dockerContainer"
        ? "当前容器目标不支持直接创建 SSH 隧道。请切回宿主 SSH 主机管理端口转发。"
        : "请选择 SSH 主机。";
    return (
      <section className="kerminal-solid-surface rounded-[var(--radius-card)] border p-4 text-sm text-zinc-500 dark:text-zinc-400">
        <h3 className="font-medium text-zinc-950 dark:text-zinc-100">
          SSH 隧道
        </h3>
        <p className="mt-2 leading-6">{message}</p>
      </section>
    );
  }

  const remoteExposureActive =
    scenario === "localService" ||
    (scenario === "socksAdvanced" && socksMode === "remoteDynamic");
  const localExposureActive =
    scenario === "hostService" ||
    (scenario === "socksAdvanced" && socksMode === "localDynamic");

  async function handleCreate() {
    if (
      !selectedMachine ||
      selectedMachine.kind !== "ssh" ||
      !selectedHostId ||
      !dialogHostId ||
      dialogHostId !== selectedHostId
    ) {
      return;
    }

    const request = buildPortForwardCreateRequest({
      hostId: dialogHostId,
      hostTargetHost,
      hostTargetPort,
      localBindHost,
      localListenPort,
      localSocksPort,
      localTargetHost,
      localTargetPort,
      name,
      remoteBindHost,
      remoteBindMode,
      remoteListenPort,
      scenario,
      socksMode,
    });
    if ("error" in request) {
      setError(portForwardUserError(request.error));
      return;
    }

    await runAction(
      async (token) => {
        if (editingSessionId) {
          await deletePortForward(editingSessionId);
        }
        const created = await createPortForward(request.value);
        const listed = await listPortForwards();
        if (!isCurrentBinding(token)) {
          return;
        }
        setSessionMetadata((current) => ({
          ...current,
          [created.id]: metadataFromCreateRequest(request.value),
        }));
        setSessions(
          listed.some((session) => session.id === created.id)
            ? listed
            : [...listed, created],
        );
        setNotice(
          editingSessionId ? "隧道配置已更新。" : "隧道会话已创建。",
        );
        setEditingSessionId(null);
        setDialogHostId(null);
        setCreateDialogOpen(false);
      },
      (nextError) =>
        buildUserFacingError(nextError, {
          detail: "隧道配置尚未创建。",
          recoveryAction: "请检查端口、绑定地址和 SSH 连接后重试。",
          title: "无法创建隧道",
        }),
    );
  }

  function handleOpenCreateDialog() {
    if (!active || !selectedHostId) {
      return;
    }
    setError(null);
    setNotice(null);
    setEditingSessionId(null);
    setDialogHostId(selectedHostId);
    setCreateDialogOpen(true);
  }

  function handleCloseCreateDialog() {
    setCreateDialogOpen(false);
    setDialogHostId(null);
    setEditingSessionId(null);
    setError(null);
  }
  function handleEdit(session: PortForwardSummary) {
    if (!active || !selectedHostId || session.hostId !== selectedHostId) {
      return;
    }
    if (isLegacyHttpNetworkAssist(session)) {
      setError(
        portForwardUserError(
          "旧版 HTTP 网络助手已移除。",
          "请删除该记录并创建远端 SOCKS。",
        ),
      );
      return;
    }
    applySession(session);
    setError(null);
    setNotice(null);
    setEditingSessionId(session.id);
    setDialogHostId(selectedHostId);
    setCreateDialogOpen(true);
  }
  async function handleStart(forwardId: string) {
    await runAction(
      async (token) => {
        const started = await startPortForward(forwardId);
        if (!isCurrentBinding(token)) return;
        const nextSessions = await listPortForwards();
        if (!isCurrentBinding(token)) return;
        setSessions(nextSessions);
        setNotice(`${started.name} 已启动。`);
      },
      (nextError) =>
        buildUserFacingError(nextError, {
          detail: "保存的隧道仍然保留。",
          recoveryAction: "请确认 SSH 连接可用后重试。",
          title: "无法启动隧道",
        }),
    );
  }
  async function handleStop(forwardId: string) {
    await runAction(
      async (token) => {
        await stopPortForward(forwardId);
        const cleared = clearCurrentAutoInjection(forwardId);
        if (!isCurrentBinding(token)) return;
        if (cleared) setAutoInjection(undefined);
        const nextSessions = await listPortForwards();
        if (!isCurrentBinding(token)) return;
        setSessions(nextSessions);
        setNotice("隧道已停止，配置仍保留。");
      },
      (nextError) =>
        buildUserFacingError(nextError, {
          detail: "隧道可能仍在运行。",
          recoveryAction: "请刷新状态，确认 SSH 连接可用后重试。",
          title: "无法停止隧道",
        }),
    );
  }
  async function handleDelete(forwardId: string) {
    await runAction(
      async (token) => {
        await deletePortForward(forwardId);
        const cleared = clearCurrentAutoInjection(forwardId);
        if (!isCurrentBinding(token)) return;
        setSessionMetadata((current) => {
          const next = { ...current };
          delete next[forwardId];
          return next;
        });
        if (cleared) setAutoInjection(undefined);
        const nextSessions = await listPortForwards();
        if (!isCurrentBinding(token)) return;
        setSessions(nextSessions);
        setNotice("隧道配置已删除。");
      },
      (nextError) =>
        buildUserFacingError(nextError, {
          detail: "隧道配置仍然保留。",
          recoveryAction: "请刷新状态后重试删除。",
          title: "无法删除隧道",
        }),
    );
  }
  function clearCurrentAutoInjection(forwardId: string) {
    return Boolean(
      selectedHostId &&
      autoInjection?.sessionId === forwardId &&
      clearRemoteSocksAutoInjection(selectedHostId, forwardId),
    );
  }

  async function handleCopy(value: string) {
    const token = captureBinding();
    if (!token) return;
    const result = await writeDesktopClipboardText(value);
    if (!isCurrentBinding(token)) return;
    if (!result.ok) {
      setError(
        portForwardUserError(
          "当前环境不支持复制到剪贴板。",
          "请手动选择并复制地址。",
        ),
      );
      return;
    }
    setNotice("已复制地址。");
  }

  async function handleInject(session: PortForwardSummary) {
    const token = captureBinding();
    if (!token) return;
    if (!focusedPane || !canInjectIntoFocusedPane) {
      setError(portForwardUserError(injectDisabledReason));
      return;
    }
    if (session.status !== "running") {
      setError(
        portForwardUserError("该隧道已退出。", "请重新启动后再注入代理环境。"),
      );
      return;
    }
    const proxyUrl = proxyUrlForSession(session);
    if (!proxyUrl) {
      setError(portForwardUserError("该会话没有可注入的代理地址。"));
      return;
    }
    await writePaneCommand({
      command: buildRemoteSocksCommand({ proxyUrl }),
      paneId: focusedPane.id,
      source: "tool",
    });
    if (isCurrentBinding(token)) {
      setNotice("已注入当前终端，不会写入远端 profile。");
    }
  }

  function handleToggleAutoUse(session: PortForwardSummary) {
    if (!active || !selectedHostId) {
      return;
    }
    if (session.status !== "running") {
      setError(
        portForwardUserError("该隧道已退出。", "请重新启动后再用于新终端。"),
      );
      return;
    }
    if (
      isRemoteSocksAutoInjectionEnabled({
        hostId: selectedHostId,
        sessionId: session.id,
      })
    ) {
      clearRemoteSocksAutoInjection(selectedHostId, session.id);
      setAutoInjection(undefined);
      setNotice("已关闭后续新终端自动使用。");
      return;
    }

    const proxyUrl = proxyUrlForSession(session);
    if (!proxyUrl) {
      setError(portForwardUserError("该会话没有可用于新终端的代理地址。"));
      return;
    }
    const injection: RemoteSocksAutoInjection = {
      command: buildRemoteSocksCommand({ proxyUrl }),
      hostId: selectedHostId,
      protocol: "socks5",
      proxyUrl,
      sessionId: session.id,
    };
    setRemoteSocksAutoInjection(injection);
    setAutoInjection(injection);
    setNotice(
      "同主机后续新 SSH 终端会自动执行代理 export，不会写入远端 profile。",
    );
  }

  return (
    <section className="space-y-3">
      <div className="kerminal-solid-surface rounded-[var(--radius-card)] border p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-medium text-zinc-950 dark:text-zinc-100">
              SSH 隧道
            </h3>
            <p className="mt-1 truncate font-mono text-xs text-zinc-500 dark:text-zinc-400">
              {selectedMachine.username}@{selectedMachine.host}:
              {selectedMachine.port}
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            {selectedMachine.production ? (
              <span className="rounded-lg border border-amber-300/25 bg-amber-400/10 px-2 py-1 text-xs text-amber-700 dark:text-amber-200">
                生产主机
              </span>
            ) : null}
            <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
              {selectedHostSessions.length} 个会话
            </span>
          </div>
        </div>

        {error ? (
          <UserFacingNotice className="mt-3" compact message={error} />
        ) : null}
        {notice ? (
          <div className="mt-3 rounded-xl border border-emerald-300/20 bg-emerald-400/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-100">
            {notice}
          </div>
        ) : null}

        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            aria-label="添加隧道"
            className="bg-sky-500 text-white shadow-lg shadow-sky-500/25 hover:bg-sky-400 dark:bg-sky-500 dark:text-white dark:hover:bg-sky-400"
            disabled={loading}
            onClick={handleOpenCreateDialog}
            size="icon"
            title="添加隧道"
            variant="primary"
          >
            <Plus className="h-4 w-4" />
          </Button>
          <Button
            aria-label="刷新隧道"
            disabled={loading}
            onClick={() => void refresh()}
            size="icon"
            title="刷新隧道"
            variant="secondary"
          >
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          </Button>
        </div>
      </div>

      <PortForwardSessionList
        autoInjectionSessionId={autoInjection?.sessionId}
        canInject={Boolean(canInjectIntoFocusedPane)}
        injectDisabledReason={injectDisabledReason}
        loading={loading}
        onCopy={handleCopy}
        onDelete={handleDelete}
        onEdit={handleEdit}
        onInject={handleInject}
        onStart={handleStart}
        onStop={handleStop}
        onToggleAutoUse={handleToggleAutoUse}
        sessions={selectedHostSessions}
      />
      <ModalShell
        description={`${selectedMachine.username}@${selectedMachine.host}:${selectedMachine.port}`}
        footer={
          <>
            <Button
              disabled={loading}
              onClick={handleCloseCreateDialog}
              variant="secondary"
            >
              取消
            </Button>
            <Button
              className="bg-sky-500 text-white shadow-lg shadow-sky-500/25 hover:bg-sky-400 dark:bg-sky-500 dark:text-white dark:hover:bg-sky-400"
              disabled={loading}
              onClick={() => void handleCreate()}
            >
              <Plus className="h-4 w-4" />
              {editingSessionId ? "保存修改" : "开启隧道"}
            </Button>
          </>
        }
        onClose={handleCloseCreateDialog}
        open={createDialogOpen && dialogHostId === selectedHostId}
        size="large"
        title={editingSessionId ? "编辑 SSH 隧道" : "添加 SSH 隧道"}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {portForwardScenarioOptions.map((option) => (
              <button
                aria-pressed={scenario === option.id}
                className={cn(
                  "kerminal-focus-ring kerminal-pressable min-h-20 rounded-xl border px-3 py-2 text-left transition-colors",
                  scenario === option.id
                    ? "border-sky-400/30 bg-[var(--surface-selected)] text-sky-700 shadow-sm shadow-sky-500/10 dark:text-sky-100"
                    : "kerminal-muted-surface text-zinc-600 hover:bg-[var(--surface-hover)] dark:text-zinc-400",
                )}
                key={option.id}
                onClick={() => setScenario(option.id)}
                type="button"
              >
                <span className="flex items-center justify-between gap-2 text-xs font-semibold">
                  {option.label}
                  <span className="rounded-md bg-[var(--surface-hover)] px-1.5 py-0.5 font-mono text-[10px] text-zinc-500 dark:text-zinc-300">
                    {option.openssh}
                  </span>
                </span>
                <span className="mt-1 block text-[11px] leading-4 text-zinc-500 dark:text-zinc-400">
                  {option.flow}
                </span>
              </button>
            ))}
          </div>

          <FieldInput
            id="forward-name"
            label="名称"
            onChange={setName}
            placeholder="例如 PostgreSQL 隧道"
            value={name}
          />

          <RouteEditor
            flow={flowForScenario(scenario, socksMode)}
            host={<PortForwardEndpointFields form={form} remoteBindHost={remoteBindHost} side="host" />}
            local={<PortForwardEndpointFields form={form} remoteBindHost={remoteBindHost} side="local" />}
            openssh={opensshForScenario(scenario, socksMode)}
          />

          {remoteExposureActive ? (
            <ExposureWarning
              bindHost={remoteBindHost}
              production={Boolean(selectedMachine.production)}
              side="remote"
            />
          ) : null}
          {localExposureActive ? (
            <ExposureWarning
              bindHost={localBindHost}
              production={false}
              side="local"
            />
          ) : null}

          {error ? <UserFacingNotice compact message={error} /> : null}
        </div>
      </ModalShell>
    </section>
  );

}

function portForwardUserError(
  title: string,
  recoveryAction?: string,
): UserFacingMessage {
  return {
    recoveryAction,
    severity: "error",
    title,
  };
}
