// @author kongweiguang

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { MachineSidebar } from "../features/machine-sidebar/MachineSidebar";
import type { MachineSidebarProps } from "../features/machine-sidebar/MachineSidebar.shared";
import type {
  SftpTransferCreatedHostTarget,
  SftpTransferCreateHostRequest,
} from "../features/sftp/SftpTransferWorkbench";
import type {
  InterfaceDensity,
  ResolvedTheme,
  TerminalAppearance,
  AppSettings,
} from "../features/settings/settingsModel";
import { LazySftpTransferWorkbench as SftpTransferWorkbench } from "../features/sftp/LazySftpTransferWorkbench";
import { LazyWorkspaceFileTabSurface as WorkspaceFileTabSurface } from "../features/workspace/LazyWorkspaceFileTabSurface";
import {
  type BroadcastCommandRequest,
  type BroadcastCommandResult,
  TerminalWorkspace,
} from "../features/terminal/TerminalWorkspace";
import type { TerminalSplitDropIndicator } from "../features/terminal/TerminalSplitDropOverlay";
import type { ConnectionState } from "../features/terminal/XtermPane.helpers";
import { ToolPanel } from "../features/tool-panel/ToolPanel";
import type {
  MachineGroup,
  MachineStatus,
  TerminalSplitDirection,
  ToolId,
} from "../features/workspace/types";
import {
  isSftpTransferWorkspaceTab,
  isWorkspaceFileTab,
} from "../features/workspace/types";
import {
  tools,
  useWorkspaceStore,
  type AddTerminalTabOptions,
  type OpenWorkspaceFileTabOptions,
  type TmuxAttachPlacement,
} from "../features/workspace/workspaceStore";
import type { SettingsSectionId } from "../features/settings/SettingsToolContent";
import type { TmuxAttachLaunch } from "../lib/tmuxApi";
import {
  buildOpenMachineIdsSnapshot,
  buildTerminalWorkspaceSnapshot,
  buildToolPanelWorkspaceContext,
  buildToolPanelWorkspaceSnapshot,
  parseOpenMachineIdsSnapshot,
  parseTerminalWorkspaceSnapshot,
} from "./KerminalShell.workspaceSelectors";

type WorkspaceTerminalSurfaceProps = {
  contentRightInset: number;
  createdSftpHostTarget?: SftpTransferCreatedHostTarget;
  desktopNotifications: AppSettings["desktopNotifications"];
  interfaceDensity: InterfaceDensity;
  machineGroups: MachineGroup[];
  onBroadcastCommand: (
    request: BroadcastCommandRequest,
  ) => Promise<BroadcastCommandResult>;
  onCreateSftpHost?: (request: SftpTransferCreateHostRequest) => void;
  onOpenAgentTool: () => void;
  onOpenConnection: () => void;
  onOpenLogs: () => void;
  leftTitleBarInset: number;
  reserveRightTitleBarControls: boolean;
  resolvedTheme: ResolvedTheme;
  splitDropIndicator?: TerminalSplitDropIndicator | null;
  terminalAppearance: TerminalAppearance;
};

type MachineSidebarStoreBridgeProps = Omit<
  MachineSidebarProps,
  "openMachineIds"
>;

interface ToolPanelStoreBridgeProps {
  activeTool: ToolId | null;
  defaultRemoteGroupId?: string;
  defaultRemoteHostId?: string;
  machineGroups: MachineGroup[];
  onActiveToolChange: (toolId: ToolId) => void;
  onCreateTerminal?: (options?: AddTerminalTabOptions) => void;
  onFocusTab?: (tabId: string) => void;
  onOpenSettingsSection?: (sectionId: SettingsSectionId) => void;
  onOpenSshTerminal?: (hostId: string) => void;
  onOpenWorkspaceFileTab?: (options: OpenWorkspaceFileTabOptions) => void;
  onOpenTmuxTerminal?: (
    launch: TmuxAttachLaunch,
    placement?: TmuxAttachPlacement,
  ) => void;
  onRemoteHostCreated?: () => void | Promise<void>;
  onSettingsChange?: (settings: AppSettings) => void;
  onSplitPane?: (direction: TerminalSplitDirection) => void;
  resolvedTheme: ResolvedTheme;
  settings: AppSettings;
  snippetConfigRevision?: number;
  terminalAppearance: TerminalAppearance;
  workflowConfigRevision?: number;
}

const subscribeToWorkspaceStore = (onStoreChange: () => void) =>
  useWorkspaceStore.subscribe(onStoreChange);

const getOpenMachineIdsSnapshot = () =>
  buildOpenMachineIdsSnapshot(useWorkspaceStore.getState());

