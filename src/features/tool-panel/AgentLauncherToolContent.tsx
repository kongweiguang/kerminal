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
  type AgentSessionRecord,
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
  buildAgentLauncherViewModel,
  type AgentLaunchPermissionMode,
} from "./agent-launcher/agentLauncherModel";
import { initialAgentActions } from "./agent-launcher/agentLauncherInitialActions";
import {
  agentSessionScopeId,
  findRunningSessionForTabAgent,
  restorableSessionsForTab,
  tabRemovedCleanupPlan,
  visibleAgentSessionForTab,
  type AgentSidebarSessionState,
} from "./agent-launcher/agentTabSessionModel";
import {
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
  type AgentSessionSelection,
} from "./agent-launcher/AgentLauncherView";
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
  const effectiveFocusedPane = requestedPane ?? focusedPane;
  const { renameSession: renameWorkflowSession, renamingSessionId } =
    useAgentSessionTitleRename({
      controller: workflowController,
      setActionError,
      setPersistedSessions: setPersistedAgentSessions,
      setRuntimeSessions: setAgentSessions,
    });
  const activeAgentTabId = isTerminalSessionTab(activeTab)
    ? activeTab.id
    : undefined;
  const activeAgentScopeId = agentSessionScopeId(activeAgentTabId);
  const view = viewByTabId[activeAgentScopeId] ?? "launcher";
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
    effectiveFocusedPane,
    activeTab,
  );
  const currentAgentTarget = buildAgentSessionTarget(
    effectiveFocusedPane,
    activeTab,
  );

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
    () => visibleAgentSessionForTab(agentSidebarState, activeAgentScopeId),
    [activeAgentScopeId, agentSidebarState],
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

  const activateAgentSessionForTab = useCallback(
    (tabId: string, agentSessionId: string) => {
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
    agentScopeId: activeAgentScopeId,
    createPreview: sendPreview.create,
    onActivateSession: activateAgentSessionForTab,
    preferredSessionId: activeAgentSession?.agentSessionId,
    request: pendingAgentSendRequest,
    sessions: agentSessionList,
    setActionError,
    targetPane: requestedPane,
  });

  const findPersistedAgentSession = (
    tabId: string,
    agentId: ExternalAgentId,
    records: AgentSessionRecord[],
  ) => {
    for (const record of restorableSessionsForTab(records, tabId)) {
      if (agentSessionRecordAgentId(record) !== agentId) {
        continue;
      }
      try {
        return {
          agentSessionId: agentSessionRecordId(record),
          tabId,
          target: agentSessionRecordTarget(record),
        } satisfies AgentSessionSelection;
      } catch {
        continue;
      }
    }
    return null;
  };

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

  const launchPreparedSpec = (
    spec: ExternalAgentLaunchSpec,
    options: {
      customCommand?: string;
      permissionMode?: AgentLaunchPermissionMode;
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
    const nextSession: AgentTerminalSession = {
      agentSessionId,
      agentId: launchSpec.agentId,
      args: launchSpec.args ?? [],
      commandLabel: agentLaunchDisplayCommand(launchSpec) || launchSpec.title,
      cwd: launchSpec.cwd,
      env: launchSpec.env,
      permissionMode,
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
    launchPreparedSpec(launchSpec, {
      customCommand: options.customCommand,
      permissionMode: options.permissionMode,
      tabId: agentSession.tabId,
      target: agentSession.target,
    });
    await loadPersistedAgentSessions();
    await loadStatus("refreshing");
  };

  const startNewProviderAgentSession = async (
    agentId: ExternalAgentId,
    permissionMode: AgentLaunchPermissionMode = "default",
    targetMode: AgentLaunchTargetMode = "current",
  ) => {
    const agentSession = await createAgentSessionForLaunch(agentId, {
      activeTab,
      focusedPane: effectiveFocusedPane,
      tabId: activeAgentScopeId,
      targetMode,
    });
    await prepareAndLaunchAgent(agentId, agentSession, {
      permissionMode,
      resumeProviderSession: false,
    });
  };

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

    const existingSessionId = findAgentSessionId(
      activeAgentScopeId,
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
            tabId: existingSession.tabId,
            target: existingSession.target,
          },
        });
      }
      return;
    }

    void runAction(agentId, async () => {
      const persistedSession = await resolvePersistedAgentSession(
        activeAgentScopeId,
        agentId,
      );
      if (persistedSession) {
        setRestoreChoice({
          agentId,
          permissionMode,
          session: persistedSession,
        });
        return;
      }
      await startNewProviderAgentSession(agentId, permissionMode, targetMode);
    });
  };

  const launchCustomAgent = () => {
    const trimmedCommand = customCommand.trim();
    if (!trimmedCommand) {
      return;
    }
    const tabId = activeAgentScopeId;

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
      launchPreparedSpec(launchSpec, {
        customCommand: trimmedCommand,
        permissionMode: "default",
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

  const createFreshAgentSession = (choice: AgentRestoreChoice) => {
    void runAction(choice.agentId, async () => {
      await startNewProviderAgentSession(choice.agentId, choice.permissionMode);
    });
  };

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
    void runAction(agentId, async () => {
      await prepareAndLaunchAgent(
        agentId,
        {
          agentSessionId,
          tabId: activeAgentScopeId,
          target: agentSessionRecordTarget(record),
        },
        { resumeProviderSession: true },
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
    void runAction(agentId, async () => {
      await startNewProviderAgentSession(agentId);
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
                setTabView(activeAgentScopeId, "launcher");
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
