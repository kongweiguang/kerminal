import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Download, Plus, Search, Settings2, Trash2, Upload } from "lucide-react";
import { Button } from "../../components/ui/button";
import { ModalShell } from "../../components/ui/modal-shell";
import {
  listSnippetCatalog,
  listSnippetDocumentWarnings,
  listSnippetDocuments,
  createSnippet,
  deleteSnippetWithReceipt,
  deleteSnippet,
  getSnippetDocument,
  importSnippets,
  patchSnippetDocument,
  restoreDeletedSnippet,
  setSnippetFavorite,
  type SnippetCatalogItem,
  type SnippetCatalogVariable,
  type SnippetDocumentSnapshot,
  type SnippetDeleteReceipt,
} from "../../lib/snippetApi";
import type { TerminalPane } from "../workspace/contracts/index";
import { FixedRowVirtualList } from "../sftp/ui/index";
import { getTerminalPaneSessionRecord } from "../terminal/session/index";
import {
  acknowledgeSnippetPanelOpenRequest,
  consumePendingSnippetPanelOpenRequest,
  SNIPPET_PANEL_OPEN_EVENT,
  type SnippetPanelOpenRequest,
} from "./snippetPanelEvents";
import {
  SnippetEditorDialogV2,
  type SnippetEditorValue,
} from "./SnippetEditorDialogV2";
import { SnippetCatalogRowV2 } from "./SnippetCatalogRowV2";
import {
  commonSnippetCatalog,
  searchSnippetCatalog,
} from "./snippetCatalogSearch";
import { SnippetLibraryActionsDialog } from "./SnippetLibraryActionsDialog";
import {
  dryRunSnippetImport,
  serializeSnippetExport,
  type SnippetImportDryRun,
} from "./snippetTransfer";

type SnippetView = "common" | "mine" | "library";
interface EditorState {
  initial: SnippetEditorValue;
  snapshot?: SnippetDocumentSnapshot;
  title: string;
}

interface SnippetToolContentV2Props {
  activeTabId?: string;
  configRevision?: number;
  focusedPane?: TerminalPane;
}

