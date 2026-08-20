// @author kongweiguang
import { afterEach, describe, expect, it, vi } from "vitest";
import { installShellIntegrationOscHandlers } from "../../../../src/features/terminal/XtermPane.shellIntegration";
import {
  createTerminalOutputWriter,
  type TerminalOutputScheduler,
} from "../../../../src/features/terminal/terminalOutputWriter";
import { runTerminalPaneVisibleRecovery } from "../../../../src/features/terminal/terminalPaneVisibleRecovery";
import { createTerminalShellIntegrationState } from "../../../../src/features/terminal/terminalShellIntegrationModel";
import { syncTerminalImeAnchor } from "../../../../src/features/terminal/terminalImeAnchor";
import { createTerminalKeywordHighlightController } from "../../../../src/features/terminal/terminalKeywordHighlightController";

describe("real xterm compatibility", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("wraps exact long paste content when bracketed paste is enabled", async () => {
    const harness = await createRealXtermHarness();
    const longPaste = [
      "first line",
      "第二行 with unicode",
      "last line " + "x".repeat(2048),
    ].join("\n");

    try {
      await harness.write("\x1b[?2004h");
      harness.terminal.paste(longPaste);

      const normalizedPaste = longPaste.replace(/\n/g, "\r");
      expect(harness.data.join("")).toBe(
        `\x1b[200~${normalizedPaste}\x1b[201~`,
      );
    } finally {
      harness.dispose();
    }
  });

  it("tracks alternate screen enter and exit without losing the normal buffer", async () => {
    const harness = await createRealXtermHarness();

    try {
      await harness.write("normal buffer\r\n");
      expect(harness.terminal.buffer.active.type).toBe("normal");

      await harness.write("\x1b[?1049h");
      expect(harness.terminal.buffer.active.type).toBe("alternate");

      await harness.write("\x1b[?1049l");
      expect(harness.terminal.buffer.active.type).toBe("normal");
      expect(
        harness.terminal.buffer.normal.getLine(0)?.translateToString(true),
      ).toContain("normal buffer");
    } finally {
      harness.dispose();
    }
  });

  it("registers real xterm decorations for keyword highlights", async () => {
    const harness = await createRealXtermHarness({ allowProposedApi: true });
    const scheduledFrames = new Map<number, () => void>();
    let nextFrameId = 1;
    const controller = createTerminalKeywordHighlightController({
      resolvedTheme: "dark",
      scheduler: {
        cancel(frameId) {
          scheduledFrames.delete(frameId);
        },
        request(callback) {
          const frameId = nextFrameId;
          nextFrameId += 1;
          scheduledFrames.set(frameId, callback);
          return frameId;
        },
      },
      settings: {
        enabled: true,
        rules: [
          {
            caseSensitive: false,
            enabled: true,
            id: "java",
            matchMode: "literal",
            note: "",
            pattern: "java",
            style: "pink",
          },
        ],
      },
      terminal: harness.terminal,
      visible: true,
    });

    try {
      await harness.write("root@host:~# java\r\n");
      await vi.waitFor(() => {
        const callbacks = [...scheduledFrames.values()];
        scheduledFrames.clear();
        for (const callback of callbacks) {
          callback();
        }
        expect(controller.getSnapshot().suspended).toBe(false);
      });

      expect(controller.getSnapshot()).toMatchObject({
        compileErrorCount: 0,
        decorationCount: 1,
        suspended: false,
      });
    } finally {
      controller.dispose();
      harness.dispose();
    }
  });

  it("answers cursor and default-color probes used by inline TUIs", async () => {
    const themes = [
      {
        background: "#111111",
        expectedBackground: "rgb:1111/1111/1111",
        expectedForeground: "rgb:eeee/eeee/eeee",
        foreground: "#eeeeee",
      },
      {
        background: "#ffffff",
        expectedBackground: "rgb:ffff/ffff/ffff",
        expectedForeground: "rgb:1111/1111/1111",
        foreground: "#111111",
      },
    ];

    for (const theme of themes) {
      const harness = await createRealXtermHarness({ theme });

      try {
        await harness.write("\x1b[6n\x1b]10;?\x1b\\\x1b]11;?\x1b\\");
        const response = harness.data.join("");
        const escape = String.fromCharCode(27);

        expect(response).toMatch(new RegExp(`${escape}\\[\\d+;\\d+R`, "u"));
        expect(response).toContain(
          `${escape}]10;${theme.expectedForeground}`,
        );
        expect(response).toContain(
          `${escape}]11;${theme.expectedBackground}`,
        );
      } finally {
        harness.dispose();
      }
    }
  });

  it("keeps the IME textarea on the input row across a split synchronized TUI frame", async () => {
    const harness = await createRealXtermHarness({ rows: 14 });
    let scheduled: (() => void) | undefined;
    const scheduler: TerminalOutputScheduler = {
      cancel: () => {
        scheduled = undefined;
      },
      request: (callback) => {
        scheduled = callback;
        return 1;
      },
    };
    const writer = createTerminalOutputWriter(harness.terminal, { scheduler });
    writer.setTuiCursorProtection!(true);
    const coreRefresh = vi.spyOn(
      (
        harness.terminal as typeof harness.terminal & {
          _core: { refresh(start: number, end: number, sync?: boolean): void };
        }
      )._core,
      "refresh",
    );

    try {
      await harness.write("\x1b[13;4H\x1b[?25h");
      const textarea = harness.terminal.textarea;
      expect(textarea).toBeDefined();
      textarea!.dispatchEvent(
        new CompositionEvent("compositionstart", { bubbles: true }),
      );
      const initialPosition = {
        left: textarea!.style.left,
        top: textarea!.style.top,
      };

      writer.write("\x1b[?2026h\x1b[?25l\x1b[9;5HWorking\x1b[?25h");
      expect(harness.terminal.buffer.active.cursorY).toBe(12);
      expect({ left: textarea!.style.left, top: textarea!.style.top }).toEqual(
        initialPosition,
      );

      writer.write("\x1b[?2026l");
      expect(harness.terminal.buffer.active.cursorY).toBe(12);
      expect({ left: textarea!.style.left, top: textarea!.style.top }).toEqual(
        initialPosition,
      );

      writer.write("\x1b[13;4H\x1b[?25l\x1b[?25h");
      scheduled?.();
      await waitForWriterIdle(writer);

      expect(harness.terminal.buffer.active.cursorX).toBe(3);
      expect(harness.terminal.buffer.active.cursorY).toBe(12);
      expect(coreRefresh).toHaveBeenCalledWith(0, 13, true);
      expect({ left: textarea!.style.left, top: textarea!.style.top }).toEqual(
        initialPosition,
      );
      textarea!.dispatchEvent(
        new CompositionEvent("compositionend", { bubbles: true }),
      );
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    } finally {
      writer.dispose();
      harness.dispose();
    }
  });

  it("honors the TUI native final cursor placement instead of the Working row", async () => {
    const harness = await createRealXtermHarness({ rows: 14 });
    let scheduled: (() => void) | undefined;
    const writer = createTerminalOutputWriter(harness.terminal, {
      callbackMode: "required",
      scheduler: {
        cancel: () => {
          scheduled = undefined;
        },
        request: (callback) => {
          scheduled = callback;
          return 1;
        },
      },
    });
    writer.setTuiCursorProtection!(true);

    try {
      writer.write(
        "\x1b[?2026h\x1b[?25l\x1b[9;5HWorking\x1b[?25h\x1b[13;4H\x1b[?2026l",
      );
      scheduled?.();
      await waitForWriterIdle(writer);

      expect(harness.terminal.buffer.active.cursorX).toBe(3);
      expect(harness.terminal.buffer.active.cursorY).toBe(12);
      expect(
        (
          harness.terminal as typeof harness.terminal & {
            _core: { coreService: { isCursorHidden: boolean } };
          }
        )._core.coreService.isCursorHidden,
      ).toBe(false);
    } finally {
      writer.dispose();
      harness.dispose();
    }
  });

  it("keeps the native cursor after Chinese input across repeated reply repaints", async () => {
    const harness = await createRealXtermHarness({ rows: 14 });
    let scheduled: (() => void) | undefined;
    const writer = createTerminalOutputWriter(harness.terminal, {
      callbackMode: "required",
      scheduler: {
        cancel: () => {
          scheduled = undefined;
        },
        request: (callback) => {
          scheduled = callback;
          return 1;
        },
      },
    });
    writer.setTuiCursorProtection!(true);

    try {
      for (let frame = 0; frame < 5; frame += 1) {
        writer.write(
          `\x1b[?2026h\x1b[?25l\x1b[9;5HWorking ${frame}` +
            "\x1b[13;1H\x1b[2K› 帮我写一个\x1b[13;13H" +
            "\x1b[?2026l\x1b[?25h",
        );
        scheduled?.();
        await waitForWriterIdle(writer);

        expect(harness.terminal.buffer.active.cursorX).toBe(12);
        expect(harness.terminal.buffer.active.cursorY).toBe(12);
      }
    } finally {
      writer.dispose();
      harness.dispose();
    }
  });

  it("preserves ANSI foreground and input background colors in protected frames", async () => {
    const harness = await createRealXtermHarness({ rows: 14 });
    let scheduled: (() => void) | undefined;
    const writer = createTerminalOutputWriter(harness.terminal, {
      callbackMode: "required",
      scheduler: {
        cancel: () => {
          scheduled = undefined;
        },
        request: (callback) => {
          scheduled = callback;
          return 1;
        },
      },
    });
    writer.setTuiCursorProtection!(true);

    try {
      writer.write(
        "\x1b[?2026h\x1b[?25l\x1b[1;1H" +
          "\x1b[31mR\x1b[32mG\x1b[34mB\x1b[48;5;238mI\x1b[0m" +
          "\x1b[13;1H\x1b[?2026l\x1b[?25h",
      );
      scheduled?.();
      await waitForWriterIdle(writer);

      const line = harness.terminal.buffer.active.getLine(0)!;
      expect([0, 1, 2, 3].map((column) => line.getCell(column)?.getChars())).toEqual([
        "R",
        "G",
        "B",
        "I",
      ]);
      expect([0, 1, 2].map((column) => line.getCell(column)?.getFgColor())).toEqual([
        1,
        2,
        4,
      ]);
      expect(line.getCell(3)?.getBgColor()).toBe(238);
    } finally {
      writer.dispose();
      harness.dispose();
    }
  });

  it("reanchors the helper textarea from public screen and buffer geometry", async () => {
    const harness = await createRealXtermHarness({ rows: 10 });

    try {
      await harness.write("\x1b[8;4H");
      const screen = harness.container.querySelector<HTMLElement>(".xterm-screen");
      expect(screen).not.toBeNull();
      stubElementRect(screen!, { height: 200, left: 0, top: 0, width: 800 });
      harness.terminal.textarea!.style.left = "0px";
      harness.terminal.textarea!.style.top = "0px";

      expect(syncTerminalImeAnchor(harness.terminal, harness.container)).toBe(
        true,
      );
      expect(harness.terminal.textarea!.style.left).toBe("30px");
      expect(harness.terminal.textarea!.style.top).toBe("140px");
    } finally {
      harness.dispose();
    }
  });

  it("emits SGR mouse reports when terminal mouse tracking is enabled", async () => {
    const harness = await createRealXtermHarness();
    const terminalElement = harness.container.querySelector(".xterm");
    const screenElement = harness.container.querySelector(".xterm-screen");

    expect(terminalElement).toBeInstanceOf(HTMLElement);
    expect(screenElement).toBeInstanceOf(HTMLElement);

    try {
      stubElementRect(screenElement as HTMLElement, {
        height: 480,
        left: 10,
        top: 20,
        width: 800,
      });
      await harness.write("\x1b[?1000h\x1b[?1006h");

      terminalElement?.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          button: 0,
          buttons: 1,
          cancelable: true,
          clientX: 25,
          clientY: 35,
        }),
      );
      document.dispatchEvent(
        new MouseEvent("mouseup", {
          bubbles: true,
          button: 0,
          buttons: 0,
          cancelable: true,
          clientX: 25,
          clientY: 35,
        }),
      );

      const rawData = harness.data.join("");
      const sgrMousePrefix = `${String.fromCharCode(27)}\\[<0;`;
      expect(rawData).toMatch(new RegExp(`${sgrMousePrefix}\\d+;\\d+M`, "u"));
      expect(rawData).toMatch(new RegExp(`${sgrMousePrefix}\\d+;\\d+m`, "u"));
    } finally {
      harness.dispose();
    }
  });

  it("emits resize events and keeps normal scrollback bounded", async () => {
    const harness = await createRealXtermHarness({ rows: 2, scrollback: 3 });
    const resizeEvents: Array<{ cols: number; rows: number }> = [];
    const disposable = harness.terminal.onResize((event) =>
      resizeEvents.push(event),
    );

    try {
      harness.terminal.resize(100, 30);
      expect(resizeEvents).toContainEqual(
        expect.objectContaining({ cols: 100, rows: 30 }),
      );

      await harness.write("one\r\ntwo\r\nthree\r\nfour\r\nfive\r\nsix\r\n");
      expect(harness.terminal.buffer.normal.length).toBeLessThanOrEqual(
        harness.terminal.rows + 3,
      );
    } finally {
      disposable.dispose();
      harness.dispose();
    }
  });

  it("keeps cursor, selection, search, and input usable after visible recovery", async () => {
    const harness = await createRealXtermHarness();
    const { SearchAddon } = await import("@xterm/addon-search");
    const searchAddon = new SearchAddon();
    harness.terminal.loadAddon(searchAddon);
    const resizeTerminal = vi.fn().mockResolvedValue(undefined);
    const markVisibleRecoveryComplete = vi.fn(() => undefined);

    try {
      await harness.write("prompt> alpha\r\nnext beta\r\n");
      const cursorBeforeRecovery = harness.terminal.buffer.active.cursorY;
      harness.terminal.select(0, 0, 6);

      expect(harness.terminal.getSelection()).toContain("prompt");
      expect(searchAddon.findNext("beta")).toBe(true);

      const result = runTerminalPaneVisibleRecovery({
        fitAddon: () => ({
          fit: () => harness.terminal.resize(100, 30),
        }),
        markVisibleRecoveryComplete,
        resizeTerminal,
        sessionId: () => "session-1",
        terminal: () => harness.terminal,
      });

      expect(result).toEqual({ dimensionsChanged: true, recovered: true });
      expect(resizeTerminal).toHaveBeenCalledWith("session-1", {
        cols: 100,
        rows: 30,
      });
      expect(markVisibleRecoveryComplete).toHaveBeenCalled();
      expect(harness.terminal.cols).toBe(100);
      expect(harness.terminal.rows).toBe(30);
      expect(harness.terminal.buffer.active.cursorY).toBeGreaterThanOrEqual(
        cursorBeforeRecovery,
      );
      expect(
        harness.terminal.buffer.active.getLine(0)?.translateToString(true),
      ).toContain("prompt> alpha");
      expect(searchAddon.findNext("alpha")).toBe(true);

      harness.terminal.paste("restored-input");
      expect(harness.data.join("")).toContain("restored-input");
    } finally {
      harness.dispose();
    }
  });

  it("keeps real xterm parsing after an asynchronous OSC callback failure", async () => {
    const harness = await createRealXtermHarness();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const state = createTerminalShellIntegrationState({ trusted: true });
    const oscDisposables = installShellIntegrationOscHandlers(
      harness.terminal,
      {
        onCurrentCwd: () => {
          throw new Error("async cwd callback failed");
        },
        readState: () => state,
        reduceState: vi.fn(),
        writeState: vi.fn(),
      },
    );
    const writer = createTerminalOutputWriter(harness.terminal);

    try {
      const failedOscParsed = waitForNextParsedWrite(harness.terminal);
      writer.writeNow("\u0000\x1b]7;file:///tmp/async-osc\x07");
      await failedOscParsed;

      const followingOutputParsed = waitForNextParsedWrite(harness.terminal);
      writer.writeNow("after-binary\r\n");
      await followingOutputParsed;

      expect(
        harness.terminal.buffer.active.getLine(0)?.translateToString(true),
      ).toContain("after-binary");
      expect(consoleError).toHaveBeenCalledWith(
        "terminal OSC 7 handler failed",
        expect.any(Error),
      );
      expect(writer.stats()).toMatchObject({
        flushCount: 2,
        writeErrorCount: 0,
        writeNowCount: 2,
      });
    } finally {
      writer.dispose();
      oscDisposables.forEach((disposable) => disposable.dispose());
      consoleError.mockRestore();
      harness.dispose();
    }
  });
});

