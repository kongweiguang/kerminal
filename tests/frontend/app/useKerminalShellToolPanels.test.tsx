// @author kongweiguang

import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useKerminalShellToolPanels } from "../../../src/app/useKerminalShellToolPanels";
import { normalizeToolRailSettings } from "../../../src/features/tool-panel";

describe("useKerminalShellToolPanels", () => {
  it("并行保留不同方向并在配置冲突时只收敛同方向", async () => {
    const setOpenTools = vi.fn();
    const settings = normalizeToolRailSettings({
      panelPlacements: {
        context: "left",
        logs: "attached",
        snippets: "center",
        system: "bottom",
      },
    });
    const { rerender, result } = renderHook(
      ({ currentSettings }) =>
        useKerminalShellToolPanels({
          activeTool: "snippets",
          compactShell: false,
          openTools: ["context", "logs", "system", "snippets"],
          setOpenTools,
          settings: currentSettings,
        }),
      { initialProps: { currentSettings: settings } },
    );

    expect(result.current.openPanels).toEqual({
      attached: "logs",
      bottom: "system",
      center: "snippets",
      left: "context",
    });

    act(() => result.current.openTool("agentLauncher"));
    expect(setOpenTools).toHaveBeenLastCalledWith(
      ["context", "system", "snippets", "agentLauncher"],
      "agentLauncher",
    );

    act(() => result.current.toggleTool("system"));
    expect(setOpenTools).toHaveBeenLastCalledWith(
      ["context", "logs", "snippets"],
      "snippets",
    );

    setOpenTools.mockClear();
    rerender({
      currentSettings: normalizeToolRailSettings({
        panelPlacements: {
          context: "left",
          logs: "attached",
          snippets: "center",
          system: "attached",
        },
      }),
    });
    await waitFor(() => {
      expect(setOpenTools).toHaveBeenCalledWith(
        ["context", "system", "snippets"],
        "snippets",
      );
    });
  });

  it("紧凑布局打开任意方向时只保留单个抽屉", () => {
    const setOpenTools = vi.fn();
    const { result } = renderHook(() =>
      useKerminalShellToolPanels({
        activeTool: "context",
        compactShell: true,
        openTools: ["context"],
        setOpenTools,
        settings: normalizeToolRailSettings({
          panelPlacements: { system: "bottom" },
        }),
      }),
    );

    act(() => result.current.openTool("system"));

    expect(setOpenTools).toHaveBeenLastCalledWith(["system"], "system");
  });
});
