// @author kongweiguang

import { useEffect, useMemo, useRef } from "react";
import {
  AlertTriangle,
  Bot,
  ChevronRight,
  ArrowUpRight,
  CircleAlert,
  CircleCheck,
  Clock3,
  Folder,
  Info,
  Server,
  Wifi,
  Wrench,
} from "lucide-react";
import { cn } from "../../../lib/cn";
import {
  resolveContextInspectorBoundaryFocus,
  resolveContextInspectorInitialFocus,
  type ContextInspectorFocusTarget,
} from "./contextInspectorFocusModel";
import { buildContextInspectorViewModel } from "./contextInspectorModel";
import { useContextInspectorAgent } from "./useContextInspectorAgent";
import type {
  ContextInspectorField,
  ContextInspectorSection,
  ContextInspectorToolContentProps,
} from "./contextInspectorTypes";

const toneClasses = {
  default: "text-zinc-950 dark:text-zinc-100",
  muted: "text-zinc-500 dark:text-zinc-400",
  warning: "text-amber-700 dark:text-amber-300",
  danger: "text-red-700 dark:text-red-300",
  success: "text-emerald-700 dark:text-emerald-300",
} as const;

const primaryFieldIcons = {
  "primary-agent": Bot,
  "primary-connection": Wifi,
  "primary-location": Folder,
  "primary-target": Server,
} as const;

const diagnosticNoticeStyles = {
  danger: {
    Icon: CircleAlert,
    label: "需要处理",
    section:
      "border-red-500/25 bg-red-500/8 text-red-800 dark:text-red-200",
    icon: "text-red-600 dark:text-red-300",
    detail: "text-red-700 dark:text-red-300",
  },
  muted: {
    Icon: Info,
    label: "提示",
    section:
      "border-sky-500/25 bg-sky-500/8 text-sky-800 dark:text-sky-200",
    icon: "text-sky-600 dark:text-sky-300",
    detail: "text-sky-700 dark:text-sky-300",
  },
  warning: {
    Icon: AlertTriangle,
    label: "需要注意",
    section:
      "border-amber-500/25 bg-amber-500/8 text-amber-800 dark:text-amber-200",
    icon: "text-amber-600 dark:text-amber-300",
    detail: "text-amber-700 dark:text-amber-300",
  },
} as const;

function visibleFocusTargets(
  root: HTMLElement | null,
  targets: readonly ContextInspectorFocusTarget[],
) {
  if (!root) {
    return targets;
  }
  return targets.filter((target) => {
    const element = root.querySelector<HTMLElement>(
      `[data-context-focus-id="${target.id}"]`,
    );
    return element && !element.closest("details:not([open])");
  });
}

function StatusIcon({
  status,
}: {
  status: "ready" | "partial" | "stale" | "error";
}) {
  if (status === "error") {
    return (
      <CircleAlert
        aria-hidden
        className="h-4 w-4 text-red-600 dark:text-red-300"
      />
    );
  }
  if (status === "stale") {
    return (
      <Clock3
        aria-hidden
        className="h-4 w-4 text-amber-600 dark:text-amber-300"
      />
    );
  }
  if (status === "partial") {
    return (
      <AlertTriangle
        aria-hidden
        className="h-4 w-4 text-amber-600 dark:text-amber-300"
      />
    );
  }
  return (
    <CircleCheck
      aria-hidden
      className="h-4 w-4 text-emerald-600 dark:text-emerald-300"
    />
  );
}

function Field({
  field,
  navigationAvailable,
  onNavigate,
}: {
  field: ContextInspectorField;
  navigationAvailable: boolean;
  onNavigate?: (navigationId: string) => void;
}) {
  const content = (
    <>
      <span className="min-w-0 text-xs text-zinc-500 dark:text-zinc-400">
        {field.label}
      </span>
      <span
        className={cn(
          "min-w-0 break-words text-right text-xs leading-5",
          toneClasses[field.tone ?? "default"],
        )}
        title={field.value}
      >
        {field.value}
      </span>
    </>
  );

  return field.navigationId && navigationAvailable && onNavigate ? (
    <button
      className="grid w-full grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] items-start gap-3 rounded-md px-1 py-1.5 text-left outline-none hover:bg-[var(--surface-hover)] focus-visible:ring-2 focus-visible:ring-sky-500"
      data-context-focus-id={`navigation:${field.id}`}
      onClick={() => onNavigate(field.navigationId!)}
      type="button"
    >
      {content}
    </button>
  ) : (
    <div className="grid grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] items-start gap-3 px-1 py-1.5">
      {content}
    </div>
  );
}

