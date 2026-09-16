// @author kongweiguang
import type {
  AgentSessionScope,
  AgentSessionTargetRequest,
} from "../../../lib/agentLauncherApi";
import type { TerminalPane, TerminalTab } from "../../workspace/contracts/index";

const AGENT_TERMINAL_CONTEXT_OUTPUT_MAX_CHARS = 6_000;
const AGENT_TERMINAL_SELECTION_MAX_CHARS = 8_000;
const AGENT_TERMINAL_COMMAND_BLOCK_MAX_CHARS = 10_000;
const AGENT_TERMINAL_BRANCH_NAME_MAX_CHARS = 80;

export interface AgentTerminalContextSession {
  agentSessionId?: string;
  commandLabel: string;
  cwd: string;
  scope?: AgentSessionScope;
  target?: AgentSessionTargetRequest;
  title: string;
}

export interface BuildAgentTerminalContextPromptInput {
  activeTab?: Pick<TerminalTab, "id" | "title">;
  focusedPane?: Pick<
    TerminalPane,
    | "currentCwd"
    | "cwd"
    | "id"
    | "machineId"
    | "mode"
    | "outputHistory"
    | "prompt"
    | "remoteHostId"
    | "shell"
    | "status"
    | "title"
  >;
  maxOutputChars?: number;
  session: AgentTerminalContextSession;
}

interface AgentTerminalRuntimeContext {
  commandBlockText?: string;
  paneId: string;
  selectedText?: string;
}

export interface BuildAgentTerminalRuntimePromptInput
  extends BuildAgentTerminalContextPromptInput {
  maxContentChars?: number;
  runtimeContext?: AgentTerminalRuntimeContext;
}

export interface AgentTerminalOutputTail {
  text: string;
  truncated: boolean;
}

export function buildAgentTerminalContextPrompt({
  activeTab,
  focusedPane,
  maxOutputChars = AGENT_TERMINAL_CONTEXT_OUTPUT_MAX_CHARS,
  session,
}: BuildAgentTerminalContextPromptInput): string | null {
  const { pane, target } = resolveBoundTarget({
    activeTab,
    focusedPane,
    session,
  });
  if (!target && !pane) {
    return null;
  }

  const outputTail = tailAgentTerminalOutput(
    pane?.outputHistory ?? "",
    maxOutputChars,
  );
  const lines = buildAgentTerminalContextHeaderLines({
    activeTab,
    pane,
    session,
    target,
  });

  lines.push("");
  if (outputTail.text) {
    lines.push(
      outputTail.truncated
        ? `Recent terminal output tail (last ${maxOutputChars} chars):`
        : "Recent terminal output:",
      "```text",
      outputTail.text,
      "```",
    );
  } else {
    lines.push("Recent terminal output: <not captured>");
  }

  return lines.join("\n");
}

export function buildAgentTerminalSelectionPrompt({
  activeTab,
  focusedPane,
  maxContentChars = AGENT_TERMINAL_SELECTION_MAX_CHARS,
  runtimeContext,
  session,
}: BuildAgentTerminalRuntimePromptInput): string | null {
  return buildAgentTerminalRuntimePrompt({
    activeTab,
    contentLabel: "Selected terminal text",
    focusedPane,
    maxContentChars,
    runtimeContext,
    session,
    sourceText: runtimeContext?.selectedText,
    title: "Kerminal target selection",
  });
}

export function buildAgentTerminalCommandBlockPrompt({
  activeTab,
  focusedPane,
  maxContentChars = AGENT_TERMINAL_COMMAND_BLOCK_MAX_CHARS,
  runtimeContext,
  session,
}: BuildAgentTerminalRuntimePromptInput): string | null {
  return buildAgentTerminalRuntimePrompt({
    activeTab,
    contentLabel: "Latest terminal command block",
    focusedPane,
    maxContentChars,
    runtimeContext,
    session,
    sourceText: runtimeContext?.commandBlockText,
    title: "Kerminal target command block",
  });
}

export function buildAgentTerminalBranchPrompt({
  activeTab,
  focusedPane,
  session,
}: BuildAgentTerminalContextPromptInput): string {
  const { pane, target } = resolveBoundTarget({
    activeTab,
    focusedPane,
    session,
  });
  const targetCwd = target?.cwd ?? pane?.currentCwd ?? pane?.cwd;
  const suggestedBranch = suggestAgentTerminalBranchName({
    pane,
    session,
    target,
  });
  const lines = buildAgentTerminalContextHeaderLines({
    activeTab,
    pane,
    session,
    target,
    title: "Kerminal branch/fork request",
  });

  lines.push(
    "",
    "Branch/fork request:",
    `- Suggested branch: ${suggestedBranch}`,
    `- Agent workspace: ${session.cwd}`,
    targetCwd ? `- Target cwd: ${targetCwd}` : "- Target cwd: <unknown>",
    "",
    "Please inspect git status first. If a branch or worktree is needed, create a safe feature branch/worktree for this agent session and report the exact branch/worktree.",
    "Do not run destructive git operations without explicit user approval.",
  );

  return lines.join("\n");
}

