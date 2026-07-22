import {
  Activity,
  Network,
  Server,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import { Switch } from "../../../components/ui/switch";
import { cn } from "../../../lib/cn";
import {
  type TerminalInlineSuggestionSettings,
} from "../settingsModel";

const inlineSuggestionTileClassName =
  "rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--surface-content)]";

export function InlineSuggestionPolicyStatus({
  inlineSuggestion,
}: {
  inlineSuggestion: TerminalInlineSuggestionSettings;
}) {
  const productionRestricted =
    inlineSuggestion.productionHostPolicy === "restricted";
  const statusItems: Array<{
    icon: LucideIcon;
    label: string;
    tone: "emerald" | "sky" | "zinc";
    value: string;
  }> = [
    {
      icon: ShieldCheck,
      label: "主机安装",
      tone: "emerald",
      value: "不需要插件",
    },
    {
      icon: Network,
      label: "远端探测",
      tone: inlineSuggestion.remoteProbeEnabled ? "sky" : "zinc",
      value: inlineSuggestion.remoteProbeEnabled ? "后台只读" : "已关闭",
    },
    {
      icon: Server,
      label: "生产主机",
      tone: productionRestricted ? "emerald" : "sky",
      value: productionRestricted ? "限制预热" : "普通策略",
    },
    {
      icon: Activity,
      label: "反馈调权",
      tone: inlineSuggestion.enabled ? "sky" : "zinc",
      value: inlineSuggestion.enabled ? "接受/忽略" : "暂停",
    },
  ];

  return (
    <div className="mt-3 grid gap-2 sm:grid-cols-2">
      {statusItems.map((item) => {
        const Icon = item.icon;
        return (
          <div
            className={cn(
              inlineSuggestionTileClassName,
              "flex min-h-9 items-center justify-between gap-3 px-2.5 py-2",
            )}
            key={item.label}
          >
            <span className="flex min-w-0 items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
              <Icon className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{item.label}</span>
            </span>
            <span
              className={cn(
                "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium",
                item.tone === "emerald"
                  ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-200"
                  : item.tone === "sky"
                    ? "bg-sky-500/10 text-sky-700 dark:text-sky-100"
                    : "bg-[var(--surface-hover)] text-zinc-500 dark:text-zinc-400",
              )}
            >
              {item.value}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function InlineSuggestionProviderToggle({
  checked,
  icon: Icon,
  label,
  onChange,
}: {
  checked: boolean;
  icon: LucideIcon;
  label: string;
  onChange: (enabled: boolean) => void;
}) {
  return (
    <div
      className={cn(
        inlineSuggestionTileClassName,
        "flex min-h-10 items-center justify-between gap-3 px-3 py-2 text-sm text-zinc-700 dark:text-zinc-300",
      )}
    >
      <span className="flex min-w-0 items-center gap-2">
        <Icon className="h-4 w-4 shrink-0 text-zinc-400" />
        <span className="min-w-0 truncate text-left leading-5">{label}</span>
      </span>
      <Switch
        aria-label={label}
        checked={checked}
        onCheckedChange={onChange}
      />
    </div>
  );
}
