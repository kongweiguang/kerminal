// @author kongweiguang

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  KerminalShellNotices,
  ShellCompactToolPanel,
  ShellResponsiveToolPanel,
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
  });
});

describe("ShellResponsiveToolPanel", () => {
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
