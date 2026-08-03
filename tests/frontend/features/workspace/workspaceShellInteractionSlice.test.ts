// @author kongweiguang

import { create } from "zustand";
import { describe, expect, it } from "vitest";
import { createWorkspaceShellInteractionSlice } from "../../../../src/features/workspace/workspaceShellInteractionSlice";
import type { WorkspaceShellInteractionSlice } from "../../../../src/features/workspace/workspaceStoreContract";

describe("workspaceShellInteractionSlice", () => {
  it("provides stable defaults and updates shell interaction drafts", () => {
    const store = createShellInteractionStore();

    expect(store.getState()).toMatchObject({
      activeTool: null,
      activeToolByTabId: {},
      broadcastDraft: "",
      machineSearch: "",
    });

    store.getState().setActiveTool("sftp");
    store.getState().setMachineSearch("prod");
    store.getState().setBroadcastDraft("uptime");

    expect(store.getState()).toMatchObject({
      activeTool: "sftp",
      activeToolByTabId: { "tab-test": "sftp" },
      broadcastDraft: "uptime",
      machineSearch: "prod",
    });
  });

  it("keeps the current tool when an unknown tool id is requested", () => {
    const store = createShellInteractionStore();
    store.getState().setActiveTool("sftp");

    store.getState().setActiveTool("unknown" as never);

    expect(store.getState().activeTool).toBe("sftp");
  });
});

function createShellInteractionStore() {
  type TestState = WorkspaceShellInteractionSlice & { activeTabId: string };
  return create<TestState>()((set, get, store) => ({
    activeTabId: "tab-test",
    ...createWorkspaceShellInteractionSlice(set, get, store),
  }));
}