const getToolPanelWorkspaceSnapshot = () =>
  buildToolPanelWorkspaceSnapshot(useWorkspaceStore.getState());

const getTerminalWorkspaceSnapshot = () =>
  buildTerminalWorkspaceSnapshot(useWorkspaceStore.getState());

function paneStatusForConnectionState(state: ConnectionState): MachineStatus {
  if (state === "connected") {
    return "online";
  }
  if (state === "connecting" || state === "error") {
    return "warning";
  }
  return "offline";
}

export function WorkspaceTerminalSurface({
  contentRightInset,
  createdSftpHostTarget,
  desktopNotifications,
  interfaceDensity,
  leftTitleBarInset,
  machineGroups,
  onBroadcastCommand,
  onCreateSftpHost,
  onOpenAgentTool,
  onOpenConnection,
  onOpenLogs,
  reserveRightTitleBarControls,
  resolvedTheme,
  splitDropIndicator,
  terminalAppearance,
}: WorkspaceTerminalSurfaceProps) {
  const terminalWorkspaceSnapshot = useSyncExternalStore(
    subscribeToWorkspaceStore,
    getTerminalWorkspaceSnapshot,
    getTerminalWorkspaceSnapshot,
  );
  const terminalWorkspace = useMemo(
    () => parseTerminalWorkspaceSnapshot(terminalWorkspaceSnapshot),
    [terminalWorkspaceSnapshot],
  );
  const closePane = useWorkspaceStore((state) => state.closePane);
  const closeTerminalTab = useWorkspaceStore((state) => state.closeTerminalTab);
  const setWorkspaceFileTabDirty = useWorkspaceStore(
    (state) => state.setWorkspaceFileTabDirty,
  );
  const revealWorkspaceFileInSftp = useWorkspaceStore(
    (state) => state.revealWorkspaceFileInSftp,
  );
  const addTerminalTab = useWorkspaceStore((state) => state.addTerminalTab);
  const focusPane = useWorkspaceStore((state) => state.focusPane);
  const moveTerminalPane = useWorkspaceStore((state) => state.moveTerminalPane);
  const renameTerminalTab = useWorkspaceStore(
    (state) => state.renameTerminalTab,
  );
  const selectTab = useWorkspaceStore((state) => state.selectTab);
  const setBroadcastDraft = useWorkspaceStore(
    (state) => state.setBroadcastDraft,
  );
  const splitFocusedPane = useWorkspaceStore((state) => state.splitFocusedPane);
  const updateTerminalTabGroupPreference = useWorkspaceStore(
    (state) => state.updateTerminalTabGroupPreference,
  );
  const updatePaneCurrentCwd = useWorkspaceStore(
    (state) => state.updatePaneCurrentCwd,
  );
  const updatePaneOutputHistory = useWorkspaceStore(
    (state) => state.updatePaneOutputHistory,
  );
  const updatePaneStatus = useWorkspaceStore((state) => state.updatePaneStatus);
  const updateTerminalSplitLayoutSizes = useWorkspaceStore(
    (state) => state.updateTerminalSplitLayoutSizes,
  );
  const resolvePaneLines = useCallback((paneId: string) => {
    return (
      useWorkspaceStore
        .getState()
        .terminalPanes.find((pane) => pane.id === paneId)?.lines ?? []
    );
  }, []);
  const resolvePaneOutputHistory = useCallback((paneId: string) => {
    return useWorkspaceStore
      .getState()
      .terminalPanes.find((pane) => pane.id === paneId)?.outputHistory;
  }, []);

  return (
    <TerminalWorkspace
      activeTabId={terminalWorkspace.activeTabId}
      broadcastDraft={terminalWorkspace.broadcastDraft}
      contentRightInset={contentRightInset}
      focusedPaneId={terminalWorkspace.focusedPaneId}
      interfaceDensity={interfaceDensity}
      machineGroups={machineGroups}
      onBroadcastCommand={onBroadcastCommand}
      onBroadcastDraftChange={setBroadcastDraft}
      onClosePane={closePane}
      onCloseTab={closeTerminalTab}
      onCreateTerminal={() => addTerminalTab()}
      onFocusPane={focusPane}
      onOpenAgentTool={onOpenAgentTool}
      onOpenConnection={onOpenConnection}
      onMovePane={moveTerminalPane}
      onPaneConnectionStateChange={(paneId, state) =>
        updatePaneStatus(paneId, paneStatusForConnectionState(state))
      }
      onPaneCurrentCwdChange={updatePaneCurrentCwd}
      onPaneOutputHistoryChange={updatePaneOutputHistory}
      onSplitLayoutSizesChange={updateTerminalSplitLayoutSizes}
      onOpenLogs={onOpenLogs}
      onRevealWorkspaceFileInSftp={revealWorkspaceFileInSftp}
      onRenameTab={renameTerminalTab}
      onUpdateTabGroupPreference={updateTerminalTabGroupPreference}
      leftTitleBarInset={leftTitleBarInset}
      reserveRightTitleBarControls={reserveRightTitleBarControls}
      resolvePaneLines={resolvePaneLines}
      resolvePaneOutputHistory={resolvePaneOutputHistory}
      renderCustomTab={(tab, active) =>
        isSftpTransferWorkspaceTab(tab) ? (
          <SftpTransferWorkbench
            active={active}
            createdHostTarget={createdSftpHostTarget}
            desktopNotifications={desktopNotifications}
            groups={machineGroups}
            externalLaunchId={tab.externalLaunchId}
            initialRightHostId={tab.rightHostId}
            initialRightPath={tab.initialRightPath}
            initialRightSelection={tab.initialRightSelection}
            interfaceDensity={interfaceDensity}
            lockedLeftHostId={tab.lockedLeftHostId}
            onCreateSshHost={onCreateSftpHost}
            workspaceTabId={tab.id}
          />
        ) : isWorkspaceFileTab(tab) ? (
          <WorkspaceFileTabSurface
            active={active}
            onDirtyChange={(dirty) => setWorkspaceFileTabDirty(tab.id, dirty)}
            tab={tab}
            terminalAppearance={terminalAppearance}
          />
        ) : null
      }
      onSelectTab={selectTab}
      onSplitPane={splitFocusedPane}
      panes={terminalWorkspace.terminalPanes}
      resolvedTheme={resolvedTheme}
      splitDropIndicator={splitDropIndicator}
      tabs={terminalWorkspace.terminalTabs}
      tabGroupPreferences={terminalWorkspace.terminalTabGroupPreferences}
      terminalAppearance={terminalAppearance}
      workspaceFileDirtyState={terminalWorkspace.workspaceFileDirtyState}
    />
  );
}

