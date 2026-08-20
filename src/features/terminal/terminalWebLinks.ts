// @author kongweiguang

import { WebLinksAddon } from "@xterm/addon-web-links";
import {
  resolveDesktopPlatform,
  type DesktopPlatform,
} from "../../lib/desktopPlatform";
import { desktopRuntime } from "../../lib/desktopRuntimeApi";

export type TerminalWebLinkOpenResult = "ignored" | "opened" | "rejected";

export interface TerminalWebLinkRange {
  end: number;
  start: number;
  url: string;
}

/**
 * 激活和持久着色必须使用同一个非 global 正则；WebLinksAddon 会自行追加 global
 * flag，而装饰 controller 会按需克隆，避免两套识别规则造成“看得见但点不到”。
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
 * 使用 xterm 官方 URL 解析器覆盖 ANSI、宽字符与自然换行场景；这里仅封装激活
 * 策略和错误出口，addon 的生命周期仍交给 xterm 统一释放。
 */
export function createTerminalWebLinksAddon(
  options: TerminalWebLinkActivationOptions = {},
): WebLinksAddon {
  return new WebLinksAddon(
    (event, candidate) => {
      void openTerminalWebLink(event, candidate, options).catch((error) => {
        options.onOpenError?.(error);
      });
    },
    { urlRegex: TERMINAL_WEB_LINK_REGEX },
  );
}
