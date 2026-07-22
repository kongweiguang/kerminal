import type { SnippetShell } from "./snippetTargetPolicy";

type SnippetVariableKind =
  | "text"
  | "path"
  | "port"
  | "integer"
  | "host"
  | "url"
  | "service"
  | "container"
  | "enum"
  | "secret"
  | "raw";
type SnippetRenderStrategy = "shellArg" | "validatedRaw" | "literal";

export interface SnippetVariableDefinition {
  name: string;
  label: string;
  description?: string;
  kind: SnippetVariableKind;
  required: boolean;
  defaultValue?: string;
  suggestions?: readonly string[];
  validation?: string;
  renderStrategy: SnippetRenderStrategy;
  sensitive?: boolean;
}

export interface SnippetRenderPlan {
  command: string;
  containsSensitiveValue: boolean;
  legacyRaw: boolean;
  variableNames: readonly string[];
}

export class SnippetVariableError extends Error {
  constructor(
    readonly variableName: string,
    readonly reason:
      | "missing"
      | "invalid"
      | "unsupported-shell"
      | "undeclared"
      | "unused",
  ) {
    super(`片段变量 ${variableName} 无法渲染：${reason}`);
    this.name = "SnippetVariableError";
  }
}

const PLACEHOLDER = /\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g;
const SAFE_UNKNOWN_SHELL_ARG = /^[A-Za-z0-9_@%+=:,./-]+$/u;
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9_.:@/-]*$/u;
const SAFE_HOST = /^(?:[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?|\[[0-9A-Fa-f:]+\])$/u;
const MAX_VARIABLE_VALUE_CHARS = 4_096;
const MAX_VALIDATION_PATTERN_CHARS = 128;

/** 校验变量合同并生成不带执行副作用的命令渲染计划。 */
export function renderSnippetTemplate({
  template,
  variables,
  values,
  shell,
}: {
  template: string;
  variables: readonly SnippetVariableDefinition[];
  values: Readonly<Record<string, string | undefined>>;
  shell: SnippetShell;
}): SnippetRenderPlan {
  const placeholders = Array.from(template.matchAll(PLACEHOLDER), (match) => match[1]);
  const referenced = new Set(placeholders);
  const definitions = new Map<string, SnippetVariableDefinition>();
  for (const variable of variables) {
    if (definitions.has(variable.name)) throw new SnippetVariableError(variable.name, "invalid");
    definitions.set(variable.name, variable);
    if (!referenced.has(variable.name)) throw new SnippetVariableError(variable.name, "unused");
  }
  for (const name of referenced) {
    if (!definitions.has(name)) throw new SnippetVariableError(name, "undeclared");
  }

  let containsSensitiveValue = false;
  let legacyRaw = false;
  const rendered = new Map<string, string>();
  for (const name of referenced) {
    const variable = definitions.get(name)!;
    const value = values[name] ?? variable.defaultValue ?? "";
    if (variable.required && !value) throw new SnippetVariableError(name, "missing");
    validateValue(variable, value);
    containsSensitiveValue ||= Boolean((variable.sensitive || variable.kind === "secret") && value);
    legacyRaw ||= variable.kind === "raw" || variable.renderStrategy === "literal";
    rendered.set(name, renderValue(variable, value, shell));
  }

  return {
    command: template.replace(PLACEHOLDER, (_placeholder, name: string) => rendered.get(name) ?? ""),
    containsSensitiveValue,
    legacyRaw,
    variableNames: [...referenced],
  };
}

function validateValue(variable: SnippetVariableDefinition, value: string): void {
  if (!value && !variable.required) return;
  if (value.length > MAX_VARIABLE_VALUE_CHARS || /[\0\r\n]/u.test(value)) {
    throw new SnippetVariableError(variable.name, "invalid");
  }
  let valid: boolean;
  switch (variable.kind) {
    case "port": {
      const port = Number(value);
      valid = /^\d+$/u.test(value) && port >= 1 && port <= 65535;
      break;
    }
    case "integer":
      valid = /^-?\d+$/u.test(value);
      break;
    case "host":
      valid = SAFE_HOST.test(value);
      break;
    case "url": {
      try {
        const url = new URL(value);
        valid = url.protocol === "http:" || url.protocol === "https:";
      } catch {
        valid = false;
      }
      break;
    }
    case "service":
    case "container":
      valid = SAFE_NAME.test(value);
      break;
    case "enum":
      valid = Boolean(variable.suggestions?.includes(value));
      break;
    default:
      valid = true;
  }
  if (valid && variable.validation) {
    if (!isSafeValidationPattern(variable.validation)) {
      throw new SnippetVariableError(variable.name, "invalid");
    }
    try {
      valid = new RegExp(`^(?:${variable.validation})$`, "u").test(value);
    } catch {
      valid = false;
    }
  }
  if (!valid) throw new SnippetVariableError(variable.name, "invalid");
}

/** 只允许无分组、无分支和无反向引用的短正则子集，避免同步渲染发生灾难性回溯。 */
export function isSafeValidationPattern(pattern: string): boolean {
  return (
    pattern.length <= MAX_VALIDATION_PATTERN_CHARS &&
    !/[(){}|\r\n]/u.test(pattern) &&
    !/\\[1-9]/u.test(pattern) &&
    !pattern.includes("(?")
  );
}

function renderValue(
  variable: SnippetVariableDefinition,
  value: string,
  shell: SnippetShell,
): string {
  if (variable.renderStrategy === "validatedRaw") {
    if (!["port", "integer", "host", "service", "container", "enum"].includes(variable.kind)) {
      throw new SnippetVariableError(variable.name, "invalid");
    }
    return value;
  }
  if (variable.renderStrategy === "literal") return value;
  if (shell === "posix") return `'${value.replace(/'/g, `'"'"'`)}'`;
  if (shell === "powershell") return `'${value.replace(/'/g, "''")}'`;
  if (shell === "cmd") return quoteCmdArgument(variable.name, value);
  if (SAFE_UNKNOWN_SHELL_ARG.test(value)) return value;
  throw new SnippetVariableError(variable.name, "unsupported-shell");
}

function quoteCmdArgument(name: string, value: string): string {
  if (/[&|<>^%!\r\n\0]/u.test(value)) throw new SnippetVariableError(name, "invalid");
  return `"${value.replace(/(\\*)"/g, "$1$1\\\"").replace(/(\\+)$/g, "$1$1")}"`;
}
