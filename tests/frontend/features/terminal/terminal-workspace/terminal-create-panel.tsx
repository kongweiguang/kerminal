// @author kongweiguang

import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { TerminalWorkspace } from "../../../../../src/features/terminal/TerminalWorkspace";
import { workspaceProps } from "../../../support/terminal/TerminalWorkspace.testSupport.ts";

/**
 * 汇总新建终端面板的搜索、固定和键盘生命周期，避免这些非模态交互继续挤占
 * 通用 Tab 菜单测试的责任边界。
 */
export function registerTerminalCreatePanelTests() {
  it("opens and navigates the create panel from the keyboard context key", async () => {
    const onCreateTerminal = vi.fn();
    render(
      <TerminalWorkspace
        {...workspaceProps({
          onCreateTerminal,
          profiles: [
            {
              args: [],
              createdAt: "test",
              env: {},
              id: "profile-first",
              isDefault: true,
              name: "First Profile",
              shell: "first.exe",
              sortOrder: 10,
              updatedAt: "test",
            },
            {
              args: [],
              createdAt: "test",
              env: {},
              id: "profile-second",
              isDefault: false,
              name: "Second Profile",
              shell: "second.exe",
              sortOrder: 20,
              updatedAt: "test",
            },
          ],
        })}
      />,
    );

    const createButton = screen.getByRole("button", {
      name: "新建临时终端",
    });
    createButton.focus();
    fireEvent.keyDown(createButton, { key: "ContextMenu" });

    const panel = screen.getByRole("dialog", { name: "新建终端" });
    const menu = within(panel).getByRole("menu", { name: "终端目标" });
    const searchInput = within(panel).getByRole("textbox", {
      name: "搜索终端或主机",
    });
    const firstProfile = within(menu).getByRole("menuitem", {
      name: /First Profile/,
    });
    const secondProfile = within(menu).getByRole("menuitem", {
      name: /Second Profile/,
    });
    await waitFor(() => expect(searchInput).toHaveFocus());
    fireEvent.keyDown(searchInput, { key: "ArrowDown" });
    expect(firstProfile).toHaveFocus();
    fireEvent.keyDown(firstProfile, { key: "ArrowDown" });
    expect(secondProfile).toHaveFocus();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(
      screen.queryByRole("dialog", { name: "新建终端" }),
    ).not.toBeInTheDocument();
    expect(createButton).toHaveFocus();
  });

  it("keeps a pinned searchable terminal panel open until it is unpinned", async () => {
    const user = userEvent.setup();
    const onCreateTerminal = vi.fn();
    render(
      <TerminalWorkspace
        {...workspaceProps({
          onCreateTerminal,
          profiles: [
            {
              args: [],
              createdAt: "test",
              env: {},
              id: "profile-pwsh",
              isDefault: true,
              name: "PowerShell 7",
              shell: "pwsh.exe",
              sortOrder: 10,
              updatedAt: "test",
            },
            {
              args: [],
              createdAt: "test",
              env: {},
              id: "profile-cmd",
              isDefault: false,
              name: "Command Prompt",
              shell: "cmd.exe",
              sortOrder: 20,
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
    const panel = screen.getByRole("dialog", { name: "新建终端" });
    const searchInput = within(panel).getByRole("textbox", {
      name: "搜索终端或主机",
    });
    await user.type(searchInput, "cmd.exe");
    expect(within(panel).queryByText("PowerShell 7")).not.toBeInTheDocument();

    const pinButton = within(panel).getByRole("button", {
      name: "固定终端面板",
    });
    await user.click(pinButton);
    expect(pinButton).toHaveAttribute("aria-pressed", "true");
    expect(panel).toHaveAttribute("data-terminal-create-pinned", "true");

    fireEvent.pointerDown(document.body);
    fireEvent.resize(window);
    expect(panel).toBeInTheDocument();

    await user.click(
      within(panel).getByRole("menuitem", { name: /Command Prompt/ }),
    );
    expect(onCreateTerminal).toHaveBeenCalledWith("profile-cmd");
    expect(panel).toBeInTheDocument();

    await user.click(
      within(panel).getByRole("button", { name: "取消固定终端面板" }),
    );
    fireEvent.pointerDown(document.body);
    expect(
      screen.queryByRole("dialog", { name: "新建终端" }),
    ).not.toBeInTheDocument();
  });
}
