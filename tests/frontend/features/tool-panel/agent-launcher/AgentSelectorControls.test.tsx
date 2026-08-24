// @author kongweiguang

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AgentSelector, type AgentSelectorOption } from "../../../../../src/features/tool-panel/agent-launcher/AgentSelector";
import { AgentLaunchSplitButton } from "../../../../../src/features/tool-panel/agent-launcher/AgentLaunchControls";
import { CustomAgentManagerDialog } from "../../../../../src/features/tool-panel/agent-launcher/CustomAgentManagerDialog";

const codexOption: AgentSelectorOption = {
  agentId: "codex",
  key: "builtin:codex",
  name: "Codex",
  statusDetail: "Codex is available",
  statusLabel: "可用",
  tone: "ready",
};

const claudeOption: AgentSelectorOption = {
  agentId: "claude",
  key: "builtin:claude",
  name: "Claude",
  statusDetail: "Claude is available",
  statusLabel: "可用",
  tone: "ready",
};

const customOption: AgentSelectorOption = {
  agentId: "custom",
  commandLabel: "pi",
  key: "custom:11111111-1111-4111-8111-111111111111",
  name: "PI Agent",
  statusLabel: "已保存",
  tone: "ready",
};

describe("AgentSelector", () => {
  it("固定内置顺序并把添加入口留在可滚动列表之外", () => {
    const onManageCustomAgents = vi.fn();
    render(
      <AgentSelector
        actionState={null}
        onManageCustomAgents={onManageCustomAgents}
        onSelect={vi.fn()}
        options={[customOption, claudeOption, codexOption]}
        selectedKey={codexOption.key}
      />,
    );

    fireEvent.click(screen.getByRole("combobox", { name: "选择 Agent" }));
    const listbox = screen.getByRole("listbox");
    expect(
      within(listbox)
        .getAllByRole("option")
        .map((option) => option.getAttribute("aria-label")),
    ).toEqual(["Codex，可用", "Claude，可用", "PI Agent，已保存"]);
    expect(listbox).toHaveClass("overflow-y-auto");

    const addButton = screen.getByRole("button", {
      name: "添加自定义 Agent",
    });
    expect(listbox.contains(addButton)).toBe(false);
    fireEvent.click(addButton);
    expect(onManageCustomAgents).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("方向键选择后即使进入 pending 仍恢复焦点，Tab 可达添加入口", async () => {
    const onSelect = vi.fn();
    const { rerender } = render(
      <AgentSelector
        actionState={null}
        onManageCustomAgents={vi.fn()}
        onSelect={onSelect}
        options={[codexOption, claudeOption, customOption]}
        selectedKey={codexOption.key}
      />,
    );

    const trigger = screen.getByRole("combobox", { name: "选择 Agent" });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith(claudeOption.key);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    rerender(
      <AgentSelector
        actionState={null}
        disabled
        onManageCustomAgents={vi.fn()}
        onSelect={onSelect}
        options={[codexOption, claudeOption, customOption]}
        selectedKey={claudeOption.key}
      />,
    );
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(trigger).toHaveAttribute("aria-disabled", "true");

    rerender(
      <AgentSelector
        actionState={null}
        onManageCustomAgents={vi.fn()}
        onSelect={onSelect}
        options={[codexOption, claudeOption, customOption]}
        selectedKey={claudeOption.key}
      />,
    );
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.keyDown(trigger, { key: "Tab" });
    expect(
      screen.getByRole("button", { name: "添加自定义 Agent" }),
    ).toHaveFocus();
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("Escape 只关闭下拉且隐藏或卸载时清理 body portal", async () => {
    const onWorkspaceEscape = vi.fn();
    const { rerender, unmount } = render(
      <AgentSelector
        actionState={null}
        onManageCustomAgents={vi.fn()}
        onSelect={vi.fn()}
        options={[codexOption, claudeOption]}
        selectedKey={codexOption.key}
      />,
    );
    const trigger = screen.getByRole("combobox", { name: "选择 Agent" });
    window.addEventListener("keydown", onWorkspaceEscape);
    try {
      fireEvent.click(trigger);
      expect(screen.getByRole("listbox")).toBeInTheDocument();
      fireEvent.keyDown(trigger, { key: "Escape" });
      await waitFor(() => expect(trigger).toHaveFocus());
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
      expect(onWorkspaceEscape).not.toHaveBeenCalled();

      fireEvent.click(trigger);
      expect(screen.getByRole("listbox")).toBeInTheDocument();
      rerender(
        <AgentSelector
          actionState={null}
          active={false}
          onManageCustomAgents={vi.fn()}
          onSelect={vi.fn()}
          options={[codexOption, claudeOption]}
          selectedKey={codexOption.key}
        />,
      );
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

      rerender(
        <AgentSelector
          actionState={null}
          onManageCustomAgents={vi.fn()}
          onSelect={vi.fn()}
          options={[codexOption, claudeOption]}
          selectedKey={codexOption.key}
        />,
      );
      fireEvent.click(trigger);
      expect(screen.getByRole("listbox")).toBeInTheDocument();
      unmount();
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    } finally {
      window.removeEventListener("keydown", onWorkspaceEscape);
    }
  });

  it("长名称和命令摘要保持截断，并且启动中禁止重复选择", () => {
    const longCustom = {
      ...customOption,
      commandLabel: "a-very-long-agent-executable-name-that-must-not-overflow.exe",
      name: "这是一个非常非常长但必须在窄工具面板中保持单行截断的自定义 Agent 名称",
    };
    render(
      <AgentSelector
        actionState={longCustom.key}
        onManageCustomAgents={vi.fn()}
        onSelect={vi.fn()}
        options={[codexOption, claudeOption, longCustom]}
        selectedKey={longCustom.key}
      />,
    );

    const trigger = screen.getByRole("combobox", { name: "选择 Agent" });
    expect(trigger).toHaveAttribute("aria-disabled", "true");
    expect(trigger).not.toBeDisabled();
    expect(trigger).toHaveTextContent(longCustom.name);
    expect(trigger.querySelectorAll(".truncate").length).toBeGreaterThan(0);
    expect(trigger.querySelectorAll(".animate-spin")).toHaveLength(1);
  });
});

describe("AgentLaunchSplitButton", () => {
  it("主按钮进入当前范围，次菜单提供跳过权限与全局入口", async () => {
    const onLaunch = vi.fn();
    render(
      <AgentLaunchSplitButton
        actionState={null}
        onLaunch={onLaunch}
        option={codexOption}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "使用 Codex 进入" }));
    expect(onLaunch).toHaveBeenLastCalledWith("default", "current");

    const menuButton = screen.getByRole("button", {
      name: "打开 Agent 启动选项",
    });
    fireEvent.click(menuButton);
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("menuitem", { name: "跳过权限打开 Codex" }),
    );
    expect(onLaunch).toHaveBeenLastCalledWith("skipPermissions", "current");

    fireEvent.keyDown(menuButton, { key: "ArrowDown" });
    const globalMenuItem = screen.getByRole("menuitem", {
      name: "允许 Codex 操作整个 Kerminal",
    });
    await waitFor(() =>
      expect(
        screen.getByRole("menuitem", { name: "跳过权限打开 Codex" }),
      ).toHaveFocus(),
    );
    fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowDown" });
    expect(globalMenuItem).toHaveFocus();
    fireEvent.click(globalMenuItem);
    expect(onLaunch).toHaveBeenLastCalledWith("default", "unbound");
  });

  it("Custom 不展示无效的跳过权限项，Escape 关闭后恢复箭头焦点", async () => {
    render(
      <AgentLaunchSplitButton
        actionState={null}
        onLaunch={vi.fn()}
        option={customOption}
      />,
    );
    const menuButton = screen.getByRole("button", {
      name: "打开 Agent 启动选项",
    });
    fireEvent.click(menuButton);
    expect(
      screen.queryByRole("menuitem", { name: /跳过权限打开/ }),
    ).not.toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.getByRole("menuitem", {
          name: "允许 PI Agent 操作整个 Kerminal",
        }),
      ).toHaveFocus(),
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(menuButton).toHaveFocus();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("设置确认保存期间禁用进入与启动选项，阻止未确认选择被启动", () => {
    const onLaunch = vi.fn();
    render(
      <AgentLaunchSplitButton
        actionState={null}
        disabled
        onLaunch={onLaunch}
        option={customOption}
      />,
    );

    expect(
      screen.getByRole("button", { name: "使用 PI Agent 进入" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "打开 Agent 启动选项" }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "使用 PI Agent 进入" }));
    expect(onLaunch).not.toHaveBeenCalled();
  });
});

describe("CustomAgentManagerDialog", () => {
  it("保存失败时保留草稿，成功后交给上层选择并聚焦进入", async () => {
    const onSave = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const onSaved = vi.fn();
    render(
      <CustomAgentManagerDialog
        customAgents={[]}
        error={null}
        mutationPending={false}
        onClose={vi.fn()}
        onDelete={vi.fn().mockResolvedValue(true)}
        onSave={onSave}
        onSaved={onSaved}
        open
      />,
    );

    expect(screen.getByText(/settings\.toml/)).toHaveTextContent(
      "请勿填写 API Key、密码或 token",
    );
    fireEvent.change(
      screen.getByRole("textbox", { name: "自定义 Agent 名称" }),
      { target: { value: "PI Agent" } },
    );
    fireEvent.change(
      screen.getByRole("textbox", { name: "自定义 Agent 启动命令" }),
      { target: { value: "pi --model provider/model" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "保存并选择" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(
      screen.getByRole("textbox", { name: "自定义 Agent 启动命令" }),
    ).toHaveValue("pi --model provider/model");
    expect(onSaved).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "保存并选择" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  });

  it("支持编辑、长列表滚动和确认删除，并说明历史会话仍保留", async () => {
    const customAgents = Array.from({ length: 18 }, (_, index) => ({
      command: `pi-${index} --model provider/model-${index}`,
      id: `11111111-1111-4111-8111-${String(index).padStart(12, "0")}`,
      name: `PI Agent ${index}`,
    }));
    const onDelete = vi.fn().mockResolvedValue(true);
    render(
      <CustomAgentManagerDialog
        customAgents={customAgents}
        error={null}
        mutationPending={false}
        onClose={vi.fn()}
        onDelete={onDelete}
        onSave={vi.fn().mockResolvedValue(true)}
        onSaved={vi.fn()}
        open
      />,
    );

    const list = screen.getByRole("list", { name: "自定义 Agent 列表" });
    expect(list.closest(".overflow-y-auto")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "编辑 PI Agent 0" }));
    expect(
      screen.getByRole("textbox", { name: "自定义 Agent 启动命令" }),
    ).toHaveValue("pi-0 --model provider/model-0");

    fireEvent.click(screen.getByRole("button", { name: "删除 PI Agent 0" }));
    expect(
      screen.getByRole("heading", { name: "删除自定义 Agent？" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/历史会话不会被删除/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "删除定义" }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith(customAgents[0].id));
  });

  it("忽略大小写阻止重名并保留焦点可达的取消编辑路径", () => {
    render(
      <CustomAgentManagerDialog
        customAgents={[
          {
            command: "pi",
            id: "11111111-1111-4111-8111-111111111111",
            name: "PI Agent",
          },
        ]}
        error={null}
        mutationPending={false}
        onClose={vi.fn()}
        onDelete={vi.fn().mockResolvedValue(true)}
        onSave={vi.fn().mockResolvedValue(true)}
        onSaved={vi.fn()}
        open
      />,
    );
    fireEvent.change(
      screen.getByRole("textbox", { name: "自定义 Agent 名称" }),
      { target: { value: "pi agent" } },
    );
    fireEvent.change(
      screen.getByRole("textbox", { name: "自定义 Agent 启动命令" }),
      { target: { value: "other-pi" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "保存并选择" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Agent 名称已存在");
  });

  it("按 Unicode 字符而非 UTF-16 单元校验 emoji 名称", async () => {
    const onSave = vi.fn().mockResolvedValue(true);
    render(
      <CustomAgentManagerDialog
        customAgents={[]}
        error={null}
        mutationPending={false}
        onClose={vi.fn()}
        onDelete={vi.fn().mockResolvedValue(true)}
        onSave={onSave}
        onSaved={vi.fn()}
        open
      />,
    );

    const nameInput = screen.getByRole("textbox", {
      name: "自定义 Agent 名称",
    });
    expect(nameInput).not.toHaveAttribute("maxlength");
    fireEvent.change(nameInput, { target: { value: "🤖".repeat(64) } });
    fireEvent.change(
      screen.getByRole("textbox", { name: "自定义 Agent 启动命令" }),
      { target: { value: "pi" } },
    );
    const saveButton = screen.getByRole("button", { name: "保存并选择" });
    expect(screen.getByText("64 / 64")).toBeInTheDocument();
    expect(nameInput).not.toHaveAttribute("aria-invalid");
    expect(saveButton).toBeEnabled();
    fireEvent.click(saveButton);
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));

    fireEvent.change(nameInput, { target: { value: "🤖".repeat(65) } });
    expect(screen.getByText("65 / 64")).toBeInTheDocument();
    expect(nameInput).toHaveAttribute("aria-invalid", "true");
    expect(saveButton).toBeDisabled();
    fireEvent.submit(nameInput.closest("form")!);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Agent 名称不能超过 64 个字符",
    );
    expect(onSave).toHaveBeenCalledTimes(1);
  });
});
