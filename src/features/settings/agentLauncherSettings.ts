// @author kongweiguang

export const BUILTIN_CODEX_AGENT_KEY = "builtin:codex";
export const BUILTIN_CLAUDE_AGENT_KEY = "builtin:claude";
export const BUILTIN_PI_AGENT_KEY = "builtin:pi";
export const CUSTOM_AGENT_LIMIT = 32;
export const CUSTOM_AGENT_NAME_LIMIT = 64;
export const CUSTOM_AGENT_COMMAND_LIMIT = 4096;
const CUSTOM_AGENT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CustomAgentDefinition {
  id: string;
  name: string;
  command: string;
}

export interface AgentLauncherSettings {
  selectedAgentKey: string;
  customAgents: CustomAgentDefinition[];
}

/** Agent 启动器默认选择内置 Codex，避免旧 settings.toml 升级后出现无效空选择。 */
export const defaultAgentLauncherSettings: AgentLauncherSettings = {
  customAgents: [],
  selectedAgentKey: BUILTIN_CODEX_AGENT_KEY,
};

/** 使用统一前缀构造持久选择键，避免 UI、session 和 settings 各自拼接。 */
export function customAgentLauncherKey(id: string): string {
  return `custom:${id.trim().toLowerCase()}`;
}

/** 自定义定义使用 UUID 作为稳定身份；名称和命令编辑不会改变会话归属。 */
export function isCustomAgentDefinitionId(value: string): boolean {
  return CUSTOM_AGENT_ID_PATTERN.test(value.trim());
}

/**
 * 对读取到的 Agent 定义做容错归一化；损坏、重复或越界条目会被隔离，避免一个
 * 非法自定义命令阻断整份 settings 恢复。
 */
export function normalizeAgentLauncherSettings(
  settings?: Partial<AgentLauncherSettings>,
): AgentLauncherSettings {
  const customAgents: CustomAgentDefinition[] = [];
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();
  const candidates = Array.isArray(settings?.customAgents)
    ? settings.customAgents
    : defaultAgentLauncherSettings.customAgents;

  for (const candidate of candidates.slice(0, CUSTOM_AGENT_LIMIT)) {
    if (!candidate) {
      continue;
    }
    const rawId = typeof candidate.id === "string" ? candidate.id.trim() : "";
    const id = rawId.toLowerCase();
    const name =
      typeof candidate.name === "string" ? candidate.name.trim() : "";
    const command =
      typeof candidate.command === "string" ? candidate.command.trim() : "";
    const normalizedName = name.toLowerCase();
    if (
      !isCustomAgentDefinitionId(rawId) ||
      !name ||
      !command ||
      unicodeLength(name) > CUSTOM_AGENT_NAME_LIMIT ||
      unicodeLength(command) > CUSTOM_AGENT_COMMAND_LIMIT ||
      seenIds.has(id) ||
      seenNames.has(normalizedName)
    ) {
      continue;
    }
    seenIds.add(id);
    seenNames.add(normalizedName);
    customAgents.push({ command, id, name });
  }

  const selectedAgentKey = normalizeSelectedAgentKey(
    settings?.selectedAgentKey,
    customAgents,
  );
  return { customAgents, selectedAgentKey };
}

/** 只接受内置 key 或当前仍存在的 Custom key；定义被删除时原子回退 Codex。 */
function normalizeSelectedAgentKey(
  value: string | undefined,
  customAgents: readonly CustomAgentDefinition[],
): string {
  const normalized = value?.trim();
  if (
    normalized === BUILTIN_CODEX_AGENT_KEY ||
    normalized === BUILTIN_CLAUDE_AGENT_KEY ||
    normalized === BUILTIN_PI_AGENT_KEY
  ) {
    return normalized;
  }
  if (normalized?.startsWith("custom:")) {
    const customKey = customAgentLauncherKey(normalized.slice("custom:".length));
    if (
      customAgents.some((agent) => customAgentLauncherKey(agent.id) === customKey)
    ) {
      return customKey;
    }
  }
  return defaultAgentLauncherSettings.selectedAgentKey;
}

/** Rust 使用 chars().count() 校验；前端按 Unicode code point 计数以保持边界一致。 */
function unicodeLength(value: string): number {
  return [...value].length;
}
