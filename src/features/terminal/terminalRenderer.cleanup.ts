// @author kongweiguang

import type { XtermWebglCompatibilityAdapter } from "./terminalRendererCompatibility";
import type { ActiveWebglRenderer } from "./terminalRenderer.webglResources";

interface RendererCleanupLogger {
  warn(message: string, error?: unknown): void;
}

/**
 * 释放可替换 WebGL renderer 的所有权；每个 addon/listener 单独隔离异常，
 * 这样 xterm pane 卸载不会因一个兼容层失败而保留其它 canvas 引用。
 */
export function disposeWebglRendererResources(
  renderer: ActiveWebglRenderer,
  compatibility: XtermWebglCompatibilityAdapter,
  logger: RendererCleanupLogger,
) {
  for (const disposable of renderer.disposables) {
    runRendererCleanup(
      logger,
      "[kerminal-terminal-renderer] dispose event failed",
      () => disposable.dispose(),
    );
  }
  renderer.disposables.length = 0;
  runRendererCleanup(
    logger,
    "[kerminal-terminal-renderer] compatibility dispose failed",
    () =>
      compatibility.dispose({
        addon: renderer.addon,
        canvases: renderer.canvases,
      }),
  );
}

/** 日志实现也是外部依赖，不能让它的异常中断 renderer 资源回收。 */
export function runRendererCleanup(
  logger: RendererCleanupLogger,
  message: string,
  cleanup: () => void,
) {
  try {
    cleanup();
  } catch (error) {
    try {
      logger.warn(message, error);
    } catch {
      // 清理路径不能再被失败的日志实现阻断。
    }
  }
}
