// @author kongweiguang

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { defaultAppSettings } from "../../../../../src/features/settings/settingsModel";
import { useConfirmedAgentLauncherSettings } from "../../../../../src/features/tool-panel/agent-launcher/useConfirmedAgentLauncherSettings";

describe("useConfirmedAgentLauncherSettings", () => {
  it("rolls an optimistic selection back when confirmed settings save fails", async () => {
    let rejectSave: ((reason?: unknown) => void) | undefined;
    const save = vi.fn(
      () =>
        new Promise<typeof defaultAppSettings>((_resolve, reject) => {
          rejectSave = reject;
        }),
    );
    const { result } = renderHook(() =>
      useConfirmedAgentLauncherSettings({
        onConfirmedSettingsChange: save,
        settings: defaultAppSettings,
      }),
    );

    let selectionResult: Promise<boolean> | undefined;
    act(() => {
      selectionResult = result.current.selectAgent("builtin:claude");
    });
    expect(result.current.launcherSettings.selectedAgentKey).toBe(
      "builtin:claude",
    );
    expect(result.current.mutationPending).toBe(true);

    await act(async () => {
      rejectSave?.(new Error("disk full"));
      await selectionResult;
    });

    expect(result.current.launcherSettings.selectedAgentKey).toBe(
      "builtin:codex",
    );
    expect(result.current.mutationPending).toBe(false);
    expect(result.current.mutationError?.title).toBe("Agent 设置保存失败");
  });

  it("does not pretend to persist when the confirmed bridge is absent", async () => {
    const { result } = renderHook(() =>
      useConfirmedAgentLauncherSettings({ settings: defaultAppSettings }),
    );

    await expect(
      act(() => result.current.selectAgent("builtin:claude")),
    ).resolves.toBe(false);
    expect(result.current.launcherSettings.selectedAgentKey).toBe(
      "builtin:codex",
    );
    expect(result.current.mutationError?.title).toContain("无法保存");
  });
});
