// @author kongweiguang

import { parseAgentCommandLine } from "../../../lib/agentCommandLine";
import {
  BUILTIN_CLAUDE_AGENT_KEY,
  BUILTIN_CODEX_AGENT_KEY,
  BUILTIN_PI_AGENT_KEY,
  CUSTOM_AGENT_COMMAND_LIMIT,
  CUSTOM_AGENT_LIMIT,
  CUSTOM_AGENT_NAME_LIMIT,
  customAgentLauncherKey,
  isCustomAgentDefinitionId,
  type AgentLauncherSettings,
  type CustomAgentDefinition,
} from "../../settings/contracts/index";
import type { ExternalAgentId } from "../../../lib/agentLauncherApi";

export interface CustomAgentMutationInput {
  id?: string;
  name: string;
  command: string;
}

export interface AgentLauncherDescriptor {
  agentId: ExternalAgentId;
  customCommand?: string;
  launcherKey: string;
  title: string;
}

export class AgentLauncherSettingsValidationError extends Error {
  /** 仅标记可安全直显的输入错误，IPC/IO 异常仍走统一脱敏摘要。 */
  constructor(message: string) {
    super(message);
    this.name = "AgentLauncherSettingsValidationError";
  }
}

/** 把持久选择解析成启动快照；Custom 返回当前定义，历史会话则由恢复模型另行解析。 */
export function resolveAgentLauncherDescriptor(
  settings: AgentLauncherSettings,
  launcherKey: string = settings.selectedAgentKey,
): AgentLauncherDescriptor | null {
  if (launcherKey === BUILTIN_CODEX_AGENT_KEY) {
    return {
      agentId: "codex",
      launcherKey,
      title: "Codex",
    };
  }
  if (launcherKey === BUILTIN_CLAUDE_AGENT_KEY) {
    return {
      agentId: "claude",
      launcherKey,
      title: "Claude",
    };
  }
  if (launcherKey === BUILTIN_PI_AGENT_KEY) {
    return {
      agentId: "pi",
      launcherKey,
      title: "PI Agent",
    };
  }
  const customAgent = settings.customAgents.find(
    (agent) => customAgentLauncherKey(agent.id) === launcherKey,
  );
  return customAgent
    ? {
        agentId: "custom",
        customCommand: customAgent.command,
        launcherKey,
        title: customAgent.name,
      }
    : null;
}

/** 选择只能指向现有条目，阻止过期 Custom key 被写回 settings。 */
export function selectAgentLauncher(
  settings: AgentLauncherSettings,
  launcherKey: string,
): AgentLauncherSettings {
  if (!resolveAgentLauncherDescriptor(settings, launcherKey)) {
    throw new AgentLauncherSettingsValidationError(
      "选择的 Agent 已不存在，请刷新列表后重试。",
    );
  }
  return {
    ...settings,
    selectedAgentKey: launcherKey,
  };
}

/**
 * 新增和编辑共用同一条严格校验路径；编辑保留稳定 UUID，新增达到上限时拒绝，
 * 从而让已创建会话继续按 launcherKey 隔离。
 */
export function saveCustomAgentDefinition(
  settings: AgentLauncherSettings,
  input: CustomAgentMutationInput,
  createId: () => string = createCustomAgentId,
): AgentLauncherSettings {
  const name = input.name.trim();
  const command = input.command.trim();
  validateCustomAgentFields(name, command);

  const editingId = input.id?.trim().toLowerCase();
  const existingIndex = editingId
    ? settings.customAgents.findIndex((agent) => agent.id === editingId)
    : -1;
  if (editingId && existingIndex < 0) {
    throw new AgentLauncherSettingsValidationError(
      "要编辑的 Agent 已不存在，请刷新列表后重试。",
    );
  }
  if (!editingId && settings.customAgents.length >= CUSTOM_AGENT_LIMIT) {
    throw new AgentLauncherSettingsValidationError(
      `最多保存 ${CUSTOM_AGENT_LIMIT} 个自定义 Agent。`,
    );
  }
  const duplicateName = settings.customAgents.some(
    (agent) =>
      agent.id !== editingId && agent.name.trim().toLowerCase() === name.toLowerCase(),
  );
  if (duplicateName) {
    throw new AgentLauncherSettingsValidationError(
      "Agent 名称已存在，请换一个名称。",
    );
  }

  const id = editingId ?? createId().trim().toLowerCase();
  if (!isCustomAgentDefinitionId(id)) {
    throw new AgentLauncherSettingsValidationError(
      "无法生成有效的 Agent 标识，请重试。",
    );
  }
  if (!editingId && settings.customAgents.some((agent) => agent.id === id)) {
    throw new AgentLauncherSettingsValidationError(
      "Agent 标识冲突，请重试。",
    );
  }
  const definition: CustomAgentDefinition = { command, id, name };
  const customAgents = [...settings.customAgents];
  if (existingIndex >= 0) {
    customAgents[existingIndex] = definition;
  } else {
    customAgents.push(definition);
  }
  return {
    customAgents,
    selectedAgentKey: customAgentLauncherKey(id),
  };
}

/** 删除定义只改变下拉列表；若删除当前选择则同一次保存回退 Codex。 */
export function deleteCustomAgentDefinition(
  settings: AgentLauncherSettings,
  id: string,
): AgentLauncherSettings {
  const normalizedId = id.trim().toLowerCase();
  if (!settings.customAgents.some((agent) => agent.id === normalizedId)) {
    throw new AgentLauncherSettingsValidationError(
      "要删除的 Agent 已不存在，请刷新列表后重试。",
    );
  }
  const deletedKey = customAgentLauncherKey(normalizedId);
  return {
    customAgents: settings.customAgents.filter(
      (agent) => agent.id !== normalizedId,
    ),
    selectedAgentKey:
      settings.selectedAgentKey === deletedKey
        ? BUILTIN_CODEX_AGENT_KEY
        : settings.selectedAgentKey,
  };
}

/** 普通列表仅显示可执行文件名，不泄漏自定义命令的参数和潜在敏感片段。 */
export function customAgentExecutableName(command: string): string {
  const shell = parseAgentCommandLine(command)?.shell.trim();
  if (!shell) {
    return "自定义命令";
  }
  return shell.split(/[\\/]/).pop() || shell;
}

/** 校验用户输入时拒绝截断，避免 UI 展示值和真正持久化命令不一致。 */
function validateCustomAgentFields(name: string, command: string): void {
  if (!name) {
    throw new AgentLauncherSettingsValidationError("请输入 Agent 名称。");
  }
  if (unicodeLength(name) > CUSTOM_AGENT_NAME_LIMIT) {
    throw new AgentLauncherSettingsValidationError(
      `Agent 名称不能超过 ${CUSTOM_AGENT_NAME_LIMIT} 个字符。`,
    );
  }
  if (!command) {
    throw new AgentLauncherSettingsValidationError("请输入 Agent 启动命令。");
  }
  if (unicodeLength(command) > CUSTOM_AGENT_COMMAND_LIMIT) {
    throw new AgentLauncherSettingsValidationError(
      `启动命令不能超过 ${CUSTOM_AGENT_COMMAND_LIMIT} 个字符。`,
    );
  }
}

/** 与 Rust chars().count() 对齐，emoji 等代理对只计算为一个字符。 */
function unicodeLength(value: string): number {
  return [...value].length;
}

/** 浏览器和 Tauri WebView 均提供 crypto.randomUUID，用它生成不可变定义身份。 */
function createCustomAgentId(): string {
  return globalThis.crypto.randomUUID();
}
