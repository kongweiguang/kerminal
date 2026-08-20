// @author kongweiguang

import type {
  IDecoration,
  IDisposable,
  IMarker,
  Terminal as XtermTerminal,
} from "@xterm/xterm";
import {
  terminalKeywordHighlightColorsForTheme,
  type ResolvedTheme,
  type TerminalKeywordHighlightSettings,
} from "../settings/contracts/index";
import {
  compileTerminalKeywordHighlights,
  findTerminalKeywordHighlightMatches,
  type CompiledTerminalKeywordHighlights,
} from "./terminalKeywordHighlightMatcher";
import {
  buildTerminalBufferLogicalLines,
  terminalDecorationSegmentsForTextRange,
} from "./terminalBufferDecorationModel";

export const TERMINAL_KEYWORD_HIGHLIGHT_DECORATION_LIMIT = 1_000;

interface TerminalKeywordHighlightFrameScheduler {
  cancel(frameId: number): void;
  request(callback: () => void): number;
}

interface CreateTerminalKeywordHighlightControllerOptions {
  resolvedTheme: ResolvedTheme;
  scheduler?: TerminalKeywordHighlightFrameScheduler;
  settings: TerminalKeywordHighlightSettings;
  terminal: XtermTerminal;
  visible: boolean;
}

interface TerminalKeywordHighlightControllerSnapshot {
  capped: boolean;
  compileErrorCount: number;
  decorationCount: number;
  disposed: boolean;
  lastScannedLineCount: number;
  scanCount: number;
  suspended: boolean;
}

export interface TerminalKeywordHighlightController {
  dispose(): void;
  getSnapshot(): TerminalKeywordHighlightControllerSnapshot;
  rescan(): void;
  update(options: {
    resolvedTheme: ResolvedTheme;
    settings: TerminalKeywordHighlightSettings;
    visible: boolean;
  }): void;
}

/**
 * 为单个 xterm 创建可热更新的关键词高亮 controller；所有订阅、异步编译、marker
 * 和 decoration 都归该实例所有，调用方必须在 xterm core dispose 之前释放它。
 */
