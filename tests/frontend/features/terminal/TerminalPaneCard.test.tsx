// @author kongweiguang

import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultAppSettings } from "../../../../src/features/settings/settingsModel";
import type { TerminalPane } from "../../../../src/features/workspace/types";
import {
  baseTerminalPane,
  terminalMachineGroups,
} from "../../support/terminal/TerminalWorkspace.testSupport.ts";
import { TerminalPaneCard } from "../../../../src/features/terminal/TerminalPaneCard";

const xtermPaneMock = vi.hoisted(() => ({
  lastInitialOutputHistory: undefined as string | undefined,
  renderCount: 0,
}));

vi.mock("../../../../src/features/terminal/XtermPane", () => ({
  XtermPane: ({
    onCurrentCwdChange,
    onOutputHistoryChange,
    onSplitPane,
    resolveInitialOutputHistory,
    title,
  }: {
    onCurrentCwdChange?: (cwd: string) => void;
    onOutputHistoryChange?: (outputHistory: string | undefined) => void;
    onSplitPane?: (direction: "horizontal" | "vertical") => void;
    resolveInitialOutputHistory?: () => string | undefined;
    title: string;
  }) => {
    xtermPaneMock.renderCount += 1;
    xtermPaneMock.lastInitialOutputHistory = resolveInitialOutputHistory?.();

    return (
      <div aria-label={`${title} xterm 终端`}>
        <button onClick={() => onCurrentCwdChange?.("C:\\repo")} type="button">
          上报 cwd
        </button>
        <button
          onClick={() => onOutputHistoryChange?.("history")}
          type="button"
        >
          上报输出
        </button>
        <button onClick={() => onSplitPane?.("vertical")} type="button">
          垂直分屏
        </button>
      </div>
    );
  },
}));

function renderPaneCard(
  pane: TerminalPane,
  overrides: Partial<Parameters<typeof TerminalPaneCard>[0]> = {},
) {
  return render(
    <TerminalPaneCard
      focused={false}
      onClosePane={vi.fn()}
      onFocusPane={vi.fn()}
      pane={pane}
      resolvedTheme="dark"
      terminalAppearance={defaultAppSettings.terminal}
      {...overrides}
    />,
  );
}

