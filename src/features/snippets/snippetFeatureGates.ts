export interface SnippetFeatureGates {
  snippetCatalogV2: boolean;
  snippetPanelV2: boolean;
}

export const DEFAULT_SNIPPET_FEATURE_GATES: Readonly<SnippetFeatureGates> =
  Object.freeze({
    snippetCatalogV2: true,
    snippetPanelV2: true,
  });

export const SNIPPET_FEATURE_GATES_STORAGE_KEY =
  "kerminal.internal.snippets.feature-gates";

interface SnippetFeatureGateStorage {
  getItem(key: string): string | null;
}

interface ResolveRuntimeSnippetFeatureGatesOptions {
  env?: Record<string, string | boolean | undefined>;
  storage?: SnippetFeatureGateStorage | null;
}

/**
 * 解析片段 V2 的内部回滚开关。
 *
 * 两个开关默认开启，不进入普通设置合同；发布环境或本机紧急回滚入口可独立
 * 关闭 catalog 与 panel，从而在不迁移用户配置的前提下恢复旧实现。
 */
export function resolveSnippetFeatureGates(
  overrides: Partial<SnippetFeatureGates> = {},
): SnippetFeatureGates {
  return {
    ...DEFAULT_SNIPPET_FEATURE_GATES,
    ...overrides,
  };
}

/** 只有目录与面板同时启用时才允许产生 V2 深链和 snippet suggestion。 */
export function snippetV2NavigationEnabled(gates: SnippetFeatureGates): boolean {
  return gates.snippetCatalogV2 && gates.snippetPanelV2;
}

/** 读取构建环境和内部 localStorage 覆盖，本机覆盖优先。 */
export function resolveRuntimeSnippetFeatureGates({
  env = import.meta.env,
  storage = readBrowserStorage(),
}: ResolveRuntimeSnippetFeatureGatesOptions = {}): SnippetFeatureGates {
  return resolveSnippetFeatureGates({
    ...readEnvironmentOverrides(env),
    ...readStorageOverrides(storage),
  });
}

function readEnvironmentOverrides(
  env: Record<string, string | boolean | undefined>,
): Partial<SnippetFeatureGates> {
  return compactBooleanOverrides({
    snippetCatalogV2: readBoolean(env.VITE_INTERNAL_SNIPPET_CATALOG_V2),
    snippetPanelV2: readBoolean(env.VITE_INTERNAL_SNIPPET_PANEL_V2),
  });
}

function readStorageOverrides(
  storage: SnippetFeatureGateStorage | null,
): Partial<SnippetFeatureGates> {
  if (!storage) {
    return {};
  }
  try {
    const raw = storage.getItem(SNIPPET_FEATURE_GATES_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return compactBooleanOverrides({
      snippetCatalogV2: readBoolean(parsed.snippetCatalogV2),
      snippetPanelV2: readBoolean(parsed.snippetPanelV2),
    });
  } catch {
    return {};
  }
}

function compactBooleanOverrides(
  values: Partial<Record<keyof SnippetFeatureGates, boolean | undefined>>,
): Partial<SnippetFeatureGates> {
  return Object.fromEntries(
    Object.entries(values).filter((entry) => entry[1] !== undefined),
  ) as Partial<SnippetFeatureGates>;
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

function readBrowserStorage(): SnippetFeatureGateStorage | null {
  try {
    return typeof globalThis.localStorage === "undefined"
      ? null
      : globalThis.localStorage;
  } catch {
    return null;
  }
}
