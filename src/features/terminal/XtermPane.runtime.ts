import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { Terminal as XtermTerminal } from "@xterm/xterm";
import { closeTerminal, createDockerContainerTerminalSession, createSerialTerminalSession, createSshTerminalSession, createTelnetTerminalSession, createTerminalSession, getTerminalLogState, resizeTerminal, writeTerminal } from "../../lib/terminalApi";
import type { TerminalOutputEvent } from "../../lib/terminalApi";
import { recordCommandHistory } from "../../lib/commandHistoryApi";
import { writeDesktopClipboardText } from "../../lib/desktopClipboardApi";
import { listTerminalSuggestions, recordTerminalSuggestionFeedback } from "../../lib/terminalSuggestionApi";
import { markTerminalPaneSessionDisconnected, markTerminalPaneSessionReconnected, registerTerminalPaneSession, updateTerminalPaneRuntimeContext, updateTerminalPaneSessionCwd, unregisterTerminalPaneSession } from "./terminalSessionRegistry";
import { createTerminalOutputWriter } from "./terminalOutputWriter";
import { appendCommandBlockOutput, terminalCommandBlockPlainText } from "./terminalCommandBlocks";
import {
  clearTerminalCommandBlocks,
  closeLatestTerminalCommandBlock,
  submitTerminalCommandBlock,
} from "./terminalCommandBlockLifecycle";
import { applyTerminalInputData, createTerminalInputModelState, terminalSuggestionEligibility, updateTerminalInputBufferKind, updateTerminalInputComposition } from "./terminalInputModel";
import { terminalSuggestionProbeScheduler } from "./terminalSuggestionProbeScheduler";
import { createTerminalRemoteSuggestionPrewarm } from "./terminalRemoteSuggestionPrewarm";
import { createTerminalOutputHistoryBuffer } from "./terminalOutputHistoryBuffer";
import {
  createTerminalOutputInstrumentation,
  runTerminalOutputInstrumentationStep,
} from "./terminalOutputInstrumentation";
import { buildTerminalCreateRequest, collectCurrentDirOscSequences, errorMessage, isRightArrowInput, normalizeTerminalSessionSize, resolveGhostSuggestionLayout, terminalGhostSuggestionEqual, terminalSuggestionProviders, type TerminalGhostSuggestion } from "./XtermPane.helpers";
import { registerCommandBlockClearHandlers, terminalSessionFailureLabel, terminalSessionTargetKind } from "./XtermPane.runtime.helpers";
import { KITTY_KEYBOARD_PROTOCOL_ENABLE, resolveTerminalInputCompatibilityOverride, resolveTerminalRuntimeKeydownOverride, shouldEnableKittyKeyboardProtocol } from "./terminalKeyboardPolicy";

const ORIGIN_ERASE_BELOW_COMMAND_BLOCK_GRACE_MS = 1_000;

