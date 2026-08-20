// @author kongweiguang

import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  defaultAppSettings,
  type AppSettings,
  type TerminalKeywordHighlightRule,
} from "../../../../src/features/settings/settingsModel";
import {
  renderControlledSettings,
  renderSettingsToolContent,
} from "../../support/settings/SettingsToolContent.testHarness";

/** 构造规则 fixture，保持每个交互测试只关心自己的差异字段。 */
function rule(
  id: string,
  pattern: string,
  patch: Partial<TerminalKeywordHighlightRule> = {},
): TerminalKeywordHighlightRule {
  return {
    id,
    enabled: true,
    pattern,
    matchMode: "literal",
    caseSensitive: false,
    note: "",
    style: "yellow",
    ...patch,
  };
}

/** 将规则装入默认设置，避免测试共享或修改冻结的默认数组。 */
function settingsWithRules(
  rules: TerminalKeywordHighlightRule[],
): AppSettings {
  return {
    ...defaultAppSettings,
    terminal: {
      ...defaultAppSettings.terminal,
      keywordHighlights: { enabled: true, rules },
    },
  };
}

describe("SettingsToolContent keyword highlights", () => {
  it("shows the empty state and cancels a new local draft without changing settings", async () => {
    const user = userEvent.setup();
    const onSettingsChange = vi.fn();
    renderSettingsToolContent({
      initialSectionId: "settings-keyword-highlights",
      onSettingsChange,
    });

    expect(screen.getByText("还没有高亮规则")).toBeInTheDocument();
    const addButton = screen.getAllByRole("button", { name: "新建规则" })[0];
    await user.click(addButton);

    const keywordInput = screen.getByLabelText(/关键词或表达式/);
    await waitFor(() => expect(keywordInput).toHaveFocus());
    await user.type(keywordInput, "java");
    await user.click(screen.getByRole("button", { name: "取消" }));

    expect(screen.getByText("还没有高亮规则")).toBeInTheDocument();
    expect(onSettingsChange).not.toHaveBeenCalled();
    await waitFor(() => expect(addButton).toHaveFocus());
  });

  it("persists a rule through the confirmed path and restores row focus after save and cancel", async () => {
    const user = userEvent.setup();
    const onSettingsChange = vi.fn();
    const onConfirmedSettingsChange = vi.fn(
      async (settings: AppSettings) => settings,
    );
    renderControlledSettings({
      initialSectionId: "settings-keyword-highlights",
      onConfirmedSettingsChange,
      onSettingsChange,
    });

    await user.click(screen.getAllByRole("button", { name: "新建规则" })[0]);
    await user.type(screen.getByLabelText(/关键词或表达式/), "java");
    await user.type(screen.getByLabelText(/备注/), "Java 模块");
    await user.click(screen.getByRole("button", { name: "保存规则" }));

    await waitFor(() => expect(onConfirmedSettingsChange).toHaveBeenCalledTimes(1));
    const saved = onConfirmedSettingsChange.mock.calls[0][0];
    expect(saved.terminal.keywordHighlights.rules[0]).toMatchObject({
      pattern: "java",
      matchMode: "literal",
      note: "Java 模块",
    });
    expect(onSettingsChange).not.toHaveBeenCalled();

    const rowButton = await screen.findByRole("button", { name: "编辑规则 java" });
    await waitFor(() => expect(rowButton).toHaveFocus());
    const input = screen.getByLabelText(/关键词或表达式/);
    await user.clear(input);
    await user.type(input, "changed");
    await user.click(screen.getByRole("button", { name: "取消" }));

    expect(screen.getByLabelText(/关键词或表达式/)).toHaveValue("java");
    await waitFor(() => expect(rowButton).toHaveFocus());
  });

  it("keeps the draft for unsafe regex and confirmed-save failures", async () => {
    const user = userEvent.setup();
    const onConfirmedSettingsChange = vi.fn(
      async () => Promise.reject(new Error("settings.toml 只读")),
    );
    renderControlledSettings({
      initialSectionId: "settings-keyword-highlights",
      onConfirmedSettingsChange,
      onSettingsChange: vi.fn(),
    });

    await user.click(screen.getAllByRole("button", { name: "新建规则" })[0]);
    const input = screen.getByLabelText(/关键词或表达式/);
    await user.type(input, "(?=error)");
    await user.click(screen.getByRole("radio", { name: "正则" }));
    await user.click(screen.getByRole("button", { name: "保存规则" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("前后查找");
    expect(onConfirmedSettingsChange).not.toHaveBeenCalled();
    await user.clear(input);
    await user.type(input, "error|warn");
    await user.click(screen.getByRole("button", { name: "保存规则" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("settings.toml 只读");
    expect(input).toHaveValue("error|warn");
    expect(onConfirmedSettingsChange).toHaveBeenCalledTimes(1);
  });

  it("supports row enable, keyboard ordering, search, deletion, and undo", async () => {
    const user = userEvent.setup();
    const onSettingsChange = vi.fn();
    renderControlledSettings({
      initialSectionId: "settings-keyword-highlights",
      onSettingsChange,
      settings: settingsWithRules([
        rule("first", "alpha", { note: "first" }),
        rule("second", "beta", { note: "second" }),
      ]),
    });

    await user.click(screen.getByRole("switch", { name: "停用规则 alpha" }));
    await waitFor(() => {
      const latestCall = onSettingsChange.mock.calls[onSettingsChange.mock.calls.length - 1];
      expect(latestCall?.[0].terminal.keywordHighlights.rules[0].enabled).toBe(false);
    });

    await user.click(screen.getByRole("button", { name: "下移规则 alpha" }));
    await waitFor(() => {
      const latestCall = onSettingsChange.mock.calls[onSettingsChange.mock.calls.length - 1];
      expect(
        latestCall?.[0].terminal.keywordHighlights.rules.map(
          (item: TerminalKeywordHighlightRule) => item.id,
        ),
      ).toEqual(["second", "first"]);
    });

    const searchInput = screen.getByLabelText("搜索关键词高亮规则");
    await user.type(searchInput, "beta");
    expect(screen.getByRole("button", { name: "编辑规则 beta" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "编辑规则 alpha" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "清除规则搜索" }));

    await user.click(screen.getByRole("button", { name: "编辑规则 beta" }));
    await user.click(screen.getByRole("button", { name: "删除规则" }));
    const undoStatus = screen.getByRole("status");
    expect(within(undoStatus).getByText(/15 秒内撤销/)).toBeInTheDocument();
    await user.click(within(undoStatus).getByRole("button", { name: "撤销" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "编辑规则 beta" })).toBeInTheDocument();
    });
  });
});
