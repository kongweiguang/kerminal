// @author kongweiguang

import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from "react";
import {
  AlertTriangle,
  Pencil,
  Plus,
  Save,
  Terminal,
  Trash2,
  Wrench,
} from "lucide-react";
import { Button } from "../../../components/ui/button";
import { ModalShell } from "../../../components/ui/modal-shell";
import { UserFacingNotice } from "../../../components/ui/user-facing-notice";
import type { UserFacingMessage } from "../../../lib/userFacingMessage";
import {
  CUSTOM_AGENT_COMMAND_LIMIT,
  CUSTOM_AGENT_LIMIT,
  CUSTOM_AGENT_NAME_LIMIT,
  type CustomAgentDefinition,
} from "../../settings/contracts/index";
import { cn } from "../../../lib/cn";
import { customAgentExecutableName } from "./agentLauncherSettingsModel";

export interface CustomAgentDraft {
  command: string;
  id?: string;
  name: string;
}

interface CustomAgentManagerDialogProps {
  customAgents: CustomAgentDefinition[];
  error: UserFacingMessage | null;
  mutationPending: boolean;
  onClose: () => void;
  onDelete: (id: string) => Promise<boolean>;
  onSave: (draft: CustomAgentDraft) => Promise<boolean>;
  onSaved: () => void;
  open: boolean;
  returnFocusRef?: RefObject<HTMLElement | null>;
}

/**
 * 自定义 Agent 管理弹窗将表单草稿留在 UI 层，只有显式保存才调用持久化回调。
 * 保存失败不清空输入；删除使用二次确认且不影响历史会话的展示职责。
 */
