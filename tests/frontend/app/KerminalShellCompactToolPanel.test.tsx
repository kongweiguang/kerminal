// @author kongweiguang

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  KerminalShellNotices,
  ShellCompactToolPanel,
  ShellResponsiveToolPanel,
  ShellResponsiveToolPanels,
} from "../../../src/app/KerminalShell.view";

function StatefulAgentPanel({ onUnmount }: { onUnmount: () => void }) {
  const [messageCount, setMessageCount] = useState(1);

  useEffect(() => onUnmount, [onUnmount]);

  return (
    <button
      data-testid="stateful-agent-panel"
      onClick={() => setMessageCount((current) => current + 1)}
      type="button"
    >
      Claude 对话记录 {messageCount}
    </button>
  );
}

describe("ShellCompactToolPanel", () => {
  it("keeps keyboard focus inside the modal drawer", async () => {
    render(
      <>
        <button type="button">抽屉外操作</button>
        <ShellCompactToolPanel onClose={vi.fn()}>
          <button aria-pressed="true" type="button">
            当前工具
          </button>
          <button type="button">最后操作</button>
        </ShellCompactToolPanel>
      </>,
    );

    const outsideButton = screen.getByRole("button", { name: "抽屉外操作" });
    const closeButton = screen.getByRole("button", { name: "关闭工具面板" });
    const currentToolButton = screen.getByRole("button", { name: "当前工具" });
    const lastButton = screen.getByRole("button", { name: "最后操作" });

    await waitFor(() => expect(currentToolButton).toHaveFocus());

    lastButton.focus();
    fireEvent.keyDown(window, { key: "Tab" });
    expect(closeButton).toHaveFocus();

    closeButton.focus();
    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(lastButton).toHaveFocus();

    outsideButton.focus();
    fireEvent.keyDown(window, { key: "Tab" });
    expect(closeButton).toHaveFocus();
  });

  it("uses the shared overlay, dialog and material contracts", () => {
    render(
      <ShellCompactToolPanel onClose={vi.fn()}>
        <button aria-pressed="true" type="button">
          当前工具
        </button>
      </ShellCompactToolPanel>,
    );

    expect(screen.getByRole("button", { name: "关闭紧凑工具面板" })).toHaveClass(
      "kerminal-layer-overlay",
    );
    expect(screen.getByRole("dialog", { name: "紧凑工具面板" })).toHaveClass(
      "kerminal-floating-surface",
      "kerminal-layer-dialog",
      "rounded-[var(--radius-panel)]",
    );
    expect(screen.getByRole("dialog", { name: "紧凑工具面板" })).not.toHaveClass(
      "kerminal-tool-panel-surface",
    );
  });
});

