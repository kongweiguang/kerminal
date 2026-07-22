import { useEffect, useMemo, useState } from "react";
import {
  BookmarkPlus,
  ChevronDown,
  ClipboardCopy,
  Copy,
  CornerDownLeft,
  Eye,
  Pencil,
  Play,
  Star,
  Trash2,
} from "lucide-react";
import { Button } from "../../components/ui/button";
import { ModalShell } from "../../components/ui/modal-shell";
import { writeDesktopClipboardText } from "../../lib/desktopClipboardApi";
import {
  recordSnippetUsage,
  type SnippetCatalogItem,
  type SnippetCatalogVariable,
} from "../../lib/snippetApi";
import {
  getTerminalPaneSessionRecord,
  runSnippetCommand,
  writeSnippetCommand,
} from "../terminal/session/index";
import type { TerminalPane } from "../workspace/contracts/index";
import {
  createSnippetTargetSnapshot,
  isSnippetTargetSnapshotCurrent,
  resolveSnippetExecutionPolicy,
  type SnippetShell,
  type SnippetTargetSnapshot,
} from "./snippetTargetPolicy";
import {
  renderSnippetTemplate,
  type SnippetVariableDefinition,
} from "./snippetTemplate";

export interface SnippetCatalogRowV2Props {
  activeTabId?: string;
  expanded: boolean;
  focusedPane?: TerminalPane;
  item: SnippetCatalogItem;
  onStatus: (status: string | null) => void;
  onFavorite: () => void;
  onClone: () => void;
  onDelete?: () => void;
  onEdit?: () => void;
  onToggle: () => void;
  onValue: (name: string, value: string) => void;
  values: Record<string, string>;
}