function buildAgentTerminalRuntimePrompt({
  activeTab,
  contentLabel,
  focusedPane,
  maxContentChars,
  runtimeContext,
  session,
  sourceText,
  title,
}: BuildAgentTerminalRuntimePromptInput & {
  contentLabel: string;
  sourceText?: string;
  title: string;
}): string | null {
  const { pane, target } = resolveBoundTarget({
    activeTab,
    focusedPane,
    session,
  });
  const targetPaneId = target?.paneId ?? pane?.id;
  if (target?.tabId && activeTab?.id !== target.tabId) {
    return null;
  }
  if (!targetPaneId || runtimeContext?.paneId !== targetPaneId) {
    return null;
  }

  const contentTail = tailAgentTerminalOutput(sourceText ?? "", maxContentChars);
  if (!contentTail.text) {
    return null;
  }

  const lines = buildAgentTerminalContextHeaderLines({
    activeTab,
    pane,
    session,
    target,
    title,
  });

  lines.push(
    "",
    contentTail.truncated
      ? `${contentLabel} tail (last ${maxContentChars} chars):`
      : `${contentLabel}:`,
    "```text",
    contentTail.text,
    "```",
  );

  return lines.join("\n");
}

/** 全局 Agent 忽略旧 target 的 Tab/pane 限制，但仍以当前 focused pane 生成上下文。 */
function resolveBoundTarget({
  activeTab,
  focusedPane,
  session,
}: Pick<
  BuildAgentTerminalContextPromptInput,
  "activeTab" | "focusedPane" | "session"
>) {
  const target = session.target;
  const globalScope =
    session.scope?.kind === "global" || target?.liveStatus === "unbound";
  const tabMatches =
    globalScope || !target?.tabId || activeTab?.id === target.tabId;
  const pane =
    tabMatches &&
    focusedPane &&
    (globalScope || !target?.paneId || focusedPane.id === target.paneId)
      ? focusedPane
      : undefined;

  return { pane, target: globalScope && pane ? undefined : target };
}

function buildAgentTerminalContextHeaderLines({
  activeTab,
  pane,
  session,
  target,
  title = "Kerminal target context",
}: {
  activeTab?: Pick<TerminalTab, "id" | "title">;
  pane?: BuildAgentTerminalContextPromptInput["focusedPane"];
  session: AgentTerminalContextSession;
  target?: AgentSessionTargetRequest;
  title?: string;
}) {
  const cwd = target?.cwd ?? pane?.currentCwd ?? pane?.cwd ?? session.cwd;
  const lines = [
    title,
    "",
    `Agent: ${session.title}`,
    `Agent command: ${session.commandLabel}`,
    `Agent cwd: ${session.cwd}`,
  ];

  if (target?.targetRef) {
    lines.push(`Bound target: ${target.targetRef}`);
  }
  if (target?.targetKind) {
    lines.push(`Target kind: ${target.targetKind}`);
  }
  if (target?.paneId ?? pane?.id) {
    lines.push(`Pane: ${target?.paneId ?? pane?.id}`);
  }
  const targetTabId = target?.tabId;
  const activeTabId = activeTab?.id;
  if (targetTabId ?? activeTabId) {
    const tabLabel =
      targetTabId && activeTabId === targetTabId && activeTab?.title
        ? `${activeTab.title} (${targetTabId})`
        : targetTabId ||
          (activeTab?.title ? `${activeTab.title} (${activeTabId})` : activeTabId);
    lines.push(`Tab: ${tabLabel}`);
  }
  if (cwd) {
    lines.push(`Target cwd: ${cwd}`);
  }
  if (target?.shell ?? pane?.shell) {
    lines.push(`Target shell: ${target?.shell ?? pane?.shell}`);
  }
  if (pane?.status) {
    lines.push(`Pane status: ${pane.status}`);
  }

  return lines;
}

function suggestAgentTerminalBranchName({
  pane,
  session,
  target,
}: {
  pane?: BuildAgentTerminalContextPromptInput["focusedPane"];
  session: AgentTerminalContextSession;
  target?: AgentSessionTargetRequest;
}) {
  const parts = [
    slugBranchPart(session.title) || "agent",
    slugBranchPart(target?.targetRef ?? pane?.title ?? pane?.id ?? target?.paneId),
    slugBranchPart(session.agentSessionId),
  ].filter(Boolean);
  const suffix = parts.join("-") || "session";
  return `agent/${suffix}`.slice(0, AGENT_TERMINAL_BRANCH_NAME_MAX_CHARS);
}

function slugBranchPart(value?: string) {
  return (
    value
      ?.toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32) ?? ""
  );
}

export function tailAgentTerminalOutput(
  output: string,
  maxChars = AGENT_TERMINAL_CONTEXT_OUTPUT_MAX_CHARS,
): AgentTerminalOutputTail {
  const normalized = output.replace(/\r\n?/g, "\n").trimEnd();
  if (!normalized) {
    return { text: "", truncated: false };
  }
  if (maxChars <= 0 || normalized.length <= maxChars) {
    return { text: normalized, truncated: false };
  }
  return {
    text: normalized.slice(-maxChars),
    truncated: true,
  };
}
