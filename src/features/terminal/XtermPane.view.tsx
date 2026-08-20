// @author kongweiguang

import type { MouseEvent, ReactNode, RefObject } from "react";
import type { Terminal as XtermTerminal } from "@xterm/xterm";
import type { TerminalAppearance } from "../settings/contracts/index";
import { TerminalCommandBlockRail, type TerminalCommandBlockAction } from "./TerminalCommandBlockRail";
import {
  TerminalContextMenu,
  type TerminalContextMenuAction,
  type TerminalContextMenuPosition,
} from "./TerminalContextMenu";
import type { TerminalCommandBlockView } from "./terminalCommandBlocks";
import type { TerminalPaneChromeSnapshot } from "./terminalChromeRuntimeStore";
import type { ConnectionState, TerminalGhostSuggestion } from "./XtermPane.helpers";
import type { XtermPaneActivityRuntime } from "./XtermPane.activityRuntime";
import { TerminalNewOutputButton } from "./TerminalNewOutputButton";
import { TerminalSearchPanel } from "./TerminalSearchPanel";
import { XtermPaneChrome } from "./XtermPaneChrome";
import type { XtermPaneSearchController } from "./XtermPane.search";

export interface XtermPaneContextMenuState {
  canCopy: boolean;
  canCopySessionId: boolean;
  canSendSelectionToAgent: boolean;
  canSendToAgent: boolean;
  position: TerminalContextMenuPosition;
}

interface XtermPaneViewProps {
  activityRuntimeRef: RefObject<XtermPaneActivityRuntime | null>;
  agentSendActionsEnabled: boolean;
  backgroundImageVisible: boolean;
  commandBlockNotice: string | null;
  commandBlockViews: TerminalCommandBlockView[];
  connectionState: ConnectionState;
  containerRef: RefObject<HTMLDivElement | null>;
  contextMenu: XtermPaneContextMenuState | null;
  ghostSuggestion: TerminalGhostSuggestion | null;
  logActive: boolean;
  logNotice: string | null;
  logPath?: string;
  onCloseContextMenu(): void;
  onCommandBlockAction(blockId: string, action: TerminalCommandBlockAction): void;
  onContextMenu(event: MouseEvent): void;
  onContextMenuAction(action: TerminalContextMenuAction): void;
  paneActivity: TerminalPaneChromeSnapshot;
  paneId: string;
  search: XtermPaneSearchController;
  shellAssistEnabled: boolean;
  suggestionOverlay: ReactNode;
  terminalAppearance: TerminalAppearance;
  terminalNotice: string | null;
  terminalRef: RefObject<XtermTerminal | null>;
  title: string;
  canSplit: boolean;
}

/**
 * 组合稳定的 xterm host 与可选叠层；反馈只改变 chrome，不替换 terminal DOM，
 * 避免链接、选择区和 PTY 会话在提示出现时被重建。
 */
export function XtermPaneView({
  activityRuntimeRef,
  agentSendActionsEnabled,
  backgroundImageVisible,
  canSplit,
  commandBlockNotice,
  commandBlockViews,
  connectionState,
  containerRef,
  contextMenu,
  ghostSuggestion,
  logActive,
  logNotice,
  logPath,
  onCloseContextMenu,
  onCommandBlockAction,
  onContextMenu,
  onContextMenuAction,
  paneActivity,
  paneId,
  search,
  shellAssistEnabled,
  suggestionOverlay,
  terminalAppearance,
  terminalNotice,
  terminalRef,
  title,
}: XtermPaneViewProps) {
  const showCommandBlockRail =
    shellAssistEnabled && terminalAppearance.showCommandBlockRail;

  return (
    <div
      className={
        backgroundImageVisible
          ? "kerminal-xterm-wallpaper relative min-h-0 flex-1 overflow-hidden bg-transparent"
          : "relative min-h-0 flex-1 bg-[#f7f7fa] dark:bg-[#1f1f21]"
      }
      data-background-image-visible={backgroundImageVisible || undefined}
      onContextMenu={onContextMenu}
    >
      {showCommandBlockRail ? (
        <TerminalCommandBlockRail
          blocks={commandBlockViews}
          canSendToAgent={agentSendActionsEnabled}
          onAction={onCommandBlockAction}
        />
      ) : null}
      <div
        className={`h-full min-h-0 w-full overflow-hidden py-2 pr-3 ${showCommandBlockRail ? "pl-6" : "pl-3"}`}
        onPointerDown={() => terminalRef.current?.focus()}
      >
        <div aria-label={`${title} xterm 终端`} className="h-full min-h-0 w-full overflow-hidden" ref={containerRef} />
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
      {shellAssistEnabled ? suggestionOverlay : null}
      {paneActivity.paneId === paneId &&
      paneActivity.bufferType === "normal" &&
      paneActivity.visible &&
      paneActivity.applicationActive &&
      paneActivity.followPaused ? (
        <TerminalNewOutputButton onClick={() => activityRuntimeRef.current?.jumpToBottom()} />
      ) : null}
      <XtermPaneChrome
        commandBlockNotice={commandBlockNotice}
        connectionState={connectionState}
        logActive={logActive}
        logNotice={logNotice}
        logPath={logPath}
        shellAssistEnabled={shellAssistEnabled}
        terminalNotice={terminalNotice}
      />
      {search.open ? (
        <TerminalSearchPanel
          caseSensitive={search.caseSensitive}
          hasSearched={search.hasSearched}
          inputId={search.inputId}
          onClose={search.close}
          onQueryChange={search.updateQuery}
          onSearchNext={() => search.run("next")}
          onSearchPrevious={() => search.run("previous")}
          onToggleCaseSensitive={search.toggleCaseSensitive}
          query={search.query}
          resultCount={search.resultCount}
          resultIndex={search.resultIndex}
        />
      ) : null}
      {contextMenu ? (
        <TerminalContextMenu
          canDisconnect={connectionState === "connected"}
          canCopy={contextMenu.canCopy}
          canCopySessionId={contextMenu.canCopySessionId}
          canSendSelectionToAgent={contextMenu.canSendSelectionToAgent}
          canSendToAgent={contextMenu.canSendToAgent}
          canReconnect={connectionState !== "connecting" && connectionState !== "reconnecting"}
          canSplit={canSplit}
          onAction={onContextMenuAction}
          onClose={onCloseContextMenu}
          position={contextMenu.position}
        />
      ) : null}
    </div>
  );
}
