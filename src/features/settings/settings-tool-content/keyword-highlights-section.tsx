// @author kongweiguang

import {
  ArrowDown,
  ArrowUp,
  GripVertical,
  Highlighter,
  Plus,
  Search,
  Undo2,
  X,
} from "lucide-react";
import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent,
} from "react";
import { Button } from "../../../components/ui/button";
import { Switch } from "../../../components/ui/switch";
import { cn } from "../../../lib/cn";
import {
  isTerminalKeywordHighlightCustomColorsComplete,
  isTerminalKeywordHighlightHexColor,
  normalizeTerminalKeywordHighlightRule,
  terminalKeywordHighlightColorsForTheme,
  TERMINAL_KEYWORD_HIGHLIGHT_NOTE_LIMIT,
  TERMINAL_KEYWORD_HIGHLIGHT_PATTERN_LIMIT,
  TERMINAL_KEYWORD_HIGHLIGHT_RULE_LIMIT,
  type ResolvedTheme,
  type TerminalAppearance,
  type TerminalKeywordHighlightRule,
  type TerminalKeywordHighlightSettings,
} from "../settingsModel";
import { validateTerminalKeywordHighlightRegex } from "../../terminal/contracts/index";
import { KeywordHighlightRuleEditor } from "./keyword-highlight-editor";

const DELETE_UNDO_WINDOW_MS = 15_000;

const matchModeLabels: Record<TerminalKeywordHighlightRule["matchMode"], string> = {
  literal: "文本",
  wholeWord: "整词",
  regex: "正则",
};

interface KeywordHighlightsSettingsSectionProps {
  onChange: (settings: TerminalKeywordHighlightSettings) => void;
  onSave: (
    settings: TerminalKeywordHighlightSettings,
  ) => Promise<TerminalKeywordHighlightSettings>;
  resolvedTheme: ResolvedTheme;
  terminal: TerminalAppearance;
}

interface EditorSession {
  base: TerminalKeywordHighlightRule | null;
  draft: TerminalKeywordHighlightRule;
  isNew: boolean;
  returnRuleId: string | null;
}

interface DeleteUndoReceipt {
  expiresAt: number;
  index: number;
  rule: TerminalKeywordHighlightRule;
}

let fallbackRuleIdCounter = 0;

/**
 * 管理全局规则列表与单条局部草稿；直接操作立即持久化，表单编辑则走确认式保存，
 * 从而同时满足快速启停/排序和“取消不污染、失败可重试”的编辑语义。
 */