export function SnippetToolContentV2({
  activeTabId,
  configRevision,
  focusedPane,
}: SnippetToolContentV2Props) {
  const searchRef = useRef<HTMLInputElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const [items, setItems] = useState<SnippetCatalogItem[]>([]);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<SnippetView>("common");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [partialWarningCount, setPartialWarningCount] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<SnippetCatalogItem | null>(null);
  const [undoReceipt, setUndoReceipt] = useState<SnippetDeleteReceipt | null>(null);
  const [importPreview, setImportPreview] = useState<SnippetImportDryRun | null>(null);
  const [selectedImports, setSelectedImports] = useState<Set<number>>(new Set());
  const [libraryActionsOpen, setLibraryActionsOpen] = useState(false);
  const [requestedOpen, setRequestedOpen] = useState(
    () => consumePendingSnippetPanelOpenRequest(),
  );
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());

  useEffect(() => {
    const handleOpen = (event: Event) => {
      const request = (event as CustomEvent<SnippetPanelOpenRequest>).detail;
      if (request?.snippetId) {
        acknowledgeSnippetPanelOpenRequest(request);
        setQuery("");
        setRequestedOpen(request);
      }
    };
    window.addEventListener(SNIPPET_PANEL_OPEN_EVENT, handleOpen);
    return () => window.removeEventListener(SNIPPET_PANEL_OPEN_EVENT, handleOpen);
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void listSnippetCatalog({ limit: 2_000 })
      .then((next) => {
        if (!active) return;
        setItems(next);
        setError(null);
      })
      .catch(() => active && setError("命令库暂时无法加载，请稍后重试。"))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [configRevision, refreshKey]);

  useEffect(() => {
    let active = true;
    void listSnippetDocumentWarnings()
      .then((warnings) => active && setPartialWarningCount(warnings.length))
      .catch(() => active && setPartialWarningCount(0));
    return () => {
      active = false;
    };
  }, [configRevision, refreshKey]);

  useEffect(() => {
    if (!undoReceipt) return undefined;
    const remaining = undoReceipt.expiresAtUnixMs - Date.now();
    if (remaining <= 0) {
      setUndoReceipt(null);
      return undefined;
    }
    const timer = window.setTimeout(() => setUndoReceipt(null), remaining);
    return () => window.clearTimeout(timer);
  }, [undoReceipt]);

  const visible = useMemo(() => {
    if (deferredQuery) {
      return searchSnippetCatalog(items, deferredQuery);
    }
    if (view === "mine") return items.filter((item) => item.origin === "user");
    if (view === "library") return items.filter((item) => item.origin === "builtin");
    const common = commonSnippetCatalog(items);
    return common.length > 0
      ? common
      : items
          .filter((item) => item.origin === "builtin" && item.pack === "core")
          .slice(0, 8);
  }, [deferredQuery, items, view]);

  useEffect(() => {
    const item = items.find((candidate) => candidate.id === requestedOpen?.snippetId);
    if (!item) return;
    if (
      requestedOpen?.paneId &&
      (!focusedPane || focusedPane.id !== requestedOpen.paneId)
    ) {
      setStatus("命令提示对应的终端已变化，请在目标终端重新选择片段。");
      setRequestedOpen(null);
      return;
    }
    setView(item.origin === "user" ? "mine" : "library");
    setExpandedId(item.id);
    setValues(initialValues(item.variables));
    setRequestedOpen(null);
  }, [focusedPane, items, requestedOpen]);

  useEffect(() => {
    if (!expandedId) return;
    const frame = window.requestAnimationFrame(() => {
      const row = rowRefs.current.get(expandedId);
      row?.scrollIntoView?.({ block: "nearest" });
      row?.querySelector<HTMLButtonElement>("[data-snippet-row]")?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [expandedId, view]);

  const targetLabel = focusedPane?.title ?? "未选择终端";
  const displayedItems =
    expandedId && visible.length > 200
      ? visible.filter((item) => item.id === expandedId)
      : visible;
  const renderCatalogRow = (item: SnippetCatalogItem) => (
    <SnippetCatalogRowV2
      activeTabId={activeTabId}
      expanded={expandedId === item.id}
      focusedPane={focusedPane}
      item={item}
      onStatus={setStatus}
      onFavorite={() => {
        const favorite = !item.favorite;
        setItems((current) =>
          current.map((candidate) =>
            candidate.id === item.id ? { ...candidate, favorite } : candidate,
          ),
        );
        void setSnippetFavorite(item.origin, item.id, favorite).catch(() => {
          setItems((current) =>
            current.map((candidate) =>
              candidate.id === item.id
                ? { ...candidate, favorite: !favorite }
                : candidate,
            ),
          );
          setError("收藏状态未保存，请重试。");
        });
      }}
      onClone={() =>
        setEditor({
          initial: editorValueFromItem(item, `${item.title} 副本`),
          title: item.origin === "builtin" ? "保存到我的片段" : "克隆片段",
        })
      }
      onDelete={item.origin === "user" ? () => setDeleteTarget(item) : undefined}
      onEdit={
        item.origin === "user"
          ? () => {
              void getSnippetDocument(item.id)
                .then((snapshot) =>
                  setEditor({
                    initial: editorValueFromSnippet(snapshot.snippet),
                    snapshot,
                    title: "编辑命令片段",
                  }),
                )
                .catch(() => setError("片段文件无法读取，请重试。"));
            }
          : undefined
      }
      onToggle={() => {
        setExpandedId((current) => (current === item.id ? null : item.id));
        setValues(initialValues(item.variables));
        setStatus(null);
      }}
      onValue={(name, value) =>
        setValues((current) => ({ ...current, [name]: value }))
      }
      values={values}
    />
  );

  return (
    <section
      className="min-w-0 space-y-3"
      aria-label="命令片段"
      onKeyDown={(event) => {
        const target = event.target as HTMLElement;
        const editing = target.matches("input, textarea, select, [contenteditable='true']");
        if (
          (event.key === "/" && !editing) ||
          ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f")
        ) {
          event.preventDefault();
          searchRef.current?.focus();
          return;
        }
        if (event.key === "Escape") {
          if (query) setQuery("");
          else setExpandedId(null);
        }
      }}
    >
      <div className="flex min-w-0 items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-medium text-zinc-800 dark:text-zinc-100">
            {targetLabel}
          </div>
          <div className="truncate text-[11px] text-zinc-500 dark:text-zinc-400">
            {focusedPane ? "当前填入目标" : "选择分屏后可填入命令"}
          </div>
        </div>
        <Button
          aria-label="导入命令片段"
          onClick={() => importInputRef.current?.click()}
          size="icon"
          title="导入命令片段"
          type="button"
          variant="ghost"
        >
          <Upload className="h-4 w-4" />
        </Button>
        <input
          accept="application/json,.json"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.currentTarget.value = "";
            if (!file) return;
            void file
              .text()
              .then((source) => {
                const preview = dryRunSnippetImport(source);
                const existingTitles = new Set(
                  items
                    .filter((item) => item.origin === "user")
                    .map((item) => item.title.toLowerCase()),
                );
                setImportPreview(preview);
                setSelectedImports(
                  new Set(
                    preview.candidates
                      .map((candidate, index) =>
                        existingTitles.has(candidate.title.toLowerCase()) ? -1 : index,
                      )
                      .filter((index) => index >= 0),
                  ),
                );
              })
              .catch(() => setError("导入文件无法读取。"));
          }}
          ref={importInputRef}
          type="file"
        />
        <Button
          aria-label="导出我的片段"
          onClick={() => {
            void listSnippetDocuments()
              .then((result) => downloadSnippetBundle(serializeSnippetExport(result.snippets)))
              .catch(() => setError("片段导出失败，请重试。"));
          }}
          size="icon"
          title="导出我的片段"
          type="button"
          variant="ghost"
        >
          <Download className="h-4 w-4" />
        </Button>
        <Button
          aria-label="片段库管理"
          onClick={() => setLibraryActionsOpen(true)}
          size="icon"
          title="片段库管理"
          type="button"
          variant="ghost"
        >
          <Settings2 className="h-4 w-4" />
        </Button>
        <Button
          aria-label="新建命令片段"
          onClick={() => {
            const command = focusedPane
              ? getTerminalPaneSessionRecord(focusedPane.id)?.commandBlockText?.trim()
              : undefined;
            setEditor({
              initial: emptyEditorValue(command),
              title: command ? "保存当前终端命令" : "新建命令片段",
            });
          }}
          size="icon"
          title="新建命令片段"
          type="button"
          variant="primary"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      <label className="relative block">
        <span className="sr-only">搜索命令片段</span>
        <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-zinc-400" />
        <input
          className="kerminal-field-surface h-9 w-full rounded-[var(--radius-control)] border pl-9 pr-3 text-sm text-zinc-900 placeholder:text-zinc-400 dark:text-zinc-100"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索名称、命令或标签"
          ref={searchRef}
          value={query}
        />
      </label>

      <div
        className="grid grid-cols-3 border-b border-[var(--border-subtle)]"
        onKeyDown={(event) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          const tabs = Array.from(
            event.currentTarget.querySelectorAll<HTMLButtonElement>("[role='tab']"),
          );
          const current = tabs.indexOf(document.activeElement as HTMLButtonElement);
          if (current < 0) return;
          event.preventDefault();
          const next = event.key === "Home"
            ? 0
            : event.key === "End"
              ? tabs.length - 1
              : (current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
          tabs[next]?.click();
          tabs[next]?.focus();
        }}
        role="tablist"
      >
        {([
          ["common", "常用"],
          ["mine", "我的"],
          ["library", "命令库"],
        ] as const).map(([id, label]) => (
          <button
            aria-selected={view === id}
            aria-controls={`snippet-panel-${id}`}
            className={`kerminal-focus-ring h-8 border-b-2 text-xs ${
              view === id
                ? "border-[rgb(var(--app-accent))] text-zinc-950 dark:text-zinc-50"
                : "border-transparent text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
            }`}
            id={`snippet-tab-${id}`}
            key={id}
            onClick={() => setView(id)}
            role="tab"
            tabIndex={view === id ? 0 : -1}
            type="button"
          >
            {label}
          </button>
        ))}
      </div>

      {error ? <p className="text-xs text-red-600 dark:text-red-300" role="alert">{error}</p> : null}
      {partialWarningCount > 0 ? (
        <p className="text-xs text-amber-700 dark:text-amber-300" role="status">
          {partialWarningCount} 个片段文件格式异常，其他片段仍可使用。
        </p>
      ) : null}
      {status ? (
        <div className="flex items-center justify-between gap-2 text-xs text-emerald-700 dark:text-emerald-300" role="status">
          <span>{status}</span>
          {undoReceipt ? (
            <Button
              onClick={() => {
                void restoreDeletedSnippet(undoReceipt)
                  .then(() => {
                    setUndoReceipt(null);
                    setRefreshKey((current) => current + 1);
                    setStatus("片段已恢复");
                  })
                  .catch(() => {
                    setUndoReceipt(null);
                    setError("撤销已过期或同名片段已存在，未覆盖现有配置。");
                  });
              }}
              size="sm"
              type="button"
              variant="ghost"
            >
              撤销
            </Button>
          ) : null}
        </div>
      ) : null}

      <div
        aria-label="命令片段列表"
        aria-labelledby={`snippet-tab-${view}`}
        className="divide-y divide-[var(--border-subtle)] border-y border-[var(--border-subtle)]"
        id={`snippet-panel-${view}`}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          const rows = Array.from(
            event.currentTarget.querySelectorAll<HTMLButtonElement>("[data-snippet-row]"),
          );
          const current = rows.indexOf(document.activeElement as HTMLButtonElement);
          if (current < 0) return;
          event.preventDefault();
          const offset = event.key === "ArrowDown" ? 1 : -1;
          rows[(current + offset + rows.length) % rows.length]?.focus();
        }}
        role="list"
      >
        {loading && visible.length === 0 ? (
          <p className="px-2 py-8 text-center text-xs text-zinc-500">正在加载...</p>
        ) : null}
        {!loading && visible.length === 0 ? (
          <p className="px-2 py-8 text-center text-xs text-zinc-500">没有匹配的命令片段</p>
        ) : null}
        {displayedItems.length <= 200 ? (
          displayedItems.map((item) => (
            <div
              data-snippet-id={item.id}
              key={item.id}
              role="listitem"
              ref={(node) => {
                if (node) rowRefs.current.set(item.id, node);
                else rowRefs.current.delete(item.id);
              }}
            >
              {renderCatalogRow(item)}
            </div>
          ))
        ) : (
          <FixedRowVirtualList
            ariaLabel="虚拟化命令片段列表"
            className="max-h-[min(32rem,calc(100vh-18rem))]"
            entries={visible}
            getKey={(item) => item.id}
            itemContainerClassName="divide-y divide-[var(--border-subtle)]"
            renderItem={renderCatalogRow}
            resetKey={`${query}\u0000${view}`}
            rowHeight={48}
            testId="snippet-catalog-virtual-list"
            threshold={200}
          />
        )}
      </div>
      <SnippetLibraryActionsDialog
        focusedPaneId={focusedPane?.id}
        onClose={() => setLibraryActionsOpen(false)}
        onCreateFromCommand={(command) => {
          setLibraryActionsOpen(false);
          setEditor({
            initial: emptyEditorValue(command),
            title: "从命令历史创建片段",
          });
        }}
        onRefresh={() => setRefreshKey((current) => current + 1)}
        onStatus={(message) => setStatus(message)}
        open={libraryActionsOpen}
      />
      <ModalShell
        footer={
          <>
            <Button onClick={() => setImportPreview(null)} type="button" variant="ghost">取消</Button>
            <Button
              disabled={saving || selectedImports.size === 0}
              onClick={() => {
                if (!importPreview) return;
                const candidates = importPreview.candidates.filter((_, index) => selectedImports.has(index));
                setSaving(true);
                void importSnippets(candidates)
                  .then(() => {
                    setImportPreview(null);
                    setView("mine");
                    setRefreshKey((current) => current + 1);
                    setStatus(`已导入 ${candidates.length} 个片段`);
                  })
                  .catch(() => setError("导入未写入任何片段，请检查文件后重试。"))
                  .finally(() => setSaving(false));
              }}
              type="button"
              variant="primary"
            >
              <Upload className="h-4 w-4" />导入所选
            </Button>
          </>
        }
        onClose={() => !saving && setImportPreview(null)}
        open={Boolean(importPreview)}
        size="medium"
        title="导入命令片段"
      >
        <div className="space-y-3 text-sm">
          {importPreview?.errors.map((message) => (
            <p className="text-xs text-red-600 dark:text-red-300" key={message}>{message}</p>
          ))}
          {importPreview?.candidates.length === 0 ? (
            <p className="text-zinc-500">没有可导入的片段。</p>
          ) : (
            <div className="max-h-72 divide-y divide-[var(--border-subtle)] overflow-auto border-y border-[var(--border-subtle)]">
              {importPreview?.candidates.map((candidate, index) => {
                const conflict = items.some(
                  (item) => item.origin === "user" && item.title.toLowerCase() === candidate.title.toLowerCase(),
                );
                return (
                  <label className="flex min-w-0 items-start gap-3 px-2 py-2" key={`${candidate.title}-${index}`}>
                    <input
                      checked={selectedImports.has(index)}
                      className="mt-0.5"
                      onChange={(event) => {
                        setSelectedImports((current) => {
                          const next = new Set(current);
                          if (event.target.checked) next.add(index);
                          else next.delete(index);
                          return next;
                        });
                      }}
                      type="checkbox"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium text-zinc-900 dark:text-zinc-100">{candidate.title}</span>
                      <span className="block truncate font-mono text-[11px] text-zinc-500">{candidate.command}</span>
                    </span>
                    {conflict ? <span className="shrink-0 text-[11px] text-amber-700 dark:text-amber-300">同名，将另存</span> : null}
                  </label>
                );
              })}
            </div>
          )}
        </div>
      </ModalShell>
      <SnippetEditorDialogV2
        initial={editor?.initial ?? emptyEditorValue()}
        onClose={() => !saving && setEditor(null)}
        onSave={async (value) => {
          if (!editor) return;
          setSaving(true);
          try {
            if (editor.snapshot) {
              await patchSnippetDocument(editor.snapshot.snippet.id, {
                command: value.command,
                description: value.description || undefined,
                expectedRevision: editor.snapshot.revision,
                scope: value.scope,
                sortOrder: value.sortOrder,
                tags: value.tags,
                title: value.title,
                updatedAt: String(Date.now()),
                category: value.category || undefined,
                risk: value.risk,
                defaultAction: value.defaultAction,
                variables: value.variables,
                contextBindings: value.contextBindings,
                derivedFrom: value.derivedFrom,
              });
            } else {
              const created = await createSnippet({
                command: value.command,
                description: value.description || undefined,
                scope: value.scope,
                tags: value.tags,
                title: value.title,
              });
              try {
                const snapshot = await getSnippetDocument(created.id);
                await patchSnippetDocument(created.id, {
                  category: value.category || undefined,
                  command: value.command,
                  contextBindings: value.contextBindings,
                  defaultAction: value.defaultAction,
                  derivedFrom: value.derivedFrom,
                  description: value.description || undefined,
                  expectedRevision: snapshot.revision,
                  risk: value.risk,
                  scope: value.scope,
                  sortOrder: value.sortOrder,
                  tags: value.tags,
                  title: value.title,
                  updatedAt: String(Date.now()),
                  variables: value.variables,
                });
              } catch (createError) {
                await deleteSnippet(created.id).catch(() => undefined);
                throw createError;
              }
            }
            setEditor(null);
            setView("mine");
            setRefreshKey((current) => current + 1);
            setStatus("片段已保存");
          } finally {
            setSaving(false);
          }
        }}
        open={Boolean(editor)}
        saving={saving}
        title={editor?.title ?? "命令片段"}
      />
      <ModalShell
        footer={
          <>
            <Button onClick={() => setDeleteTarget(null)} type="button" variant="ghost">取消</Button>
            <Button
              disabled={saving}
              onClick={() => {
                if (!deleteTarget) return;
                setSaving(true);
                void deleteSnippetWithReceipt(deleteTarget.id)
                  .then((receipt) => {
                    setDeleteTarget(null);
                    setUndoReceipt(receipt);
                    setExpandedId(null);
                    setRefreshKey((current) => current + 1);
                    setStatus("片段已删除，可在 15 秒内撤销");
                  })
                  .catch(() => setError("片段删除失败，请重试。"))
                  .finally(() => setSaving(false));
              }}
              type="button"
              variant="primary"
            >
              <Trash2 className="h-4 w-4" />删除
            </Button>
          </>
        }
        onClose={() => setDeleteTarget(null)}
        open={Boolean(deleteTarget)}
        size="small"
        title="删除命令片段"
      >
        <p className="text-sm text-zinc-700 dark:text-zinc-200">
          删除“{deleteTarget?.title}”？配置文件会保留短时恢复凭据。
        </p>
      </ModalShell>
    </section>
  );
}

