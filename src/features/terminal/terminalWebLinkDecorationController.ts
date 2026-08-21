// @author kongweiguang

import type {
  IDecoration,
  IDisposable,
  IMarker,
  ITheme,
  Terminal as XtermTerminal,
} from "@xterm/xterm";
import type { ResolvedTheme } from "../settings/contracts/index";
import {
  buildTerminalBufferLogicalLines,
  terminalDecorationSegmentsForTextRange,
} from "./terminalBufferDecorationModel";
import { findTerminalWebLinkRanges } from "./terminalWebLinks";

const TERMINAL_WEB_LINK_DECORATION_LIMIT = 1_000;

const TERMINAL_WEB_LINK_MINIMUM_CONTRAST_RATIO = 4.5;

interface TerminalWebLinkDecorationFrameScheduler {
  cancel(frameId: number): void;
  request(callback: () => void): number;
}

interface CreateTerminalWebLinkDecorationControllerOptions {
  foregroundColor: string;
  scheduler?: TerminalWebLinkDecorationFrameScheduler;
  terminal: XtermTerminal;
  visible: boolean;
}

interface TerminalWebLinkDecorationControllerSnapshot {
  capped: boolean;
  decorationCount: number;
  disposed: boolean;
  scanCount: number;
  suspended: boolean;
}

interface TerminalWebLinkDecorationRecord {
  decoration: IDecoration;
  marker: IMarker;
  width: number;
  x: number;
}

export interface TerminalWebLinkDecorationController {
  dispose(): void;
  getSnapshot(): TerminalWebLinkDecorationControllerSnapshot;
  rescan(): void;
  update(options: { foregroundColor: string; visible: boolean }): void;
}

/**
 * xterm decoration 只接受 #RRGGBB，因此优先采用当前终端配色的 blue token；
 * 非标准自定义值回退到 Kerminal 对应明暗色，保证不会因主题格式失去链接提示。
 */
export function terminalWebLinkDecorationColorForTheme(
  terminalTheme: ITheme,
  resolvedTheme: ResolvedTheme,
): string {
  for (const candidate of [terminalTheme.blue, terminalTheme.brightBlue]) {
    if (candidate && /^#[0-9a-f]{6}$/i.test(candidate)) {
      return ensureTerminalWebLinkContrast(
        terminalTheme.background,
        candidate,
        TERMINAL_WEB_LINK_MINIMUM_CONTRAST_RATIO,
      );
    }
  }
  return resolvedTheme === "light" ? "#0a84ff" : "#60a5fa";
}

/**
 * 复用 xterm 的 10% 逐步增减亮度策略预先达到相同对比度，确保 renderer 不再
 * 二次改色，从而让文字和独立 DOM 下划线在浅色主题下也保持完全一致。
 */
function ensureTerminalWebLinkContrast(
  background: string | undefined,
  foreground: string,
  minimumRatio: number,
): string {
  const backgroundRgb = parseTerminalDecorationHexColor(background);
  const foregroundRgb = parseTerminalDecorationHexColor(foreground);
  if (!backgroundRgb || !foregroundRgb) {
    return foreground;
  }
  const backgroundLuminance = terminalDecorationRelativeLuminance(backgroundRgb);
  const foregroundLuminance = terminalDecorationRelativeLuminance(foregroundRgb);
  if (
    terminalDecorationContrastRatio(
      backgroundLuminance,
      foregroundLuminance,
    ) >= minimumRatio
  ) {
    return foreground;
  }

  const preferredDirection =
    foregroundLuminance < backgroundLuminance ? "darker" : "lighter";
  const preferred = adjustTerminalDecorationLuminance(
    backgroundRgb,
    foregroundRgb,
    minimumRatio,
    preferredDirection,
  );
  const preferredRatio = terminalDecorationContrastRatio(
    backgroundLuminance,
    terminalDecorationRelativeLuminance(preferred),
  );
  if (preferredRatio >= minimumRatio) {
    return terminalDecorationHexColor(preferred);
  }

  const alternative = adjustTerminalDecorationLuminance(
    backgroundRgb,
    foregroundRgb,
    minimumRatio,
    preferredDirection === "darker" ? "lighter" : "darker",
  );
  const alternativeRatio = terminalDecorationContrastRatio(
    backgroundLuminance,
    terminalDecorationRelativeLuminance(alternative),
  );
  return terminalDecorationHexColor(
    alternativeRatio > preferredRatio ? alternative : preferred,
  );
}

/** 解析 decoration API 支持的六位十六进制颜色；透明或 CSS 函数色保持原值。 */
function parseTerminalDecorationHexColor(
  color: string | undefined,
): [number, number, number] | null {
  if (!color || !/^#[0-9a-f]{6}$/i.test(color)) {
    return null;
  }
  return [
    Number.parseInt(color.slice(1, 3), 16),
    Number.parseInt(color.slice(3, 5), 16),
    Number.parseInt(color.slice(5, 7), 16),
  ];
}

