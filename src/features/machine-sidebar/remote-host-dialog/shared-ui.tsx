// @author kongweiguang

import { useState, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowUp,
  Eye,
  EyeOff,
  FolderPlus,
  Settings,
  Trash2,
} from "lucide-react";
import { Button } from "../../../components/ui/button";
import { Select, type SelectOption } from "../../../components/ui/select";
import { Switch } from "../../../components/ui/switch";
import type { SectionTab } from "./model";

export function DeferredSection({
  modeLabel,
  section,
}: {
  modeLabel: string;
  section?: SectionTab;
}) {
  const Icon = section?.Icon ?? Settings;
  return (
    <div className="flex min-h-[320px] items-center justify-center rounded-[var(--radius-card)] border border-dashed border-[var(--border-subtle)] bg-[var(--surface-content)] p-6 text-center">
      <div className="max-w-sm">
        <Icon className="mx-auto h-8 w-8 text-zinc-400" />
        <h3 className="mt-3 text-sm font-semibold">
          {section?.label ?? "配置"}后续接入
        </h3>
        <p className="mt-2 text-[13px] leading-6 text-[var(--text-secondary)]">
          {section?.description ??
            `${modeLabel} 高级配置后续接入。`}
        </p>
      </div>
    </div>
  );
}

export function FieldRow({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="grid gap-2 md:grid-cols-[84px_minmax(0,1fr)] md:items-start">
      <span className="pt-2 text-[13px] font-medium text-[var(--text-secondary)]">
        {label}:
      </span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function GroupSelectRow({
  groupId,
  groupOptions,
  onCreateGroupClick,
  setGroupId,
}: {
  groupId: string;
  groupOptions: SelectOption[];
  onCreateGroupClick?: () => void;
  setGroupId: (value: string) => void;
}) {
  return (
    <FieldRow label="分组">
      <div className={onCreateGroupClick ? "grid grid-cols-[minmax(0,1fr)_36px] gap-2" : ""}>
        <Select
          aria-label="分组"
          buttonClassName="h-9"
          onValueChange={setGroupId}
          options={groupOptions}
          value={groupId}
        />
        {onCreateGroupClick ? (
          <Button
            aria-label="新建分组"
            className="h-9 w-9"
            onClick={onCreateGroupClick}
            size="icon"
            title="新建分组"
            type="button"
            variant="secondary"
          >
            <FolderPlus className="h-4 w-4" />
          </Button>
        ) : null}
      </div>
    </FieldRow>
  );
}

export const inputClassName =
  "kerminal-field-surface h-9 w-full rounded-[var(--radius-control)] border px-3 text-sm text-[var(--text-primary)] placeholder:text-zinc-400 disabled:cursor-not-allowed disabled:opacity-50 dark:placeholder:text-zinc-600";

export function PasswordInput({
  ariaLabel,
  autoComplete = "off",
  onChange,
  placeholder,
  value,
}: {
  ariaLabel: string;
  autoComplete?: string;
  onChange: (value: string) => void;
  placeholder?: string;
  value: string;
}) {
  const [visible, setVisible] = useState(false);
  const labelSpacing = /^[A-Za-z]/.test(ariaLabel) ? " " : "";
  const toggleLabel = `${visible ? "隐藏" : "显示"}${labelSpacing}${ariaLabel}`;

  return (
    <div className="relative">
      <input
        aria-label={ariaLabel}
        autoComplete={autoComplete}
        className={`${inputClassName} pr-10`}
        onChange={(event) => onChange(event.currentTarget.value)}
        placeholder={placeholder}
        type={visible ? "text" : "password"}
        value={value}
      />
      <button
        aria-label={toggleLabel}
        className="kerminal-focus-ring absolute inset-y-0 right-0 flex w-9 items-center justify-center rounded-r-[var(--radius-control)] text-[var(--text-secondary)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
        onClick={() => setVisible((current) => !current)}
        title={toggleLabel}
        type="button"
      >
        {visible ? (
          <EyeOff aria-hidden="true" className="h-4 w-4" />
        ) : (
          <Eye aria-hidden="true" className="h-4 w-4" />
        )}
      </button>
    </div>
  );
}

export function ToggleRow({
  checked,
  disabled,
  label,
  onCheckedChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="kerminal-field-surface flex min-h-9 items-center justify-between gap-3 rounded-[var(--radius-control)] border px-3 py-1.5 text-[13px] text-[var(--text-secondary)]">
      <span className="truncate">{label}</span>
      <Switch
        aria-label={label}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
      />
    </div>
  );
}

export function EmptyConfigState({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <div className="flex items-center gap-3 rounded-[var(--radius-card)] border border-dashed border-[var(--border-subtle)] bg-[var(--surface-content)] px-3 py-4 text-[13px] text-[var(--text-secondary)]">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-[var(--surface-muted)] text-[var(--text-secondary)]">
        {icon}
      </div>
      <p className="min-w-0 flex-1 leading-6">{text}</p>
    </div>
  );
}

export function ConfigList({ children }: { children: ReactNode }) {
  return (
    <div className="divide-y divide-[var(--border-subtle)] overflow-hidden rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--surface-content)]">
      {children}
    </div>
  );
}

export function ConfigListItem({
  actions,
  meta,
  title,
}: {
  actions: ReactNode;
  meta: string;
  title: string;
}) {
  return (
    <div className="grid gap-3 px-3 py-2.5 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
      <div className="min-w-0">
        <p className="truncate text-[13px] font-semibold text-[var(--text-primary)]">
          {title}
        </p>
        <p className="mt-1 truncate text-xs text-[var(--text-secondary)]">
          {meta}
        </p>
      </div>
      <div className="flex items-center gap-1">{actions}</div>
    </div>
  );
}

export function ListReorderActions({
  canMoveDown,
  canMoveUp,
  onDelete,
  onMoveDown,
  onMoveUp,
}: {
  canMoveDown: boolean;
  canMoveUp: boolean;
  onDelete: () => void;
  onMoveDown: () => void;
  onMoveUp: () => void;
}) {
  return (
    <>
      <Button
        aria-label="上移"
        disabled={!canMoveUp}
        onClick={onMoveUp}
        size="icon"
        type="button"
        variant="ghost"
      >
        <ArrowUp className="h-4 w-4" />
      </Button>
      <Button
        aria-label="下移"
        disabled={!canMoveDown}
        onClick={onMoveDown}
        size="icon"
        type="button"
        variant="ghost"
      >
        <ArrowDown className="h-4 w-4" />
      </Button>
      <Button
        aria-label="删除"
        onClick={onDelete}
        size="icon"
        type="button"
        variant="ghost"
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </>
  );
}

export function protocolButtonClassName(selected: boolean, disabled: boolean) {
  return [
    "kerminal-focus-ring kerminal-pressable flex h-10 min-w-[76px] items-center justify-center gap-2 rounded-[var(--radius-control)] px-3 text-[13px] font-medium transition",
    selected
      ? "bg-[var(--surface-selected)] text-sky-700 dark:text-sky-100"
      : "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]",
    disabled ? "cursor-not-allowed opacity-42 hover:bg-transparent" : "",
  ].join(" ");
}

export function sectionButtonClassName(selected: boolean) {
  return [
    "kerminal-focus-ring kerminal-pressable flex min-h-10 w-full items-center gap-2.5 rounded-[var(--radius-control)] px-2 py-1.5 text-left text-[13px] transition",
    selected
      ? "bg-[var(--surface-selected)] text-sky-700 dark:text-sky-100"
      : "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]",
  ].join(" ");
}