describe("ShellResponsiveToolPanel", () => {
  it("自由浮窗保留右栏入口且不创建遮罩或焦点锁", async () => {
    const user = userEvent.setup();
    const outsideAction = vi.fn();
    render(
      <>
        <button onClick={outsideAction} type="button">
          终端操作
        </button>
        <ShellResponsiveToolPanel
          activeTool="system"
          compact={false}
          onClose={vi.fn()}
          panel={<div>系统内容</div>}
          placement="center"
          rail={<button type="button">右栏入口</button>}
        />
      </>,
    );

    const floatingPanel = screen.getByRole("dialog", {
      name: "可拖动工具浮窗",
    });
    const railButton = screen.getByRole("button", { name: "右栏入口" });
    expect(railButton).toBeVisible();
    expect(railButton.parentElement).toHaveStyle({
      zIndex: "calc(var(--layer-workspace-window) + 1)",
    });
    expect(floatingPanel).toHaveAttribute("data-tool-panel-placement", "center");
    expect(floatingPanel).toHaveAttribute("data-tool-panel-non-modal", "true");
    expect(floatingPanel).toHaveClass("kerminal-floating-window-enter");
    expect(floatingPanel).not.toHaveClass("kerminal-floating-enter");
    expect(floatingPanel).not.toHaveAttribute("aria-modal");
    expect(floatingPanel).toHaveClass(
      "kerminal-tool-panel-surface",
      "kerminal-layer-workspace-window",
    );
    expect(floatingPanel).not.toHaveClass("kerminal-solid-surface");
    expect(
      screen.queryByRole("button", { name: "关闭紧凑工具面板" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "拖动工具浮窗" })).toBeVisible();
    expect(screen.getByText("系统内容")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "终端操作" }));
    expect(outsideAction).toHaveBeenCalledTimes(1);
    expect(floatingPanel).toBeVisible();
  });

  it("在 Shell 边界内拖动自由浮窗并支持方向键微调", () => {
    const { container } = render(
      <ShellResponsiveToolPanel
        activeTool="system"
        compact={false}
        onClose={vi.fn()}
        panel={<div>系统内容</div>}
        placement="center"
        rail={<button type="button">右栏入口</button>}
      />,
    );
    const floatingPanel = screen.getByRole("dialog", {
      name: "可拖动工具浮窗",
    });
    const dragHandle = screen.getByRole("button", { name: "拖动工具浮窗" });
    Object.defineProperty(container, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        bottom: 700,
        height: 700,
        left: 0,
        right: 1_000,
        toJSON: () => ({}),
        top: 0,
        width: 1_000,
        x: 0,
        y: 0,
      }),
    });
    Object.defineProperty(floatingPanel, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        bottom: 352,
        height: 300,
        left: 132,
        right: 532,
        toJSON: () => ({}),
        top: 52,
        width: 400,
        x: 132,
        y: 52,
      }),
    });
    fireEvent(window, new Event("resize"));

    fireEvent.pointerDown(dragHandle, {
      button: 0,
      buttons: 1,
      clientX: 200,
      clientY: 100,
      pointerId: 7,
    });
    fireEvent.pointerMove(window, {
      buttons: 1,
      clientX: 340,
      clientY: 180,
      pointerId: 7,
    });
    fireEvent.pointerUp(window, {
      buttons: 0,
      clientX: 340,
      clientY: 180,
      pointerId: 7,
    });

    expect(floatingPanel).toHaveStyle({
      transform: "translate3d(272px, 132px, 0)",
    });
    fireEvent.keyDown(dragHandle, { key: "ArrowRight", shiftKey: true });
    expect(floatingPanel).toHaveStyle({
      transform: "translate3d(312px, 132px, 0)",
    });
  });

  it("左侧栏占用主机栏和终端之间的独立网格列", () => {
    render(
      <ShellResponsiveToolPanel
        activeTool="system"
        compact={false}
        onClose={vi.fn()}
        panel={<div>系统内容</div>}
        placement="left"
        rail={<button type="button">右栏入口</button>}
      />,
    );

    expect(screen.getByRole("button", { name: "右栏入口" })).toBeVisible();
    expect(
      screen.getByRole("complementary", { name: "左侧工具面板" }),
    ).toHaveStyle({ gridColumn: "3 / 4", gridRow: "2 / 5" });
    expect(screen.getByText("系统内容")).toBeVisible();
  });

  it("桌面端同时渲染左、右、底部和自由浮窗四个独立槽位", () => {
    const onClose = vi.fn();
    const { container } = render(
      <ShellResponsiveToolPanels
        activeTool="sftp"
        activeTools={["context", "logs", "system", "sftp"]}
        compact={false}
        onClose={onClose}
        openPanels={{
          attached: "logs",
          bottom: "system",
          center: "sftp",
          left: "context",
        }}
        rail={<button type="button">右栏入口</button>}
        renderPanel={(toolId) => <div>{toolId} 内容</div>}
      />,
    );

    const visiblePlacements = Array.from(
      container.querySelectorAll<HTMLElement>(
        "section[data-tool-panel-placement]:not([hidden])",
      ),
    ).map((panel) => panel.dataset.toolPanelPlacement);
    expect(visiblePlacements).toEqual([
      "attached",
      "left",
      "bottom",
      "center",
    ]);
    expect(
      screen.getByRole("complementary", { name: "底部工具面板" }),
    ).toHaveStyle({ gridColumn: "5 / 6", gridRow: "4 / 5" });
    expect(
      screen.getByRole("dialog", { name: "可拖动工具浮窗" }),
    ).toBeVisible();

    fireEvent.click(
      screen
        .getByRole("complementary", { name: "底部工具面板" })
        .querySelector<HTMLButtonElement>('button[aria-label="关闭工具面板"]')!,
    );
    expect(onClose).toHaveBeenCalledWith("system");
  });

  it.each(["attached", "left", "bottom", "center"] as const)(
    "%s 桌面位置共用可透出壁纸的单层工具材质",
    (placement) => {
      render(
        <ShellResponsiveToolPanel
          activeTool="system"
          compact={false}
          onClose={vi.fn()}
          panel={<div data-testid="tool-panel-content">系统内容</div>}
          placement={placement}
          rail={<button type="button">右栏入口</button>}
        />,
      );

      const surface = screen
        .getByTestId("tool-panel-content")
        .closest<HTMLElement>("[data-tool-panel-placement]");
      const contentHost = screen
        .getByTestId("tool-panel-content")
        .closest<HTMLElement>(".kerminal-tool-panel-host");

      expect(surface).toHaveAttribute("data-tool-panel-placement", placement);
      expect(surface).toHaveClass("kerminal-tool-panel-surface");
      expect(surface).not.toHaveClass("kerminal-solid-surface");
      expect(contentHost).toHaveAttribute("data-compositor", "surface-parent");
    },
  );

  it.each([
    ["桌面", false],
    ["紧凑", true],
  ])("%s布局收起右栏时保留 Agent 进程与对话视图", async (_label, compact) => {
    const user = userEvent.setup();
    const onUnmount = vi.fn();
    const onClose = vi.fn();
    const renderPanel = (activeTool: "agentLauncher" | null) => (
      <ShellResponsiveToolPanel
        activeTool={activeTool}
        compact={compact}
        onClose={onClose}
        panel={<StatefulAgentPanel onUnmount={onUnmount} />}
        rail={<button type="button">打开 Agent</button>}
      />
    );
    const { rerender } = render(renderPanel("agentLauncher"));

    const conversation = screen.getByTestId("stateful-agent-panel");
    await user.click(conversation);
    expect(conversation).toHaveTextContent("Claude 对话记录 2");

    rerender(renderPanel(null));

    expect(onUnmount).not.toHaveBeenCalled();
    expect(screen.getByTestId("stateful-agent-panel")).toHaveTextContent(
      "Claude 对话记录 2",
    );

    rerender(renderPanel("agentLauncher"));

    expect(onUnmount).not.toHaveBeenCalled();
    expect(screen.getByTestId("stateful-agent-panel")).toHaveTextContent(
      "Claude 对话记录 2",
    );
  });

  it("跨桌面与紧凑断点时不重建 Agent 终端", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onUnmount = vi.fn();
    const renderPanel = (compact: boolean) => (
      <ShellResponsiveToolPanel
        activeTool="agentLauncher"
        compact={compact}
        onClose={onClose}
        panel={<StatefulAgentPanel onUnmount={onUnmount} />}
        rail={<button type="button">打开 Agent</button>}
      />
    );
    const { rerender } = render(renderPanel(false));

    await user.click(screen.getByTestId("stateful-agent-panel"));
    expect(screen.getByTestId("stateful-agent-panel")).toHaveTextContent(
      "Claude 对话记录 2",
    );

    rerender(renderPanel(true));

    expect(onUnmount).not.toHaveBeenCalled();
    expect(screen.getByTestId("stateful-agent-panel")).toHaveTextContent(
      "Claude 对话记录 2",
    );

    rerender(renderPanel(false));

    expect(onUnmount).not.toHaveBeenCalled();
    expect(screen.getByTestId("stateful-agent-panel")).toHaveTextContent(
      "Claude 对话记录 2",
    );
  });

  it("切换右停靠、左停靠与浮窗位置时不重建 Agent 内容", async () => {
    const user = userEvent.setup();
    const onUnmount = vi.fn();
    const renderPanel = (placement: "attached" | "left" | "center") => (
      <ShellResponsiveToolPanel
        activeTool="agentLauncher"
        compact={false}
        onClose={vi.fn()}
        panel={<StatefulAgentPanel onUnmount={onUnmount} />}
        placement={placement}
        rail={<button type="button">打开 Agent</button>}
      />
    );
    const { rerender } = render(renderPanel("attached"));

    await user.click(screen.getByTestId("stateful-agent-panel"));
    rerender(renderPanel("left"));
    rerender(renderPanel("center"));

    expect(onUnmount).not.toHaveBeenCalled();
    expect(screen.getByTestId("stateful-agent-panel")).toHaveTextContent(
      "Claude 对话记录 2",
    );
  });

  it.each(["attached", "left", "bottom"] as const)(
    "自由浮窗切换到 %s 时清理拖拽位移并保持内容可见",
    async (placement) => {
      const renderPanel = (nextPlacement: "center" | typeof placement) => (
        <ShellResponsiveToolPanel
          activeTool="agentLauncher"
          compact={false}
          onClose={vi.fn()}
          panel={<div>Agent 内容</div>}
          placement={nextPlacement}
          rail={<button type="button">打开 Agent</button>}
        />
      );
      const { container, rerender } = render(renderPanel("center"));
      const floatingPanel = await screen.findByRole("dialog", {
        name: "可拖动工具浮窗",
      });

      await waitFor(() =>
        expect(floatingPanel.style.transform).toMatch(/^translate3d\(/),
      );
      rerender(renderPanel(placement));

      await waitFor(() => {
        const dockedPanel = container.querySelector<HTMLElement>(
          `section[data-tool-panel-placement="${placement}"]`,
        );
        expect(dockedPanel).toBe(floatingPanel);
        expect(dockedPanel).toBeVisible();
        expect(dockedPanel?.style.transform).toBe("");
      });
      fireEvent(window, new Event("resize"));
      expect(floatingPanel.style.transform).toBe("");
    },
  );
});

describe("KerminalShellNotices", () => {
  it("renders a quiet semantic toast and keeps dismissal behavior", async () => {
    const user = userEvent.setup();
    const onConfigNoticeDismiss = vi.fn();

    render(
      <KerminalShellNotices
        configNotice={{
          batchId: "batch-1",
          domains: ["settings"],
          id: "notice-1",
          level: "info",
          text: "设置已在外部更新。",
          ttlMs: 3_000,
        }}
        onConfigNoticeDismiss={onConfigNoticeDismiss}
        onShellNoticeDismiss={vi.fn()}
        shellNoticeVisible={false}
      />,
    );

    const notice = screen.getByRole("status");
    expect(notice).toHaveClass(
      "kerminal-floating-surface",
      "text-[var(--text-primary)]",
    );
    expect(notice).not.toHaveClass("font-mono");
    expect(notice.parentElement).toHaveClass("kerminal-layer-toast");

    await user.click(screen.getByRole("button", { name: "关闭提示" }));
    expect(onConfigNoticeDismiss).toHaveBeenCalledTimes(1);
  });
});
