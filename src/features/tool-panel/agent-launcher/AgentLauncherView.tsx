// @author kongweiguang
import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { Info, Loader2, Send, Terminal } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { IconAction } from "../../../components/ui/icon-action";
import { UserFacingNotice } from "../../../components/ui/user-facing-notice";
import {
  type AgentWorkflowSnapshot,
} from "../../agent-workflow";
import { cn } from "../../../lib/cn";
import type {
  AgentSessionTargetRequest,
  ExternalAgentId,
} from "../../../lib/agentLauncherApi";
import type { UserFacingMessage } from "../../../lib/userFacingMessage";
import type { AgentSendRequest } from "../../agent-workflow/state/index";
import type {
  AgentActionViewModel,
  AgentLaunchPermissionMode,
} from "./agentLauncherModel";
import type { AgentSessionSelection } from "./agentSessionRestoreModel";
import { formatTargetChipLabel } from "./agentSessionTargetModel";
import {
  AgentIconButton,
  AgentLaunchContextMenu,
  type AgentLaunchTargetMode,
} from "./AgentLaunchControls";
import { AgentConversationList } from "./AgentConversationList";

export type AgentLauncherLoadState =
  "idle" | "loading" | "refreshing" | "error";
export type AgentLauncherActionState = ExternalAgentId | null;

export interface AgentRestoreChoice {
  agentId: ExternalAgentId;
  permissionMode: AgentLaunchPermissionMode;
  session: AgentSessionSelection;
}

interface AgentLauncherViewProps {
  actionError: UserFacingMessage | null;
  actionState: AgentLauncherActionState;
  agentActions: AgentActionViewModel[];
  agentTechnicalDetail: string;
  currentAgentTarget?: AgentSessionTargetRequest;
  currentAgentTargetLabel: string;
  customCommand: string;
  customCommandOpen: boolean;
  deletingSessionId: string | null;
  loadError: UserFacingMessage | null;
  loadState: AgentLauncherLoadState;
  pendingSendRequest: AgentSendRequest | null;
  restoreChoice: AgentRestoreChoice | null;
  statusAvailable: boolean;
  visible: boolean;
  onCancelRestore: () => void;
  onContinueRestore: (choice: AgentRestoreChoice) => void;
  onCustomCommandChange: (command: string) => void;
  onCustomCommandSubmit: () => void;
  onLaunch: (
    agentId: ExternalAgentId,
    permissionMode?: AgentLaunchPermissionMode,
    targetMode?: AgentLaunchTargetMode,
  ) => void;
  onNewSession: (choice: AgentRestoreChoice) => void;
  onRetry: () => void;
  onWorkflowContinue: (sessionId: string) => void;
  onWorkflowDelete: (sessionId: string) => Promise<boolean>;
  onWorkflowNewSession: (sessionId: string) => void;
  onWorkflowRename: (sessionId: string, title: string) => Promise<boolean>;
  renamingSessionId: string | null;
  workflowSnapshot: AgentWorkflowSnapshot;
}

interface AgentLauncherContextMenuState {
  agent: AgentActionViewModel;
  position: {
    x: number;
    y: number;
  };
}

const AGENT_LAUNCH_CONTEXT_MENU_WIDTH = 164;
const AGENT_LAUNCH_CONTEXT_MENU_HEIGHT = 72;
const AGENT_LAUNCH_CONTEXT_MENU_INSET = 8;

/**
 * Agent Launcher 的纯 UI 组合层。
 *
 * 会话创建、恢复、归档和终端信号仍由上层编排；这里仅持有技术详情与
 * 右键菜单等短生命周期界面状态，避免 UI 状态污染会话状态机。
 */
