// @author kongweiguang

import type {
  IBuffer,
  IBufferCell,
  IBufferLine,
  IDecorationOptions,
  IDisposable,
  Terminal as XtermTerminal,
} from "@xterm/xterm";
import { describe, expect, it, vi } from "vitest";
import type { TerminalKeywordHighlightSettings } from "../../../../src/features/settings/terminalKeywordHighlightModel";
import {
  createTerminalKeywordHighlightController,
  TERMINAL_KEYWORD_HIGHLIGHT_DECORATION_LIMIT,
} from "../../../../src/features/terminal/terminalKeywordHighlightController";
import {
  buildTerminalBufferLogicalLines,
  terminalDecorationSegmentsForTextRange,
} from "../../../../src/features/terminal/terminalBufferDecorationModel";

interface FakeCellValue {
  chars: string;
  width: number;
}

/** 创建只实现高亮扫描所需公开 API 的 xterm buffer line。 */
function fakeLine(
  cells: FakeCellValue[],
  isWrapped = false,
): IBufferLine {
  return {
    isWrapped,
    length: cells.length,
    getCell(index: number) {
      const value = cells[index];
      return value ? fakeCell(value) : undefined;
    },
    translateToString() {
      return cells.map((cell) => cell.chars).join("");
    },
  } as IBufferLine;
}

/** 构造最小 cell；颜色和字体 API 不属于文本到坐标映射测试范围。 */
function fakeCell(value: FakeCellValue): IBufferCell {
  return {
    getChars: () => value.chars,
    getWidth: () => value.width,
  } as IBufferCell;
}

/** 把普通字符串展开成单宽 xterm cells。 */
function textLine(text: string, isWrapped = false): IBufferLine {
  return fakeLine(
    Array.from(text, (chars) => ({ chars, width: 1 })),
    isWrapped,
  );
}

/** 创建支持视口与 cursor 坐标的 normal buffer fake。 */
function fakeBuffer(
  lines: IBufferLine[],
  patch: Partial<IBuffer> = {},
): IBuffer {
  return {
    baseY: 0,
    cursorX: 0,
    cursorY: Math.max(0, lines.length - 1),
    length: lines.length,
    type: "normal",
    viewportY: 0,
    getLine: (index: number) => lines[index],
    getNullCell: () => fakeCell({ chars: "", width: 1 }),
    ...patch,
  } as IBuffer;
}

class FakeEvent<T> {
  readonly listeners = new Set<(value: T) => void>();

  /** 以 xterm IEvent 形状登记监听器，并返回可幂等释放的 disposable。 */
  readonly subscribe = (listener: (value: T) => void): IDisposable => {
    this.listeners.add(listener);
    return {
      dispose: () => this.listeners.delete(listener),
    };
  };

  /** 同步发出测试事件，复制集合以允许监听器在回调中释放自己。 */
  emit(value: T): void {
    for (const listener of [...this.listeners]) {
      listener(value);
    }
  }
}

class ManualFrameScheduler {
  private nextId = 1;
  private readonly callbacks = new Map<number, () => void>();

  /** 取消尚未 flush 的帧回调。 */
  cancel = (frameId: number) => {
    this.callbacks.delete(frameId);
  };

  /** 登记单帧回调，让测试可以断言同帧事件被合并。 */
  request = (callback: () => void) => {
    const id = this.nextId;
    this.nextId += 1;
    this.callbacks.set(id, callback);
    return id;
  };

  /** 执行当前批次，后续新登记回调保留到下一次 flush。 */
  flush(): void {
    const current = [...this.callbacks.entries()];
    for (const [id] of current) {
      this.callbacks.delete(id);
    }
    for (const [, callback] of current) {
      callback();
    }
  }

  /** 暴露待执行数量，用于等待异步 RE2 编译完成。 */
  get size(): number {
    return this.callbacks.size;
  }
}

interface FakeDecorationRecord {
  disposed: boolean;
  options: IDecorationOptions;
}

