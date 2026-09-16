// @author kongweiguang

import { Loader2 } from "lucide-react";
import type { Ref } from "react";
import {
  defaultAgentLaunchPermissionMode,
  type AgentLaunchPermissionMode,
} from "./agentLauncherModel";
import type { AgentSelectorOption } from "./AgentSelector";

export type AgentLaunchTargetMode = "current" | "unbound";

interface AgentLaunchSplitButtonProps {
  actionState: string | null;
  disabled?: boolean;
  onLaunch: (
    permissionMode?: AgentLaunchPermissionMode,
    targetMode?: AgentLaunchTargetMode,
  ) => void;
  option: AgentSelectorOption | null;
  primaryButtonRef?: Ref<HTMLButtonElement>;
}

/**
 * 保留历史组件名以避免调用方改动；实际只渲染一个默认全权限入口，scope
 * 固定为 global，当前终端由上层作为首选 target 保存。
 */
export function AgentLaunchSplitButton({
  actionState,
  disabled: externallyDisabled = false,
  onLaunch,
  option,
  primaryButtonRef,
}: AgentLaunchSplitButtonProps) {
  const busy = Boolean(option && actionState === option.key);
  const disabled =
    externallyDisabled ||
    !option ||
    actionState !== null ||
    Boolean(option.disabled);

  return (
    <div className="flex shrink-0">
      <button
        aria-label={option ? `使用 ${option.name} 进入` : "进入 Agent"}
        className="kerminal-focus-ring kerminal-pressable inline-flex h-11 min-w-[58px] items-center justify-center rounded-[var(--radius-control)] border border-[rgb(var(--app-accent))] bg-[rgb(var(--app-accent))] px-3 text-xs font-semibold text-white transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
        disabled={disabled}
        onClick={() => {
          if (!option) {
            return;
          }
          onLaunch(defaultAgentLaunchPermissionMode(option.agentId), "unbound");
        }}
        ref={primaryButtonRef}
        title={option?.disabledReason}
        type="button"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "进入"}
      </button>
    </div>
  );
}
