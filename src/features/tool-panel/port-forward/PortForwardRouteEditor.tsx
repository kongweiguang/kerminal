// @author kongweiguang

import { ArrowLeft, ArrowRight, ShieldAlert } from "lucide-react";
import type { ReactNode } from "react";
import {
  SelectField,
  type SelectOption,
} from "../../../components/ui/select";
import { cn } from "../../../lib/cn";
import {
  isNonLoopbackBindHost,
  type BindAddressMode,
  type SocksAdvancedMode,
} from "./portForwardWorkbenchModel";

const labelClassName =
  "block text-xs font-medium text-zinc-500 dark:text-zinc-400";

const inputClassName =
  "kerminal-field-surface mt-1 h-9 w-full rounded-xl border px-3 text-sm text-zinc-950 placeholder:text-zinc-400 dark:text-zinc-100 dark:placeholder:text-zinc-500";

const bindAddressModeOptions: SelectOption[] = [
  { label: "仅本机 (127.0.0.1)", value: "loopback" },
  { label: "全部接口 (0.0.0.0)", value: "all" },
  { label: "自定义地址", value: "custom" },
];

export function RouteEditor({
  flow,
  host,
  local,
  openssh,
}: {
  flow: string;
  host: ReactNode;
  local: ReactNode;
  openssh: string;
}) {
  const isHostToLocal = flow.startsWith("主机");
  const ArrowIcon = isHostToLocal ? ArrowRight : ArrowLeft;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] gap-2">
      <EndpointPanel side="host">{host}</EndpointPanel>
      <div className="flex min-w-14 flex-col items-center justify-center gap-2">
        <div className="rounded-full border border-sky-400/25 bg-[var(--surface-selected)] p-2 text-sky-700 shadow-sm shadow-sky-500/10 dark:text-sky-100">
          <ArrowIcon className="h-4 w-4" strokeWidth={1.75} />
        </div>
        <div className="text-center text-[11px] font-medium leading-4 text-zinc-500 dark:text-zinc-400">
          <div>{flow}</div>
          <div className="font-mono">{openssh}</div>
        </div>
      </div>
      <EndpointPanel side="local">{local}</EndpointPanel>
    </div>
  );
}

function EndpointPanel({
  children,
  side,
}: {
  children: ReactNode;
  side: "host" | "local";
}) {
  return (
    <div className="min-w-0 rounded-[var(--radius-card)] border border-[var(--border-subtle)] p-3">
      <div className="mb-3 inline-flex rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-field)] px-2 py-1 text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">
        {side === "host" ? "主机" : "本机"}
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

export function EndpointHeader({
  detail,
  title,
}: {
  detail: string;
  title: string;
}) {
  return (
    <div>
      <div className="text-sm font-semibold text-zinc-950 dark:text-zinc-100">
        {title}
      </div>
      <div className="mt-0.5 text-[11px] leading-4 text-zinc-500 dark:text-zinc-400">
        {detail}
      </div>
    </div>
  );
}

export function FieldInput({
  id,
  label,
  onChange,
  placeholder,
  value,
}: {
  id: string;
  label: string;
  onChange: (value: string) => void;
  placeholder?: string;
  value: string;
}) {
  return (
    <label className={labelClassName} htmlFor={id}>
      {label}
      <input
        className={inputClassName}
        id={id}
        onChange={(event) => onChange(event.currentTarget.value)}
        placeholder={placeholder}
        value={value}
      />
    </label>
  );
}

export function BindAddressControl({
  customHost,
  idPrefix,
  label,
  mode,
  onCustomHostChange,
  onModeChange,
}: {
  customHost: string;
  idPrefix: string;
  label: string;
  mode: BindAddressMode;
  onCustomHostChange: (value: string) => void;
  onModeChange: (value: BindAddressMode) => void;
}) {
  return (
    <div className="space-y-2">
      <SelectField
        id={`${idPrefix}-mode`}
        label={label}
        onValueChange={(value) => onModeChange(value as BindAddressMode)}
        options={bindAddressModeOptions}
        value={mode}
      />
      {mode === "custom" ? (
        <FieldInput
          id={`${idPrefix}-custom`}
          label="自定义监听地址"
          onChange={onCustomHostChange}
          value={customHost}
        />
      ) : null}
    </div>
  );
}

export function SocksModeToggle({
  onChange,
  value,
}: {
  onChange: (value: SocksAdvancedMode) => void;
  value: SocksAdvancedMode;
}) {
  const options: Array<{ label: string; value: SocksAdvancedMode }> = [
    { label: "本机 -D", value: "localDynamic" },
    { label: "远端 SOCKS", value: "remoteDynamic" },
  ];
  return (
    <div className="grid grid-cols-2 gap-1 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-field)] p-1">
      {options.map((option) => (
        <button
          aria-pressed={value === option.value}
          className={cn(
            "kerminal-focus-ring kerminal-pressable rounded-lg px-2 py-1.5 text-xs font-medium",
            value === option.value
              ? "bg-[var(--surface-selected)] text-sky-700 dark:text-sky-100"
              : "text-zinc-500 hover:bg-[var(--surface-hover)] dark:text-zinc-400",
          )}
          key={option.value}
          onClick={() => onChange(option.value)}
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function PreviewValue({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className={labelClassName}>{label}</div>
      <code className="kerminal-field-surface mt-1 block break-all rounded-xl border px-3 py-2 font-mono text-xs leading-5 text-zinc-800 dark:text-zinc-200">
        {value}
      </code>
    </div>
  );
}

export function ExposureWarning({
  bindHost,
  side,
}: {
  bindHost: string;
  side: "local" | "remote";
}) {
  if (!isNonLoopbackBindHost(bindHost)) {
    return null;
  }
  return (
    <div className="flex gap-2 rounded-xl border border-amber-300/25 bg-amber-400/10 px-3 py-2 text-xs leading-5 text-amber-800 dark:text-amber-100">
      <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
      <div>
        {side === "remote"
          ? `主机监听 ${bindHost} 会扩大暴露范围；需确认 GatewayPorts 和防火墙。`
          : `本机监听 ${bindHost} 会对外暴露，请确认可信网络。`}
      </div>
    </div>
  );
}
