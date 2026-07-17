// @author kongweiguang
import type { Terminal as XtermTerminal } from "@xterm/xterm";

/**
 * 在 xterm 自己的 composition handler 之后，用公开 buffer 与 screen 几何
 * 同步隐藏 textarea。普通 TUI 的 buffer cursor 是唯一位置事实源。
 */
export function syncTerminalImeAnchor(
  terminal: XtermTerminal,
  terminalElement: Element,
) {
  const textarea = terminal.textarea;
  const screen = terminalElement.querySelector<HTMLElement>(".xterm-screen");
  if (!textarea || !screen || terminal.cols <= 0 || terminal.rows <= 0) {
    return false;
  }

  const rect = screen.getBoundingClientRect();
  const cellWidth = rect.width / terminal.cols;
  const cellHeight = rect.height / terminal.rows;
  if (!(cellWidth > 0) || !(cellHeight > 0)) {
    return false;
  }

  const buffer = terminal.buffer.active;
  const column = Math.min(Math.max(buffer.cursorX, 0), terminal.cols - 1);
  const row = Math.min(Math.max(buffer.cursorY, 0), terminal.rows - 1);
  textarea.style.left = `${column * cellWidth}px`;
  textarea.style.top = `${row * cellHeight}px`;
  return true;
}
