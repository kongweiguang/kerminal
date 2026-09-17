// @author kongweiguang
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AgentWorkflowController,
  useAgentWorkflowController,
} from "../agent-workflow";
import { cn } from "../../lib/cn";
import {
  agentSessionRecordId,
  agentSessionRecordAgentId,
  getExternalAgentWorkspaceStatus,
  listAgentSessions,
  prepareExternalAgentWorkspace,
  type AgentSessionRecord,
  type AgentSessionScope,
  type AgentSessionTargetRequest,
  type ExternalAgentLaunchSpec,
  type ExternalAgentWorkspaceStatus,
} from "../../lib/agentLauncherApi";
import type { TerminalAgentSignal } from "../../lib/terminalApi";
import {
  buildUserFacingError,
  type UserFacingMessage,
} from "../../lib/userFacingMessage";
import {
  defaultAppSettings,
  defaultTerminalAppearance,
} from "../settings/contracts/index";
import { isTerminalSessionTab } from "../workspace/contracts/index";
import {
  defaultAgentLaunchPermissionMode,
  buildAgentLauncherViewModel,
  type AgentLaunchPermissionMode,
} from "./agent-launcher/agentLauncherModel";
import { initialAgentActions } from "./agent-launcher/agentLauncherInitialActions";
import {
  agentSessionScopeId,
  agentSessionScopeFromId,
  agentSessionRecordTabId,
  findRunningSessionForTabAgent,
  tabRemovedCleanupPlan,
  visibleAgentSessionForTab,
  type AgentSidebarSessionState,
} from "./agent-launcher/agentTabSessionModel";
import {
  buildAgentSessionScope,
} from "./agent-launcher/agentSessionTargetModel";
import {
  AgentTerminalView,
} from "./agent-launcher/AgentTerminalView";
import type { AgentLaunchTargetMode } from "./agent-launcher/AgentLaunchControls";
import {
  AgentLauncherView,
  type AgentLauncherLoadState,
  type AgentRestoreChoice,
} from "./agent-launcher/AgentLauncherView";
import {
  persistedAgentSessionSelection,
  resolvePersistedAgentSessionForLaunch,
  type AgentSessionSelection,
} from "./agent-launcher/agentSessionRestoreModel";
import { createAgentPromptTransport } from "./agent-launcher/agentPromptTransport";
import { useAgentSendPreview } from "./agent-launcher/useAgentSendPreview";
import { useAgentSessionDelete } from "./agent-launcher/useAgentSessionDelete";
import { useAgentSessionTitleRename } from "./agent-launcher/useAgentSessionTitleRename";
import { useAgentSendRequestCoordinator } from "./agent-launcher/useAgentSendRequestCoordinator";
import { useAgentSendRequestSnapshot } from "../agent-workflow/state/index";
import { createAgentPreferredTargetCoordinator } from "./agent-launcher/agentPreferredTargetCoordinator";
import { useAgentSignalHandler } from "./agent-launcher/useAgentSignalHandler";
import {
  buildPreparedAgentTerminalSession,
  createAgentSessionForLaunch,
  type LauncherTerminalSession,
} from "./agent-launcher/agentSessionLaunchFactory";
import {
  resolveAgentLauncherDescriptor,
  type AgentLauncherDescriptor,
} from "./agent-launcher/agentLauncherSettingsModel";
import { useConfirmedAgentLauncherSettings } from "./agent-launcher/useConfirmedAgentLauncherSettings";
import { useAgentLauncherAction } from "./agent-launcher/useAgentLauncherAction";
import {
  buildAgentSelectorOptions,
  buildAgentTargetPresentation,
  buildAgentTechnicalDetail,
  launcherSnapshotFromSelection,
  resolveHistoricalAgentLaunch,
  type AgentLaunchSnapshot,
} from "./agent-launcher/agentLauncherPresentationModel";
import type { AgentLauncherToolContentProps } from "./agent-launcher/AgentLauncherToolContent.types";
type AgentLauncherScreen = "launcher" | "terminal";