function PrimaryField({
  field,
  navigationAvailable,
  onNavigate,
}: {
  field: ContextInspectorField;
  navigationAvailable: boolean;
  onNavigate?: (navigationId: string) => void;
}) {
  const Icon =
    primaryFieldIcons[field.id as keyof typeof primaryFieldIcons] ?? Server;
  const content = (
    <>
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[var(--surface-muted)] text-zinc-500 dark:text-zinc-400">
        <Icon aria-hidden className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[11px] text-zinc-500 dark:text-zinc-400">
          {field.label}
        </span>
        <span
          className={cn(
            "mt-0.5 block break-words text-sm font-medium leading-5",
            toneClasses[field.tone ?? "default"],
          )}
          title={field.value}
        >
          {field.value}
        </span>
      </span>
    </>
  );

  return field.navigationId && navigationAvailable && onNavigate ? (
    <button
      className="kerminal-focus-ring flex w-full min-w-0 items-center gap-3 px-3 py-2.5 text-left hover:bg-[var(--surface-hover)]"
      data-context-focus-id={`navigation:${field.id}`}
      onClick={() => onNavigate(field.navigationId!)}
      type="button"
    >
      {content}
      <ChevronRight aria-hidden className="h-4 w-4 shrink-0 text-zinc-400" />
    </button>
  ) : (
    <div className="flex min-w-0 items-center gap-3 px-3 py-2.5">{content}</div>
  );
}

function SectionFields({
  isNavigationAvailable,
  onNavigate,
  sections,
}: {
  isNavigationAvailable?: (navigationId: string) => boolean;
  onNavigate?: (navigationId: string) => void;
  sections: readonly ContextInspectorSection[];
}) {
  return (
    <div className="divide-y divide-[var(--border-subtle)]">
      {sections.map((section) => (
        <section className="py-3 first:pt-0 last:pb-0" key={section.id}>
          <div className="mb-1 flex items-center justify-between gap-2 px-1">
            <h4 className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
              {section.title}
            </h4>
            {section.status && section.status !== "normal" ? (
              <span className="text-[11px] text-amber-700 dark:text-amber-300">
                {section.status === "error"
                  ? "错误"
                  : section.status === "stale"
                    ? "已过期"
                    : "部分可用"}
              </span>
            ) : null}
          </div>
          {section.fields.length > 0 ? (
            section.fields.map((field) => (
              <Field
                field={field}
                key={field.id}
                navigationAvailable={Boolean(
                  field.navigationId &&
                    isNavigationAvailable?.(field.navigationId),
                )}
                onNavigate={onNavigate}
              />
            ))
          ) : (
            <p className="px-1 py-1.5 text-xs text-zinc-500 dark:text-zinc-400">
              {section.emptyMessage}
            </p>
          )}
        </section>
      ))}
    </div>
  );
}

/**
 * 生产级只读 Context Inspector。
 * 组件只转发 navigation id 与 action id，不解析领域对象、不直接执行副作用。
 */
