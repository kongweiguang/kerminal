// @author kongweiguang

import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { defaultAppSettings } from "../../../../../src/features/settings/settingsModel";
import type {
  TerminalPane,
  TerminalTab,
} from "../../../../../src/features/workspace/types";
import { TerminalWorkspace } from "../../../../../src/features/terminal/TerminalWorkspace";
import {
  alternateLocalTabs,
  baseTerminalPane,
  baseTerminalTab,
  crashingPane,
  crashingTabs,
  manyTerminalTabs,
  sftpTransferTab,
  workspaceProps,
} from "../../../support/terminal/TerminalWorkspace.testSupport.ts";
import {
  mockTabListMetrics,
  resizableMockState,
  xtermPaneMockState,
} from "./setup";

export function registerPaneAndContentTests() {
  it("renders the active local tab and terminal pane", () => {
    render(<TerminalWorkspace {...workspaceProps()} />);

    expect(
      screen.getByRole("main", { name: "终端工作区" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "本地 PowerShell" }),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("本地 PowerShell xterm 终端"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "新建终端 tab" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText("终端配置")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "本地 PowerShell 左右分屏" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "本地 PowerShell 上下分屏" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "关闭当前分屏" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText("批量命令")).not.toBeInTheDocument();
  });

  it("derives terminal tab status from its pane status", () => {
    const offlinePane: TerminalPane = {
      ...baseTerminalPane,
      status: "offline",
    };

    render(<TerminalWorkspace {...workspaceProps({ panes: [offlinePane] })} />);

    const tabButton = screen.getByRole("button", { name: "本地 PowerShell" });
    expect(
      tabButton.parentElement?.querySelector("span[aria-hidden='true']"),
    ).toHaveClass("bg-zinc-400");
  });

  it("forwards pane connection state changes from xterm panes", () => {
    const onPaneConnectionStateChange = vi.fn();

    render(
      <TerminalWorkspace
        {...workspaceProps({ onPaneConnectionStateChange })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "测试关闭状态" }));

    expect(onPaneConnectionStateChange).toHaveBeenCalledWith(
      baseTerminalPane.id,
      "closed",
    );
  });

  it("keeps the existing terminal pane mounted when a split is added", () => {
    const nextPane: TerminalPane = {
      ...baseTerminalPane,
      id: "pane-local-2",
      title: "右侧分屏",
    };
    const splitTab: TerminalTab = {
      id: baseTerminalTab.id,
      layout: {
        children: [
          { paneId: baseTerminalPane.id, type: "pane" },
          { paneId: nextPane.id, type: "pane" },
        ],
        direction: "horizontal",
        id: "split-local-1",
        type: "split",
      },
      machineId: baseTerminalTab.machineId,
      title: baseTerminalTab.title,
    };
    const { container, rerender } = render(
      <TerminalWorkspace {...workspaceProps()} />,
    );

    expect(xtermPaneMockState.mountedPaneIds).toEqual([baseTerminalPane.id]);
    expect(
      container.querySelector('[data-panel-group-id="tab-local"]'),
    ).toBeInTheDocument();

    rerender(
      <TerminalWorkspace
        {...workspaceProps({
          focusedPaneId: nextPane.id,
          panes: [baseTerminalPane, nextPane],
          tabs: [splitTab],
        })}
      />,
    );

    expect(xtermPaneMockState.unmountedPaneIds).not.toContain(
      baseTerminalPane.id,
    );
    expect(
      container.querySelector('[data-panel-group-id="tab-local"]'),
    ).toBeInTheDocument();
    expect(
      container.querySelector('[data-panel-group-id="split-local-1"]'),
    ).not.toBeInTheDocument();
    expect(xtermPaneMockState.mountedPaneIds).toEqual([
      baseTerminalPane.id,
      nextPane.id,
    ]);
  });

  it("hides an active pane during its retirement frame before the runtime unmounts", async () => {
    const { rerender, unmount } = render(
      <TerminalWorkspace {...workspaceProps()} />,
    );

    expect(xtermPaneMockState.visibleByPaneId.get(baseTerminalPane.id)).toBe(
      true,
    );

    rerender(
      <TerminalWorkspace
        {...workspaceProps({
          activeTabId: "",
          focusedPaneId: "",
          panes: [],
          tabs: [],
        })}
      />,
    );

    await waitFor(() => {
      expect(
        xtermPaneMockState.visibleByPaneId.get(baseTerminalPane.id),
      ).toBe(false);
    });

    unmount();
    expect(xtermPaneMockState.unmountedPaneIds).toContain(baseTerminalPane.id);
  });

  it("restores persisted split sizes and reports resize changes", () => {
    const onSplitLayoutSizesChange = vi.fn();
    const rightPane: TerminalPane = {
      ...baseTerminalPane,
      id: "pane-local-2",
      title: "右侧分屏",
    };
    const splitTab: TerminalTab = {
      id: baseTerminalTab.id,
      layout: {
        children: [
          { paneId: baseTerminalPane.id, type: "pane" },
          { paneId: rightPane.id, type: "pane" },
        ],
        direction: "horizontal",
        id: "split-local-1",
        sizes: {
          [baseTerminalPane.id]: 31.25,
          [rightPane.id]: 68.75,
        },
        type: "split",
      },
      machineId: baseTerminalTab.machineId,
      title: baseTerminalTab.title,
    };

    render(
      <TerminalWorkspace
        {...workspaceProps({
          focusedPaneId: rightPane.id,
          onSplitLayoutSizesChange,
          panes: [baseTerminalPane, rightPane],
          tabs: [splitTab],
        })}
      />,
    );

    const rootGroup = resizableMockState.groups.find(
      (group) => group.id === "tab-local",
    );
    expect(rootGroup?.defaultLayout).toEqual({
      [baseTerminalPane.id]: 31.25,
      [rightPane.id]: 68.75,
    });

    rootGroup?.onLayoutChanged?.({
      [baseTerminalPane.id]: 42,
      [rightPane.id]: 58,
    });

    expect(onSplitLayoutSizesChange).toHaveBeenCalledWith("split-local-1", {
      [baseTerminalPane.id]: 42,
      [rightPane.id]: 58,
    });
  });

  it("renders existing and new terminal panes when a nested split is added", () => {
    const rightPane: TerminalPane = {
      ...baseTerminalPane,
      id: "pane-local-2",
      title: "右侧分屏",
    };
    const bottomPane: TerminalPane = {
      ...baseTerminalPane,
      id: "pane-local-3",
      title: "下方分屏",
    };
    const splitTab: TerminalTab = {
      id: baseTerminalTab.id,
      layout: {
        children: [
          { paneId: baseTerminalPane.id, type: "pane" },
          { paneId: rightPane.id, type: "pane" },
        ],
        direction: "horizontal",
        id: "split-local-1",
        type: "split",
      },
      machineId: baseTerminalTab.machineId,
      title: baseTerminalTab.title,
    };
    const nestedSplitTab: TerminalTab = {
      ...splitTab,
      layout: {
        children: [
          { paneId: baseTerminalPane.id, type: "pane" },
          {
            children: [
              { paneId: rightPane.id, type: "pane" },
              { paneId: bottomPane.id, type: "pane" },
            ],
            direction: "vertical",
            id: "split-local-2",
            type: "split",
          },
        ],
        direction: "horizontal",
        id: "split-local-1",
        type: "split",
      },
    };
    const { rerender } = render(
      <TerminalWorkspace
        {...workspaceProps({
          focusedPaneId: rightPane.id,
          panes: [baseTerminalPane, rightPane],
          tabs: [splitTab],
        })}
      />,
    );

    expect(xtermPaneMockState.mountedPaneIds).toEqual([
      baseTerminalPane.id,
      rightPane.id,
    ]);

    rerender(
      <TerminalWorkspace
        {...workspaceProps({
          focusedPaneId: bottomPane.id,
          panes: [baseTerminalPane, rightPane, bottomPane],
          tabs: [nestedSplitTab],
        })}
      />,
    );

    expect(
      screen.getByLabelText("本地 PowerShell xterm 终端"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("右侧分屏 xterm 终端")).toBeInTheDocument();
    expect(screen.getByLabelText("下方分屏 xterm 终端")).toBeInTheDocument();
  });

  it("keeps the no-tab empty state as a quiet brand placeholder", () => {
    render(
      <TerminalWorkspace
        {...workspaceProps({
          activeTabId: "",
          focusedPaneId: "",
          panes: [],
          tabs: [],
        })}
      />,
    );

    expect(screen.getByRole("img", { name: "Kerminal" })).toBeInTheDocument();
    expect(
      screen.getByText("光标还没闪，AI 已经开始脑补命令了。"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "添加连接" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "本地终端" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "打开 Agent 面板" }),
    ).not.toBeInTheDocument();
  });

  it("renders custom SFTP transfer tab content without terminal split controls", () => {
    const renderCustomTab = vi.fn((tab: TerminalTab, active: boolean) =>
      tab.kind === "sftpTransfer" ? (
        <div data-active={String(active)}>传输工作台替身</div>
      ) : null,
    );

    render(
      <TerminalWorkspace
        {...workspaceProps({
          activeTabId: "tab-sftp-transfer-1",
          focusedPaneId: "",
          panes: [baseTerminalPane],
          renderCustomTab,
          tabs: [baseTerminalTab, sftpTransferTab],
        })}
      />,
    );

    expect(screen.getByText("传输工作台替身")).toHaveAttribute(
      "data-active",
      "true",
    );
    expect(renderCustomTab).toHaveBeenCalledWith(sftpTransferTab, true);
    expect(
      screen.queryByRole("button", { name: "左右分屏" }),
    ).not.toBeInTheDocument();
  });

  it("applies compact workspace density to terminal chrome", () => {
    render(
      <TerminalWorkspace
        {...workspaceProps({ interfaceDensity: "compact" })}
      />,
    );

    const workspace = screen.getByRole("main", { name: "终端工作区" });
    expect(workspace).toHaveAttribute("data-density", "compact");
    expect(workspace.firstElementChild).toHaveClass("h-9");
  });

  it("reserves only the right tool rail when window controls are on macOS left", () => {
    const restoreTabListMetrics = mockTabListMetrics({
      clientWidth: 320,
      scrollWidth: 960,
    });

    try {
      render(
        <TerminalWorkspace
          {...workspaceProps({
            activeTabId: "tab-many-1",
            rightTitleBarInset: 64,
            tabs: manyTerminalTabs,
          })}
        />,
      );

      const tabBar = screen
        .getByLabelText("终端标签栏")
        .closest(".kerminal-material-nav");
      const overviewButton = screen.getByRole("button", {
        name: "查看所有标签",
      });

      expect(tabBar).toHaveStyle({ paddingRight: "64px" });
      expect(overviewButton.parentElement).toHaveAttribute(
        "data-terminal-tab-actions",
      );
      expect(overviewButton.className).not.toContain("right-");
    } finally {
      restoreTabListMetrics();
    }
  });

  it("reserves left titlebar control space when window chrome overlaps the tab bar", () => {
    render(
      <TerminalWorkspace {...workspaceProps({ leftTitleBarInset: 112 })} />,
    );

    const tabBar = screen
      .getByLabelText("终端标签栏")
      .closest(".kerminal-material-nav");

    expect(tabBar).toHaveStyle({ paddingLeft: "112px" });
  });

  it("isolates terminal pane render errors and opens logs from the fallback", async () => {
    const user = userEvent.setup();
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const onOpenLogs = vi.fn();
    xtermPaneMockState.shouldThrow = true;

    try {
      render(
        <TerminalWorkspace
          {...workspaceProps({
            activeTabId: "tab-crash",
            focusedPaneId: "pane-crash",
            onOpenLogs,
            panes: [crashingPane],
            tabs: crashingTabs,
          })}
        />,
      );

      expect(screen.getByLabelText("崩溃终端 终端分屏异常")).toHaveClass(
        "min-h-0",
      );
      expect(screen.getByText("终端分屏渲染异常")).toBeInTheDocument();
      expect(screen.getByText("xterm render exploded")).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "打开日志" }));

      expect(onOpenLogs).toHaveBeenCalled();
      expect(
        screen.queryByRole("button", { name: "新建终端 tab" }),
      ).not.toBeInTheDocument();
    } finally {
      consoleError.mockRestore();
    }
  });

  it("remounts a failed terminal pane after the render problem is cleared", async () => {
    const user = userEvent.setup();
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    xtermPaneMockState.shouldThrow = true;

    try {
      render(
        <TerminalWorkspace
          {...workspaceProps({
            activeTabId: "tab-crash",
            focusedPaneId: "pane-crash",
            panes: [crashingPane],
            tabs: crashingTabs,
          })}
        />,
      );

      expect(screen.getByText("终端分屏渲染异常")).toBeInTheDocument();
      xtermPaneMockState.shouldThrow = false;
      await user.click(screen.getByRole("button", { name: "重新挂载" }));

      expect(screen.getByLabelText("崩溃终端 xterm 终端")).toBeInTheDocument();
      expect(screen.queryByText("终端分屏渲染异常")).not.toBeInTheDocument();
      expect(xtermPaneMockState.renderCount).toBeGreaterThan(1);
    } finally {
      consoleError.mockRestore();
    }
  });

  it("requests tab selection when the user switches tabs", async () => {
    const user = userEvent.setup();
    const onSelectTab = vi.fn();

    render(
      <TerminalWorkspace
        {...workspaceProps({ onSelectTab, tabs: alternateLocalTabs })}
      />,
    );

    await user.click(screen.getByRole("button", { name: "备用本地终端" }));

    expect(onSelectTab).toHaveBeenCalledWith("tab-alt-local");
  });

  it("allows closing the only tab from the tab close button", async () => {
    const user = userEvent.setup();
    const onCloseTabs = vi.fn();

    render(<TerminalWorkspace {...workspaceProps({ onCloseTabs })} />);

    await user.click(
      screen.getByRole("button", { name: "关闭 本地 PowerShell tab" }),
    );
    await user.click(screen.getByRole("button", { name: "关闭标签" }));

    expect(onCloseTabs).toHaveBeenCalledWith(["tab-local"]);
  });

  it("allows closing the only tab from the right-click menu", async () => {
    const user = userEvent.setup();
    const onCloseTabs = vi.fn();

    render(<TerminalWorkspace {...workspaceProps({ onCloseTabs })} />);

    fireEvent.contextMenu(
      screen.getByRole("button", { name: "本地 PowerShell" }),
    );
    const closeMenuItem = screen.getByRole("menuitem", { name: "关闭标签" });

    expect(closeMenuItem).toBeEnabled();
    await user.click(closeMenuItem);
    await user.click(screen.getByRole("button", { name: "关闭标签" }));

    expect(onCloseTabs).toHaveBeenCalledWith(["tab-local"]);
  });

  it("confirms before closing a dirty workspace file tab", async () => {
    const user = userEvent.setup();
    const onCloseTabs = vi.fn();
    const fileTab: TerminalTab = {
      access: "editable",
      id: "tab-file-dirty",
      kind: "workspaceFile",
      machineId: "host-prod",
      path: "/etc/app.conf",
      source: "sftp",
      target: { hostId: "host-prod", kind: "ssh" },
      title: "app.conf",
    };

    render(
      <TerminalWorkspace
        {...workspaceProps({
          activeTabId: fileTab.id,
          focusedPaneId: "",
          onCloseTabs,
          panes: [],
          renderCustomTab: () => <div>file surface</div>,
          tabs: [fileTab],
          workspaceFileDirtyState: { [fileTab.id]: true },
        })}
      />,
    );

    await user.click(screen.getByRole("button", { name: "关闭 app.conf tab" }));

    expect(
      screen.getByRole("dialog", { name: "关闭未保存文件" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(onCloseTabs).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "关闭 app.conf tab" }));
    await user.click(screen.getByRole("button", { name: "放弃修改并关闭" }));

    expect(onCloseTabs).toHaveBeenCalledWith([fileTab.id]);
  });

  it("shows tab numbers when enabled in terminal appearance", () => {
    render(
      <TerminalWorkspace
        {...workspaceProps({
          tabs: alternateLocalTabs,
          terminalAppearance: {
            ...defaultAppSettings.terminal,
            showTabNumbers: true,
          },
        })}
      />,
    );

    expect(
      screen.getByRole("button", { name: "1 · 本地 PowerShell" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "2 · 备用本地终端" }),
    ).toBeInTheDocument();
  });

}
