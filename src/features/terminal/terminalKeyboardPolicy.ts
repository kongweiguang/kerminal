export type TerminalKeyboardCaseId =
  | "enter"
  | "shiftEnter"
  | "ctrlJ"
  | "tab"
  | "shiftTab"
  | "escape"
  | "ctrlC"
  | "altEnter"
  | "altV"
  | "ctrlV"
  | "ctrlShiftV"
  | "shiftInsert";

export type TerminalInputCompatibilityMode = "shell" | "agentTui";

export interface TerminalKeyboardEventDescriptor {
  altKey?: boolean;
  code: string;
  ctrlKey?: boolean;
  key: string;
  keyCode: number;
  metaKey?: boolean;
  shiftKey?: boolean;
}

export type TerminalKeyboardHandlingIntent = "sendData" | "nativePaste";

export interface TerminalKeyboardCompatibilityCase {
  agentTuiTargetData: string | null;
  defaultPreventedByXterm6: boolean;
  event: TerminalKeyboardEventDescriptor;
  handlingIntent: TerminalKeyboardHandlingIntent;
  id: TerminalKeyboardCaseId;
  label: string;
  xterm6DefaultData: string | null;
}

export const TERMINAL_KEYBOARD_COMPATIBILITY_CASES = [
  {
    agentTuiTargetData: "\r",
    defaultPreventedByXterm6: true,
    event: { code: "Enter", key: "Enter", keyCode: 13 },
    handlingIntent: "sendData",
    id: "enter",
    label: "Enter",
    xterm6DefaultData: "\r",
  },
  {
    agentTuiTargetData: "\n",
    defaultPreventedByXterm6: true,
    event: { code: "Enter", key: "Enter", keyCode: 13, shiftKey: true },
    handlingIntent: "sendData",
    id: "shiftEnter",
    label: "Shift+Enter",
    xterm6DefaultData: "\r",
  },
  {
    agentTuiTargetData: "\n",
    defaultPreventedByXterm6: true,
    event: { code: "KeyJ", ctrlKey: true, key: "j", keyCode: 74 },
    handlingIntent: "sendData",
    id: "ctrlJ",
    label: "Ctrl+J",
    xterm6DefaultData: "\n",
  },
  {
    agentTuiTargetData: "\t",
    defaultPreventedByXterm6: true,
    event: { code: "Tab", key: "Tab", keyCode: 9 },
    handlingIntent: "sendData",
    id: "tab",
    label: "Tab",
    xterm6DefaultData: "\t",
  },
  {
    agentTuiTargetData: "\x1b[Z",
    defaultPreventedByXterm6: true,
    event: { code: "Tab", key: "Tab", keyCode: 9, shiftKey: true },
    handlingIntent: "sendData",
    id: "shiftTab",
    label: "Shift+Tab",
    xterm6DefaultData: "\x1b[Z",
  },
  {
    agentTuiTargetData: "\x1b",
    defaultPreventedByXterm6: true,
    event: { code: "Escape", key: "Escape", keyCode: 27 },
    handlingIntent: "sendData",
    id: "escape",
    label: "Esc",
    xterm6DefaultData: "\x1b",
  },
  {
    agentTuiTargetData: "\x03",
    defaultPreventedByXterm6: true,
    event: { code: "KeyC", ctrlKey: true, key: "c", keyCode: 67 },
    handlingIntent: "sendData",
    id: "ctrlC",
    label: "Ctrl+C",
    xterm6DefaultData: "\x03",
  },
  {
    agentTuiTargetData: "\x1b\r",
    defaultPreventedByXterm6: true,
    event: { altKey: true, code: "Enter", key: "Enter", keyCode: 13 },
    handlingIntent: "sendData",
    id: "altEnter",
    label: "Alt+Enter",
    xterm6DefaultData: "\x1b\r",
  },
  {
    agentTuiTargetData: "\x1bv",
    defaultPreventedByXterm6: true,
    event: { altKey: true, code: "KeyV", key: "v", keyCode: 86 },
    handlingIntent: "sendData",
    id: "altV",
    label: "Alt+V",
    xterm6DefaultData: "\x1bv",
  },
  {
    agentTuiTargetData: null,
    defaultPreventedByXterm6: true,
    event: { code: "KeyV", ctrlKey: true, key: "v", keyCode: 86 },
    handlingIntent: "nativePaste",
    id: "ctrlV",
    label: "Ctrl+V",
    xterm6DefaultData: "\x16",
  },
  {
    agentTuiTargetData: null,
    defaultPreventedByXterm6: false,
    event: { code: "KeyV", ctrlKey: true, key: "V", keyCode: 86, shiftKey: true },
    handlingIntent: "nativePaste",
    id: "ctrlShiftV",
    label: "Ctrl+Shift+V",
    xterm6DefaultData: null,
  },
  {
    agentTuiTargetData: null,
    defaultPreventedByXterm6: false,
    event: { code: "Insert", key: "Insert", keyCode: 45, shiftKey: true },
    handlingIntent: "nativePaste",
    id: "shiftInsert",
    label: "Shift+Insert",
    xterm6DefaultData: null,
  },
] as const satisfies readonly TerminalKeyboardCompatibilityCase[];