export function ContextInspectorToolContent({
  active = true,
  context,
  actions = [],
  autoFocus = false,
  isNavigationAvailable,
  onAction,
  onNavigate,
}: ContextInspectorToolContentProps) {
  const agent = useContextInspectorAgent(context, active);
  const resolvedContext = useMemo(
    () => (agent === context.agent ? context : { ...context, agent }),
    [agent, context],
  );
  const model = useMemo(
    () => buildContextInspectorViewModel(resolvedContext, actions),
    [actions, resolvedContext],
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const focusTargets = useMemo<readonly ContextInspectorFocusTarget[]>(
    () => [
      ...model.topActions.map((action) => ({
        id: `action:${action.id}`,
        kind: "action" as const,
        disabled: !action.available,
      })),
      ...model.primaryFields
        .filter((field) =>
          Boolean(
            field.navigationId &&
              onNavigate &&
              isNavigationAvailable?.(field.navigationId),
          ),
        )
        .map((field) => ({
          id: `navigation:${field.id}`,
          kind: "navigation" as const,
        })),
      ...model.sections.flatMap((section) =>
        section.fields
          .filter((field) =>
            Boolean(
              field.navigationId &&
              onNavigate &&
              isNavigationAvailable?.(field.navigationId),
            ),
          )
          .map((field) => ({
            id: `navigation:${field.id}`,
            kind: "navigation" as const,
          })),
      ),
    ],
    [isNavigationAvailable, model, onNavigate],
  );
  const diagnosticSection = model.sections.find(
    (section) => section.id === "diagnostics",
  );
  const primaryDiagnostic = diagnosticSection?.fields[0];
  const diagnosticStyle = primaryDiagnostic
    ? diagnosticNoticeStyles[
        primaryDiagnostic.tone === "danger"
          ? "danger"
          : primaryDiagnostic.tone === "warning"
            ? "warning"
            : "muted"
      ]
    : null;
  const workspaceSections = model.sections.filter((section) =>
    ["machine", "target", "tab-pane", "location", "resources", "runtime", "agent"].includes(
      section.id,
    ),
  );
  const technicalSections = model.sections.filter((section) =>
    ["freshness", "diagnostics"].includes(section.id),
  );

  useEffect(() => {
    if (!autoFocus) {
      return;
    }
    const targetId = resolveContextInspectorInitialFocus(
      visibleFocusTargets(rootRef.current, focusTargets),
    );
    rootRef.current
      ?.querySelector<HTMLElement>(`[data-context-focus-id="${targetId}"]`)
      ?.focus();
  }, [autoFocus, focusTargets]);

  return (
    <div
      className="min-w-0 space-y-3 text-zinc-950 dark:text-zinc-100"
      onKeyDown={(event) => {
        const targetId = resolveContextInspectorBoundaryFocus(
          event.key,
          visibleFocusTargets(rootRef.current, focusTargets),
        );
        if (!targetId) {
          return;
        }
        event.preventDefault();
        rootRef.current
          ?.querySelector<HTMLElement>(`[data-context-focus-id="${targetId}"]`)
          ?.focus();
      }}
      ref={rootRef}
    >
      <header className="space-y-1 pb-1">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="break-words text-base font-semibold">{model.title}</h2>
            <p className="break-words text-xs text-zinc-500 dark:text-zinc-400">
              {model.subtitle}
            </p>
          </div>
          <StatusIcon status={model.status} />
        </div>
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          <span className="rounded-full bg-[var(--surface-muted)] px-2 py-0.5 text-[11px] text-zinc-600 dark:text-zinc-300">
            {model.status === "ready"
              ? "上下文已就绪"
              : model.status === "error"
                ? "部分来源异常"
                : model.status === "stale"
                  ? "上下文已过期"
                  : "部分可用"}
          </span>
        </div>
      </header>

      <section
        aria-label="当前上下文摘要"
        className="overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-solid)] divide-y divide-[var(--border-subtle)]"
      >
        {model.primaryFields.map((field) => (
          <PrimaryField
            field={field}
            key={field.id}
            navigationAvailable={Boolean(
              field.navigationId &&
                isNavigationAvailable?.(field.navigationId),
            )}
            onNavigate={onNavigate}
          />
        ))}
      </section>

      {primaryDiagnostic && diagnosticStyle ? (
        <section
          aria-label="上下文提醒"
          className={cn(
            "rounded-lg border px-3 py-2.5",
            diagnosticStyle.section,
          )}
          data-tone={primaryDiagnostic.tone}
          role={primaryDiagnostic.tone === "danger" ? "alert" : "status"}
        >
          <div className="flex items-start gap-2">
            <diagnosticStyle.Icon
              aria-hidden
              className={cn(
                "mt-0.5 h-4 w-4 shrink-0",
                diagnosticStyle.icon,
              )}
            />
            <div className="min-w-0">
              <p className="text-xs font-medium">{diagnosticStyle.label}</p>
              <p
                className={cn(
                  "mt-0.5 break-words text-xs leading-5",
                  diagnosticStyle.detail,
                )}
              >
                {primaryDiagnostic.value}
              </p>
            </div>
          </div>
        </section>
      ) : null}

      {model.topActions.length > 0 ? (
        <section aria-labelledby="context-actions-heading">
          <h3
            className="mb-2 text-xs font-semibold text-zinc-600 dark:text-zinc-300"
            id="context-actions-heading"
          >
            常用动作
          </h3>
          <div className="grid grid-cols-2 gap-2">
            {model.topActions.map((action) => (
              <button
                className="flex min-h-9 min-w-0 items-center justify-between gap-2 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-muted)] px-2.5 py-2 text-left text-xs outline-none hover:bg-[var(--surface-hover)] focus-visible:ring-2 focus-visible:ring-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
                data-context-focus-id={`action:${action.id}`}
                disabled={!action.available}
                key={action.id}
                onClick={() => onAction?.(action.id)}
                title={action.available ? action.title : action.disabledReason}
                type="button"
              >
                <span className="min-w-0 break-words">{action.title}</span>
                <ArrowUpRight aria-hidden className="h-3.5 w-3.5 shrink-0" />
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <details className="group border-t border-[var(--border-subtle)] pt-1">
        <summary className="kerminal-focus-ring flex min-h-9 cursor-pointer list-none items-center gap-2 rounded-lg px-2 text-xs font-medium text-zinc-700 hover:bg-[var(--surface-hover)] dark:text-zinc-200 [&::-webkit-details-marker]:hidden">
          <ChevronRight
            aria-hidden
            className="h-3.5 w-3.5 transition-transform duration-150 group-open:rotate-90 motion-reduce:transition-none"
          />
          工作区详情
        </summary>
        <div className="px-1 pb-1 pt-3">
          <SectionFields
            isNavigationAvailable={isNavigationAvailable}
            onNavigate={onNavigate}
            sections={workspaceSections}
          />
        </div>
      </details>

      <details className="group border-t border-[var(--border-subtle)] pt-1">
        <summary className="kerminal-focus-ring flex min-h-9 cursor-pointer list-none items-center gap-2 rounded-lg px-2 text-xs font-medium text-zinc-700 hover:bg-[var(--surface-hover)] dark:text-zinc-200 [&::-webkit-details-marker]:hidden">
          <Wrench aria-hidden className="h-3.5 w-3.5" />
          技术状态
          <ChevronRight
            aria-hidden
            className="ml-auto h-3.5 w-3.5 transition-transform duration-150 group-open:rotate-90 motion-reduce:transition-none"
          />
        </summary>
        <div className="px-1 pb-1 pt-3">
          <SectionFields sections={technicalSections} />
        </div>
      </details>
    </div>
  );
}
