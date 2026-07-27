// @author kongweiguang

import {
  ChevronLeft,
  ChevronRight,
  ListFilter,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../components/ui/button";
import { Select, type SelectOption } from "../../components/ui/select";
import {
  clearCommandHistory,
  deleteCommandHistory,
  listCommandHistory,
  type CommandHistoryEntry,
  type CommandHistoryListRequest,
  type CommandHistorySource,
} from "../../lib/commandHistoryApi";
import { cn } from "../../lib/cn";

const COMMAND_HISTORY_LIMIT = 100;
const COMMAND_HISTORY_PAGE_SIZE = 8;
const SOURCE_FILTER_OPTIONS: SelectOption[] = [
  { label: "全部来源", value: "" },
  { label: "用户输入", value: "user" },
  { label: "批量发送", value: "broadcast" },
  { label: "片段", value: "snippet" },
  { label: "工作流", value: "workflow" },
  { label: "工具", value: "tool" },
];

interface CommandHistoryPaneContext {
  containerId?: string;
  id: string;
  machineId: string;
  mode: "local" | "ssh" | "telnet" | "serial" | "container" | "preview";
  remoteHostId?: string;
  title: string;
}

interface LogToolContentProps {
  active?: boolean;
  focusedPane?: CommandHistoryPaneContext;
}

export function LogToolContent({
  active = true,
  focusedPane,
}: LogToolContentProps) {
  const [entries, setEntries] = useState<CommandHistoryEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<CommandHistorySource | "">("");
  const historyScope = useMemo(
    () => buildHistoryScope(focusedPane),
    [focusedPane],
  );
  const historyBindingKey = useMemo(
    () =>
      [
        historyScope.request.target ?? "none",
        historyScope.request.paneId ?? "none",
        historyScope.request.remoteHostId ?? "none",
      ].join(":"),
    [historyScope.request],
  );
  const activeRef = useRef(active);
  const historyBindingKeyRef = useRef(historyBindingKey);
  const historyRequestIdRef = useRef(0);
  const [historyStateBindingKey, setHistoryStateBindingKey] =
    useState(historyBindingKey);
  activeRef.current = active;
  historyBindingKeyRef.current = historyBindingKey;
  const historyStateCurrent = historyStateBindingKey === historyBindingKey;
  const visibleEntries = useMemo(
    () => (historyStateCurrent ? entries : []),
    [entries, historyStateCurrent],
  );
  const visibleError = historyStateCurrent ? error : null;
  const visibleLoading = historyStateCurrent
    ? loading
    : active && historyScope.bound;

  // 请求完成时同时核对代次与绑定 key，隐藏或切换 pane 后的旧结果不得回写。
  const isCurrentHistoryRequest = useCallback(
    (requestId: number, bindingKey: string) =>
      activeRef.current &&
      historyBindingKeyRef.current === bindingKey &&
      historyRequestIdRef.current === requestId,
    [],
  );
  const loadHistory = useCallback(async () => {
    if (!activeRef.current || !historyScope.bound) {
      return;
    }
    const requestId = ++historyRequestIdRef.current;
    const bindingKey = historyBindingKey;
    setLoading(true);
    setError(null);
    try {
      const nextEntries = await listCommandHistory({
        limit: COMMAND_HISTORY_LIMIT,
        ...historyScope.request,
        query: query || undefined,
        source: source || undefined,
      });
      if (isCurrentHistoryRequest(requestId, bindingKey)) {
        setEntries(nextEntries);
      }
    } catch (nextError) {
      if (isCurrentHistoryRequest(requestId, bindingKey)) {
        setError(
          nextError instanceof Error ? nextError.message : String(nextError),
        );
      }
    } finally {
      if (isCurrentHistoryRequest(requestId, bindingKey)) {
        setLoading(false);
      }
    }
  }, [
    historyBindingKey,
    historyScope.bound,
    historyScope.request,
    isCurrentHistoryRequest,
    query,
    source,
  ]);

  useEffect(() => {
    historyRequestIdRef.current += 1;
    setHistoryStateBindingKey(historyBindingKey);
    setEntries([]);
    setError(null);
    setLoading(false);
    setPage(1);
  }, [historyBindingKey]);

  useEffect(() => {
    if (!active) {
      historyRequestIdRef.current += 1;
      setLoading(false);
      return undefined;
    }
    void loadHistory();
    return () => {
      historyRequestIdRef.current += 1;
    };
  }, [active, loadHistory]);

  const totalPages = Math.max(
    1,
    Math.ceil(visibleEntries.length / COMMAND_HISTORY_PAGE_SIZE),
  );
  const activePage = Math.min(page, totalPages);
  const pageStart = (activePage - 1) * COMMAND_HISTORY_PAGE_SIZE;
  const pageEntries = visibleEntries.slice(
    pageStart,
    pageStart + COMMAND_HISTORY_PAGE_SIZE,
  );
  const pageRangeStart = visibleEntries.length === 0 ? 0 : pageStart + 1;
  const pageRangeEnd = Math.min(
    visibleEntries.length,
    pageStart + COMMAND_HISTORY_PAGE_SIZE,
  );

  useEffect(() => {
    setPage((current) => Math.min(current, totalPages));
  }, [totalPages]);

  const updateQuery = (nextQuery: string) => {
    setQuery(nextQuery);
    setPage(1);
  };

  const updateSource = (nextSource: CommandHistorySource | "") => {
    setSource(nextSource);
    setPage(1);
  };

  const deleteEntry = async (entryId: string) => {
    if (
      !activeRef.current ||
      !historyScope.bound ||
      !historyStateCurrent ||
      !visibleEntries.some((entry) => entry.id === entryId)
    ) {
      return;
    }
    const bindingKey = historyBindingKey;
    setLoading(true);
    setError(null);
    try {
      await deleteCommandHistory(entryId);
      if (!activeRef.current || historyBindingKeyRef.current !== bindingKey) {
        return;
      }
      await loadHistory();
    } catch (nextError) {
      if (activeRef.current && historyBindingKeyRef.current === bindingKey) {
        setError(
          nextError instanceof Error ? nextError.message : String(nextError),
        );
      }
    } finally {
      if (activeRef.current && historyBindingKeyRef.current === bindingKey) {
        setLoading(false);
      }
    }
  };

  const clearEntries = async () => {
    if (
      !activeRef.current ||
      !historyScope.bound ||
      !historyStateCurrent
    ) {
      return;
    }
    const bindingKey = historyBindingKey;
    const scopeRequest = historyScope.request;
    setLoading(true);
    setError(null);
    try {
      await clearCommandHistory(scopeRequest);
      if (!activeRef.current || historyBindingKeyRef.current !== bindingKey) {
        return;
      }
      setPage(1);
      await loadHistory();
    } catch (nextError) {
      if (activeRef.current && historyBindingKeyRef.current === bindingKey) {
        setError(
          nextError instanceof Error ? nextError.message : String(nextError),
        );
      }
    } finally {
      if (activeRef.current && historyBindingKeyRef.current === bindingKey) {
        setLoading(false);
      }
    }
  };

  return (
    <section className="space-y-3">
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
            <span className="kerminal-muted-surface shrink-0 rounded-md border px-2 py-1 font-medium text-zinc-700 dark:text-zinc-300">
              {historyScope.label}
            </span>
            <span
              className="min-w-0 truncate font-mono"
              title={historyScope.detail}
            >
              {historyScope.detail}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              aria-label="刷新命令历史"
              disabled={visibleLoading || !historyScope.bound}
              onClick={() => void loadHistory()}
              size="icon"
              title="刷新命令历史"
              variant="ghost"
            >
              <RefreshCw
                className={cn("h-4 w-4", visibleLoading && "animate-spin")}
              />
            </Button>
            <Button
              aria-label="清空命令历史"
              disabled={
                visibleLoading ||
                !historyScope.bound ||
                visibleEntries.length === 0
              }
              onClick={() => void clearEntries()}
              size="icon"
              title="清空命令历史"
              variant="danger"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="grid gap-2 min-[560px]:grid-cols-[minmax(0,1fr)_9rem]">
          <label className="relative min-w-0">
            <span className="sr-only">搜索命令历史</span>
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-zinc-400 dark:text-zinc-500" />
            <input
              className="kerminal-field-surface h-9 w-full rounded-lg border pl-9 pr-9 text-sm text-zinc-900 placeholder:text-zinc-400 dark:text-zinc-100 dark:placeholder:text-zinc-500"
              onChange={(event) => updateQuery(event.target.value)}
              placeholder="搜索命令"
              value={query}
            />
            {query ? (
              <button
                aria-label="清空命令搜索"
                className="kerminal-focus-ring kerminal-pressable absolute right-2 top-2 inline-flex h-5 w-5 items-center justify-center rounded-md text-zinc-400 transition hover:bg-[var(--surface-hover)] hover:text-zinc-700 dark:hover:text-zinc-100"
                onClick={() => updateQuery("")}
                type="button"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </label>
          <div className="relative min-w-0">
            <span className="sr-only">历史来源</span>
            <ListFilter className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-zinc-400 dark:text-zinc-500" />
            <Select
              aria-label="历史来源"
              buttonClassName="rounded-lg pl-9 text-sm text-zinc-900 dark:text-zinc-100"
              onValueChange={(nextSource) =>
                updateSource(nextSource as CommandHistorySource | "")
              }
              options={SOURCE_FILTER_OPTIONS}
              value={source}
            />
          </div>
        </div>
      </section>

      {visibleError ? (
        <div
          className="rounded-lg border border-rose-300/25 bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-100"
          role="alert"
        >
          {visibleError}
        </div>
      ) : null}

      <section className="kerminal-solid-surface overflow-hidden rounded-[var(--radius-card)] border">
        <div className="flex items-center justify-between gap-3 border-b border-[var(--border-subtle)] px-3 py-2">
          <div className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
            最近命令
          </div>
          <div className="text-xs text-zinc-500 dark:text-zinc-400">
            {visibleEntries.length > 0
              ? `${pageRangeStart}-${pageRangeEnd} / ${visibleEntries.length}`
              : "0 / 0"}
          </div>
        </div>

        {visibleLoading && visibleEntries.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
            正在加载命令历史...
          </div>
        ) : null}
        {!visibleLoading && visibleEntries.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
            暂无命令历史。
          </div>
        ) : null}

        {visibleEntries.length > 0 ? (
          <>
            <div className="divide-y divide-[var(--border-subtle)]">
              {pageEntries.map((entry) => (
                <div
                  className="group flex min-w-0 items-start gap-2 px-3 py-2.5"
                  key={entry.id}
                >
                  <div className="min-w-0 flex-1">
                    <code
                      className="block truncate font-mono text-[13px] leading-5 text-zinc-900 dark:text-zinc-100"
                      title={entry.command}
                    >
                      {entry.command}
                    </code>
                    <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                      <span>{formatTimestamp(entry.createdAt)}</span>
                      <span aria-hidden="true">·</span>
                      <span
                        className="truncate"
                        title={historyContextLabel(entry)}
                      >
                        {historyContextLabel(entry)}
                      </span>
                      {entry.source === "user" ? null : (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="shrink-0">
                            {historySourceLabel(entry.source)}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  <Button
                    aria-label={`删除历史 ${entry.command}`}
                    className="shrink-0 text-zinc-400 opacity-70 transition-opacity hover:text-[rgb(var(--app-danger))] group-hover:opacity-100 dark:text-zinc-500"
                    disabled={visibleLoading}
                    onClick={() => void deleteEntry(entry.id)}
                    size="icon"
                    title={`删除历史 ${entry.command}`}
                    variant="ghost"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>

            {totalPages > 1 ? (
              <div className="flex items-center justify-end gap-1 border-t border-[var(--border-subtle)] px-2 py-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                <div className="flex items-center gap-1">
                  <Button
                    aria-label="上一页命令历史"
                    disabled={activePage <= 1}
                    onClick={() =>
                      setPage((current) => Math.max(1, current - 1))
                    }
                    size="icon"
                    title="上一页"
                    variant="ghost"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="min-w-16 text-center">
                    {activePage} / {totalPages}
                  </span>
                  <Button
                    aria-label="下一页命令历史"
                    disabled={activePage >= totalPages}
                    onClick={() =>
                      setPage((current) => Math.min(totalPages, current + 1))
                    }
                    size="icon"
                    title="下一页"
                    variant="ghost"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ) : null}
          </>
        ) : null}
      </section>
    </section>
  );
}

function buildHistoryScope(focusedPane?: CommandHistoryPaneContext): {
  bound: boolean;
  detail: string;
  label: string;
  request: Pick<
    CommandHistoryListRequest,
    "paneId" | "remoteHostId" | "target"
  >;
} {
  if (!focusedPane) {
    return {
      bound: false,
      detail: "未聚焦终端",
      label: "当前终端",
      request: {},
    };
  }

  if (focusedPane.mode === "ssh") {
    const remoteHostId = focusedPane.remoteHostId ?? focusedPane.machineId;
    return {
      bound: true,
      detail: remoteHostId,
      label: "SSH",
      request: {
        paneId: focusedPane.id,
        remoteHostId,
        target: "ssh",
      },
    };
  }

  if (focusedPane.mode === "container") {
    return {
      bound: true,
      detail: focusedPane.containerId ?? focusedPane.title,
      label: "容器",
      request: {
        paneId: focusedPane.id,
        target: "dockerContainer",
      },
    };
  }

  if (focusedPane.mode === "telnet" || focusedPane.mode === "serial") {
    const targetId = focusedPane.remoteHostId ?? focusedPane.machineId;
    return {
      bound: true,
      detail: targetId,
      label: focusedPane.mode === "telnet" ? "Telnet" : "Serial",
      request: {
        paneId: focusedPane.id,
        remoteHostId: targetId,
        target: focusedPane.mode,
      },
    };
  }

  return {
    bound: true,
    detail: focusedPane.title,
    label: "本地",
    request: {
      paneId: focusedPane.id,
      target: "local",
    },
  };
}

function historyContextLabel(entry: CommandHistoryEntry) {
  return (
    entry.cwd ??
    entry.remoteHostId ??
    entry.sessionId ??
    entry.shell ??
    "未绑定上下文"
  );
}

function historySourceLabel(source: CommandHistorySource) {
  const labels: Record<CommandHistorySource, string> = {
    broadcast: "批量发送",
    snippet: "片段",
    workflow: "工作流",
    tool: "工具",
    user: "用户输入",
  };
  return labels[source];
}

function formatTimestamp(value: string) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return value;
  }

  return new Date(seconds * 1000).toLocaleString("zh-CN", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "2-digit",
  });
}
