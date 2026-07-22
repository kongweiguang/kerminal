/**
 * 跨运行时兼容清单、脱敏指标与启用门禁。
 *
 * @author kongweiguang
 */

import registryManifest from "./registry.json";

type CompatibilityCategory =
  | "diagnostic-policy"
  | "preview-adapter"
  | "runtime-fallback"
  | "runtime-patch"
  | "schema-compatibility"
  | "semantic-compatibility"
  | "startup-recovery";

type CompatibilityLifecycle =
  | "governance"
  | "sunset"
  | "supported-mode";

export interface CompatibilityEntry {
  readonly allowedReasons: readonly string[];
  readonly category: CompatibilityCategory;
  readonly id: string;
  readonly implementationRefs: readonly string[];
  readonly lifecycle: CompatibilityLifecycle;
  readonly owner: string;
  readonly retirement?: {
    readonly minimumZeroWindows: number;
    readonly reviewBy: string;
    readonly targetTask: string;
  };
}

export interface CompatibilityMetricInput {
  readonly activationCount: number;
  readonly failureCount: number;
  readonly id: string;
  /** 调用方标签不进入公开快照，防止路径、错误和 secret 旁路泄漏。 */
  readonly labels?: Readonly<Record<string, unknown>>;
}

export interface CompatibilityMetricSnapshot {
  readonly entries: readonly {
    readonly activationCount: number;
    readonly category: CompatibilityCategory;
    readonly failureCount: number;
    readonly id: string;
    readonly lifecycle: CompatibilityLifecycle;
  }[];
  readonly schemaVersion: 1;
}

export const SILENT_CATCH_DIAGNOSTICS_POLICY = Object.freeze({
  allowedDispositions: [
    "aggregate-counter",
    "best-effort-ignore",
    "user-visible",
  ] as const,
  forbiddenPayloads: [
    "error-message",
    "filesystem-path",
    "host-identity",
    "secret",
  ] as const,
  rule:
    "静默 catch 必须声明处置方式；仅允许稳定计数和枚举原因进入诊断，不记录异常正文、路径或凭据。",
});

export const compatibilityRegistry: readonly CompatibilityEntry[] =
  Object.freeze(
    registryManifest.entries.map((entry) =>
      Object.freeze({
        ...entry,
        allowedReasons: Object.freeze([...entry.allowedReasons]),
        implementationRefs: Object.freeze([...entry.implementationRefs]),
      }),
    ),
  ) as readonly CompatibilityEntry[];

export function validateCompatibilityRegistry(
  entries: readonly CompatibilityEntry[],
): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  const categories = new Set<CompatibilityCategory>([
    "diagnostic-policy",
    "preview-adapter",
    "runtime-fallback",
    "runtime-patch",
    "schema-compatibility",
    "semantic-compatibility",
    "startup-recovery",
  ]);
  const lifecycles = new Set<CompatibilityLifecycle>([
    "governance",
    "sunset",
    "supported-mode",
  ]);
  for (const entry of entries) {
    if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(entry.id)) {
      errors.push("存在格式不合法的兼容项 ID");
    }
    if (ids.has(entry.id)) errors.push("存在重复兼容项 ID");
    ids.add(entry.id);
    if (!entry.owner.trim()) errors.push("兼容项缺少 owner");
    if (!categories.has(entry.category) || !lifecycles.has(entry.lifecycle)) {
      errors.push("兼容项分类或生命周期无效");
    }
    if (
      entry.allowedReasons.length === 0 ||
      entry.allowedReasons.some(
        (reason) => !/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(reason),
      )
    ) {
      errors.push("兼容项缺少启用原因或原因格式无效");
    } else if (
      new Set(entry.allowedReasons).size !== entry.allowedReasons.length
    ) {
      errors.push("兼容项启用原因重复");
    }
    if (entry.implementationRefs.length === 0) {
      errors.push("兼容项缺少实现引用");
    }
    if (entry.lifecycle === "sunset") {
      if (
        !entry.retirement?.targetTask.trim() ||
        !/^\d{4}-\d{2}-\d{2}$/.test(entry.retirement.reviewBy) ||
        entry.retirement.minimumZeroWindows < 1
      ) {
        errors.push("待退役兼容项缺少完整门禁");
      }
    } else if (entry.retirement) {
      errors.push("长期支持兼容项不得声明退役任务");
    }
  }
  return errors;
}

export function evaluateCompatibilityActivation(id: string, reason: string) {
  const entry = requireEntry(id);
  const allowed = entry.allowedReasons.includes(reason);
  return {
    allowed,
    code: allowed ? "allowed-by-registry" : "reason-not-registered",
  } as const;
}

export function buildCompatibilityMetricSnapshot(
  metrics: readonly CompatibilityMetricInput[],
): CompatibilityMetricSnapshot {
  const aggregates = new Map<
    string,
    { activationCount: number; failureCount: number }
  >();
  for (const metric of metrics) {
    requireEntry(metric.id);
    const current = aggregates.get(metric.id) ?? {
      activationCount: 0,
      failureCount: 0,
    };
    current.activationCount = addCount(current.activationCount, metric.activationCount);
    current.failureCount = addCount(current.failureCount, metric.failureCount);
    aggregates.set(metric.id, current);
  }

  return {
    entries: [...aggregates.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([id, metric]) => {
        const entry = requireEntry(id);
        return {
          activationCount: metric.activationCount,
          category: entry.category,
          failureCount: metric.failureCount,
          id,
          lifecycle: entry.lifecycle,
        };
      }),
    schemaVersion: 1,
  };
}

function requireEntry(id: string): CompatibilityEntry {
  const entry = compatibilityRegistry.find((candidate) => candidate.id === id);
  if (!entry) throw new Error("兼容项未登记");
  return entry;
}

function addCount(current: number, next: number): number {
  const normalized = Number.isFinite(next) ? Math.max(0, Math.floor(next)) : 0;
  return Math.min(Number.MAX_SAFE_INTEGER, current + normalized);
}
