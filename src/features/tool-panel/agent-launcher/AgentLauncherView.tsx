// @author kongweiguang
import {
  useEffect,
  useRef,
  useState,
} from "react";
import { Info, Loader2, Send } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { IconAction } from "../../../components/ui/icon-action";
import { UserFacingNotice } from "../../../components/ui/user-facing-notice";
import {
  type AgentWorkflowSnapshot,
} from "../../agent-workflow";
import { cn } from "../../../lib/cn";
import type {
  AgentSessionScope,
  AgentSessionTargetRequest,
  ExternalAgentId,
} from "../../../lib/agentLauncherApi";
import type { UserFacingMessage } from "../../../lib/userFacingMessage";
import type { AgentSendRequest } from "../../agent-workflow/state/index";
import type { CustomAgentDefinition } from "../../settings/contracts/index";
import type { AgentLaunchPermissionMode } from "./agentLauncherModel";
import type { AgentSessionSelection } from "./agentSessionRestoreModel";
import { agentSessionScopeId } from "./agentTabSessionModel";
import { formatTargetChipLabel } from "./agentSessionTargetModel";
import {
  AgentLaunchSplitButton,
  type AgentLaunchTargetMode,
} from "./AgentLaunchControls";
import {
  AgentSelector,
  type AgentSelectorOption,
} from "./AgentSelector";
import {
  CustomAgentManagerDialog,
  type CustomAgentDraft,
} from "./CustomAgentManagerDialog";
import { AgentConversationList } from "./AgentConversationList";
import type { AgentLaunchSnapshot } from "./agentLauncherPresentationModel";

export type AgentLauncherLoadState =
  "idle" | "loading" | "refreshing" | "error";
export type AgentLauncherActionState = string | null;

export interface AgentRestoreChoice {
  agentId: ExternalAgentId;
  /** 下拉入口的新会话使用当前定义；继续上次仍只读取 session 历史快照。 */
  newSessionLauncher?: AgentLaunchSnapshot;
  permissionMode: AgentLaunchPermissionMode;
  session: AgentSessionSelection;
}

