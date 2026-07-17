// @author kongweiguang

export interface ForegroundTerminalOutputTarget {
  buffer?: {
    active?: {
      baseY?: number;
      viewportY?: number;
    };
  };
  rows?: number;
  _core?: {
    refresh?(start: number, end: number, sync?: boolean): void;
  };
  refresh?(start: number, end: number): void;
  write(data: string, callback?: () => void): void;
}

interface ForegroundTerminalWriteOptions {
  forceViewportRefresh?: boolean;
  followupViewportRefresh?: boolean;
  onParsed?: () => void;
  onWriteFailure?: (error: unknown) => void;
}

interface ViewportSnapshot {
  baseY: number | null;
  viewportY: number | null;
}

type PendingRefresh =
  | { id: number; kind: "animation-frame" }
  | { id: ReturnType<typeof setTimeout>; kind: "timeout" };

const pendingRefreshByTerminal = new WeakMap<
  ForegroundTerminalOutputTarget,
  PendingRefresh
>();

function refreshVisibleRows(
  terminal: ForegroundTerminalOutputTarget,
  synchronously: boolean,
) {
  if (typeof terminal.rows !== "number" || terminal.rows < 1) {
    return;
  }
  const end = Math.max(0, terminal.rows - 1);
  try {
    // Windows ConPTY 的 DOM/canvas 中间帧需要立即修复；WebGL 会合并已排队的刷新。
    if (synchronously && typeof terminal._core?.refresh === "function") {
      terminal._core.refresh(0, end, true);
      return;
    }
    if (typeof terminal.refresh === "function") {
      terminal.refresh(0, end);
      return;
    }
    terminal._core?.refresh?.(0, end, false);
  } catch {
    // PTY 输出可能与 pane 销毁竞争，已释放的 xterm 无需继续刷新。
  }
}

function captureViewport(
  terminal: ForegroundTerminalOutputTarget,
): ViewportSnapshot {
  return {
    baseY:
      typeof terminal.buffer?.active?.baseY === "number"
        ? terminal.buffer.active.baseY
        : null,
    viewportY:
      typeof terminal.buffer?.active?.viewportY === "number"
        ? terminal.buffer.active.viewportY
        : null,
  };
}

function viewportChanged(
  terminal: ForegroundTerminalOutputTarget,
  beforeWrite: ViewportSnapshot,
) {
  const afterWrite = captureViewport(terminal);
  return (
    afterWrite.baseY !== null &&
    afterWrite.viewportY !== null &&
    (afterWrite.baseY !== beforeWrite.baseY ||
      afterWrite.viewportY !== beforeWrite.viewportY)
  );
}

function cancelPendingRefresh(terminal: ForegroundTerminalOutputTarget) {
  const pending = pendingRefreshByTerminal.get(terminal);
  if (!pending) {
    return;
  }
  pendingRefreshByTerminal.delete(terminal);
  if (pending.kind === "animation-frame") {
    globalThis.cancelAnimationFrame?.(pending.id);
    return;
  }
  globalThis.clearTimeout(pending.id);
}

function scheduleFollowupRefresh(terminal: ForegroundTerminalOutputTarget) {
  cancelPendingRefresh(terminal);
  if (typeof globalThis.requestAnimationFrame === "function") {
    const id = globalThis.requestAnimationFrame(() => {
      pendingRefreshByTerminal.delete(terminal);
      refreshVisibleRows(terminal, true);
    });
    pendingRefreshByTerminal.set(terminal, {
      id,
      kind: "animation-frame",
    });
    return;
  }
  const id = globalThis.setTimeout(() => {
    pendingRefreshByTerminal.delete(terminal);
    refreshVisibleRows(terminal, true);
  }, 16);
  pendingRefreshByTerminal.set(terminal, { id, kind: "timeout" });
}

/**
 * 按 Orca 的 foreground render settle 时序提交一批前台输出。
 * xterm 完成解析后先强刷当前可见行；发生滚动或 cursor restore 时下一帧再补刷。
 */
export function writeForegroundTerminalChunk(
  terminal: ForegroundTerminalOutputTarget,
  data: string,
  options: ForegroundTerminalWriteOptions = {},
) {
  const beforeWrite = options.forceViewportRefresh
    ? captureViewport(terminal)
    : null;
  try {
    terminal.write(data, () => {
      try {
        if (beforeWrite) {
          refreshVisibleRows(terminal, true);
          if (
            options.followupViewportRefresh ||
            viewportChanged(terminal, beforeWrite)
          ) {
            scheduleFollowupRefresh(terminal);
          }
        }
      } catch {
        // renderer settle 失败不能逃出 xterm WriteBuffer callback，否则后续输出会永久停滞。
      }
      try {
        options.onParsed?.();
      } catch {
        // 解析完成后的业务回调也必须与 xterm 的写入循环隔离。
      }
    });
    return true;
  } catch (error: unknown) {
    options.onWriteFailure?.(error);
    return false;
  }
}

export function discardForegroundRenderSettle(
  terminal: ForegroundTerminalOutputTarget,
) {
  cancelPendingRefresh(terminal);
}
