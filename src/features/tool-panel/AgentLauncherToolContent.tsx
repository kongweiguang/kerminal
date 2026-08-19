// @author kongweiguang
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AgentWorkflowController,
  useAgentWorkflowController,
} from "../agent-workflow";
import { cn } from "../../lib/cn";
import type { DesktopNotificationSettings } from "../../lib/desktopNotificationPolicy";
import {
  agentSessionRecordId,
  agentSessionRecordAgentId,
  agentSessionRecordTarget,
  getExternalAgentWorkspaceStatus,
  listAgentSessions,
  prepareExternalAgentWorkspace,
  updateAgentSession,
  type AgentSessionRecord,
  type AgentSessionScope,
  type AgentSessionTargetRequest,
  type ExternalAgentId,
  type ExternalAgentLaunchSpec,
  type ExternalAgentWorkspaceStatus,
} from "../../lib/agentLauncherApi";
import type { TerminalAgentSignal } from "../../lib/terminalApi";
import {
  buildUserFacingError,
  redactSensitiveTechnicalDetail,
  type UserFacingMessage,
} from "../../lib/userFacingMessage";
import {
  defaultTerminalAppearance,
  type ResolvedTheme,
  type TerminalAppearance,
} from "../settings/contracts/index";
import {
  isTerminalSessionTab,
  type TerminalPane,
  type TerminalTab,
} from "../workspace/contracts/index";
import {
  agentLaunchDisplayCommand,
  applyManagedAgentLaunchTrust,
  applyAgentLaunchPermissionMode,
  agentSessionRecordPermissionMode,
  agentSupportsPermissionSkip,
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
  buildAgentSessionTarget,
  formatCurrentAgentTargetLabel,
} from "./agent-launcher/agentSessionTargetModel";
import {
  AgentTerminalView,
  type AgentTerminalSession,
} from "./agent-launcher/AgentTerminalView";
import type { AgentLaunchTargetMode } from "./agent-launcher/AgentLaunchControls";
import {
  AgentLauncherView,
  type AgentLauncherActionState,
  type AgentLauncherLoadState,
  type AgentRestoreChoice,
} from "./agent-launcher/AgentLauncherView";
import {
  findPersistedAgentSession,
  type AgentSessionSelection,
} from "./agent-launcher/agentSessionRestoreModel";
import { createAgentPromptTransport } from "./agent-launcher/agentPromptTransport";
import { useAgentSendPreview } from "./agent-launcher/useAgentSendPreview";
import { useAgentSessionDelete } from "./agent-launcher/useAgentSessionDelete";
import { useAgentSessionTitleRename } from "./agent-launcher/useAgentSessionTitleRename";
import { useAgentSendRequestCoordinator } from "./agent-launcher/useAgentSendRequestCoordinator";
import { useAgentSendRequestSnapshot } from "../agent-workflow/state/index";
import { createAgentSessionForLaunch } from "./agent-launcher/agentSessionLaunchFactory";
interface AgentLauncherToolContentProps {
  activeTab?: TerminalTab;
  desktopNotifications?: DesktopNotificationSettings;
  focusedPane?: TerminalPane;
  resolvedTheme?: ResolvedTheme;
  terminalAppearance?: TerminalAppearance;
  terminalPanes?: TerminalPane[];
  terminalTabs?: TerminalTab[];
}
type AgentLauncherScreen = "launcher" | "terminal";

