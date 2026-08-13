// @author kongweiguang

import addonWebglPackage from "@xterm/addon-webgl/package.json";
import xtermPackage from "@xterm/xterm/package.json";
import { runtimeCompatibilityDiagnostics } from "../../platform/runtime/compatibilityDiagnostics";

/** 已验证可使用 xterm WebGL 私有兼容清理的精确依赖版本。 */
export const VERIFIED_XTERM_WEBGL_COMPATIBILITY_VERSIONS = Object.freeze({
  webglAddon: "0.19.0",
  xterm: "6.0.0",
});

/**
 * 当前构建实际解析到的 xterm 与 WebGL addon 版本。
 *
 * 版本从构建依赖的 package.json 注入，避免把“已验证版本”误当作运行时
 * 依赖版本；依赖升级后，私有兼容路径会因为精确匹配失败而保持关闭。
 */
export const ACTUAL_XTERM_WEBGL_COMPATIBILITY_VERSIONS = Object.freeze({
  webglAddon: addonWebglPackage.version,
  xterm: xtermPackage.version,
});

/** compatibility adapter 接收的实际 xterm 与 WebGL addon 版本。 */
export interface XtermWebglCompatibilityVersions {
  webglAddon: string;
  xterm: string;
}

/** 私有兼容能力的显式开关；只有精确版本匹配时才会生效。 */
export interface XtermWebglCompatibilityCapabilityGate {
  forceContextLoss?: boolean;
  privateRendererCleanup?: boolean;
}

/** adapter 最终解析出的可用兼容能力。 */
interface XtermWebglCompatibilityCapabilities {
  forceContextLoss: boolean;
  privateRendererCleanup: boolean;
}

/** compatibility adapter 使用的最小日志接口。 */
interface XtermWebglCompatibilityLogger {
  warn(message: string, error?: unknown): void;
}

/** 公开 dispose 路径所需的最小 WebGL addon 契约。 */
interface XtermWebglDisposableAddon {
  dispose(): void;
}

/** controller 交给 adapter 释放的 addon 与已知 WebGL canvas。 */
interface XtermWebglDisposeTarget {
  addon: XtermWebglDisposableAddon;
  canvases?: Iterable<HTMLCanvasElement>;
  rendererCanvases?: Iterable<HTMLCanvasElement>;
}

/** 创建 compatibility adapter 的版本与能力配置。 */
export interface CreateXtermWebglCompatibilityAdapterOptions {
  capabilityGate?: XtermWebglCompatibilityCapabilityGate;
  logger?: XtermWebglCompatibilityLogger;
  versions: XtermWebglCompatibilityVersions;
}

/**
 * 供 renderer controller 后续接线的窄兼容接口。
 *
 * `dispose` 始终优先调用 addon 公开 API，并对 controller 跟踪的 canvas 使用
 * 版本无关的公开 context-loss/尺寸清零；版本私有逻辑只作为显式、精确版本
 * 命中的 best-effort 补充，任何异常都不会向调用方传播。
 */
export interface XtermWebglCompatibilityAdapter {
  readonly capabilities: Readonly<XtermWebglCompatibilityCapabilities>;
  dispose(target: XtermWebglDisposeTarget): void;
}

/**
 * 创建 xterm WebGL compatibility adapter。
 *
 * 未提供 capability gate 或版本不匹配时，adapter 仍执行公开 dispose 与
 * tracked canvas 的公开 context release；只有私有 reference cleanup 继续受
 * 精确版本 gate 保护，避免依赖升级后触碰未经验证的字段。
 */
