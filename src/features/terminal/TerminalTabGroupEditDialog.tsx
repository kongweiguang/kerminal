// @author kongweiguang

import { Check, Layers2, RotateCcw } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Button } from "../../components/ui/button";
import { ModalShell } from "../../components/ui/modal-shell";
import { cn } from "../../lib/cn";
import type {
  TerminalTabGroupDefinition,
  TerminalTabGroupColor,
  TerminalTabGroupPreference,
} from "../workspace/contracts/index";
import type { TerminalTabGroup } from "./terminalTabChrome";
import {
  normalizeTerminalTabGroupPreference,
  terminalTabIdentityPalette,
} from "./terminalTabIdentityModel";

const TERMINAL_TAB_GROUP_TITLE_MAX_LENGTH = 64;

/**
 * 编辑终端标签组的用户可持久化展示偏好。
 *
 * 该组件只负责收集名称和受控颜色，不承担自动颜色计算；自动/显式语义由
 * identity model 在后续接线中统一处理。
 */
export function TerminalTabGroupEditDialog({
  createForTabId = null,
  group,
  onClose,
  onCreate,
  onSave,
}: {
  createForTabId?: string | null;
  group: TerminalTabGroup | null;
  onClose: () => void;
  onCreate?: (
    tabId: string,
    definition: Partial<TerminalTabGroupDefinition>,
  ) => void;
  onSave: (groupId: string, preference: TerminalTabGroupPreference) => void;
}) {
  const [title, setTitle] = useState("");
  const [color, setColor] = useState<TerminalTabGroupColor | null>(null);
  const [error, setError] = useState<string | null>(null);
  const editingSingleton = Boolean(group && !group.grouped);

  useEffect(() => {
    if (!group && !createForTabId) {
      return;
    }

    setTitle(
      group?.preference?.title ?? group?.title ?? (createForTabId ? "新建分组" : ""),
    );
    setColor(group?.preference?.color ?? null);
    setError(null);
  }, [createForTabId, group]);

  /** 创建和编辑都在 Dialog 内校验标题，避免空名称被规范化后静默关闭。 */
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!group && !createForTabId) {
      return;
    }

    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError("请输入分组名称。");
      return;
    }
    if (trimmedTitle.length > TERMINAL_TAB_GROUP_TITLE_MAX_LENGTH) {
      setError(`分组名称不能超过 ${TERMINAL_TAB_GROUP_TITLE_MAX_LENGTH} 个字符。`);
      return;
    }
    const preference = normalizeTerminalTabGroupPreference({
      color,
      title: trimmedTitle,
    });
    if (createForTabId) {
      onCreate?.(createForTabId, {
        collapsed: false,
        ...(color ? { color } : {}),
        title: trimmedTitle,
      });
      onClose();
      return;
    }
    if (!group) return;
    onSave(group.id, preference ?? {});
    onClose();
  };

  return (
    <ModalShell
      onClose={onClose}
      open={Boolean(group || createForTabId)}
      size="small"
      title={createForTabId ? "新建标签组" : editingSingleton ? "设置标签标识" : "编辑标签组"}
    >
      <form className="space-y-4" onSubmit={submit}>
        <div className="rounded-[var(--radius-card)] border border-[var(--border-subtle)] p-4">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Layers2 className="h-4 w-4 text-sky-500 dark:text-sky-300" />
            {createForTabId ? "新建分组" : editingSingleton ? "标签标识" : "分组信息"}
          </div>
          <label className="mt-4 block">
            <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
               {createForTabId || !editingSingleton ? "分组名称" : "标签名称"}
            </span>
            <input
              aria-label="分组名称"
              autoFocus
              className="kerminal-field-surface mt-1 h-9 w-full rounded-xl border px-3 text-sm"
              maxLength={64}
              onChange={(event) => {
                setTitle(event.currentTarget.value);
                setError(null);
              }}
              placeholder={createForTabId ? "新建分组" : `默认：${group?.title ?? ""}`}
              value={title}
            />
          </label>
          <div className="mt-4">
            <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
              标识颜色
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                aria-label="选择自动标识颜色"
                aria-pressed={color === null}
                className={cn(
                  "kerminal-focus-ring kerminal-pressable flex h-8 items-center gap-1.5 rounded-lg border px-2 text-xs",
                  color === null
                    ? "border-sky-500/50 bg-[var(--surface-selected)] text-sky-700 dark:text-sky-100"
                    : "border-[var(--border-subtle)] bg-[var(--surface-solid)] text-zinc-600 hover:bg-[var(--surface-hover)] dark:text-zinc-300",
                )}
                onClick={() => setColor(null)}
                type="button"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                自动
              </button>
              {terminalTabIdentityPalette.map((theme) => {
                const colorId = theme.color;
                const selected = colorId === color;
                return (
                  <button
                    aria-label={`选择${theme.label}分组颜色`}
                    aria-pressed={selected}
                    className={cn(
                      "kerminal-focus-ring kerminal-pressable flex h-8 w-8 items-center justify-center rounded-full border transition",
                      selected
                        ? "border-sky-500/50 bg-[var(--surface-selected)] shadow-sm shadow-sky-500/20"
                        : "border-[var(--border-subtle)] bg-[var(--surface-solid)] hover:bg-[var(--surface-hover)]",
                    )}
                    key={colorId}
                    onClick={() => setColor(colorId)}
                    title={theme.label}
                    type="button"
                  >
                    <span
                      className={cn(
                        "flex h-[18px] w-[18px] items-center justify-center rounded-full",
                        theme.swatchClassName,
                      )}
                    >
                      {selected ? (
                        <Check className="h-3 w-3 text-white drop-shadow dark:text-zinc-950" />
                      ) : null}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
          {error ? (
            <p
              className="mt-3 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-300"
              role="alert"
            >
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex justify-end gap-2">
          <Button onClick={onClose} type="button" variant="ghost">
            取消
          </Button>
          <Button type="submit" variant="primary">
            {createForTabId ? "创建" : "保存"}
          </Button>
        </div>
      </form>
    </ModalShell>
  );
}
