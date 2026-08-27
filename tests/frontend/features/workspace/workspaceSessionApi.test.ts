// @author kongweiguang

import { beforeEach, describe, expect, it, vi } from "vitest";

const transport = vi.hoisted(() => ({
  loadWorkspaceSessionPayload: vi.fn(),
  saveWorkspaceSessionPayload: vi.fn(),
}));

vi.mock("../../../../src/lib/workspaceSessionApi.tauri", () => transport);

describe("workspaceSessionApi", () => {
  beforeEach(() => {
    transport.loadWorkspaceSessionPayload.mockReset();
    transport.saveWorkspaceSessionPayload.mockReset();
  });

  it("normalizes a loaded payload inside the workspace feature", async () => {
    transport.loadWorkspaceSessionPayload.mockResolvedValue({
      activeTabId: "missing",
      focusedPaneId: "missing",
      selectedMachineId: "",
      sidebarMachines: [],
      terminalPanes: [],
      terminalTabs: [],
    });
    const { loadWorkspaceSessionFile } = await import(
      "../../../../src/features/workspace/workspaceSessionApi"
    );

    await expect(loadWorkspaceSessionFile()).resolves.toMatchObject({
      kind: "loaded",
      session: {
        activeTabId: "",
        focusedPaneId: "",
        terminalTabGroups: {},
        terminalTabs: [],
      },
    });
  });

  it("distinguishes missing, unsupported, invalid, and transport failures", async () => {
    const { loadWorkspaceSessionFile } = await import(
      "../../../../src/features/workspace/workspaceSessionApi"
    );
    transport.loadWorkspaceSessionPayload.mockResolvedValueOnce(null);
    await expect(loadWorkspaceSessionFile()).resolves.toEqual({
      kind: "missing",
    });

    transport.loadWorkspaceSessionPayload.mockResolvedValueOnce({
      version: 4,
    });
    await expect(loadWorkspaceSessionFile()).resolves.toMatchObject({
      kind: "unsupported",
      version: 4,
    });

    transport.loadWorkspaceSessionPayload.mockResolvedValueOnce({
      version: 3,
      terminalTabs: [],
    });
    await expect(loadWorkspaceSessionFile()).resolves.toMatchObject({
      kind: "invalid",
    });

    transport.loadWorkspaceSessionPayload.mockRejectedValueOnce(
      new Error("transport details must not escape"),
    );
    await expect(loadWorkspaceSessionFile()).resolves.toMatchObject({
      kind: "transport-failure",
    });
  });

  it("writes a normalized versioned payload through the transport", async () => {
    const { saveWorkspaceSessionFile } = await import(
      "../../../../src/features/workspace/workspaceSessionApi"
    );
    await saveWorkspaceSessionFile({
      activeTabId: "",
      focusedPaneId: "",
      selectedMachineId: "",
      sidebarMachines: [],
      terminalPanes: [],
      terminalTabs: [],
    });

    expect(transport.saveWorkspaceSessionPayload).toHaveBeenCalledWith(
      expect.objectContaining({
        terminalTabGroups: {},
        version: 3,
      }),
    );
  });
});