export function createXtermWebglCompatibilityAdapter({
  capabilityGate,
  logger = console,
  versions,
}: CreateXtermWebglCompatibilityAdapterOptions): XtermWebglCompatibilityAdapter {
  const exactVersionMatch =
    versions.xterm === VERIFIED_XTERM_WEBGL_COMPATIBILITY_VERSIONS.xterm &&
    versions.webglAddon ===
      VERIFIED_XTERM_WEBGL_COMPATIBILITY_VERSIONS.webglAddon;
  if (
    !exactVersionMatch &&
    (capabilityGate?.forceContextLoss === true ||
      capabilityGate?.privateRendererCleanup === true)
  ) {
    runtimeCompatibilityDiagnostics.recordFailure(
      "terminal.xterm-webview-patch",
    );
    warnSafely(
      logger,
      `[kerminal-terminal-renderer] private WebGL compatibility disabled for unverified versions (xterm ${versions.xterm}, addon-webgl ${versions.webglAddon}; verified xterm ${VERIFIED_XTERM_WEBGL_COMPATIBILITY_VERSIONS.xterm}, addon-webgl ${VERIFIED_XTERM_WEBGL_COMPATIBILITY_VERSIONS.webglAddon}).`,
      undefined,
    );
  }
  const capabilities = Object.freeze({
    // 该 capability 仍只表示已审计的兼容激活；公开 canvas release 在下方
    // 无条件执行，不把版本无关 API 与私有 gate 语义混在一起。
    forceContextLoss:
      exactVersionMatch && capabilityGate?.forceContextLoss === true,
    privateRendererCleanup:
      exactVersionMatch && capabilityGate?.privateRendererCleanup === true,
  });

  return {
    capabilities,
    dispose({ addon, canvases = [], rendererCanvases = [] }) {
      // 公开 API 是唯一默认释放路径；即使它抛错，也继续执行已验证的兜底清理。
      runBestEffort(
        () => addon.dispose(),
        logger,
        "[kerminal-terminal-renderer] WebGL renderer dispose failed",
      );

      // 即使没有启用兼容 gate，也必须释放 controller 追踪的公开 canvas 资源；
      // 只对 WebGL 主 canvas 调 context API，避免把 2D texture atlas 误报为失败。
      releaseKnownCanvasContexts(rendererCanvases, logger);
      resetKnownCanvasDimensions(canvases, logger);
      if (capabilities.forceContextLoss) {
        runtimeCompatibilityDiagnostics.recordActivation(
          "terminal.xterm-webview-patch",
          "tauri-webview",
        );
      }
      if (capabilities.privateRendererCleanup) {
        if (!capabilities.forceContextLoss) {
          runtimeCompatibilityDiagnostics.recordActivation(
            "terminal.xterm-webview-patch",
            "tauri-webview",
          );
        }
        clearKnownPrivateRendererReferences(addon, logger);
      }
    },
  };
}

function releaseKnownCanvasContexts(
  canvases: Iterable<HTMLCanvasElement>,
  logger: XtermWebglCompatibilityLogger,
) {
  const released = new Set<HTMLCanvasElement>();
  try {
    for (const canvas of canvases) {
      if (released.has(canvas)) {
        continue;
      }
      released.add(canvas);
      releaseCanvasContext(canvas, logger);
    }
  } catch (error) {
    runtimeCompatibilityDiagnostics.recordFailure(
      "terminal.xterm-webview-patch",
    );
    warnSafely(
      logger,
      "[kerminal-terminal-renderer] WebGL canvas enumeration failed",
      error,
    );
  }
}

/**
 * 清零所有 tracked canvas 的 backing store；atlas 也必须覆盖，但不应尝试
 * 对它们调用 WebGL context API，因为 xterm WebGL atlas 使用的是 2D canvas。
 */
function resetKnownCanvasDimensions(
  canvases: Iterable<HTMLCanvasElement>,
  logger: XtermWebglCompatibilityLogger,
) {
  const reset = new Set<HTMLCanvasElement>();
  try {
    for (const canvas of canvases) {
      if (reset.has(canvas)) {
        continue;
      }
      reset.add(canvas);
      runBestEffort(
        () => {
          canvas.width = 0;
          canvas.height = 0;
        },
        logger,
        "[kerminal-terminal-renderer] WebGL canvas reset failed",
        true,
      );
    }
  } catch (error) {
    runtimeCompatibilityDiagnostics.recordFailure(
      "terminal.xterm-webview-patch",
    );
    warnSafely(
      logger,
      "[kerminal-terminal-renderer] WebGL canvas enumeration failed",
      error,
    );
  }
}