export type TerminalKeyboardEventLike = Partial<
  Pick<
    KeyboardEvent,
    | "altKey"
    | "code"
    | "ctrlKey"
    | "isComposing"
    | "key"
    | "keyCode"
    | "metaKey"
    | "shiftKey"
  >
>;

export interface TerminalRuntimeKeydownOverride {
  data: string;
  suppressPasteEvent?: boolean;
}

export function findTerminalKeyboardCompatibilityCase(
  event: TerminalKeyboardEventLike,
) {
  return TERMINAL_KEYBOARD_COMPATIBILITY_CASES.find((current) =>
    terminalKeyboardEventMatchesDescriptor(event, current.event),
  );
}

export function shouldAppKeybindingYieldForTerminalFocus(
  event: TerminalKeyboardEventLike,
) {
  return findTerminalKeyboardCompatibilityCase(event) !== undefined;
}

export function resolveTerminalInputCompatibilityOverride(
  event: TerminalKeyboardEventLike,
  _mode: TerminalInputCompatibilityMode,
) {
  if (event.isComposing || event.keyCode === 229) {
    return null;
  }

  const match = findTerminalKeyboardCompatibilityCase(event);
  if (match?.id === "shiftEnter") {
    return { data: match.agentTuiTargetData };
  }
  if (match?.id === "altV") {
    return { data: match.agentTuiTargetData };
  }

  return null;
}

export function resolveTerminalRuntimeKeydownOverride(
  event: TerminalKeyboardEventLike,
): TerminalRuntimeKeydownOverride | null {
  if (event.isComposing || event.keyCode === 229) {
    return null;
  }
  if (isShiftEnterEvent(event)) {
    return { data: "\n" };
  }
  if (isCtrlShiftVEvent(event)) {
    return { data: "\x16", suppressPasteEvent: true };
  }
  return null;
}

export function describeTerminalKeyboardData(data: string | null) {
  if (data === null) {
    return "<no data>";
  }

  return Array.from(data)
    .map((char) => {
      const codePoint = char.codePointAt(0) ?? 0;
      if (codePoint === 0x0d) {
        return "CR";
      }
      if (codePoint === 0x0a) {
        return "LF";
      }
      if (codePoint === 0x09) {
        return "TAB";
      }
      if (codePoint === 0x1b) {
        return "ESC";
      }
      if (codePoint < 0x20 || codePoint === 0x7f) {
        return `CTRL-${codePoint.toString(16).padStart(2, "0").toUpperCase()}`;
      }
      return char;
    })
    .join(" ");
}

function isShiftEnterEvent(event: TerminalKeyboardEventLike) {
  return (
    Boolean(event.shiftKey) &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.metaKey &&
    (event.key === "Enter" ||
      event.code === "Enter" ||
      event.code === "NumpadEnter" ||
      event.keyCode === 13)
  );
}

function isCtrlShiftVEvent(event: TerminalKeyboardEventLike) {
  return (
    Boolean(event.ctrlKey) &&
    Boolean(event.shiftKey) &&
    !event.altKey &&
    !event.metaKey &&
    (event.code === "KeyV" ||
      event.key?.toLowerCase() === "v" ||
      event.keyCode === 86)
  );
}

function terminalKeyboardEventMatchesDescriptor(
  event: TerminalKeyboardEventLike,
  descriptor: TerminalKeyboardEventDescriptor,
) {
  return (
    event.key === descriptor.key &&
    event.code === descriptor.code &&
    event.keyCode === descriptor.keyCode &&
    Boolean(event.altKey) === Boolean(descriptor.altKey) &&
    Boolean(event.ctrlKey) === Boolean(descriptor.ctrlKey) &&
    Boolean(event.metaKey) === Boolean(descriptor.metaKey) &&
    Boolean(event.shiftKey) === Boolean(descriptor.shiftKey)
  );
}

export const KITTY_KEYBOARD_PROTOCOL_ENABLE = "\x1b[>1u";

export function shouldEnableKittyKeyboardProtocol(
  mode: TerminalInputCompatibilityMode,
): boolean {
  return mode === "agentTui";
}
