// @author kongweiguang

import {
  Activity,
  ArrowDown,
  ArrowUp,
  CircuitBoard,
  Cpu,
  HardDrive,
  MemoryStick,
  Network,
  RefreshCw,
  Server,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { IconAction } from "../../components/ui/icon-action";
import { Select } from "../../components/ui/select";
import { UserFacingNotice } from "../../components/ui/user-facing-notice";
import { cn } from "../../lib/cn";
import type { ServerInfoSnapshot } from "../../lib/serverInfoApi";
import type { Machine } from "../workspace/contracts/index";
import {
  filterNetworkInterfaces,
  networkInterfaceRoleLabel,
  primaryNetworkTraffic,
  type NetworkInterfaceFilter,
} from "./serverInfoDashboardModel";
import {
  createServerInfoHistoryStore,
  historySeries,
  type ServerInfoHistoryStore,
  type ServerInfoHistoryPoint,
} from "./serverInfoHistoryModel";
import { resolveServerInfoHealth } from "./serverInfoHealthPolicy";
import {
  formatBytes,
  coreUsages,
  formatLoadAverage,
  formatPercent,
  formatProcessSummary,
  formatTimestamp,
  formatTrafficRate,
  formatUptime,
  gpuCardHelper,
  gpuMemoryLabel,
  loadAverageValues,
  networkTrafficFromSnapshot,
  npuMemoryLabel,
  percentOf,
  serverGpuSummaryValue,
  shouldShowNpuCard,
  type NetworkTrafficSnapshot,
} from "./serverInfoMetricsModel";
import {
  defaultLocalServerInfoTargetContext,
  serverInfoTargetContext,
} from "./serverInfoTargetModel";
import {
  serverInfoRefreshOptions,
  type ServerInfoSnapshotRuntime,
  useServerInfoSnapshot,
} from "./useServerInfoSnapshot";

interface ServerInfoToolContentProps {
  active?: boolean;
  historyStore?: ServerInfoHistoryStore;
  snapshotRuntime?: ServerInfoSnapshotRuntime;
  selectedMachine?: Machine;
}

type MonitorView = "overview" | "processes" | "resources";

/** 将趋势数据与采集目标一起保存，避免切换目标时复用上一台机器的历史。 */
interface TargetHistoryState {
  points: ServerInfoHistoryPoint[];
  targetKey?: string;
}

const views: Array<{ id: MonitorView; label: string }> = [
  { id: "overview", label: "概览" },
  { id: "resources", label: "资源" },
  { id: "processes", label: "进程" },
];

const defaultHistoryStore = createServerInfoHistoryStore();

export function ServerInfoToolContent({
  active = true,
  historyStore = defaultHistoryStore,
  snapshotRuntime,
  selectedMachine,
}: ServerInfoToolContentProps) {
  const targetContext = useMemo(
    () =>
      serverInfoTargetContext(selectedMachine) ??
      defaultLocalServerInfoTargetContext(),
    [selectedMachine],
  );
  const activeTargetContext = active ? targetContext : undefined;
  const activeTargetKey = activeTargetContext?.cacheKey;
  const [activeView, setActiveView] = useState<MonitorView>("overview");
  const [snapshotTargetKey, setSnapshotTargetKey] = useState(activeTargetKey);
  const [historyState, setHistoryState] = useState<TargetHistoryState>(() => ({
    points: activeTargetKey ? historyStore.forTarget(activeTargetKey) : [],
    targetKey: activeTargetKey,
  }));
  const {
    error: sourceError,
    loading: sourceLoading,
    networkTraffic: sourceNetworkTraffic,
    refresh,
    refreshIntervalMs,
    setRefreshIntervalMs,
    snapshot: sourceSnapshot,
  } = useServerInfoSnapshot(activeTargetContext, { runtime: snapshotRuntime });

  // hook 的目标切换依赖 effect，切换后的首个 render 仍可能带着旧目标 state。
  // 只有 hook 已完成目标交接后，才允许快照、网络速率和错误进入当前视图。
  const targetStateReady =
    activeTargetKey !== undefined && snapshotTargetKey === activeTargetKey;
  const error = targetStateReady ? sourceError : null;
  const loading = targetStateReady
    ? sourceLoading
    : activeTargetKey !== undefined;
  const networkTraffic = targetStateReady ? sourceNetworkTraffic : null;
  const snapshot = targetStateReady ? sourceSnapshot : null;
  const history =
    historyState.targetKey === activeTargetKey ? historyState.points : [];

  useEffect(() => {
    if (activeTargetContext) {
      void refresh({ force: true });
    }
  }, [activeTargetContext, refresh]);

  useEffect(() => {
    setSnapshotTargetKey(activeTargetKey);
  }, [activeTargetKey]);

  useEffect(() => {
    setHistoryState({
      points: activeTargetKey
        ? historyStore.forTarget(activeTargetKey)
        : [],
      targetKey: activeTargetKey,
    });
  }, [activeTargetKey, historyStore]);

  useEffect(() => {
    if (!snapshot || !activeTargetKey) {
      return;
    }
    setHistoryState({
      points: historyStore.append(
        activeTargetKey,
        snapshot,
        networkTraffic,
      ),
      targetKey: activeTargetKey,
    });
  }, [activeTargetKey, historyStore, networkTraffic, snapshot]);

  if (!active) {
    return null;
  }

  const traffic =
    networkTraffic ??
    (snapshot
      ? networkTrafficFromSnapshot(snapshot)
      : {
          interfaces: [],
          totalRxBytesPerSecond: undefined,
          totalTxBytesPerSecond: undefined,
        });
  const health = resolveServerInfoHealth({
    capturedAt: snapshot?.capturedAt,
    error: Boolean(error),
    hasRateSample: Boolean(traffic.sampleDurationMs),
    loading,
    nowMs: Date.now(),
    refreshIntervalMs,
  });

  return (
    <section className="min-w-0 space-y-3">
      <header className="kerminal-solid-surface border-b px-3 pb-3 pt-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Server className="h-4 w-4 shrink-0 text-[rgb(var(--app-accent))]" />
              <h2 className="truncate text-sm font-semibold text-zinc-950 dark:text-zinc-50">
                {targetContext.title}
              </h2>
              <StatusDot status={health.status} />
            </div>
            <p className="mt-1 truncate text-xs text-zinc-500 dark:text-zinc-400">
              {targetContext.subtitle}
            </p>
          </div>
          <IconAction
            icon={RefreshCw}
            label={targetContext.refreshAriaLabel}
            loading={loading}
            onClick={() => void refresh({ force: true })}
            variant="ghost"
          />
        </div>
        <div className="mt-3 flex items-center justify-between gap-2">
          <div
            aria-label="系统信息视图"
            className="kerminal-muted-surface grid min-w-0 flex-1 grid-cols-3 rounded-lg border p-0.5"
            role="tablist"
          >
            {views.map((view) => (
              <button
                aria-selected={activeView === view.id}
                className={cn(
                  "kerminal-focus-ring kerminal-pressable min-w-0 rounded-md px-2 py-1.5 text-xs font-medium focus-visible:outline-none",
                  activeView === view.id
                    ? "kerminal-solid-surface text-zinc-950 dark:text-zinc-50"
                    : "text-zinc-500 dark:text-zinc-400",
                )}
                key={view.id}
                onClick={() => setActiveView(view.id)}
                role="tab"
                type="button"
              >
                {view.label}
              </button>
            ))}
          </div>
          <Select
            aria-label="系统信息采集间隔"
            className="w-[4.75rem] shrink-0"
            onValueChange={(value) => setRefreshIntervalMs(Number(value))}
            options={serverInfoRefreshOptions.map((option) => ({
              label: option.label,
              value: String(option.value),
            }))}
            size="sm"
            value={String(refreshIntervalMs)}
          />
        </div>
        <div className="mt-2 flex items-center justify-between gap-3 text-[11px] text-zinc-500 dark:text-zinc-400">
          <span>
            {traffic.counterReset
              ? "网络计数器已重置，等待下一次采样"
              : health.label}
          </span>
          <span>
            {snapshot
              ? `更新于 ${formatTimestamp(snapshot.capturedAt)}`
              : "等待首次采集"}
          </span>
        </div>
      </header>

      {error ? <UserFacingNotice compact message={error} /> : null}
      {!snapshot ? (
        <EmptyState loading={loading} />
      ) : (
        <div role="tabpanel">
          {activeView === "overview" ? (
            <Overview snapshot={snapshot} traffic={traffic} history={history} />
          ) : null}
          {activeView === "resources" ? (
            <Resources
              snapshot={snapshot}
              traffic={traffic}
              history={history}
            />
          ) : null}
          {activeView === "processes" ? (
            <Processes snapshot={snapshot} />
          ) : null}
        </div>
      )}
    </section>
  );
}

function Overview({
  history,
  snapshot,
  traffic,
}: {
  history: ServerInfoHistoryPoint[];
  snapshot: ServerInfoSnapshot;
  traffic: NetworkTrafficSnapshot;
}) {
  const memory = percentOf(snapshot.memoryUsedBytes, snapshot.memoryTotalBytes);
  const disk = percentOf(snapshot.diskUsedBytes, snapshot.diskTotalBytes);
  const primaryTraffic = primaryNetworkTraffic(traffic.interfaces);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius-card)] border bg-[var(--border-subtle)]">
        <Metric
          icon={<Cpu className="h-4 w-4" />}
          label="CPU"
          series={historySeries(history, "cpuPercent")}
          value={formatPercent(snapshot.cpuUsagePercent)}
        />
        <Metric
          icon={<MemoryStick className="h-4 w-4" />}
          label="内存"
          series={historySeries(history, "memoryPercent")}
          value={formatPercent(memory)}
        />
        <Metric
          icon={<ArrowDown className="h-4 w-4" />}
          label="下行"
          series={historySeries(history, "networkRxBytesPerSecond")}
          value={formatTrafficRate(primaryTraffic.rxBytesPerSecond, "采样中")}
        />
        <Metric
          icon={<ArrowUp className="h-4 w-4" />}
          label="上行"
          series={historySeries(history, "networkTxBytesPerSecond")}
          value={formatTrafficRate(primaryTraffic.txBytesPerSecond, "采样中")}
        />
        <Metric
          icon={<HardDrive className="h-4 w-4" />}
          label="磁盘"
          series={[]}
          value={formatPercent(disk)}
        />
        <Metric
          icon={<Activity className="h-4 w-4" />}
          label="GPU"
          series={[]}
          value={serverGpuSummaryValue(snapshot.gpus ?? [])}
        />
      </div>
      <Section title="系统">
        <Info label="主机名" value={snapshot.hostname ?? snapshot.hostName} />
        <Info label="系统" value={snapshot.os ?? "-"} />
        <Info label="架构" value={snapshot.architecture ?? "-"} />
        <Info label="Kernel" value={snapshot.kernel ?? "-"} />
        <Info
          label="运行时间"
          value={formatUptime(snapshot.uptimeSeconds) ?? "-"}
        />
        <Info
          label="根分区"
          value={`${formatPercent(disk)} · ${formatBytes(snapshot.diskAvailableBytes)} 可用`}
        />
      </Section>
    </div>
  );
}

