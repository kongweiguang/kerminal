// @author kongweiguang

import packageManifest from "../../../package.json";
import {
  resolveDesktopPlatform,
  type DesktopPlatform,
} from "../../lib/desktopPlatform";

/**
 * xterm 在桌面 WebView 上会触发卸载冻结的已知坏版本。
 *
 * Windows Tauri 使用 WebView2，macOS Tauri 使用 WKWebView。当前坏版本下，
 * 完整 `dispose()` 会让已经建立 SSH 会话的标签在卸载时主线程停滞、留下僵尸帧
 * （Windows 上是 WebView2 进程 OOM，macOS 上是 WKWebView 主线程卡住）。
 *
 * 必须从 manifest 严格匹配；升级到其他 xterm 版本时会自动退出本兼容分支。
 */
export const XTERM_DESKTOP_WEBVIEW_DISPOSE_BROKEN_VERSION = "6.1.0-beta.288";

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
  | "desktop-webview-gc-fallback";

/**
 * 释放 xterm runtime，并隔离桌面 WebView 已确认会让卸载冻结的精确版本组合。
 *
 * Windows（WebView2）与 macOS（WKWebView）命中当前坏版本时，调用方必须先释放
 * 项目拥有的 listeners/runtime 资源并清空 refs；本函数仅移除 `terminal.element`
 * 让剩余 xterm 对象随已断开的子树和引用一起回收，绝不在该路径下调用
 * `terminal.dispose()`。
 *
 * 其他平台（browser、linux）以及其他 xterm 版本始终保留公开 dispose 契约。
 */
export function disposeXtermTerminal(
  terminal: DisposableXtermTerminal,
  environment: XtermTerminalDisposalEnvironment = runtimeEnvironment(),
): XtermTerminalDisposalMode {
  if (shouldUseDesktopWebViewGcFallback(environment)) {
    terminal.element?.remove();
    return "desktop-webview-gc-fallback";
  }

  terminal.dispose();
  return "public-dispose";
}

/**
 * 判断当前环境是否需要走桌面 WebView 的 GC fallback：
 *  - xterm 版本必须严格等于当前 manifest 中声明的已知坏版本；
 *  - 平台必须是 Windows（WebView2）或 macOS（WKWebView）。
 *
 * 平台或版本不匹配时回到公开 dispose，不永久跳过 xterm 的正常释放路径。
 */
export function shouldUseDesktopWebViewGcFallback({
  desktopPlatform,
  xtermVersion,
}: XtermTerminalDisposalEnvironment): boolean {
  if (xtermVersion !== XTERM_DESKTOP_WEBVIEW_DISPOSE_BROKEN_VERSION) {
    return false;
  }
  return desktopPlatform === "windows" || desktopPlatform === "macos";
}

function runtimeEnvironment(): XtermTerminalDisposalEnvironment {
  return {
    desktopPlatform: resolveDesktopPlatform(),
    xtermVersion: packageManifest.dependencies["@xterm/xterm"],
  };
}