/** 右栏 Agent 的默认作用域是当前 terminal Tab，显式全局会话通过稳定 global key 跨 Tab 保持。 */
export function AgentLauncherToolContent({
  activeTab,
  desktopNotifications,
  focusedPane,
  resolvedTheme = "dark",
  terminalAppearance = defaultTerminalAppearance,
  terminalPanes,
  terminalTabs,
}: AgentLauncherToolContentProps) {
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
  const [actionState, setActionState] =
    useState<AgentLauncherActionState>(null);
  const [actionError, setActionError] = useState<UserFacingMessage | null>(
    null,
  );
  const [customCommandOpen, setCustomCommandOpen] = useState(false);
  const [customCommand, setCustomCommand] = useState("");
  const [agentSessions, setAgentSessions] = useState<
    Record<string, AgentTerminalSession>
  >({});
  const [persistedAgentSessions, setPersistedAgentSessions] = useState<
    AgentSessionRecord[]
  >([]);
  const [restoreChoice, setRestoreChoice] = useState<AgentRestoreChoice | null>(
    null,
  );
  const [customLaunchTargetMode, setCustomLaunchTargetMode] =
    useState<AgentLaunchTargetMode>("current");
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
  // pending pane 只用于发送预览，Agent 的权限范围始终跟随当前 Tab/global scope。
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
  const view = viewByTabId[activeAgentViewScopeId] ?? "launcher";
  useEffect(() => {
    // 切换工作区 Tab 后恢复“当前 Tab 默认”语义；global 会话仍保留在稳定 key 中。
    setScopeOverrideId(null);
  }, [activeAgentScopeId]);
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
  const agentTechnicalDetail = useMemo(
    () =>
      redactSensitiveTechnicalDetail(
        [
          `MCP: ${status?.mcpServerRunning ? "running" : "stopped"}`,
          `Endpoint: ${status?.mcpEndpoint || "unavailable"}`,
          ...agentActions.flatMap((agent) => [
            "",
            `${agent.title}: ${agent.availabilityLabel}`,
            `  command: ${agent.cliCommand}`,
            `  config: ${agent.configPath}`,
            `  status: ${agent.statusDetail}`,
          ]),
        ].join("\n"),
      ),
    [agentActions, status],
  );
  const currentAgentTargetLabel = formatCurrentAgentTargetLabel(
    activeAgentViewScopeId === globalAgentScopeId
      ? undefined
      : effectiveFocusedPane,
    activeAgentViewScopeId === globalAgentScopeId
      ? undefined
      : activeTab,
    terminalPanes,
  );
  const currentAgentTarget = buildAgentSessionTarget(
    activeAgentViewScopeId === globalAgentScopeId
      ? undefined
      : effectiveFocusedPane,
    activeAgentViewScopeId === globalAgentScopeId
      ? undefined
      : activeTab,
  );
  const currentAgentScope: AgentSessionScope =
    activeAgentViewScopeId === globalAgentScopeId
      ? { kind: "global" }
      : activeAgentScope;

  const runAction = async (
    nextAction: ExternalAgentId,
    action: () => Promise<void>,
  ) => {
    setActionState(nextAction);
    setActionError(null);
    try {
      await action();
    } catch (error) {
      setActionError(
        buildUserFacingError(error, {
          recoveryAction: "请检查目标终端和 Agent 配置后重试。",
          title: "Agent 操作未完成",
        }),
      );
    } finally {
      setActionState(null);
    }
  };

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
  const findAgentSessionId = (
    tabId: string | undefined,
    agentId: ExternalAgentId,
    permissionMode: AgentLaunchPermissionMode,
  ) =>
    findRunningSessionForTabAgent(
      agentSidebarState,
      tabId,
      agentId,
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

  /** 激活会话并在 global 作用域时临时切换右栏视图，不复制会话到任何 Tab。 */
  const activateAgentSessionForTab = useCallback(
    (tabId: string, agentSessionId: string) => {
      if (tabId === globalAgentScopeId) {
        setScopeOverrideId(tabId);
      }
      setActiveSessionIdByTabId((current) => ({
        ...current,
        [tabId]: agentSessionId,
      }));
      setTabView(tabId, "terminal");
    },
    [globalAgentScopeId, setTabView],
  );

  useAgentSendRequestCoordinator({
    activeTab,
    agentScopeId: activeAgentScopeId,
    createPreview: sendPreview.create,
    onActivateSession: activateAgentSessionForTab,
    preferredSessionId: activeAgentSession?.agentSessionId,
    request: pendingAgentSendRequest,
    sessions: agentSessionList,
    setActionError,
    targetPane: requestedPane,
  });

  const resolvePersistedAgentSession = async (
    tabId: string,
    agentId: ExternalAgentId,
  ) => {
    const current = findPersistedAgentSession(
      tabId,
      agentId,
      persistedAgentSessions,
    );
    if (current) {
      return current;
    }
    try {
      const list = await listAgentSessions();
      setPersistedAgentSessions(list.sessions ?? []);
      return findPersistedAgentSession(tabId, agentId, list.sessions ?? []);
    } catch {
      return null;
    }
  };

  const launchPreparedSpec = async (
    spec: ExternalAgentLaunchSpec,
    options: {
      customCommand?: string;
      permissionMode?: AgentLaunchPermissionMode;
      scope?: AgentSessionScope;
      tabId: string;
      target?: AgentSessionTargetRequest;
    },
  ) => {
    const permissionMode = options.permissionMode ?? "default";
    const launchSpec = applyAgentLaunchPermissionMode(
      applyManagedAgentLaunchTrust(spec),
      permissionMode,
    );
    const agentSessionId = launchSpec.agentSessionId?.trim();
    if (!agentSessionId) {
      throw new Error("Agent session launch spec is missing agentSessionId.");
    }
    const commandLabel =
      agentLaunchDisplayCommand(launchSpec) || launchSpec.title;
    if (agentSupportsPermissionSkip(launchSpec.agentId)) {
      await updateAgentSession(agentSessionId, {
        launch: {
          args: launchSpec.args ?? [],
          commandLabel,
          cwd: launchSpec.cwd,
          shell: launchSpec.shell,
        },
      });
    }
    const nextSession: AgentTerminalSession = {
      agentSessionId,
      agentId: launchSpec.agentId,
      args: launchSpec.args ?? [],
      commandLabel,
      cwd: launchSpec.cwd,
      env: launchSpec.env,
      permissionMode,
      scope: options.scope,
      shell: launchSpec.shell,
      status: launchSpec.status ?? "running",
      title: launchSpec.agentId === "custom" ? "Custom" : launchSpec.title,
      customCommand: options.customCommand,
      tabId: options.tabId,
      target: options.target,
    };
    setAgentSessions((current) => ({
      ...current,
      [nextSession.agentSessionId]: nextSession,
    }));
    setRestoreChoice(null);
    activateAgentSessionForTab(options.tabId, nextSession.agentSessionId);
  };

  const handleAgentSignal = useCallback((signal: TerminalAgentSignal) => {
    const agentSessionId = signal.agentSessionId?.trim();
    if (!agentSessionId) {
      return;
    }
    setAgentSessions((current) => {
      const session = current[agentSessionId];
      if (!session) {
        return current;
      }
      if (session.agentId !== "custom" && session.agentId !== signal.agent) {
        return current;
      }
      if (
        session.agentSignal?.terminalSessionId === signal.terminalSessionId &&
        session.agentSignal?.agent === signal.agent &&
        session.agentSignal?.status === signal.status
      ) {
        return current;
      }
      return {
        ...current,
        [agentSessionId]: {
          ...session,
          agentSignal: signal,
        },
      };
    });
    for (const listener of workflowSignalListenersRef.current) {
      listener(signal);
    }
  }, []);

  const prepareAndLaunchAgent = async (
    agentId: ExternalAgentId,
    agentSession: AgentSessionSelection,
    options: {
      customCommand?: string;
      permissionMode?: AgentLaunchPermissionMode;
      resumeProviderSession?: boolean;
    } = {},
  ) => {
    const launchSpec = await prepareExternalAgentWorkspace({
      agentId,
      agentSessionId: agentSession.agentSessionId,
      ...(options.customCommand !== undefined
        ? { customCommand: options.customCommand }
        : {}),
      ...(options.resumeProviderSession !== undefined
        ? { resumeProviderSession: options.resumeProviderSession }
        : {}),
    });
    await launchPreparedSpec(launchSpec, {
      customCommand: options.customCommand,
      permissionMode: options.permissionMode,
      scope: agentSession.scope,
      tabId: agentSession.tabId,
      target: agentSession.target,
    });
    await loadPersistedAgentSessions();
    await loadStatus("refreshing");
  };

  /** 创建新的 provider 会话；scope 显式传入时不受当前 focused pane 影响。 */
  const startNewProviderAgentSession = async (
    agentId: ExternalAgentId,
    permissionMode: AgentLaunchPermissionMode = "default",
    targetMode: AgentLaunchTargetMode = "current",
    scope?: AgentSessionScope,
  ) => {
    const agentSession = await createAgentSessionForLaunch(agentId, {
      activeTab,
      focusedPane: effectiveFocusedPane,
      scope,
      tabId: activeAgentScopeId,
      targetMode,
    });
    await prepareAndLaunchAgent(agentId, agentSession, {
      permissionMode,
      resumeProviderSession: false,
    });
  };

  /** 启动内置 Agent，并按选中的 tab/global scope 查找可恢复会话。 */
  const launchAgent = (
    agentId: ExternalAgentId,
    permissionMode: AgentLaunchPermissionMode = "default",
    targetMode: AgentLaunchTargetMode = "current",
  ) => {
    if (agentId === "custom") {
      setCustomLaunchTargetMode(targetMode);
      setRestoreChoice(null);
      setCustomCommandOpen(true);
      setActionError(null);
      return;
    }

    const launchScopeId = agentSessionScopeId(
      buildAgentSessionScope(activeTab, targetMode),
    );
    if (launchScopeId === globalAgentScopeId) {
      setScopeOverrideId(globalAgentScopeId);
    }
    const existingSessionId = findAgentSessionId(
      launchScopeId,
      agentId,
      permissionMode,
    );
    if (existingSessionId) {
      const existingSession = agentSessions[existingSessionId];
      if (existingSession) {
        setRestoreChoice({
          agentId,
          permissionMode,
          session: {
            agentSessionId: existingSession.agentSessionId,
            scope:
              existingSession.scope ??
              agentSessionScopeFromId(existingSession.tabId),
            tabId: existingSession.tabId,
            target: existingSession.target,
          },
        });
      }
      return;
    }

    void runAction(agentId, async () => {
      const persistedSession = await resolvePersistedAgentSession(
        launchScopeId,
        agentId,
      );
      if (persistedSession) {
        setRestoreChoice({
          agentId,
          permissionMode: persistedSession.permissionMode ?? permissionMode,
          session: persistedSession,
        });
        return;
      }
      await startNewProviderAgentSession(agentId, permissionMode, targetMode);
    });
  };

  /** 启动自定义 Agent，复用相同的 tab/global scope 解析规则。 */
  const launchCustomAgent = () => {
    const trimmedCommand = customCommand.trim();
    if (!trimmedCommand) {
      return;
    }
    const tabId = agentSessionScopeId(
      buildAgentSessionScope(activeTab, customLaunchTargetMode),
    );
    if (tabId === globalAgentScopeId) {
      setScopeOverrideId(globalAgentScopeId);
    }

    const existingSession = agentSessionList.find(
      (session) =>
        session.tabId === tabId &&
        session.agentId === "custom" &&
        session.customCommand === trimmedCommand,
    );
    if (existingSession) {
      activateAgentSessionForTab(tabId, existingSession.agentSessionId);
      return;
    }

    void runAction("custom", async () => {
      setRestoreChoice(null);
      const agentSession = await createAgentSessionForLaunch("custom", {
        activeTab,
        focusedPane: effectiveFocusedPane,
        tabId,
        targetMode: customLaunchTargetMode,
      });
      const launchSpec = await prepareExternalAgentWorkspace({
        agentId: "custom",
        agentSessionId: agentSession.agentSessionId,
        customCommand: trimmedCommand,
      });
      await launchPreparedSpec(launchSpec, {
        customCommand: trimmedCommand,
        permissionMode: "default",
        scope: agentSession.scope,
        tabId: agentSession.tabId,
        target: agentSession.target,
      });
      await loadPersistedAgentSessions();
      await loadStatus("refreshing");
    });
  };

  const continuePersistedAgentSession = (choice: AgentRestoreChoice) => {
    const runningSession = agentSessions[choice.session.agentSessionId];
    if (runningSession) {
      setRestoreChoice(null);
      activateAgentSessionForTab(
        runningSession.tabId,
        runningSession.agentSessionId,
      );
      return;
    }
    void runAction(choice.agentId, async () => {
      await prepareAndLaunchAgent(choice.agentId, choice.session, {
        permissionMode: choice.permissionMode,
        resumeProviderSession: true,
      });
    });
  };

  /** 从恢复提示创建同一作用域的新会话，避免 global 会话落回当前 Tab。 */
  const createFreshAgentSession = (choice: AgentRestoreChoice) => {
    void runAction(choice.agentId, async () => {
      const globalScopeId = agentSessionScopeId({ kind: "global" });
      await startNewProviderAgentSession(
        choice.agentId,
        choice.permissionMode,
        choice.session.tabId === globalScopeId ? "unbound" : "current",
        choice.session.tabId === globalScopeId
          ? { kind: "global" }
          : { kind: "tab", tabId: choice.session.tabId },
      );
    });
  };

  /** 继续历史会话时从记录 scope 计算运行态归属，而不是借用当前 focused pane。 */
  const continueWorkflowSession = (agentSessionId: string) => {
    const runningSession = agentSessions[agentSessionId];
    if (runningSession) {
      activateAgentSessionForTab(runningSession.tabId, agentSessionId);
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
    void runAction(agentId, async () => {
      await prepareAndLaunchAgent(
        agentId,
        {
          agentSessionId,
          scope: agentSessionScopeFromId(recordScopeId),
          tabId: recordScopeId,
          target: agentSessionRecordTarget(record),
        },
        {
          permissionMode: agentSessionRecordPermissionMode(record),
          resumeProviderSession: true,
        },
      );
      await workflowController.refresh();
    });
  };

  const startNewWorkflowSession = (agentSessionId: string) => {
    const workflowSession = workflowSnapshot.sessions.find(
      (session) => session.agentSessionId === agentSessionId,
    );
    const agentId = workflowSession?.agentId;
    if (!agentId) {
      return;
    }
    const sourceScope =
      workflowSession.scope ??
      (workflowSession.target?.liveStatus === "unbound"
        ? { kind: "global" as const }
        : workflowSession.target?.tabId
          ? { kind: "tab" as const, tabId: workflowSession.target.tabId }
          : activeAgentScope);
    if (sourceScope.kind === "global") {
      setScopeOverrideId(globalAgentScopeId);
    }
    void runAction(agentId, async () => {
      await startNewProviderAgentSession(
        agentId,
        "default",
        sourceScope.kind === "global" ? "unbound" : "current",
        sourceScope,
      );
      await workflowController.refresh();
    });
  };

  return (
    <section className="relative h-full min-h-0 overflow-hidden bg-[var(--surface-terminal)]">
      <AgentLauncherView
        actionError={actionError}
        actionState={actionState}
        agentActions={agentActions}
        agentTechnicalDetail={agentTechnicalDetail}
        currentAgentScope={currentAgentScope}
        currentAgentTarget={currentAgentTarget}
        currentAgentTargetLabel={currentAgentTargetLabel}
        customCommand={customCommand}
        customCommandOpen={customCommandOpen}
        deletingSessionId={deletingSessionId}
        loadError={loadError}
        loadState={loadState}
        pendingSendRequest={pendingAgentSendRequest}
        onCancelRestore={() => setRestoreChoice(null)}
        onContinueRestore={continuePersistedAgentSession}
        onCustomCommandChange={setCustomCommand}
        onCustomCommandSubmit={launchCustomAgent}
        onLaunch={launchAgent}
        onNewSession={createFreshAgentSession}
        onRetry={() => void loadStatus("loading")}
        onWorkflowContinue={continueWorkflowSession}
        onWorkflowDelete={deleteWorkflowSession}
        onWorkflowNewSession={startNewWorkflowSession}
        onWorkflowRename={renameWorkflowSession}
        renamingSessionId={renamingSessionId}
        restoreChoice={restoreChoice}
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