export function AgentLauncherView({
  actionError,
  actionState,
  agentActions,
  agentTechnicalDetail,
  currentAgentTarget,
  currentAgentTargetLabel,
  customCommand,
  customCommandOpen,
  deletingSessionId,
  loadError,
  loadState,
  pendingSendRequest,
  restoreChoice,
  statusAvailable,
  visible,
  onCancelRestore,
  onContinueRestore,
  onCustomCommandChange,
  onCustomCommandSubmit,
  onLaunch,
  onNewSession,
  onRetry,
  onWorkflowContinue,
  onWorkflowDelete,
  onWorkflowNewSession,
  onWorkflowRename,
  renamingSessionId,
  workflowSnapshot,
}: AgentLauncherViewProps) {
  const [technicalDetailsOpen, setTechnicalDetailsOpen] = useState(false);
  const [agentContextMenu, setAgentContextMenu] =
    useState<AgentLauncherContextMenuState | null>(null);
  const launcherMenuRootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!agentContextMenu) {
      return undefined;
    }

    const closeMenu = () => setAgentContextMenu(null);
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
  }, [agentContextMenu]);

  const openAgentContextMenu = (
    agent: AgentActionViewModel,
    event: ReactMouseEvent,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const bounds = launcherMenuRootRef.current?.getBoundingClientRect();
    setAgentContextMenu({
      agent,
      position: clampAgentLaunchContextMenuPosition(
        bounds ? event.clientX - bounds.left : event.clientX,
        bounds ? event.clientY - bounds.top : event.clientY,
        bounds,
      ),
    });
  };

  return (
    <div
      aria-hidden={!visible}
      inert={!visible}
      className={cn(
        "absolute inset-0 flex min-h-0 flex-col px-3 py-3 transition-opacity duration-150",
        visible ? "opacity-100" : "pointer-events-none select-none opacity-0",
      )}
    >
      <div className="scrollbar-none flex min-h-0 flex-1 overflow-y-auto">
        <div
          className="relative mx-auto my-auto w-full max-w-[280px] py-2"
          data-testid="agent-launcher-content"
          ref={launcherMenuRootRef}
        >
          <div className="mb-2 flex min-w-0 items-start gap-2 px-1">
            <div
              className="min-w-0 flex-1"
              data-testid="agent-current-target"
              title={
                pendingSendRequest
                  ? `${agentSendRequestLabel(pendingSendRequest)}；当前目标：${currentAgentTargetLabel}`
                  : currentAgentTargetLabel
              }
            >
              <h1 className="text-sm font-semibold text-zinc-950 dark:text-zinc-100">
                {pendingSendRequest ? "发送到 Agent" : "新建对话"}
              </h1>
              {pendingSendRequest ? (
                <span
                  className="mt-0.5 flex h-4 min-w-0 items-center gap-1 text-[11px] text-sky-700 dark:text-sky-300"
                  data-testid="agent-launcher-pending-send"
                  role="status"
                >
                  <Send className="h-3 w-3 shrink-0" />
                  <span className="truncate">
                    {agentSendRequestLabel(pendingSendRequest)} · 选择 Agent
                    后预览
                  </span>
                </span>
              ) : (
                <span className="mt-0.5 block h-4 truncate text-[11px] text-zinc-500 dark:text-zinc-400">
                  当前目标 ·{" "}
                  <span className="font-medium text-zinc-700 dark:text-zinc-300">
                    {currentAgentTargetLabel}
                  </span>
                </span>
              )}
            </div>
            <IconAction
              aria-controls="agent-launcher-technical-details"
              aria-expanded={technicalDetailsOpen}
              className="h-7 w-7 rounded-lg"
              icon={Info}
              label="查看 Agent 技术详情"
              onClick={() => setTechnicalDetailsOpen((current) => !current)}
              tooltip="技术详情"
              variant="ghost"
            />
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {agentActions.map((agent) => (
              <AgentIconButton
                actionState={actionState}
                agent={agent}
                key={agent.agentId}
                onLaunch={onLaunch}
                onOpenMenu={openAgentContextMenu}
              />
            ))}
          </div>
          {technicalDetailsOpen ? (
            <div
              aria-label="Agent 技术详情"
              className="kerminal-muted-surface mt-2 rounded-lg border p-2.5"
              id="agent-launcher-technical-details"
              role="region"
            >
              <pre className="scrollbar-none max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-[10px] leading-4 text-zinc-600 dark:text-zinc-300">
                {agentTechnicalDetail}
              </pre>
            </div>
          ) : null}

          {agentContextMenu ? (
            <AgentLaunchContextMenu
              agent={agentContextMenu.agent}
              onLaunch={(permissionMode, targetMode = "current") => {
                setAgentContextMenu(null);
                onLaunch(
                  agentContextMenu.agent.agentId,
                  permissionMode,
                  targetMode,
                );
              }}
              position={agentContextMenu.position}
            />
          ) : null}

          {customCommandOpen ? (
            <form
              className="mt-3 flex items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-field)] p-1.5 shadow-sm shadow-black/5 dark:shadow-black/20"
              onSubmit={(event) => {
                event.preventDefault();
                onCustomCommandSubmit();
              }}
            >
              <label className="sr-only">Custom CLI command</label>
              <input
                aria-label="Custom agent command"
                autoFocus
                className="h-8 min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 font-mono text-xs text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-sky-400/50 focus:bg-white/70 focus:ring-4 focus:ring-sky-400/15 dark:text-zinc-50 dark:placeholder:text-zinc-500 dark:focus:bg-white/10"
                onChange={(event) => onCustomCommandChange(event.target.value)}
                placeholder="kimi or qwen --model ..."
                value={customCommand}
              />
              <Button
                aria-label="Open custom agent command"
                disabled={actionState !== null || !customCommand.trim()}
                size="icon"
                type="submit"
                variant="primary"
              >
                {actionState === "custom" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Terminal className="h-4 w-4" />
                )}
              </Button>
            </form>
          ) : null}

          {restoreChoice ? (
            <AgentRestoreChoicePanel
              actionState={actionState}
              choice={restoreChoice}
              onCancel={onCancelRestore}
              onContinue={onContinueRestore}
              onNewSession={onNewSession}
            />
          ) : null}

          <AgentConversationList
            actionDisabled={actionState !== null}
            currentTarget={currentAgentTarget}
            deletingSessionId={deletingSessionId}
            historyMetadata={workflowSnapshot.historyMetadata}
            onContinue={onWorkflowContinue}
            onDelete={onWorkflowDelete}
            onNewSession={onWorkflowNewSession}
            onRename={onWorkflowRename}
            renamingSessionId={renamingSessionId}
            sessions={workflowSnapshot.sessions}
          />
        </div>
      </div>

      {loadState === "error" && !statusAvailable ? (
        <UserFacingNotice
          className="mt-3"
          compact
          message={
            loadError ?? {
              recoveryAction: "请稍后重试。",
              severity: "error",
              title: "无法读取 Agent 状态",
            }
          }
        >
          <Button onClick={onRetry} size="sm">
            重试
          </Button>
        </UserFacingNotice>
      ) : null}
      {actionError ? (
        <UserFacingNotice className="mt-3" compact message={actionError} />
      ) : null}
    </div>
  );
}

