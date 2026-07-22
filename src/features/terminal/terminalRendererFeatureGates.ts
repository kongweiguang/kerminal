export interface TerminalRendererFeatureGates {
  adaptiveOutputScheduler: boolean;
  healthWatchdog: boolean;
  lifecycleV2: boolean;
  performanceTelemetry: boolean;
  privateCleanupCompat: boolean;
}

export const DEFAULT_TERMINAL_RENDERER_FEATURE_GATES: Readonly<TerminalRendererFeatureGates> =
  Object.freeze({
    adaptiveOutputScheduler: true,
    healthWatchdog: true,
    lifecycleV2: true,
    performanceTelemetry: true,
    privateCleanupCompat: false,
  });

export const TERMINAL_RENDERER_FEATURE_GATES_STORAGE_KEY =
  "kerminal.terminal.renderer.feature-gates";

interface TerminalRendererFeatureGateStorage {
  getItem(key: string): string | null;
}

interface ResolveRuntimeTerminalRendererFeatureGatesOptions {
  env?: Record<string, string | boolean | undefined>;
  storage?: TerminalRendererFeatureGateStorage | null;
}

/**
 * 解析 renderer 灰度开关。
 *
 * lifecycle V2 关闭时 GPU attach 会被禁止并稳定使用 CPU，作为无需数据迁移的
 * 紧急回滚路径；其它 gate 可独立关闭，不改变 terminal/session 契约。
 */
export function resolveTerminalRendererFeatureGates(
  overrides: Partial<TerminalRendererFeatureGates> = {},
): TerminalRendererFeatureGates {
  return {
    ...DEFAULT_TERMINAL_RENDERER_FEATURE_GATES,
    ...overrides,
  };
}

/**
 * 解析生产运行时 gate。
 *
 * `VITE_TERMINAL_RENDERER_*` 提供构建/发布默认值；localStorage JSON 提供
 * 无需重新构建的本机紧急回滚入口，修改后重启应用生效。
 */
export function resolveRuntimeTerminalRendererFeatureGates({
  env = import.meta.env,
  storage = readBrowserStorage(),
}: ResolveRuntimeTerminalRendererFeatureGatesOptions = {}): TerminalRendererFeatureGates {
  return resolveTerminalRendererFeatureGates({
    ...readEnvironmentOverrides(env),
    ...readStorageOverrides(storage),
  });
}

function readEnvironmentOverrides(
  env: Record<string, string | boolean | undefined>,
): Partial<TerminalRendererFeatureGates> {
  return compactBooleanOverrides({
    adaptiveOutputScheduler: readBoolean(
      env.VITE_TERMINAL_ADAPTIVE_OUTPUT_SCHEDULER,
    ),
    healthWatchdog: readBoolean(env.VITE_TERMINAL_RENDERER_HEALTH_WATCHDOG),
    lifecycleV2: readBoolean(env.VITE_TERMINAL_RENDERER_LIFECYCLE_V2),
    performanceTelemetry: readBoolean(
      env.VITE_TERMINAL_RENDERER_PERFORMANCE_TELEMETRY,
    ),
    privateCleanupCompat: readBoolean(
      env.VITE_TERMINAL_RENDERER_PRIVATE_CLEANUP_COMPAT,
    ),
  });
}

function readStorageOverrides(
  storage: TerminalRendererFeatureGateStorage | null,
): Partial<TerminalRendererFeatureGates> {
  if (!storage) {
    return {};
  }
  try {
    const raw = storage.getItem(TERMINAL_RENDERER_FEATURE_GATES_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return compactBooleanOverrides({
      adaptiveOutputScheduler: readBoolean(parsed.adaptiveOutputScheduler),
      healthWatchdog: readBoolean(parsed.healthWatchdog),
      lifecycleV2: readBoolean(parsed.lifecycleV2),
      performanceTelemetry: readBoolean(parsed.performanceTelemetry),
      privateCleanupCompat: readBoolean(parsed.privateCleanupCompat),
    });
  } catch {
    return {};
  }
}

function compactBooleanOverrides(
  values: Partial<Record<keyof TerminalRendererFeatureGates, boolean | undefined>>,
): Partial<TerminalRendererFeatureGates> {
  return Object.fromEntries(
    Object.entries(values).filter((entry) => entry[1] !== undefined),
  ) as Partial<TerminalRendererFeatureGates>;
}

function readBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1") {
    return true;
  }
  if (normalized === "false" || normalized === "0") {
    return false;
  }
  return undefined;
}

function readBrowserStorage(): TerminalRendererFeatureGateStorage | null {
  try {
    return typeof globalThis.localStorage === "undefined"
      ? null
      : globalThis.localStorage;
  } catch {
    return null;
  }
}
