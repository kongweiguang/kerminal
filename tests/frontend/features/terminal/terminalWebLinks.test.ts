// @author kongweiguang

import { describe, expect, it, vi } from "vitest";
import {
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

describe("terminalWebLinks", () => {
  /** 持久着色和 WebLinksAddon 共用的范围规则应忽略尾随标点并支持大小写 scheme。 */
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
});