function agentSendRequestLabel(request: AgentSendRequest): string {
  if (request.source === "selection") {
    return "选中内容待发送";
  }
  if (request.source === "commandBlock") {
    return "命令块待发送";
  }
  return "终端上下文待发送";
}

function AgentRestoreChoicePanel({
  actionState,
  choice,
  onCancel,
  onContinue,
  onNewSession,
}: {
  actionState: AgentLauncherActionState;
  choice: AgentRestoreChoice;
  onCancel: () => void;
  onContinue: (choice: AgentRestoreChoice) => void;
  onNewSession: (choice: AgentRestoreChoice) => void;
}) {
  const busy = actionState === choice.agentId;
  const disabled = actionState !== null;
  return (
    <div className="mt-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-solid)] p-2 shadow-lg shadow-black/10 dark:shadow-black/35">
      <div className="flex min-w-0 items-center gap-2 px-1">
        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-zinc-900 dark:text-zinc-100">
          {agentTitle(choice.agentId)}
        </span>
        <span
          className={cn(
            "max-w-[116px] truncate rounded-full border px-2 py-0.5 text-[10px] font-medium",
            choice.session.target?.liveStatus === "stale" ||
              choice.session.target?.liveStatus === "closed"
              ? "border-amber-400/40 bg-amber-500/10 text-amber-700 dark:text-amber-200"
              : "border-[var(--border-subtle)] bg-[var(--surface-hover)] text-zinc-600 dark:text-zinc-300",
          )}
          data-testid="agent-restore-target-chip"
          title={formatTargetChipLabel(choice.session.target)}
        >
          {formatTargetChipLabel(choice.session.target)}
        </span>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-1">
        <button
          className="kerminal-pressable kerminal-focus-ring h-8 rounded-md bg-zinc-900 px-2 text-[11px] font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-45 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-white"
          disabled={disabled}
          onClick={() => onContinue(choice)}
          type="button"
        >
          {busy ? (
            <Loader2 className="mx-auto h-3.5 w-3.5 animate-spin" />
          ) : (
            "继续上次"
          )}
        </button>
        <button
          className="kerminal-pressable kerminal-focus-ring h-8 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-hover)] px-2 text-[11px] font-semibold text-zinc-700 transition hover:bg-[var(--surface-field)] disabled:cursor-not-allowed disabled:opacity-45 dark:text-zinc-200"
          disabled={disabled}
          onClick={() => onNewSession(choice)}
          type="button"
        >
          新会话
        </button>
        <button
          className="kerminal-pressable kerminal-focus-ring h-8 rounded-md px-2 text-[11px] font-medium text-zinc-500 transition hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-45 dark:text-zinc-400"
          disabled={disabled}
          onClick={onCancel}
          type="button"
        >
          取消
        </button>
      </div>
    </div>
  );
}

function agentTitle(agentId: ExternalAgentId): string {
  if (agentId === "claude") {
    return "Claude";
  }
  if (agentId === "custom") {
    return "Custom";
  }
  return "Codex";
}

function clampAgentLaunchContextMenuPosition(
  x: number,
  y: number,
  bounds?: DOMRect,
) {
  const width = bounds?.width ?? window.innerWidth;
  const height = bounds?.height ?? window.innerHeight;
  const maxX = Math.max(
    AGENT_LAUNCH_CONTEXT_MENU_INSET,
    width - AGENT_LAUNCH_CONTEXT_MENU_WIDTH - AGENT_LAUNCH_CONTEXT_MENU_INSET,
  );
  const maxY = Math.max(
    AGENT_LAUNCH_CONTEXT_MENU_INSET,
    height - AGENT_LAUNCH_CONTEXT_MENU_HEIGHT - AGENT_LAUNCH_CONTEXT_MENU_INSET,
  );

  return {
    x: Math.max(AGENT_LAUNCH_CONTEXT_MENU_INSET, Math.min(x, maxX)),
    y: Math.max(AGENT_LAUNCH_CONTEXT_MENU_INSET, Math.min(y, maxY)),
  };
}
