import { Plus, Search } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type RefCallback,
} from "react";
import { Button } from "../../components/ui/button";
import { UserFacingNotice } from "../../components/ui/user-facing-notice";
import { writeDesktopClipboardText } from "../../lib/desktopClipboardApi";
import {
  createSnippet,
  deleteSnippet,
  listSnippets,
  type CommandSnippet,
  type SnippetScope,
} from "../../lib/snippetApi";
import {
  buildUserFacingError,
  type UserFacingMessage,
} from "../../lib/userFacingMessage";
import { createWorkflow, type WorkflowScope } from "../../lib/workflowApi";
import { runSnippetCommand } from "../terminal/session/index";
import type { TerminalPane } from "../workspace/contracts/index";
import {
  extractSnippetVariables,
  renderSnippetCommand,
} from "./snippetVariables";
import {
  SnippetCreateDialog,
  SnippetEmptyState,
  SnippetRow,
  snippetFilterButtonClassName,
  snippetSearchInputClassName,
  snippetSegmentButtonClassName,
  type AddItemType,
  type SnippetRunState,
} from "./SnippetToolContent.parts";
import {
  PRESET_TAG,
  buildSnippetVariableValues,
  collectTagGroups,
  filterPresetSnippets,
  getSnippetSendBlocker,
  groupSnippets,
  isPresetSnippetId,
  parseTags,
  snippetHasTag,
  snippetScopeOptions,
  type SnippetCatalogMode,
} from "./snippetCatalogModel";
import {
  resolveRuntimeSnippetFeatureGates,
  snippetV2NavigationEnabled,
} from "./snippetFeatureGates";
import { SnippetToolContentV2 } from "./SnippetToolContentV2";

interface SnippetToolContentProps {
  activeTabId?: string;
  configRevision?: number;
  focusedPane?: TerminalPane;
}

function useHorizontalFilterWheel(): RefCallback<HTMLDivElement> {
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => cleanupRef.current?.();
  }, []);

  return useCallback((target) => {
    cleanupRef.current?.();
    cleanupRef.current = null;

    if (!target) {
      return;
    }

    const handleWheel = (event: WheelEvent) => {
      if (target.scrollTop !== 0) {
        target.scrollTop = 0;
      }

      const maxScrollLeft = target.scrollWidth - target.clientWidth;
      if (maxScrollLeft <= 1) {
        return;
      }

      const wheelDelta =
        Math.abs(event.deltaX) > Math.abs(event.deltaY)
          ? event.deltaX
          : event.deltaY;
      if (wheelDelta === 0) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      target.scrollLeft = Math.min(
        maxScrollLeft,
        Math.max(0, target.scrollLeft + wheelDelta),
      );
    };

    target.addEventListener("wheel", handleWheel, { passive: false });
    cleanupRef.current = () => target.removeEventListener("wheel", handleWheel);
  }, []);
}

export function SnippetToolContent(props: SnippetToolContentProps) {
  return snippetV2NavigationEnabled(resolveRuntimeSnippetFeatureGates()) ? (
    <SnippetToolContentV2 {...props} />
  ) : (
    <LegacySnippetToolContent {...props} />
  );
}

