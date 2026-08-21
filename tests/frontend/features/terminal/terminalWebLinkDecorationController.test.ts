// @author kongweiguang

import type {
  IBuffer,
  IBufferCell,
  IBufferLine,
  IDecorationOptions,
  IDisposable,
  ITheme,
  Terminal as XtermTerminal,
} from "@xterm/xterm";
import { describe, expect, it } from "vitest";
import { xtermThemeFor } from "../../../../src/features/settings/terminalTheme";
import {
  createTerminalWebLinkDecorationController,
  styleTerminalWebLinkDecorationElement,
  terminalWebLinkDecorationColorForTheme,
} from "../../../../src/features/terminal/terminalWebLinkDecorationController";

interface FakeDecorationRecord {
  disposed: boolean;
  options: IDecorationOptions;
  render(element: HTMLElement): void;
}

/** 构造单宽文本行；wrapped 标志用于覆盖跨物理行 URL 的 cell 拆分。 */
function textLine(text: string, isWrapped = false): IBufferLine {
  const cells = Array.from(text, (chars) => fakeCell(chars));
  return {
    getCell: (index: number) => cells[index],
    isWrapped,
    length: cells.length,
    translateToString: () => text,
  } as IBufferLine;
}

/** 创建只实现逻辑行映射所需字段的单宽 xterm cell。 */
function fakeCell(chars: string): IBufferCell {
  return {
    getChars: () => chars,
    getWidth: () => 1,
  } as IBufferCell;
}

/** 创建带 cursor 与 viewport 坐标的最小 normal/alternate buffer。 */
function fakeBuffer(
  lines: IBufferLine[],
  patch: Partial<IBuffer> = {},
): IBuffer {
  return {
    baseY: 0,
    cursorX: 0,
    cursorY: Math.max(0, lines.length - 1),
    getLine: (index: number) => lines[index],
    getNullCell: () => fakeCell(""),
    length: lines.length,
    type: "normal",
    viewportY: 0,
    ...patch,
  } as IBuffer;
}

class FakeEvent<T> {
  readonly listeners = new Set<(value: T) => void>();

  /** 按 xterm IEvent 形状登记监听器，并支持验证 controller 完整解绑。 */
  readonly subscribe = (listener: (value: T) => void): IDisposable => {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  };

  /** 复制监听器集合后同步发出事件，允许回调在执行中安全释放订阅。 */
  emit(value: T): void {
    for (const listener of [...this.listeners]) {
      listener(value);
    }
  }
}

class ManualFrameScheduler {
  private nextId = 1;
  private readonly callbacks = new Map<number, () => void>();

  /** 取消尚未执行的扫描帧。 */
  cancel = (frameId: number): void => {
    this.callbacks.delete(frameId);
  };

  /** 保存扫描回调，让测试可以精确控制事件合并时机。 */
  request = (callback: () => void): number => {
    const frameId = this.nextId;
    this.nextId += 1;
    this.callbacks.set(frameId, callback);
    return frameId;
  };

  /** 执行当前批次，回调中新登记的帧保留到下一次 flush。 */
  flush(): void {
    const current = [...this.callbacks.entries()];
    for (const [frameId] of current) {
      this.callbacks.delete(frameId);
    }
    for (const [, callback] of current) {
      callback();
    }
  }

  /** 暴露待执行帧数量，验证多个 xterm 事件只排队一次。 */
  get size(): number {
    return this.callbacks.size;
  }
}

/** 构造 URL controller 所需的公开 xterm 事件、marker 与 decoration API。 */
function fakeTerminal(lines: IBufferLine[], cols = 80, rows = 24) {
  const normal = fakeBuffer(lines);
  const alternate = fakeBuffer([], { type: "alternate" });
  const bufferChange = new FakeEvent<IBuffer>();
  const resize = new FakeEvent<unknown>();
  const scroll = new FakeEvent<number>();
  const writeParsed = new FakeEvent<void>();
  const markers: Array<{ disposed: boolean; isDisposed: boolean; line: number }> = [];
  const decorations: FakeDecorationRecord[] = [];
  const namespace = {
    active: normal,
    alternate,
    normal,
    onBufferChange: bufferChange.subscribe,
  };

  const terminal = {
    buffer: namespace,
    cols,
    onResize: resize.subscribe,
    onScroll: scroll.subscribe,
    onWriteParsed: writeParsed.subscribe,
    registerDecoration(options: IDecorationOptions) {
      let renderListener: ((element: HTMLElement) => void) | null = null;
      const record: FakeDecorationRecord = {
        disposed: false,
        options,
        render(element) {
          renderListener?.(element);
        },
      };
      decorations.push(record);
      return {
        dispose: () => {
          record.disposed = true;
        },
        element: undefined,
        isDisposed: false,
        marker: options.marker,
        onDispose: () => ({ dispose: () => undefined }),
        onRender: (listener: (element: HTMLElement) => void) => {
          renderListener = listener;
          return { dispose: () => (renderListener = null) };
        },
        options: {},
      };
    },
    registerMarker(offset = 0) {
      const marker = {
        disposed: false,
        id: markers.length + 1,
        isDisposed: false,
        line: normal.baseY + normal.cursorY + offset,
        onDispose: () => ({ dispose: () => undefined }),
        dispose() {
          marker.disposed = true;
          marker.isDisposed = true;
          marker.line = -1;
        },
      };
      markers.push(marker);
      return marker;
    },
    rows,
  } as unknown as XtermTerminal;

  return {
    alternate,
    bufferChange,
    decorations,
    markers,
    namespace,
    normal,
    resize,
    scroll,
    terminal,
    writeParsed,
  };
}