/** 按 WCAG sRGB 定义计算相对亮度，与 xterm minimumContrastRatio 的输入一致。 */
function terminalDecorationRelativeLuminance(
  [red, green, blue]: readonly number[],
): number {
  const channels = [red, green, blue].map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

/** 计算两个相对亮度之间的 WCAG 对比度，参数顺序不影响结果。 */
function terminalDecorationContrastRatio(first: number, second: number): number {
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * 每轮向黑或白移动剩余通道的 10%，与 xterm 当前 ensureContrastRatio 算法同步；
 * 最多 64 轮是防御上限，正常八位通道会在远少于该次数时到达端点。
 */
function adjustTerminalDecorationLuminance(
  background: readonly number[],
  foreground: readonly number[],
  minimumRatio: number,
  direction: "darker" | "lighter",
): [number, number, number] {
  const adjusted: [number, number, number] = [
    foreground[0],
    foreground[1],
    foreground[2],
  ];
  const backgroundLuminance = terminalDecorationRelativeLuminance(background);
  for (let step = 0; step < 64; step += 1) {
    const ratio = terminalDecorationContrastRatio(
      backgroundLuminance,
      terminalDecorationRelativeLuminance(adjusted),
    );
    if (ratio >= minimumRatio) {
      break;
    }
    let changed = false;
    for (let index = 0; index < adjusted.length; index += 1) {
      const current = adjusted[index];
      const next =
        direction === "darker"
          ? current - Math.max(0, Math.ceil(current * 0.1))
          : Math.min(255, current + Math.ceil((255 - current) * 0.1));
      adjusted[index] = next;
      changed = changed || next !== current;
    }
    if (!changed) {
      break;
    }
  }
  return adjusted;
}

/** 将已校正的 RGB 通道序列化为 xterm decoration 接受的 #RRGGBB。 */
function terminalDecorationHexColor(channels: readonly number[]): string {
  return `#${channels
    .map((channel) => channel.toString(16).padStart(2, "0"))
    .join("")}`;
}

/**
 * decoration 的 DOM 元素仅承担持续下划线，不应截获点击或拖选；文本颜色仍由
 * xterm renderer 原生绘制，因而 DOM、canvas 与 WebGL renderer 使用同一前景色。
 */
export function styleTerminalWebLinkDecorationElement(
  element: HTMLElement,
  foregroundColor: string,
): void {
  element.style.borderBottomColor = foregroundColor;
  element.style.borderBottomStyle = "solid";
  element.style.borderBottomWidth = "1px";
  element.style.boxSizing = "border-box";
  element.style.pointerEvents = "none";
}

/**
 * 使用 marker 的实时绝对行号生成稳定键；滚动回卷后 marker 会自行迁移，因此不能
 * 缓存扫描时的旧行号，否则未变化的链接仍会被误判为需要重建。
 */
function terminalWebLinkDecorationKey(
  row: number,
  x: number,
  width: number,
): string {
  return `${row}:${x}:${width}`;
}

/**
 * 为单个 xterm 创建 URL 持久装饰 controller；它只扫描 normal buffer 当前视口
 * 上下各一屏，并在 core dispose 前释放订阅、marker 与 decoration，控制长期开销。
 */
export function createTerminalWebLinkDecorationController({
  foregroundColor,
  scheduler = browserFrameScheduler,
  terminal,
  visible,
}: CreateTerminalWebLinkDecorationControllerOptions): TerminalWebLinkDecorationController {
  let currentForegroundColor = foregroundColor;
  let currentVisible = visible;
  let disposed = false;
  let frameId: number | null = null;
  let recreateDecorations = false;
  const decorationRecords: TerminalWebLinkDecorationRecord[] = [];
  const markers = new Set<IMarker>();
  const snapshot: TerminalWebLinkDecorationControllerSnapshot = {
    capped: false,
    decorationCount: 0,
    disposed: false,
    scanCount: 0,
    suspended: false,
  };

  /** 先释放装饰再释放共享 marker，避免 marker 回调访问已销毁的 DOM 装饰。 */
  const clearDecorations = () => {
    for (const record of decorationRecords.splice(0)) {
      record.decoration.dispose();
    }
    for (const marker of markers) {
      marker.dispose();
    }
    markers.clear();
    snapshot.decorationCount = 0;
  };

  /** 同一帧内合并解析、滚动和 resize 事件，防止连续 PTY 输出触发重复正则扫描。 */
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
   * URL 识别和点击 provider 共用正则，视觉换行再拆成物理 cell 段；普通输出只对
   * 位置发生变化的装饰做增删，避免 TUI 高频局部重绘让稳定 URL 的下划线闪烁。
   * alternate buffer 不支持 proposed decoration，切换进去时仍主动清空。
   */
  const scanVisibleBuffer = () => {
    if (disposed) {
      return;
    }
    const activeBuffer = terminal.buffer.active;
    const suspended = !currentVisible || activeBuffer.type !== "normal";
    snapshot.suspended = suspended;
    if (suspended) {
      clearDecorations();
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
    snapshot.scanCount += 1;
    snapshot.capped = false;

    const existingByKey = new Map<string, TerminalWebLinkDecorationRecord>();
    const markerByRow = new Map<number, IMarker>();
    for (const marker of markers) {
      if (!marker.isDisposed && marker.line >= 0 && !markerByRow.has(marker.line)) {
        markerByRow.set(marker.line, marker);
      }
    }
    if (!recreateDecorations) {
      for (const record of decorationRecords) {
        if (record.marker.isDisposed || record.decoration.isDisposed) {
          continue;
        }
        existingByKey.set(
          terminalWebLinkDecorationKey(
            record.marker.line,
            record.x,
            record.width,
          ),
          record,
        );
      }
    }

    const nextRecords: TerminalWebLinkDecorationRecord[] = [];
    const cursorAbsoluteRow = normalBuffer.baseY + normalBuffer.cursorY;
    for (const logicalLine of logicalLines) {
      const ranges = findTerminalWebLinkRanges(logicalLine.text);
      for (const range of ranges) {
        const segments = terminalDecorationSegmentsForTextRange(
          logicalLine.cells,
          range.start,
          range.end,
        );
        for (const segment of segments) {
          if (nextRecords.length >= TERMINAL_WEB_LINK_DECORATION_LIMIT) {
            snapshot.capped = true;
            break;
          }
          const key = terminalWebLinkDecorationKey(
            segment.row,
            segment.x,
            segment.width,
          );
          const existing = existingByKey.get(key);
          if (existing) {
            existingByKey.delete(key);
            nextRecords.push(existing);
            continue;
          }

          let marker = markerByRow.get(segment.row);
          if (!marker || marker.isDisposed) {
            marker = terminal.registerMarker(segment.row - cursorAbsoluteRow);
            if (!marker) {
              continue;
            }
            markerByRow.set(segment.row, marker);
            markers.add(marker);
          }
          const decoration = terminal.registerDecoration?.({
            foregroundColor: currentForegroundColor,
            layer: "bottom",
            marker,
            width: segment.width,
            x: segment.x,
          });
          if (!decoration) {
            continue;
          }
          decoration.onRender((element) =>
            styleTerminalWebLinkDecorationElement(
              element,
              currentForegroundColor,
            ),
          );
          nextRecords.push({
            decoration,
            marker,
            width: segment.width,
            x: segment.x,
          });
        }
        if (snapshot.capped) {
          break;
        }
      }
      if (snapshot.capped) {
        break;
      }
    }

    const retainedRecords = new Set(nextRecords);
    for (const record of decorationRecords) {
      if (!retainedRecords.has(record)) {
        record.decoration.dispose();
      }
    }
    decorationRecords.splice(0, decorationRecords.length, ...nextRecords);

    const retainedMarkers = new Set(nextRecords.map((record) => record.marker));
    for (const marker of markers) {
      if (!retainedMarkers.has(marker)) {
        marker.dispose();
        markers.delete(marker);
      }
    }

    recreateDecorations = false;
    snapshot.decorationCount = decorationRecords.length;
    snapshot.capped =
      snapshot.capped ||
      decorationRecords.length >= TERMINAL_WEB_LINK_DECORATION_LIMIT;
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

  const controller: TerminalWebLinkDecorationController = {
    /** 按订阅、帧任务、装饰、marker 的所有权顺序释放，之后不再访问 xterm core。 */
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      for (const subscription of subscriptions.splice(0)) {
        subscription.dispose();
      }
      if (frameId !== null) {
        scheduler.cancel(frameId);
        frameId = null;
      }
      clearDecorations();
      snapshot.disposed = true;
      snapshot.suspended = true;
    },
    /** 返回统计副本，供回归测试验证扫描合并、上限与清理，不暴露可变内部数组。 */
    getSnapshot() {
      return { ...snapshot };
    },
    /** 外部刷新仍进入帧合并队列，避免与同帧终端解析事件重复工作。 */
    rescan() {
      scheduleScan();
    },
    /** 主题和可见性热更新只重画 decoration，不重建终端或点击 provider。 */
    update(options) {
      if (disposed) {
        return;
      }
      const colorChanged = currentForegroundColor !== options.foregroundColor;
      const visibilityChanged = currentVisible !== options.visible;
      currentForegroundColor = options.foregroundColor;
      currentVisible = options.visible;
      recreateDecorations = recreateDecorations || colorChanged;
      if (!currentVisible) {
        clearDecorations();
        snapshot.suspended = true;
        return;
      }
      if (colorChanged || visibilityChanged) {
        scheduleScan();
      }
    },
  };

  scheduleScan();
  return controller;
}

/** 浏览器 scheduler 在无 RAF 的单测环境退化到 timer，同时保留可取消与单帧合并。 */
const browserFrameScheduler: TerminalWebLinkDecorationFrameScheduler = {
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
