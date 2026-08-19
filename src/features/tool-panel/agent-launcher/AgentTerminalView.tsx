// @author kongweiguang

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  Sparkles,
  Terminal,
  Wrench,
} from "lucide-react";
import { Button } from "../../../components/ui/button";
import {
  currentDesktopNotificationVisibility,
  sendDesktopNotification,
} from "../../../lib/desktopNotificationApi";
import type { DesktopNotificationSettings } from "../../../lib/desktopNotificationPolicy";
import type {
  AgentSessionScope,
  AgentSessionTargetRequest,
  ExternalAgentId,
  ExternalAgentSessionStatus,
} from "../../../lib/agentLauncherApi";
import type { TerminalAgentSignal } from "../../../lib/terminalApi";
import { cn } from "../../../lib/cn";
import type {
  ResolvedTheme,
  TerminalAppearance,
} from "../../settings/contracts/index";
import { XtermPane } from "../../terminal/xterm/index";
import type { XtermPaneInputRequest } from "../../terminal/xterm/index";
import type {
  AgentWorkflowSendPreview,
  AgentWorkflowPreviewResolution,
} from "../../agent-workflow";
import { AgentWorkflowSendPreviewPanel } from "../../agent-workflow";
import type { AgentLaunchPermissionMode } from "./agentLauncherModel";
import {
  agentTerminalPaneId,
  registerAgentPromptTerminal,
} from "./agentPromptTransport";

export interface AgentTerminalSession {
  agentSessionId: string;
  agentId: ExternalAgentId;
  title: string;
  commandLabel: string;
  shell: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
  agentSignal?: TerminalAgentSignal;
  status: ExternalAgentSessionStatus;
  customCommand?: string;
  permissionMode: AgentLaunchPermissionMode;
  scope?: AgentSessionScope;
  tabId: string;
  target?: AgentSessionTargetRequest;
}

const agentTerminalIcons = {
  claude: Sparkles,
  codex: Terminal,
  custom: Wrench,
};

