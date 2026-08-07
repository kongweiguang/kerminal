// @author kongweiguang

import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ModalShell } from "../../../../src/components/ui/modal-shell";

const windowChromeMocks = vi.hoisted(() => ({
  frameState: "normal" as "fullscreen" | "maximized" | "normal",
  platform: "windows" as "browser" | "linux" | "macos" | "windows",
}));

vi.mock("../../../../src/lib/desktopPlatform", () => ({
  resolveDesktopPlatform: () => windowChromeMocks.platform,
}));

vi.mock("../../../../src/lib/useTauriWindowFrameState", () => ({
  useTauriWindowFrameState: () => windowChromeMocks.frameState,
}));

describe("ModalShell", () => {
  beforeEach(() => {
    windowChromeMocks.frameState = "normal";
    windowChromeMocks.platform = "windows";
    document.body.style.overflow = "";
  });

  it("applies adaptive preset constraints to default dialogs", () => {
    render(
      <ModalShell onClose={vi.fn()} open size="small" title="自适应尺寸">
        <span>内容</span>
      </ModalShell>,
    );

    const dialog = screen.getByRole("dialog", { name: "自适应尺寸" });

    expect(dialog).toHaveClass("max-h-[min(24rem,calc(100vh-48px))]");
    expect(dialog).not.toHaveClass("h-[min(24rem,calc(100vh-48px))]");
    expect(dialog).toHaveClass("max-w-lg");
    expect(screen.getByText("内容").parentElement).toHaveClass("flex-auto");
  });

  it("keeps the preset max height when callers customize only the width", () => {
    render(
      <ModalShell
        maxWidthClassName="max-w-4xl"
        onClose={vi.fn()}
        open
        size="large"
        title="自定义宽度"
      >
        内容
      </ModalShell>,
    );

    const dialog = screen.getByRole("dialog", { name: "自定义宽度" });

    expect(dialog).toHaveClass("max-h-[min(44rem,calc(100vh-48px))]");
    expect(dialog).toHaveClass("max-w-4xl");
  });

  it("does not override explicit panel height constraints", () => {
    render(
      <ModalShell
        onClose={vi.fn()}
        open
        panelClassName="h-[min(820px,calc(100vh-48px))]"
        size="large"
        title="显式高度"
      >
        内容
      </ModalShell>,
    );

    const dialog = screen.getByRole("dialog", { name: "显式高度" });

    expect(dialog).toHaveClass("h-[min(820px,calc(100vh-48px))]");
    expect(dialog).not.toHaveClass("max-h-[min(44rem,calc(100vh-48px))]");
  });

  it("keeps a Tauri-managed top drag strip outside dialog content", () => {
    render(
      <ModalShell
        layout="fullscreen"
        onClose={vi.fn()}
        open
        title="全屏工作台"
      >
        内容
      </ModalShell>,
    );

    const dialog = screen.getByRole("dialog", { name: "全屏工作台" });
    const dragStrip = document.querySelector("[data-window-drag-strip]");

    expect(dragStrip).toBeInTheDocument();
    expect(dialog.contains(dragStrip)).toBe(false);
    expect(dragStrip?.parentElement).toHaveClass("pt-3");
    expect(dragStrip).toHaveAttribute("data-tauri-drag-region");

    fireEvent.doubleClick(dragStrip!);
  });

  it("captures Escape, traps focus and restores the source focus", () => {
    const onClose = vi.fn();
    const source = document.createElement("button");
    document.body.append(source);
    source.focus();

    const { rerender } = render(
      <ModalShell onClose={onClose} open title="焦点合同">
        <button type="button">第一个</button>
        <button type="button">最后一个</button>
      </ModalShell>,
    );

    const closeButton = screen.getByRole("button", { name: "关闭弹窗" });
    const last = screen.getByRole("button", { name: "最后一个" });
    last.focus();
    fireEvent.keyDown(window, { key: "Tab" });
    expect(closeButton).toHaveFocus();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();

    rerender(
      <ModalShell onClose={onClose} open={false} title="焦点合同">
        内容
      </ModalShell>,
    );
    expect(source).toHaveFocus();
    source.remove();
  });

  it("locks body scrolling until the last nested dialog closes", () => {
    const { rerender } = render(
      <>
        <ModalShell onClose={vi.fn()} open title="父弹框">
          父内容
        </ModalShell>
        <ModalShell onClose={vi.fn()} open title="子弹框">
          子内容
        </ModalShell>
      </>,
    );

    expect(document.body.style.overflow).toBe("hidden");
    rerender(
      <>
        <ModalShell onClose={vi.fn()} open title="父弹框">
          父内容
        </ModalShell>
        <ModalShell onClose={vi.fn()} open={false} title="子弹框">
          子内容
        </ModalShell>
      </>,
    );
    expect(document.body.style.overflow).toBe("hidden");

    rerender(
      <>
        <ModalShell onClose={vi.fn()} open={false} title="父弹框">
          父内容
        </ModalShell>
        <ModalShell onClose={vi.fn()} open={false} title="子弹框">
          子内容
        </ModalShell>
      </>,
    );
    expect(document.body.style.overflow).toBe("");
  });

  it("does not steal focus from a React autoFocus input", async () => {
    const user = userEvent.setup();
    render(
      <ModalShell onClose={vi.fn()} open title="自动聚焦">
        <label>
          密码
          <input autoFocus />
        </label>
      </ModalShell>,
    );

    const input = screen.getByRole("textbox", { name: "密码" });
    await user.type(input, "secret-password");

    expect(input).toHaveFocus();
    expect(input).toHaveValue("secret-password");
  });

  it("uses a solid compositor without changing keyboard behavior", () => {
    const onClose = vi.fn();
    render(
      <ModalShell backdrop="solid" onClose={onClose} open title="实色弹框">
        <button type="button">第一个</button>
        <button type="button">最后一个</button>
      </ModalShell>,
    );

    const dialog = screen.getByRole("dialog", { name: "实色弹框" });
    const overlay = dialog.parentElement;
    expect(overlay).toHaveAttribute("data-compositor", "solid");
    expect(overlay).not.toHaveClass("backdrop-blur-md");
    expect(dialog).toHaveClass("kerminal-solid-surface");
    expect(dialog).toHaveClass("bg-[var(--surface-overlay)]");
    expect(dialog).not.toHaveClass("kerminal-floating-surface");

    const first = screen.getByRole("button", { name: "关闭弹窗" });
    const last = screen.getByRole("button", { name: "最后一个" });
    last.focus();
    fireEvent.keyDown(window, { key: "Tab" });
    expect(first).toHaveFocus();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });
});