function Resources({
  history,
  snapshot,
  traffic,
}: {
  history: ServerInfoHistoryPoint[];
  snapshot: ServerInfoSnapshot;
  traffic: NetworkTrafficSnapshot;
}) {
  const [networkFilter, setNetworkFilter] =
    useState<NetworkInterfaceFilter>("primary");
  const visibleInterfaces = filterNetworkInterfaces(
    traffic.interfaces,
    networkFilter,
  );
  const cores = coreUsages(snapshot);
  return (
    <div className="space-y-3">
      <ResourceSection
        icon={<Cpu className="h-4 w-4" />}
        label="CPU"
        meter={snapshot.cpuUsagePercent ?? undefined}
        series={historySeries(history, "cpuPercent")}
        value={formatPercent(snapshot.cpuUsagePercent)}
      >
        <Info label="型号" value={snapshot.cpuModel ?? "-"} />
        <Info label="核心" value={`${snapshot.cpuCount ?? "-"} 核`} />
        <Info
          label="Load"
          value={
            formatLoadAverage(loadAverageValues(snapshot.loadAverage)) ?? "-"
          }
        />
        {cores.length > 0 ? (
          <div className="grid grid-cols-4 gap-x-3 gap-y-2 py-3">
            {cores.map((usage, index) => (
              <div className="min-w-0" key={index}>
                <div className="flex items-center justify-between gap-1 font-mono text-[10px]">
                  <span className="text-zinc-500">C{index}</span>
                  <span>{Math.round(usage)}%</span>
                </div>
                <Meter compact value={usage} />
              </div>
            ))}
          </div>
        ) : null}
      </ResourceSection>
      <Section
        icon={<Activity className="h-4 w-4" />}
        title="GPU"
        trailing={gpuCardHelper(snapshot, snapshot.gpus ?? [])}
      >
        {(snapshot.gpus ?? []).length === 0 ? (
          <p className="py-3 text-xs text-zinc-500">未发现可监控 GPU</p>
        ) : (
          (snapshot.gpus ?? []).map((gpu) => (
            <div className="border-b py-2.5 last:border-b-0" key={gpu.name}>
              <div className="truncate text-xs font-medium">{gpu.name}</div>
              <div className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                {gpuMemoryLabel(gpu)}
                {gpu.utilizationPercent != null
                  ? ` · ${formatPercent(gpu.utilizationPercent)}`
                  : " · 仅静态识别"}
              </div>
            </div>
          ))
        )}
      </Section>
      {shouldShowNpuCard(snapshot) ? (
        <Section
          icon={<CircuitBoard className="h-4 w-4" />}
          title="NPU"
          trailing={`${(snapshot.npus ?? []).length} 张加速卡`}
        >
          {(snapshot.npus ?? []).length === 0 ? (
            <p className="py-3 text-xs text-zinc-500 dark:text-zinc-400">
              npu-smi 未发现可监控 NPU
            </p>
          ) : (
            (snapshot.npus ?? []).map((npu) => (
              <div
                className="border-b py-2.5 last:border-b-0"
                key={`${npu.id}-${npu.chipId ?? "device"}`}
              >
                <div className="flex min-w-0 items-center justify-between gap-3">
                  <div className="truncate text-xs font-medium">
                    {npu.name}
                  </div>
                  <span className="shrink-0 font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
                    NPU {npu.id}
                  </span>
                </div>
                <div className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                  {npuMemoryLabel(npu)} · AICore {formatPercent(npu.utilizationPercent)}
                </div>
                <div className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                  {npu.health ?? "状态未知"}
                  {npu.temperatureCelsius != null
                    ? ` · ${npu.temperatureCelsius.toFixed(0)}°C`
                    : ""}
                  {npu.powerWatts != null
                    ? ` · ${npu.powerWatts.toFixed(1)} W`
                    : ""}
                </div>
                {npu.busId ? (
                  <div className="mt-1 truncate font-mono text-[10px] text-zinc-500 dark:text-zinc-400">
                    {npu.busId}
                  </div>
                ) : null}
              </div>
            ))
          )}
        </Section>
      ) : null}
      <ResourceSection
        icon={<MemoryStick className="h-4 w-4" />}
        label="内存"
        meter={percentOf(snapshot.memoryUsedBytes, snapshot.memoryTotalBytes)}
        series={historySeries(history, "memoryPercent")}
        value={`${formatBytes(snapshot.memoryUsedBytes)} / ${formatBytes(snapshot.memoryTotalBytes)}`}
      >
        <Info label="可用" value={formatBytes(snapshot.memoryAvailableBytes)} />
        <Info label="Cached" value={formatBytes(snapshot.memoryCachedBytes)} />
        <Info
          label="Swap"
          value={`${formatBytes(snapshot.swapUsedBytes)} / ${formatBytes(snapshot.swapTotalBytes)}`}
        />
      </ResourceSection>
      <Section icon={<Network className="h-4 w-4" />} title="网络接口">
        <div
          aria-label="网络接口筛选"
          className="kerminal-muted-surface mt-2 grid grid-cols-3 rounded-md border p-0.5"
          role="group"
        >
          {(
            [
              ["primary", "主要"],
              ["all", "全部"],
              ["virtual", "虚拟"],
            ] as const
          ).map(([value, label]) => (
            <button
              aria-pressed={networkFilter === value}
              className={cn(
                "kerminal-focus-ring kerminal-pressable rounded px-2 py-1 text-[11px] focus-visible:outline-none",
                networkFilter === value
                  ? "kerminal-solid-surface font-medium"
                  : "text-zinc-500 dark:text-zinc-400",
              )}
              key={value}
              onClick={() => setNetworkFilter(value)}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
        {visibleInterfaces.length === 0 ? (
          <p className="py-3 text-xs text-zinc-500">未返回网络接口数据</p>
        ) : (
          visibleInterfaces.map((item) => (
            <div
              className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-b py-2.5 last:border-b-0"
              key={item.name}
            >
              <span className="min-w-0 truncate text-xs font-medium">
                {item.name}
                <span className="ml-1.5 font-normal text-zinc-500 dark:text-zinc-400">
                  {networkInterfaceRoleLabel(item.role)}
                </span>
              </span>
              <span className="text-right font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
                ↓ {formatTrafficRate(item.rxBytesPerSecond, "采样中")} · ↑{" "}
                {formatTrafficRate(item.txBytesPerSecond, "采样中")}
              </span>
            </div>
          ))
        )}
      </Section>
      <Section icon={<HardDrive className="h-4 w-4" />} title="文件系统">
        {(snapshot.disks ?? []).map((disk) => (
          <Info
            key={`${disk.filesystem}-${disk.mount}`}
            label={disk.mount}
            value={`${formatBytes(disk.usedBytes)} / ${formatBytes(disk.totalBytes)}`}
          />
        ))}
      </Section>
    </div>
  );
}

function Processes({ snapshot }: { snapshot: ServerInfoSnapshot }) {
  const [sortBy, setSortBy] = useState<"cpu" | "memory">("cpu");
  const processes = [...(snapshot.topProcesses ?? [])].sort((left, right) =>
    sortBy === "cpu"
      ? (right.cpuUsagePercent ?? -1) - (left.cpuUsagePercent ?? -1)
      : (right.memoryBytes ?? -1) - (left.memoryBytes ?? -1),
  );
  return (
    <Section icon={<Activity className="h-4 w-4" />} title="进程">
      <div className="mb-2 text-xs text-zinc-500 dark:text-zinc-400">
        {formatProcessSummary(snapshot)}
      </div>
      {processes.length === 0 ? (
        <p className="py-4 text-center text-xs text-zinc-500">未返回进程排行</p>
      ) : (
        <>
          <div className="grid grid-cols-[minmax(0,1fr)_3.5rem_3.5rem] gap-2 border-b pb-1.5 text-[10px] text-zinc-500 dark:text-zinc-400">
            <span>进程</span>
            <button
              aria-pressed={sortBy === "cpu"}
              className={cn(
                "text-right",
                sortBy === "cpu" &&
                  "font-semibold text-zinc-900 dark:text-zinc-100",
              )}
              onClick={() => setSortBy("cpu")}
              type="button"
            >
              CPU
            </button>
            <button
              aria-pressed={sortBy === "memory"}
              className={cn(
                "text-right",
                sortBy === "memory" &&
                  "font-semibold text-zinc-900 dark:text-zinc-100",
              )}
              onClick={() => setSortBy("memory")}
              type="button"
            >
              内存
            </button>
          </div>
          {processes.map((process) => (
            <div
              className="grid grid-cols-[minmax(0,1fr)_3.5rem_3.5rem] items-center gap-2 border-b py-2.5 last:border-b-0"
              key={`${process.pid}-${process.name}`}
            >
              <div className="min-w-0">
                <div className="truncate text-xs font-medium">
                  {process.name}
                </div>
                <div className="font-mono text-[10px] text-zinc-500">
                  PID {process.pid}
                </div>
              </div>
              <span className="text-right font-mono text-[11px]">
                {formatPercent(process.cpuUsagePercent)}
              </span>
              <span className="text-right font-mono text-[11px]">
                {formatBytes(process.memoryBytes)}
              </span>
            </div>
          ))}
        </>
      )}
    </Section>
  );
}

function Metric({
  icon,
  label,
  series,
  value,
}: {
  icon: ReactNode;
  label: string;
  series: number[];
  value: string;
}) {
  return (
    <div className="kerminal-solid-surface min-w-0 p-3">
      <div className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
        {icon}
        <span>{label}</span>
      </div>
      <div className="mt-2 truncate text-base font-semibold tabular-nums">
        {value}
      </div>
      <Sparkline values={series} />
    </div>
  );
}

function ResourceSection({
  children,
  icon,
  label,
  meter,
  series,
  value,
}: {
  children: ReactNode;
  icon: ReactNode;
  label: string;
  meter?: number;
  series: number[];
  value: string;
}) {
  return (
    <Section icon={icon} title={label} trailing={value}>
      <Meter value={meter} />
      <Sparkline values={series} />
      {children}
    </Section>
  );
}

function Section({
  children,
  icon,
  title,
  trailing,
}: {
  children: ReactNode;
  icon?: ReactNode;
  title: string;
  trailing?: string;
}) {
  return (
    <section className="kerminal-solid-surface rounded-[var(--radius-card)] border px-3 py-2.5">
      <div className="flex items-center justify-between gap-3 border-b pb-2">
        <h3 className="flex min-w-0 items-center gap-2 text-xs font-semibold">
          {icon}
          <span className="truncate">{title}</span>
        </h3>
        {trailing ? (
          <span className="truncate text-xs font-semibold tabular-nums">
            {trailing}
          </span>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-3 border-b py-2 text-xs last:border-b-0">
      <span
        className="min-w-0 truncate text-zinc-500 dark:text-zinc-400"
        title={label}
      >
        {label}
      </span>
      <span className="shrink-0 whitespace-nowrap text-right">{value}</span>
    </div>
  );
}

function Meter({
  compact = false,
  value,
}: {
  compact?: boolean;
  value?: number;
}) {
  const normalized = value == null ? 0 : Math.max(0, Math.min(100, value));
  return (
    <div
      aria-label="资源使用率"
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={Math.round(normalized)}
      className={cn(
        "overflow-hidden rounded-full bg-[var(--surface-hover)]",
        compact ? "mt-1 h-1" : "mt-3 h-1.5",
      )}
      role="progressbar"
    >
      <div
        className="h-full rounded-full bg-[rgb(var(--app-accent))]"
        style={{ width: `${normalized}%` }}
      />
    </div>
  );
}

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) {
    return (
      <div className="mt-2 h-7 border-b border-dashed border-[var(--border-subtle)]" />
    );
  }
  const max = Math.max(...values, 1);
  const points = values
    .map(
      (value, index) =>
        `${(index / (values.length - 1)) * 100},${28 - (value / max) * 24}`,
    )
    .join(" ");
  return (
    <svg
      aria-hidden="true"
      className="mt-2 h-7 w-full text-[rgb(var(--app-accent))]"
      preserveAspectRatio="none"
      viewBox="0 0 100 28"
    >
      <polyline
        fill="none"
        points={points}
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function StatusDot({ status }: { status: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "h-2 w-2 shrink-0 rounded-full",
        status === "live" && "bg-emerald-500",
        status === "error" && "bg-red-500",
        (status === "paused" || status === "stale") && "bg-amber-500",
        (status === "baseline" || status === "idle") && "bg-zinc-400",
      )}
    />
  );
}

function EmptyState({ loading }: { loading: boolean }) {
  return (
    <div className="kerminal-solid-surface rounded-[var(--radius-card)] border px-4 py-10 text-center text-sm text-zinc-500 dark:text-zinc-400">
      {loading ? "正在读取系统信息..." : "暂无系统信息"}
    </div>
  );
}