function initialValues(variables: SnippetCatalogVariable[]) {
  return Object.fromEntries(variables.map((variable) => [variable.name, variable.defaultValue ?? ""]));
}

function downloadSnippetBundle(source: string) {
  const url = URL.createObjectURL(new Blob([source], { type: "application/json" }));
  const link = document.createElement("a");
  link.download = `kerminal-snippets-${new Date().toISOString().slice(0, 10)}.json`;
  link.href = url;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function emptyEditorValue(command = ""): SnippetEditorValue {
  return {
    command,
    category: "custom",
    contextBindings: [{ kind: "global" }],
    defaultAction: "insert",
    description: "",
    scope: "any",
    sortOrder: 10,
    tags: [],
    title: "",
    risk: "change",
    variables: [],
  };
}

function editorValueFromItem(item: SnippetCatalogItem, title = item.title): SnippetEditorValue {
  return {
    command: item.template,
    category: item.category,
    contextBindings: [{ kind: "global" }],
    defaultAction: item.defaultAction,
    derivedFrom: item.origin === "builtin" ? item.id : undefined,
    description: item.description,
    scope: item.scope,
    sortOrder: item.sortOrder,
    tags: item.tags,
    title,
    risk: item.risk,
    variables: item.variables,
  };
}

function editorValueFromSnippet(snippet: SnippetDocumentSnapshot["snippet"]): SnippetEditorValue {
  return {
    command: snippet.command,
    category: snippet.category ?? "custom",
    contextBindings: snippet.contextBindings ?? [],
    defaultAction: snippet.defaultAction ?? "insert",
    derivedFrom: snippet.derivedFrom ?? undefined,
    description: snippet.description ?? "",
    scope: snippet.scope,
    sortOrder: snippet.sortOrder,
    tags: snippet.tags,
    title: snippet.title,
    risk: snippet.risk ?? "unknown",
    variables: snippet.variables ?? [],
  };
}
