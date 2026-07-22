// @author kongweiguang
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  chooseSelectOption,
  fileDialogMock,
  renderControlledSettings,
} from "../../support/settings/SettingsToolContent.testHarness";

describe("SettingsToolContent controls", () => {
  it("updates theme mode and terminal appearance from controls", async () => {
    const user = userEvent.setup();
    const onSettingsChange = vi.fn();

    renderControlledSettings({ onSettingsChange });

    await chooseSelectOption(user, "界面语言", "English");
    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        appearance: expect.objectContaining({ interfaceLanguage: "enUS" }),
      }),
    );

    await user.click(screen.getByRole("button", { name: "浅色" }));
    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ themeMode: "light" }),
    );

    fireEvent.change(screen.getByLabelText("界面透明度"), {
      target: { value: "68" },
    });
    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        appearance: expect.objectContaining({ windowOpacity: 68 }),
      }),
    );

    await user.click(screen.getByRole("button", { name: /紧凑/ }));
    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ interfaceDensity: "compact" }),
    );

    await user.click(screen.getByLabelText("启用主页面背景"));
    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        appearance: expect.objectContaining({ backgroundEnabled: true }),
      }),
    );

    fireEvent.change(screen.getByLabelText("背景透明度"), {
      target: { value: "72" },
    });
    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        appearance: expect.objectContaining({ backgroundOpacity: 72 }),
      }),
    );

    await user.click(screen.getByRole("button", { name: /平铺纹理/ }));
    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        appearance: expect.objectContaining({ backgroundFit: "tile" }),
      }),
    );

    fireEvent.change(screen.getByLabelText("背景图路径"), {
      target: { value: "C:\\Users\\dev\\Pictures\\bg.png" },
    });
    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        appearance: expect.objectContaining({
          backgroundImagePath: "C:\\Users\\dev\\Pictures\\bg.png",
        }),
      }),
    );

    fileDialogMock.selectLocalFile.mockResolvedValueOnce(
      "C:\\Users\\dev\\Pictures\\picked.png",
    );
    await user.click(screen.getByRole("button", { name: /浏览/ }));
    await waitFor(() => {
      expect(onSettingsChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          appearance: expect.objectContaining({
            backgroundEnabled: true,
            backgroundImagePath: "C:\\Users\\dev\\Pictures\\picked.png",
          }),
        }),
      );
    });

    await user.click(screen.getByRole("button", { name: /终端/ }));

    await user.click(screen.getAllByRole("button", { name: /Tokyo Night/ })[1]);
    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        terminal: expect.objectContaining({
          colorScheme: "tokyoNight",
          darkColorScheme: "tokyoNight",
        }),
      }),
    );
    expect(screen.getByLabelText("终端字体预览")).toBeInTheDocument();

    await chooseSelectOption(user, "终端字体", "JetBrainsMono Nerd Font");
    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        terminal: expect.objectContaining({
          fontFamily: expect.stringContaining("JetBrainsMono Nerd Font"),
        }),
      }),
    );
    expect(screen.getByLabelText("终端字体预览")).toHaveStyle({
      fontFamily:
        '"JetBrainsMono Nerd Font", "JetBrainsMonoNL Nerd Font", "JetBrains Mono", "Cascadia Mono", Consolas, monospace',
    });
    expect(screen.getByLabelText("终端字体预览")).toHaveAttribute(
      "data-font-label",
      "JetBrainsMono Nerd Font",
    );
    expect(screen.getByText("font: JetBrainsMono Nerd Font")).toHaveStyle({
      fontFamily:
        '"JetBrainsMono Nerd Font", "JetBrainsMonoNL Nerd Font", "JetBrains Mono", "Cascadia Mono", Consolas, monospace',
    });
    expect(screen.getByText("abcdefghijklmnopqrstuvwxyz").style.fontFamily).toBe(
      '"JetBrainsMono Nerd Font", "JetBrainsMonoNL Nerd Font", "JetBrains Mono", "Cascadia Mono", Consolas, monospace',
    );

    fireEvent.change(screen.getByLabelText("字号"), {
      target: { value: "16" },
    });
    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        terminal: expect.objectContaining({ fontSize: 16 }),
      }),
    );

    fireEvent.change(screen.getByLabelText("行高"), {
      target: { value: "1.5" },
    });
    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        terminal: expect.objectContaining({ lineHeight: 1.5 }),
      }),
    );

    await chooseSelectOption(user, "终端字重", "中等");
    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        terminal: expect.objectContaining({ fontWeight: "medium" }),
      }),
    );

    await user.click(screen.getByLabelText("选中复制"));
    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        terminal: expect.objectContaining({ selectionCopy: true }),
      }),
    );

    await chooseSelectOption(user, "终端右键行为", "粘贴");
    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        terminal: expect.objectContaining({ rightClickBehavior: "paste" }),
      }),
    );

    await user.click(screen.getByLabelText("显示标签序号"));
    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        terminal: expect.objectContaining({ showTabNumbers: true }),
      }),
    );

    await user.click(screen.getByLabelText("关闭标签前确认"));
    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        terminal: expect.objectContaining({ confirmCloseTab: false }),
      }),
    );

    await user.click(screen.getByLabelText("将 macOS Option 键作为 Meta 键"));
    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        terminal: expect.objectContaining({ macOptionIsMeta: true }),
      }),
    );

    await user.click(screen.getByRole("button", { name: /竖线光标/ }));
    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        terminal: expect.objectContaining({ cursorStyle: "bar" }),
      }),
    );

    await user.click(screen.getByLabelText("自动重连"));
    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        terminal: expect.objectContaining({ autoReconnect: false }),
      }),
    );

    await user.click(screen.getByRole("button", { name: /命令提示/ }));

    await user.click(screen.getByLabelText("启用灰色提示"));
    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        terminal: expect.objectContaining({
          inlineSuggestion: expect.objectContaining({
            enabled: false,
            presentation: "off",
          }),
        }),
      }),
    );

    await user.click(screen.getByLabelText("允许远端只读探测"));
    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        terminal: expect.objectContaining({
          inlineSuggestion: expect.objectContaining({
            remoteProbeEnabled: false,
            remoteRefresh: "off",
          }),
        }),
      }),
    );

    await chooseSelectOption(user, "命令建议展示方式", "仅灰色提示");
    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        terminal: expect.objectContaining({
          inlineSuggestion: expect.objectContaining({
            enabled: true,
            presentation: "inline",
          }),
        }),
      }),
    );

    await user.click(screen.getByLabelText("允许分段接受命令建议"));
    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        terminal: expect.objectContaining({
          inlineSuggestion: expect.objectContaining({
            partialAccept: false,
          }),
        }),
      }),
    );

    await user.click(screen.getByLabelText("允许 Tab 打开命令建议列表"));
    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        terminal: expect.objectContaining({
          inlineSuggestion: expect.objectContaining({
            tabOpensMenu: true,
          }),
        }),
      }),
    );

    await chooseSelectOption(user, "灰色提示接受按键", "不绑定");
    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        terminal: expect.objectContaining({
          inlineSuggestion: expect.objectContaining({
            acceptKey: "disabled",
          }),
        }),
      }),
    );

    await chooseSelectOption(user, "灰色提示生产主机策略", "按普通主机");
    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        terminal: expect.objectContaining({
          inlineSuggestion: expect.objectContaining({
            productionHostPolicy: "normal",
          }),
        }),
      }),
    );

    expect(screen.queryByLabelText("审计保留天数")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("反馈保留天数")).not.toBeInTheDocument();

    await user.click(screen.getByLabelText("远端路径"));
    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        terminal: expect.objectContaining({
          inlineSuggestion: expect.objectContaining({
            providers: expect.objectContaining({ remotePath: false }),
          }),
        }),
      }),
    );

    await user.click(screen.getByRole("button", { name: /SFTP/ }));
    fireEvent.change(screen.getByLabelText("全局传输并发"), {
      target: { value: "8" },
    });
    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        sftp: expect.objectContaining({ globalTransfers: 8 }),
      }),
    );
    fireEvent.change(screen.getByLabelText("单主机并发"), {
      target: { value: "3" },
    });
    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        sftp: expect.objectContaining({ hostTransfers: 3 }),
      }),
    );
    fireEvent.change(screen.getByLabelText("流水线深度"), {
      target: { value: "96" },
    });
    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        sftp: expect.objectContaining({ pipelineDepth: 96 }),
      }),
    );
    expect(screen.getByLabelText("最大包大小")).toHaveValue(0.25);
    fireEvent.change(screen.getByLabelText("最大包大小"), {
      target: { value: "1" },
    });
    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        sftp: expect.objectContaining({ packetBytes: 256 * 1024 }),
      }),
    );
    fireEvent.change(screen.getByLabelText("请求超时"), {
      target: { value: "45" },
    });
    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        sftp: expect.objectContaining({ timeoutSeconds: 45 }),
      }),
    );

    await user.click(screen.getByRole("button", { name: /桌面/ }));
    await user.click(screen.getByText("启用桌面通知"));
    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        desktopNotifications: expect.objectContaining({ enabled: true }),
      }),
    );

    await user.click(screen.getByText("启用桌面通知"));
    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        desktopNotifications: expect.objectContaining({ enabled: false }),
      }),
    );

    await user.click(screen.getByLabelText("启用桌面通知"));
    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        desktopNotifications: expect.objectContaining({ enabled: true }),
      }),
    );

    await user.click(screen.getByLabelText("只通知重要事件"));
    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        desktopNotifications: expect.objectContaining({ importantOnly: true }),
      }),
    );

    fireEvent.change(screen.getByLabelText("耗时阈值"), {
      target: { value: "25" },
    });
    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        desktopNotifications: expect.objectContaining({ minDurationMs: 25_000 }),
      }),
    );

    fireEvent.change(screen.getByLabelText("同类事件节流"), {
      target: { value: "60" },
    });
    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        desktopNotifications: expect.objectContaining({ throttleMs: 60_000 }),
      }),
    );
  });
});