export function AgentTerminalView({
  desktopNotifications,
  focused,
  onAgentSignal,
  onBack,
  onCancelPreview,
  onConfirmPreview,
  preview,
  previewBusy,
  resolvedTheme,
  session,
  terminalAppearance,
}: {
  desktopNotifications?: DesktopNotificationSettings;
  focused: boolean;
  onAgentSignal: (signal: TerminalAgentSignal) => void;
  onBack: () => void;
  onCancelPreview: (previewId: string) => AgentWorkflowPreviewResolution;
  onConfirmPreview: (
    previewId: string,
    submit: boolean,
  ) => Promise<AgentWorkflowPreviewResolution>;
  preview: AgentWorkflowSendPreview | null;
  previewBusy: boolean;
  resolvedTheme: ResolvedTheme;
  session: AgentTerminalSession;
  terminalAppearance: TerminalAppearance;
}) {
  const paneId = agentTerminalPaneId(session.agentSessionId);
  const [inputRequest, setInputRequest] =
    useState<XtermPaneInputRequest | null>(null);
  const Icon = agentTerminalIcons[session.agentId];
  const workspacePath = compactWorkspacePath(session.cwd);
  const title = session.title === "Custom" ? "自定义" : session.title;
  const agentSignalView = session.agentSignal
    ? agentSignalStatusView(session.agentSignal)
    : null;
  const notificationLastSentAtRef = useRef<Record<string, number | undefined>>(
    {},
  );
  const notifiedSessionIdsRef = useRef<Set<string>>(new Set());
  useEffect(
    () =>
      registerAgentPromptTerminal(session.agentSessionId, {
        paneId,
        send: setInputRequest,
      }),
    [paneId, session.agentSessionId],
  );
  const notifyAgentSessionFinished = useCallback(
    (event: { durationMs: number; sessionId: string }) => {
      if (!desktopNotifications?.enabled) {
        return;
      }
      if (notifiedSessionIdsRef.current.has(event.sessionId)) {
        return;
      }
      notifiedSessionIdsRef.current.add(event.sessionId);
      void sendDesktopNotification({
        event: {
          agentName: title,
          durationMs: event.durationMs,
          exitCode: null,
          kind: "agent.process.finished",
          notificationKey: `agent.process.finished:${session.agentSessionId}`,
        },
        lastSentAtByKey: notificationLastSentAtRef.current,
        permissionPrompt: "important-event",
        settings: desktopNotifications,
        visibility: currentDesktopNotificationVisibility(),
      });
    },
    [desktopNotifications, session.agentSessionId, title],
  );
  return (
    <section className="relative isolate flex h-full min-h-0 flex-col overflow-hidden bg-[var(--surface-terminal)]">
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] bg-[var(--surface-solid)] px-2.5">
        <Button
          aria-label="Back to agent launcher"
          className="h-8 w-8 rounded-xl"
          onClick={onBack}
          size="icon"
          variant="ghost"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="grid h-7 w-7 shrink-0 place-items-center rounded-xl bg-[var(--surface-hover)] text-zinc-700 ring-1 ring-inset ring-[var(--border-subtle)] dark:text-zinc-200">
          <Icon className="h-4 w-4" strokeWidth={1.75} />
        </div>
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate text-[13px] font-semibold text-zinc-900 dark:text-zinc-100">
            {title}
          </div>
          <div
            className="truncate font-mono text-[11px] text-zinc-500 dark:text-zinc-400"
            data-testid="agent-terminal-command"
            title={`${session.commandLabel} · ${session.cwd}`}
          >
            {session.commandLabel} · {workspacePath}
          </div>
        </div>
        {agentSignalView ? (
          <span
            className={cn(
              "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold leading-4",
              agentSignalView.className,
            )}
            data-testid="agent-terminal-signal"
            title={agentSignalView.title}
          >
            {agentSignalView.label}
          </span>
        ) : null}
      </header>
      <div
        aria-hidden={Boolean(preview)}
        className={cn(
          "min-h-0 flex-1 p-2",
          preview && "pointer-events-none select-none",
        )}
        data-testid="agent-terminal-content"
      >
        <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[18px] border border-[var(--border-subtle)] bg-[var(--surface-terminal)] shadow-sm shadow-black/5 dark:shadow-black/25">
          <XtermPane
            args={session.args}
            cwd={session.cwd}
            env={session.env}
            enableAgentSendActions={false}
            focused={focused && !preview}
            inputCompatibilityMode="agentTui"
            inputRequest={inputRequest}
            key={session.agentSessionId}
            onAgentSignal={onAgentSignal}
            paneId={paneId}
            resolvedTheme={resolvedTheme}
            shell={session.shell}
            shellAssistEnabled={false}
            startupMessage={`加载 ${title}...\r\n`}
            terminalAppearance={terminalAppearance}
            title={session.title}
            transientStartupMessage
            onSessionFinished={notifyAgentSessionFinished}
          />
        </div>
      </div>
      {preview ? (
        <div
          className="absolute inset-x-0 bottom-0 top-10 z-10 min-h-0"
          data-testid="agent-send-preview-mode"
        >
          <AgentWorkflowSendPreviewPanel
            busy={previewBusy}
            onCancel={onCancelPreview}
            onConfirm={(previewId) => void onConfirmPreview(previewId, true)}
            preview={preview}
          />
        </div>
      ) : null}
    </section>
  );
}

function agentSignalStatusView(signal: TerminalAgentSignal): {
  className: string;
  label: string;
  title: string;
} {
  switch (signal.status) {
    case "working":
      return {
        className:
          "border-sky-400/40 bg-sky-500/10 text-sky-700 dark:text-sky-200",
        label: "工作中",
        title: `${signal.agent} is working`,
      };
    case "attention":
      return {
        className:
          "border-amber-400/45 bg-amber-500/10 text-amber-700 dark:text-amber-200",
        label: "需处理",
        title: `${signal.agent} needs attention`,
      };
    case "finished":
      return {
        className:
          "border-emerald-400/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200",
        label: "已完成",
        title: `${signal.agent} finished`,
      };
    case "exited":
      return {
        className:
          "border-[var(--border-subtle)] bg-[var(--surface-hover)] text-zinc-600 dark:text-zinc-300",
        label: "已退出",
        title: `${signal.agent} exited`,
      };
  }
}

function compactWorkspacePath(path: string): string {
  return path.replace(/\\/g, "/").endsWith("/.kerminal") ? "~/.kerminal" : path;
}
