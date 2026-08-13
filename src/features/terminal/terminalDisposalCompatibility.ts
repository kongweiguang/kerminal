// @author kongweiguang

import type { ITerminalAddon } from "@xterm/xterm";

interface DisposableXtermTerminal {
  dispose(): void;
  element?: { remove(): void };
}

interface XtermTerminalDisposalCoordinator {
  unregisterRenderer(): void;
}

/**
 * 记录 addon 释放期间的首个异常，供顶层 disposal 在完成其余所有权回收后重抛；
 * 单独保存布尔标记是为了保留 `throw undefined` 和 `throw null` 这类合法值。
 */
export interface XtermAddonDisposalErrorState {
  hasFirstError: boolean;
  firstError: unknown;
  ownedAddons: ITerminalAddon[];
}

/** 创建一份可由多个已加载 addon 共享的错误状态。 */
export function createXtermAddonDisposalErrorState(): XtermAddonDisposalErrorState {
  return {
    firstError: undefined,
    hasFirstError: false,
    ownedAddons: [],
  };
}

/**
 * 为交给 xterm ownership store 的 addon 建立独立边界；这样 xterm 仍按原生
 * core→addons 顺序调用 dispose，但一个 addon 的异常不会阻断 store 中其它 addon。
 * 就地替换 dispose 而不是用代理对象，确保 addon 内部字段、accessor 与私有
 * 方法始终以原实例作为 `this`；fit/search 等实例仍由 runtime 直接使用。
 */
export function wrapXtermAddonForDisposal<T extends ITerminalAddon>(
  addon: T,
  errors: XtermAddonDisposalErrorState,
): T {
  let disposed = false;
  const originalDispose = addon.dispose;
  addon.dispose = () => {
    if (disposed) {
      return;
    }
    disposed = true;
    if (typeof originalDispose !== "function") {
      return;
    }
    try {
      originalDispose.call(addon);
    } catch (error) {
      if (!errors.hasFirstError) {
        errors.hasFirstError = true;
        errors.firstError = error;
      }
    }
  };
  errors.ownedAddons.push(addon);
  return addon;
}

/**
 * 先交还 xterm 对 core、DOM listener 和已加载 addon 的所有权，再撤销
 * renderer registry 的 lease；这样 controller 不会在 xterm 仍持有 addon 时
 * 释放相同资源。最后幂等移除残留根节点，覆盖 xterm 自身析构失败的半清理状态。
 * 三个步骤都采用 best-effort，避免任意一个析构异常阻断后续清理。
 * core 若在 AddonManager 之前失败，则反向重放已登记 wrapper，确保 fit/search
 * 仍释放；正常路径因 wrapper 幂等而保持 xterm 原生顺序。
 *
 * `hasFirstError` 与错误值分开记录，因为 JavaScript 允许 `throw undefined`
 * 或 `throw null`；仅用错误值判断会错误地吞掉这两类析构失败。
 */
export function disposeXtermTerminal(
  terminal: DisposableXtermTerminal,
  coordinator: XtermTerminalDisposalCoordinator,
  addonErrors?: XtermAddonDisposalErrorState,
): void {
  let hasFirstError = false;
  let firstError: unknown;

  try {
    terminal.dispose();
  } catch (error) {
    hasFirstError = true;
    firstError = error;
  }

  for (const addon of [...(addonErrors?.ownedAddons ?? [])].reverse()) {
    try {
      addon.dispose();
    } catch (error) {
      if (addonErrors && !addonErrors.hasFirstError) {
        addonErrors.hasFirstError = true;
        addonErrors.firstError = error;
      }
      if (!hasFirstError) {
        hasFirstError = true;
        firstError = error;
      }
    }
  }
  if (addonErrors) {
    addonErrors.ownedAddons.length = 0;
  }

  if (!hasFirstError && addonErrors?.hasFirstError) {
    hasFirstError = true;
    firstError = addonErrors.firstError;
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
