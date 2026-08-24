// @author kongweiguang

import { useCallback, useState } from "react";
import {
  buildUserFacingError,
  type UserFacingMessage,
} from "../../../lib/userFacingMessage";
import type { AgentLauncherActionState } from "./AgentLauncherView";

/**
 * 串行维护 launcherKey 级操作状态与稳定错误文案，让多个 Custom 的 loading
 * 不会共享 provider 级标识，同时把异步异常统一收口到同一恢复提示。
 */
export function useAgentLauncherAction() {
  const [actionState, setActionState] =
    useState<AgentLauncherActionState>(null);
  const [actionError, setActionError] = useState<UserFacingMessage | null>(null);

  const runAction = useCallback(
    async (nextAction: string, action: () => Promise<void>) => {
      setActionState(nextAction);
      setActionError(null);
      try {
        await action();
      } catch (error) {
        setActionError(
          buildUserFacingError(error, {
            recoveryAction: "请检查目标终端和 Agent 配置后重试。",
            title: "Agent 操作未完成",
          }),
        );
      } finally {
        setActionState(null);
      }
    },
    [],
  );

  return { actionError, actionState, runAction, setActionError };
}
