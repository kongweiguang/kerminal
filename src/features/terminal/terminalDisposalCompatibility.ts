// @author kongweiguang

interface DisposableXtermTerminal {
  dispose(): void;
  element?: { remove(): void };
}

interface XtermTerminalDisposalCoordinator {
  unregisterRenderer(): void;
}

/**
 * 先交还 xterm 对 core、DOM listener 和已加载 addon 的所有权，再撤销
 * renderer registry 的 lease；这样 controller 不会在 xterm 仍持有 addon 时
 * 释放相同资源。最后幂等移除残留根节点，覆盖 xterm 自身析构失败的半清理状态。
 * 三个步骤都采用 best-effort，避免任意一个析构异常阻断后续清理。
 *
 * `hasFirstError` 与错误值分开记录，因为 JavaScript 允许 `throw undefined`
 * 或 `throw null`；仅用错误值判断会错误地吞掉这两类析构失败。
 */
export function disposeXtermTerminal(
  terminal: DisposableXtermTerminal,
  coordinator: XtermTerminalDisposalCoordinator,
): void {
  let hasFirstError = false;
  let firstError: unknown;

  try {
    terminal.dispose();
  } catch (error) {
    hasFirstError = true;
    firstError = error;
  }

  try {
    coordinator.unregisterRenderer();
  } catch (error) {
    if (!hasFirstError) {
      hasFirstError = true;
      firstError = error;
    }
  }

  try {
    terminal.element?.remove();
  } catch (error) {
    if (!hasFirstError) {
      hasFirstError = true;
      firstError = error;
    }
  }

  if (hasFirstError) {
    throw firstError;
  }
}
