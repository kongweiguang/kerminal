// @author kongweiguang
import { useCallback, useRef, useState } from "react";
import type { MachineSidebarViewMode } from "../features/machine-sidebar/MachineSidebar.shared";
import { resolveThemeMode } from "../features/settings/settingsModel";
import { writeBroadcastCommand } from "../features/terminal/terminalSessionRegistry";
import { useWorkspaceStore } from "../features/workspace/workspaceStore";
import { resolveDesktopPlatform } from "../lib/desktopPlatform";
// @author kongweiguang

import {
  createRemoteHostGroup,
  updateRemoteHost,
} from "../lib/remoteHostApi";
import { useDocumentTheme } from "../lib/useDocumentTheme";
import { useTauriWindowFrameState } from "../lib/useTauriWindowFrameState";
import { resolveWindowChromeModel } from "../lib/windowChromeModel";
import {
  htmlLanguage,
  useSystemThemePreference,
  useViewportWidth,
} from "./KerminalShell.helpers";
import { useKerminalShellRemoteActions } from "./useKerminalShellRemoteActions";
import { useKerminalShellBackgroundStyle } from "./useKerminalShellBackgroundStyle";
import { useKerminalShellCommands } from "./useKerminalShellCommands";
import { useKerminalShellContainerActions } from "./useKerminalShellContainerActions";
import { useKerminalShellNavigation } from "./useKerminalShellNavigation";
import { useKerminalShellConfigRefresh } from "./useKerminalShellConfigRefresh";
import { useKerminalShellPanelResize } from "./useKerminalShellPanelResize";
import { useKerminalShellSettings } from "./useKerminalShellSettings";
import { useKerminalShellSftpHostCreate } from "./useKerminalShellSftpHostCreate";
import { useKerminalShellTabClose } from "./useKerminalShellTabClose";
import { KerminalShellLayout } from "./KerminalShell.layout";
import {
  useKerminalShellRemoteTargetModel,
  useKerminalShellViewModel,
} from "./kerminalShellViewModel";
import { useKerminalShellStartupSync } from "./useKerminalShellStartupSync";
import { useKerminalShellSnippetBridge } from "./useKerminalShellSnippetBridge";
import { useKerminalShellTerminalDrop } from "./useKerminalShellTerminalDrop";
import { archiveAgentSessionsForClosedTabs } from "./agentSessionTabCloseCleanup";

