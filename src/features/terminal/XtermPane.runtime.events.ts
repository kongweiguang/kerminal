// @author kongweiguang
import type { MutableRefObject } from "react";
import type { SearchAddon } from "@xterm/addon-search";
import type { Terminal as XtermTerminal } from "@xterm/xterm";
import { recordCommandHistory } from "../../lib/commandHistoryApi";
import { writeDesktopClipboardText } from "../../lib/desktopClipboardApi";
import { writeTerminal } from "../../lib/terminalApi";
import {
  applyTerminalInputData,
  updateTerminalInputBufferKind,
  updateTerminalInputComposition,
  type TerminalInputModelState,
} from "./terminalInputModel";
import {
  resolveTerminalInputCompatibilityOverride,
  resolveTerminalRuntimeKeydownOverride,
  type TerminalInputCompatibilityMode,
} from "./terminalKeyboardPolicy";
import {
  reduceTerminalShellIntegrationState,
  type TerminalShellIntegrationState,
} from "./terminalShellIntegrationModel";
import type { XtermPaneActivityRuntime } from "./XtermPane.activityRuntime";
import type { createXtermPaneCommandBlockRuntime } from "./XtermPane.commandBlockRuntime";
import type { createXtermPaneGhostSuggestions } from "./XtermPane.ghostSuggestions";
import {
  isRightArrowInput,
  resolveTerminalPromptLine,
} from "./XtermPane.helpers";
import type { createTerminalInlineSshAuthPrompt } from "./XtermPane.inlineSshAuthPrompt";
import type { TerminalPaneRuntimeLifecycleRuntime } from "./terminalPaneRuntimeLifecycleRuntime";
import type { RemoteTargetRef } from "../../lib/targetModel";
import type { TerminalAppearance } from "../settings/contracts/index";
import { updateTerminalPaneRuntimeContext } from "./terminalSessionRegistry";
import { syncTerminalImeAnchor } from "./terminalImeAnchor";

type CommandBlockRuntime = ReturnType<
  typeof createXtermPaneCommandBlockRuntime
>;
type GhostSuggestionsRuntime = ReturnType<
  typeof createXtermPaneGhostSuggestions
>;
type InlineSshAuthPrompt = ReturnType<typeof createTerminalInlineSshAuthPrompt>;

interface RuntimeEventsParams {
  activityRuntimeRef: MutableRefObject<XtermPaneActivityRuntime | null>;
  assistEnabled: boolean;
  commandBlockRuntime: CommandBlockRuntime;
  compositionTarget: Element;
  container: HTMLElement;
  currentCwdRef: MutableRefObject<string | undefined>;
  cwd?: string;
  ghostSuggestions: GhostSuggestionsRuntime;
  ghostSuggestionRef: MutableRefObject<
    | Parameters<GhostSuggestionsRuntime["recordGhostSuggestionFeedback"]>[1]
    | null
  >;
  inputBufferRef: MutableRefObject<string>;
  inputCompatibilityMode: TerminalInputCompatibilityMode;
  inputModelRef: MutableRefObject<TerminalInputModelState>;
  paneId: string;
  profileId?: string;
  remoteHostId?: string;
  searchAddon: SearchAddon;
  sessionIdRef: MutableRefObject<string | null>;
  setSearchResults: (value: {
    hasSearched: boolean;
    resultCount: number;
    resultIndex: number;
  }) => void;
  shell?: string;
  shellIntegrationCommandBlockProtocolRef: MutableRefObject<boolean>;
  syncCommandBlockViews: () => void;
  target?: RemoteTargetRef;
  terminal: XtermTerminal;
  terminalAppearanceRef: MutableRefObject<TerminalAppearance>;
  terminalInlineSshAuthPrompt: InlineSshAuthPrompt;
  terminalRuntimeLifecycleControllerRef: MutableRefObject<TerminalPaneRuntimeLifecycleRuntime | null>;
  readShellIntegrationState: () => TerminalShellIntegrationState;
  writeShellIntegrationState: (state: TerminalShellIntegrationState) => void;
  onArtifactCommandBlock?: (id: string, command: string) => void;
  onArtifactInvalidate?: (reason: "clear" | "restart") => void;
}

export interface XtermPaneRuntimeEvents {
  dispose: () => void;
}

/**
 * 集中注册并释放 Xterm 的输入、选择、buffer 与 DOM 事件。
 * 该边界只管理事件生命周期，状态仍由调用方持有，避免改变既有会话时序。
 */
