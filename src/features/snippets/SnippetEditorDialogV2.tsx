import { useEffect, useId, useState, type FormEvent } from "react";
import { Save } from "lucide-react";
import { Button } from "../../components/ui/button";
import { ModalShell } from "../../components/ui/modal-shell";
import type {
  SnippetCatalogVariable,
  SnippetContextBinding,
  SnippetDefaultAction,
  SnippetRisk,
  SnippetScope,
} from "../../lib/snippetApi";
import { scanSnippetSensitiveLiterals } from "./snippetSensitiveScan";
import { isSafeValidationPattern } from "./snippetTemplate";

export interface SnippetEditorValue {
  title: string;
  command: string;
  description: string;
  tags: string[];
  scope: SnippetScope;
  sortOrder: number;
  category: string;
  risk: SnippetRisk;
  defaultAction: SnippetDefaultAction;
  variables: SnippetCatalogVariable[];
  derivedFrom?: string;
  contextBindings: SnippetContextBinding[];
}

export function SnippetEditorDialogV2({
  initial,
  onClose,
  onSave,
  open,
  saving,
  title,
}: {
  initial: SnippetEditorValue;
  onClose: () => void;
  onSave: (value: SnippetEditorValue) => Promise<void>;
  open: boolean;
  saving: boolean;
  title: string;
}) {
  const formId = useId();
  const [value, setValue] = useState(initial);
  const [tags, setTags] = useState(initial.tags.join(", "));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setValue(initial);
    setTags(initial.tags.join(", "));
    setError(null);
  }, [initial, open]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!value.title.trim() || !value.command.trim()) {
      setError("标题和命令不能为空。");
      return;
    }
    const binding = value.contextBindings[0];
    if (binding && binding.kind !== "global" && !binding.targetId?.trim()) {
      setError("工作区、主机或主机组绑定必须填写目标 ID。");
      return;
    }
    if (scanSnippetSensitiveLiterals(value.command).length > 0) {
      setError("检测到疑似明文凭据。请改用变量占位符或凭据库引用后再保存。");
      return;
    }
    if (value.variables.some((variable) =>
      variable.validation && !isSafeValidationPattern(variable.validation)
    )) {
      setError("校验规则只支持无分组、无分支和无反向引用的短正则。");
      return;
    }
    if (value.variables.some((variable) =>
      (variable.kind === "secret" || variable.sensitive) &&
      (Boolean(variable.defaultValue) || variable.suggestions.length > 0)
    )) {
      setError("敏感参数不能保存默认值或建议值。");
      return;
    }
    try {
      await onSave({
        ...value,
        command: value.command.trim(),
        contextBindings: value.contextBindings.map((entry) => ({
          ...entry,
          ...(entry.targetId ? { targetId: entry.targetId.trim() } : {}),
        })),
        description: value.description.trim(),
        tags: [...new Set(tags.split(/[,，\n]/).map((tag) => tag.trim()).filter(Boolean))],
        title: value.title.trim(),
      });
    } catch (nextError) {
      const message = String(nextError).toLowerCase();
      setError(
        message.includes("changed externally") || message.includes("revision conflict")
          ? "文件已被外部修改，请重新加载后再保存。"
          : "片段未保存，请检查内容后重试。",
      );
    }
  };
  const updateVariable = (
    name: string,
    patch: Partial<SnippetCatalogVariable>,
  ) => {
    setValue((current) => ({
      ...current,
      variables: current.variables.map((variable) =>
        variable.name === name ? { ...variable, ...patch } : variable,
      ),
    }));
  };
  return (
    <ModalShell
      footer={
        <>
          <Button disabled={saving} onClick={onClose} type="button" variant="ghost">取消</Button>
          <Button disabled={saving || !value.title.trim() || !value.command.trim()} form={formId} type="submit" variant="primary">
            <Save className="h-4 w-4" />{saving ? "保存中..." : "保存"}
          </Button>
        </>
      }
      onClose={onClose}
      open={open}
      panelClassName="h-[min(36rem,calc(100vh-48px))]"
      size="medium"
      title={title}
    >
      <form className="space-y-4" id={formId} onSubmit={(event) => void submit(event)}>
        <div className="grid gap-3 sm:grid-cols-[1fr_9rem]">
          <label className="space-y-1">
            <span className="text-xs font-medium text-zinc-700 dark:text-zinc-200">标题</span>
            <input autoFocus className="kerminal-field-surface h-9 w-full rounded-lg border px-3 text-sm text-zinc-900 dark:text-zinc-100" onChange={(event) => setValue((current) => ({ ...current, title: event.target.value }))} value={value.title} />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-zinc-700 dark:text-zinc-200">作用域</span>
            <select className="kerminal-field-surface h-9 w-full rounded-lg border px-2 text-sm text-zinc-900 dark:text-zinc-100" onChange={(event) => setValue((current) => ({ ...current, scope: event.target.value as SnippetScope }))} value={value.scope}>
              <option value="any">通用</option><option value="local">本地</option><option value="ssh">SSH</option>
            </select>
          </label>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="space-y-1">
            <span className="text-xs font-medium text-zinc-700 dark:text-zinc-200">分类</span>
            <input className="kerminal-field-surface h-9 w-full rounded-lg border px-3 text-sm text-zinc-900 dark:text-zinc-100" onChange={(event) => setValue((current) => ({ ...current, category: event.target.value }))} value={value.category} />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-zinc-700 dark:text-zinc-200">风险</span>
            <select className="kerminal-field-surface h-9 w-full rounded-lg border px-2 text-sm text-zinc-900 dark:text-zinc-100" onChange={(event) => setValue((current) => ({ ...current, risk: event.target.value as SnippetRisk }))} value={value.risk}>
              <option value="inspect">只读检查</option><option value="change">可能变更</option><option value="destructive">破坏性</option><option value="unknown">未知</option>
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-zinc-700 dark:text-zinc-200">默认动作</span>
            <select className="kerminal-field-surface h-9 w-full rounded-lg border px-2 text-sm text-zinc-900 dark:text-zinc-100" onChange={(event) => setValue((current) => ({ ...current, defaultAction: event.target.value as SnippetDefaultAction }))} value={value.defaultAction}>
              <option value="insert">填入终端</option><option value="run">运行前确认</option>
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-zinc-700 dark:text-zinc-200">排序</span>
            <input
              className="kerminal-field-surface h-9 w-full rounded-lg border px-3 text-sm text-zinc-900 dark:text-zinc-100"
              min={0}
              onChange={(event) =>
                setValue((current) => ({
                  ...current,
                  sortOrder: Number.parseInt(event.target.value, 10) || 0,
                }))
              }
              type="number"
              value={value.sortOrder}
            />
          </label>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1">
            <span className="text-xs font-medium text-zinc-700 dark:text-zinc-200">上下文绑定</span>
            <select
              className="kerminal-field-surface h-9 w-full rounded-lg border px-2 text-sm text-zinc-900 dark:text-zinc-100"
              onChange={(event) => {
                const kind = event.target.value as SnippetContextBinding["kind"];
                setValue((current) => ({
                  ...current,
                  contextBindings: [{ kind }],
                }));
              }}
              value={value.contextBindings[0]?.kind ?? "global"}
            >
              <option value="global">全局</option>
              <option value="workspace">工作区</option>
              <option value="host">主机</option>
              <option value="hostGroup">主机组</option>
            </select>
          </label>
          {(value.contextBindings[0]?.kind ?? "global") !== "global" ? (
            <label className="space-y-1">
              <span className="text-xs font-medium text-zinc-700 dark:text-zinc-200">绑定目标 ID</span>
              <input
                className="kerminal-field-surface h-9 w-full rounded-lg border px-3 font-mono text-sm text-zinc-900 dark:text-zinc-100"
                onChange={(event) =>
                  setValue((current) => ({
                    ...current,
                    contextBindings: [
                      {
                        kind: current.contextBindings[0]?.kind ?? "workspace",
                        targetId: event.target.value,
                      },
                    ],
                  }))
                }
                value={value.contextBindings[0]?.targetId ?? ""}
              />
            </label>
          ) : null}
        </div>
        <label className="block space-y-1">
          <span className="text-xs font-medium text-zinc-700 dark:text-zinc-200">命令模板</span>
          <textarea className="kerminal-field-surface min-h-32 w-full resize-y rounded-lg border p-3 font-mono text-xs text-zinc-900 dark:text-zinc-100" onChange={(event) => setValue((current) => syncEditorVariables({ ...current, command: event.target.value }))} value={value.command} />
        </label>
        {value.variables.length > 0 ? (
          <fieldset className="space-y-2 border-t border-[var(--border-subtle)] pt-3">
            <legend className="text-xs font-medium text-zinc-700 dark:text-zinc-200">参数</legend>
            {value.variables.map((variable) => (
              <div className="space-y-2 border-b border-[var(--border-subtle)] pb-3 last:border-b-0" key={variable.name}>
                <div className="grid gap-2 sm:grid-cols-[1fr_8rem_8rem]">
                  <label className="space-y-1">
                    <span className="text-[11px] text-zinc-500">{variable.name} 显示名</span>
                    <input className="kerminal-field-surface h-8 w-full rounded-md border px-2 text-xs text-zinc-900 dark:text-zinc-100" onChange={(event) => updateVariable(variable.name, { label: event.target.value })} value={variable.label} />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[11px] text-zinc-500">类型</span>
                    <select className="kerminal-field-surface h-8 w-full rounded-md border px-2 text-xs text-zinc-900 dark:text-zinc-100" onChange={(event) => updateVariable(variable.name, variableKindPatch(event.target.value as SnippetCatalogVariable["kind"]))} value={variable.kind}>
                      <option value="text">文本</option><option value="path">路径</option><option value="port">端口</option><option value="integer">整数</option><option value="host">主机</option><option value="url">URL</option><option value="service">服务</option><option value="container">容器</option><option value="enum">枚举</option><option value="secret">敏感值</option><option value="raw">原始值</option>
                    </select>
                  </label>
                  <label className="space-y-1">
                    <span className="text-[11px] text-zinc-500">渲染</span>
                    <select className="kerminal-field-surface h-8 w-full rounded-md border px-2 text-xs text-zinc-900 dark:text-zinc-100" onChange={(event) => updateVariable(variable.name, { renderStrategy: event.target.value as SnippetCatalogVariable["renderStrategy"] })} value={variable.renderStrategy}>
                      <option value="shellArg">Shell 参数</option><option value="validatedRaw">校验原始值</option><option value="literal">兼容原样</option>
                    </select>
                  </label>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="space-y-1">
                    <span className="text-[11px] text-zinc-500">参数说明</span>
                    <input className="kerminal-field-surface h-8 w-full rounded-md border px-2 text-xs text-zinc-900 dark:text-zinc-100" onChange={(event) => updateVariable(variable.name, { description: event.target.value })} value={variable.description} />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[11px] text-zinc-500">校验规则</span>
                    <input className="kerminal-field-surface h-8 w-full rounded-md border px-2 font-mono text-xs text-zinc-900 dark:text-zinc-100" onChange={(event) => updateVariable(variable.name, { validation: event.target.value || undefined })} placeholder="可选正则" value={variable.validation ?? ""} />
                  </label>
                </div>
                <div className="flex min-w-0 items-end gap-3">
                  <label className="min-w-0 flex-1 space-y-1">
                    <span className="text-[11px] text-zinc-500">建议值</span>
                    <input
                      className="kerminal-field-surface h-8 w-full rounded-md border px-2 text-xs text-zinc-900 disabled:opacity-50 dark:text-zinc-100"
                      disabled={variable.kind === "secret"}
                      onChange={(event) =>
                        updateVariable(variable.name, {
                          suggestions: event.target.value
                            .split(/[,，]/)
                            .map((entry) => entry.trim())
                            .filter(Boolean),
                        })
                      }
                      placeholder="逗号分隔"
                      value={variable.suggestions.join(", ")}
                    />
                  </label>
                  <label className="flex h-8 shrink-0 items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300">
                    <input checked={variable.required} onChange={(event) => updateVariable(variable.name, { required: event.target.checked })} type="checkbox" />
                    必填
                  </label>
                </div>
              </div>
            ))}
          </fieldset>
        ) : null}
        <label className="block space-y-1">
          <span className="text-xs font-medium text-zinc-700 dark:text-zinc-200">说明</span>
          <input className="kerminal-field-surface h-9 w-full rounded-lg border px-3 text-sm text-zinc-900 dark:text-zinc-100" onChange={(event) => setValue((current) => ({ ...current, description: event.target.value }))} value={value.description} />
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-medium text-zinc-700 dark:text-zinc-200">标签</span>
          <input className="kerminal-field-surface h-9 w-full rounded-lg border px-3 text-sm text-zinc-900 dark:text-zinc-100" onChange={(event) => setTags(event.target.value)} placeholder="logs, system, daily" value={tags} />
        </label>
        {error ? <p className="text-xs text-red-600 dark:text-red-300" role="alert">{error}</p> : null}
      </form>
    </ModalShell>
  );
}

function syncEditorVariables(value: SnippetEditorValue): SnippetEditorValue {
  const existing = new Map(value.variables.map((variable) => [variable.name, variable]));
  const names = [...value.command.matchAll(/\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g)]
    .map((match) => match[1])
    .filter((name, index, all) => all.indexOf(name) === index);
  return {
    ...value,
    variables: names.map((name) => existing.get(name) ?? defaultVariable(name)),
  };
}

function defaultVariable(name: string): SnippetCatalogVariable {
  return {
    description: "",
    kind: "text",
    label: name,
    name,
    renderStrategy: "shellArg",
    required: true,
    sensitive: false,
    suggestions: [],
  };
}

function variableKindPatch(
  kind: SnippetCatalogVariable["kind"],
): Partial<SnippetCatalogVariable> {
  return {
    kind,
    sensitive: kind === "secret",
    ...(kind === "raw" ? { renderStrategy: "validatedRaw" as const } : {}),
    ...(kind === "secret" ? { defaultValue: undefined, suggestions: [] } : {}),
  };
}
