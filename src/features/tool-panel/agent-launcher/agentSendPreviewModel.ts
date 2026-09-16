// @author kongweiguang
import type {
  AgentWorkflowPreviewKind,
  AgentWorkflowSendPreview,
} from "../../agent-workflow";
import type { TerminalPane, TerminalTab } from "../../workspace/contracts/index";
import {
  readXtermPanePromptSource,
  type XtermPanePromptSourceSnapshot,
} from "../../terminal/xterm/prompt/index";
import {
  buildAgentTerminalCommandBlockPrompt,
  buildAgentTerminalContextPrompt,
  buildAgentTerminalSelectionPrompt,
  type AgentTerminalContextSession,
} from "./agentTerminalContextModel";

export type AgentSendPreviewSource = "commandBlock" | "context" | "selection";

export interface AgentSendPreviewBuildInput {
  activeTab?: TerminalTab;
  focusedPane?: TerminalPane;
  session: AgentTerminalContextSession;
  source: AgentSendPreviewSource;
}

export interface AgentSendPreviewBuildResult {
  kind: AgentWorkflowPreviewKind;
  text: string;
}

/** 按用户点击时刻读取目标 pane 正文，并复用既有 prompt builder 进行绑定校验。 */
export function buildAgentSendPreviewInput({
  activeTab,
  focusedPane,
  session,
  source,
}: AgentSendPreviewBuildInput): AgentSendPreviewBuildResult | null {
  const globalScope =
    session.scope?.kind === "global" || session.target?.liveStatus === "unbound";
  const paneId = globalScope
    ? focusedPane?.id
    : session.target?.paneId ?? focusedPane?.id;
  if (
    !paneId ||
    (!globalScope &&
      session.target?.tabId &&
      session.target.tabId !== activeTab?.id)
  ) {
    return null;
  }
  if (!focusedPane || focusedPane.id !== paneId) {
    return null;
  }

  // Global scope keeps the persisted target as a preference, but a send action
  // always describes the pane the user selected at that moment.
  const previewSession = globalScope ? { ...session, target: undefined } : session;

  if (source === "context") {
    const text = buildAgentTerminalContextPrompt({
      activeTab,
      focusedPane,
      session: previewSession,
    });
    return text ? { kind: "diagnostic", text } : null;
  }

  const runtimeContext = readRuntimeContext(paneId);
  if (!runtimeContext) {
    return null;
  }
  const text =
    source === "selection"
      ? buildAgentTerminalSelectionPrompt({
          activeTab,
          focusedPane,
          runtimeContext,
          session: previewSession,
        })
      : buildAgentTerminalCommandBlockPrompt({
          activeTab,
          focusedPane,
          runtimeContext,
          session: previewSession,
        });
  return text ? { kind: source, text } : null;
}

function readRuntimeContext(
  paneId: string,
): XtermPanePromptSourceSnapshot | null {
  return readXtermPanePromptSource(paneId);
}

/** 会话切换时只保留同一 session 的瞬时预览。 */
export function retainPreviewForSession(
  preview: AgentWorkflowSendPreview | null,
  sessionId?: string,
): AgentWorkflowSendPreview | null {
  return preview?.sessionId === sessionId ? preview : null;
}
