// @author kongweiguang

import type { ReactNode } from "react";
import type { TerminalProfile } from "../../lib/profileApi";
import type {
  InterfaceDensity,
  ResolvedTheme,
  TerminalAppearance,
} from "../settings/contracts/index";
import type {
  MachineGroup,
  TerminalPane,
  TerminalSplitDirection,
  TerminalSplitLayoutSizes,
  TerminalTab,
  TerminalTabGroupDefinition,
  TerminalTabGroups,
  TerminalTabGroupPreference,
  TerminalTabGroupPreferences,
  TerminalTabGroupMoveRequest,
  TerminalTabMoveRequest,
  WorkspaceFileDirtyState,
} from "../workspace/contracts/index";
import type {
  TerminalPaneMoveDropZone,
  TerminalPaneMoveScope,
} from "./terminalPaneMoveDropZones";
import type { TerminalSplitDropIndicator } from "./TerminalSplitDropOverlay";
import type { TerminalSplitPaneOptions } from "./terminalSplitTargets";
import type { ConnectionState } from "./XtermPane.helpers";

export interface BroadcastCommandRequest {
  command: string;
  data: string;
  targetPaneIds: string[];
}

export interface BroadcastCommandResult {
  missingPaneIds: string[];
  sentPaneIds: string[];
}

/** Presenter 的输入契约独立于实现，避免标签交互扩展继续挤占编排组件。 */
export interface TerminalWorkspaceProps {
  activeTabId: string;
  backgroundImageVisible?: boolean;
  broadcastDraft: string;
  contentLeftInset?: number;
  contentRightInset?: number;
  focusedPaneId: string;
  interfaceDensity?: InterfaceDensity;
  machineGroups?: MachineGroup[];
  profiles?: TerminalProfile[];
  panes: TerminalPane[];
  resolvedTheme: ResolvedTheme;
  tabs: TerminalTab[];
  terminalTabGroups?: TerminalTabGroups;
  tabGroupPreferences?: TerminalTabGroupPreferences;
  terminalAppearance: TerminalAppearance;
  onBroadcastCommand: (
    request: BroadcastCommandRequest,
  ) => Promise<BroadcastCommandResult>;
  onBroadcastDraftChange: (draft: string) => void;
  onClosePane: (paneId: string) => void;
  onCloseTabs: (tabIds: string[]) => void;
  onCreateTerminal?: (profileId?: string) => void;
  onFocusPane: (paneId: string) => void;
  onOpenAgentTool?: () => void;
  onOpenConnection?: () => void;
  onOpenSavedTerminal?: (machineId: string) => void;
  onRevealWorkspaceFileInSftp?: (tabId: string) => void;
  onMovePane?: (
    sourcePaneId: string,
    targetPaneId: string,
    placement: TerminalPaneMoveDropZone,
    scope?: TerminalPaneMoveScope,
  ) => void;
  onPaneConnectionStateChange?: (
    paneId: string,
    state: ConnectionState,
  ) => void;
  onPaneCurrentCwdChange?: (paneId: string, cwd: string) => void;
  onPaneOutputHistoryChange?: (
    paneId: string,
    outputHistory: string | undefined,
  ) => void;
  onSplitLayoutSizesChange?: (
    splitId: string,
    sizes: TerminalSplitLayoutSizes,
  ) => void;
  onOpenLogs?: () => void;
  onRenameTab: (tabId: string, title: string) => void;
  onUpdateTabGroupPreference?: (
    groupId: string,
    preference: TerminalTabGroupPreference,
  ) => void;
  onCreateTerminalTabGroup?: (
    tabId: string,
    definition?: Partial<TerminalTabGroupDefinition>,
  ) => string | undefined;
  onUpdateTerminalTabGroup?: (
    groupId: string,
    definition: Partial<TerminalTabGroupDefinition>,
  ) => void;
  onSetTerminalTabGroupCollapsed?: (
    groupId: string,
    collapsed: boolean,
  ) => void;
  onMoveTerminalTab?: (request: TerminalTabMoveRequest) => void;
  onMoveTerminalTabGroup?: (request: TerminalTabGroupMoveRequest) => void;
  onRemoveTerminalTabFromGroup?: (tabId: string) => void;
  onUngroupTerminalTabGroup?: (groupId: string) => void;
  leftTitleBarInset?: number;
  rightTitleBarInset?: number;
  resolvePaneLines?: (paneId: string) => string[];
  resolvePaneOutputHistory?: (paneId: string) => string | undefined;
  renderCustomTab?: (tab: TerminalTab, active: boolean) => ReactNode;
  onSelectTab: (tabId: string) => void;
  onSplitPane: (
    direction: TerminalSplitDirection,
    options?: TerminalSplitPaneOptions,
  ) => void;
  splitDropIndicator?: TerminalSplitDropIndicator | null;
  workspaceFileDirtyState?: WorkspaceFileDirtyState;
}
