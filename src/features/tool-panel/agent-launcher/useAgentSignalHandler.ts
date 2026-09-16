// @author kongweiguang

import {
  useCallback,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { ExternalAgentId } from "../../../lib/agentLauncherApi";
import type { TerminalAgentSignal } from "../../../lib/terminalApi";

interface AgentSignalSession {
  agentId: ExternalAgentId;
  agentSignal?: TerminalAgentSignal;
}

/**
 * 集中处理右栏 Agent signal 的运行态更新和 workflow 广播；signal 不写入终端正文，
 * 也不让 provider 的晚到事件覆盖不存在或已替换的 Agent session。
 */
export function useAgentSignalHandler<T extends AgentSignalSession>(
  setRuntimeSessions: Dispatch<SetStateAction<Record<string, T>>>,
  listenersRef: MutableRefObject<Set<(signal: TerminalAgentSignal) => void>>,
): (signal: TerminalAgentSignal) => void {
  return useCallback(
    (signal: TerminalAgentSignal) => {
      const agentSessionId = signal.agentSessionId?.trim();
      if (!agentSessionId) {
        return;
      }
      setRuntimeSessions((current) => {
        const session = current[agentSessionId];
        if (!session) {
          return current;
        }
        if (session.agentId !== "custom" && session.agentId !== signal.agent) {
          return current;
        }
        if (
          session.agentSignal?.terminalSessionId === signal.terminalSessionId &&
          session.agentSignal?.agent === signal.agent &&
          session.agentSignal?.status === signal.status
        ) {
          return current;
        }
        return {
          ...current,
          [agentSessionId]: {
            ...session,
            agentSignal: signal,
          },
        };
      });
      for (const listener of listenersRef.current) {
        listener(signal);
      }
    },
    [listenersRef, setRuntimeSessions],
  );
}