export function CustomAgentManagerDialog({
  customAgents,
  error,
  mutationPending,
  onClose,
  onDelete,
  onSave,
  onSaved,
  open,
  returnFocusRef,
}: CustomAgentManagerDialogProps) {
  const nameCountId = useId();
  const commandCountId = useId();
  const nameInputRef = useRef<HTMLInputElement>(null);
  const previousOpenRef = useRef(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [deleteCandidate, setDeleteCandidate] =
    useState<CustomAgentDefinition | null>(null);
  const [localSubmitting, setLocalSubmitting] = useState(false);
  const [localDeleting, setLocalDeleting] = useState(false);
  const saving = mutationPending || localSubmitting;
  const deleting = mutationPending || localDeleting;
  const busy = saving || deleting;
  const atLimit = customAgents.length >= CUSTOM_AGENT_LIMIT;
  const nameLength = unicodeCodePointLength(name);
  const commandLength = unicodeCodePointLength(command);
  const nameTooLong = nameLength > CUSTOM_AGENT_NAME_LIMIT;
  const commandTooLong = commandLength > CUSTOM_AGENT_COMMAND_LIMIT;

  useEffect(() => {
    if (open && !previousOpenRef.current) {
      setEditingId(null);
      setName("");
      setCommand("");
      setValidationError(null);
      setDeleteCandidate(null);
      setLocalSubmitting(false);
      setLocalDeleting(false);
    }
    previousOpenRef.current = open;
  }, [open]);

  /** 切换到新增状态时清空旧编辑内容，避免误把现有定义覆盖成新命令。 */
  const resetEditor = () => {
    setEditingId(null);
    setName("");
    setCommand("");
    setValidationError(null);
    window.requestAnimationFrame(() => nameInputRef.current?.focus());
  };

  /** 编辑时复制定义快照，后续外部列表变化不会悄悄覆盖用户正在输入的草稿。 */
  const editAgent = (agent: CustomAgentDefinition) => {
    setEditingId(agent.id);
    setName(agent.name);
    setCommand(agent.command);
    setValidationError(null);
    window.requestAnimationFrame(() => nameInputRef.current?.focus());
  };

  /** 提交前先做可即时反馈的字段校验；领域层仍负责权威边界和持久化回滚。 */
  const submitDraft = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) {
      return;
    }
    const normalizedName = name.trim();
    const normalizedCommand = command.trim();
    const nextValidationError = validateDraft(
      { command: normalizedCommand, id: editingId ?? undefined, name: normalizedName },
      customAgents,
    );
    if (nextValidationError) {
      setValidationError(nextValidationError);
      return;
    }

    setValidationError(null);
    setLocalSubmitting(true);
    try {
      const saved = await onSave({
        command: normalizedCommand,
        id: editingId ?? undefined,
        name: normalizedName,
      });
      if (saved) {
        onSaved();
      }
    } finally {
      setLocalSubmitting(false);
    }
  };

  /** 删除成功后仅清理当前定义草稿；历史会话的保留语义由领域层处理。 */
  const confirmDelete = async () => {
    if (!deleteCandidate || busy) {
      return;
    }
    const candidateId = deleteCandidate.id;
    setLocalDeleting(true);
    try {
      const deleted = await onDelete(candidateId);
      if (!deleted) {
        return;
      }
      setDeleteCandidate(null);
      if (editingId === candidateId) {
        resetEditor();
      }
    } finally {
      setLocalDeleting(false);
    }
  };

  const selectedEditingAgent = editingId
    ? customAgents.find((agent) => agent.id === editingId)
    : null;

  return (
    <>
      <ModalShell
        bodyClassName="overflow-hidden p-0"
        description="保存常用的 Agent CLI 启动命令；下次打开 Kerminal 可继续选择。"
        onClose={() => {
          if (!busy) {
            onClose();
          }
        }}
        open={open}
        panelClassName="h-[min(34rem,calc(100vh-32px))]"
        returnFocusRef={returnFocusRef}
        size="medium"
        title="管理自定义 Agent"
      >
        <div className="grid h-full min-h-0 grid-rows-[minmax(0,0.8fr)_minmax(0,1.2fr)] md:grid-cols-[minmax(180px,0.72fr)_minmax(260px,1.28fr)] md:grid-rows-1">
          <section className="flex min-h-0 flex-col border-b border-[var(--border-subtle)] bg-[var(--surface-muted)] md:border-b-0 md:border-r">
            <div className="flex shrink-0 items-center justify-between gap-2 px-4 py-3">
              <div className="min-w-0">
                <h3 className="text-xs font-semibold text-[var(--text-primary)]">
                  已保存
                </h3>
                <p className="mt-0.5 text-[10px] text-[var(--text-tertiary)]">
                  {customAgents.length} / {CUSTOM_AGENT_LIMIT}
                </p>
              </div>
              <Button
                disabled={busy || (atLimit && !editingId)}
                onClick={resetEditor}
                size="sm"
                type="button"
                variant="ghost"
              >
                <Plus className="h-3.5 w-3.5" />
                新增
              </Button>
            </div>
            <div className="scrollbar-none min-h-0 flex-1 overflow-y-auto px-2 pb-3">
              {customAgents.length === 0 ? (
                <div className="mx-2 grid min-h-24 place-items-center rounded-[var(--radius-card)] border border-dashed border-[var(--border-subtle)] px-4 text-center">
                  <div>
                    <Wrench className="mx-auto h-5 w-5 text-[var(--text-tertiary)]" />
                    <p className="mt-2 text-xs font-medium text-[var(--text-secondary)]">
                      还没有自定义 Agent
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-1" role="list" aria-label="自定义 Agent 列表">
                  {customAgents.map((agent) => {
                    const active = editingId === agent.id;
                    return (
                      <div
                        className={cn(
                          "group flex min-w-0 items-center gap-2 rounded-[var(--radius-control)] border px-2 py-1.5 transition",
                          active
                            ? "border-[rgb(var(--app-accent)_/_0.38)] bg-[var(--surface-selected)]"
                            : "border-transparent hover:bg-[var(--surface-hover)]",
                        )}
                        key={agent.id}
                        role="listitem"
                      >
                        <button
                          aria-label={`编辑 ${agent.name}`}
                          className="kerminal-focus-ring flex min-w-0 flex-1 items-center gap-2 rounded-md text-left"
                          disabled={busy}
                          onClick={() => editAgent(agent)}
                          type="button"
                        >
                          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-[var(--surface-solid)] text-[var(--text-secondary)]">
                            <Terminal className="h-3.5 w-3.5" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-xs font-semibold text-[var(--text-primary)]">
                              {agent.name}
                            </span>
                            <span
                              className="block truncate font-mono text-[10px] text-[var(--text-tertiary)]"
                              title={customAgentExecutableName(agent.command)}
                            >
                              {customAgentExecutableName(agent.command)}
                            </span>
                          </span>
                          <Pencil
                            aria-hidden="true"
                            className="h-3.5 w-3.5 shrink-0 text-[var(--text-tertiary)] opacity-70 group-hover:opacity-100"
                          />
                        </button>
                        <button
                          aria-label={`删除 ${agent.name}`}
                          className="kerminal-focus-ring grid h-7 w-7 shrink-0 place-items-center rounded-md text-[var(--text-tertiary)] opacity-70 transition hover:bg-red-500/10 hover:text-red-600 group-hover:opacity-100 dark:hover:text-red-300"
                          disabled={busy}
                          onClick={() => setDeleteCandidate(agent)}
                          title="删除定义"
                          type="button"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </section>

          <form
            className="scrollbar-none min-h-0 overflow-y-auto px-4 py-4"
            onSubmit={submitDraft}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="truncate text-sm font-semibold text-[var(--text-primary)]">
                  {selectedEditingAgent ? `编辑 ${selectedEditingAgent.name}` : "添加 Agent"}
                </h3>
                <p className="mt-1 text-[11px] leading-4 text-[var(--text-tertiary)]">
                  名称用于下拉展示，命令会在独立 Agent 会话目录中运行。
                </p>
              </div>
            </div>

            <div className="mt-4 space-y-3.5">
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold text-[var(--text-secondary)]">
                  名称
                </span>
                <input
                  aria-describedby={nameCountId}
                  aria-invalid={nameTooLong || undefined}
                  aria-label="自定义 Agent 名称"
                  autoComplete="off"
                  autoFocus
                  className="kerminal-field-surface kerminal-focus-ring h-9 w-full rounded-[var(--radius-control)] border px-3 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
                  disabled={busy}
                  onChange={(event) => {
                    setName(event.target.value);
                    setValidationError(null);
                  }}
                  placeholder="例如：PI Agent"
                  ref={nameInputRef}
                  value={name}
                />
                <span
                  className={cn(
                    "mt-1 block text-right text-[10px] tabular-nums",
                    nameTooLong
                      ? "font-semibold text-red-600 dark:text-red-300"
                      : "text-[var(--text-tertiary)]",
                  )}
                  id={nameCountId}
                >
                  {nameLength} / {CUSTOM_AGENT_NAME_LIMIT}
                </span>
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold text-[var(--text-secondary)]">
                  启动命令
                </span>
                <textarea
                  aria-describedby={commandCountId}
                  aria-invalid={commandTooLong || undefined}
                  aria-label="自定义 Agent 启动命令"
                  className="kerminal-field-surface kerminal-focus-ring min-h-24 w-full resize-y rounded-[var(--radius-control)] border px-3 py-2 font-mono text-xs leading-5 text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
                  disabled={busy}
                  onChange={(event) => {
                    setCommand(event.target.value);
                    setValidationError(null);
                  }}
                  placeholder="例如：pi --model provider/model"
                  spellCheck={false}
                  value={command}
                />
                <span
                  className={cn(
                    "mt-1 block text-right text-[10px] tabular-nums",
                    commandTooLong
                      ? "font-semibold text-red-600 dark:text-red-300"
                      : "text-[var(--text-tertiary)]",
                  )}
                  id={commandCountId}
                >
                  {commandLength} / {CUSTOM_AGENT_COMMAND_LIMIT}
                </span>
              </label>

              <div className="flex gap-2 rounded-[var(--radius-control)] border border-amber-400/35 bg-amber-500/8 px-3 py-2.5 text-amber-800 dark:text-amber-200">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <p className="text-[11px] leading-4">
                  启动命令会以明文保存在 settings.toml。请勿填写 API Key、密码或 token。
                </p>
              </div>

              {validationError ? (
                <p className="text-xs leading-5 text-red-600 dark:text-red-300" role="alert">
                  {validationError}
                </p>
              ) : null}
              {error ? <UserFacingNotice compact message={error} /> : null}
            </div>

            <div className="mt-4 flex justify-end gap-2">
              {editingId ? (
                <Button disabled={busy} onClick={resetEditor} size="sm" type="button" variant="ghost">
                  取消编辑
                </Button>
              ) : null}
              <Button
                disabled={
                  busy ||
                  (!editingId && atLimit) ||
                  !name.trim() ||
                  !command.trim() ||
                  nameTooLong ||
                  commandTooLong
                }
                size="sm"
                type="submit"
                variant="primary"
              >
                <Save className="h-3.5 w-3.5" />
                {saving ? "正在保存" : editingId ? "保存修改" : "保存并选择"}
              </Button>
            </div>
          </form>
        </div>
      </ModalShell>

      <ModalShell
        description="只会移除下拉框中的定义，已经创建的历史会话仍会保留。"
        footer={
          <>
            <Button
              disabled={deleting}
              onClick={() => setDeleteCandidate(null)}
              size="sm"
              variant="ghost"
            >
              取消
            </Button>
            <Button
              disabled={deleting}
              onClick={() => void confirmDelete()}
              size="sm"
              variant="danger"
            >
              <Trash2 className="h-4 w-4" />
              {deleting ? "正在删除" : "删除定义"}
            </Button>
          </>
        }
        onClose={() => {
          if (!deleting) {
            setDeleteCandidate(null);
          }
        }}
        open={Boolean(deleteCandidate)}
        size="compact"
        title="删除自定义 Agent？"
      >
        <div className="space-y-3 text-sm">
          <div className="flex min-w-0 items-center gap-3 rounded-[var(--radius-control)] border border-[var(--border-subtle)] bg-[var(--surface-muted)] p-3">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[var(--surface-solid)] text-[var(--text-secondary)]">
              <Wrench className="h-4 w-4" />
            </span>
            <span className="min-w-0 truncate font-medium" title={deleteCandidate?.name}>
              {deleteCandidate?.name}
            </span>
          </div>
          <p className="text-xs leading-5 text-[var(--text-secondary)]">
            删除后无法从下拉框继续选择该定义；历史会话不会被删除。
          </p>
          {error ? <UserFacingNotice compact message={error} /> : null}
        </div>
      </ModalShell>
    </>
  );
}

/** 前端即时校验提供明确反馈，权威限制仍由 settings 持久化层再次验证。 */
function validateDraft(
  draft: CustomAgentDraft,
  customAgents: CustomAgentDefinition[],
) {
  if (!draft.name) {
    return "请输入 Agent 名称。";
  }
  if (!draft.command) {
    return "请输入启动命令。";
  }
  if (unicodeCodePointLength(draft.name) > CUSTOM_AGENT_NAME_LIMIT) {
    return `Agent 名称不能超过 ${CUSTOM_AGENT_NAME_LIMIT} 个字符。`;
  }
  if (unicodeCodePointLength(draft.command) > CUSTOM_AGENT_COMMAND_LIMIT) {
    return `启动命令不能超过 ${CUSTOM_AGENT_COMMAND_LIMIT} 个字符。`;
  }
  const duplicate = customAgents.some(
    (agent) =>
      agent.id !== draft.id &&
      agent.name.trim().toLowerCase() === draft.name.trim().toLowerCase(),
  );
  if (duplicate) {
    return "Agent 名称已存在，请换一个名称。";
  }
  return null;
}

/** 按 Unicode code point 计数，与 Rust `chars().count()` 和 settings 领域校验保持一致。 */
function unicodeCodePointLength(value: string): number {
  return [...value].length;
}
