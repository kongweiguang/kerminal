// @author kongweiguang

import type {
  IDisposable,
  ILink,
  ILinkProvider,
  ITerminalAddon,
  Terminal as XtermTerminal,
} from "@xterm/xterm";
import {
  resolveDesktopPlatform,
  type DesktopPlatform,
} from "../../lib/desktopPlatform";
import { desktopRuntime } from "../../lib/desktopRuntimeApi";
import {
  buildTerminalBufferLogicalLines,
  terminalDecorationSegmentsForTextRange,
} from "./terminalBufferDecorationModel";

export type TerminalWebLinkOpenResult = "ignored" | "opened" | "rejected";

export interface TerminalWebLinkRange {
  end: number;
  start: number;
  url: string;
}

/**
 * 激活和持久着色必须使用同一个非 global 正则；provider 与装饰 controller 都会
 * 按需克隆，避免两套识别规则造成“看得见但点不到”。
 */
const TERMINAL_WEB_LINK_REGEX =
  /https?:\/\/[^\s"'!*(){}|\\^<>`]*[^\s"':,.!?{}|\\^~\x5b\x5d`()<>]/i;

interface TerminalWebLinkActivationOptions {
  onOpenError?(error: unknown): void;
  openUrl?(url: string): Promise<void>;
  platform?: DesktopPlatform;
}

/**
 * 只接受浏览器可安全处理的 HTTP(S) 地址；终端输出不可信，因此不能把 file、
 * javascript 或自定义 scheme 转交给系统 opener。
 */
export function normalizeTerminalWebUrl(candidate: string): string | null {
  try {
    const url = new URL(candidate);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.href
      : null;
  } catch {
    return null;
  }
}

/**
 * 返回逻辑终端行中所有可点击 HTTP(S) 范围；索引保持 UTF-16 语义，以便直接交给
 * xterm buffer 的 cell 映射层处理 emoji、组合字符与视觉换行。
 */
export function findTerminalWebLinkRanges(
  text: string,
): TerminalWebLinkRange[] {
  const matcher = new RegExp(
    TERMINAL_WEB_LINK_REGEX.source,
    `${TERMINAL_WEB_LINK_REGEX.flags.replace(/g/g, "")}g`,
  );
  const ranges: TerminalWebLinkRange[] = [];
  for (const match of text.matchAll(matcher)) {
    const url = match[0];
    const start = match.index;
    if (!url || start === undefined) {
      continue;
    }
    ranges.push({ end: start + url.length, start, url });
  }
  return ranges;
}

/**
 * 遵循桌面终端惯例：Windows/Linux 使用 Ctrl，macOS 使用 Command，并且仅允许
 * 主鼠标键触发，避免普通选择、右键菜单或终端应用的鼠标协议意外打开浏览器。
 */
export function shouldActivateTerminalWebLink(
  event: Pick<MouseEvent, "button" | "ctrlKey" | "metaKey">,
  platform = resolveDesktopPlatform(),
): boolean {
  if (event.button !== 0) {
    return false;
  }
  return platform === "macos" ? event.metaKey : event.ctrlKey;
}

/**
 * 在完成修饰键与 scheme 双重校验后调用平台 opener；返回明确结果便于测试普通
 * 点击不产生副作用，同时让调用方自行决定打开失败时的 UI 反馈。
 */
export async function openTerminalWebLink(
  event: Pick<
    MouseEvent,
    "button" | "ctrlKey" | "metaKey" | "preventDefault"
  >,
  candidate: string,
  options: Pick<TerminalWebLinkActivationOptions, "openUrl" | "platform"> = {},
): Promise<TerminalWebLinkOpenResult> {
  if (!shouldActivateTerminalWebLink(event, options.platform)) {
    return "ignored";
  }
  const url = normalizeTerminalWebUrl(candidate);
  if (!url) {
    return "rejected";
  }

  event.preventDefault();
  await (options.openUrl ?? ((target) => desktopRuntime.openUrl(target)))(url);
  return "opened";
}

/**
 * 将 xterm 请求的物理行扩展为完整逻辑行，再映射为原生 link provider 范围；
 * 持久 decoration 已经负责下划线，因此 hover 只保留指针反馈，避免叠出第二条线。
 */
function provideTerminalWebLinks(
  terminal: XtermTerminal,
  bufferLineNumber: number,
  options: TerminalWebLinkActivationOptions = {},
): ILink[] | undefined {
  const row = bufferLineNumber - 1;
  const buffer = terminal.buffer.active;
  if (row < 0 || row >= buffer.length) {
    return undefined;
  }
  const logicalLine = buildTerminalBufferLogicalLines(
    buffer,
    terminal.cols,
    row,
    row + 1,
  ).find((line) => line.startRow <= row && line.endRow >= row);
  if (!logicalLine) {
    return undefined;
  }

  const links: ILink[] = [];
  for (const match of findTerminalWebLinkRanges(logicalLine.text)) {
    if (!normalizeTerminalWebUrl(match.url)) {
      continue;
    }
    const segments = terminalDecorationSegmentsForTextRange(
      logicalLine.cells,
      match.start,
      match.end,
    );
    const first = segments[0];
    const last = segments[segments.length - 1];
    if (!first || !last) {
      continue;
    }
    links.push({
      activate: (event, candidate) => {
        void openTerminalWebLink(event, candidate, options).catch((error) => {
          options.onOpenError?.(error);
        });
      },
      decorations: { pointerCursor: true, underline: false },
      range: {
        end: { x: last.x + last.width, y: last.row + 1 },
        start: { x: first.x + 1, y: first.row + 1 },
      },
      text: match.url,
    });
  }
  return links.length > 0 ? links : undefined;
}

/**
 * 使用 xterm 公共 ILinkProvider API 管理 URL 命中和生命周期；不依赖 addon 内部实现，
 * 从而可以显式声明 hover 不绘制下划线，同时保持 Ctrl/Command 激活策略不变。
 */
class TerminalWebLinksAddon implements ITerminalAddon {
  private registration: IDisposable | null = null;

  constructor(private readonly options: TerminalWebLinkActivationOptions) {}

  /** 每个 xterm 实例只登记一个 provider，重复激活时先释放旧登记以避免双重命中。 */
  activate(terminal: XtermTerminal): void {
    this.registration?.dispose();
    const provider: ILinkProvider = {
      provideLinks: (bufferLineNumber, callback) =>
        callback(
          provideTerminalWebLinks(
            terminal,
            bufferLineNumber,
            this.options,
          ),
        ),
    };
    this.registration = terminal.registerLinkProvider(provider);
  }

  /** 释放 provider 登记，确保终端销毁后不再保留 buffer 与错误回调。 */
  dispose(): void {
    this.registration?.dispose();
    this.registration = null;
  }
}

/**
 * 创建遵循 Kerminal 持久下划线视觉契约的可点击 URL addon；具体 provider 在 xterm
 * 激活阶段登记，以便继续由 terminal addon store 统一管理释放顺序。
 */
export function createTerminalWebLinksAddon(
  options: TerminalWebLinkActivationOptions = {},
): ITerminalAddon {
  return new TerminalWebLinksAddon(options);
}