export function KeywordHighlightsSettingsSection({
  onChange,
  onSave,
  resolvedTheme,
  terminal,
}: KeywordHighlightsSettingsSectionProps) {
  const settings = terminal.keywordHighlights;
  const initialRule = settings.rules[0];
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase());
  const [session, setSession] = useState<EditorSession | null>(() =>
    initialRule ? editorSessionForRule(initialRule) : null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draggedRuleId, setDraggedRuleId] = useState<string | null>(null);
  const [undoReceipt, setUndoReceipt] = useState<DeleteUndoReceipt | null>(null);
  const keywordInputRef = useRef<HTMLInputElement>(null);
  const focusFrameRef = useRef<number | null>(null);
  const sourceFocusRef = useRef<HTMLElement | null>(null);
  const rowButtonRefs = useRef(new Map<string, HTMLButtonElement>());

  const visibleRules = useMemo(() => {
    if (!deferredQuery) {
      return settings.rules;
    }
    return settings.rules.filter((rule) =>
      [rule.pattern, rule.note, matchModeLabels[rule.matchMode]]
        .join(" ")
        .toLocaleLowerCase()
        .includes(deferredQuery),
    );
  }, [deferredQuery, settings.rules]);

  useEffect(() => {
    if (!session || session.isNew || busy) {
      return;
    }
    const storedRule = settings.rules.find((rule) => rule.id === session.draft.id);
    if (!storedRule) {
      const next = settings.rules[0];
      setSession(next ? editorSessionForRule(next) : null);
      return;
    }
    if (
      ruleFingerprint(session.draft) === ruleFingerprint(session.base) &&
      ruleFingerprint(storedRule) !== ruleFingerprint(session.base)
    ) {
      setSession(editorSessionForRule(storedRule));
    }
  }, [busy, session, settings.rules]);

  useEffect(() => {
    if (!undoReceipt) {
      return undefined;
    }
    const remaining = undoReceipt.expiresAt - Date.now();
    if (remaining <= 0) {
      setUndoReceipt(null);
      return undefined;
    }
    const timer = window.setTimeout(() => setUndoReceipt(null), remaining);
    return () => window.clearTimeout(timer);
  }, [undoReceipt]);

  useEffect(
    () => () => {
      if (focusFrameRef.current !== null) {
        cancelScheduledFrame(focusFrameRef.current);
      }
    },
    [],
  );

  /** 在下一帧聚焦新建规则输入，等待窄屏上下布局完成后再移动焦点。 */
  const scheduleKeywordInputFocus = () => {
    if (focusFrameRef.current !== null) {
      cancelScheduledFrame(focusFrameRef.current);
    }
    focusFrameRef.current = scheduleFrame(() => {
      focusFrameRef.current = null;
      keywordInputRef.current?.focus();
    });
  };

  /** 保存或取消后返回来源行；新建成功时来源实体就是刚插入的新规则。 */
  const scheduleRuleRowFocus = (ruleId: string | null) => {
    if (!ruleId) {
      sourceFocusRef.current?.focus();
      return;
    }
    if (focusFrameRef.current !== null) {
      cancelScheduledFrame(focusFrameRef.current);
    }
    focusFrameRef.current = scheduleFrame(() => {
      focusFrameRef.current = null;
      rowButtonRefs.current.get(ruleId)?.focus();
    });
  };

  /** 从按钮进入新建会话，ID 在草稿创建时固定，重试保存不会生成重复实体。 */
  const startNewRule = (event: MouseEvent<HTMLElement>) => {
    if (settings.rules.length >= TERMINAL_KEYWORD_HIGHLIGHT_RULE_LIMIT) {
      return;
    }
    sourceFocusRef.current = event.currentTarget;
    setError(null);
    setSession({
      base: null,
      draft: createKeywordHighlightRule(),
      isNew: true,
      returnRuleId: session?.draft.id ?? settings.rules[0]?.id ?? null,
    });
    scheduleKeywordInputFocus();
  };

  /** 选择列表实体时复制持久化值作为新草稿，避免编辑器直接持有配置对象引用。 */
  const selectRule = (
    rule: TerminalKeywordHighlightRule,
    source: HTMLElement,
  ) => {
    sourceFocusRef.current = source;
    setError(null);
    setSession(editorSessionForRule(rule));
  };

  /** 单条启停是明确的列表命令，同时同步当前草稿基线以免制造伪未保存状态。 */
  const toggleRule = (ruleId: string, enabled: boolean) => {
    const nextRules = settings.rules.map((rule) =>
      rule.id === ruleId ? { ...rule, enabled } : rule,
    );
    onChange({ ...settings, rules: nextRules });
    setSession((current) =>
      current?.draft.id === ruleId
        ? {
            ...current,
            base: current.base ? { ...current.base, enabled } : null,
            draft: { ...current.draft, enabled },
          }
        : current,
    );
  };

  /** 上下按钮与拖拽共用同一个纯数组移动入口，确保视觉顺序就是优先级。 */
  const moveRuleBy = (ruleId: string, offset: number) => {
    const index = settings.rules.findIndex((rule) => rule.id === ruleId);
    onChange({
      ...settings,
      rules: moveRule(settings.rules, ruleId, index + offset),
    });
  };

  /** HTML5 drop 只在有效源/目标间重排，不引入额外拖拽 runtime 或全局监听器。 */
  const handleDrop = (
    targetRuleId: string,
    event: DragEvent<HTMLElement>,
  ) => {
    event.preventDefault();
    const sourceRuleId = draggedRuleId;
    setDraggedRuleId(null);
    if (!sourceRuleId || sourceRuleId === targetRuleId) {
      return;
    }
    onChange({
      ...settings,
      rules: moveRuleBefore(settings.rules, sourceRuleId, targetRuleId),
    });
  };

  /** 校验局部草稿并等待确认式持久化；失败只更新表单错误，不关闭编辑器。 */
  const saveRule = async () => {
    if (!session || busy) {
      return;
    }
    if (
      session.isNew &&
      settings.rules.length >= TERMINAL_KEYWORD_HIGHLIGHT_RULE_LIMIT
    ) {
      setError(`关键词高亮最多支持 ${TERMINAL_KEYWORD_HIGHLIGHT_RULE_LIMIT} 条规则。`);
      return;
    }
    const validationError = validateRuleDraft(session.draft, settings.rules);
    if (validationError) {
      setError(validationError);
      keywordInputRef.current?.focus();
      return;
    }
    if (session.draft.matchMode === "regex") {
      setBusy(true);
      const regexError = await validateTerminalKeywordHighlightRegex(
        session.draft.pattern,
      );
      if (regexError) {
        setBusy(false);
        setError(regexError);
        keywordInputRef.current?.focus();
        return;
      }
    } else {
      setBusy(true);
    }

    const normalizedRule = normalizeTerminalKeywordHighlightRule(session.draft);
    if (!normalizedRule) {
      setBusy(false);
      setError("规则内容无效，请检查关键词与颜色。");
      return;
    }
    const nextRules = session.isNew
      ? [...settings.rules, normalizedRule]
      : settings.rules.map((rule) =>
          rule.id === normalizedRule.id ? normalizedRule : rule,
        );
    try {
      const stored = await onSave({ ...settings, rules: nextRules });
      const storedRule =
        stored.rules.find((rule) => rule.id === normalizedRule.id) ??
        normalizedRule;
      setSession(editorSessionForRule(storedRule));
      setError(null);
      scheduleRuleRowFocus(storedRule.id);
    } catch (saveError) {
      setError(settingsSaveErrorMessage(saveError));
    } finally {
      setBusy(false);
    }
  };

  /** 取消现有编辑会重载持久化值；取消新建则回到进入新建前的来源实体。 */
  const cancelEdit = () => {
    if (!session) {
      return;
    }
    setError(null);
    if (!session.isNew) {
      const stored = settings.rules.find((rule) => rule.id === session.draft.id);
      setSession(stored ? editorSessionForRule(stored) : null);
      scheduleRuleRowFocus(stored?.id ?? null);
      return;
    }
    const returnRule =
      settings.rules.find((rule) => rule.id === session.returnRuleId) ??
      settings.rules[0];
    setSession(returnRule ? editorSessionForRule(returnRule) : null);
    scheduleRuleRowFocus(returnRule?.id ?? null);
  };

  /** 删除立即从全局列表移除并保存恢复凭据，15 秒内撤销会按原索引插回。 */
  const deleteRule = () => {
    if (!session || session.isNew || busy) {
      return;
    }
    const index = settings.rules.findIndex((rule) => rule.id === session.draft.id);
    if (index < 0) {
      return;
    }
    const deletedRule = settings.rules[index];
    const nextRules = settings.rules.filter((rule) => rule.id !== deletedRule.id);
    onChange({ ...settings, rules: nextRules });
    setUndoReceipt({
      expiresAt: Date.now() + DELETE_UNDO_WINDOW_MS,
      index,
      rule: cloneRule(deletedRule),
    });
    const nextSelection = nextRules[Math.min(index, nextRules.length - 1)];
    setSession(nextSelection ? editorSessionForRule(nextSelection) : null);
    scheduleRuleRowFocus(nextSelection?.id ?? null);
  };

  /** 撤销只在 ID 尚未被重新创建时恢复，避免覆盖并发外部配置更新。 */
  const undoDelete = () => {
    if (!undoReceipt || settings.rules.some((rule) => rule.id === undoReceipt.rule.id)) {
      setUndoReceipt(null);
      return;
    }
    const nextRules = [...settings.rules];
    nextRules.splice(
      Math.min(undoReceipt.index, nextRules.length),
      0,
      cloneRule(undoReceipt.rule),
    );
    onChange({ ...settings, rules: nextRules });
    setSession(editorSessionForRule(undoReceipt.rule));
    setUndoReceipt(null);
    scheduleRuleRowFocus(undoReceipt.rule.id);
  };

  const showEmptyState = settings.rules.length === 0 && !session?.isNew;
  const selectedRuleId = session?.draft.id ?? null;

  return (
    <section className="space-y-4" id="settings-keyword-highlights-panel">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-control)] bg-[var(--surface-selected)] text-sky-700 dark:text-sky-100">
              <Highlighter className="h-4 w-4" />
            </span>
            <div>
              <h2 className="text-base font-semibold text-[var(--text-primary)]">
                关键词高亮
              </h2>
              <p className="mt-0.5 text-xs leading-5 text-[var(--text-secondary)]">
                全局匹配普通终端可见文本；靠上的规则优先。
              </p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs font-medium text-[var(--text-secondary)]">
            功能总开关
            <Switch
              aria-label="启用关键词高亮"
              checked={settings.enabled}
              onCheckedChange={(enabled) => onChange({ ...settings, enabled })}
            />
          </label>
          <Button
            disabled={settings.rules.length >= TERMINAL_KEYWORD_HIGHLIGHT_RULE_LIMIT}
            onClick={startNewRule}
            size="sm"
            type="button"
            variant="primary"
          >
            <Plus className="h-4 w-4" />
            新建规则
          </Button>
        </div>
      </header>

      {undoReceipt ? (
        <div
          className="kerminal-solid-surface flex min-h-10 items-center justify-between gap-3 rounded-[var(--radius-control)] border px-3 py-2 text-xs text-[var(--text-secondary)]"
          role="status"
        >
          <span>规则“{undoReceipt.rule.pattern}”已删除，可在 15 秒内撤销。</span>
          <Button onClick={undoDelete} size="sm" type="button" variant="ghost">
            <Undo2 className="h-4 w-4" />
            撤销
          </Button>
        </div>
      ) : null}

      {showEmptyState ? (
        <div className="kerminal-solid-surface flex min-h-64 flex-col items-center justify-center rounded-[var(--radius-card)] border px-6 py-10 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--surface-muted)] text-[var(--text-secondary)]">
            <Highlighter className="h-5 w-5" />
          </span>
          <h3 className="mt-4 text-sm font-semibold text-[var(--text-primary)]">
            还没有高亮规则
          </h3>
          <p className="mt-1 max-w-sm text-xs leading-5 text-[var(--text-secondary)]">
            创建第一条规则后，当前和之后打开的普通终端都会自动应用。
          </p>
          <Button className="mt-4" onClick={startNewRule} size="sm" type="button" variant="primary">
            <Plus className="h-4 w-4" />
            新建规则
          </Button>
        </div>
      ) : (
        <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(280px,0.82fr)_minmax(360px,1.18fr)]">
          <section className="kerminal-solid-surface min-w-0 rounded-[var(--radius-card)] border p-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">规则列表</h3>
                <p className="mt-0.5 text-[11px] text-[var(--text-secondary)]">
                  {settings.rules.length} / {TERMINAL_KEYWORD_HIGHLIGHT_RULE_LIMIT} 条
                </p>
              </div>
              {!settings.enabled ? (
                <span className="rounded-full bg-[var(--surface-muted)] px-2 py-1 text-[11px] text-[var(--text-secondary)]">
                  已全局暂停
                </span>
              ) : null}
            </div>

            <label className="kerminal-field-surface mt-3 flex h-9 items-center gap-2 rounded-[var(--radius-control)] border px-2">
              <Search className="h-4 w-4 shrink-0 text-[var(--text-tertiary)]" />
              <input
                aria-label="搜索关键词高亮规则"
                className="min-w-0 flex-1 bg-transparent text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
                onChange={(event) => setQuery(event.currentTarget.value)}
                placeholder="搜索关键词、备注或模式"
                value={query}
              />
              {query ? (
                <button
                  aria-label="清除规则搜索"
                  className="kerminal-focus-ring flex h-7 w-7 items-center justify-center rounded-lg text-[var(--text-tertiary)] hover:bg-[var(--surface-hover)]"
                  onClick={() => setQuery("")}
                  type="button"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </label>

            <ol
              aria-label="关键词高亮规则优先级"
              className="scrollbar-none mt-3 max-h-[min(36rem,calc(100vh-250px))] space-y-1.5 overflow-y-auto"
            >
              {visibleRules.map((rule) => {
                const index = settings.rules.findIndex((candidate) => candidate.id === rule.id);
                const selected = selectedRuleId === rule.id;
                const colors = terminalKeywordHighlightColorsForTheme(rule, resolvedTheme);
                return (
                  <li
                    className={cn(
                      "group flex min-h-16 items-center gap-1 rounded-[var(--radius-control)] border p-1.5 transition-colors motion-reduce:transition-none",
                      selected
                        ? "border-[rgb(var(--app-accent)/0.45)] bg-[var(--surface-selected)]"
                        : "border-transparent bg-[var(--surface-content)] hover:border-[var(--border-subtle)] hover:bg-[var(--surface-hover)]",
                      draggedRuleId === rule.id && "opacity-60 ring-2 ring-[rgb(var(--app-accent)/0.25)]",
                    )}
                    key={rule.id}
                    onDragOver={(event) => {
                      if (draggedRuleId && draggedRuleId !== rule.id) {
                        event.preventDefault();
                      }
                    }}
                    onDrop={(event) => handleDrop(rule.id, event)}
                  >
                    <button
                      aria-label={`拖动排序 ${rule.pattern}`}
                      className="kerminal-focus-ring flex h-9 w-6 shrink-0 cursor-grab items-center justify-center rounded-lg text-[var(--text-tertiary)] hover:bg-[var(--surface-hover)] active:cursor-grabbing"
                      draggable
                      onDragEnd={() => setDraggedRuleId(null)}
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/plain", rule.id);
                        setDraggedRuleId(rule.id);
                      }}
                      title="拖动调整优先级"
                      type="button"
                    >
                      <GripVertical className="h-4 w-4" />
                    </button>
                    <button
                      aria-label={`编辑规则 ${rule.pattern}`}
                      aria-pressed={selected}
                      className="kerminal-focus-ring min-w-0 flex-1 rounded-lg px-1 py-1 text-left"
                      onClick={(event) => selectRule(rule, event.currentTarget)}
                      ref={(node) => {
                        if (node) {
                          rowButtonRefs.current.set(rule.id, node);
                        } else {
                          rowButtonRefs.current.delete(rule.id);
                        }
                      }}
                      type="button"
                    >
                      <span className="flex items-center gap-2">
                        <span
                          aria-hidden="true"
                          className="h-5 w-5 shrink-0 rounded-md border border-[var(--border-subtle)]"
                          style={{ backgroundColor: colors.background, color: colors.foreground }}
                        />
                        <span className="min-w-0 truncate font-mono text-[13px] font-medium text-[var(--text-primary)]">
                          {rule.pattern}
                        </span>
                      </span>
                      <span className="mt-1 flex min-w-0 items-center gap-1.5 text-[11px] text-[var(--text-secondary)]">
                        <span className="shrink-0 rounded bg-[var(--surface-muted)] px-1.5 py-0.5">
                          {matchModeLabels[rule.matchMode]}
                        </span>
                        <span className="truncate">{rule.note || "无备注"}</span>
                      </span>
                    </button>
                    <div className="flex shrink-0 items-center gap-0.5">
                      <Button
                        aria-label={`上移规则 ${rule.pattern}`}
                        disabled={index <= 0}
                        onClick={() => moveRuleBy(rule.id, -1)}
                        size="icon"
                        title="上移"
                        type="button"
                        variant="ghost"
                      >
                        <ArrowUp className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        aria-label={`下移规则 ${rule.pattern}`}
                        disabled={index < 0 || index >= settings.rules.length - 1}
                        onClick={() => moveRuleBy(rule.id, 1)}
                        size="icon"
                        title="下移"
                        type="button"
                        variant="ghost"
                      >
                        <ArrowDown className="h-3.5 w-3.5" />
                      </Button>
                      <Switch
                        aria-label={`${rule.enabled ? "停用" : "启用"}规则 ${rule.pattern}`}
                        checked={rule.enabled}
                        onCheckedChange={(enabled) => toggleRule(rule.id, enabled)}
                      />
                    </div>
                  </li>
                );
              })}
            </ol>
            {visibleRules.length === 0 ? (
              <div className="px-3 py-8 text-center text-xs text-[var(--text-secondary)]">
                没有匹配的规则。
              </div>
            ) : null}
          </section>

          {session ? (
            <KeywordHighlightRuleEditor
              busy={busy}
              draft={session.draft}
              error={error}
              isNew={session.isNew}
              keywordInputRef={keywordInputRef}
              onCancel={cancelEdit}
              onChange={(draft) => {
                setError(null);
                setSession((current) => current ? { ...current, draft } : current);
              }}
              onDelete={deleteRule}
              onSave={() => void saveRule()}
              resolvedTheme={resolvedTheme}
              terminal={terminal}
            />
          ) : (
            <div className="kerminal-solid-surface flex min-h-64 items-center justify-center rounded-[var(--radius-card)] border p-6 text-center text-xs text-[var(--text-secondary)]">
              选择一条规则进行编辑，或新建规则。
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/** 创建带稳定 ID 的默认草稿；无 randomUUID 的测试环境使用进程内单调后备值。 */
function createKeywordHighlightRule(): TerminalKeywordHighlightRule {
  fallbackRuleIdCounter += 1;
  const id = globalThis.crypto?.randomUUID?.() ??
    `keyword-${Date.now().toString(36)}-${fallbackRuleIdCounter.toString(36)}`;
  return {
    id,
    enabled: true,
    pattern: "",
    matchMode: "literal",
    caseSensitive: false,
    note: "",
    style: "yellow",
  };
}

/** 深拷贝自定义色对象，隔离编辑会话和持久化设置的引用。 */
function cloneRule(rule: TerminalKeywordHighlightRule): TerminalKeywordHighlightRule {
  return {
    ...rule,
    ...(rule.customColors
      ? {
          customColors: {
            light: { ...rule.customColors.light },
            dark: { ...rule.customColors.dark },
          },
        }
      : {}),
  };
}

/** 持久化规则进入编辑器时同时建立不可变基线，供外部热更新安全合并。 */
function editorSessionForRule(rule: TerminalKeywordHighlightRule): EditorSession {
  return {
    base: cloneRule(rule),
    draft: cloneRule(rule),
    isNew: false,
    returnRuleId: rule.id,
  };
}

/** JSON 指纹只比较单条小规则，避免引入可变 dirty flag 与外部更新竞态。 */
function ruleFingerprint(rule: TerminalKeywordHighlightRule | null): string {
  return JSON.stringify(rule);
}

/** 统一表单同步边界；正则编译单独异步执行，避免重复加载 RE2JS。 */
function validateRuleDraft(
  rule: TerminalKeywordHighlightRule,
  storedRules: readonly TerminalKeywordHighlightRule[],
): string | null {
  const patternLength = Array.from(rule.pattern).length;
  if (!rule.pattern.trim()) {
    return "请输入关键词或正则表达式。";
  }
  if (patternLength > TERMINAL_KEYWORD_HIGHLIGHT_PATTERN_LIMIT) {
    return `关键词不能超过 ${TERMINAL_KEYWORD_HIGHLIGHT_PATTERN_LIMIT} 个字符。`;
  }
  if (Array.from(rule.note).length > TERMINAL_KEYWORD_HIGHLIGHT_NOTE_LIMIT) {
    return `备注不能超过 ${TERMINAL_KEYWORD_HIGHLIGHT_NOTE_LIMIT} 个字符。`;
  }
  if (storedRules.some((stored) => stored.id === rule.id && stored !== rule)) {
    const occurrences = storedRules.filter((stored) => stored.id === rule.id).length;
    if (occurrences > 1) {
      return "规则 ID 重复，请取消后重新新建。";
    }
  }
  if (rule.style === "custom") {
    if (!isTerminalKeywordHighlightCustomColorsComplete(rule.customColors)) {
      return "自定义颜色在浅色和深色主题下都至少保留一种颜色。";
    }
    for (const pair of [rule.customColors.light, rule.customColors.dark]) {
      for (const color of [pair.foreground, pair.background]) {
        if (color && !isTerminalKeywordHighlightHexColor(color)) {
          return "自定义颜色必须使用 #RRGGBB。";
        }
      }
    }
  }
  return null;
}

/** 内部移动保留对象引用，只创建新的顺序数组。 */
function moveRule(
  rules: readonly TerminalKeywordHighlightRule[],
  ruleId: string,
  targetIndex: number,
): TerminalKeywordHighlightRule[] {
  const sourceIndex = rules.findIndex((rule) => rule.id === ruleId);
  if (sourceIndex < 0) {
    return [...rules];
  }
  const next = [...rules];
  const [rule] = next.splice(sourceIndex, 1);
  const bounded = Math.max(0, Math.min(targetIndex, next.length));
  next.splice(bounded, 0, rule);
  return next;
}

/** 拖拽目标表示插入到目标行之前，并补偿先移除源导致的索引偏移。 */
function moveRuleBefore(
  rules: readonly TerminalKeywordHighlightRule[],
  sourceRuleId: string,
  targetRuleId: string,
): TerminalKeywordHighlightRule[] {
  const sourceIndex = rules.findIndex((rule) => rule.id === sourceRuleId);
  const targetIndex = rules.findIndex((rule) => rule.id === targetRuleId);
  if (sourceIndex < 0 || targetIndex < 0 || sourceRuleId === targetRuleId) {
    return [...rules];
  }
  return moveRule(
    rules,
    sourceRuleId,
    targetIndex - (sourceIndex < targetIndex ? 1 : 0),
  );
}

/** 保存错误只展示可操作信息，不泄露第三方异常栈。 */
function settingsSaveErrorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : "规则保存失败，草稿已保留，请重试。";
}

/** 测试或早期 WebView 缺少 RAF 时用零延迟 timer 保持同一异步聚焦语义。 */
function scheduleFrame(callback: () => void): number {
  return typeof window.requestAnimationFrame === "function"
    ? window.requestAnimationFrame(callback)
    : window.setTimeout(callback, 0);
}

/** 取消由 `scheduleFrame` 创建的任务，避免卸载后聚焦已经销毁的设置控件。 */
function cancelScheduledFrame(frameId: number): void {
  if (typeof window.cancelAnimationFrame === "function") {
    window.cancelAnimationFrame(frameId);
  } else {
    window.clearTimeout(frameId);
  }
}