/**
 * 只对 rendererCanvases 调用公开的 WebGL context-loss 扩展；atlas 是 2D canvas，
 * 因此必须由调用方先分类，避免每次 pane teardown 都产生兼容性误报。
 */
function releaseCanvasContext(
  canvas: HTMLCanvasElement,
  logger: XtermWebglCompatibilityLogger,
) {
  const gl = resolveWebglContext(canvas);
  if (gl) {
    runBestEffort(
      () => {
        const extension = gl.getExtension("WEBGL_lose_context");
        if (extension && !gl.isContextLost()) {
          extension.loseContext();
        }
      },
      logger,
      "[kerminal-terminal-renderer] forced WebGL context loss failed",
      true,
    );
  }
}

function resolveWebglContext(
  canvas: HTMLCanvasElement,
): WebGL2RenderingContext | WebGLRenderingContext | null {
  try {
    const webgl2 = canvas.getContext("webgl2");
    if (webgl2) {
      return webgl2;
    }
  } catch {
    runtimeCompatibilityDiagnostics.recordFailure(
      "terminal.xterm-webview-patch",
    );
    // canvas 可能已绑定其它 context，继续尝试 WebGL 1。
  }
  try {
    return canvas.getContext("webgl");
  } catch {
    runtimeCompatibilityDiagnostics.recordFailure(
      "terminal.xterm-webview-patch",
    );
    return null;
  }
}

function clearKnownPrivateRendererReferences(
  addon: XtermWebglDisposableAddon,
  logger: XtermWebglCompatibilityLogger,
) {
  const root = asRecord(addon);
  if (!root) {
    return;
  }

  // 这些路径只对应 xterm 6.0.0 + addon-webgl 0.19.0 已审计过的对象形状。
  for (const key of ["_renderer", "_renderService"]) {
    let candidate: unknown;
    try {
      candidate = root[key];
    } catch (error) {
      runtimeCompatibilityDiagnostics.recordFailure(
        "terminal.xterm-webview-patch",
      );
      warnSafely(
        logger,
        "[kerminal-terminal-renderer] WebGL private renderer lookup failed",
        error,
      );
      continue;
    }
    clearRendererReferences(candidate, logger);
  }
}

function clearRendererReferences(
  candidate: unknown,
  logger: XtermWebglCompatibilityLogger,
) {
  const renderer = asRecord(candidate);
  if (!renderer) {
    return;
  }

  for (const key of [
    "_atlas",
    "_canvas",
    "_charAtlas",
    "_gl",
    "canvas",
    "gl",
  ]) {
    try {
      if (key in renderer) {
        renderer[key] = undefined;
      }
    } catch (error) {
      runtimeCompatibilityDiagnostics.recordFailure(
        "terminal.xterm-webview-patch",
      );
      warnSafely(
        logger,
        "[kerminal-terminal-renderer] WebGL private reference cleanup failed",
        error,
      );
    }
  }
}

function runBestEffort(
  action: () => void,
  logger: XtermWebglCompatibilityLogger,
  message: string,
  compatibilityPath = false,
) {
  try {
    action();
  } catch (error) {
    if (compatibilityPath) {
      runtimeCompatibilityDiagnostics.recordFailure(
        "terminal.xterm-webview-patch",
      );
    }
    warnSafely(logger, message, error);
  }
}

function warnSafely(
  logger: XtermWebglCompatibilityLogger,
  message: string,
  error: unknown,
) {
  try {
    logger.warn(message, error);
  } catch {
    // 日志实现也属于非关键依赖，不能反向破坏 renderer dispose。
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  return value as Record<string, unknown>;
}
