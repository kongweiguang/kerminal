// @author kongweiguang

import { RefreshCw, Search } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { Select } from "../../../components/ui/select";
import { Switch } from "../../../components/ui/switch";
import { cn } from "../../../lib/cn";
import type { ContainerRuntime } from "../../../lib/targetModel";
import type { Machine } from "../../workspace/contracts/index";
import type { HostContainerGroupMode } from "./hostContainerDialogModel";

export const containerRuntimeOptions = [
  { label: "Docker", value: "docker" },
  { label: "Podman", value: "podman" },
];

export const containerGroupModeOptions = [
  { label: "Compose", value: "compose" },
  { label: "状态", value: "status" },
  { label: "平铺", value: "flat" },
];

export function HostContainersToolbar({
  groupMode,
  host,
  includeStopped,
  loading,
  onGroupModeChange,
  onIncludeStoppedChange,
  onQueryChange,
  onRefresh,
  onRuntimeChange,
  query,
  runtime,
  sidebar,
  summary,
}: {
  groupMode: HostContainerGroupMode;
  host: Machine;
  includeStopped: boolean;
  loading: boolean;
  onGroupModeChange: (value: HostContainerGroupMode) => void;
  onIncludeStoppedChange: (value: boolean) => void;
  onQueryChange: (value: string) => void;
  onRefresh: () => void;
  onRuntimeChange: (value: ContainerRuntime) => void;
  query: string;
  runtime: ContainerRuntime;
  sidebar: boolean;
  summary: string;
}) {
  return (
    <>
      <section className={cn(
        "min-w-0 overflow-hidden border border-[var(--border-subtle)] bg-[var(--surface-solid)]/78 shadow-sm shadow-black/5 dark:shadow-black/20",
        sidebar ? "rounded-[var(--radius-control)] p-2.5" : "rounded-[var(--radius-card)] p-3",
      )}>
        {sidebar ? null : (
          <div className="flex min-w-0 items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-zinc-950 dark:text-zinc-50">{host.name}</div>
              <div className="mt-0.5 truncate font-mono text-[11px] text-zinc-500 dark:text-zinc-400">{formatHostIdentity(host)}</div>
            </div>
            <Button aria-label="刷新容器列表" className="h-8 w-8 rounded-lg" disabled={loading} onClick={onRefresh} size="icon" title="刷新容器列表" type="button" variant="ghost">
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            </Button>
          </div>
        )}
        <div className={cn(
          "truncate rounded-lg bg-black/[0.025] text-xs text-zinc-600 dark:bg-white/[0.045] dark:text-zinc-300",
          sidebar ? "px-2 py-1.5" : "mt-3 px-3 py-2",
        )} data-testid="host-container-summary" role="status" title={summary}>{summary}</div>
      </section>
      <section className="grid min-w-0 gap-2">
        <label className="relative min-w-0">
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" strokeWidth={1.8} />
          <input aria-label="搜索容器" className="kerminal-field-surface kerminal-focus-ring h-9 w-full rounded-xl border pl-9 pr-3 text-sm text-zinc-950 outline-none placeholder:text-zinc-400 dark:text-zinc-100 dark:placeholder:text-zinc-600" onChange={(event) => onQueryChange(event.currentTarget.value)} placeholder="搜索应用、服务、镜像、端口或 ID" value={query} />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <Select aria-label="容器运行时" onValueChange={(value) => onRuntimeChange(value as ContainerRuntime)} options={containerRuntimeOptions} size="sm" value={runtime} />
          <Select aria-label="容器分组方式" onValueChange={(value) => onGroupModeChange(value as HostContainerGroupMode)} options={containerGroupModeOptions} size="sm" value={groupMode} />
        </div>
        <div className="kerminal-field-surface flex h-9 items-center justify-between gap-2 rounded-xl border px-3 text-xs text-zinc-600 dark:text-zinc-300">
          <span>包含停止容器</span>
          <Switch aria-label="包含停止容器" checked={includeStopped} onCheckedChange={onIncludeStoppedChange} />
        </div>
      </section>
    </>
  );
}

export function SummaryMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="border-r border-[var(--border-subtle)] px-3 py-2 last:border-r-0">
      <div className="font-mono text-lg font-semibold leading-6 text-zinc-950 dark:text-zinc-50">{value}</div>
      <div className="text-[11px] text-zinc-500 dark:text-zinc-400">{label}</div>
    </div>
  );
}

export function HostContainersStateMessage({ children, tone = "muted" }: {
  children: string; tone?: "danger" | "muted";
}) {
  return (
    <div className={cn(
      "flex min-h-32 items-center justify-center rounded-[var(--radius-card)] border px-4 py-8 text-center text-sm",
      tone === "danger"
        ? "border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-200"
        : "border-dashed border-[var(--border-subtle)] text-zinc-500 dark:text-zinc-400",
    )}>{children}</div>
  );
}

export function formatHostIdentity(host: Machine) {
  const endpoint = host.host
    ? `${host.username ? `${host.username}@` : ""}${host.host}${host.port ? `:${host.port}` : ""}`
    : host.description;
  return `${endpoint} · SSH`;
}

export function containerLifecycleActionText(action: string) {
  switch (action) {
    case "start": return "启动";
    case "stop": return "停止";
    case "restart": return "重启";
    case "remove": return "删除";
    default: return "处理";
  }
}

export function composeYamlRootPath(workingDir: string | undefined, path: string) {
  if (workingDir) return workingDir;
  const normalizedPath = path.replace(/\\/g, "/");
  const slashIndex = normalizedPath.lastIndexOf("/");
  return slashIndex <= 0 ? "/" : normalizedPath.slice(0, slashIndex);
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return tagName === "input" || tagName === "textarea" || target.isContentEditable;
}