export interface AgentLauncherViewProps {
  actionError: UserFacingMessage | null;
  actionState: AgentLauncherActionState;
  agentOptions: AgentSelectorOption[];
  agentTechnicalDetail: string;
  currentAgentTarget?: AgentSessionTargetRequest;
  /** 缺省仅用于旧测试/嵌入调用方；主工具面板始终传入显式 scope。 */
  currentAgentScope?: AgentSessionScope;
  currentAgentTargetLabel: string;
  customAgentError: UserFacingMessage | null;
  customAgentMutationPending: boolean;
  customAgents: CustomAgentDefinition[];
  deletingSessionId: string | null;
  loadError: UserFacingMessage | null;
  loadState: AgentLauncherLoadState;
  pendingSendRequest: AgentSendRequest | null;
  restoreChoice: AgentRestoreChoice | null;
  statusAvailable: boolean;
  visible: boolean;
  selectedAgentKey: string;
  onAgentSelect: (key: string) => void;
  onCancelRestore: () => void;
  onContinueRestore: (choice: AgentRestoreChoice) => void;
  onCustomAgentDelete: (id: string) => Promise<boolean>;
  onCustomAgentSave: (draft: CustomAgentDraft) => Promise<boolean>;
  onLaunchSelected: (
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

/**
 * Agent Launcher 的纯 UI 组合层。
 *
 * 会话创建、恢复、归档和终端信号仍由上层编排；这里仅持有技术详情与
 * 右键菜单等短生命周期界面状态，避免 UI 状态污染会话状态机。
 */
export function AgentLauncherView({
  actionError,
  actionState,
  agentOptions,
  agentTechnicalDetail,
  currentAgentTarget,
  currentAgentScope,
  currentAgentTargetLabel,
  customAgentError,
  customAgentMutationPending,
  customAgents,
  deletingSessionId,
  loadError,
  loadState,
  pendingSendRequest,
  restoreChoice,
  statusAvailable,
  visible,
  selectedAgentKey,
  onAgentSelect,
  onCancelRestore,
  onContinueRestore,
  onCustomAgentDelete,
  onCustomAgentSave,
  onLaunchSelected,
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
  const [customAgentDialogOpen, setCustomAgentDialogOpen] = useState(false);
  const selectorButtonRef = useRef<HTMLButtonElement | null>(null);
  const launchButtonRef = useRef<HTMLButtonElement | null>(null);
  const customAgentDialogReturnFocusRef = useRef<HTMLElement | null>(null);
  const selectedAgent =
    agentOptions.find((option) => option.key === selectedAgentKey) ??
    agentOptions[0] ??
    null;

  useEffect(() => {
    if (!visible) {
      setCustomAgentDialogOpen(false);
    }
  }, [visible]);

  /** 普通关闭恢复到选择器；保存成功则前移到主“进入”按钮，形成连续键盘流程。 */
  const closeCustomAgentDialog = (focusLaunchButton = false) => {
    customAgentDialogReturnFocusRef.current = focusLaunchButton
      ? launchButtonRef.current
      : selectorButtonRef.current;
    setCustomAgentDialogOpen(false);
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
          className="relative mx-auto my-auto w-full max-w-[320px] py-2"
          data-testid="agent-launcher-content"
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
          <div
            aria-label="Agent 启动控件"
            className="flex min-w-0 items-stretch px-0.5"
            role="group"
          >
            <AgentSelector
              actionState={actionState}
              active={visible}
              disabled={customAgentMutationPending}
              onManageCustomAgents={() => {
                customAgentDialogReturnFocusRef.current = selectorButtonRef.current;
                setCustomAgentDialogOpen(true);
              }}
              onSelect={onAgentSelect}
              options={agentOptions}
              selectedKey={selectedAgentKey}
              triggerRef={selectorButtonRef}
            />
            <AgentLaunchSplitButton
              actionState={actionState}
              disabled={customAgentMutationPending}
              onLaunch={onLaunchSelected}
              option={selectedAgent}
              primaryButtonRef={launchButtonRef}
            />
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
            currentScope={currentAgentScope}
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
      <CustomAgentManagerDialog
        customAgents={customAgents}
        error={customAgentError}
        mutationPending={customAgentMutationPending}
        onClose={() => closeCustomAgentDialog(false)}
        onDelete={onCustomAgentDelete}
        onSave={onCustomAgentSave}
        onSaved={() => closeCustomAgentDialog(true)}
        open={customAgentDialogOpen}
        returnFocusRef={customAgentDialogReturnFocusRef}
      />
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
  const busy = actionState === restoreChoiceActionKey(choice);
  const disabled = actionState !== null;
  const targetLabel = formatRestoreTargetLabel(choice.session);
  return (
    <div className="mt-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-solid)] p-2 shadow-lg shadow-black/10 dark:shadow-black/35">
      <div className="flex min-w-0 items-center gap-2 px-1">
        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-zinc-900 dark:text-zinc-100">
          {choice.session.title || agentTitle(choice.agentId)}
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
          title={targetLabel}
        >
          {targetLabel}
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

/** 新 scope-only 记录没有 legacy target 时，仍显示真实 tab/global 范围而非误报未绑定。 */
function formatRestoreTargetLabel(session: AgentSessionSelection): string {
  if (session.target) {
    return formatTargetChipLabel(session.target);
  }
  return session.tabId === agentSessionScopeId({ kind: "global" })
    ? "整个 Kerminal"
    : "当前 Tab";
}

/** 历史会话缺少标题快照时按内置身份回退，避免 PI 被泛化显示为 Custom。 */
function agentTitle(agentId: ExternalAgentId): string {
  if (agentId === "claude") {
    return "Claude";
  }
  if (agentId === "pi") {
    return "PI Agent";
  }
  if (agentId === "custom") {
    return "Custom";
  }
  return "Codex";
}

/** 新会话用稳定 launcherKey 标记 busy，旧内置/Custom 会话则回退到兼容 key。 */
function restoreChoiceActionKey(choice: AgentRestoreChoice): string {
  if (choice.session.launcherKey) {
    return choice.session.launcherKey;
  }
  if (choice.agentId === "codex") {
    return "builtin:codex";
  }
  if (choice.agentId === "claude") {
    return "builtin:claude";
  }
  if (choice.agentId === "pi") {
    return "builtin:pi";
  }
  return "custom";
}
