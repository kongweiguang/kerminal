// @author kongweiguang
import { Play, Plus } from "lucide-react";
import { Button } from "../../../components/ui/button";

export interface AgentWorkflowSessionCommandsProps {
  disabled?: boolean;
  onContinue: (sessionId: string) => void;
  onNewSession: (sessionId: string) => void;
  sessionId: string;
}

/**
 * 会话命令仅上抛稳定 session id，不直接访问 repository 或 terminal。
 * 新会话复用 Agent 类型和权限 scope，但不继承具体 target 或 parent 关系。
 */
export function AgentWorkflowSessionCommands({
  disabled = false,
  onContinue,
  onNewSession,
  sessionId,
}: AgentWorkflowSessionCommandsProps) {
  return (
    <div
      aria-label="Agent 会话操作"
      className="flex min-w-0 flex-wrap items-center gap-2"
      role="group"
    >
      <Button
        disabled={disabled}
        onClick={() => onContinue(sessionId)}
        size="sm"
        title="恢复这段对话并打开 Agent 终端"
        type="button"
        variant="secondary"
      >
        <Play aria-hidden="true" className="h-4 w-4" />
        继续对话
      </Button>
      <Button
        disabled={disabled}
        onClick={() => onNewSession(sessionId)}
        size="sm"
        type="button"
        variant="ghost"
      >
        <Plus aria-hidden="true" className="h-4 w-4" />同 Agent 新会话
      </Button>
    </div>
  );
}