/**
 * 每个终端 Tab 独立保存右栏助手与历史；运行态 MCP 权限由 Rust 保持全局，当前
 * 聚焦终端只作为新建和显式继续时的首选上下文。
 */
export function AgentLauncherToolContent({
  activeTab,
  desktopNotifications,
  focusedPane,
  onConfirmedSettingsChange,
  resolvedTheme = "dark",
  settings = defaultAppSettings,
  terminalAppearance = defaultTerminalAppearance,
  terminalPanes,
  terminalTabs,
}: AgentLauncherToolContentProps) {
  const {
    deleteCustomAgent,
    launcherSettings,
    mutationError,
    mutationPending,
    saveCustomAgent,
    selectAgent,
  } = useConfirmedAgentLauncherSettings({
    onConfirmedSettingsChange,
    settings,
  });
  const workflowSignalListenersRef = useRef(
    new Set<(signal: TerminalAgentSignal) => void>(),
  );
  const [workflowController] = useState(
    () =>
      new AgentWorkflowController(
        {
          listSessions: async () => (await listAgentSessions()).sessions ?? [],
        },
        {
          subscribe: (listener) => {
            workflowSignalListenersRef.current.add(listener);
            return () => workflowSignalListenersRef.current.delete(listener);
          },
        },
        {
          ...createAgentPromptTransport(),
        },
      ),
  );
  const workflowMountGenerationRef = useRef(0);
  const workflowSnapshot = useAgentWorkflowController(workflowController);
  const [status, setStatus] = useState<ExternalAgentWorkspaceStatus | null>(
    null,
  );
  const [loadState, setLoadState] = useState<AgentLauncherLoadState>("loading");
  const [loadError, setLoadError] = useState<UserFacingMessage | null>(null);
  const { actionError, actionState, runAction, setActionError } =
    useAgentLauncherAction();
  const [agentSessions, setAgentSessions] = useState<
    Record<string, LauncherTerminalSession>
  >({});
  const handleAgentSignal = useAgentSignalHandler(
    setAgentSessions,
    workflowSignalListenersRef,
  );
  const [persistedAgentSessions, setPersistedAgentSessions] = useState<
    AgentSessionRecord[]
  >([]);
  const [restoreChoice, setRestoreChoice] = useState<AgentRestoreChoice | null>(
    null,
  );
  const [activeSessionIdByTabId, setActiveSessionIdByTabId] = useState<
    Record<string, string | undefined>
  >({});
  const [viewByTabId, setViewByTabId] = useState<
    Record<string, AgentLauncherScreen | undefined>
  >({});
  const previousTerminalTabIdsRef = useRef<string[] | null>(null);
  const pendingAgentSendRequest = useAgentSendRequestSnapshot().request;
  const requestedPane = pendingAgentSendRequest
    ? terminalPanes?.find((pane) => pane.id === pendingAgentSendRequest.paneId)
    : undefined;
  // pending pane 只用于发送预览，不会因普通 Tab 切换改写助手的持久目标。
  const effectiveFocusedPane = focusedPane;
  const { renameSession: renameWorkflowSession, renamingSessionId } =
    useAgentSessionTitleRename({
      controller: workflowController,
      setActionError,
      setPersistedSessions: setPersistedAgentSessions,
      setRuntimeSessions: setAgentSessions,
    });
  const activeAgentScope = buildAgentSessionScope(activeTab);
  const activeAgentScopeId = agentSessionScopeId(activeAgentScope);
  const globalAgentScopeId = agentSessionScopeId({ kind: "global" });
  const [scopeOverrideId, setScopeOverrideId] = useState<string | null>(null);
  const activeAgentViewScopeId = scopeOverrideId ?? activeAgentScopeId;
  const {
    persistPreferredTarget,
    preferredTargetForSession,
    updateRuntimePreferredTarget,
  } = createAgentPreferredTargetCoordinator({
    activeTab,
    focusedPane: effectiveFocusedPane,
    globalScopeId: globalAgentScopeId,
    setRuntimeSessions: setAgentSessions,
  });
  const view = viewByTabId[activeAgentViewScopeId] ?? "launcher";
  useEffect(() => {
    if (
      !scopeOverrideId ||
      scopeOverrideId === globalAgentScopeId ||
      scopeOverrideId === activeTab?.id
    ) {
      return;
    }
    // 仅为仍处于当前 Tab 的旧记录保留视图；切换 Tab 不复用其它 Tab 的助手视图。
    setScopeOverrideId(null);
  }, [activeTab?.id, globalAgentScopeId, scopeOverrideId]);
  const loadStatus = useCallback(
    async (state: AgentLauncherLoadState = "loading") => {
      setLoadState(state);
      setLoadError(null);
      try {
        setStatus(await getExternalAgentWorkspaceStatus());
        setLoadState("idle");
      } catch (error) {
        setLoadError(
          buildUserFacingError(error, {
            recoveryAction: "请确认 Kerminal 服务可用后重试。",
            title: "无法读取 Agent 状态",
          }),
        );
        setLoadState("error");
      }
    },
    [],
  );
  const loadPersistedAgentSessions = useCallback(async () => {
    try {
      const list = await listAgentSessions();
      setPersistedAgentSessions(list.sessions ?? []);
    } catch {
      setPersistedAgentSessions([]);
    }
  }, []);

  useEffect(() => {
    void loadStatus("loading");
    void loadPersistedAgentSessions();
  }, [loadPersistedAgentSessions, loadStatus]);

  useEffect(() => {
    const generation = ++workflowMountGenerationRef.current;
    const disposeIfCurrent = () => {
      if (workflowMountGenerationRef.current === generation) {
        workflowController.dispose();
      }
    };
    void workflowController.refresh();
    return () => {
      queueMicrotask(disposeIfCurrent);
    };
  }, [workflowController]);
  const agentActions = useMemo(
    () =>
      status ? buildAgentLauncherViewModel(status, true) : initialAgentActions,
    [status],
  );
  const agentOptions = useMemo(
    () => buildAgentSelectorOptions(agentActions, launcherSettings.customAgents),
    [agentActions, launcherSettings.customAgents],
  );
  const agentTechnicalDetail = useMemo(
    () => buildAgentTechnicalDetail(status, agentActions),
    [agentActions, status],
  );
  const {
    currentAgentScope,
    currentAgentTarget,
    currentAgentTargetLabel,
  } = buildAgentTargetPresentation({
    activeAgentScope,
    activeAgentViewScopeId,
    activeTab,
    effectiveFocusedPane,
    globalAgentScopeId,
    terminalPanes,
  });

  const agentSessionList = useMemo(
    () => Object.values(agentSessions),
    [agentSessions],
  );
  const agentSidebarState: AgentSidebarSessionState = useMemo(
    () => ({
      activeSessionIdByTabId,
      sessionsById: agentSessions,
      viewByTabId: viewByTabId as Record<string, AgentLauncherScreen>,
    }),
    [activeSessionIdByTabId, agentSessions, viewByTabId],
  );

  const activeAgentSession = useMemo(
    () => visibleAgentSessionForTab(agentSidebarState, activeAgentViewScopeId),
    [activeAgentViewScopeId, agentSidebarState],
  );
  const activeAgentTerminalSession = activeAgentSession
    ? agentSessions[activeAgentSession.agentSessionId]
    : undefined;
  const sendPreview = useAgentSendPreview({
    activeTab,
    controller: workflowController,
    focusedPane: effectiveFocusedPane,
    session: activeAgentTerminalSession,
    setActionError,
  });
  const { deleteSession: deleteWorkflowSession, deletingSessionId } =
    useAgentSessionDelete({
      activeSessionIdByTabId,
      cancelPreview: sendPreview.cancel,
      controller: workflowController,
      onDeleted: (agentSessionId) => {
        setRestoreChoice((current) =>
          current?.session.agentSessionId === agentSessionId ? null : current,
        );
      },
      preview: sendPreview.preview,
      setActionError,
      setActiveSessionIdByTabId,
      setPersistedSessions: setPersistedAgentSessions,
      setRuntimeSessions: setAgentSessions,
      setViewByTabId,
    });
  const terminalTabIds = useMemo(
    () =>
      terminalTabs
        ?.filter((tab) => isTerminalSessionTab(tab))
        .map((tab) => tab.id) ?? [],
    [terminalTabs],
  );
  const terminalTabIdsKey = terminalTabIds.join("\u0000");
  useEffect(() => {
    if (!terminalTabs) {
      return;
    }
    const previousTabIds = previousTerminalTabIdsRef.current;
    previousTerminalTabIdsRef.current = terminalTabIds;
    if (!previousTabIds) {
      return;
    }
    const cleanupPlan = tabRemovedCleanupPlan(
      previousTabIds,
      terminalTabIds,
      agentSidebarState,
    );
    if (cleanupPlan.agentSessionIds.length === 0) {
      return;
    }
    const removedSessionIds = new Set(cleanupPlan.agentSessionIds);
    const removedTabIds = new Set(cleanupPlan.removedTabIds);
    setAgentSessions((current) =>
      Object.fromEntries(
        Object.entries(current).filter(
          ([agentSessionId]) => !removedSessionIds.has(agentSessionId),
        ),
      ),
    );
    setActiveSessionIdByTabId((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([tabId]) => !removedTabIds.has(tabId)),
      ),
    );
    setViewByTabId((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([tabId]) => !removedTabIds.has(tabId)),
      ),
    );
  }, [agentSidebarState, terminalTabIds, terminalTabIdsKey, terminalTabs]);
  /** 运行态复用同时校验 scope、权限与 launcherKey，旧 Custom 才退回命令匹配。 */
  const findAgentSessionId = (
    tabId: string | undefined,
    launcher: AgentLauncherDescriptor,
    permissionMode: AgentLaunchPermissionMode,
  ) =>
    findRunningSessionForTabAgent(
      agentSidebarState,
      tabId,
      launcher,
      permissionMode,
    )?.agentSessionId ?? null;
  const setTabView = useCallback(
    (tabId: string, nextView: AgentLauncherScreen) => {
      if (
        typeof document !== "undefined" &&
        document.activeElement instanceof HTMLElement
      ) {
        document.activeElement.blur();
      }
      setViewByTabId((current) => ({
        ...current,
        [tabId]: nextView,
      }));
    },
    [],
  );

  /** 激活所属 Tab 的会话视图；旧 global 会话仅在无 Tab 入口继续使用。 */
  const activateAgentSessionForTab = useCallback(
    (tabId: string, agentSessionId: string) => {
      // tabId 来自会话归属，不由当前焦点 Tab 推断，避免跨 Tab 复制历史。
      setScopeOverrideId(tabId);
      setActiveSessionIdByTabId((current) => ({
        ...current,
        [tabId]: agentSessionId,
      }));
      setTabView(tabId, "terminal");
    },
    [setTabView],
  );

  useAgentSendRequestCoordinator({
    activeTab,
    agentScopeId: activeAgentViewScopeId,
    createPreview: sendPreview.create,
    onActivateSession: activateAgentSessionForTab,
    preferredSessionId: activeAgentSession?.agentSessionId,
    request: pendingAgentSendRequest,
    sessions: agentSessionList,
    setActionError,
    targetPane: requestedPane,
  });

  /** 启动前先固化最终 shell/args 快照，保证历史 Custom 不依赖后来编辑的定义。 */
  const launchPreparedSpec = async (
    spec: ExternalAgentLaunchSpec,
    options: {
      customCommand?: string;
      launcherKey?: string;
      permissionMode?: AgentLaunchPermissionMode;
      scope?: AgentSessionScope;
      tabId: string;
      target?: AgentSessionTargetRequest;
      title: string;
    },
  ) => {
    const nextSession = await buildPreparedAgentTerminalSession(spec, options);
    setAgentSessions((current) => ({
      ...current,
      [nextSession.agentSessionId]: nextSession,
    }));
    setRestoreChoice(null);
    activateAgentSessionForTab(options.tabId, nextSession.agentSessionId);
  };

  /**
   * workspace preparation 与右栏终端创建共用不可变启动描述；只有终端接线成功后才
   * 在这一处刷新所有会话视图，避免失败会话进入历史或调用方重复刷新 controller。
   */
  const prepareAndLaunchAgent = async (
    launcher: AgentLaunchSnapshot,
    agentSession: AgentSessionSelection,
    options: {
      permissionMode?: AgentLaunchPermissionMode;
      resumeProviderSession?: boolean;
    } = {},
  ) => {
    const launchSpec = await prepareExternalAgentWorkspace({
      agentId: launcher.agentId,
      agentSessionId: agentSession.agentSessionId,
      ...(launcher.customCommand !== undefined
        ? { customCommand: launcher.customCommand }
        : {}),
      ...(options.resumeProviderSession !== undefined
        ? { resumeProviderSession: options.resumeProviderSession }
        : {}),
    });
    await launchPreparedSpec(launchSpec, {
      customCommand: launcher.customCommand,
      launcherKey: launcher.launcherKey,
      permissionMode: options.permissionMode,
      scope: agentSession.scope,
      tabId: agentSession.tabId,
      target: agentSession.target,
      title: launcher.title,
    });
    await Promise.all([
      loadPersistedAgentSessions(),
      loadStatus("refreshing"),
      workflowController.refresh(),
    ]);
  };

  /** 创建新的 Agent 会话；Custom 在创建时固化名称、命令和 launcherKey 快照。 */
  const startNewAgentSession = async (
    launcher: AgentLaunchSnapshot,
    permissionMode: AgentLaunchPermissionMode = defaultAgentLaunchPermissionMode(
      launcher.agentId,
    ),
    targetMode: AgentLaunchTargetMode = "unbound",
    scope?: AgentSessionScope,
  ) => {
    const agentSession = await createAgentSessionForLaunch(launcher.agentId, {
      activeTab,
      focusedPane: effectiveFocusedPane,
      launcherKey: launcher.launcherKey,
      scope,
      tabId: activeAgentScopeId,
      targetMode,
      title: launcher.agentId === "custom" ? launcher.title : undefined,
    });
    await prepareAndLaunchAgent(launcher, agentSession, {
      permissionMode,
      resumeProviderSession: false,
    });
  };

  /** 按当前下拉条目启动，并以 launcherKey 隔离同一 scope 内的多个 Custom。 */
  const launchSelectedAgent = (
    permissionMode?: AgentLaunchPermissionMode,
    targetMode: AgentLaunchTargetMode = "unbound",
  ) => {
    const launcher = resolveAgentLauncherDescriptor(launcherSettings);
    if (!launcher) {
      setActionError(
        buildUserFacingError(new Error("selected launcher is missing"), {
          recoveryAction: "请重新选择一个 Agent。",
          title: "所选 Agent 已不存在",
        }),
      );
      return;
    }

    const resolvedPermissionMode =
      permissionMode ?? defaultAgentLaunchPermissionMode(launcher.agentId);
    const launchScopeId = agentSessionScopeId(
      buildAgentSessionScope(activeTab, targetMode),
    );
    const existingSessionId = findAgentSessionId(
      launchScopeId,
      launcher,
      resolvedPermissionMode,
    );
    if (existingSessionId) {
      const existingSession = agentSessions[existingSessionId];
      if (existingSession) {
        setRestoreChoice({
          agentId: launcher.agentId,
          newSessionLauncher: launcher,
          permissionMode: resolvedPermissionMode,
          session: {
            agentSessionId: existingSession.agentSessionId,
            customCommand: existingSession.customCommand,
            launcherKey: existingSession.launcherKey,
            scope:
              existingSession.scope ??
              agentSessionScopeFromId(existingSession.tabId),
            tabId: existingSession.tabId,
            target: preferredTargetForSession(existingSession),
            title: existingSession.title,
          },
        });
      }
      return;
    }

    void runAction(launcher.launcherKey, async () => {
      const persistedSession = await resolvePersistedAgentSessionForLaunch(
        launchScopeId,
        { ...launcher, permissionMode: resolvedPermissionMode },
        persistedAgentSessions,
        async () => {
          const list = await listAgentSessions();
          setPersistedAgentSessions(list.sessions ?? []);
          return list.sessions ?? [];
        },
      );
      if (persistedSession) {
        setRestoreChoice({
          agentId: launcher.agentId,
          newSessionLauncher: launcher,
          permissionMode:
            persistedSession.permissionMode ?? resolvedPermissionMode,
          session: {
            ...persistedSession,
            target: preferredTargetForSession(persistedSession),
          },
        });
        return;
      }
      await startNewAgentSession(
        launcher,
        resolvedPermissionMode,
        targetMode,
      );
    });
  };

  /** 明确继续会话时恢复保存的命令，并为 global 会话持久化当前首选终端。 */
  const continuePersistedAgentSession = (choice: AgentRestoreChoice) => {
    const runningSession = agentSessions[choice.session.agentSessionId];
    if (runningSession) {
      void runAction(runningSession.launcherKey ?? runningSession.agentId, async () => {
        const target = await persistPreferredTarget(
          runningSession.agentSessionId,
          runningSession,
        );
        updateRuntimePreferredTarget(runningSession.agentSessionId, target);
        setRestoreChoice(null);
        activateAgentSessionForTab(
          runningSession.tabId,
          runningSession.agentSessionId,
        );
      });
      return;
    }
    const launcher = launcherSnapshotFromSelection(choice.agentId, choice.session);
    const permissionMode = defaultAgentLaunchPermissionMode(choice.agentId);
    void runAction(launcher.launcherKey ?? choice.agentId, async () => {
      const target = await persistPreferredTarget(
        choice.session.agentSessionId,
        choice.session,
      );
      await prepareAndLaunchAgent(launcher, {
        ...choice.session,
        target,
      }, {
        permissionMode,
        resumeProviderSession: true,
      });
    });
  };

  /** 从恢复提示新建会话时始终归属当前 Tab，避免把历史助手跨 Tab 复制。 */
  const createFreshAgentSession = (choice: AgentRestoreChoice) => {
    const launcher =
      choice.newSessionLauncher ??
      launcherSnapshotFromSelection(choice.agentId, choice.session);
    void runAction(launcher.launcherKey ?? choice.agentId, async () => {
      await startNewAgentSession(
        launcher,
        defaultAgentLaunchPermissionMode(choice.agentId),
        "current",
        activeAgentScope,
      );
    });
  };

  /** 继续历史会话按记录 scope 恢复；global 会话的 preferred target 只在明确继续时刷新。 */
  const continueWorkflowSession = (agentSessionId: string) => {
    const runningSession = agentSessions[agentSessionId];
    if (runningSession) {
      void runAction(runningSession.launcherKey ?? runningSession.agentId, async () => {
        const target = await persistPreferredTarget(
          runningSession.agentSessionId,
          runningSession,
        );
        updateRuntimePreferredTarget(runningSession.agentSessionId, target);
        activateAgentSessionForTab(runningSession.tabId, agentSessionId);
      });
      return;
    }
    const record = persistedAgentSessions.find((candidate) => {
      try {
        return agentSessionRecordId(candidate) === agentSessionId;
      } catch {
        return false;
      }
    });
    const agentId = record ? agentSessionRecordAgentId(record) : undefined;
    if (!record || !agentId) {
      return;
    }
    const recordScopeId =
      agentSessionRecordTabId(record) ?? activeAgentScopeId;
    const selection = persistedAgentSessionSelection(record, recordScopeId);
    if (!selection) {
      return;
    }
    const launcher = launcherSnapshotFromSelection(agentId, selection);
    void runAction(launcher.launcherKey ?? agentId, async () => {
      const target = await persistPreferredTarget(agentSessionId, selection);
      await prepareAndLaunchAgent(launcher, { ...selection, target }, {
        permissionMode: defaultAgentLaunchPermissionMode(agentId),
        resumeProviderSession: true,
      });
    });
  };

  /** 会话列表的新会话动作使用当前 Tab 归属，并允许已删除 Custom 复用历史快照。 */
  const startNewWorkflowSession = (agentSessionId: string) => {
    const resolution = resolveHistoricalAgentLaunch({
      activeScope: activeAgentScope,
      agentSessionId,
      launcherSettings,
      persistedSessions: persistedAgentSessions,
      runtimeSessions: agentSessions,
      workflowSessions: workflowSnapshot.sessions,
    });
    if (!resolution) {
      return;
    }
    const { agentId, launcher } = resolution;
    if (!launcher) {
      setActionError(
        buildUserFacingError(new Error("historical custom launch is missing"), {
          recoveryAction: "请保留历史会话，或重新添加对应的自定义 Agent。",
          title: "无法读取历史 Agent 命令",
        }),
      );
      return;
    }
    void runAction(launcher.launcherKey ?? agentId, async () => {
      await startNewAgentSession(
        launcher,
        defaultAgentLaunchPermissionMode(agentId),
        "current",
        activeAgentScope,
      );
    });
  };

  return (
    <section className="relative h-full min-h-0 overflow-hidden bg-[var(--surface-terminal)]">
      <AgentLauncherView
        actionError={actionError ?? mutationError}
        actionState={actionState}
        agentOptions={agentOptions}
        agentTechnicalDetail={agentTechnicalDetail}
        currentAgentScope={currentAgentScope}
        currentAgentTarget={currentAgentTarget}
        currentAgentTargetLabel={currentAgentTargetLabel}
        customAgentError={mutationError}
        customAgentMutationPending={mutationPending}
        customAgents={launcherSettings.customAgents}
        deletingSessionId={deletingSessionId}
        loadError={loadError}
        loadState={loadState}
        pendingSendRequest={pendingAgentSendRequest}
        onAgentSelect={(launcherKey) => void selectAgent(launcherKey)}
        onCancelRestore={() => setRestoreChoice(null)}
        onContinueRestore={continuePersistedAgentSession}
        onCustomAgentDelete={deleteCustomAgent}
        onCustomAgentSave={saveCustomAgent}
        onLaunchSelected={launchSelectedAgent}
        onNewSession={createFreshAgentSession}
        onRetry={() => void loadStatus("loading")}
        onWorkflowContinue={continueWorkflowSession}
        onWorkflowDelete={deleteWorkflowSession}
        onWorkflowNewSession={startNewWorkflowSession}
        onWorkflowRename={renameWorkflowSession}
        renamingSessionId={renamingSessionId}
        restoreChoice={restoreChoice}
        selectedAgentKey={launcherSettings.selectedAgentKey}
        statusAvailable={Boolean(status)}
        visible={view === "launcher"}
        workflowSnapshot={workflowSnapshot}
      />
      {agentSessionList.map((session) => {
        const active =
          session.agentSessionId === activeAgentSession?.agentSessionId;
        return (
          <div
            aria-hidden={view !== "terminal" || !active}
            inert={view !== "terminal" || !active}
            className={cn(
              "absolute inset-0 transition-opacity duration-150",
              view === "terminal" && active
                ? "opacity-100"
                : "pointer-events-none select-none opacity-0",
            )}
            key={session.agentSessionId}
          >
            <AgentTerminalView
              focused={view === "terminal" && active}
              session={session}
              desktopNotifications={desktopNotifications}
              onBack={() => {
                setTabView(activeAgentViewScopeId, "launcher");
              }}
              onAgentSignal={handleAgentSignal}
              onCancelPreview={sendPreview.cancel}
              onConfirmPreview={sendPreview.confirm}
              preview={
                active &&
                sendPreview.preview?.sessionId === session.agentSessionId
                  ? sendPreview.preview
                  : null
              }
              previewBusy={sendPreview.busy}
              resolvedTheme={resolvedTheme}
              terminalAppearance={terminalAppearance}
            />
          </div>
        );
      })}
    </section>
  );
}
