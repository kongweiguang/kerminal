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

export interface XtermTerminalDisposalEnvironment {
  desktopPlatform: DesktopPlatform;
  xtermVersion: string;
}

export type XtermTerminalDisposalMode =
  | "public-dispose"
  | "webview2-gc-fallback";

/**
 * 释放 xterm runtime，并隔离已确认会让 WebView2 OOM 的精确版本组合。
 *
 * Windows Tauri 使用 WebView2。xterm 6.1.0-beta.288 的完整 dispose 会在
 * 分屏卸载时耗尽 WebView 进程内存；此组合先由调用方释放项目拥有的资源，
 * 再主动移除 terminal DOM，让剩余 xterm 对象随已断开的子树和引用一起回收。
 * 版本或平台不匹配时始终保留公开 dispose 契约。
 */
export function disposeXtermTerminal(
  terminal: DisposableXtermTerminal,
  environment: XtermTerminalDisposalEnvironment = runtimeEnvironment(),
): XtermTerminalDisposalMode {
  if (shouldUseWebView2GcFallback(environment)) {
    terminal.element?.remove();
    return "webview2-gc-fallback";
  }

  terminal.dispose();
  return "public-dispose";
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