function LegacySnippetToolContent({
  activeTabId,
  configRevision,
  focusedPane,
}: SnippetToolContentProps) {
  const [activeTag, setActiveTag] = useState("");
  const [catalogMode, setCatalogMode] = useState<SnippetCatalogMode>("mine");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [command, setCommand] = useState("");
  const [configDraftNotice, setConfigDraftNotice] = useState<string | null>(
    null,
  );
  const [createOpen, setCreateOpen] = useState(false);
  const [createType, setCreateType] = useState<AddItemType>("snippet");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<UserFacingMessage | null>(null);
  const [formError, setFormError] = useState<UserFacingMessage | string | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [runState, setRunState] = useState<SnippetRunState | null>(null);
  const [saving, setSaving] = useState(false);
  const [scope, setScope] = useState<SnippetScope | "">("");
  const [snippets, setSnippets] = useState<CommandSnippet[]>([]);
  const [snippetScope, setSnippetScope] = useState<SnippetScope>("any");
  const [tags, setTags] = useState("");
  const [title, setTitle] = useState("");
  const scopeFilterRef = useHorizontalFilterWheel();
  const tagFilterRef = useHorizontalFilterWheel();
  const lastConfigRevisionRef = useRef<number | undefined>(configRevision);

  const presetSnippetsView = useMemo(
    () => filterPresetSnippets({ query, scope }),
    [query, scope],
  );
  const currentSnippets =
    catalogMode === "preset" ? presetSnippetsView : snippets;
  const tagGroups = useMemo(
    () =>
      collectTagGroups(
        currentSnippets,
        catalogMode === "preset" ? [PRESET_TAG] : [],
      ),
    [catalogMode, currentSnippets],
  );
  const visibleSnippets = useMemo(
    () =>
      activeTag
        ? currentSnippets.filter((snippet) => snippetHasTag(snippet, activeTag))
        : currentSnippets,
    [activeTag, currentSnippets],
  );
  const groupedSnippets = useMemo(
    () => groupSnippets(visibleSnippets, activeTag),
    [activeTag, visibleSnippets],
  );
  const hasActiveFilters = Boolean(query.trim() || scope || activeTag);

  const loadSnippets = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const nextSnippets = await listSnippets({
        query: query || undefined,
        scope: scope || undefined,
      });
      setSnippets(nextSnippets);
    } catch (nextError) {
      setError(
        buildUserFacingError(nextError, {
          detail: "命令片段暂时无法加载。",
          recoveryAction: "请稍后重试。",
          title: "加载片段失败",
        }),
      );
    } finally {
      setLoading(false);
    }
  }, [query, scope]);

  useEffect(() => {
    void loadSnippets();
  }, [configRevision, loadSnippets]);

  useEffect(() => {
    if (configRevision === undefined) {
      return;
    }
    if (lastConfigRevisionRef.current === undefined) {
      lastConfigRevisionRef.current = configRevision;
      return;
    }
    if (lastConfigRevisionRef.current === configRevision) {
      return;
    }
    lastConfigRevisionRef.current = configRevision;
    if (createOpen || runState) {
      setConfigDraftNotice("命令片段已更新，当前编辑内容已保留。");
    }
  }, [configRevision, createOpen, runState]);

  useEffect(() => {
    if (!configDraftNotice) {
      return undefined;
    }
    const timer = window.setTimeout(() => {
      setConfigDraftNotice(null);
    }, 3500);
    return () => window.clearTimeout(timer);
  }, [configDraftNotice]);

  useEffect(() => {
    if (!activeTag) {
      return;
    }
    if (!tagGroups.some((group) => group.tag === activeTag)) {
      setActiveTag("");
    }
  }, [activeTag, tagGroups]);

  const resetCreateForm = () => {
    setCreateType("snippet");
    setTitle("");
    setCommand("");
    setDescription("");
    setTags("");
    setSnippetScope("any");
    setFormError(null);
  };

  const openCreateDialog = () => {
    setFormError(null);
    setCreateOpen(true);
  };

  const closeCreateDialog = () => {
    if (saving) {
      return;
    }
    setCreateOpen(false);
    resetCreateForm();
  };

  const createCurrentItem = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedTitle = title.trim();
    const trimmedCommand = command.trim();
    if (!trimmedTitle || !trimmedCommand) {
      setFormError("请输入标题和脚本内容。");
      return;
    }

    setSaving(true);
    setFormError(null);
    try {
      if (createType === "workflow") {
        await createWorkflow({
          description: description.trim(),
          scope: snippetScope as WorkflowScope,
          steps: [
            {
              command: trimmedCommand,
              description: description.trim() || undefined,
              requiresConfirmation: false,
              title: trimmedTitle,
            },
          ],
          tags: parseTags(tags),
          title: trimmedTitle,
        });
      } else {
        await createSnippet({
          command: trimmedCommand,
          description: description.trim(),
          scope: snippetScope,
          tags: parseTags(tags),
          title: trimmedTitle,
        });
        await loadSnippets();
      }
      setCreateOpen(false);
      resetCreateForm();
    } catch (nextError) {
      setFormError(
        buildUserFacingError(nextError, {
          detail:
            createType === "workflow"
              ? "工作流尚未保存。"
              : "命令片段尚未保存。",
          recoveryAction: "请检查内容后重试。",
          title: createType === "workflow" ? "工作流未保存" : "片段未保存",
        }),
      );
    } finally {
      setSaving(false);
    }
  };

  const deleteCurrentSnippet = async (snippetId: string) => {
    if (isPresetSnippetId(snippetId)) {
      return;
    }

    setLoading(true);
    setError(null);
    try {
      await deleteSnippet(snippetId);
      await loadSnippets();
    } catch (nextError) {
      setError(
        buildUserFacingError(nextError, {
          detail: "命令片段仍保留在列表中。",
          recoveryAction: "请稍后重试。",
          title: "片段未删除",
        }),
      );
    } finally {
      setLoading(false);
    }
  };

  const copySnippetCommand = async (snippet: CommandSnippet) => {
    try {
      const result = await writeDesktopClipboardText(snippet.command);
      if (!result.ok) {
        throw new Error(result.reason);
      }
      setCopiedId(snippet.id);
      window.setTimeout(() => setCopiedId(null), 1200);
    } catch {
      setCopiedId(null);
    }
  };

  const updateSnippetVariable = (
    snippetId: string,
    name: string,
    value: string,
  ) => {
    setRunState((current) => {
      if (!current || current.snippetId !== snippetId) {
        return current;
      }
      return {
        ...current,
        error: null,
        status: null,
        values: {
          ...current.values,
          [name]: value,
        },
      };
    });
  };

  const openSnippetRunPanel = (snippet: CommandSnippet) => {
    const variables = extractSnippetVariables(snippet.command);
    setRunState((current) => {
      if (current?.snippetId === snippet.id) {
        return null;
      }
      return {
        error: null,
        sending: false,
        snippetId: snippet.id,
        status: null,
        values: buildSnippetVariableValues(variables),
      };
    });
  };

  const executeSnippet = async (
    snippet: CommandSnippet,
    values: Record<string, string>,
  ) => {
    const variables = extractSnippetVariables(snippet.command);
    const normalizedValues = buildSnippetVariableValues(variables, values);
    const blocker = getSnippetSendBlocker(snippet, focusedPane);
    if (blocker) {
      setRunState({
        error: blocker,
        sending: false,
        snippetId: snippet.id,
        status: null,
        values: normalizedValues,
      });
      return;
    }

    const renderedCommand = renderSnippetCommand(
      snippet.command,
      normalizedValues,
    ).trim();
    if (!renderedCommand) {
      setRunState({
        error: "片段渲染后为空，无法发送。",
        sending: false,
        snippetId: snippet.id,
        status: null,
        values: normalizedValues,
      });
      return;
    }

    setRunState({
      error: null,
      sending: true,
      snippetId: snippet.id,
      status: null,
      values: normalizedValues,
    });
    try {
      const result = await runSnippetCommand({
        command: renderedCommand,
        paneId: focusedPane?.id ?? "",
        tabId: activeTabId,
      });
      if (!result.sent) {
        throw new Error(
          result.reason === "missing-session"
            ? "当前分屏尚未连接，无法发送片段。"
            : "片段渲染后为空，无法发送。",
        );
      }
      setRunState({
        error: null,
        sending: false,
        snippetId: snippet.id,
        status: `已发送到 ${focusedPane?.title ?? "当前分屏"}。`,
        values: normalizedValues,
      });
    } catch (nextError) {
      setRunState({
        error: buildUserFacingError(nextError, {
          detail: "命令尚未发送到当前分屏。",
          recoveryAction: "请确认分屏仍处于连接状态后重试。",
          title: "片段未发送",
        }),
        sending: false,
        snippetId: snippet.id,
        status: null,
        values: normalizedValues,
      });
    }
  };

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">搜索片段</span>
          <Search
            className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-zinc-400"
            strokeWidth={1.8}
          />
          <input
            className={snippetSearchInputClassName}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索名称、标签或命令"
            value={query}
          />
        </label>
        <Button
          aria-label="添加脚本片段"
          className="h-9 w-9 rounded-[var(--radius-control)]"
          onClick={openCreateDialog}
          size="icon"
          title="添加"
          type="button"
          variant="primary"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      <div
        aria-label="片段作用域筛选"
        className="scrollbar-none flex gap-1.5 overflow-x-auto overflow-y-hidden overscroll-contain pb-1"
        ref={scopeFilterRef}
      >
        {snippetScopeOptions.map((option) => {
          const selected = scope === option.value;
          return (
            <button
              aria-pressed={selected}
              className={snippetFilterButtonClassName(selected)}
              key={option.value}
              onClick={() => setScope(option.value as SnippetScope | "")}
              type="button"
            >
              {option.label}
            </button>
          );
        })}
      </div>

      <div className="kerminal-muted-surface grid grid-cols-2 rounded-[var(--radius-control)] border p-1">
        {(
          [
            { count: snippets.length, label: "我的片段", value: "mine" },
            {
              count: presetSnippetsView.length,
              label: "预设命令",
              value: "preset",
            },
          ] as const
        ).map((option) => {
          const selected = catalogMode === option.value;
          return (
            <button
              aria-label={`${option.label} ${option.count}`}
              aria-pressed={selected}
              className={snippetSegmentButtonClassName(selected)}
              key={option.value}
              onClick={() => {
                setCatalogMode(option.value);
                setActiveTag("");
              }}
              type="button"
            >
              {option.label}
              <span className="text-[10px] opacity-60">{option.count}</span>
            </button>
          );
        })}
      </div>

      {tagGroups.length > 0 ? (
        <div
          aria-label="片段标签筛选"
          className="scrollbar-none flex gap-1.5 overflow-x-auto overflow-y-hidden overscroll-contain pb-1"
          ref={tagFilterRef}
        >
          <button
            aria-pressed={!activeTag}
            className={snippetFilterButtonClassName(!activeTag)}
            onClick={() => setActiveTag("")}
            type="button"
          >
            全部 <span className="opacity-60">{currentSnippets.length}</span>
          </button>
          {tagGroups.map((group) => {
            const selected = activeTag === group.tag;
            return (
              <button
                aria-pressed={selected}
                className={snippetFilterButtonClassName(selected)}
                key={group.tag}
                onClick={() => setActiveTag(group.tag)}
                type="button"
              >
                #{group.tag} <span className="opacity-60">{group.count}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      {error ? <UserFacingNotice compact message={error} /> : null}
      {configDraftNotice ? (
        <div
          className="rounded-[var(--radius-control)] border border-amber-300/25 bg-amber-400/10 px-3 py-2 text-xs text-amber-800 dark:border-amber-300/20 dark:bg-amber-400/10 dark:text-amber-100"
          role="status"
        >
          {configDraftNotice}
        </div>
      ) : null}

      <div className="overflow-hidden border-y border-[var(--border-subtle)]">
        {catalogMode === "mine" && loading && snippets.length === 0 ? (
          <div className="px-3 py-8 text-center text-xs text-zinc-500 dark:text-zinc-400">
            正在加载...
          </div>
        ) : null}
        {!loading && visibleSnippets.length === 0 ? (
          <SnippetEmptyState
            filtered={hasActiveFilters}
            mode={catalogMode}
            onAdd={catalogMode === "mine" ? openCreateDialog : undefined}
          />
        ) : null}
        {groupedSnippets.map((group) => (
          <div key={group.id}>
            <div className="kerminal-muted-surface border-b border-[var(--border-subtle)] px-3 py-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
              {group.label} / {group.snippets.length}
            </div>
            <div className="divide-y divide-[var(--border-subtle)]">
              {group.snippets.map((snippet) => (
                <SnippetRow
                  copied={copiedId === snippet.id}
                  focusedPane={focusedPane}
                  key={snippet.id}
                  loading={loading}
                  onCopy={copySnippetCommand}
                  onDelete={deleteCurrentSnippet}
                  onExecute={executeSnippet}
                  onOpenRunPanel={openSnippetRunPanel}
                  onVariableChange={updateSnippetVariable}
                  runState={
                    runState?.snippetId === snippet.id ? runState : null
                  }
                  snippet={snippet}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      <SnippetCreateDialog
        command={command}
        description={description}
        error={formError}
        itemType={createType}
        onClose={closeCreateDialog}
        onCommandChange={setCommand}
        onDescriptionChange={setDescription}
        onItemTypeChange={setCreateType}
        onScopeChange={setSnippetScope}
        onSubmit={createCurrentItem}
        onTagsChange={setTags}
        onTitleChange={setTitle}
        open={createOpen}
        saving={saving}
        scope={snippetScope}
        tags={tags}
        title={title}
      />
    </section>
  );
}