export function createTerminalKeywordHighlightController({
  resolvedTheme,
  scheduler = browserFrameScheduler,
  settings,
  terminal,
  visible,
}: CreateTerminalKeywordHighlightControllerOptions): TerminalKeywordHighlightController {
  let currentSettings = settings;
  let currentTheme = resolvedTheme;
  let currentVisible = visible;
  let settingsFingerprint = "";
  let compiled: CompiledTerminalKeywordHighlights | null = null;
  let compileRevision = 0;
  let compileErrorCount = 0;
  let disposed = false;
  let frameId: number | null = null;
  const decorations: IDecoration[] = [];
  const markers: IMarker[] = [];
  const snapshot: TerminalKeywordHighlightControllerSnapshot = {
    capped: false,
    compileErrorCount: 0,
    decorationCount: 0,
    disposed: false,
    lastScannedLineCount: 0,
    scanCount: 0,
    suspended: false,
  };

  /** 先释放 decoration 再释放共享 marker，确保 xterm 不会在 marker 销毁回调中读悬空样式。 */
  const clearDecorations = () => {
    for (const decoration of decorations.splice(0)) {
      decoration.dispose();
    }
    for (const marker of markers.splice(0)) {
      marker.dispose();
    }
    snapshot.decorationCount = 0;
  };

  /** 同一动画帧内无论解析、滚动和 resize 触发多少次，只执行一次可见区重扫。 */
  const scheduleScan = () => {
    if (disposed || frameId !== null) {
      return;
    }
    frameId = scheduler.request(() => {
      frameId = null;
      scanVisibleBuffer();
    });
  };

  /**
   * 扫描 normal buffer 的当前视口及上下各一屏；alternate buffer、隐藏窗格和总开关
   * 均清空装饰后暂停，回到 normal/可见状态时由事件或 update 重新扫描。
   */
  const scanVisibleBuffer = () => {
    if (disposed) {
      return;
    }
    const activeBuffer = terminal.buffer.active;
    const activeCompiled = compiled;
    const suspended =
      !currentVisible ||
      !currentSettings.enabled ||
      activeBuffer.type !== "normal" ||
      !activeCompiled ||
      activeCompiled.rules.length === 0;
    snapshot.suspended = suspended;
    if (suspended) {
      clearDecorations();
      snapshot.lastScannedLineCount = 0;
      return;
    }
    if (!activeCompiled) {
      return;
    }

    const normalBuffer = terminal.buffer.normal;
    const startRow = Math.max(0, normalBuffer.viewportY - terminal.rows);
    const endRow = Math.min(
      normalBuffer.length,
      normalBuffer.viewportY + terminal.rows * 2,
    );
    const logicalLines = buildTerminalBufferLogicalLines(
      normalBuffer,
      terminal.cols,
      startRow,
      endRow,
    );
    clearDecorations();
    snapshot.scanCount += 1;
    snapshot.lastScannedLineCount = logicalLines.reduce(
      (count, line) => count + line.endRow - line.startRow + 1,
      0,
    );
    snapshot.capped = false;

    const markerByRow = new Map<number, IMarker>();
    const cursorAbsoluteRow = normalBuffer.baseY + normalBuffer.cursorY;
    for (const logicalLine of logicalLines) {
      const matches = findTerminalKeywordHighlightMatches(
        activeCompiled,
        logicalLine.text,
        TERMINAL_KEYWORD_HIGHLIGHT_DECORATION_LIMIT - decorations.length,
      );
      for (const match of matches) {
        const segments = terminalDecorationSegmentsForTextRange(
          logicalLine.cells,
          match.start,
          match.end,
        );
        for (const segment of segments) {
          if (decorations.length >= TERMINAL_KEYWORD_HIGHLIGHT_DECORATION_LIMIT) {
            snapshot.capped = true;
            break;
          }
          let marker = markerByRow.get(segment.row);
          if (!marker || marker.isDisposed) {
            marker = terminal.registerMarker(segment.row - cursorAbsoluteRow);
            if (!marker) {
              continue;
            }
            markerByRow.set(segment.row, marker);
            markers.push(marker);
          }
          const colors = terminalKeywordHighlightColorsForTheme(
            match.rule,
            currentTheme,
          );
          const decoration = terminal.registerDecoration?.({
            marker,
            x: segment.x,
            width: segment.width,
            layer: "bottom",
            ...(colors.background
              ? { backgroundColor: colors.background }
              : {}),
            ...(colors.foreground
              ? { foregroundColor: colors.foreground }
              : {}),
          });
          if (decoration) {
            decorations.push(decoration);
          }
        }
        if (snapshot.capped) {
          break;
        }
      }
      if (snapshot.capped) {
        break;
      }
    }
    snapshot.decorationCount = decorations.length;
    snapshot.capped =
      snapshot.capped ||
      decorations.length >= TERMINAL_KEYWORD_HIGHLIGHT_DECORATION_LIMIT;
  };

  /** 编译通过 revision 门控原子替换，旧异步结果晚到时立即 dispose，避免缓存泄漏。 */
  const replaceCompiledRules = (nextSettings: TerminalKeywordHighlightSettings) => {
    const revision = ++compileRevision;
    void compileTerminalKeywordHighlights(nextSettings)
      .then((nextCompiled) => {
        if (disposed || revision !== compileRevision) {
          nextCompiled.dispose();
          return;
        }
        compiled?.dispose();
        compiled = nextCompiled;
        compileErrorCount = nextCompiled.errors.size;
        snapshot.compileErrorCount = compileErrorCount;
        scheduleScan();
      })
      .catch(() => {
        if (disposed || revision !== compileRevision) {
          return;
        }
        compiled?.dispose();
        compiled = null;
        compileErrorCount = 1;
        snapshot.compileErrorCount = compileErrorCount;
        clearDecorations();
      });
  };

  const subscriptions: IDisposable[] = [
    terminal.onWriteParsed(scheduleScan),
    terminal.onScroll(scheduleScan),
    terminal.buffer.onBufferChange(scheduleScan),
  ];
  const resizeSubscription = terminal.onResize?.(scheduleScan);
  if (resizeSubscription) {
    subscriptions.push(resizeSubscription);
  }

  /** 初始设置走与热更新完全相同的指纹/编译路径，避免安装时出现第二套状态机。 */
  const applySettings = (nextSettings: TerminalKeywordHighlightSettings) => {
    const nextFingerprint = JSON.stringify(nextSettings);
    currentSettings = nextSettings;
    if (nextFingerprint === settingsFingerprint) {
      return;
    }
    settingsFingerprint = nextFingerprint;
    replaceCompiledRules(nextSettings);
  };

  const controller: TerminalKeywordHighlightController = {
    /** 按订阅→帧任务→异步编译→装饰→匹配器顺序释放，最后不再触碰 xterm。 */
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      compileRevision += 1;
      for (const subscription of subscriptions.splice(0)) {
        subscription.dispose();
      }
      if (frameId !== null) {
        scheduler.cancel(frameId);
        frameId = null;
      }
      clearDecorations();
      compiled?.dispose();
      compiled = null;
      snapshot.disposed = true;
      snapshot.suspended = true;
    },
    /** 返回只读统计快照的副本，供测试和后续诊断验证装饰上限与清理。 */
    getSnapshot() {
      return { ...snapshot };
    },
    /** 外部显式请求仍经过 RAF 合并，避免与同帧解析事件重复扫描。 */
    rescan() {
      scheduleScan();
    },
    /** 规则变化重新编译，主题/可见性变化只重画装饰，不重建 RE2 程序。 */
    update(options) {
      if (disposed) {
        return;
      }
      const themeChanged = currentTheme !== options.resolvedTheme;
      const visibilityChanged = currentVisible !== options.visible;
      currentTheme = options.resolvedTheme;
      currentVisible = options.visible;
      applySettings(options.settings);
      if (!currentVisible) {
        clearDecorations();
        snapshot.suspended = true;
        return;
      }
      if (themeChanged || visibilityChanged) {
        scheduleScan();
      }
    },
  };

  applySettings(settings);
  return controller;
}

/** 浏览器 scheduler 在无 RAF 的单测环境退化到 timer，但保持可取消和单帧合并语义。 */
const browserFrameScheduler: TerminalKeywordHighlightFrameScheduler = {
  cancel(frameId) {
    if (typeof window.cancelAnimationFrame === "function") {
      window.cancelAnimationFrame(frameId);
    } else {
      window.clearTimeout(frameId);
    }
  },
  request(callback) {
    return typeof window.requestAnimationFrame === "function"
      ? window.requestAnimationFrame(callback)
      : window.setTimeout(callback, 16);
  },
};