export function installXtermPaneRuntime(params: any) {
  const { args, commandBlockCounterRef, commandBlocksRef, containerRef, cwd, cwdTrackingBufferRef, currentCwdRef, disconnectSessionRef, env, fitAddonRef, focusedRef, ghostSuggestionRef, inputBufferRef, inputModelRef, onCurrentCwdChangeRef, onOutputHistoryChangeRef, onSessionFinishedRef, onTerminalDimensionsChangeRef, outputHistoryRef, paneId, profileId, promptLineRef, reconnectSessionRef, remoteCommand, remoteHostId, remoteHostProduction, searchAddonRef, sessionIdRef, setCommandBlockNotice, setCommandBlockViews, setConnectionState, setGhostSuggestion, setLogNotice, setLogState, setSearchResults, shell, shellAssistEnabled = true, startupMessage, syncCommandBlockViews, target, terminalAppearance, terminalAppearanceRef, terminalFontWeight, terminalRef, terminalTheme, transientStartupMessage } = params;
    const container = containerRef.current;
    if (!container) {
      return undefined;
    }

    let disposed = false;
    let reconnectTimer: number | null = null;
    let resizeObserver: ResizeObserver | undefined;
    let sessionRun = 0;
    let suggestionRequestRun = 0;
    let suggestionTimer: number | null = null;
    let commandBlockViewSyncFrame: number | null = null;
    const assistEnabled = shellAssistEnabled !== false;
    const inputCompatibilityMode =
      params.inputCompatibilityMode === "agentTui" ? "agentTui" : "shell";
    commandBlocksRef.current = [];
    inputModelRef.current = createTerminalInputModelState();
    setCommandBlockViews([]);
    setCommandBlockNotice(null);
    setGhostSuggestion(null);
    const terminal = new XtermTerminal({
      cols: 80,
      cursorBlink: terminalAppearance.cursorBlink,
      cursorInactiveStyle: "outline",
      cursorStyle: terminalAppearance.cursorStyle,
      fontFamily: terminalAppearance.fontFamily,
      fontSize: terminalAppearance.fontSize,
      fontWeight: terminalFontWeight,
      fontWeightBold: 700,
      lineHeight: terminalAppearance.lineHeight,
      macOptionIsMeta: terminalAppearance.macOptionIsMeta,
      minimumContrastRatio: 4.5,
      rows: 24,
      scrollback: terminalAppearance.scrollback,
      theme: terminalTheme,
    });
    const fitAddon = new FitAddon();
    const searchAddon = new SearchAddon({ highlightLimit: 1000 });
    fitAddonRef.current = fitAddon;
    searchAddonRef.current = searchAddon;
    const shouldPreserveCommandBlockForOriginEraseBelow = () => {
      if (!assistEnabled) {
        return false;
      }
      const block = commandBlocksRef.current[commandBlocksRef.current.length - 1];
      if (!block || block.endMarker || isClearScreenCommand(block.command)) {
        return false;
      }
      return (
        Date.now() - block.createdAt <=
        ORIGIN_ERASE_BELOW_COMMAND_BLOCK_GRACE_MS
      );
    };
    const closeCurrentCommandBlock = () => {
      if (!assistEnabled) {
        return;
      }
      if (
        closeLatestTerminalCommandBlock({
          commandBlocksRef,
          onEndMarkerDispose: () => {
            if (!disposed) {
              scheduleCommandBlockViewSync();
            }
          },
          terminal,
        })
      ) {
        scheduleCommandBlockViewSync();
      }
    };
    const clearCommandBlocks = () => {
      if (!assistEnabled) {
        setCommandBlockViews([]);
        setCommandBlockNotice(null);
        return;
      }
      clearTerminalCommandBlocks(commandBlocksRef);
      setCommandBlockViews([]);
      setCommandBlockNotice(null);
      scheduleCommandBlockViewSync();
    };
    const registerCommandBlock = (command: string) => {
      if (!assistEnabled) {
        return;
      }
      if (
        submitTerminalCommandBlock({
          command,
          commandBlockCounterRef,
          commandBlocksRef,
          onEndMarkerDispose: () => {
            if (!disposed) {
              scheduleCommandBlockViewSync();
            }
          },
          onStartMarkerDispose: () => {
            if (!disposed) {
              scheduleCommandBlockViewSync();
            }
          },
          paneId,
          promptLine: promptLineRef.current,
          terminal,
        })
      ) {
        scheduleCommandBlockViewSync();
      }
    };
    const clearCommandBlockViewSyncFrame = () => {
      if (commandBlockViewSyncFrame === null) {
        return;
      }
      if (typeof window.cancelAnimationFrame === "function") {
        window.cancelAnimationFrame(commandBlockViewSyncFrame);
      } else {
        window.clearTimeout(commandBlockViewSyncFrame);
      }
      commandBlockViewSyncFrame = null;
    };
    const latestCommandBlockText = () => {
      if (!assistEnabled) {
        return undefined;
      }
      const block = [...commandBlocksRef.current]
        .reverse()
        .find((candidate) => candidate.submitted && candidate.command.trim());
      return block ? terminalCommandBlockPlainText(block) : undefined;
    };
    const syncCommandBlockRuntimeContext = () => {
      updateTerminalPaneRuntimeContext(paneId, {
        commandBlockText: latestCommandBlockText(),
      });
    };
    const scheduleCommandBlockViewSync = () => {
      if (!assistEnabled) {
        return;
      }
      if (commandBlockViewSyncFrame !== null) {
        return;
      }
      commandBlockViewSyncFrame =
        typeof window.requestAnimationFrame === "function"
          ? window.requestAnimationFrame(() => {
              commandBlockViewSyncFrame = null;
              if (!disposed) {
                syncCommandBlockViews();
                syncCommandBlockRuntimeContext();
              }
            })
          : window.setTimeout(() => {
              commandBlockViewSyncFrame = null;
              if (!disposed) {
                syncCommandBlockViews();
                syncCommandBlockRuntimeContext();
              }
            }, 16);
    };
    const clearSuggestionTimer = () => {
      if (suggestionTimer !== null) {
        window.clearTimeout(suggestionTimer);
        suggestionTimer = null;
      }
    };
    const updateGhostSuggestion = (suggestion: TerminalGhostSuggestion) => {
      ghostSuggestionRef.current = suggestion;
      setGhostSuggestion((current: TerminalGhostSuggestion | null) =>
        terminalGhostSuggestionEqual(current, suggestion) ? current : suggestion,
      );
    };
    const hideGhostSuggestion = () => {
      ghostSuggestionRef.current = null;
      setGhostSuggestion((current: TerminalGhostSuggestion | null) =>
        current === null ? current : null,
      );
    };
    const remoteSuggestionPrewarm = createTerminalRemoteSuggestionPrewarm({
      paneId,
      remoteHostId,
      remoteHostProduction,
      target,
      terminalAppearanceRef,
    });
    const terminalOutputInstrumentation = createTerminalOutputInstrumentation({
      paneId,
    });
    const clearGhostSuggestion = () => {
      clearSuggestionTimer();
      suggestionRequestRun += 1;
      hideGhostSuggestion();
    };
    const refreshGhostSuggestionLayout = () => {
      const suggestion = ghostSuggestionRef.current;
      if (!suggestion) {
        return;
      }
      const layout = resolveGhostSuggestionLayout(
        container,
        terminal,
        terminalAppearanceRef.current,
        inputModelRef.current,
      );
      if (!layout) {
        clearGhostSuggestion();
        return;
      }
      updateGhostSuggestion({ ...suggestion, ...layout });
    };
    const scheduleGhostSuggestion = () => {
      if (!assistEnabled) {
        clearGhostSuggestion();
        return;
      }
      clearSuggestionTimer();
      const inlineSuggestion = terminalAppearanceRef.current.inlineSuggestion;
      if (!inlineSuggestion.enabled) {
        clearGhostSuggestion();
        return;
      }
      inputModelRef.current = updateTerminalInputBufferKind(
        inputModelRef.current,
        terminal.buffer.active.type,
      );
      const eligibility = terminalSuggestionEligibility(inputModelRef.current);
      if (!eligibility.eligible) {
        clearGhostSuggestion();
        return;
      }
      suggestionTimer = window.setTimeout(() => {
        suggestionTimer = null;
        const requestRun = ++suggestionRequestRun;
        const model = inputModelRef.current;
        const layout = resolveGhostSuggestionLayout(
          container,
          terminal,
          terminalAppearanceRef.current,
          model,
        );
        if (!layout) {
          clearGhostSuggestion();
          return;
        }
        const sessionId = sessionIdRef.current;
        const containerHostId =
          target?.kind === "dockerContainer" ? target.hostId : undefined;
        const telnetHostId = target?.kind === "telnet" ? target.hostId : undefined;
        const serialHostId = target?.kind === "serial" ? target.hostId : undefined;
        const sshHostId = telnetHostId || serialHostId ? undefined : remoteHostId;
        const suggestionRemoteHostId =
          containerHostId ?? telnetHostId ?? serialHostId ?? sshHostId;
        const suggestionTarget = containerHostId
          ? "dockerContainer"
          : telnetHostId
            ? "telnet"
            : serialHostId
              ? "serial"
            : sshHostId
              ? "ssh"
              : "local";
        const suggestionProviders = terminalSuggestionProviders({
          hasSshRemote: Boolean(sshHostId && !containerHostId),
          inlineSuggestion: terminalAppearanceRef.current.inlineSuggestion,
          remoteHostProduction,
        });
        if (suggestionProviders.length === 0) {
          clearGhostSuggestion();
          return;
        }
        void listTerminalSuggestions({
          cursor: model.cursor,
          cwd: currentCwdRef.current ?? cwd,
          input: model.command,
          limit: 1,
          paneId,
          profileId,
          providers: suggestionProviders,
          remoteHostId: suggestionRemoteHostId,
          sessionId: sessionId ?? undefined,
          shell,
          target: suggestionTarget,
        })
          .then((suggestions) => {
            if (disposed || requestRun !== suggestionRequestRun) {
              return;
            }
            const candidate = suggestions.find(
              (item) => item.suffix.length > 0,
            );
            if (!candidate) {
              hideGhostSuggestion();
              return;
            }
            const nextSuggestion = {
              ...layout,
              candidate,
              suffix: candidate.suffix,
            };
            updateGhostSuggestion(nextSuggestion);
          })
          .catch(() => {
            if (!disposed && requestRun === suggestionRequestRun) {
              hideGhostSuggestion();
            }
          });
      }, 60);
    };
    const recordGhostSuggestionFeedback = (
      action: "accepted" | "dismissed",
      suggestion: TerminalGhostSuggestion,
      input: string,
    ) => {
      const sessionId = sessionIdRef.current;
        const containerHostId =
          target?.kind === "dockerContainer" ? target.hostId : undefined;
        const telnetHostId = target?.kind === "telnet" ? target.hostId : undefined;
        const serialHostId = target?.kind === "serial" ? target.hostId : undefined;
        const sshHostId = telnetHostId || serialHostId ? undefined : remoteHostId;
        const suggestionRemoteHostId =
          containerHostId ?? telnetHostId ?? serialHostId ?? sshHostId;
        const suggestionTarget = containerHostId
          ? "dockerContainer"
          : telnetHostId
            ? "telnet"
            : serialHostId
              ? "serial"
            : sshHostId
            ? "ssh"
            : "local";
      const candidate = suggestion.candidate;
      void recordTerminalSuggestionFeedback({
        action,
        cwd: currentCwdRef.current ?? cwd,
        input,
        paneId,
        profileId,
        provider: candidate.provider,
        remoteHostId: suggestionRemoteHostId,
        replacementText: candidate.replacementText,
        sessionId: sessionId ?? undefined,
        shell,
        sourceId: candidate.sourceId,
        target: suggestionTarget,
      }).catch(() => undefined);
    };
    const acceptGhostSuggestion = (sessionId: string) => {
      if (
        terminalAppearanceRef.current.inlineSuggestion.acceptKey !==
        "rightArrow"
      ) {
        return false;
      }
      const suggestion = ghostSuggestionRef.current;
      if (!suggestion?.suffix) {
        return false;
      }
      recordGhostSuggestionFeedback(
        "accepted",
        suggestion,
        inputModelRef.current.command,
      );
      void writeTerminal(sessionId, suggestion.suffix);
      const accepted = applyTerminalInputData(
        inputModelRef.current,
        suggestion.suffix,
      );
      inputModelRef.current = accepted.state;
      inputBufferRef.current = accepted.state.command;
      clearGhostSuggestion();
      scheduleCommandBlockViewSync();
      return true;
    };
    const inputDisposable = terminal.onData((data) => {
      const sessionId = sessionIdRef.current;
      if (!sessionId) {
        return;
      }
      if (isRightArrowInput(data) && acceptGhostSuggestion(sessionId)) {
        return;
      }
      const collected = applyTerminalInputData(inputModelRef.current, data);
      inputModelRef.current = updateTerminalInputBufferKind(
        collected.state,
        terminal.buffer.active.type,
      );
      inputBufferRef.current = inputModelRef.current.command;
      for (const command of collected.commands) {
        const dismissedSuggestion = ghostSuggestionRef.current;
        clearGhostSuggestion();
        registerCommandBlock(command);
        if (!command) {
          continue;
        }
        if (assistEnabled) {
          if (
            dismissedSuggestion &&
            dismissedSuggestion.candidate.replacementText !== command
          ) {
            recordGhostSuggestionFeedback("dismissed", dismissedSuggestion, command);
          }
          const commandCwd = currentCwdRef.current ?? cwd;
          const containerHostId =
            target?.kind === "dockerContainer" ? target.hostId : undefined;
          const telnetHostId = target?.kind === "telnet" ? target.hostId : undefined;
          const serialHostId = target?.kind === "serial" ? target.hostId : undefined;
          const sshHostId = telnetHostId || serialHostId ? undefined : remoteHostId;
          const historyRemoteHostId =
            containerHostId ?? telnetHostId ?? serialHostId ?? sshHostId;
          const historyTarget = containerHostId
            ? "dockerContainer"
            : telnetHostId
              ? "telnet"
              : serialHostId
                ? "serial"
              : sshHostId
                ? "ssh"
                : "local";
          void recordCommandHistory({
            command,
            cwd: commandCwd,
            paneId,
            profileId,
            remoteHostId: historyRemoteHostId,
            sessionId,
            shell,
            source: "user",
            target: historyTarget,
          });
        }
      }
      void writeTerminal(sessionId, data);
      if (collected.commands.length === 0) {
        scheduleCommandBlockViewSync();
        scheduleGhostSuggestion();
      }
    });
    terminal.attachCustomKeyEventHandler((event) => {
      const compatibilityOverride = resolveTerminalInputCompatibilityOverride(
        event,
        inputCompatibilityMode,
      );
      if (compatibilityOverride) {
        event.preventDefault();
        event.stopPropagation();
        const sessionId = sessionIdRef.current;
        if (sessionId) {
          void writeTerminal(sessionId, compatibilityOverride.data);
        }
        return false;
      }
      return true;
    });
    const selectionDisposable = terminal.onSelectionChange(() => {
      const selection = terminal.getSelection?.() ?? "";
      updateTerminalPaneRuntimeContext(paneId, { selectedText: selection });
      if (!terminalAppearanceRef.current.selectionCopy) {
        return;
      }
      if (selection) {
        void writeDesktopClipboardText(selection);
      }
    });

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(searchAddon);
    const searchResultDisposable = searchAddon.onDidChangeResults((event) => {
      setSearchResults({
        hasSearched: true,
        resultCount: event.resultCount,
        resultIndex: event.resultIndex,
      });
    });
    const scrollDisposable = terminal.onScroll(() => {
      scheduleCommandBlockViewSync();
      refreshGhostSuggestionLayout();
    });
    const writeParsedDisposable = terminal.onWriteParsed(() => {
      clearCommandBlockViewSyncFrame();
      syncCommandBlockViews();
      syncCommandBlockRuntimeContext();
      refreshGhostSuggestionLayout();
    });
    const bufferChangeDisposable = terminal.buffer.onBufferChange(() => {
      const nextBufferType = terminal.buffer.active.type;
      if (nextBufferType === "alternate") {
        closeCurrentCommandBlock();
      }
      inputModelRef.current = updateTerminalInputBufferKind(
        inputModelRef.current,
        nextBufferType,
      );
      inputBufferRef.current = inputModelRef.current.command;
      if (nextBufferType === "alternate") {
        clearGhostSuggestion();
      } else {
        refreshGhostSuggestionLayout();
      }
      scheduleCommandBlockViewSync();
    });
    const xtermElement = container.querySelector(".xterm");
    const compositionTarget = xtermElement ?? container;
    const handleCompositionStart = () => {
      inputModelRef.current = updateTerminalInputComposition(
        inputModelRef.current,
        true,
      );
      inputBufferRef.current = inputModelRef.current.command;
      clearGhostSuggestion();
    };
    const handleCompositionEnd = () => {
      inputModelRef.current = updateTerminalInputComposition(
        inputModelRef.current,
        false,
      );
      inputBufferRef.current = inputModelRef.current.command;
      scheduleGhostSuggestion();
    };
    compositionTarget.addEventListener(
      "compositionstart",
      handleCompositionStart,
    );
    compositionTarget.addEventListener("compositionend", handleCompositionEnd);
    terminal.open(container);
    terminalRef.current = terminal;
    if (shouldEnableKittyKeyboardProtocol(inputCompatibilityMode)) {
      terminal.write(KITTY_KEYBOARD_PROTOCOL_ENABLE);
    }
    let suppressNextPasteEvent = false;
    let suppressPasteResetTimer: number | null = null;
    const clearRuntimePasteSuppression = () => {
      suppressNextPasteEvent = false;
      if (suppressPasteResetTimer !== null) {
        window.clearTimeout(suppressPasteResetTimer);
        suppressPasteResetTimer = null;
      }
    };
    const armRuntimePasteSuppression = () => {
      clearRuntimePasteSuppression();
      suppressNextPasteEvent = true;
      suppressPasteResetTimer = window.setTimeout(() => {
        suppressNextPasteEvent = false;
        suppressPasteResetTimer = null;
      }, 500);
    };
    const handleRuntimeKeydown = (event: KeyboardEvent) => {
      const runtimeOverride = resolveTerminalRuntimeKeydownOverride(event);
      if (!runtimeOverride) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (runtimeOverride.suppressPasteEvent) {
        armRuntimePasteSuppression();
      }
      const sessionId = sessionIdRef.current;
      if (sessionId) {
        void writeTerminal(sessionId, runtimeOverride.data);
      }
    };
    const handleRuntimePaste = (event: ClipboardEvent) => {
      if (!suppressNextPasteEvent) {
        return;
      }

      clearRuntimePasteSuppression();
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    };
    container.addEventListener("keydown", handleRuntimeKeydown, true);
    container.addEventListener("paste", handleRuntimePaste, true);
    const commandBlockClearHandlersDisposable = registerCommandBlockClearHandlers(
      terminal,
      clearCommandBlocks,
      {
        shouldPreserveOriginEraseBelow:
          shouldPreserveCommandBlockForOriginEraseBelow,
      },
    );
    const outputWriter = createTerminalOutputWriter(terminal);
    outputWriter.writeNow(outputHistoryRef.current ?? "");
    const outputHistoryBuffer = createTerminalOutputHistoryBuffer({
      onOutputHistoryChangeRef,
      outputHistoryRef,
    });

    const fitAndResize = () => {
      fitAddon.fit();
      const sessionId = sessionIdRef.current;
      const dimensions = { cols: terminal.cols, rows: terminal.rows };
      onTerminalDimensionsChangeRef.current?.(dimensions);
      if (!sessionId) {
        return;
      }

      void resizeTerminal(sessionId, dimensions);
      refreshGhostSuggestionLayout();
    };

    const clearSessionState = (sessionId: string) => {
      if (sessionIdRef.current === sessionId) {
        sessionIdRef.current = null;
      }
      unregisterTerminalPaneSession(paneId, sessionId);
      setLogState({ active: false, bytesWritten: 0 });
    };

    const clearReconnectTimer = () => {
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };

    const scheduleReconnect = () => {
      if (
        !terminalAppearanceRef.current.autoReconnect ||
        reconnectTimer !== null
      ) {
        return;
      }
      outputWriter.writeNow("\r\n3 秒后自动重新连接...\r\n");
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        void startSession("reconnect");
      }, 3000);
    };

    let transientStartupNoticeVisible = false;
    const startupNoticeFor = (reason: "initial" | "reconnect") => {
      if (reason === "reconnect") {
        return "\r\n正在重新连接...\r\n";
      }
      if (typeof startupMessage === "string") {
        return startupMessage;
      }
      return target?.kind === "dockerContainer"
        ? "正在进入容器...\r\n"
        : target?.kind === "telnet"
          ? "正在连接 Telnet 主机...\r\n"
          : target?.kind === "serial"
            ? "正在连接 Serial 设备...\r\n"
          : remoteHostId
            ? "正在连接 SSH 主机...\r\n"
            : "正在启动本地终端...\r\n";
    };

    const closeActiveSession = async () => {
      const sessionId = sessionIdRef.current;
      if (!sessionId) {
        return true;
      }

      clearSessionState(sessionId);
      try {
        await closeTerminal(sessionId);
        return true;
      } catch (error: unknown) {
        if (!disposed) {
          outputWriter.writeNow(
            `\r\n关闭终端会话失败：${errorMessage(error)}\r\n`,
          );
          setConnectionState("error");
        }
        return false;
      }
    };

    const startSession = async (reason: "initial" | "reconnect") => {
      const currentRun = ++sessionRun;
      const closed = await closeActiveSession();
      if (!closed || disposed || sessionRun !== currentRun) {
        return;
      }

      setConnectionState("connecting");
      terminalSuggestionProbeScheduler.cancelOwner(paneId);
      setLogNotice(null);
      inputBufferRef.current = "";
      inputModelRef.current = createTerminalInputModelState();
      cwdTrackingBufferRef.current = "";
      clearGhostSuggestion();
      const startupNotice = startupNoticeFor(reason);
      transientStartupNoticeVisible = Boolean(
        transientStartupMessage &&
          reason === "initial" &&
          startupNotice.trim().length > 0,
      );
      outputWriter.writeNow(startupNotice);
      const sessionStartedAtMs = Date.now();

      const handleOutput = (event: TerminalOutputEvent) => {
        if (disposed || sessionRun !== currentRun) {
          return;
        }

        if (event.kind === "data") {
          if (transientStartupNoticeVisible) {
            outputWriter.writeNow("\x1b[1A\x1b[2K\r");
            transientStartupNoticeVisible = false;
          }
          if (remoteHostId || target?.kind === "dockerContainer") {
            const tracked = runTerminalOutputInstrumentationStep(
              terminalOutputInstrumentation,
              "cwdOsc",
              event.data.length,
              () =>
                collectCurrentDirOscSequences(
                  cwdTrackingBufferRef.current,
                  event.data,
                ),
            );
            cwdTrackingBufferRef.current = tracked.buffer;
            for (const nextCwd of tracked.paths) {
              if (nextCwd !== currentCwdRef.current) {
                currentCwdRef.current = nextCwd;
                updateTerminalPaneSessionCwd(paneId, nextCwd);
                onCurrentCwdChangeRef.current?.(nextCwd);
                if (assistEnabled) {
                  runTerminalOutputInstrumentationStep(
                    terminalOutputInstrumentation,
                    "remotePrewarmGit",
                    nextCwd.length,
                    () => remoteSuggestionPrewarm.scheduleGit(nextCwd),
                  );
                  runTerminalOutputInstrumentationStep(
                    terminalOutputInstrumentation,
                    "remotePrewarmPath",
                    nextCwd.length,
                    () => remoteSuggestionPrewarm.scheduleRemotePath(nextCwd),
                  );
                }
              }
            }
          }
          if (assistEnabled) {
            runTerminalOutputInstrumentationStep(
              terminalOutputInstrumentation,
              "commandBlock",
              event.data.length,
              () => appendCommandBlockOutput(commandBlocksRef.current, event.data),
            );
          }
          runTerminalOutputInstrumentationStep(
            terminalOutputInstrumentation,
            "writer",
            event.data.length,
            () => outputWriter.write(event.data),
          );
          runTerminalOutputInstrumentationStep(
            terminalOutputInstrumentation,
            "history",
            event.data.length,
            () => outputHistoryBuffer.append(event.data),
          );
          return;
        }
        if (event.kind === "closed") {
          clearGhostSuggestion();
          markTerminalPaneSessionDisconnected(paneId, event.sessionId);
          clearSessionState(event.sessionId);
          onSessionFinishedRef?.current?.({
            durationMs: Math.max(0, Date.now() - sessionStartedAtMs),
            reason: "closed",
            sessionId: event.sessionId,
          });
          outputWriter.writeNow("\r\n会话已结束。\r\n");
          setConnectionState("closed");
          scheduleReconnect();
          return;
        }
        clearGhostSuggestion();
        markTerminalPaneSessionDisconnected(paneId, event.sessionId);
        outputWriter.writeNow(`\r\n终端输出读取失败：${event.data}\r\n`);
        setConnectionState("error");
        scheduleReconnect();
      };

      try {
        const sessionSize = normalizeTerminalSessionSize({
          cols: terminal.cols,
          rows: terminal.rows,
        });
        const session =
          target?.kind === "dockerContainer"
            ? await createDockerContainerTerminalSession(
                {
                  cols: sessionSize.cols,
                  containerId: target.containerId,
                  hostId: target.hostId,
                  rows: sessionSize.rows,
                  runtime: target.runtime,
                  shell,
                  user: target.user,
                  workdir: target.workdir,
                },
                handleOutput,
              )
            : target?.kind === "telnet"
              ? await createTelnetTerminalSession(
                  {
                    cols: sessionSize.cols,
                    hostId: target.hostId,
                    rows: sessionSize.rows,
                  },
                  handleOutput,
                )
              : target?.kind === "serial"
                ? await createSerialTerminalSession(
                    {
                      cols: sessionSize.cols,
                      hostId: target.hostId,
                      rows: sessionSize.rows,
                    },
                    handleOutput,
                  )
            : remoteHostId
              ? await createSshTerminalSession(
                  {
                    cols: sessionSize.cols,
                    ...(currentCwdRef.current ?? cwd
                      ? { cwd: currentCwdRef.current ?? cwd }
                      : {}),
                    hostId: remoteHostId,
                    ...(remoteCommand ? { remoteCommand } : {}),
                    rows: sessionSize.rows,
                  },
                  handleOutput,
                )
              : await createTerminalSession(
                  buildTerminalCreateRequest({
                    args,
                    cols: sessionSize.cols,
                    cwd,
                    env,
                    rows: sessionSize.rows,
                    shell,
                  }),
                  handleOutput,
                );

        if (disposed || sessionRun !== currentRun) {
          void closeTerminal(session.id);
          return;
        }
        sessionIdRef.current = session.id;
        registerTerminalPaneSession(paneId, session.id, {
          containerId:
            target?.kind === "dockerContainer" ? target.containerId : undefined,
          containerRuntime:
            target?.kind === "dockerContainer"
              ? (target.runtime ?? "docker")
              : undefined,
          cwd: currentCwdRef.current ?? cwd,
          profileId,
          remoteHostId:
            target?.kind === "dockerContainer" ||
            target?.kind === "telnet" ||
            target?.kind === "serial"
              ? target.hostId
              : remoteHostId,
          shell,
          target: terminalSessionTargetKind(target, remoteHostId),
          targetRef: session.targetRef,
          targetToken: session.targetToken,
        });
        if (reason === "reconnect") {
          markTerminalPaneSessionReconnected(paneId, session.id);
        }
        setConnectionState("connected");
        if (assistEnabled) {
          remoteSuggestionPrewarm.scheduleGit(currentCwdRef.current ?? cwd);
          remoteSuggestionPrewarm.scheduleRemoteCommand();
          remoteSuggestionPrewarm.scheduleRemoteHistory();
          remoteSuggestionPrewarm.scheduleRemotePath(currentCwdRef.current ?? cwd);
        }
        void getTerminalLogState(session.id)
          .then((nextState) => {
            if (
              !disposed &&
              sessionRun === currentRun &&
              sessionIdRef.current === session.id
            ) {
              setLogState(nextState);
            }
          })
          .catch(() => {
            if (
              !disposed &&
              sessionRun === currentRun &&
              sessionIdRef.current === session.id
            ) {
              setLogState({ active: false, bytesWritten: 0 });
            }
          });
        fitAndResize();
        if (focusedRef.current) {
          terminal.focus();
        }
      } catch (error: unknown) {
        if (disposed || sessionRun !== currentRun) {
          return;
        }
        outputWriter.writeNow(
          `\r\n${terminalSessionFailureLabel(target, remoteHostId)}：${errorMessage(error)}\r\n`,
        );
        setConnectionState("error");
      }
    };

    const disconnectSession = async () => {
      const currentRun = ++sessionRun;
      clearReconnectTimer();
      terminalSuggestionProbeScheduler.cancelOwner(paneId);
      const sessionId = sessionIdRef.current;
      if (!sessionId) {
        setConnectionState("disconnected");
        outputWriter.writeNow(
          "\r\n当前没有活动会话，可通过右键菜单重新连接。\r\n",
        );
        return;
      }

      markTerminalPaneSessionDisconnected(paneId, sessionId);
      clearSessionState(sessionId);
      setLogNotice(null);
      inputBufferRef.current = "";
      inputModelRef.current = createTerminalInputModelState();
      cwdTrackingBufferRef.current = "";
      clearGhostSuggestion();
      try {
        await closeTerminal(sessionId);
        if (disposed || sessionRun !== currentRun) {
          return;
        }
        setConnectionState("disconnected");
        outputWriter.writeNow("\r\n连接已断开，可通过右键菜单重新连接。\r\n");
      } catch (error: unknown) {
        if (disposed || sessionRun !== currentRun) {
          return;
        }
        outputWriter.writeNow(`\r\n断开连接失败：${errorMessage(error)}\r\n`);
        setConnectionState("error");
      }
    };

    reconnectSessionRef.current = () => startSession("reconnect");
    disconnectSessionRef.current = disconnectSession;
    void startSession("initial");

    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(fitAndResize);
      resizeObserver.observe(container);
    }

    return () => {
      disposed = true;
      sessionRun += 1;
      resizeObserver?.disconnect();
      clearReconnectTimer();
      terminalSuggestionProbeScheduler.cancelOwner(paneId);
      clearSuggestionTimer();
      clearCommandBlockViewSyncFrame();
      outputHistoryBuffer.dispose();
      inputDisposable.dispose();
      selectionDisposable.dispose();
      searchResultDisposable.dispose();
      scrollDisposable.dispose();
      writeParsedDisposable.dispose();
      bufferChangeDisposable.dispose();
      compositionTarget.removeEventListener(
        "compositionstart",
        handleCompositionStart,
      );
      compositionTarget.removeEventListener(
        "compositionend",
        handleCompositionEnd,
      );
      container.removeEventListener("keydown", handleRuntimeKeydown, true);
      container.removeEventListener("paste", handleRuntimePaste, true);
      clearRuntimePasteSuppression();
      commandBlockClearHandlersDisposable.dispose();
      const sessionId = sessionIdRef.current;
      sessionIdRef.current = null;
      reconnectSessionRef.current = null;
      disconnectSessionRef.current = null;
      if (sessionId) {
        unregisterTerminalPaneSession(paneId, sessionId);
        void closeTerminal(sessionId);
      }
      outputWriter.dispose();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      searchAddonRef.current = null;
      cwdTrackingBufferRef.current = "";
      ghostSuggestionRef.current = null;
      setGhostSuggestion(null);
      setLogState({ active: false, bytesWritten: 0 });
      setLogNotice(null);
    };
}

function isClearScreenCommand(command: string) {
  return /^(?:clear|cls|clear-host|reset)(?:\s|$)/i.test(command.trim());
}
