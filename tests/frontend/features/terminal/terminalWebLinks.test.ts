// @author kongweiguang

import type {
  IBuffer,
  IBufferCell,
  IBufferLine,
  ILink,
  ILinkProvider,
  Terminal as XtermTerminal,
} from "@xterm/xterm";
import { describe, expect, it, vi } from "vitest";
import {
  createTerminalWebLinksAddon,
  findTerminalWebLinkRanges,
  normalizeTerminalWebUrl,
  openTerminalWebLink,
  shouldActivateTerminalWebLink,
} from "../../../../src/features/terminal/terminalWebLinks";

/** 构造只包含链接策略所需字段的鼠标事件，避免测试依赖 DOM 命中区域。 */
function mouseEvent(
  overrides: Partial<Pick<MouseEvent, "button" | "ctrlKey" | "metaKey">> = {},
) {
  return {
    button: 0,
    ctrlKey: false,
    metaKey: false,
    preventDefault: vi.fn(),
    ...overrides,
  };
}

/** 构造 provider 范围映射所需的单宽物理行。 */
function textLine(text: string, isWrapped = false): IBufferLine {
  const cells = Array.from(text, (chars) =>
    ({
      getChars: () => chars,
      getWidth: () => 1,
    }) as IBufferCell,
  );
  return {
    getCell: (index: number) => cells[index],
    isWrapped,
    length: cells.length,
  } as IBufferLine;
}

/** 构造只实现公开 link provider API 的 xterm，便于检查 hover 装饰与释放。 */
function linkProviderTerminal(lines: IBufferLine[], cols = 80) {
  const buffer = {
    getLine: (index: number) => lines[index],
    length: lines.length,
  } as IBuffer;
  let provider: ILinkProvider | null = null;
  let registrationDisposed = false;
  const terminal = {
    buffer: { active: buffer },
    cols,
    registerLinkProvider(candidate: ILinkProvider) {
      provider = candidate;
      return { dispose: () => (registrationDisposed = true) };
    },
  } as unknown as XtermTerminal;
  return {
    getProvider: () => provider,
    isRegistrationDisposed: () => registrationDisposed,
    terminal,
  };
}

describe("terminalWebLinks", () => {
  /** 持久着色和点击 provider 共用的范围规则应忽略尾随标点并支持大小写 scheme。 */
  it("finds the exact clickable ranges used by URL decorations", () => {
    expect(
      findTerminalWebLinkRanges(
        "Docs HTTPS://example.com/path?q=1, mirror http://127.0.0.1:8080/status.",
      ).map((range) => range.url),
    ).toEqual([
      "HTTPS://example.com/path?q=1",
      "http://127.0.0.1:8080/status",
    ]);
    expect(findTerminalWebLinkRanges("file:///tmp/a javascript:alert(1)"))
      .toEqual([]);
  });

  /** URL 规范化必须与 Tauri capability 一样只放行 HTTP(S)。 */
  it("normalizes HTTP(S) URLs and rejects unsafe schemes", () => {
    expect(normalizeTerminalWebUrl("https://example.com/path?q=1")).toBe(
      "https://example.com/path?q=1",
    );
    expect(normalizeTerminalWebUrl("http://127.0.0.1:8080/status")).toBe(
      "http://127.0.0.1:8080/status",
    );

    for (const candidate of [
      "file:///C:/Windows/System32/calc.exe",
      "javascript:alert(1)",
      "mailto:ops@example.com",
      "example.com/no-scheme",
      "not a url",
    ]) {
      expect(normalizeTerminalWebUrl(candidate)).toBeNull();
    }
  });

  /** Windows/Linux 必须是 Ctrl+主键，普通点击和右键都保留给终端。 */
  it("requires Ctrl plus the primary mouse button on Windows", () => {
    expect(
      shouldActivateTerminalWebLink(
        mouseEvent({ ctrlKey: true }),
        "windows",
      ),
    ).toBe(true);
    expect(shouldActivateTerminalWebLink(mouseEvent(), "windows")).toBe(false);
    expect(
      shouldActivateTerminalWebLink(
        mouseEvent({ button: 2, ctrlKey: true }),
        "windows",
      ),
    ).toBe(false);
  });

  /** macOS 使用 Command，避免把 Ctrl+点击这一原生辅助点击手势改成打开链接。 */
  it("uses Command instead of Ctrl on macOS", () => {
    expect(
      shouldActivateTerminalWebLink(
        mouseEvent({ metaKey: true }),
        "macos",
      ),
    ).toBe(true);
    expect(
      shouldActivateTerminalWebLink(
        mouseEvent({ ctrlKey: true }),
        "macos",
      ),
    ).toBe(false);
  });

  /** 通过策略后只调用一次 opener，并阻止 WebView 对该点击执行额外默认动作。 */
  it("opens a validated URL exactly once after the modifier gate", async () => {
    const event = mouseEvent({ ctrlKey: true });
    const openUrl = vi.fn().mockResolvedValue(undefined);

    await expect(
      openTerminalWebLink(event, "https://example.com/docs", {
        openUrl,
        platform: "windows",
      }),
    ).resolves.toBe("opened");

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(openUrl).toHaveBeenCalledWith("https://example.com/docs");
  });

  /** 未按修饰键时不能调用 opener，也不能破坏终端原有点击行为。 */
  it("keeps an unmodified click side-effect free", async () => {
    const event = mouseEvent();
    const openUrl = vi.fn().mockResolvedValue(undefined);

    await expect(
      openTerminalWebLink(event, "https://example.com/docs", {
        openUrl,
        platform: "windows",
      }),
    ).resolves.toBe("ignored");

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(openUrl).not.toHaveBeenCalled();
  });

  /** 持久下划线存在时 provider 只增加 pointer，跨行范围和原激活策略保持不变。 */
  it("keeps hover underline disabled for persistent wrapped URL decorations", async () => {
    const fake = linkProviderTerminal([
      textLine("Docs https://example."),
      textLine("com/path", true),
    ]);
    const openUrl = vi.fn().mockResolvedValue(undefined);
    const addon = createTerminalWebLinksAddon({
      openUrl,
      platform: "windows",
    });
    addon.activate(fake.terminal);

    let links: ILink[] | undefined;
    fake.getProvider()?.provideLinks(1, (provided) => (links = provided));
    expect(links).toHaveLength(1);
    expect(links?.[0]).toMatchObject({
      decorations: { pointerCursor: true, underline: false },
      range: {
        end: { x: 8, y: 2 },
        start: { x: 6, y: 1 },
      },
      text: "https://example.com/path",
    });

    const event = new MouseEvent("click", {
      button: 0,
      cancelable: true,
      ctrlKey: true,
    });
    const link = links?.[0];
    link?.activate(event, link.text);
    await vi.waitFor(() =>
      expect(openUrl).toHaveBeenCalledWith("https://example.com/path"),
    );

    addon.dispose();
    expect(fake.isRegistrationDisposed()).toBe(true);
  });
});
