// @author kongweiguang

import type { IBuffer, IBufferCell, IBufferLine } from "@xterm/xterm";

const MAX_WRAPPED_CONTEXT_LINES = 256;

interface TerminalBufferCellSpan {
  end: number;
  row: number;
  start: number;
  width: number;
  x: number;
}

export interface TerminalBufferLogicalLine {
  cells: TerminalBufferCellSpan[];
  endRow: number;
  startRow: number;
  text: string;
}

export interface TerminalDecorationSegment {
  row: number;
  width: number;
  x: number;
}

/**
 * 将物理 xterm 行合并为 wrapped logical lines，并建立 UTF-16 文本区间到 cell 的映射；
 * URL 与关键词必须共用这条路径，避免两种装饰在宽字符或视觉换行处落到不同位置。
 */
export function buildTerminalBufferLogicalLines(
  buffer: Pick<IBuffer, "getLine" | "length">,
  cols: number,
  requestedStartRow: number,
  requestedEndRow: number,
): TerminalBufferLogicalLine[] {
  if (buffer.length <= 0 || cols <= 0 || requestedEndRow <= requestedStartRow) {
    return [];
  }
  let startRow = Math.max(0, Math.min(requestedStartRow, buffer.length - 1));
  let expanded = 0;
  while (
    startRow > 0 &&
    buffer.getLine(startRow)?.isWrapped &&
    expanded < MAX_WRAPPED_CONTEXT_LINES
  ) {
    startRow -= 1;
    expanded += 1;
  }
  let endRow = Math.max(startRow + 1, Math.min(requestedEndRow, buffer.length));
  expanded = 0;
  while (
    endRow < buffer.length &&
    buffer.getLine(endRow)?.isWrapped &&
    expanded < MAX_WRAPPED_CONTEXT_LINES
  ) {
    endRow += 1;
    expanded += 1;
  }

  const logicalLines: TerminalBufferLogicalLine[] = [];
  let current: TerminalBufferLogicalLine | null = null;
  for (let row = startRow; row < endRow; row += 1) {
    const line = buffer.getLine(row);
    if (!line) {
      continue;
    }
    if (!current || !line.isWrapped) {
      current = { cells: [], endRow: row, startRow: row, text: "" };
      logicalLines.push(current);
    }
    appendTerminalBufferPhysicalLine(current, line, row, cols);
    current.endRow = row;
  }
  return logicalLines;
}

/**
 * 读取物理行有效内容并把宽字符、组合字符及空白占位映射到真实 cell 范围；
 * 尾部空 cell 不进入逻辑文本，防止正则误把屏幕填充区当作输出内容。
 */
function appendTerminalBufferPhysicalLine(
  target: TerminalBufferLogicalLine,
  line: Pick<IBufferLine, "getCell" | "length">,
  row: number,
  cols: number,
): void {
  const columnCount = Math.min(cols, line.length);
  let lastContentColumn = -1;
  for (let x = columnCount - 1; x >= 0; x -= 1) {
    const cell = line.getCell(x);
    if (cell && cell.getWidth() > 0 && cell.getChars()) {
      lastContentColumn = x;
      break;
    }
  }
  if (lastContentColumn < 0) {
    return;
  }

  let reusableCell: IBufferCell | undefined;
  for (let x = 0; x <= lastContentColumn; x += 1) {
    reusableCell = line.getCell(x, reusableCell);
    if (!reusableCell) {
      continue;
    }
    const width = reusableCell.getWidth();
    if (width <= 0) {
      continue;
    }
    const chars = reusableCell.getChars() || " ";
    const start = target.text.length;
    target.text += chars;
    target.cells.push({
      end: target.text.length,
      row,
      start,
      width,
      x,
    });
  }
}

/**
 * 将一个 UTF-16 文本范围折叠为每个物理行连续的 cell 段；跨行 URL 和关键词
 * 因此可以各自登记 decoration，又不会把换行后的整行错误着色。
 */
export function terminalDecorationSegmentsForTextRange(
  cells: readonly TerminalBufferCellSpan[],
  matchStart: number,
  matchEnd: number,
): TerminalDecorationSegment[] {
  const segments: TerminalDecorationSegment[] = [];
  for (const cell of cells) {
    if (cell.end <= matchStart || cell.start >= matchEnd) {
      continue;
    }
    const previous = segments[segments.length - 1];
    if (
      previous &&
      previous.row === cell.row &&
      previous.x + previous.width === cell.x
    ) {
      previous.width += cell.width;
    } else {
      segments.push({ row: cell.row, width: cell.width, x: cell.x });
    }
  }
  return segments;
}
