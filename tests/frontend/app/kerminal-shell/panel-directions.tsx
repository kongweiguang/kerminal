// @author kongweiguang

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { KerminalShell } from "../../../../src/app/KerminalShell";
import { defaultAppSettings } from "../../../../src/features/settings/settingsModel";
import { useWorkspaceStore } from "../../../../src/features/workspace/workspaceStore";
import { mocks } from "./setup";

/** 注册跨方向布局回归，避免体量较大的 Shell 基础测试重新形成单文件债务。 */
export function registerPanelDirectionTests() {
  it("resizes the bottom tool panel vertically without closing other directions", async () => {
    mocks.settingsApi.getSettings.mockResolvedValue({
      ...defaultAppSettings,
      toolRail: {
        ...defaultAppSettings.toolRail,
        panelPlacements: {
          ...defaultAppSettings.toolRail.panelPlacements,
          context: "left",
          system: "bottom",
        },
      },
    });
    const user = userEvent.setup();
    const { container } = render(<KerminalShell />);

    await waitFor(() => {
      expect(
        useWorkspaceStore.getState().settings.toolRail.panelPlacements.system,
      ).toBe("bottom");
    });
    await user.click(screen.getByRole("button", { name: "打开 当前上下文" }));
    await user.click(screen.getByRole("button", { name: "打开 系统" }));

    const shell = container.firstElementChild as HTMLElement;
    const separator = screen.getByRole("separator", {
      name: "调整底部工具面板高度",
    });
    const initialHeight = Number.parseFloat(
      shell.style.gridTemplateRows.match(/([\d.]+)px$/)?.[1] ?? "0",
    );

    fireEvent.pointerDown(separator, {
      button: 0,
      buttons: 1,
      clientY: 600,
      pointerId: 8,
    });
    fireEvent.pointerMove(window, {
      buttons: 1,
      clientY: 540,
      pointerId: 8,
    });
    await act(
      () =>
        new Promise<void>((resolve) => {
          window.requestAnimationFrame(() => resolve());
        }),
    );

    expect(shell).toHaveAttribute("data-panel-resizing", "tools-bottom");
    expect(shell.style.gridTemplateRows).toMatch(
      new RegExp(`${initialHeight + 60}px$`),
    );

    fireEvent.pointerUp(window, {
      buttons: 0,
      clientY: 540,
      pointerId: 8,
    });
    await act(
      () =>
        new Promise<void>((resolve) => {
          window.requestAnimationFrame(() => resolve());
        }),
    );

    expect(shell).not.toHaveAttribute("data-panel-resizing");
    expect(
      screen.getByRole("complementary", { name: "左侧工具面板" }),
    ).toBeVisible();
    expect(
      screen.getByRole("complementary", { name: "底部工具面板" }),
    ).toBeVisible();
  });
}