export function registerXtermPaneRuntimeEvents(
  params: RuntimeEventsParams,
): XtermPaneRuntimeEvents {
  const {
    activityRuntimeRef,
    assistEnabled,
    commandBlockRuntime,
    compositionTarget,
    container,
    currentCwdRef,
    cwd,
    ghostSuggestions,
    ghostSuggestionRef,
    inputBufferRef,
    inputCompatibilityMode,
    inputModelRef,
    paneId,
    profileId,
    remoteHostId,
    searchAddon,
    sessionIdRef,
    setSearchResults,
    shell,
    shellIntegrationCommandBlockProtocolRef,
    syncCommandBlockViews,
    target,
    terminal,
    terminalAppearanceRef,
    terminalInlineSshAuthPrompt,
    terminalRuntimeLifecycleControllerRef,
    readShellIntegrationState,
    writeShellIntegrationState,
    onArtifactCommandBlock,
    onArtifactInvalidate,
  } = params;

  const reduceShellIntegration = (
    event: Parameters<typeof reduceTerminalShellIntegrationState>[1],
  ) => {
    writeShellIntegrationState(
      reduceTerminalShellIntegrationState(readShellIntegrationState(), event),
    );
  };

  const inputDisposable = terminal.onData((data) => {
    activityRuntimeRef.current?.markUserInput();
    terminalRuntimeLifecycleControllerRef.current?.markUserInteraction();
    if (terminalInlineSshAuthPrompt.handleInput(data)) {
      return;
    }
    const sessionId = sessionIdRef.current;
    if (!sessionId) {
      return;
    }
    if (
      isRightArrowInput(data) &&
      ghostSuggestions.acceptGhostSuggestion(sessionId)
    ) {
      return;
    }
    const printableInput = Array.from(data)
      .filter((character) => {
        const codePoint = character.codePointAt(0);
        return (
          typeof codePoint === "number" &&
          codePoint >= 0x20 &&
          codePoint !== 0x7f
        );
      })
      .join("");
    if (
      inputModelRef.current.bufferKind === "normal" &&
      inputModelRef.current.command.length === 0 &&
      printableInput.length > 0
    ) {
      const shellPromptVisible =
        resolveTerminalPromptLine(terminal, printableInput) !== undefined;
      if (shellPromptVisible) {
        // 这里只收口命令色条；Codex 的 `>` 也可能命中提示符启发式，不能据此关闭输出保护。
        commandBlockRuntime.setInteractiveTuiActive(false);
      } else if (
        commandBlockRuntime.hasOpenCommandBlock() &&
        readTerminalCursorLine(terminal).trim().length > 0
      ) {
        // inline TUI 通常不切 alternate buffer；在首个输入字符处识别，避免把启动命令块延伸进 TUI。
        commandBlockRuntime.setInteractiveTuiActive(true);
      }
    }
    const collected = applyTerminalInputData(inputModelRef.current, data);
    inputModelRef.current = updateTerminalInputBufferKind(
      collected.state,
      terminal.buffer.active.type,
    );
    reduceShellIntegration({ data, type: "input" });
    inputBufferRef.current = inputModelRef.current.command;
    for (const command of collected.commands) {
      const dismissedSuggestion = ghostSuggestionRef.current;
      ghostSuggestions.clearGhostSuggestion();
      if (
        assistEnabled &&
        shellIntegrationCommandBlockProtocolRef.current &&
        readShellIntegrationState().trusted
      ) {
        commandBlockRuntime.setPendingProtocolCommand(command);
      } else {
        commandBlockRuntime.registerCommandBlock(command);
      }
      if (command.trim()) {
        onArtifactCommandBlock?.(`${paneId}:input:${Date.now()}`, command);
      }
      if (!command) {
        continue;
      }
      if (assistEnabled) {
        if (
          dismissedSuggestion &&
          dismissedSuggestion.candidate.replacementText !== command
        ) {
          ghostSuggestions.recordGhostSuggestionFeedback(
            "dismissed",
            dismissedSuggestion,
            command,
          );
        }
        const containerHostId =
          target?.kind === "dockerContainer" ? target.hostId : undefined;
        const telnetHostId =
          target?.kind === "telnet" ? target.hostId : undefined;
        const serialHostId =
          target?.kind === "serial" ? target.hostId : undefined;
        const sshHostId =
          telnetHostId || serialHostId ? undefined : remoteHostId;
        void recordCommandHistory({
          command,
          cwd: currentCwdRef.current ?? cwd,
          paneId,
          profileId,
          remoteHostId:
            containerHostId ?? telnetHostId ?? serialHostId ?? sshHostId,
          sessionId,
          shell,
          source: "user",
          target: containerHostId
            ? "dockerContainer"
            : telnetHostId
              ? "telnet"
              : serialHostId
                ? "serial"
                : sshHostId
                  ? "ssh"
                  : "local",
        });
      }
    }
    void writeTerminal(sessionId, data);
    if (collected.commands.length === 0) {
      commandBlockRuntime.scheduleCommandBlockViewSync();
      ghostSuggestions.scheduleGhostSuggestion();
    }
  });

  terminal.attachCustomKeyEventHandler((event) => {
    const sessionId = sessionIdRef.current;
    if (sessionId && ghostSuggestions.handleRuntimeKeyEvent(event, sessionId)) {
      event.preventDefault();
      event.stopPropagation();
      return false;
    }
    const compatibilityOverride = resolveTerminalInputCompatibilityOverride(
      event,
      inputCompatibilityMode,
    );
    if (!compatibilityOverride) {
      return true;
    }
    event.preventDefault();
    event.stopPropagation();
    if (sessionId) {
      terminalRuntimeLifecycleControllerRef.current?.markUserInteraction();
      reduceShellIntegration({
        data: compatibilityOverride.data,
        type: "input",
      });
      void writeTerminal(sessionId, compatibilityOverride.data);
    }
    return false;
  });

  const selectionDisposable = terminal.onSelectionChange(() => {
    const selection = terminal.getSelection?.() ?? "";
    ghostSuggestions.setLifecycle({ selectionActive: Boolean(selection) });
    updateTerminalPaneRuntimeContext(paneId, { selectedText: selection });
    if (!terminalAppearanceRef.current.selectionCopy) {
      return;
    }
    if (selection) {
      void writeDesktopClipboardText(selection);
    }
  });
  const searchResultDisposable = searchAddon.onDidChangeResults((event) => {
    setSearchResults({
      hasSearched: true,
      resultCount: event.resultCount,
      resultIndex: event.resultIndex,
    });
  });
  const scrollDisposable = terminal.onScroll(() => {
    activityRuntimeRef.current?.markScrollPosition();
    commandBlockRuntime.scheduleCommandBlockViewSync();
    ghostSuggestions.refreshGhostSuggestionLayout();
  });
  const writeParsedDisposable = terminal.onWriteParsed(() => {
    commandBlockRuntime.clearCommandBlockViewSyncFrame();
    syncCommandBlockViews();
    commandBlockRuntime.syncCommandBlockRuntimeContext();
    ghostSuggestions.refreshGhostSuggestionLayout();
  });
  const bufferChangeDisposable = terminal.buffer.onBufferChange(() => {
    activityRuntimeRef.current?.markBufferChanged();
    const nextBufferType = terminal.buffer.active.type;
    ghostSuggestions.setLifecycle({
      alternateScreen: nextBufferType === "alternate",
    });
    reduceShellIntegration({
      bufferType: nextBufferType === "alternate" ? "alternate" : "normal",
      type: "buffer",
    });
    if (nextBufferType === "alternate") {
      commandBlockRuntime.closeCurrentCommandBlock();
      onArtifactInvalidate?.("clear");
    }
    inputModelRef.current = updateTerminalInputBufferKind(
      inputModelRef.current,
      nextBufferType,
    );
    inputBufferRef.current = inputModelRef.current.command;
    if (nextBufferType === "alternate") {
      ghostSuggestions.clearGhostSuggestion();
    } else {
      ghostSuggestions.refreshGhostSuggestionLayout();
    }
    commandBlockRuntime.scheduleCommandBlockViewSync();
  });

  const handleCompositionStart = () => {
    syncTerminalImeAnchor(terminal, compositionTarget);
    inputModelRef.current = updateTerminalInputComposition(
      inputModelRef.current,
      true,
    );
    inputBufferRef.current = inputModelRef.current.command;
    ghostSuggestions.setLifecycle({ imeComposing: true });
    ghostSuggestions.clearGhostSuggestion();
  };
  const handleCompositionUpdate = () => {
    syncTerminalImeAnchor(terminal, compositionTarget);
  };
  const handleCompositionEnd = () => {
    inputModelRef.current = updateTerminalInputComposition(
      inputModelRef.current,
      false,
    );
    inputBufferRef.current = inputModelRef.current.command;
    ghostSuggestions.setLifecycle({ imeComposing: false });
    ghostSuggestions.scheduleGhostSuggestion();
  };
  compositionTarget.addEventListener(
    "compositionstart",
    handleCompositionStart,
  );
  compositionTarget.addEventListener(
    "compositionupdate",
    handleCompositionUpdate,
  );
  compositionTarget.addEventListener("compositionend", handleCompositionEnd);

  let suppressNextPasteEvent = false;
  let suppressPasteResetTimer: number | null = null;
  const clearRuntimePasteSuppression = () => {
    suppressNextPasteEvent = false;
    if (suppressPasteResetTimer !== null) {
      window.clearTimeout(suppressPasteResetTimer);
      suppressPasteResetTimer = null;
    }
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
      clearRuntimePasteSuppression();
      suppressNextPasteEvent = true;
      suppressPasteResetTimer = window.setTimeout(() => {
        suppressNextPasteEvent = false;
        suppressPasteResetTimer = null;
      }, 500);
    }
    const sessionId = sessionIdRef.current;
    if (sessionId) {
      reduceShellIntegration({ data: runtimeOverride.data, type: "input" });
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

  return {
    dispose: () => {
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
        "compositionupdate",
        handleCompositionUpdate,
      );
      compositionTarget.removeEventListener(
        "compositionend",
        handleCompositionEnd,
      );
      container.removeEventListener("keydown", handleRuntimeKeydown, true);
      container.removeEventListener("paste", handleRuntimePaste, true);
      clearRuntimePasteSuppression();
    },
  };
}

function readTerminalCursorLine(terminal: XtermTerminal) {
  const buffer = terminal.buffer.active as typeof terminal.buffer.active & {
    baseY?: number;
    cursorY?: number;
  };
  if (typeof buffer.baseY !== "number" || typeof buffer.cursorY !== "number") {
    return "";
  }
  return (
    buffer.getLine(buffer.baseY + buffer.cursorY)?.translateToString(true) ?? ""
  );
}
