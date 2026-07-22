import type {
  CommandSnippet,
  SnippetCatalogVariable,
  SnippetContextBinding,
  SnippetDefaultAction,
  SnippetRisk,
  SnippetScope,
} from "../../lib/snippetApi";
import { scanSnippetSensitiveLiterals } from "./snippetSensitiveScan";
import { isSafeValidationPattern } from "./snippetTemplate";

const MAX_IMPORT_ITEMS = 500;

interface SnippetTransferCandidate {
  title: string;
  command: string;
  description: string;
  tags: string[];
  scope: SnippetScope;
  category: string;
  risk: SnippetRisk;
  defaultAction: SnippetDefaultAction;
  variables: SnippetCatalogVariable[];
  contextBindings: SnippetContextBinding[];
  derivedFrom?: string;
}

export interface SnippetImportDryRun {
  candidates: SnippetTransferCandidate[];
  errors: string[];
}

/** 导出只包含文件配置字段，不包含收藏、使用次数、目标或变量运行值。 */
export function serializeSnippetExport(snippets: readonly CommandSnippet[]): string {
  return JSON.stringify(
    {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      snippets: snippets.map(toCandidate),
    },
    null,
    2,
  );
}

/** 导入先完成结构、数量和敏感字面量检查；不写文件。 */
export function dryRunSnippetImport(source: string): SnippetImportDryRun {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    return { candidates: [], errors: ["导入文件不是有效 JSON。"] };
  }
  if (!isRecord(parsed) || parsed.schemaVersion !== 1 || !Array.isArray(parsed.snippets)) {
    return { candidates: [], errors: ["导入文件版本或结构不受支持。"] };
  }
  if (parsed.snippets.length > MAX_IMPORT_ITEMS) {
    return { candidates: [], errors: [`单次最多导入 ${MAX_IMPORT_ITEMS} 个片段。`] };
  }
  const candidates: SnippetTransferCandidate[] = [];
  const errors: string[] = [];
  parsed.snippets.forEach((value, index) => {
    const candidate = parseCandidate(value);
    if (typeof candidate === "string") errors.push(`第 ${index + 1} 项：${candidate}`);
    else candidates.push(candidate);
  });
  return { candidates, errors };
}

function parseCandidate(value: unknown): SnippetTransferCandidate | string {
  if (!isRecord(value)) return "不是对象。";
  const title = text(value.title);
  const command = text(value.command);
  if (!title || !command) return "标题和命令不能为空。";
  if (scanSnippetSensitiveLiterals(command).length > 0) return "命令包含疑似明文凭据。";
  const scope = value.scope;
  if (scope !== "any" && scope !== "local" && scope !== "ssh") return "作用域无效。";
  const risk = value.risk;
  if (risk !== "inspect" && risk !== "change" && risk !== "destructive" && risk !== "unknown") {
    return "风险类型无效。";
  }
  const defaultAction = value.defaultAction;
  if (defaultAction !== "insert" && defaultAction !== "run") return "默认动作无效。";
  const variables = Array.isArray(value.variables) ? value.variables : [];
  if (!variables.every(isVariable)) return "变量定义无效或包含敏感默认值。";
  const bindings = Array.isArray(value.contextBindings) ? value.contextBindings : [];
  if (!bindings.every(isBinding)) return "上下文绑定无效。";
  return {
    category: text(value.category) || "custom",
    command,
    contextBindings: bindings as SnippetContextBinding[],
    defaultAction,
    derivedFrom: text(value.derivedFrom) || undefined,
    description: text(value.description),
    risk,
    scope,
    tags: Array.isArray(value.tags) ? value.tags.map(text).filter(Boolean).slice(0, 12) : [],
    title,
    variables: variables as SnippetCatalogVariable[],
  };
}

function toCandidate(snippet: CommandSnippet): SnippetTransferCandidate {
  return {
    category: snippet.category ?? "custom",
    command: snippet.command,
    contextBindings: snippet.contextBindings ?? [],
    defaultAction: snippet.defaultAction ?? "insert",
    derivedFrom: snippet.derivedFrom ?? undefined,
    description: snippet.description ?? "",
    risk: snippet.risk ?? "unknown",
    scope: snippet.scope,
    tags: snippet.tags,
    title: snippet.title,
    variables: (snippet.variables ?? []).map((variable) =>
      variable.kind === "secret" || variable.sensitive
        ? { ...variable, defaultValue: undefined, suggestions: [] }
        : variable,
    ),
  };
}

function isVariable(value: unknown): value is SnippetCatalogVariable {
  if (!isRecord(value)) return false;
  const kind = value.kind;
  const strategy = value.renderStrategy;
  return (
    Boolean(text(value.name)) &&
    Boolean(text(value.label)) &&
    ["text", "path", "port", "integer", "host", "url", "service", "container", "enum", "secret", "raw"].includes(String(kind)) &&
    ["shellArg", "validatedRaw", "literal"].includes(String(strategy)) &&
    typeof value.required === "boolean" &&
    typeof value.sensitive === "boolean" &&
    Array.isArray(value.suggestions) &&
    (value.validation === undefined ||
      (typeof value.validation === "string" && isSafeValidationPattern(value.validation))) &&
    !((kind === "secret" || value.sensitive === true) &&
      (Boolean(text(value.defaultValue)) || value.suggestions.length > 0))
  );
}

function isBinding(value: unknown): value is SnippetContextBinding {
  return (
    isRecord(value) &&
    ["global", "workspace", "host", "hostGroup"].includes(String(value.kind)) &&
    (value.targetId === undefined || typeof value.targetId === "string")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
