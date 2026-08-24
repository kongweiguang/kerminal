// @author kongweiguang

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AgentLaunchSplitButton } from "../../../../../src/features/tool-panel/agent-launcher/AgentLaunchControls";
import {
  AgentSelector,
  type AgentSelectorOption,
} from "../../../../../src/features/tool-panel/agent-launcher/AgentSelector";

const codexOption: AgentSelectorOption = {
  agentId: "codex",
  key: "builtin:codex",
  name: "Codex",
  statusLabel: "可用",
  tone: "ready",
};

const claudeOption: AgentSelectorOption = {
  agentId: "claude",
  key: "builtin:claude",
  name: "Claude",
  statusLabel: "可用",
  tone: "ready",
};

const piOption: AgentSelectorOption = {
  agentId: "pi",
  commandLabel: "pi",
  key: "builtin:pi",
  name: "PI Agent",
  statusDetail: "PI Agent is available",
  statusLabel: "可用",
  tone: "ready",
};

const customOption: AgentSelectorOption = {
  agentId: "custom",
  commandLabel: "custom-agent",
  key: "custom:11111111-1111-4111-8111-111111111111",
  name: "Custom Agent",
  statusLabel: "已保存",
  tone: "ready",
};

describe("PI Agent selector presentation", () => {
  it("作为第三个内置条目展示专属图标、状态和完整 ARIA 名称", () => {
    render(
      <AgentSelector
        actionState={null}
        onManageCustomAgents={vi.fn()}
        onSelect={vi.fn()}
        options={[customOption, piOption, codexOption, claudeOption]}
        selectedKey={piOption.key}
      />,
    );

    const trigger = screen.getByRole("combobox", { name: "选择 Agent" });
    expect(trigger).toHaveAttribute("aria-valuetext", "PI Agent");
    expect(trigger.querySelector(".lucide-pi")).toBeInTheDocument();
    fireEvent.click(trigger);
    const options = within(screen.getByRole("listbox")).getAllByRole("option");
    expect(options.map((option) => option.getAttribute("aria-label"))).toEqual([
      "Codex，可用",
      "Claude，可用",
      "PI Agent，可用",
      "Custom Agent，已保存",
    ]);
    const piEntry = screen.getByRole("option", { name: "PI Agent，可用" });
    expect(piEntry.querySelector(".lucide-pi")).toBeInTheDocument();
    expect(piEntry).toHaveAttribute("title", "PI Agent is available");
  });

  it("长列表滚动时仍固定在第三位，添加入口保持在列表之外", () => {
    const customOptions: AgentSelectorOption[] = Array.from(
      { length: 32 },
      (_, index) => ({
        ...customOption,
        key: `custom:${String(index).padStart(2, "0")}`,
        name: `Custom Agent ${index}`,
      }),
    );
    render(
      <AgentSelector
        actionState={null}
        onManageCustomAgents={vi.fn()}
        onSelect={vi.fn()}
        options={[...customOptions, piOption, claudeOption, codexOption]}
        selectedKey={codexOption.key}
      />,
    );

    fireEvent.click(screen.getByRole("combobox", { name: "选择 Agent" }));
    const listbox = screen.getByRole("listbox");
    const options = within(listbox).getAllByRole("option");
    expect(options).toHaveLength(35);
    expect(
      options.slice(0, 3).map((option) => option.getAttribute("aria-label")),
    ).toEqual(["Codex，可用", "Claude，可用", "PI Agent，可用"]);
    expect(listbox).toHaveClass("overflow-y-auto");
    expect(
      listbox.contains(
        screen.getByRole("button", { name: "添加自定义 Agent" }),
      ),
    ).toBe(false);
  });

  it("不渲染不支持的跳过权限项，仅保留清晰的全局入口", async () => {
    const onLaunch = vi.fn();
    render(
      <AgentLaunchSplitButton
        actionState={null}
        onLaunch={onLaunch}
        option={piOption}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "打开 Agent 启动选项" }),
    );
    expect(
      screen.queryByRole("menuitem", { name: /跳过权限打开 PI Agent/ }),
    ).not.toBeInTheDocument();
    const globalEntry = screen.getByRole("menuitem", {
      name: "允许 PI Agent 操作整个 Kerminal",
    });
    expect(globalEntry).toBeVisible();
    await waitFor(() => expect(globalEntry).toHaveFocus());
    fireEvent.click(globalEntry);
    expect(onLaunch).toHaveBeenCalledWith("default", "unbound");
  });
});