export function MachineSidebarStoreBridge(
  props: MachineSidebarStoreBridgeProps,
) {
  const openMachineIdsSnapshot = useSyncExternalStore(
    subscribeToWorkspaceStore,
    getOpenMachineIdsSnapshot,
    getOpenMachineIdsSnapshot,
  );
  const openMachineIds = useMemo(
    () => parseOpenMachineIdsSnapshot(openMachineIdsSnapshot),
    [openMachineIdsSnapshot],
  );

  return <MachineSidebar {...props} openMachineIds={openMachineIds} />;
}

export function ToolPanelStoreBridge({
  machineGroups,
  ...props
}: ToolPanelStoreBridgeProps) {
  const toolPanelWorkspaceSnapshot = useSyncExternalStore(
    subscribeToWorkspaceStore,
    getToolPanelWorkspaceSnapshot,
    getToolPanelWorkspaceSnapshot,
  );
  const workspaceContext = useMemo(
    () => {
      void toolPanelWorkspaceSnapshot;
      return buildToolPanelWorkspaceContext(
        useWorkspaceStore.getState(),
        machineGroups,
      );
    },
    [machineGroups, toolPanelWorkspaceSnapshot],
  );
  const closePane = useWorkspaceStore((state) => state.closePane);
  const openTmuxAttachTerminal = useWorkspaceStore(
    (state) => state.openTmuxAttachTerminal,
  );
  const openWorkspaceFileTab = useWorkspaceStore(
    (state) => state.openWorkspaceFileTab,
  );
  const workspaceFileDirtyState = useWorkspaceStore(
    (state) => state.workspaceFileDirtyState,
  );

  return (
    <ToolPanel
      {...props}
      activeMachine={workspaceContext.activeMachine}
      activeTab={workspaceContext.activeTab}
      focusedPane={workspaceContext.focusedPane}
      selectedMachine={workspaceContext.selectedMachine}
      workspaceContext={workspaceContext.projection}
      onClosePane={closePane}
      onOpenWorkspaceFileTab={openWorkspaceFileTab}
      onOpenTmuxTerminal={openTmuxAttachTerminal}
      terminalPanes={workspaceContext.terminalPanes}
      terminalTabs={workspaceContext.terminalTabs}
      sftpRevealRequest={workspaceContext.sftpRevealRequest}
      workspaceFileDirtyState={workspaceFileDirtyState}
      tools={tools}
    />
  );
}
