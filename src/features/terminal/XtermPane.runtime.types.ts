// @author kongweiguang
import type { FitAddon } from "@xterm/addon-fit";
import type { SearchAddon } from "@xterm/addon-search";
import type {
  FontWeight,
  ITheme,
  Terminal as XtermTerminal,
} from "@xterm/xterm";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type {
  TerminalAgentSignal,
  TerminalSessionLogState,
} from "../../lib/terminalApi";
import type {
  TerminalCommandBlock,
  TerminalCommandBlockView,
} from "./terminalCommandBlocks";
import type { TerminalInputModelState } from "./terminalInputModel";
import type { TerminalInputCompatibilityMode } from "./terminalKeyboardPolicy";
import type { TerminalPaneRuntimeLifecycleDecision } from "./terminalPaneRuntimeLifecycle";
import type { TerminalPaneRuntimeLifecycleRuntime } from "./terminalPaneRuntimeLifecycleRuntime";
import type { TerminalRendererController } from "./terminalRenderer";
import type { XtermPaneActivityRuntime } from "./XtermPane.activityRuntime";
import type { XtermPaneSuggestionMenuView } from "./XtermPane.ghostSuggestions";
import type {
  ConnectionState,
  TerminalGhostSuggestion,
} from "./XtermPane.helpers";
import type { XtermPaneSearchResults } from "./XtermPane.search";
import type { TerminalSuggestionMenuIntent } from "./terminalSuggestionMenuModel";
import type {
  XtermPaneDimensions,
  XtermPaneProps,
  XtermPaneSessionFinishedEvent,
} from "./XtermPane.types";

/** 候选菜单向终端运行时暴露的最小状态契约。 */
export interface XtermPaneSuggestionMenuRuntimeParams {
  setSuggestionMenu: Dispatch<
    SetStateAction<XtermPaneSuggestionMenuView | null>
  >;
  suggestionMenuIntentRef: MutableRefObject<
    ((intent: TerminalSuggestionMenuIntent) => boolean) | null
  >;
}

/** 安装单个 XtermPane 所需的完整运行时依赖。 */
export interface InstallXtermPaneRuntimeParams
  extends XtermPaneSuggestionMenuRuntimeParams {
  activityRuntimeRef: MutableRefObject<XtermPaneActivityRuntime | null>;
  args: XtermPaneProps["args"];
  commandBlockCounterRef: MutableRefObject<number>;
  commandBlocksRef: MutableRefObject<TerminalCommandBlock[]>;
  containerRef: MutableRefObject<HTMLDivElement | null>;
  cwd: XtermPaneProps["cwd"];
  cwdTrackingBufferRef: MutableRefObject<string>;
  currentCwdRef: MutableRefObject<string | undefined>;
  disconnectSessionRef: MutableRefObject<(() => Promise<void>) | null>;
  env: XtermPaneProps["env"];
  fitAddonRef: MutableRefObject<FitAddon | null>;
  focusedRef: MutableRefObject<boolean>;
  ghostSuggestionRef: MutableRefObject<TerminalGhostSuggestion | null>;
  inputBufferRef: MutableRefObject<string>;
  inputCompatibilityMode: TerminalInputCompatibilityMode;
  inputModelRef: MutableRefObject<TerminalInputModelState>;
  onAgentSignalRef: MutableRefObject<
    ((signal: TerminalAgentSignal) => void) | undefined
  >;
  onCurrentCwdChangeRef: MutableRefObject<
    ((cwd: string) => void) | undefined
  >;
  onOutputHistoryChangeRef: MutableRefObject<
    ((outputHistory: string | undefined) => void) | undefined
  >;
  onSessionFinishedRef: MutableRefObject<
    ((event: XtermPaneSessionFinishedEvent) => void) | undefined
  >;
  onTerminalDimensionsChangeRef: MutableRefObject<
    ((dimensions: XtermPaneDimensions) => void) | undefined
  >;
  outputHistoryRef: MutableRefObject<string | undefined>;
  paneId: string;
  profileId: XtermPaneProps["profileId"];
  promptLineRef: MutableRefObject<number | undefined>;
  reconnectSessionRef: MutableRefObject<(() => Promise<void>) | null>;
  remoteCommand: XtermPaneProps["remoteCommand"];
  remoteHostId: XtermPaneProps["remoteHostId"];
  searchAddonRef: MutableRefObject<SearchAddon | null>;
  sessionIdRef: MutableRefObject<string | null>;
  setCommandBlockNotice: (notice: string | null) => void;
  setCommandBlockViews: Dispatch<SetStateAction<TerminalCommandBlockView[]>>;
  setConnectionState: Dispatch<SetStateAction<ConnectionState>>;
  setGhostSuggestion: Dispatch<SetStateAction<TerminalGhostSuggestion | null>>;
  setInlineTuiActive: (active: boolean) => void;
  setLogNotice: Dispatch<SetStateAction<string | null>>;
  setLogState: Dispatch<SetStateAction<TerminalSessionLogState>>;
  setSearchResults: Dispatch<SetStateAction<XtermPaneSearchResults>>;
  shell: XtermPaneProps["shell"];
  shellAssistEnabled?: boolean;
  shellIntegrationCommandBlockProtocolRef: MutableRefObject<boolean>;
  startupMessage: XtermPaneProps["startupMessage"];
  syncCommandBlockViews: () => void;
  target: XtermPaneProps["target"];
  terminalAppearance: XtermPaneProps["terminalAppearance"];
  terminalAppearanceRef: MutableRefObject<
    XtermPaneProps["terminalAppearance"]
  >;
  terminalFontWeight: FontWeight;
  terminalRef: MutableRefObject<XtermTerminal | null>;
  terminalRendererControllerRef: MutableRefObject<
    TerminalRendererController | null
  >;
  terminalRuntimeLifecycleControllerRef: MutableRefObject<
    TerminalPaneRuntimeLifecycleRuntime | null
  >;
  terminalRuntimeLifecycleRef: MutableRefObject<
    TerminalPaneRuntimeLifecycleDecision
  >;
  terminalSurfaceCoordinatorRef: MutableRefObject<
    ((invalidate?: boolean) => void) | null
  >;
  terminalTheme: ITheme;
  transientStartupMessage: boolean;
  visibleRef: MutableRefObject<boolean>;
}
