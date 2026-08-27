// @author kongweiguang

import { useState } from "react";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { defaultAppSettings } from "../../../../../src/features/settings/settingsModel";
import type {
  TerminalTab,
} from "../../../../../src/features/workspace/types";
import { TerminalWorkspace } from "../../../../../src/features/terminal/TerminalWorkspace";
import {
  WORKSPACE_FILE_TAB_COMMAND_EVENT,
  type WorkspaceFileTabCommandEventDetail,
} from "../../../../../src/features/workspace/workspaceFileTabActions";
import {
  alternateLocalTabs,
  batchPanes,
  batchTabs,
  groupedSshPanes,
  groupedSshTabs,
  manyTerminalTabs,
  workspaceProps,
} from "../../../support/terminal/TerminalWorkspace.testSupport.ts";
import {
  desktopClipboardMocks,
  mockTabListMetrics,
  xtermPaneMockState,
} from "./setup";

/**
 * 汇总标签栏与菜单的交互契约；这里使用真实按钮键盘语义，避免把可访问性
 * 仅验证成 class 或 DOM 结构而遗漏浏览器原生 Enter/Space 激活路径。
 */
export function registerTabAndMenuTests() {
  it("places the transparent temporary-terminal action at the end of a fitting tab strip", async () => {
    const user = userEvent.setup();
    const onCreateTerminal = vi.fn();
    render(
      <TerminalWorkspace
        {...workspaceProps({
          activeTabId: "",
          focusedPaneId: "",
          onCreateTerminal,
          panes: [],
          tabs: [],
        })}
      />,
    );

    const tabList = screen.getByLabelText("终端标签栏");
    const createButton = screen.getByRole("button", {
      name: "新建临时终端",
    });
    expect(tabList.closest(".kerminal-material-nav")).toHaveStyle({
      paddingRight: "112px",
    });
    expect(tabList).toContainElement(createButton);
    expect(createButton).toHaveAttribute(
      "data-terminal-create-placement",
      "inline",
    );
    expect(createButton).toHaveClass(
      "bg-transparent",
      "border-0",
      "shadow-none",
    );
    expect(createButton).not.toHaveClass("kerminal-muted-surface");
    expect(
      tabList.parentElement?.querySelector("[data-terminal-tab-actions]"),
    ).toBeNull();

    await user.click(createButton);
    expect(onCreateTerminal).toHaveBeenCalledTimes(1);
  });

  it("opens Profiles and terminal-capable saved hosts from the create-button context menu", async () => {
    const user = userEvent.setup();
    const onCreateTerminal = vi.fn();
    const onOpenConnection = vi.fn();
    const onOpenSavedTerminal = vi.fn();
    render(
      <TerminalWorkspace
        {...workspaceProps({
          machineGroups: [
            {
              id: "group-remote",
              machines: [
                {
                  authType: "agent",
                  description: "dev host",
                  host: "10.0.0.8",
                  id: "host-ssh",
                  kind: "ssh",
                  name: "dev-server",
                  port: 22,
                  status: "online",
                  tags: [],
                  username: "ubuntu",
                },
                {
                  description: "desktop",
                  host: "10.0.0.9",
                  id: "host-rdp",
                  kind: "rdp",
                  name: "office-rdp",
                  port: 3389,
                  status: "online",
                  tags: [],
                },
              ],
              title: "开发环境",
            },
          ],
          onCreateTerminal,
          onOpenConnection,
          onOpenSavedTerminal,
          profiles: [
            {
              args: ["-NoLogo"],
              createdAt: "test",
              env: {},
              id: "profile-pwsh",
              isDefault: true,
              name: "PowerShell 7",
              shell: "pwsh.exe",
              sortOrder: 20,
              updatedAt: "test",
            },
            {
              args: [],
              createdAt: "test",
              env: {},
              id: "profile-cmd",
              isDefault: false,
              name: "命令提示符",
              shell: "cmd.exe",
              sortOrder: 10,
              updatedAt: "test",
            },
          ],
        })}
      />,
    );

    const createButton = screen.getByRole("button", {
      name: "新建临时终端",
    });
    fireEvent.contextMenu(createButton, { clientX: 120, clientY: 36 });

    let panel = screen.getByRole("dialog", { name: "新建终端" });
    let menu = within(panel).getByRole("menu", { name: "终端目标" });
    const searchInput = within(panel).getByRole("textbox", {
      name: "搜索终端或主机",
    });
    const profileGroup = within(menu).getByRole("group", {
      name: "本地 Profile",
    });
    const hostGroup = within(menu).getByRole("group", {
      name: "已保存主机",
    });
    expect(within(profileGroup).getByText("默认")).toBeInTheDocument();
    expect(
      within(hostGroup).getByRole("menuitem", {
        name: /dev-server.*ubuntu@10\.0\.0\.8:22/,
      }),
    ).toBeInTheDocument();
    expect(within(menu).queryByText("office-rdp")).not.toBeInTheDocument();
    await user.type(searchInput, "开发 dev");
    expect(within(menu).queryByText("PowerShell 7")).not.toBeInTheDocument();
    expect(within(menu).getByText("dev-server")).toBeInTheDocument();
    await user.click(
      within(panel).getByRole("button", { name: "清除终端搜索" }),
    );

    await user.click(
      within(profileGroup).getByRole("menuitem", { name: /PowerShell 7/ }),
    );
    expect(onCreateTerminal).toHaveBeenCalledWith("profile-pwsh");

    fireEvent.contextMenu(createButton, { clientX: 120, clientY: 36 });
    panel = screen.getByRole("dialog", { name: "新建终端" });
    menu = within(panel).getByRole("menu", { name: "终端目标" });
    await user.click(
      within(menu).getByRole("menuitem", { name: /dev-server/ }),
    );
    expect(onOpenSavedTerminal).toHaveBeenCalledWith("host-ssh");

    fireEvent.contextMenu(createButton, { clientX: 120, clientY: 36 });
    panel = screen.getByRole("dialog", { name: "新建终端" });
    menu = within(panel).getByRole("menu", { name: "终端目标" });
    await user.click(
      within(menu).getByRole("menuitem", { name: "添加连接..." }),
    );
    expect(onOpenConnection).toHaveBeenCalledTimes(1);
  });

  it("activates the temporary-terminal action with Enter and Space", async () => {
    const user = userEvent.setup();
    const onCreateTerminal = vi.fn();
    render(
      <TerminalWorkspace
        {...workspaceProps({
          activeTabId: "",
          focusedPaneId: "",
          onCreateTerminal,
          panes: [],
          tabs: [],
        })}
      />,
    );

    const createButton = screen.getByRole("button", {
      name: "新建临时终端",
    });
    expect(createButton).toHaveClass("h-8", "w-8", "kerminal-focus-ring");

    createButton.focus();
    await user.keyboard("{Enter}");
    createButton.focus();
    await user.keyboard(" ");

    expect(onCreateTerminal).toHaveBeenCalledTimes(2);
  });

  it("keeps the tab strip horizontal and maps wheel movement sideways when tabs overflow", () => {
    render(
      <TerminalWorkspace
        {...workspaceProps({
          activeTabId: "tab-many-1",
          tabs: manyTerminalTabs,
        })}
      />,
    );

    const tabList = screen.getByLabelText("终端标签栏");
    Object.defineProperty(tabList, "clientWidth", {
      configurable: true,
      value: 320,
    });
    Object.defineProperty(tabList, "scrollWidth", {
      configurable: true,
      value: 960,
    });
    tabList.scrollLeft = 0;
    tabList.scrollTop = 6;

    fireEvent.wheel(tabList, { deltaY: 96 });

    expect(tabList).toHaveClass("overflow-y-hidden");
    expect(tabList.scrollTop).toBe(0);
    expect(tabList.scrollLeft).toBe(96);
  });

  it("keeps wheel movement still when the tab strip has no horizontal overflow", () => {
    render(
      <TerminalWorkspace {...workspaceProps({ tabs: alternateLocalTabs })} />,
    );

    const tabList = screen.getByLabelText("终端标签栏");
    Object.defineProperty(tabList, "clientWidth", {
      configurable: true,
      value: 960,
    });
    Object.defineProperty(tabList, "scrollWidth", {
      configurable: true,
      value: 960,
    });
    tabList.scrollLeft = 0;
    tabList.scrollTop = 6;

    fireEvent.wheel(tabList, { deltaY: 96 });

    expect(tabList.scrollTop).toBe(0);
    expect(tabList.scrollLeft).toBe(0);
  });

  it("hides the all-tabs menu trigger when a short tab strip fits", () => {
    render(
      <TerminalWorkspace {...workspaceProps({ tabs: alternateLocalTabs })} />,
    );

    expect(
      screen.queryByRole("button", { name: "查看所有标签" }),
    ).not.toBeInTheDocument();
  });

  it("hides the all-tabs menu trigger when many tabs still fit", () => {
    const restoreTabListMetrics = mockTabListMetrics({
      clientWidth: 1280,
      scrollWidth: 960,
    });

    try {
      render(
        <TerminalWorkspace
          {...workspaceProps({
            activeTabId: "tab-many-1",
            tabs: manyTerminalTabs,
          })}
        />,
      );

      expect(
        screen.queryByRole("button", { name: "查看所有标签" }),
      ).not.toBeInTheDocument();
    } finally {
      restoreTabListMetrics();
    }
  });

  it("opens an all-tabs menu from the right side of the tab bar", async () => {
    const user = userEvent.setup();
    const onSelectTab = vi.fn();
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
            onSelectTab,
            panes: groupedSshPanes,
            tabs: groupedSshTabs,
          })}
        />,
      );

      await user.click(screen.getByRole("button", { name: "查看所有标签" }));

      expect(
        screen.getByRole("button", { name: "查看所有标签" }).parentElement,
      ).toBe(
        screen.getByRole("button", { name: "新建临时终端" }).parentElement,
      );
      const overflowCreateButton = screen.getByRole("button", {
        name: "新建临时终端",
      });
      expect(overflowCreateButton).toHaveAttribute(
        "data-terminal-create-placement",
        "fixed",
      );
      expect(
        screen.getByRole("button", { name: "查看所有标签" })
          .nextElementSibling,
      ).toBe(overflowCreateButton);

      const menu = screen.getByRole("menu", { name: "所有终端标签" });
      expect(within(menu).getByText("1 组 / 3 个")).toBeInTheDocument();
      const devGroup = within(menu).getByRole("group", {
        name: "dev.internal 标签组",
      });
      expect(within(devGroup).getByText("2 个")).toBeInTheDocument();
      expect(
        devGroup.querySelector(
          '[data-terminal-identity-source="automatic"][data-terminal-identity-accent]',
        ),
      ).not.toBeNull();
      expect(
        within(menu).getByRole("menuitem", { name: "lab.internal" }),
      ).toBeInTheDocument();

      await user.click(
        within(devGroup).getByRole("menuitem", { name: /dev.internal #2/ }),
      );

      expect(onSelectTab).toHaveBeenCalledWith("tab-dev-b");
      expect(
        screen.queryByRole("menu", { name: "所有终端标签" }),
      ).not.toBeInTheDocument();
    } finally {
      restoreTabListMetrics();
    }
  });

  it("mounts runtime panes for repeated host tabs so each SSH tab auto-connects", () => {
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

    expect(xtermPaneMockState.mountedPaneIds).toEqual([
      "pane-dev-a",
      "pane-dev-b",
      "pane-lab",
    ]);
  });

  it("mounts split runtime panes inside their own slots", async () => {
    render(
      <TerminalWorkspace
        {...workspaceProps({
          activeTabId: "tab-batch",
          focusedPaneId: "pane-batch-local",
          panes: batchPanes,
          tabs: batchTabs,
        })}
      />,
    );

    const slots = Array.from(
      document.querySelectorAll<HTMLElement>(
        "[data-terminal-pane-runtime-slot]",
      ),
    );

    expect(slots.map((slot) => slot.dataset.terminalPaneRuntimeSlot)).toEqual([
      "pane-batch-local",
      "pane-batch-ssh",
    ]);
    await waitFor(() => {
      expect(
        within(slots[0]).getByLabelText("本地批量 xterm 终端"),
      ).toBeInTheDocument();
      expect(
        within(slots[1]).getByLabelText("SSH 批量 xterm 终端"),
      ).toBeInTheDocument();
    });
  });

  it("lets the all-tabs menu follow the document theme", async () => {
    const user = userEvent.setup();
    const restoreTabListMetrics = mockTabListMetrics({
      clientWidth: 260,
      scrollWidth: 620,
    });
    document.documentElement.classList.add("dark");

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

      await user.click(screen.getByRole("button", { name: "查看所有标签" }));

      const menu = screen.getByRole("menu", { name: "所有终端标签" });
      expect(document.documentElement).toHaveClass("dark");
      expect(menu).not.toHaveClass("dark");
      document.documentElement.classList.remove("dark");
      expect(menu).not.toHaveClass("dark");
    } finally {
      restoreTabListMetrics();
    }
  });

  it("groups repeated host tabs and lets the group collapse", async () => {
    const user = userEvent.setup();

    /** 模拟生产 store 同步回写折叠定义，显式组不依赖 legacy 本地伪状态。 */
    function ControlledGroupedWorkspace() {
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

    render(<ControlledGroupedWorkspace />);

    expect(
      screen.getByRole("button", { name: "折叠 dev.internal 标签组" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "dev.internal #2" }),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "折叠 dev.internal 标签组" }),
    );

    expect(
      screen.getByRole("button", { name: "展开 dev.internal 标签组" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "dev.internal #2" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "lab.internal" }),
    ).toBeInTheDocument();
  });

  it("opens a right-click menu for terminal tabs", async () => {
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

    const tabButton = screen.getByRole("button", { name: "dev.internal #2" });
    fireEvent.contextMenu(tabButton);
    await user.click(screen.getByRole("menuitem", { name: "关闭右侧标签" }));
    expect(
      screen.getByRole("dialog", { name: "确认关闭标签" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "关闭标签" }));

    expect(onCloseTabs).toHaveBeenCalledWith(["tab-lab"]);
  });

  it("adds workspace file actions to the tab right-click menu", async () => {
    const user = userEvent.setup();
    const onRevealWorkspaceFileInSftp = vi.fn();
    const fileTab: TerminalTab = {
      access: "editable",
      id: "tab-file-actions",
      kind: "workspaceFile",
      machineId: "host-prod",
      path: "/etc/app.conf",
      source: "sftp",
      target: { hostId: "host-prod", kind: "ssh" },
      title: "app.conf",
    };
    const commandEvents: WorkspaceFileTabCommandEventDetail[] = [];
    const handleCommand = (event: Event) => {
      commandEvents.push(
        (event as CustomEvent<WorkspaceFileTabCommandEventDetail>).detail,
      );
    };
    window.addEventListener(WORKSPACE_FILE_TAB_COMMAND_EVENT, handleCommand);

    try {
      render(
        <TerminalWorkspace
          {...workspaceProps({
            activeTabId: fileTab.id,
            focusedPaneId: "",
            onRevealWorkspaceFileInSftp,
            panes: [],
            renderCustomTab: () => <div>file surface</div>,
            tabs: [fileTab],
          })}
        />,
      );

      fireEvent.contextMenu(screen.getByRole("button", { name: "app.conf" }));
      await user.click(screen.getByRole("menuitem", { name: "复制完整路径" }));
      expect(
        desktopClipboardMocks.writeDesktopClipboardText,
      ).toHaveBeenCalledWith("/etc/app.conf");

      fireEvent.contextMenu(screen.getByRole("button", { name: "app.conf" }));
      await user.click(
        screen.getByRole("menuitem", { name: "在 SFTP 中显示" }),
      );
      expect(onRevealWorkspaceFileInSftp).toHaveBeenCalledWith(fileTab.id);

      fireEvent.contextMenu(screen.getByRole("button", { name: "app.conf" }));
      await user.click(screen.getByRole("menuitem", { name: "重新加载" }));
      expect(commandEvents).toContainEqual({
        command: "reload",
        tabId: fileTab.id,
      });
    } finally {
      window.removeEventListener(
        WORKSPACE_FILE_TAB_COMMAND_EVENT,
        handleCommand,
      );
    }
  });

  it("closes tabs immediately when close confirmation is disabled", async () => {
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
          terminalAppearance: {
            ...defaultAppSettings.terminal,
            confirmCloseTab: false,
          },
        })}
      />,
    );

    fireEvent.contextMenu(
      screen.getByRole("button", { name: "dev.internal #2" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "关闭右侧标签" }));

    expect(
      screen.queryByRole("dialog", { name: "确认关闭标签" }),
    ).not.toBeInTheDocument();
    expect(onCloseTabs).toHaveBeenCalledWith(["tab-lab"]);
  });

  it("lets the tab right-click menu follow the document theme", () => {
    document.documentElement.classList.add("dark");
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

    fireEvent.contextMenu(
      screen.getByRole("button", { name: "dev.internal #2" }),
    );

    const menu = screen.getByRole("menu", { name: "终端标签操作菜单" });
    expect(document.documentElement).toHaveClass("dark");
    expect(menu).not.toHaveClass("dark");
    document.documentElement.classList.remove("dark");
    expect(menu).not.toHaveClass("dark");
  });

  it("navigates the tab menu by keyboard and restores focus on Escape", async () => {
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
    const trigger = screen.getByRole("button", { name: "dev.internal #2" });

    fireEvent.contextMenu(trigger);
    const firstItem = screen.getByRole("menuitem", { name: "切换到此标签" });
    await waitFor(() => expect(firstItem).toHaveFocus());
    fireEvent.keyDown(firstItem, { key: "End" });
    expect(screen.getByRole("menuitem", { name: "关闭其他标签" })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: "Home" });
    expect(firstItem).toHaveFocus();
    fireEvent.keyDown(firstItem, { key: "Escape" });

    expect(
      screen.queryByRole("menu", { name: "终端标签操作菜单" }),
    ).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("opens the move-to-group submenu and returns focus across keyboard layers", async () => {
    const user = userEvent.setup();
    const onMoveTerminalTab = vi.fn();
    const tabs = groupedSshTabs.map((tab) =>
      tab.id === "tab-lab" ? { ...tab, tabGroupId: "group-lab" } : tab,
    );
    render(
      <TerminalWorkspace
        {...workspaceProps({
          activeTabId: "tab-dev-a",
          focusedPaneId: "pane-dev-a",
          onMoveTerminalTab,
          panes: groupedSshPanes,
          tabs,
          terminalTabGroups: {
            "group-dev": { collapsed: false, title: "开发" },
            "group-lab": { collapsed: false, title: "实验室" },
          },
        })}
      />,
    );
    const trigger = screen.getByRole("button", { name: "dev.internal #2" });
    fireEvent.contextMenu(trigger);
    const moveItem = screen.getByRole("menuitem", { name: /移动到标签组/ });
    moveItem.focus();
    await user.keyboard("{ArrowRight}");

    const submenu = await screen.findByRole("menu", { name: "移动到标签组" });
    expect(submenu).toHaveClass("overflow-y-auto");
    const targetItem = screen.getByRole("menuitem", { name: "移入「实验室」" });
    await waitFor(() => expect(targetItem).toHaveFocus());
    await user.keyboard("{ArrowLeft}");
    expect(moveItem).toHaveFocus();

    await user.keyboard("{ArrowRight}");
    await user.click(screen.getByRole("menuitem", { name: "移入「实验室」" }));
    expect(onMoveTerminalTab).toHaveBeenCalledWith({
      position: "after",
      tabId: "tab-dev-b",
      targetGroupId: "group-lab",
      targetTabId: "tab-lab",
    });
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("renames a terminal tab from the right-click menu", async () => {
    const user = userEvent.setup();
    const onRenameTab = vi.fn();

    function ControlledWorkspace() {
      const [tabs, setTabs] = useState(groupedSshTabs);

      return (
        <TerminalWorkspace
          {...workspaceProps({
            activeTabId: "tab-dev-a",
            focusedPaneId: "pane-dev-a",
            onRenameTab: (tabId, title) => {
              onRenameTab(tabId, title);
              setTabs((current) =>
                current.map((tab) =>
                  tab.id === tabId ? { ...tab, title } : tab,
                ),
              );
            },
            panes: groupedSshPanes,
            tabs,
          })}
        />
      );
    }

    render(<ControlledWorkspace />);

    fireEvent.contextMenu(
      screen.getByRole("button", { name: "dev.internal #2" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "重命名标签" }));
    expect(
      screen.getByRole("dialog", { name: "重命名标签" }),
    ).toBeInTheDocument();

    await user.clear(screen.getByLabelText("标签名称"));
    await user.type(screen.getByLabelText("标签名称"), "生产日志");
    await user.click(screen.getByRole("button", { name: "保存标签" }));

    expect(onRenameTab).toHaveBeenCalledWith("tab-dev-b", "生产日志");
    expect(
      screen.getByRole("button", { name: "生产日志" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "dev.internal #2" }),
    ).not.toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "生产日志" })).toHaveFocus(),
    );
  });

}
