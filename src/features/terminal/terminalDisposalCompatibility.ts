// @author kongweiguang

import packageManifest from "../../../package.json";
import {
  resolveDesktopPlatform,
  type DesktopPlatform,
} from "../../lib/desktopPlatform";

export const XTERM_WEBVIEW2_DISPOSE_OOM_VERSION = "6.1.0-beta.288";

interface DisposableXtermTerminal {
  dispose(): void;
  element?: HTMLElement;
}

interface XtermTerminalDisposalCoordinator {
  unregisterRenderer(): void;
}

export interface XtermTerminalDisposalEnvironment {
  desktopPlatform: DesktopPlatform;
  xtermVersion: string;
}

export type XtermTerminalDisposalMode =
  | "public-dispose"
  | "webview2-gc-fallback";

/**
 * 按固定所有权顺序关闭 xterm runtime，并为已确认会让 WebView2 OOM 的精确
 * 版本组合保留保守的 GC 回退。
 *
 * 正常路径（macOS、Linux、browser 以及其它 xterm 版本）：先 unregisterRenderer，
 * 由 registry 对仍可用的 controller 执行普通 dispose 并完整释放 WebGL addon；
 * 随后 terminal.dispose 释放 xterm core 与其余 addon。顺序固定为
 * registry/controller dispose（addon 释放）-> xterm dispose。
 *
 * 问题组合（Windows + XTERM_WEBVIEW2_DISPOSE_OOM_VERSION）：绝不调用
 * terminal.dispose。同样先 unregisterRenderer，让 registry 释放 addon，再主动
 * 移除 terminal DOM，让剩余 xterm 对象随已断开的子树和引用一起回收。顺序固定为
 * registry/controller dispose -> element remove。
 *
 * 任一步骤抛错都会继续完成剩余清理（best-effort），并把第一个异常重新抛出，
 * 保证调用方不会因为资源析构失败而留下 registry 或 React refs。
 */
export function disposeXtermTerminal(
  terminal: DisposableXtermTerminal,
  coordinator: XtermTerminalDisposalCoordinator,
  environment: XtermTerminalDisposalEnvironment = runtimeEnvironment(),
): XtermTerminalDisposalMode {
  const mode = shouldUseWebView2GcFallback(environment)
    ? "webview2-gc-fallback"
    : "public-dispose";
  let firstError: unknown;
  try {
    coordinator.unregisterRenderer();
  } catch (error) {
    firstError ??= error;
  }
  try {
    if (mode === "webview2-gc-fallback") {
      terminal.element?.remove();
    } else {
      terminal.dispose();
    }
  } catch (error) {
    firstError ??= error;
  }
  if (firstError !== undefined) {
    throw firstError;
  }
  return mode;
}

export function shouldUseWebView2GcFallback({
  desktopPlatform,
  xtermVersion,
}: XtermTerminalDisposalEnvironment): boolean {
  return (
    desktopPlatform === "windows" &&
    xtermVersion === XTERM_WEBVIEW2_DISPOSE_OOM_VERSION
  );
}

function runtimeEnvironment(): XtermTerminalDisposalEnvironment {
  return {
    desktopPlatform: resolveDesktopPlatform(),
    xtermVersion: packageManifest.dependencies["@xterm/xterm"],
  };
}
