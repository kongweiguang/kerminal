// @author kongweiguang

import { useId, type MouseEvent as ReactMouseEvent } from "react";
import {
  Loader2,
  ShieldOff,
  Sparkles,
  Terminal,
  Unlink,
  Wrench,
} from "lucide-react";
import { cn } from "../../../lib/cn";
import type { ExternalAgentId } from "../../../lib/agentLauncherApi";
import {
  agentPermissionSkipFlag,
  type AgentActionViewModel,
  type AgentLaunchPermissionMode,
} from "./agentLauncherModel";

const agentIcons = {
  claude: Sparkles,
  codex: Terminal,
  custom: Wrench,
};
const agentLaunchContextMenuClassName =
  "kerminal-context-menu kerminal-agent-launch-menu kerminal-floating-enter kerminal-layer-popover absolute w-[164px]";

export type AgentLaunchTargetMode = "current" | "unbound";

export function AgentIconButton({
  actionState,
  agent,
  onLaunch,
  onOpenMenu,
}: {
  actionState: ExternalAgentId | null;
  agent: AgentActionViewModel;
  onLaunch: (
    agentId: ExternalAgentId,
    permissionMode?: AgentLaunchPermissionMode,
    targetMode?: AgentLaunchTargetMode,
  ) => void;
  onOpenMenu: (agent: AgentActionViewModel, event: ReactMouseEvent) => void;
}) {
  const Icon = agentIcons[agent.agentId];
  const busy = actionState === agent.agentId;
  const disabled = actionState !== null || agent.disabled;
  const disabledReason =
    agent.disabledReason ??
    (busy
      ? "正在启动。"
      : actionState !== null
        ? "另一个 Agent 操作正在进行。"
        : undefined);
  const disabledReasonId = useId();
  const label = agent.agentId === "custom" ? "自定义" : agent.title;

  return (
    <button
      aria-label={
        agent.agentId === "custom" ? "Open Custom Agent" : `Open ${agent.title}`
      }
      aria-describedby={disabled && disabledReason ? disabledReasonId : undefined}
      aria-disabled={disabled || undefined}
      className={cn(
        "kerminal-pressable kerminal-focus-ring flex h-16 min-w-0 flex-col items-center justify-center gap-1.5 rounded-lg border border-transparent bg-transparent text-zinc-700 transition hover:border-[var(--border-subtle)] hover:bg-[var(--surface-hover)] active:scale-[0.98] dark:text-zinc-200",
        disabled && "cursor-not-allowed opacity-45",
      )}
      onClick={() => {
        if (!disabled) {
          onLaunch(agent.agentId);
        }
      }}
      onContextMenu={(event) => {
        if (disabled) {
          return;
        }
        onOpenMenu(agent, event);
      }}
      title={disabledReason ?? agent.availabilityDetail}
      type="button"
    >
      {busy ? (
        <Loader2 className="h-5 w-5 animate-spin" />
      ) : (
        <Icon className="h-5 w-5" strokeWidth={1.75} />
      )}
      <span className="max-w-full truncate text-[11px] font-medium">
        {label}
      </span>
      <span
        className={cn(
          "max-w-full truncate text-[10px]",
          agent.availabilityLabel === "可用"
            ? "text-zinc-500 dark:text-zinc-400"
            : "text-amber-700 dark:text-amber-300",
        )}
      >
        {agent.availabilityLabel}
      </span>
      {disabled && disabledReason ? (
        <span className="sr-only" id={disabledReasonId}>
          {disabledReason}
        </span>
      ) : null}
    </button>
  );
}

/** 提供权限模式与全局作用域入口；“操作整个 Kerminal”不再伪装成主机解绑。 */
export function AgentLaunchContextMenu({
  agent,
  onLaunch,
  position,
}: {
  agent: AgentActionViewModel;
  onLaunch: (
    permissionMode: AgentLaunchPermissionMode,
    targetMode?: AgentLaunchTargetMode,
  ) => void;
  position: {
    x: number;
    y: number;
  };
}) {
  const skipFlag = agentPermissionSkipFlag(agent.agentId);

  return (
    <div
      aria-label={`${agent.title} launch options`}
      className={agentLaunchContextMenuClassName}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
      role="menu"
      style={{
        left: position.x,
        top: position.y,
      }}
    >
      <div className="kerminal-context-menu-group">
        {skipFlag ? (
          <button
            aria-label={`Launch ${agent.title} with skipped permissions`}
            className="kerminal-context-menu-item kerminal-agent-launch-menu-item"
            onClick={() => onLaunch("skipPermissions")}
            role="menuitem"
            title="将以跳过权限确认的模式启动"
            type="button"
          >
            <span className="kerminal-context-menu-icon">
              <ShieldOff />
            </span>
            <span className="kerminal-context-menu-label">跳过权限打开</span>
          </button>
        ) : null}
        <button
          aria-label={`Launch ${agent.title} for the entire Kerminal`}
          className="kerminal-context-menu-item kerminal-agent-launch-menu-item"
          onClick={() => onLaunch("default", "unbound")}
          role="menuitem"
          title="允许 Agent 操作所有标签、终端和 Kerminal 运行态"
          type="button"
        >
          <span className="kerminal-context-menu-icon">
            <Unlink />
          </span>
          <span className="kerminal-context-menu-label">操作整个 Kerminal</span>
        </button>
      </div>
    </div>
  );
}
