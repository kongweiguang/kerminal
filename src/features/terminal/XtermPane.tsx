import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { Terminal as XtermTerminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import {
  resizeTerminal,
  startTerminalLog,
  stopTerminalLog,
  writeTerminal,
  type TerminalSessionLogState,
} from "../../lib/terminalApi";
import { writeDesktopClipboardText } from "../../lib/desktopClipboardApi";
import type { RemoteTargetRef } from "../../lib/targetModel";
import type {
  ResolvedTheme,
  TerminalColorScheme,
  TerminalAppearance,
} from "../settings/settingsModel";
import {
  terminalColorSchemeForTheme,
  terminalFontWeightValue,
} from "../settings/settingsModel";
import { xtermThemeFor } from "../settings/terminalTheme";
import {
  TerminalCommandBlockRail,
  type TerminalCommandBlockAction,
} from "./TerminalCommandBlockRail";
import {
  splitDirectionForMenuAction,
  TerminalContextMenu,
  type TerminalContextMenuAction,
  type TerminalContextMenuPosition,
} from "./TerminalContextMenu";
import {
  buildTerminalCommandBlockViews,
  commandBlockViewsEqual,
  copyTerminalCommandBlockAsImage,
  terminalCommandBlockPlainText,
  type TerminalCommandBlock,
  type TerminalCommandBlockView,
} from "./terminalCommandBlocks";
import {
  clearTerminalCommandBlocks,
  syncTerminalCommandPromptBlocks,
} from "./terminalCommandBlockLifecycle";
import {
  createTerminalInputModelState,
  type TerminalInputModelState,
} from "./terminalInputModel";
import { TerminalSearchPanel } from "./TerminalSearchPanel";
import type { TerminalSplitDirection } from "../workspace/types";
import {
  applyTerminalCommandBlockFolding,
  errorMessage,
  formatLogPath,
  pasteIntoTerminal,
  resolveTerminalContentBottomLine,
  resolveTerminalPromptLine,
  resolveTerminalRowHeight,
  type ConnectionState,
  type TerminalGhostSuggestion,
  stateLabel,
  terminalSearchOptions,
} from "./XtermPane.helpers";

export {
  collectCurrentDirOscSequences,
  collectSubmittedCommands,
} from "./XtermPane.helpers";
import { installXtermPaneRuntime } from "./XtermPane.runtime";
import type { TerminalInputCompatibilityMode } from "./terminalKeyboardPolicy";

const TERMINAL_CLEAR_SCREEN_INPUT = "\x0c";
const TERMINAL_FRONTEND_CLEAR_SCREEN_SEQUENCE = "\x1b[H\x1b[2J\x1b[3J";

interface XtermPaneProps {
  args?: string[];
  currentCwd?: string;
  cwd?: string;
  env?: Record<string, string>;
  focusRequestToken?: number;
  focused: boolean;
  inputCompatibilityMode?: TerminalInputCompatibilityMode;
  inputRequest?: XtermPaneInputRequest | null;
  paneId: string;
  profileId?: string;
  remoteCommand?: string;
  remoteHostId?: string;
  remoteHostProduction?: boolean;
  resolvedTheme: ResolvedTheme;
  shell?: string;
  shellAssistEnabled?: boolean;
  startupMessage?: string;
  terminalAppearance: TerminalAppearance;
  terminalColorSchemeOverride?: TerminalColorScheme;
  target?: RemoteTargetRef;
  title: string;
  transientStartupMessage?: boolean;
  onCurrentCwdChange?: (cwd: string) => void;
  onOpenLogs?: () => void;
  onOutputHistoryChange?: (outputHistory: string | undefined) => void;
  onSessionFinished?: (event: XtermPaneSessionFinishedEvent) => void;
  onSplitPane?: (direction: TerminalSplitDirection) => void;
  onTerminalDimensionsChange?: (dimensions: XtermPaneDimensions) => void;
  outputHistory?: string;
  resolveInitialOutputHistory?: () => string | undefined;
}

export interface XtermPaneDimensions {
  cols: number;
  rows: number;
}

export interface XtermPaneInputRequest {
  id: string;
  submit?: boolean;
  text: string;
}

export interface XtermPaneSessionFinishedEvent {
  durationMs: number;
  reason: "closed";
  sessionId: string;
}

export function XtermPane({
  args,
  currentCwd,
  cwd,
  env,
  focusRequestToken,
  focused,
  inputCompatibilityMode = "shell",
  inputRequest,
  paneId,
  profileId,
  remoteCommand,
  remoteHostId,
  remoteHostProduction = false,
  resolvedTheme,
  shell,
  shellAssistEnabled = true,
  startupMessage,
  terminalAppearance,
  terminalColorSchemeOverride,
  target,
  title,
  transientStartupMessage = false,
  onCurrentCwdChange,
  onOpenLogs,
  onOutputHistoryChange,
  onSessionFinished,
  onSplitPane,
  onTerminalDimensionsChange,
  outputHistory,
  resolveInitialOutputHistory,
}: XtermPaneProps) {
  const commandBlockCounterRef = useRef(0);
  const commandBlocksRef = useRef<TerminalCommandBlock[]>([]);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const disconnectSessionRef = useRef<(() => Promise<void>) | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const focusedRef = useRef(focused);
  const inputBufferRef = useRef("");
  const inputModelRef = useRef<TerminalInputModelState>(
    createTerminalInputModelState(),
  );
  const cwdTrackingBufferRef = useRef("");
  const currentCwdRef = useRef(currentCwd ?? cwd);
  const ghostSuggestionRef = useRef<TerminalGhostSuggestion | null>(null);
  const onCurrentCwdChangeRef = useRef(onCurrentCwdChange);
  const onOutputHistoryChangeRef = useRef(onOutputHistoryChange);
  const onSessionFinishedRef = useRef(onSessionFinished);
  const onTerminalDimensionsChangeRef = useRef(onTerminalDimensionsChange);
  const outputHistoryRef = useRef(
    outputHistory ?? resolveInitialOutputHistory?.(),
  );
  const promptLineRef = useRef<number | undefined>(undefined);
  const manualClearSyncFrameRef = useRef<number | null>(null);
  const suppressCommandBlockSyncRef = useRef(false);
  const reconnectSessionRef = useRef<(() => Promise<void>) | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const lastInputRequestIdRef = useRef<string | null>(null);
  const terminalAppearanceRef = useRef(terminalAppearance);
  const terminalRef = useRef<XtermTerminal | null>(null);
  const searchInputId = useId();
  const [commandBlockNotice, setCommandBlockNotice] = useState<string | null>(
    null,
  );
  const [commandBlockViews, setCommandBlockViews] = useState<
    TerminalCommandBlockView[]
  >([]);
  const [contextMenu, setContextMenu] = useState<{
    canCopy: boolean;
    position: TerminalContextMenuPosition;
  } | null>(null);
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("connecting");
  const [searchCaseSensitive, setSearchCaseSensitive] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState({
    hasSearched: false,
    resultCount: 0,
    resultIndex: -1,
  });
  const [logState, setLogState] = useState<TerminalSessionLogState>({
    active: false,
    bytesWritten: 0,
  });
  const [logNotice, setLogNotice] = useState<string | null>(null);
  const [ghostSuggestion, setGhostSuggestion] =
    useState<TerminalGhostSuggestion | null>(null);
  const terminalTheme = useMemo(
    () =>
      xtermThemeFor(
        resolvedTheme,
        terminalColorSchemeOverride ??
          terminalColorSchemeForTheme(terminalAppearance, resolvedTheme),
      ),
    [
      resolvedTheme,
      terminalColorSchemeOverride,
      terminalAppearance.darkColorScheme,
      terminalAppearance.lightColorScheme,
    ],
  );
  const terminalFontWeight = useMemo(
    () => terminalFontWeightValue(terminalAppearance.fontWeight),
    [terminalAppearance.fontWeight],
  );
  const argsDependencyKey = useMemo(() => stableJsonDependencyKey(args), [args]);
  const envDependencyKey = useMemo(() => stableJsonDependencyKey(env), [env]);
  const targetDependencyKey = useMemo(
    () => stableJsonDependencyKey(target),
    [target],
  );

  const syncCommandBlockViews = useCallback(() => {
    if (!shellAssistEnabled) {
      setCommandBlockViews((current) => (current.length === 0 ? current : []));
      return;
    }
    if (suppressCommandBlockSyncRef.current) {
      return;
    }
    const terminal = terminalRef.current;
    if (!terminal) {
      setCommandBlockViews([]);
      return;
    }

    const activeBuffer = terminal.buffer.active;
    const promptLine = resolveTerminalPromptLine(
      terminal,
      inputBufferRef.current,
    );
    promptLineRef.current = promptLine;
    if (
      typeof promptLine === "number" &&
      terminal.buffer.active.type === "normal"
    ) {
      syncTerminalCommandPromptBlocks({
        commandBlockCounterRef,
        commandBlocksRef,
        onEndMarkerDispose: syncCommandBlockViews,
        onStartMarkerDispose: syncCommandBlockViews,
        paneId,
        promptLine,
        terminal,
      });
    }
    const nextViews = buildTerminalCommandBlockViews(commandBlocksRef.current, {
      activeBufferType: activeBuffer.type,
      bufferLength: activeBuffer.length,
      cols: terminal.cols,
      contentBottomLine: resolveTerminalContentBottomLine(terminal),
      promptLine,
      rowHeight: resolveTerminalRowHeight(
        containerRef.current,
        terminalAppearanceRef.current,
        terminal,
      ),
      rows: terminal.rows,
      viewportY: activeBuffer.viewportY,
    });

    setCommandBlockViews((current) =>
      commandBlockViewsEqual(current, nextViews) ? current : nextViews,
    );
  }, [shellAssistEnabled]);

  const scheduleCommandBlockViewsSync = useCallback(() => {
    if (manualClearSyncFrameRef.current !== null) {
      return;
    }
    manualClearSyncFrameRef.current =
      typeof window.requestAnimationFrame === "function"
        ? window.requestAnimationFrame(() => {
            manualClearSyncFrameRef.current = null;
            syncCommandBlockViews();
          })
        : window.setTimeout(() => {
            manualClearSyncFrameRef.current = null;
            syncCommandBlockViews();
          }, 16);
  }, [syncCommandBlockViews]);

  useEffect(
    () => () => {
      const frameId = manualClearSyncFrameRef.current;
      if (frameId === null) {
        return;
      }
      if (typeof window.cancelAnimationFrame === "function") {
        window.cancelAnimationFrame(frameId);
      } else {
        window.clearTimeout(frameId);
      }
      manualClearSyncFrameRef.current = null;
    },
    [],
  );

  const clearCommandBlocks = useCallback(() => {
    suppressCommandBlockSyncRef.current = true;
    try {
      clearTerminalCommandBlocks(commandBlocksRef);
      setCommandBlockViews([]);
      setCommandBlockNotice(null);
    } finally {
      suppressCommandBlockSyncRef.current = false;
    }
  }, []);

  useEffect(() => {
    currentCwdRef.current = currentCwd ?? cwd;
  }, [currentCwd, cwd]);

  useEffect(() => {
    onCurrentCwdChangeRef.current = onCurrentCwdChange;
  }, [onCurrentCwdChange]);

  useEffect(() => {
    onOutputHistoryChangeRef.current = onOutputHistoryChange;
  }, [onOutputHistoryChange]);

  useEffect(() => {
    onSessionFinishedRef.current = onSessionFinished;
  }, [onSessionFinished]);

  useEffect(() => {
    onTerminalDimensionsChangeRef.current = onTerminalDimensionsChange;
  }, [onTerminalDimensionsChange]);

  useEffect(() => {
    if (resolveInitialOutputHistory) {
      return;
    }
    outputHistoryRef.current = outputHistory;
  }, [outputHistory, resolveInitialOutputHistory]);

  useEffect(() => {
    terminalAppearanceRef.current = terminalAppearance;
  }, [terminalAppearance]);

  useEffect(() => {
    ghostSuggestionRef.current = ghostSuggestion;
  }, [ghostSuggestion]);

  useEffect(() =>
    installXtermPaneRuntime({
      args,
      commandBlockCounterRef,
      commandBlocksRef,
      containerRef,
      cwd,
      cwdTrackingBufferRef,
      currentCwdRef,
      disconnectSessionRef,
      env,
      fitAddonRef,
      focusedRef,
      ghostSuggestionRef,
      inputBufferRef,
      inputModelRef,
      inputCompatibilityMode,
      onCurrentCwdChangeRef,
      onOutputHistoryChangeRef,
      onSessionFinishedRef,
      onTerminalDimensionsChangeRef,
      outputHistoryRef,
      paneId,
      profileId,
      promptLineRef,
      reconnectSessionRef,
      remoteCommand,
      remoteHostId,
      remoteHostProduction,
      searchAddonRef,
      sessionIdRef,
      setCommandBlockNotice,
      setCommandBlockViews,
      setConnectionState,
      setGhostSuggestion,
      shellAssistEnabled,
      setLogNotice,
      setLogState,
      setSearchResults,
      shell,
      startupMessage,
      syncCommandBlockViews,
      target,
      terminalAppearance,
      terminalAppearanceRef,
      terminalFontWeight,
      terminalRef,
      terminalTheme,
      transientStartupMessage,
    }),
  [
    argsDependencyKey,
    cwd,
    envDependencyKey,
    inputCompatibilityMode,
    paneId,
    profileId,
    remoteCommand,
    remoteHostId,
    remoteHostProduction,
    shell,
    shellAssistEnabled,
    startupMessage,
    syncCommandBlockViews,
    targetDependencyKey,
    transientStartupMessage,
  ]);

  useEffect(() => {
    focusedRef.current = focused;
    if (focused) {
      terminalRef.current?.focus();
    }
  }, [focused]);

  useEffect(() => {
    if (typeof focusRequestToken === "number") {
      terminalRef.current?.focus();
    }
  }, [focusRequestToken]);

  useEffect(() => {
    if (!inputRequest || lastInputRequestIdRef.current === inputRequest.id) {
      return;
    }
    const terminal = terminalRef.current;
    const sessionId = sessionIdRef.current;
    if (!terminal || !sessionId) {
      return;
    }

    lastInputRequestIdRef.current = inputRequest.id;
    if (inputRequest.text.length > 0) {
      terminal.paste(inputRequest.text);
    }
    if (inputRequest.submit) {
      void writeTerminal(sessionId, "\r");
    }
    terminal.focus();
  }, [connectionState, inputRequest]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) {
      return;
    }

    terminal.options.cursorBlink = terminalAppearance.cursorBlink;
    terminal.options.cursorStyle = terminalAppearance.cursorStyle;
    terminal.options.fontFamily = terminalAppearance.fontFamily;
    terminal.options.fontSize = terminalAppearance.fontSize;
    terminal.options.fontWeight = terminalFontWeight;
    terminal.options.fontWeightBold = 700;
    terminal.options.lineHeight = terminalAppearance.lineHeight;
    terminal.options.macOptionIsMeta = terminalAppearance.macOptionIsMeta;
    terminal.options.scrollback = terminalAppearance.scrollback;
    terminal.options.theme = terminalTheme;
    (terminal.options as { modifyOtherKeys?: number }).modifyOtherKeys =
      inputCompatibilityMode === "agentTui" ? 2 : 0;
    if (containerRef.current) {
      containerRef.current.style.fontFamily = terminalAppearance.fontFamily;
    }
    fitAddonRef.current?.fit();
    terminal.refresh?.(0, Math.max(0, terminal.rows - 1));
    const dimensions = { cols: terminal.cols, rows: terminal.rows };
    const sessionId = sessionIdRef.current;
    onTerminalDimensionsChangeRef.current?.(dimensions);
    if (sessionId) {
      void resizeTerminal(sessionId, dimensions);
    }
  }, [inputCompatibilityMode, terminalAppearance, terminalFontWeight, terminalTheme]);

  useEffect(() => {
    if (!contextMenu) {
      return undefined;
    }

    const closeMenu = () => setContextMenu(null);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeMenu();
      }
    };

    window.addEventListener("click", closeMenu);
    window.addEventListener("resize", closeMenu);
    window.addEventListener("keydown", closeOnEscape);

    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [contextMenu]);

  useLayoutEffect(() => {
    return applyTerminalCommandBlockFolding(
      containerRef.current,
      shellAssistEnabled ? commandBlockViews : [],
    );
  }, [commandBlockViews, shellAssistEnabled]);

  const startLogging = useCallback(async () => {
    const sessionId = sessionIdRef.current;
    if (!sessionId) {
      setLogNotice("会话尚未就绪，无法记录日志");
      return;
    }

    try {
      const nextState = await startTerminalLog(sessionId);
      setLogState(nextState);
      setLogNotice(
        nextState.path
          ? `正在记录日志：${formatLogPath(nextState.path)}`
          : "正在记录日志",
      );
    } catch (error: unknown) {
      setLogNotice(`日志启动失败：${errorMessage(error)}`);
    }
  }, []);

  const stopLogging = useCallback(async () => {
    const sessionId = sessionIdRef.current;
    if (!sessionId) {
      setLogNotice("会话尚未就绪，无法停止日志");
      return;
    }

    try {
      const nextState = await stopTerminalLog(sessionId);
      setLogState(nextState);
      setLogNotice(
        nextState.path
          ? `日志已停止：${formatLogPath(nextState.path)}`
          : "日志已停止",
      );
    } catch (error: unknown) {
      setLogNotice(`日志停止失败：${errorMessage(error)}`);
    }
  }, []);

  const disconnectTerminal = useCallback(async () => {
    await disconnectSessionRef.current?.();
  }, []);

  const reconnectTerminal = useCallback(async () => {
    await reconnectSessionRef.current?.();
  }, []);

  const executeContextMenuAction = useCallback(
    (action: TerminalContextMenuAction) => {
      setContextMenu(null);
      const terminal = terminalRef.current;
      const sessionId = sessionIdRef.current;

      if (action === "copy") {
        const selection = terminal?.getSelection?.() ?? "";
        if (selection) {
          void writeDesktopClipboardText(selection);
        }
      } else if (action === "paste") {
        void pasteIntoTerminal(terminal, sessionId);
      } else if (action === "selectAll") {
        terminal?.selectAll?.();
      } else if (action === "clear") {
        clearCommandBlocks();
        if (sessionId) {
          void writeTerminal(sessionId, TERMINAL_CLEAR_SCREEN_INPUT);
          scheduleCommandBlockViewsSync();
        } else {
          terminal?.write?.(TERMINAL_FRONTEND_CLEAR_SCREEN_SEQUENCE, () => {
            scheduleCommandBlockViewsSync();
          });
          if (!terminal?.write) {
            scheduleCommandBlockViewsSync();
          }
        }
      } else if (action === "search") {
        setSearchOpen(true);
      } else if (action === "startLog") {
        void startLogging();
      } else if (action === "stopLog") {
        void stopLogging();
      } else if (action === "disconnect") {
        void disconnectTerminal();
      } else if (action === "reconnect") {
        void reconnectTerminal();
      } else if (action === "openLogs") {
        onOpenLogs?.();
      } else {
        const direction = splitDirectionForMenuAction(action);
        if (direction) {
          onSplitPane?.(direction);
        }
      }

      terminal?.focus();
    },
    [
      onOpenLogs,
      onSplitPane,
      disconnectTerminal,
      reconnectTerminal,
      startLogging,
      stopLogging,
      clearCommandBlocks,
      scheduleCommandBlockViewsSync,
    ],
  );

  const openContextMenu = useCallback(
    (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const terminal = terminalRef.current;
      const sessionId = sessionIdRef.current;
      const rightClickBehavior = terminalAppearanceRef.current.rightClickBehavior;
      if (rightClickBehavior === "none") {
        terminal?.focus();
        return;
      }
      if (rightClickBehavior === "paste") {
        void pasteIntoTerminal(terminal, sessionId);
        terminal?.focus();
        return;
      }

      const selection = terminal?.getSelection?.() ?? "";
      const menuState = {
        canCopy: selection.length > 0,
        position: {
          x: event.clientX,
          y: event.clientY,
        },
      };
      setContextMenu(menuState);
      terminal?.focus();
    },
    [],
  );

  const executeCommandBlockAction = useCallback(
    (blockId: string, action: TerminalCommandBlockAction) => {
      const block = commandBlocksRef.current.find(
        (current) => current.id === blockId,
      );
      if (!block) {
        return;
      }

      if (action === "toggle") {
        block.collapsed = !block.collapsed;
        setCommandBlockNotice(
          block.collapsed ? "命令块已折叠" : "命令块已展开",
        );
        syncCommandBlockViews();
        terminalRef.current?.focus();
        return;
      }

      if (action === "copyText") {
        void writeDesktopClipboardText(terminalCommandBlockPlainText(block))
          .then((result) =>
            setCommandBlockNotice(
              result.ok ? "命令块文本已复制" : "复制命令块文本失败",
            ),
          )
          .catch(() => setCommandBlockNotice("复制命令块文本失败"));
        terminalRef.current?.focus();
        return;
      }

      void copyTerminalCommandBlockAsImage(block, resolvedTheme)
        .then((result) => {
          setCommandBlockNotice(
            result === "image"
              ? "命令块图片已复制"
              : "当前剪贴板不支持图片，已复制文本",
          );
        })
        .catch(() => {
          void writeDesktopClipboardText(terminalCommandBlockPlainText(block))
            .then((result) =>
              setCommandBlockNotice(
                result.ok ? "复制图片失败，已复制文本" : "复制命令块失败",
              ),
            )
            .catch(() => setCommandBlockNotice("复制命令块失败"));
        });
      terminalRef.current?.focus();
    },
    [resolvedTheme, syncCommandBlockViews],
  );

  const runSearch = useCallback(
    (direction: "next" | "previous") => {
      const query = searchQuery.trim();
      const searchAddon = searchAddonRef.current;
      if (!query || !searchAddon) {
        searchAddon?.clearDecorations();
        setSearchResults({
          hasSearched: false,
          resultCount: 0,
          resultIndex: -1,
        });
        return;
      }

      const options = terminalSearchOptions(searchCaseSensitive);
      const found =
        direction === "next"
          ? searchAddon.findNext(query, options)
          : searchAddon.findPrevious(query, options);
      setSearchResults((current) => ({
        ...current,
        hasSearched: true,
        ...(found ? {} : { resultCount: 0, resultIndex: -1 }),
      }));
    },
    [searchCaseSensitive, searchQuery],
  );

  const updateSearchQuery = useCallback((query: string) => {
    setSearchQuery(query);
    if (!query.trim()) {
      searchAddonRef.current?.clearDecorations();
      setSearchResults({
        hasSearched: false,
        resultCount: 0,
        resultIndex: -1,
      });
    }
  }, []);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    searchAddonRef.current?.clearDecorations();
    terminalRef.current?.focus();
  }, []);

  const toggleSearchCaseSensitive = useCallback(() => {
    setSearchCaseSensitive((current) => !current);
    setSearchResults({
      hasSearched: false,
      resultCount: 0,
      resultIndex: -1,
    });
  }, []);

  return (
    <div
      className="relative min-h-0 flex-1 bg-[#f7f7fa] dark:bg-[#1f1f21]"
      onContextMenu={openContextMenu}
    >
      {shellAssistEnabled ? (
        <TerminalCommandBlockRail
          blocks={commandBlockViews}
          onAction={executeCommandBlockAction}
        />
      ) : null}
      <div
        className={`h-full min-h-0 w-full overflow-hidden py-2 pr-3 ${
          shellAssistEnabled ? "pl-6" : "pl-3"
        }`}
        onPointerDown={() => terminalRef.current?.focus()}
      >
        <div
          aria-label={`${title} xterm 终端`}
          className="h-full min-h-0 w-full overflow-hidden"
          ref={containerRef}
        />
      </div>
      {shellAssistEnabled && ghostSuggestion ? (
        <div
          aria-label="终端命令灰色提示"
          className="pointer-events-none absolute z-10 select-none overflow-hidden whitespace-pre font-mono text-zinc-400/75 dark:text-zinc-500/85"
          data-provider={ghostSuggestion.candidate.provider}
          style={{
            fontFamily: terminalAppearance.fontFamily,
            fontSize: terminalAppearance.fontSize,
            left: ghostSuggestion.left,
            lineHeight: `${ghostSuggestion.lineHeight}px`,
            maxWidth: ghostSuggestion.maxWidth,
            top: ghostSuggestion.top,
          }}
          title={ghostSuggestion.candidate.description}
        >
          {ghostSuggestion.suffix}
        </div>
      ) : null}
      <div className="kerminal-muted-surface pointer-events-none absolute right-3 top-2 rounded-md border px-2 py-1 text-[11px] text-zinc-500 backdrop-blur-xl dark:text-zinc-400">
        {stateLabel(connectionState)}
      </div>
      {logState.active ? (
        <div
          aria-label="终端日志记录状态"
          className="pointer-events-none absolute right-3 top-9 rounded-md border border-sky-500/30 bg-sky-100/80 px-2 py-1 text-[11px] text-sky-700 dark:border-sky-300/20 dark:bg-sky-400/15 dark:text-sky-200"
          title={logState.path}
        >
          记录中
        </div>
      ) : null}
      {logNotice ? (
        <div
          aria-label="终端日志提示"
          className="kerminal-muted-surface pointer-events-none absolute bottom-3 left-3 max-w-[min(560px,calc(100%-1.5rem))] truncate rounded-md border px-2 py-1 text-[11px] text-zinc-500 shadow-sm backdrop-blur-xl dark:text-zinc-300"
          role="status"
          title={logNotice}
        >
          {logNotice}
        </div>
      ) : null}
      {shellAssistEnabled && commandBlockNotice ? (
        <div
          aria-label="命令块操作提示"
          className="kerminal-muted-surface pointer-events-none absolute left-3 max-w-[min(560px,calc(100%-1.5rem))] truncate rounded-md border px-2 py-1 text-[11px] text-zinc-500 shadow-sm backdrop-blur-xl dark:text-zinc-300"
          role="status"
          style={{ bottom: logNotice ? 40 : 12 }}
          title={commandBlockNotice}
        >
          {commandBlockNotice}
        </div>
      ) : null}
      {searchOpen ? (
        <TerminalSearchPanel
          caseSensitive={searchCaseSensitive}
          hasSearched={searchResults.hasSearched}
          inputId={searchInputId}
          onClose={closeSearch}
          onQueryChange={updateSearchQuery}
          onSearchNext={() => runSearch("next")}
          onSearchPrevious={() => runSearch("previous")}
          onToggleCaseSensitive={toggleSearchCaseSensitive}
          query={searchQuery}
          resultCount={searchResults.resultCount}
          resultIndex={searchResults.resultIndex}
        />
      ) : null}
      {contextMenu ? (
        <TerminalContextMenu
          canDisconnect={connectionState === "connected"}
          canCopy={contextMenu.canCopy}
          canReconnect={connectionState !== "connecting"}
          canSplit={Boolean(onSplitPane)}
          onAction={executeContextMenuAction}
          onClose={() => setContextMenu(null)}
          position={contextMenu.position}
        />
      ) : null}
    </div>
  );
}

function stableJsonDependencyKey(value: unknown): string {
  return JSON.stringify(sortJsonValue(value));
}

function sortJsonValue(value: unknown): unknown {
  if (!value || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(sortJsonValue);
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entryValue]) => [key, sortJsonValue(entryValue)]),
  );
}