describe("TerminalPaneCard", () => {
  beforeEach(() => {
    xtermPaneMock.lastInitialOutputHistory = undefined;
    xtermPaneMock.renderCount = 0;
  });

  it("renders runtime panes through XtermPane and forwards pane-scoped callbacks", async () => {
    const user = userEvent.setup();
    const onCurrentCwdChange = vi.fn();
    const onOutputHistoryChange = vi.fn();
    const onSplitPane = vi.fn();
    const sshPane: TerminalPane = {
      ...baseTerminalPane,
      id: "pane-ssh",
      latencyMs: 42,
      mode: "ssh",
      remoteHostId: "host-prod",
      title: "prod-api",
    };

    renderPaneCard(sshPane, {
      focused: true,
      onCurrentCwdChange,
      onOutputHistoryChange,
      onSplitPane,
    });

    expect(screen.getByLabelText("prod-api 终端分屏")).toHaveAttribute(
      "data-focused",
      "true",
    );
    expect(screen.getByLabelText("prod-api xterm 终端")).toBeInTheDocument();
    expect(screen.getByText("42ms")).toBeInTheDocument();
    expect(screen.queryByLabelText("连接正常")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("连接警告")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("连接已断开")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "上报 cwd" }));
    await user.click(screen.getByRole("button", { name: "上报输出" }));
    await user.click(screen.getByRole("button", { name: "垂直分屏" }));

    expect(onCurrentCwdChange).toHaveBeenCalledWith("pane-ssh", "C:\\repo");
    expect(onOutputHistoryChange).toHaveBeenCalledWith("pane-ssh", "history");
    expect(onSplitPane).toHaveBeenCalledWith("vertical", {
      sourcePaneId: "pane-ssh",
    });
  });

  it("only shows pane status markers for warning and offline states", () => {
    const { rerender } = renderPaneCard({
      ...baseTerminalPane,
      status: "warning",
    });

    expect(screen.getByLabelText("连接警告")).toHaveClass("bg-amber-400");

    rerender(
      <TerminalPaneCard
        focused={false}
        onClosePane={vi.fn()}
        onFocusPane={vi.fn()}
        pane={{ ...baseTerminalPane, status: "offline" }}
        resolvedTheme="dark"
        terminalAppearance={defaultAppSettings.terminal}
      />,
    );

    expect(screen.getByLabelText("连接已断开")).toHaveClass("bg-red-400");
    expect(screen.queryByLabelText("连接警告")).not.toBeInTheDocument();
  });

  it("keeps split actions beside the pane close control", async () => {
    const user = userEvent.setup();
    const onFocusPane = vi.fn();
    const onSplitPane = vi.fn();
    const sshPane: TerminalPane = {
      ...baseTerminalPane,
      id: "pane-ssh",
      machineId: "host-prod",
      mode: "ssh",
      remoteHostId: "host-prod",
      title: "prod-api",
    };

    renderPaneCard(sshPane, {
      machineGroups: terminalMachineGroups,
      onFocusPane,
      onSplitPane,
    });

    await user.click(screen.getByRole("button", { name: "prod-api 左右分屏" }));

    expect(onFocusPane).toHaveBeenCalledWith("pane-ssh");
    expect(onSplitPane).toHaveBeenCalledWith("horizontal", {
      sourcePaneId: "pane-ssh",
    });
    expect(
      screen.getByRole("button", { name: "关闭 prod-api 分屏" }),
    ).toBeInTheDocument();
  });

  it("hydrates stripped runtime pane output from the resolver", () => {
    renderPaneCard(
      {
        ...baseTerminalPane,
        outputHistory: undefined,
      },
      {
        resolvePaneOutputHistory: (paneId) =>
          paneId === "pane-local" ? "restored history" : undefined,
      },
    );

    expect(xtermPaneMock.lastInitialOutputHistory).toBe("restored history");
  });

  it("renders preview panes without mounting the xterm runtime", () => {
    renderPaneCard({
      ...baseTerminalPane,
      id: "pane-preview",
      lines: ["第一行", "第二行"],
      mode: "preview",
      prompt: "ERR>",
      title: "诊断输出",
    });

    expect(screen.getByLabelText("诊断输出 终端分屏")).toBeInTheDocument();
    expect(screen.getByText("第一行")).toBeInTheDocument();
    expect(screen.getByText("第二行")).toBeInTheDocument();
    expect(screen.getByText("第一行").closest("pre")).toHaveClass(
      "kerminal-terminal-preview",
    );
    expect(screen.getByText("ERR>")).toBeInTheDocument();
    expect(
      screen.queryByLabelText("诊断输出 xterm 终端"),
    ).not.toBeInTheDocument();
    expect(xtermPaneMock.renderCount).toBe(0);
  });

  it("hydrates stripped preview pane lines from the resolver", () => {
    renderPaneCard(
      {
        ...baseTerminalPane,
        id: "pane-preview",
        lines: [],
        mode: "preview",
        prompt: "ERR>",
        title: "诊断输出",
      },
      {
        resolvePaneLines: (paneId) =>
          paneId === "pane-preview" ? ["恢复第一行", "恢复第二行"] : [],
      },
    );

    expect(screen.getByText("恢复第一行")).toBeInTheDocument();
    expect(screen.getByText("恢复第二行")).toBeInTheDocument();
    expect(xtermPaneMock.renderCount).toBe(0);
  });

  it("focuses the pane from the card shell but keeps close clicks isolated", async () => {
    const user = userEvent.setup();
    const onClosePane = vi.fn();
    const onFocusPane = vi.fn();

    renderPaneCard(baseTerminalPane, { onClosePane, onFocusPane });

    await user.click(screen.getByLabelText("本地 PowerShell 终端分屏"));
    expect(onFocusPane).toHaveBeenCalledWith("pane-local");

    onFocusPane.mockClear();
    await user.click(
      screen.getByRole("button", { name: "关闭 本地 PowerShell 分屏" }),
    );

    expect(onClosePane).toHaveBeenCalledWith("pane-local");
    expect(onFocusPane).not.toHaveBeenCalled();
  });

  it("starts pane move dragging only from the titlebar drag handle", () => {
    const onBeginPaneDrag = vi.fn();

    renderPaneCard(baseTerminalPane, { onBeginPaneDrag });

    fireEvent.pointerDown(
      screen.getByRole("button", {
        name: "拖动 本地 PowerShell 分屏调整位置",
      }),
      { clientX: 24, clientY: 18, pointerId: 1 },
    );

    expect(onBeginPaneDrag).toHaveBeenCalledWith(
      "pane-local",
      expect.any(Object),
    );
  });

  it("reports the exact runtime slot element on mount and unmount", () => {
    const onRuntimeSlotChange = vi.fn();
    const { unmount } = renderPaneCard(baseTerminalPane, {
      onRuntimeSlotChange,
      runtimeMount: "slot",
      runtimeSlotActive: true,
    });
    const slot = document.querySelector<HTMLElement>(
      '[data-terminal-pane-runtime-slot="pane-local"]',
    );

    expect(slot).toBeTruthy();
    expect(onRuntimeSlotChange).toHaveBeenLastCalledWith(
      "pane-local",
      slot,
      true,
      true,
    );

    unmount();

    expect(onRuntimeSlotChange).toHaveBeenLastCalledWith(
      "pane-local",
      slot,
      true,
      false,
    );
  });

  it("updates the runtime slot to inactive when its tab is hidden", () => {
    const onRuntimeSlotChange = vi.fn();
    const { rerender } = renderPaneCard(baseTerminalPane, {
      onRuntimeSlotChange,
      runtimeMount: "slot",
      runtimeSlotActive: true,
    });
    const slot = document.querySelector<HTMLElement>(
      '[data-terminal-pane-runtime-slot="pane-local"]',
    );

    rerender(
      <TerminalPaneCard
        focused={false}
        onClosePane={vi.fn()}
        onFocusPane={vi.fn()}
        onRuntimeSlotChange={onRuntimeSlotChange}
        pane={baseTerminalPane}
        resolvedTheme="dark"
        runtimeMount="slot"
        runtimeSlotActive={false}
        terminalAppearance={defaultAppSettings.terminal}
      />,
    );

    expect(onRuntimeSlotChange).toHaveBeenLastCalledWith(
      "pane-local",
      slot,
      false,
      true,
    );
  });
});
