// @author kongweiguang

import type { ConnectionState } from "./XtermPane.helpers";
import { stateLabel } from "./XtermPane.helpers";

/**
 * 把连接、日志和瞬时操作反馈放在 xterm canvas 外围；通用提示不能复用命令块
 * 开关，否则关闭 shell assist 时会吞掉 opener 等基础终端能力的错误反馈。
 */
export function XtermPaneChrome({
  commandBlockNotice,
  connectionState,
  logActive,
  logNotice,
  logPath,
  shellAssistEnabled,
  terminalNotice,
}: {
  commandBlockNotice: string | null;
  connectionState: ConnectionState;
  logActive: boolean;
  logNotice: string | null;
  logPath?: string;
  shellAssistEnabled: boolean;
  terminalNotice: string | null;
}) {
  return (
    <>
      {connectionState !== "connected" ? (
        <div
          aria-label={stateLabel(connectionState)}
          className="kerminal-muted-surface pointer-events-none absolute right-3 top-2 rounded-md border px-2 py-1 text-[11px] text-zinc-500 backdrop-blur-xl dark:text-zinc-400"
          role={connectionState === "error" ? "status" : undefined}
        >
          {stateLabel(connectionState)}
        </div>
      ) : (
        <span aria-hidden="true" hidden>
          {stateLabel(connectionState)}
        </span>
      )}
      {logActive ? (
        <div
          aria-label="终端日志记录状态"
          className="pointer-events-none absolute right-3 top-9 rounded-md border border-sky-500/30 bg-sky-100/80 px-2 py-1 text-[11px] text-sky-700 dark:border-sky-300/20 dark:bg-sky-400/15 dark:text-sky-200"
          title={logPath}
        >
          记录中
        </div>
      ) : null}
      {logNotice ? (
        <div
          aria-label="终端日志提示"
          className="kerminal-muted-surface pointer-events-none absolute bottom-3 left-3 max-w-[min(560px,calc(100%-1.5rem))] truncate rounded-md border px-2 py-1 text-[11px] text-zinc-500 shadow-sm backdrop-blur-xl dark:text-zinc-300"
          role="status"
          title={logNotice}
        >
          {logNotice}
        </div>
      ) : null}
      {terminalNotice ? (
        <div
          aria-label="终端操作提示"
          className="kerminal-muted-surface pointer-events-none absolute left-3 max-w-[min(560px,calc(100%-1.5rem))] truncate rounded-md border px-2 py-1 text-[11px] text-zinc-500 shadow-sm backdrop-blur-xl dark:text-zinc-300"
          role="status"
          style={{ bottom: logNotice ? 40 : 12 }}
          title={terminalNotice}
        >
          {terminalNotice}
        </div>
      ) : null}
      {shellAssistEnabled && commandBlockNotice ? (
        <div
          aria-label="命令块操作提示"
          className="kerminal-muted-surface pointer-events-none absolute left-3 max-w-[min(560px,calc(100%-1.5rem))] truncate rounded-md border px-2 py-1 text-[11px] text-zinc-500 shadow-sm backdrop-blur-xl dark:text-zinc-300"
          role="status"
          style={{
            bottom: 12 + (logNotice ? 28 : 0) + (terminalNotice ? 28 : 0),
          }}
          title={commandBlockNotice}
        >
          {commandBlockNotice}
        </div>
      ) : null}
    </>
  );
}
