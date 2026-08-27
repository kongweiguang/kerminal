// @author kongweiguang

import { useState } from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import type {
  TerminalTabGroups,
} from "../../../../../src/features/workspace/types";
import { TerminalWorkspace } from "../../../../../src/features/terminal/TerminalWorkspace";
import { terminalChromeRuntimeStore } from "../../../../../src/features/terminal/terminalChromeRuntimeStore";
import {
  batchPanes,
  batchTabs,
  groupedSshPanes,
  groupedSshTabs,
  mixedSplitPanes,
  mixedSplitTabs,
  terminalMachineGroups,
  workspaceProps,
} from "../../../support/terminal/TerminalWorkspace.testSupport.ts";
import {
  mockTabListMetrics,
} from "./setup";

export function registerGroupAndSplitTests() {
  it("shows pane attention in the all-tabs overview without online status dots", async () => {
    const user = userEvent.setup();
    const restoreTabListMetrics = mockTabListMetrics({
      clientWidth: 260,
      scrollWidth: 620,
    });

    try {
      render(
        <TerminalWorkspace
          {...workspaceProps({
            activeTabId: "tab-dev-a",
            focusedPaneId: "pane-dev-a",
            panes: groupedSshPanes,
            tabs: groupedSshTabs,
          })}
        />,
      );
      act(() => {
        terminalChromeRuntimeStore.register("pane-dev-b", { visible: false });
        terminalChromeRuntimeStore.update("pane-dev-b", { type: "output" });
      });

      await user.click(screen.getByRole("button", { name: "查看所有标签" }));
      const menu = screen.getByRole("menu", { name: "所有终端标签" });
      const unreadTab = within(menu).getByRole("menuitem", {
        name: /dev.internal #2/,
      });

      expect(within(unreadTab).getByLabelText("有未读输出")).toBeInTheDocument();
      expect(unreadTab.querySelector(".bg-emerald-400")).toBeNull();
    } finally {
      restoreTabListMetrics();
    }
  });

  it("keeps and recolors an explicit single-member group", async () => {
    const user = userEvent.setup();
    const onUpdateTerminalTabGroup = vi.fn();

    /** 用受控状态验证单成员组编辑后不会被投影层自动清理。 */
    function ControlledWorkspace() {
      const [terminalTabGroups, setTerminalTabGroups] =
        useState<TerminalTabGroups>({
          "group-local": { collapsed: false, title: "本地 PowerShell" },
        });
      const groupedTabs = workspaceProps().tabs.map((tab) => ({
        ...tab,
        tabGroupId: "group-local",
      }));

      return (
        <TerminalWorkspace
          {...workspaceProps({
            onUpdateTerminalTabGroup: (groupId, definition) => {
              onUpdateTerminalTabGroup(groupId, definition);
              setTerminalTabGroups((current) => ({
                ...current,
                [groupId]: { ...current[groupId], ...definition },
              }));
            },
            tabs: groupedTabs,
            terminalTabGroups,
          })}
        />
      );
    }

    render(<ControlledWorkspace />);

    const groupButton = screen.getByRole("button", {
      name: "折叠 本地 PowerShell 标签组",
    });
    fireEvent.contextMenu(groupButton);
    await user.click(screen.getByRole("menuitem", { name: "编辑分组" }));
    expect(
      screen.getByRole("dialog", { name: "编辑标签组" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "选择粉色分组颜色" }));
    await user.click(screen.getByRole("button", { name: "保存" }));

    expect(onUpdateTerminalTabGroup).toHaveBeenLastCalledWith("group-local", {
      color: "pink",
      title: "本地 PowerShell",
    });
    expect(
      screen
        .getByRole("button", { name: "折叠 本地 PowerShell 标签组" })
        .querySelector(".bg-pink-500"),
    ).not.toBeNull();
  });

  it("edits an explicit terminal tab group name and color", async () => {
    const user = userEvent.setup();
    const onUpdateTerminalTabGroup = vi.fn();

    /** 用受控状态同步组定义，覆盖 Dialog 保存后的真实重新渲染路径。 */
    function ControlledWorkspace() {
      const [terminalTabGroups, setTerminalTabGroups] =
        useState<TerminalTabGroups>({
          "group-dev": { collapsed: false, title: "dev.internal" },
        });

      return (
        <TerminalWorkspace
          {...workspaceProps({
            activeTabId: "tab-dev-a",
            focusedPaneId: "pane-dev-a",
            onUpdateTerminalTabGroup: (groupId, definition) => {
              onUpdateTerminalTabGroup(groupId, definition);
              setTerminalTabGroups((current) => ({
                ...current,
                [groupId]: { ...current[groupId], ...definition },
              }));
            },
            panes: groupedSshPanes,
            tabs: groupedSshTabs,
            terminalTabGroups,
          })}
        />
      );
    }

    render(<ControlledWorkspace />);

    fireEvent.contextMenu(
      screen.getByRole("button", { name: "折叠 dev.internal 标签组" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "编辑分组" }));
    await user.clear(screen.getByLabelText("分组名称"));
    await user.type(screen.getByLabelText("分组名称"), "生产组");
    await user.click(screen.getByRole("button", { name: "选择粉色分组颜色" }));
    await user.click(screen.getByRole("button", { name: "保存" }));

    expect(onUpdateTerminalTabGroup).toHaveBeenCalledWith("group-dev", {
      color: "pink",
      title: "生产组",
    });
    expect(
      screen.getByRole("button", { name: "折叠 生产组 标签组" }),
    ).toBeInTheDocument();
  });

  it("subscribes tab chrome to pane activity snapshots", async () => {
    render(<TerminalWorkspace {...workspaceProps()} />);

    expect(screen.queryByLabelText("有未读输出")).not.toBeInTheDocument();

    act(() => {
      terminalChromeRuntimeStore.register("pane-local", { visible: false });
      terminalChromeRuntimeStore.update("pane-local", { type: "output" });
    });

    expect(await screen.findByLabelText("有未读输出")).toBeInTheDocument();
  });

  it("aggregates attention on collapsed groups without duplicating it while expanded", async () => {
    const user = userEvent.setup();

    /** 以受控 store 形态回写折叠值，确保注意力聚合覆盖真实 explicit 组路径。 */
    function ControlledAttentionWorkspace() {
      const [collapsed, setCollapsed] = useState(false);
      return (
        <TerminalWorkspace
          {...workspaceProps({
            activeTabId: "tab-dev-a",
            focusedPaneId: "pane-dev-a",
            onSetTerminalTabGroupCollapsed: (_groupId, nextCollapsed) =>
              setCollapsed(nextCollapsed),
            panes: groupedSshPanes,
            tabs: groupedSshTabs,
            terminalTabGroups: {
              "group-dev": { collapsed, title: "dev.internal" },
            },
          })}
        />
      );
    }

    render(<ControlledAttentionWorkspace />);

    act(() => {
      terminalChromeRuntimeStore.register("pane-dev-a", { visible: false });
      terminalChromeRuntimeStore.register("pane-dev-b", { visible: false });
      terminalChromeRuntimeStore.update("pane-dev-a", { type: "output" });
      terminalChromeRuntimeStore.update("pane-dev-b", { type: "output" });
    });

    expect(await screen.findAllByLabelText("有未读输出")).toHaveLength(2);
    await user.click(
      screen.getByRole("button", { name: "折叠 dev.internal 标签组" }),
    );

    expect(
      screen.getByLabelText("2 个标签页：有未读输出"),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("有未读输出")).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "展开 dev.internal 标签组" }),
    );
    expect(screen.getAllByLabelText("有未读输出")).toHaveLength(2);
    expect(
      screen.queryByLabelText("2 个标签页：有未读输出"),
    ).not.toBeInTheDocument();
  });

  it("opens a right-click menu for terminal tab groups", async () => {
    const user = userEvent.setup();
    const onCloseTabs = vi.fn();

    render(
      <TerminalWorkspace
        {...workspaceProps({
          activeTabId: "tab-dev-a",
          focusedPaneId: "pane-dev-a",
          onCloseTabs,
          panes: groupedSshPanes,
          tabs: groupedSshTabs,
        })}
      />,
    );

    const groupButton = screen.getByRole("button", {
      name: "折叠 dev.internal 标签组",
    });
    fireEvent.contextMenu(groupButton);
    await user.click(screen.getByRole("menuitem", { name: "关闭组外其它标签" }));
    expect(
      screen.getByRole("dialog", { name: "确认关闭标签" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "关闭标签" }));

    expect(onCloseTabs).toHaveBeenCalledWith(["tab-lab"]);
  });

  it("submits every group member in one close batch", async () => {
    const user = userEvent.setup();
    const onCloseTabs = vi.fn();

    render(
      <TerminalWorkspace
        {...workspaceProps({
          activeTabId: "tab-dev-a",
          focusedPaneId: "pane-dev-a",
          onCloseTabs,
          panes: groupedSshPanes,
          tabs: groupedSshTabs,
        })}
      />,
    );

    fireEvent.contextMenu(
      screen.getByRole("button", { name: "折叠 dev.internal 标签组" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "关闭分组" }));
    await user.click(screen.getByRole("button", { name: "关闭标签" }));

    expect(onCloseTabs).toHaveBeenCalledTimes(1);
    expect(onCloseTabs).toHaveBeenCalledWith(["tab-dev-a", "tab-dev-b"]);
  });

  it("moves a real pointer drag over 6px into a specific group member and suppresses the trailing click", async () => {
    const onMoveTerminalTab = vi.fn();
    const onSelectTab = vi.fn();
    const rectSpy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        const tabId = this.dataset.terminalTabId;
        const groupId = this.dataset.terminalTabGroupId;
        const left =
          tabId === "tab-dev-a"
            ? 40
            : tabId === "tab-dev-b"
              ? 140
              : tabId === "tab-lab"
                ? 320
                : groupId === "group-dev"
                  ? 0
                  : 0;
        const width = groupId === "group-dev" ? 300 : tabId ? 90 : 8;
        return {
          bottom: 36,
          height: 36,
          left,
          right: left + width,
          top: 0,
          width,
          x: left,
          y: 0,
          toJSON: () => ({}),
        };
      });

    try {
      render(
        <TerminalWorkspace
          {...workspaceProps({
            activeTabId: "tab-dev-a",
            focusedPaneId: "pane-dev-a",
            onMoveTerminalTab,
            onSelectTab,
            panes: groupedSshPanes,
            tabs: groupedSshTabs,
          })}
        />,
      );

      const source = screen.getByRole("button", { name: "lab.internal" });
      fireEvent.pointerDown(source, {
        button: 0,
        buttons: 1,
        clientX: 350,
        clientY: 18,
        isPrimary: true,
        pointerId: 31,
        pointerType: "mouse",
      });
      fireEvent.pointerMove(document, {
        buttons: 1,
        clientX: 90,
        clientY: 18,
        isPrimary: true,
        pointerId: 31,
        pointerType: "mouse",
      });
      await waitFor(() => {
        expect(screen.getAllByText("lab.internal").length).toBeGreaterThan(1);
      });
      fireEvent.pointerMove(document, {
        buttons: 1,
        clientX: 91,
        clientY: 18,
        isPrimary: true,
        pointerId: 31,
        pointerType: "mouse",
      });
      await screen.findByText("移动到标签 dev.internal 前");
      fireEvent.pointerUp(document, {
        button: 0,
        clientX: 90,
        clientY: 18,
        isPrimary: true,
        pointerId: 31,
        pointerType: "mouse",
      });

      await waitFor(() =>
        expect(onMoveTerminalTab).toHaveBeenCalledWith({
          position: "before",
          tabId: "tab-lab",
          targetGroupId: "group-dev",
          targetTabId: "tab-dev-a",
        }),
      );
      const currentSource = screen.getByRole("button", { name: "lab.internal" });
      fireEvent.click(currentSource);
      expect(onSelectTab).not.toHaveBeenCalled();
      await act(
        () =>
          new Promise<void>((resolve) => {
            // dnd-kit 6.3.1 在 detach 后保留 50ms click blocker；等待其明确
            // 清理边界后验证下一次用户点击，避免依赖任意测试 sleep。
            window.setTimeout(resolve, 60);
          }),
      );
      fireEvent.click(currentSource);
      expect(onSelectTab).toHaveBeenCalledWith("tab-lab");
    } finally {
      rectSpy.mockRestore();
    }
  });

  it("requests horizontal and vertical splits", async () => {
    const user = userEvent.setup();
    const onSplitPane = vi.fn();

    render(
      <TerminalWorkspace
        {...workspaceProps({
          activeTabId: "tab-batch",
          focusedPaneId: "pane-batch-local",
          onSplitPane,
          panes: batchPanes,
          tabs: batchTabs,
        })}
      />,
    );

    const focusedPane = within(screen.getByLabelText("本地批量 终端分屏"));

    await user.click(
      focusedPane.getByRole("button", { name: "本地批量 左右分屏" }),
    );
    await user.click(
      focusedPane.getByRole("button", { name: "本地批量 上下分屏" }),
    );

    expect(onSplitPane).toHaveBeenNthCalledWith(1, "horizontal", {
      sourcePaneId: "pane-batch-local",
    });
    expect(onSplitPane).toHaveBeenNthCalledWith(2, "vertical", {
      sourcePaneId: "pane-batch-local",
    });
  });

  it("can split the active tab to a selected host from the split button menu", async () => {
    const user = userEvent.setup();
    const onSplitPane = vi.fn();

    render(
      <TerminalWorkspace
        {...workspaceProps({
          activeTabId: "tab-batch",
          focusedPaneId: "pane-batch-local",
          machineGroups: terminalMachineGroups,
          onSplitPane,
          panes: batchPanes,
          tabs: batchTabs,
        })}
      />,
    );

    fireEvent.contextMenu(
      screen.getByRole("button", { name: "本地批量 左右分屏" }),
    );
    const splitTargetMenu = screen.getByRole("menu", {
      name: "左右分屏目标选择",
    });

    expect(
      within(splitTargetMenu).getByRole("menuitem", { name: /生产 SSH/ }),
    ).toBeInTheDocument();
    expect(
      within(splitTargetMenu).queryByRole("menuitem", { name: /办公桌面/ }),
    ).not.toBeInTheDocument();

    await user.click(
      within(splitTargetMenu).getByRole("menuitem", { name: /生产 SSH/ }),
    );

    expect(onSplitPane).toHaveBeenCalledWith("horizontal", {
      sourcePaneId: "pane-batch-local",
      targetMachineId: "host-prod",
    });
    expect(
      screen.queryByRole("menu", { name: "左右分屏目标选择" }),
    ).not.toBeInTheDocument();
  });

  it("opens the split target menu on secondary-button press", () => {
    render(
      <TerminalWorkspace
        {...workspaceProps({
          activeTabId: "tab-batch",
          focusedPaneId: "pane-batch-local",
          machineGroups: terminalMachineGroups,
          panes: batchPanes,
          tabs: batchTabs,
        })}
      />,
    );

    fireEvent.mouseDown(
      screen.getByRole("button", { name: "本地批量 左右分屏" }),
      { button: 2 },
    );

    expect(
      screen.getByRole("menu", { name: "左右分屏目标选择" }),
    ).toBeInTheDocument();
  });

  it("portals the split target menu outside the pane card", () => {
    render(
      <TerminalWorkspace
        {...workspaceProps({
          activeTabId: "tab-batch",
          focusedPaneId: "pane-batch-local",
          machineGroups: terminalMachineGroups,
          panes: batchPanes,
          tabs: batchTabs,
        })}
      />,
    );

    fireEvent.contextMenu(
      screen.getByRole("button", { name: "本地批量 左右分屏" }),
    );

    const splitTargetMenu = screen.getByRole("menu", {
      name: "左右分屏目标选择",
    });
    expect(splitTargetMenu.parentElement).toBe(document.body);
    expect(
      splitTargetMenu.closest("[data-terminal-pane-card]"),
    ).not.toBeInTheDocument();
  });

  it("filters split host choices from the split target menu", async () => {
    const user = userEvent.setup();
    const onSplitPane = vi.fn();

    render(
      <TerminalWorkspace
        {...workspaceProps({
          activeTabId: "tab-batch",
          focusedPaneId: "pane-batch-local",
          machineGroups: terminalMachineGroups,
          onSplitPane,
          panes: batchPanes,
          tabs: batchTabs,
        })}
      />,
    );

    fireEvent.contextMenu(
      screen.getByRole("button", { name: "本地批量 上下分屏" }),
    );
    const splitTargetMenu = screen.getByRole("menu", {
      name: "上下分屏目标选择",
    });
    await user.type(
      within(splitTargetMenu).getByLabelText("搜索分屏主机"),
      "serial",
    );

    await user.click(
      within(splitTargetMenu).getByRole("menuitem", { name: /串口控制台/ }),
    );

    expect(onSplitPane).toHaveBeenCalledWith("vertical", {
      sourcePaneId: "pane-batch-local",
      targetMachineId: "serial-console",
    });
  });

  it("passes context menu workspace actions to terminal panes", async () => {
    const user = userEvent.setup();
    const onOpenLogs = vi.fn();
    const onSplitPane = vi.fn();

    render(
      <TerminalWorkspace
        {...workspaceProps({
          onOpenLogs,
          onSplitPane,
        })}
      />,
    );

    await user.click(screen.getByRole("button", { name: "测试打开日志" }));
    await user.click(screen.getByRole("button", { name: "测试左右分屏" }));

    expect(onOpenLogs).toHaveBeenCalled();
    expect(onSplitPane).toHaveBeenCalledWith("horizontal", {
      sourcePaneId: "pane-local",
    });
  });

  it("requests closing the focused pane", async () => {
    const user = userEvent.setup();
    const onClosePane = vi.fn();

    render(
      <TerminalWorkspace
        {...workspaceProps({
          activeTabId: "tab-batch",
          focusedPaneId: "pane-batch-local",
          onClosePane,
          panes: batchPanes,
          tabs: batchTabs,
        })}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "关闭 本地批量 分屏" }),
    );

    expect(onClosePane).toHaveBeenCalledWith("pane-batch-local");
  });

  it("renders split panes and focuses a pane when the user selects it", async () => {
    const user = userEvent.setup();
    const onFocusPane = vi.fn();

    render(
      <TerminalWorkspace
        {...workspaceProps({
          activeTabId: "tab-mixed-split",
          focusedPaneId: "pane-split-local",
          onFocusPane,
          panes: mixedSplitPanes,
          tabs: mixedSplitTabs,
        })}
      />,
    );

    expect(screen.getByLabelText(/辅助分屏 终端分屏/i)).toBeInTheDocument();
    await user.click(screen.getByLabelText(/辅助分屏 终端分屏/i));

    expect(onFocusPane).toHaveBeenCalledWith("pane-split-preview");
  });
}
