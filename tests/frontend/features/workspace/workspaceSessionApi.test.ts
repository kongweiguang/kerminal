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
      activeTabId: "",
      focusedPaneId: "",
      terminalTabs: [],
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
      expect.objectContaining({ version: 2 }),
    );
  });
});