function waitForNextParsedWrite(
  terminal: Awaited<ReturnType<typeof createRealXtermHarness>>["terminal"],
) {
  return new Promise<void>((resolve) => {
    const subscription: { disposable?: { dispose: () => void } } = {};
    subscription.disposable = terminal.onWriteParsed(() => {
      subscription.disposable?.dispose();
      resolve();
    });
  });
}

async function waitForWriterIdle(
  writer: ReturnType<typeof createTerminalOutputWriter>,
) {
  for (let index = 0; index < 100; index += 1) {
    if (!writer.stats().inFlight && writer.pendingLength() === 0) {
      return;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  }
  throw new Error("terminal writer did not become idle");
}

/**
 * 使用项目锁定的真实 xterm 包而非 mock；proposed API 只由显式测试开启，确保其它
 * 兼容用例仍覆盖默认安全门禁，关键词装饰用例则验证生产所需能力确实可注册。
 */
async function createRealXtermHarness(options?: {
  allowProposedApi?: boolean;
  rows?: number;
  scrollback?: number;
  theme?: { background: string; foreground: string };
}) {
  installBrowserApiStubs();

  const { Terminal: XtermTerminal } = await import("@xterm/xterm");
  const container = document.createElement("div");
  document.body.appendChild(container);
  const terminal = new XtermTerminal({
    ...(options?.allowProposedApi ? { allowProposedApi: true } : {}),
    cols: 80,
    rows: options?.rows ?? 24,
    scrollback: options?.scrollback ?? 1000,
    theme: options?.theme,
  });
  const data: string[] = [];
  terminal.onData((entry) => data.push(entry));
  terminal.open(container);

  return {
    container,
    data,
    dispose() {
      terminal.dispose();
      container.remove();
    },
    terminal,
    write(entry: string) {
      return new Promise<void>((resolve) => terminal.write(entry, resolve));
    },
  };
}

function stubElementRect(
  element: HTMLElement,
  rect: Pick<DOMRect, "height" | "left" | "top" | "width">,
) {
  element.style.paddingLeft = "0px";
  element.style.paddingTop = "0px";
  element.getBoundingClientRect = () =>
    ({
      bottom: rect.top + rect.height,
      height: rect.height,
      left: rect.left,
      right: rect.left + rect.width,
      top: rect.top,
      width: rect.width,
      x: rect.left,
      y: rect.top,
      toJSON: () => ({}),
    }) as DOMRect;
}

function installBrowserApiStubs() {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({
      addEventListener: vi.fn(),
      addListener: vi.fn(),
      dispatchEvent: vi.fn(() => false),
      matches: false,
      media: "",
      onchange: null,
      removeEventListener: vi.fn(),
      removeListener: vi.fn(),
    }),
  });
  Object.defineProperty(window, "ResizeObserver", {
    configurable: true,
    value: class ResizeObserver {
      disconnect() {}
      observe() {}
      unobserve() {}
    },
  });
  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    value: window.ResizeObserver,
  });

  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    createCanvasContextStub() as unknown as CanvasRenderingContext2D,
  );
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(320);
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(16);
}

function createCanvasContextStub() {
  return {
    beginPath: vi.fn(),
    clearRect: vi.fn(),
    clip: vi.fn(),
    closePath: vi.fn(),
    createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    drawImage: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4) })),
    measureText: vi.fn(() => ({ width: 10 })),
    putImageData: vi.fn(),
    rect: vi.fn(),
    restore: vi.fn(),
    save: vi.fn(),
    scale: vi.fn(),
    setTransform: vi.fn(),
    strokeRect: vi.fn(),
    strokeText: vi.fn(),
    translate: vi.fn(),
  };
}
