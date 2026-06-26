import { afterEach, describe, expect, it, vi } from "vitest";
import {
  KITTY_KEYBOARD_PROTOCOL_ENABLE,
  TERMINAL_KEYBOARD_COMPATIBILITY_CASES,
  describeTerminalKeyboardData,
  findTerminalKeyboardCompatibilityCase,
  resolveTerminalInputCompatibilityOverride,
  resolveTerminalRuntimeKeydownOverride,
  shouldAppKeybindingYieldForTerminalFocus,
  shouldEnableKittyKeyboardProtocol,
  type TerminalKeyboardCompatibilityCase,
} from "./terminalKeyboardPolicy";

describe("terminalKeyboardPolicy", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("defines the production Agent terminal compatibility matrix", () => {
    expect(TERMINAL_KEYBOARD_COMPATIBILITY_CASES.map((entry) => entry.id)).toEqual(
      [
        "enter",
        "shiftEnter",
        "ctrlJ",
        "tab",
        "shiftTab",
        "escape",
        "ctrlC",
        "altEnter",
        "altV",
        "ctrlV",
        "ctrlShiftV",
        "shiftInsert",
      ],
    );
  });

  it("documents the xterm 6 Shift+Enter collision and Kerminal target", () => {
    const enter = caseById("enter");
    const shiftEnter = caseById("shiftEnter");

    expect(describeTerminalKeyboardData(enter.xterm6DefaultData)).toBe("CR");
    expect(describeTerminalKeyboardData(shiftEnter.xterm6DefaultData)).toBe("CR");
    expect(describeTerminalKeyboardData(shiftEnter.agentTuiTargetData)).toBe(
      "LF",
    );
  });

  it("marks terminal focused Agent TUI keys as app keybinding yield points", () => {
    for (const entry of TERMINAL_KEYBOARD_COMPATIBILITY_CASES) {
      expect(findTerminalKeyboardCompatibilityCase(entry.event)?.id).toBe(
        entry.id,
      );
      expect(shouldAppKeybindingYieldForTerminalFocus(entry.event)).toBe(true);
    }

    expect(
      shouldAppKeybindingYieldForTerminalFocus({
        code: "KeyS",
        ctrlKey: true,
        key: "s",
        keyCode: 83,
      }),
    ).toBe(false);
  });

  it("overrides Agent TUI keys without turning terminal paste shortcuts into duplicate input", () => {
    expect(
      resolveTerminalInputCompatibilityOverride(caseById("shiftEnter").event, "agentTui"),
    ).toEqual({ data: "\n" });
    expect(
      resolveTerminalInputCompatibilityOverride(caseById("enter").event, "agentTui"),
    ).toBeNull();
    expect(
      resolveTerminalInputCompatibilityOverride(caseById("shiftEnter").event, "shell"),
    ).toEqual({ data: "\n" });
    expect(
      resolveTerminalInputCompatibilityOverride(caseById("ctrlShiftV").event, "agentTui"),
    ).toBeNull();
    expect(
      resolveTerminalInputCompatibilityOverride(caseById("ctrlShiftV").event, "shell"),
    ).toBeNull();
    expect(
      resolveTerminalInputCompatibilityOverride(caseById("altV").event, "agentTui"),
    ).toEqual({ data: "\x1bv" });
    expect(resolveTerminalRuntimeKeydownOverride(caseById("shiftEnter").event)).toEqual({
      data: "\n",
    });
    expect(resolveTerminalRuntimeKeydownOverride(caseById("ctrlShiftV").event)).toEqual({
      data: "\x16",
      suppressPasteEvent: true,
    });
    expect(
      resolveTerminalRuntimeKeydownOverride({
        ...caseById("ctrlShiftV").event,
        key: "v",
      }),
    ).toEqual({ data: "\x16", suppressPasteEvent: true });
  });

  it("does not override IME composition key events", () => {
    expect(
      resolveTerminalInputCompatibilityOverride(
        { ...caseById("shiftEnter").event, isComposing: true },
        "agentTui",
      ),
    ).toBeNull();
    expect(
      resolveTerminalInputCompatibilityOverride(
        { ...caseById("shiftEnter").event, keyCode: 229 },
        "agentTui",
      ),
    ).toBeNull();
    expect(
      resolveTerminalRuntimeKeydownOverride({
        ...caseById("shiftEnter").event,
        isComposing: true,
      }),
    ).toBeNull();
  });

  it("records xterm 6 raw bytes with a fake PTY recorder", async () => {
    const harness = await createRealXtermKeyboardHarness();

    try {
      for (const entry of TERMINAL_KEYBOARD_COMPATIBILITY_CASES) {
        const result = harness.press(entry);

        expect(result.data, entry.label).toBe(entry.xterm6DefaultData ?? "");
        expect(result.defaultPrevented, entry.label).toBe(
          entry.defaultPreventedByXterm6,
        );
      }
    } finally {
      harness.dispose();
    }
  });

  it("exposes the kitty keyboard protocol enable sequence constant", () => {
    expect(KITTY_KEYBOARD_PROTOCOL_ENABLE).toBe("\x1b[>1u");
  });

  it("enables kitty keyboard protocol only for agentTui mode", () => {
    expect(shouldEnableKittyKeyboardProtocol("agentTui")).toBe(true);
    expect(shouldEnableKittyKeyboardProtocol("shell")).toBe(false);
  });
});

function caseById(id: TerminalKeyboardCompatibilityCase["id"]) {
  const entry = TERMINAL_KEYBOARD_COMPATIBILITY_CASES.find(
    (current) => current.id === id,
  );
  expect(entry).toBeDefined();
  return entry!;
}

async function createRealXtermKeyboardHarness() {
  installBrowserApiStubs();

  const { Terminal: XtermTerminal } = await import("@xterm/xterm");
  const container = document.createElement("div");
  document.body.appendChild(container);
  const terminal = new XtermTerminal({ cols: 80, rows: 24 });
  const ptyWrites: string[] = [];
  terminal.onData((data) => ptyWrites.push(data));
  terminal.open(container);
  terminal.focus();

  const textarea = container.querySelector<HTMLTextAreaElement>(
    ".xterm-helper-textarea",
  );
  expect(textarea).toBeInstanceOf(HTMLTextAreaElement);

  return {
    dispose() {
      terminal.dispose();
      container.remove();
    },
    press(entry: TerminalKeyboardCompatibilityCase) {
      ptyWrites.length = 0;
      const event = new KeyboardEvent("keydown", {
        altKey: Boolean(entry.event.altKey),
        bubbles: true,
        cancelable: true,
        code: entry.event.code,
        ctrlKey: Boolean(entry.event.ctrlKey),
        key: entry.event.key,
        keyCode: entry.event.keyCode,
        metaKey: Boolean(entry.event.metaKey),
        shiftKey: Boolean(entry.event.shiftKey),
        which: entry.event.keyCode,
      });

      textarea!.dispatchEvent(event);

      return {
        data: ptyWrites.join(""),
        defaultPrevented: event.defaultPrevented,
      };
    },
  };
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