/** 紧凑目录行与展开后的安全运行面板。 */
export function SnippetCatalogRowV2({
  activeTabId,
  expanded,
  focusedPane,
  item,
  onStatus,
  onFavorite,
  onClone,
  onDelete,
  onEdit,
  onToggle,
  onValue,
  values,
}: SnippetCatalogRowV2Props) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [copying, setCopying] = useState(false);
  const [secretRevealed, setSecretRevealed] = useState(false);
  const [confirmationText, setConfirmationText] = useState("");
  const [boundPane, setBoundPane] = useState<TerminalPane>();
  const [boundSnapshot, setBoundSnapshot] = useState<SnippetTargetSnapshot>();
  const focusedRecord = focusedPane
    ? getTerminalPaneSessionRecord(focusedPane.id)
    : undefined;
  const candidateSnapshot = focusedRecord
    ? createSnippetTargetSnapshot({
        connectionGeneration: focusedRecord.connectionGeneration,
        displayName: focusedPane?.title,
        paneId: focusedPane?.id ?? "",
        production: focusedPane?.remoteHostProduction,
        record: focusedRecord,
      })
    : null;

  useEffect(() => {
    if (!expanded) {
      setBoundPane(undefined);
      setBoundSnapshot(undefined);
      setConfirmOpen(false);
      setSecretRevealed(false);
      setConfirmationText("");
      return;
    }
    if (!boundSnapshot && focusedPane && candidateSnapshot) {
      setBoundPane(focusedPane);
      setBoundSnapshot(candidateSnapshot);
    }
  }, [boundSnapshot, candidateSnapshot, expanded, focusedPane]);

  const record = boundSnapshot
    ? getTerminalPaneSessionRecord(boundSnapshot.paneId)
    : focusedRecord;
  const definitions = useMemo(
    () => item.variables.map(toVariableDefinition),
    [item.variables],
  );
  const render = useMemo(() => {
    if (!record) return { error: "当前没有可用终端", plan: null };
    try {
      return {
        error: null,
        plan: renderSnippetTemplate({
          shell: shellKind(record.shell),
          template: item.template,
          values,
          variables: definitions,
        }),
      };
    } catch (error) {
      return { error: String(error), plan: null };
    }
  }, [definitions, item.template, record, values]);
  const maskedRender = useMemo(() => {
    if (!record || !render.plan?.containsSensitiveValue) return render;
    try {
      return {
        error: null,
        plan: renderSnippetTemplate({
          shell: shellKind(record.shell),
          template: item.template,
          values: Object.fromEntries(
            definitions.map((variable) => [
              variable.name,
              variable.sensitive || variable.kind === "secret"
                ? values[variable.name]
                  ? "[已隐藏]"
                  : ""
                : values[variable.name] ?? "",
            ]),
          ),
          variables: definitions,
        }),
      };
    } catch {
      return { error: null, plan: null };
    }
  }, [definitions, item.template, record, render, values]);
  const currentBoundSnapshot = record && boundPane
    ? createSnippetTargetSnapshot({
        connectionGeneration: record.connectionGeneration,
        displayName: boundPane.title,
        paneId: boundPane.id,
        production: boundPane.remoteHostProduction,
        record,
      })
    : null;
  const bindingCurrent = Boolean(
    boundSnapshot &&
      focusedPane?.id === boundSnapshot.paneId &&
      isSnippetTargetSnapshotCurrent(boundSnapshot, currentBoundSnapshot),
  );
  const bindingInvalid = Boolean(boundSnapshot && !bindingCurrent);
  const executionPolicy = boundSnapshot
    ? resolveSnippetExecutionPolicy({
        hasLegacyRaw: render.plan?.legacyRaw,
        risk: item.risk,
        sensitive: item.sensitive || Boolean(render.plan?.containsSensitiveValue),
        snapshot: boundSnapshot,
      })
    : null;
  const multiline = Boolean(render.plan && /[\r\n]/.test(render.plan.command));
  const displayedCommand =
    render.plan?.containsSensitiveValue && !secretRevealed
      ? maskedRender.plan?.command ?? "[敏感命令已隐藏]"
      : render.plan?.command;
  const runBlockedReason = sending
    ? "命令正在提交"
    : !bindingCurrent
      ? "终端目标已变化，请重新展开片段"
      : !render.plan
        ? render.error ?? "请先填写并检查参数"
        : null;

  const submit = async (run: boolean) => {
    if (!boundSnapshot || !render.plan || !bindingCurrent) {
      onStatus("终端目标已变化，请收起后重新展开片段");
      return;
    }
    if (sending) return;
    setSending(true);
    try {
      const result = await (run ? runSnippetCommand : writeSnippetCommand)({
        command: render.plan.command,
        expectedConnectionGeneration: boundSnapshot.connectionGeneration,
        expectedSessionId: boundSnapshot.sessionId,
        expectedTargetRef: boundSnapshot.targetId,
        paneId: boundSnapshot.paneId,
        ...(run ? { recordHistory: !render.plan.containsSensitiveValue } : {}),
        tabId: activeTabId,
      });
      if (result.sent) {
        // PTY 写入已经成功时，偏好库故障不得把主操作降级为失败。
        void recordSnippetUsage(item.origin, item.id, run ? "run" : "insert").catch(
          () => undefined,
        );
      }
      onStatus(
        result.sent
          ? run
            ? "命令已提交"
            : "命令已填入，可继续编辑"
          : result.reason === "stale-binding"
            ? "连接已变化，请重新确认目标"
            : "当前终端不可用",
      );
    } catch {
      onStatus("终端写入失败，命令未提交");
    } finally {
      setSending(false);
    }
  };
  const requestRun = () => {
    if (sending || !bindingCurrent || !render.plan || !executionPolicy) return;
    if (executionPolicy.requiresConfirmation || item.duration !== "instant" || multiline) {
      setConfirmationText("");
      setConfirmOpen(true);
      return;
    }
    void submit(true);
  };
  const copyRendered = async () => {
    if (!bindingCurrent || !render.plan || render.plan.containsSensitiveValue) {
      onStatus(
        render.plan?.containsSensitiveValue
          ? "包含敏感值的命令不能复制"
          : "当前终端目标已变化，请重新展开片段",
      );
      return;
    }
    if (copying) return;
    setCopying(true);
    try {
      const result = await writeDesktopClipboardText(render.plan.command);
      if (!result.ok) {
        onStatus("剪贴板当前不可用，请稍后重试");
        return;
      }
      void recordSnippetUsage(item.origin, item.id, "copyRendered").catch(
        () => undefined,
      );
      onStatus("渲染后的命令已复制");
    } finally {
      setCopying(false);
    }
  };

  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-center hover:bg-[var(--surface-hover)]">
        <button
          aria-label={item.favorite ? `取消收藏 ${item.title}` : `收藏 ${item.title}`}
          className="kerminal-focus-ring ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md"
          onClick={onFavorite}
          type="button"
        >
          <Star className={`h-3.5 w-3.5 ${item.favorite ? "fill-amber-400 text-amber-500" : "text-zinc-400"}`} />
        </button>
        <button
          aria-expanded={expanded}
          className="kerminal-focus-ring flex min-h-12 min-w-0 flex-1 items-center gap-2 px-2 py-2 text-left"
          data-snippet-row
          onClick={onToggle}
          type="button"
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-medium text-zinc-900 dark:text-zinc-100">{item.title}</span>
            <span className={`block truncate text-[11px] text-zinc-500 dark:text-zinc-400 ${item.description ? "" : "font-mono"}`}>{item.description || item.template}</span>
          </span>
          <span className="shrink-0 text-[10px] text-zinc-400">{item.origin === "builtin" ? item.category : "我的"}</span>
          <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-zinc-400 transition-transform ${expanded ? "rotate-180" : ""}`} />
        </button>
      </div>
      {expanded ? (
        <div
          className="space-y-3 border-t border-[var(--border-subtle)] bg-[var(--surface-muted)] px-3 py-3"
          onKeyDown={(event) => {
            if (!(event.ctrlKey || event.metaKey) || event.key !== "Enter") return;
            event.preventDefault();
            if (event.shiftKey) requestRun();
            else if (bindingCurrent && render.plan && !multiline) void submit(false);
          }}
        >
          {item.variables.map((variable) => (
            <label className="block space-y-1" key={variable.name}>
              <span className="text-[11px] font-medium text-zinc-700 dark:text-zinc-200">{variable.label}</span>
              {variable.kind === "enum" ? (
                <select
                  className="kerminal-field-surface h-8 w-full rounded-md border px-2 font-mono text-xs text-zinc-900 dark:text-zinc-100"
                  onChange={(event) => onValue(variable.name, event.target.value)}
                  value={values[variable.name] ?? ""}
                >
                  <option value="">请选择</option>
                  {variable.suggestions.map((suggestion) => (
                    <option key={suggestion} value={suggestion}>{suggestion}</option>
                  ))}
                </select>
              ) : (
                <>
                  <input
                    autoComplete={variable.kind === "secret" ? "new-password" : "off"}
                    className="kerminal-field-surface h-8 w-full rounded-md border px-2 font-mono text-xs text-zinc-900 dark:text-zinc-100"
                    list={variable.suggestions.length > 0 ? `${item.id}-${variable.name}-suggestions` : undefined}
                    onChange={(event) => onValue(variable.name, event.target.value)}
                    spellCheck={false}
                    type={variable.kind === "secret" ? "password" : "text"}
                    value={values[variable.name] ?? ""}
                  />
                  {variable.suggestions.length > 0 ? (
                    <datalist id={`${item.id}-${variable.name}-suggestions`}>
                      {variable.suggestions.map((suggestion) => (
                        <option key={suggestion} value={suggestion} />
                      ))}
                    </datalist>
                  ) : null}
                </>
              )}
            </label>
          ))}
          <div className="flex min-w-0 items-start gap-2">
            <pre className="min-w-0 max-h-28 flex-1 overflow-auto whitespace-pre-wrap break-words border-l-2 border-[rgb(var(--app-accent))] pl-2 font-mono text-[11px] text-zinc-700 dark:text-zinc-200">
              {displayedCommand ?? item.template}
            </pre>
            {render.plan?.containsSensitiveValue ? (
              <Button
                aria-label="按住显示敏感值"
                onBlur={() => setSecretRevealed(false)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") setSecretRevealed(true);
                }}
                onKeyUp={() => setSecretRevealed(false)}
                onPointerCancel={() => setSecretRevealed(false)}
                onPointerDown={() => setSecretRevealed(true)}
                onPointerLeave={() => setSecretRevealed(false)}
                onPointerUp={() => setSecretRevealed(false)}
                size="icon"
                title="按住显示敏感值"
                type="button"
                variant="ghost"
              >
                <Eye className="h-3.5 w-3.5" />
              </Button>
            ) : null}
          </div>
          {render.error ? <p className="text-[11px] text-amber-700 dark:text-amber-300">{render.error}</p> : null}
          {bindingInvalid ? (
            <p className="text-[11px] text-amber-700 dark:text-amber-300">
              终端目标已变化，请收起后重新展开片段。
            </p>
          ) : null}
          {multiline ? (
            <p className="text-[11px] text-amber-700 dark:text-amber-300">
              多行片段不能直接填入输入行；运行前会要求确认完整内容。
            </p>
          ) : null}
          {item.duration !== "instant" ? (
            <p className="text-[11px] text-amber-700 dark:text-amber-300">
              {item.duration === "streaming" ? "该命令会持续输出，可用 Ctrl+C 停止。" : "该命令可能产生较高磁盘或网络负载。"}
            </p>
          ) : null}
          <div className="flex min-w-0 flex-wrap items-center gap-2 border-t border-[var(--border-subtle)] pt-2.5">
            <div aria-label="片段管理" className="flex items-center gap-0.5" role="group">
              <Button
                aria-label="复制结果"
                className="h-8 w-8 rounded-md p-0"
                disabled={copying || !bindingCurrent || !render.plan || render.plan.containsSensitiveValue}
                onClick={() => void copyRendered()}
                size="icon"
                title={render.plan?.containsSensitiveValue ? "敏感值不可复制" : "复制结果"}
                type="button"
                variant="ghost"
              >
                <ClipboardCopy className="h-4 w-4" />
              </Button>
              {onEdit ? (
                <Button
                  aria-label="编辑"
                  className="h-8 w-8 rounded-md p-0"
                  onClick={onEdit}
                  size="icon"
                  title="编辑"
                  type="button"
                  variant="ghost"
                >
                  <Pencil className="h-4 w-4" />
                </Button>
              ) : null}
              <Button
                aria-label={item.origin === "builtin" ? "保存到我的" : "克隆"}
                className="h-8 w-8 rounded-md p-0"
                onClick={onClone}
                size="icon"
                title={item.origin === "builtin" ? "保存到我的" : "克隆"}
                type="button"
                variant="ghost"
              >
                {item.origin === "builtin" ? (
                  <BookmarkPlus className="h-4 w-4" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
              {onDelete ? (
                <Button
                  aria-label="删除"
                  className="h-8 w-8 rounded-md p-0"
                  onClick={onDelete}
                  size="icon"
                  title="删除"
                  type="button"
                  variant="danger"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              ) : null}
            </div>
            <div aria-label="终端操作" className="ml-auto flex items-center gap-1.5" role="group">
              <Button
                aria-label="填入终端"
                className="rounded-md px-2.5"
                disabled={sending || !bindingCurrent || !render.plan || multiline}
                onClick={() => void submit(false)}
                size="sm"
                type="button"
                variant="primary"
              >
                <CornerDownLeft className="h-3.5 w-3.5" />填入
              </Button>
              <Button
                aria-disabled={Boolean(runBlockedReason) || undefined}
                className="rounded-md px-2.5 aria-disabled:cursor-not-allowed aria-disabled:opacity-45"
                disabled={sending}
                onClick={() => {
                  if (runBlockedReason) {
                    onStatus(runBlockedReason);
                    return;
                  }
                  requestRun();
                }}
                size="sm"
                title={runBlockedReason ?? "运行"}
                type="button"
                variant="secondary"
              >
                <Play className="h-3.5 w-3.5" />运行
              </Button>
            </div>
          </div>
          <ModalShell
            footer={<><Button disabled={sending} onClick={() => setConfirmOpen(false)} type="button" variant="ghost">取消</Button><Button disabled={sending || Boolean(executionPolicy?.requiresStrongConfirmation && confirmationText !== boundSnapshot?.displayName)} onClick={() => { setConfirmOpen(false); void submit(true); }} type="button" variant="primary"><Play className="h-4 w-4" />确认提交</Button></>}
            onClose={() => setConfirmOpen(false)}
            open={confirmOpen}
            size="small"
            title="确认运行命令"
          >
            <div className="space-y-2 text-sm text-zinc-700 dark:text-zinc-200">
              <p>目标：{boundSnapshot?.displayName}</p>
              <pre className="max-h-36 overflow-auto whitespace-pre-wrap break-words border-l-2 border-amber-500/60 pl-2 font-mono text-xs">{displayedCommand}</pre>
              {executionPolicy?.requiresStrongConfirmation ? (
                <label className="block space-y-1">
                  <span className="text-xs font-medium">输入目标名称“{boundSnapshot?.displayName}”以确认</span>
                  <input
                    autoComplete="off"
                    className="kerminal-field-surface h-9 w-full rounded-lg border px-3 text-sm text-zinc-900 dark:text-zinc-100"
                    onChange={(event) => setConfirmationText(event.target.value)}
                    value={confirmationText}
                  />
                </label>
              ) : null}
              <p>该命令会提交到当前终端，请核对目标和参数。</p>
            </div>
          </ModalShell>
        </div>
      ) : null}
    </div>
  );
}

function toVariableDefinition(variable: SnippetCatalogVariable): SnippetVariableDefinition {
  return { ...variable };
}

function shellKind(shell?: string): SnippetShell {
  const value = shell?.toLowerCase() ?? "";
  if (value.includes("powershell") || value.includes("pwsh")) return "powershell";
  if (value.includes("cmd")) return "cmd";
  if (["bash", "zsh", "fish", "/sh", "sh.exe"].some((name) => value.includes(name))) return "posix";
  return "unknown";
}