describe("terminalWebLinkDecorationController theme", () => {
  it("uses each terminal theme blue token and safe light/dark fallbacks", () => {
    const lightTheme = xtermThemeFor("light", "kerminal");
    const darkTheme = xtermThemeFor("dark", "kerminal");
    expect(terminalWebLinkDecorationColorForTheme(lightTheme, "light")).toBe(
      "#086ace",
    );
    expect(terminalWebLinkDecorationColorForTheme(darkTheme, "dark")).toBe(
      "#60a5fa",
    );
    expect(
      terminalWebLinkDecorationColorForTheme(
        { blue: "color(display-p3 0 0.4 1)" } as ITheme,
        "dark",
      ),
    ).toBe("#60a5fa");
  });

  it("styles a persistent underline without intercepting terminal mouse input", () => {
    const element = { style: {} } as HTMLElement;
    styleTerminalWebLinkDecorationElement(element, "#60a5fa");
    expect(element.style).toMatchObject({
      borderBottomColor: "#60a5fa",
      borderBottomStyle: "solid",
      borderBottomWidth: "1px",
      boxSizing: "border-box",
      pointerEvents: "none",
    });
  });
});

describe("terminalWebLinkDecorationController lifecycle", () => {
  it("decorates wrapped URLs, batches events, hot-updates color, and fully disposes", () => {
    const scheduler = new ManualFrameScheduler();
    const fake = fakeTerminal([
      textLine("Docs https://example."),
      textLine("com/path", true),
    ]);
    const controller = createTerminalWebLinkDecorationController({
      foregroundColor: "#60a5fa",
      scheduler,
      terminal: fake.terminal,
      visible: true,
    });

    expect(scheduler.size).toBe(1);
    scheduler.flush();
    expect(controller.getSnapshot()).toMatchObject({
      decorationCount: 2,
      scanCount: 1,
      suspended: false,
    });
    expect(fake.decorations.map((record) => record.options)).toEqual([
      expect.objectContaining({ foregroundColor: "#60a5fa", width: 16, x: 5 }),
      expect.objectContaining({ foregroundColor: "#60a5fa", width: 8, x: 0 }),
    ]);
    const element = { style: {} } as HTMLElement;
    fake.decorations[0]?.render(element);
    expect(element.style.pointerEvents).toBe("none");
    expect(element.style.borderBottomColor).toBe("#60a5fa");
    const stableDecorations = [...fake.decorations];
    const stableMarkers = [...fake.markers];

    fake.writeParsed.emit();
    fake.scroll.emit(0);
    fake.resize.emit({});
    expect(scheduler.size).toBe(1);
    scheduler.flush();
    expect(controller.getSnapshot().scanCount).toBe(2);
    expect(fake.decorations).toEqual(stableDecorations);
    expect(fake.markers).toEqual(stableMarkers);
    expect(stableDecorations.every((record) => !record.disposed)).toBe(true);
    expect(stableMarkers.every((marker) => !marker.disposed)).toBe(true);

    controller.update({ foregroundColor: "#0a84ff", visible: true });
    scheduler.flush();
    expect(
      fake.decorations[fake.decorations.length - 1]?.options.foregroundColor,
    ).toBe("#0a84ff");
    expect(stableDecorations.every((record) => record.disposed)).toBe(true);
    expect(stableMarkers.every((marker) => !marker.disposed)).toBe(true);

    fake.namespace.active = fake.alternate;
    fake.bufferChange.emit(fake.alternate);
    scheduler.flush();
    expect(controller.getSnapshot()).toMatchObject({
      decorationCount: 0,
      suspended: true,
    });

    fake.namespace.active = fake.normal;
    fake.bufferChange.emit(fake.normal);
    scheduler.flush();
    controller.dispose();
    expect(controller.getSnapshot()).toMatchObject({
      decorationCount: 0,
      disposed: true,
      suspended: true,
    });
    expect(fake.writeParsed.listeners.size).toBe(0);
    expect(fake.scroll.listeners.size).toBe(0);
    expect(fake.resize.listeners.size).toBe(0);
    expect(fake.bufferChange.listeners.size).toBe(0);
    expect(fake.markers.every((marker) => marker.disposed)).toBe(true);
    expect(fake.decorations.every((record) => record.disposed)).toBe(true);
    expect(scheduler.size).toBe(0);
  });
});