/** 构造 controller 所需的 xterm 事件、marker 与 decoration ownership fake。 */
function fakeTerminal(lines: IBufferLine[], cols = 80, rows = 24) {
  const normal = fakeBuffer(lines);
  const alternate = fakeBuffer([], { type: "alternate" });
  const namespace = {
    active: normal,
    normal,
    alternate,
  } as {
    active: IBuffer;
    normal: IBuffer;
    alternate: IBuffer;
    onBufferChange?: unknown;
  };
  const bufferChange = new FakeEvent<IBuffer>();
  const resize = new FakeEvent<unknown>();
  const scroll = new FakeEvent<number>();
  const writeParsed = new FakeEvent<void>();
  const markers: Array<{ disposed: boolean; line: number }> = [];
  const decorations: FakeDecorationRecord[] = [];
  Object.assign(namespace, { onBufferChange: bufferChange.subscribe });

  const terminal = {
    buffer: namespace,
    cols,
    rows,
    onResize: resize.subscribe,
    onScroll: scroll.subscribe,
    onWriteParsed: writeParsed.subscribe,
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
    registerDecoration(options: IDecorationOptions) {
      const record = { disposed: false, options };
      decorations.push(record);
      return {
        element: undefined,
        isDisposed: false,
        marker: options.marker,
        onDispose: () => ({ dispose: () => undefined }),
        onRender: () => ({ dispose: () => undefined }),
        options: {},
        dispose() {
          record.disposed = true;
        },
      };
    },
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

/** 生成一条启用的文本规则设置。 */
function settings(pattern: string): TerminalKeywordHighlightSettings {
  return {
    enabled: true,
    rules: [
      {
        id: "rule-1",
        enabled: true,
        pattern,
        matchMode: "literal",
        caseSensitive: true,
        note: "",
        style: "yellow",
      },
    ],
  };
}

describe("terminalKeywordHighlightController mapping", () => {
  it("maps wide, emoji, combining, blank, and wrapped cells into physical segments", () => {
    const buffer = fakeBuffer([
      fakeLine([
        { chars: "E", width: 1 },
        { chars: "R", width: 1 },
        { chars: "R", width: 1 },
      ]),
      fakeLine(
        [
          { chars: "O", width: 1 },
          { chars: "R", width: 1 },
          { chars: "", width: 1 },
          { chars: "e\u0301", width: 1 },
        ],
        true,
      ),
      fakeLine(
        [
          { chars: "🙂", width: 2 },
          { chars: "", width: 0 },
        ],
        true,
      ),
      textLine("NEXT"),
    ]);

    const logical = buildTerminalBufferLogicalLines(buffer, 8, 1, 2);
    expect(logical).toHaveLength(1);
    expect(logical[0].text).toBe("ERROR e\u0301🙂");
    expect(
      terminalDecorationSegmentsForTextRange(
        logical[0].cells,
        1,
        logical[0].text.length,
      ),
    ).toEqual([
      { row: 0, x: 1, width: 2 },
      { row: 1, x: 0, width: 4 },
      { row: 2, x: 0, width: 2 },
    ]);
  });
});

describe("terminalKeywordHighlightController lifecycle", () => {
  it("batches events, suspends alternate buffer, hot-updates theme, and fully disposes", async () => {
    const scheduler = new ManualFrameScheduler();
    const fake = fakeTerminal([textLine("ERROR")], 80, 24);
    const controller = createTerminalKeywordHighlightController({
      resolvedTheme: "dark",
      scheduler,
      settings: settings("ERROR"),
      terminal: fake.terminal,
      visible: true,
    });

    await vi.waitFor(() => expect(scheduler.size).toBe(1));
    scheduler.flush();
    expect(controller.getSnapshot()).toMatchObject({
      decorationCount: 1,
      scanCount: 1,
      suspended: false,
    });
    expect(fake.decorations[fake.decorations.length - 1]?.options).toMatchObject({
      backgroundColor: "#422006",
      foregroundColor: "#FDE047",
      layer: "bottom",
    });

    fake.writeParsed.emit();
    fake.scroll.emit(0);
    fake.resize.emit({});
    expect(scheduler.size).toBe(1);
    scheduler.flush();
    expect(controller.getSnapshot().scanCount).toBe(2);

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
    controller.update({
      resolvedTheme: "light",
      settings: settings("ERROR"),
      visible: true,
    });
    scheduler.flush();
    expect(fake.decorations[fake.decorations.length - 1]?.options).toMatchObject({
      backgroundColor: "#FEF9C3",
      foregroundColor: "#854D0E",
    });

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
    expect(fake.decorations.every((decoration) => decoration.disposed)).toBe(true);
    expect(scheduler.size).toBe(0);
  });

  it("caps each pane at one thousand decorations", async () => {
    const scheduler = new ManualFrameScheduler();
    const fake = fakeTerminal(
      Array.from({ length: 20 }, () => textLine("a".repeat(80))),
      80,
      20,
    );
    const controller = createTerminalKeywordHighlightController({
      resolvedTheme: "dark",
      scheduler,
      settings: settings("a"),
      terminal: fake.terminal,
      visible: true,
    });
    await vi.waitFor(() => expect(scheduler.size).toBe(1));
    scheduler.flush();

    expect(controller.getSnapshot()).toMatchObject({
      capped: true,
      decorationCount: TERMINAL_KEYWORD_HIGHLIGHT_DECORATION_LIMIT,
    });
    controller.dispose();
  });
});