export function KerminalShell() {
  const activeTabId = useWorkspaceStore((state) => state.activeTabId);
  const activeTool = useWorkspaceStore((state) => state.activeTool);
  const focusedPaneId = useWorkspaceStore((state) => state.focusedPaneId);
  const machineGroups = useWorkspaceStore((state) => state.machineGroups);
  const machineSearch = useWorkspaceStore((state) => state.machineSearch);
  const selectedMachineId = useWorkspaceStore(
    (state) => state.selectedMachineId,
  );
  const addDockerContainer = useWorkspaceStore(
    (state) => state.addDockerContainer,
  );
  const addLocalProfileMachine = useWorkspaceStore(
    (state) => state.addLocalProfileMachine,
  );
  const focusPane = useWorkspaceStore((state) => state.focusPane);
  const addTerminalTab = useWorkspaceStore((state) => state.addTerminalTab);
  const closePane = useWorkspaceStore((state) => state.closePane);
  const closeTerminalTab = useWorkspaceStore((state) => state.closeTerminalTab);
  const openLocalTerminal = useWorkspaceStore(
    (state) => state.openLocalTerminal,
  );
  const openContainerTerminal = useWorkspaceStore(
    (state) => state.openContainerTerminal,
  );
  const openDockerContainerTerminal = useWorkspaceStore(
    (state) => state.openDockerContainerTerminal,
  );
  const openSshTerminal = useWorkspaceStore((state) => state.openSshTerminal);
  const openSshCommandTerminal = useWorkspaceStore(
    (state) => state.openSshCommandTerminal,
  );
  const openTelnetTerminal = useWorkspaceStore(
    (state) => state.openTelnetTerminal,
  );
  const openSerialTerminal = useWorkspaceStore(
    (state) => state.openSerialTerminal,
  );
  const openSftpTransferTab = useWorkspaceStore(
    (state) => state.openSftpTransferTab,
  );
  const openWorkspaceFileTab = useWorkspaceStore(
    (state) => state.openWorkspaceFileTab,
  );
  const removeSidebarMachine = useWorkspaceStore(
    (state) => state.removeSidebarMachine,
  );
  const renameMachineGroup = useWorkspaceStore(
    (state) => state.renameMachineGroup,
  );
  const selectMachine = useWorkspaceStore((state) => state.selectMachine);
  const selectTab = useWorkspaceStore((state) => state.selectTab);
  const setActiveTool = useWorkspaceStore((state) => state.setActiveTool);
  const setMachineSearch = useWorkspaceStore((state) => state.setMachineSearch);
  const setProfiles = useWorkspaceStore((state) => state.setProfiles);
  const setRemoteHostTree = useWorkspaceStore(
    (state) => state.setRemoteHostTree,
  );
  const splitFocusedPane = useWorkspaceStore((state) => state.splitFocusedPane);
  const updateLocalMachine = useWorkspaceStore(
    (state) => state.updateLocalMachine,
  );
  const moveSidebarMachine = useWorkspaceStore(
    (state) => state.moveSidebarMachine,
  );
  const pinMachineGroup = useWorkspaceStore((state) => state.pinMachineGroup);
  const terminalTabs = useWorkspaceStore((state) => state.terminalTabs);
  const workspaceFileDirtyState = useWorkspaceStore(
    (state) => state.workspaceFileDirtyState,
  );
  const profiles = useWorkspaceStore((state) => state.profiles);
  const activeProfileId = useWorkspaceStore((state) => state.activeProfileId);
  const settings = useWorkspaceStore((state) => state.settings);
  const setSettings = useWorkspaceStore((state) => state.setSettings);
  const viewportWidth = useViewportWidth();
  const [shellNoticeVisible, setShellNoticeVisible] = useState(false);
  const [machineSidebarView, setMachineSidebarView] =
    useState<MachineSidebarViewMode>("hosts");
  const [hostContainersHostId, setHostContainersHostId] = useState<
    string | null
  >(null);
  const [
    hostContainersInitialContainerId,
    setHostContainersInitialContainerId,
  ] = useState<string>();
  const workspaceFrameRef = useRef<HTMLDivElement>(null);
  const {
    handleSettingsChange,
    handleSettingsDialogChange,
    handleSettingsDialogClose,
    openSettingsTool,
    settingsDialogDirtyRef,
    settingsDialogOpen,
    settingsDialogOpenRef,
    settingsInitialSectionId,
    settingsLoadError,
    settingsSaveError,
    settingsSaveState,
    settingsSaveStateRef,
  } = useKerminalShellSettings({ setSettings });
  const systemPrefersDark = useSystemThemePreference();
  const resolvedTheme = resolveThemeMode(settings.themeMode, systemPrefersDark);
  const desktopPlatform = resolveDesktopPlatform();
  const windowFrameState = useTauriWindowFrameState();
  const windowChrome = resolveWindowChromeModel({
    frameState: windowFrameState,
    platform: desktopPlatform,
  });
  useDocumentTheme({
    density: settings.interfaceDensity,
    desktopPlatform,
    language: settings.appearance.interfaceLanguage,
    lang: htmlLanguage(settings.appearance.interfaceLanguage),
    theme: resolvedTheme,
    windowFrame: windowFrameState,
  });
  const {
    beginPanelResize,
    collapsedMachineGroupIds,
    compactShell,
    effectiveLeftPanelCollapsed,
    effectiveRightPanelOpen,
    gridTemplateColumns,
    handleCollapsedMachineGroupIdsChange,
    handleWorkspaceShellLayoutRestored,
    leftPanelCollapsed,
    resizeWithKeyboard,
    rightWorkspaceInset,
    setLeftPanelCollapsed,
    workspaceShellLayout,
  } = useKerminalShellPanelResize({
    activeTool,
    viewportWidth,
    workspaceFrameRef,
  });
  const workspaceBackgroundStyle = useKerminalShellBackgroundStyle({
    resolvedTheme,
    settings,
  });
  const handleTabsClosed = useCallback((tabIds: string[]) => {
    void archiveAgentSessionsForClosedTabs(tabIds).catch((error) => {
      console.error("Failed to archive Agent sessions for closed tabs", error);
    });
  }, []);
  const { defaultRemoteGroupId, defaultRemoteHostId } =
    useKerminalShellRemoteTargetModel(machineGroups);
  const {
    handleExternalMachineDrag,
    handleExternalMachineDragEnd,
    handleExternalMachineDrop,
    terminalSplitDropIndicator,
  } = useKerminalShellTerminalDrop({
    activeTabId,
    focusedPaneId,
    splitFocusedPane,
    terminalTabs,
  });
  const {
    cancelDirtyFileTabs,
    cancelTerminalTabs,
    confirmDirtyFileTabs,
    confirmTerminalTabs,
    dirtyFileTabCount,
    pendingDirtyFileTabCount,
    pendingTerminalTabCount,
    requestCloseTab,
  } = useKerminalShellTabClose({
    closeTerminalTab,
    confirmTerminalClose: settings.terminal.confirmCloseTab,
    onTabsClosed: handleTabsClosed,
    removeSidebarMachine,
    terminalTabs,
    workspaceFileDirtyState,
  });
  const { activateTool, openLogsTool } = useKerminalShellCommands({
    activeTabId,
    activeTool,
    addTerminalTab,
    closePane,
    closeTerminalTab: requestCloseTab,
    focusPane,
    focusedPaneId,
    keybindings: settings.keybindings,
    openSettingsTool,
    selectTab,
    setActiveTool,
    splitFocusedPane,
    terminalTabs,
  });
  useKerminalShellSnippetBridge({ activateTool, focusPane });
  const {
    enterHostContainer,
    openContainerDetails,
    openHostContainerLogs,
    openHostContainersSidebar,
    openSftpForMachine,
    openSftpTransferWorkbench,
    selectHostContainersHost,
  } = useKerminalShellNavigation({
    activeTool,
    machineGroups,
    openDockerContainerTerminal,
    openSftpTransferTab,
    openSshCommandTerminal,
    selectMachine,
    setActiveTool,
    setHostContainersHostId,
    setHostContainersInitialContainerId,
    setMachineSidebarView,
  });
  const {
    closeConnectionDialog,
    closeRemoteGroupDialog,
    confirmDelete,
    deleteError,
    deleteSaving,
    editingLocalMachine,
    editingRemoteGroup,
    editingRemoteHost,
    handleCreateLocalProfile,
    handleCreateRemoteHost,
    handleDuplicateMachine,
    handleMoveMachineToGroup,
    handlePinMachineGroup,
    handleRemoteGroupSaved,
    handleRemoteGroupUpdate,
    handleRemoteHostCreated,
    handleUpdateLocalProfile,
    openConnectionDialog,
    openRemoteGroupDialog,
    openSavedRdpMachine,
    pendingDelete,
    profileLoadError,
    refreshProfiles,
    refreshRemoteHostTree,
    rdpOpeningMachineIds,
    remoteGroupDialogOpen,
    remoteHostDefaultGroupId,
    remoteHostDefaultMode,
    remoteHostDialogOpen,
    remoteHostLoadError,
    requestDeleteGroup,
    requestDeleteMachine,
    resolveTargetGroupId,
    setDeleteError,
    setPendingDelete,
    setProfileLoadError,
  } = useKerminalShellRemoteActions({
    activeProfileId,
    addLocalProfileMachine,
    addTerminalTab,
    defaultRemoteGroupId,
    machineGroups,
    moveSidebarMachine,
    pinMachineGroup,
    profiles,
    removeSidebarMachine,
    renameMachineGroup,
    selectMachine,
    setProfiles,
    setRemoteHostTree,
    updateLocalMachine,
  });
  const {
    configCatalogRevisions,
    configNotice,
    configRefreshCoordinator,
    setConfigNotice,
  } = useKerminalShellConfigRefresh({
    machineGroups,
    profiles,
    refreshProfiles,
    refreshRemoteHostTree,
    setSettings,
    settings,
    settingsDialogDirtyRef,
    settingsDialogOpenRef,
    settingsSaveStateRef,
  });
  const {
    fetchContainerStats,
    inspectContainer,
    listDockerContainers: loadDockerContainers,
    pinHostContainer,
    runHostContainerLifecycleAction,
  } = useKerminalShellContainerActions({
    addDockerContainer,
    defaultRemoteGroupId,
    machineGroups,
    resolveTargetGroupId,
  });
  const {
    connectionConfigConflict,
    leftTitleBarInset,
    remoteGroupConfigConflict,
    reserveRightTitleBarControls,
    rightToolRailTitleBarFillWidth,
    shellNoticeMessage,
  } = useKerminalShellViewModel({
    activeTool,
    compactShell,
    editingLocalMachine,
    editingRemoteGroup,
    editingRemoteHost,
    effectiveLeftPanelCollapsed,
    interfaceDensity: settings.interfaceDensity,
    machineGroups,
    profileLoadError,
    remoteHostLoadError,
    settingsLoadError,
    windowChrome,
  });
  const {
    createdSftpHostTarget,
    handleConnectionDialogClose,
    handleConnectionDialogCreated,
    openSftpTransferHostCreateDialog,
  } = useKerminalShellSftpHostCreate({
    closeConnectionDialog,
    handleRemoteHostCreated,
    openConnectionDialog,
  });
  useKerminalShellStartupSync({
    configRefreshCoordinator, handleWorkspaceShellLayoutRestored,
    refreshRemoteHostTree, settingsDialogDirtyRef, settingsSaveState,
    setProfileLoadError, setProfiles, setShellNoticeVisible,
    shellNoticeMessage, workspaceShellLayout,
  });

  return (
    <KerminalShellLayout
      activeTool={activeTool}
      compactShell={compactShell}
      contextWorkspaceProps={{ onOpenSettings: openSettingsTool }}
      deleteDialogProps={{
        deleteError, deleting: deleteSaving, pendingDelete,
        onConfirm: () => void confirmDelete(),
        onClose: () => {
          if (!deleteSaving) {
            setPendingDelete(null);
            setDeleteError(null);
          }
        },
      }}
      frame={{
        backgroundStyle: workspaceBackgroundStyle, density: settings.interfaceDensity,
        desktopPlatform, gridTemplateColumns,
        lang: htmlLanguage(settings.appearance.interfaceLanguage),
        language: settings.appearance.interfaceLanguage, resolvedTheme,
        windowFrameState, workspaceFrameRef,
      }}
      leftSeparatorProps={{
        className: "kerminal-shell-separator col-[2/3] row-[2/3]",
        hidden: effectiveLeftPanelCollapsed, label: "调整主机侧边栏宽度",
        onKeyDown: (event) => resizeWithKeyboard("left", event),
        onPointerDown: (event) => beginPanelResize("left", event),
      }}
      machineSidebarProps={effectiveLeftPanelCollapsed ? null : {
        activeView: machineSidebarView, collapsed: false, collapsedGroupIds: collapsedMachineGroupIds,
        containerHostId: hostContainersHostId, containerInitialContainerId: hostContainersInitialContainerId,
        groups: machineGroups, onActiveViewChange: setMachineSidebarView,
        onAddConnection: openConnectionDialog, onAddGroup: openRemoteGroupDialog,
        onAddMachine: (groupId) => openConnectionDialog({ groupId, mode: "ssh" }),
        onCollapsedGroupIdsChange: handleCollapsedMachineGroupIdsChange,
        onContainerHostChange: selectHostContainersHost, onDeleteGroup: requestDeleteGroup,
        onDeleteMachine: requestDeleteMachine,
        onDuplicateMachine: (machineId) => void handleDuplicateMachine(machineId),
        onEditGroup: openRemoteGroupDialog, onEditMachine: (hostId) => openConnectionDialog({ hostId }),
        onEnterContainer: enterHostContainer, onExternalMachineDrag: handleExternalMachineDrag,
        onExternalMachineDragEnd: handleExternalMachineDragEnd,
        onExternalMachineDrop: handleExternalMachineDrop,
        onFetchContainerStats: fetchContainerStats, onInspectContainer: inspectContainer,
        onLifecycleContainer: runHostContainerLifecycleAction, onListDockerContainers: loadDockerContainers,
        onMoveMachine: (machineId, groupId) => void handleMoveMachineToGroup(machineId, groupId),
        onOpenContainerDetails: openContainerDetails,
        onOpenContainerLogs: openHostContainerLogs, onOpenContainerTerminal: openContainerTerminal,
        onOpenHostContainers: openHostContainersSidebar, onOpenLocalTerminal: openLocalTerminal,
        onOpenRdpConnection: openSavedRdpMachine, onOpenSerialTerminal: openSerialTerminal,
        onOpenSettings: openSettingsTool, onOpenSftp: openSftpForMachine,
        onOpenSftpTransferWorkbench: openSftpTransferWorkbench,
        onOpenSshTerminal: openSshTerminal, onOpenTelnetTerminal: openTelnetTerminal,
        onOpenTransferWorkbench: openSftpTransferWorkbench,
        onOpenWorkspaceFileTab: openWorkspaceFileTab,
        onPinContainer: pinHostContainer,
        onPinGroup: (groupId, pinned) => void handlePinMachineGroup(groupId, pinned),
        onSearchChange: setMachineSearch, onSelectMachine: selectMachine,
        rdpOpeningMachineIds, search: machineSearch, selectedMachineId,
        settingsSelected: settingsDialogOpen,
      }}
      noticesProps={{
        configNotice, shellNoticeMessage, shellNoticeVisible,
        onConfigNoticeDismiss: () => setConfigNotice(null),
        onShellNoticeDismiss: () => setShellNoticeVisible(false),
      }}
      onActiveToolChange={activateTool}
      onCloseToolPanel={() => setActiveTool(null)}
      remoteGroupDialogProps={remoteGroupDialogOpen ? {
        externalConfigConflict: remoteGroupConfigConflict?.message, group: editingRemoteGroup,
        onClose: closeRemoteGroupDialog, onCreateGroup: createRemoteHostGroup,
        onCreated: handleRemoteGroupSaved, onUpdateGroup: handleRemoteGroupUpdate,
        open: remoteGroupDialogOpen,
      } : null}
      remoteHostDialogProps={remoteHostDialogOpen ? {
        defaultGroupId: remoteHostDefaultGroupId ?? defaultRemoteGroupId,
        defaultMode: remoteHostDefaultMode, editingHost: editingRemoteHost,
        editingLocalMachine, externalConfigConflict: connectionConfigConflict?.message,
        groups: machineGroups, onClose: handleConnectionDialogClose,
        onCreateGroup: createRemoteHostGroup, onCreateHost: handleCreateRemoteHost,
        onCreateLocal: handleCreateLocalProfile, onCreated: handleConnectionDialogCreated,
        onGroupCreated: handleRemoteGroupSaved, onUpdateHost: updateRemoteHost,
        onUpdateLocal: handleUpdateLocalProfile, open: remoteHostDialogOpen,
      } : null}
      rightSeparatorProps={{
        className: "kerminal-shell-separator relative z-20",
        hidden: !effectiveRightPanelOpen, label: "调整工具面板宽度",
        onKeyDown: (event) => resizeWithKeyboard("tools", event),
        onPointerDown: (event) => beginPanelResize("tools", event),
        style: { gridColumn: "4 / 5", gridRow: "2 / 3" },
      }}
      settingsDialogProps={settingsDialogOpen ? {
        initialSectionId: settingsInitialSectionId, onClose: handleSettingsDialogClose,
        onSettingsChange: handleSettingsDialogChange, open: settingsDialogOpen,
        saveError: settingsSaveError, saveState: settingsSaveState, settings,
      } : null}
      shellWindowChromeProps={{
        desktopPlatform, leftPanelCollapsed,
        onLeftPanelCollapsedChange: setLeftPanelCollapsed, resolvedTheme,
        rightToolRailTitleBarFillWidth, windowFrameState,
      }}
      tabsConfirmationProps={{
        onClose: cancelTerminalTabs,
        onConfirm: confirmTerminalTabs, tabCount: pendingTerminalTabCount,
      }}
      toolPanelProps={{
        activeTool, defaultRemoteGroupId, defaultRemoteHostId, machineGroups,
        onActiveToolChange: activateTool, onCreateTerminal: addTerminalTab,
        onFocusTab: selectTab, onOpenSettingsSection: openSettingsTool,
        onOpenSshTerminal: openSshTerminal, onRemoteHostCreated: refreshRemoteHostTree,
        onSettingsChange: handleSettingsChange, onSplitPane: splitFocusedPane,
        resolvedTheme, settings, snippetConfigRevision: configCatalogRevisions.snippets,
        terminalAppearance: settings.terminal,
        workflowConfigRevision: configCatalogRevisions.workflows,
      }}
      workspaceFileConfirmationProps={{
        dirtyTabCount: dirtyFileTabCount,
        onClose: cancelDirtyFileTabs,
        onConfirm: confirmDirtyFileTabs,
        tabCount: pendingDirtyFileTabCount,
      }}
      workspaceTerminalProps={{
        contentRightInset: rightWorkspaceInset, createdSftpHostTarget,
        desktopNotifications: settings.desktopNotifications,
        interfaceDensity: settings.interfaceDensity, leftTitleBarInset,
        machineGroups, onBroadcastCommand: writeBroadcastCommand,
        onCreateSftpHost: openSftpTransferHostCreateDialog,
        onOpenAgentTool: () => setActiveTool("agentLauncher"),
        onOpenConnection: () => openConnectionDialog({ mode: "ssh" }),
        onOpenLogs: openLogsTool, reserveRightTitleBarControls,
        resolvedTheme, splitDropIndicator: terminalSplitDropIndicator,
        terminalAppearance: settings.terminal,
      }}
    />
  );
}
