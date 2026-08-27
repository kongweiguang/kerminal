// @author kongweiguang

import { act, fireEvent, render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildWorkspaceSessionStableKey,
  buildWorkspaceSessionSnapshot,
  useWorkspaceSessionPersistence,
} from "../../../src/app/useWorkspaceSessionPersistence";
import { WORKSPACE_SESSION_SAVE_DELAY_MS } from "../../../src/app/KerminalShell.static.tsx";
import {
  createTerminalOutputHistoryBuffer,
  type TerminalOutputHistoryTimer,
} from "../../../src/features/terminal/terminalOutputHistoryBuffer";
import {
  type WorkspaceSessionSnapshot,
  type WorkspaceSessionLoadResult,
} from "../../../src/features/workspace/workspaceSession";
import {
  useWorkspaceStore,
} from "../../../src/features/workspace/workspaceStore";
import { resetWorkspaceStore } from "../support/workspace/workspaceStore.testSupport";
import type {
  Machine,
  MachineGroup,
  TerminalPane,
  TerminalTab,
} from "../../../src/features/workspace/types";

const workspaceSessionApiMocks = vi.hoisted(() => ({
  loadWorkspaceSessionFile: vi.fn(),
  saveWorkspaceSessionFile: vi.fn(),
}));

vi.mock(
  "../../../src/features/workspace/workspaceSessionApi",
  () => workspaceSessionApiMocks,
);

function createManualTimer() {
  const callbacks = new Map<
    ReturnType<typeof globalThis.setTimeout>,
    () => void
  >();
  let nextHandle = 1;
  const timer: TerminalOutputHistoryTimer = {
    clearTimeout: vi.fn((timerId) => {
      callbacks.delete(timerId);
    }),
    setTimeout: vi.fn((callback) => {
      const handle =
        nextHandle as unknown as ReturnType<typeof globalThis.setTimeout>;
      nextHandle += 1;
      callbacks.set(handle, callback);
      return handle;
    }),
  };

  return {
    pendingCount: () => callbacks.size,
    timer,
  };
}

function machine(overrides: Partial<Machine> & Pick<Machine, "id" | "kind">) {
  return {
    description: overrides.id,
    name: overrides.id,
    status: "offline",
    tags: [],
    ...overrides,
  } satisfies Machine;
}

function WorkspaceSessionPersistenceHost() {
  useWorkspaceSessionPersistence();
  return null;
}

/** 为持久化阻断场景提供可观察回调；实际 Shell 只需把通知转给现有提示层。 */
function WorkspaceSessionPersistenceNoticeHost({
  onPersistenceBlocked,
}: {
  onPersistenceBlocked: (message: string | null) => void;
}) {
  useWorkspaceSessionPersistence({ onPersistenceBlocked });
  return null;
}

async function renderWorkspaceSessionPersistenceHost() {
  const result = render(createElement(WorkspaceSessionPersistenceHost));
  await settleWorkspaceSessionPersistence();
  return result;
}

async function settleWorkspaceSessionPersistence() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function restorableWorkspaceSession(
  overrides: Partial<WorkspaceSessionSnapshot> = {},
): WorkspaceSessionSnapshot {
  const terminalPanes: TerminalPane[] = [
    {
      id: "pane-restored",
      lines: [],
      machineId: "machine-local-1",
      mode: "local",
      outputHistory: "restored output",
      prompt: ">",
      status: "online",
      title: "Restored PowerShell",
    },
  ];
  const terminalTabs: TerminalTab[] = [
    {
      id: "tab-restored",
      layout: { paneId: "pane-restored", type: "pane" },
      machineId: "machine-local-1",
      title: "Restored PowerShell",
    },
  ];

  return {
    activeTabId: "tab-restored",
    focusedPaneId: "pane-restored",
    removedSidebarMachineIds: [],
    selectedMachineId: "machine-local-1",
    sidebarMachines: [],
    terminalPanes,
    terminalTabGroupPreferences: {},
    terminalTabs,
    ...overrides,
  };
}

function lastSavedWorkspaceSession(): WorkspaceSessionSnapshot {
  const calls = workspaceSessionApiMocks.saveWorkspaceSessionFile.mock.calls;
  const latest = calls[calls.length - 1];
  if (!latest) {
    throw new Error("Expected a workspace session save.");
  }
  return latest[0] as WorkspaceSessionSnapshot;
}

describe("buildWorkspaceSessionSnapshot", () => {
  beforeEach(() => {
    workspaceSessionApiMocks.loadWorkspaceSessionFile.mockReset();
    workspaceSessionApiMocks.saveWorkspaceSessionFile.mockReset();
    workspaceSessionApiMocks.loadWorkspaceSessionFile.mockResolvedValue(null);
    workspaceSessionApiMocks.saveWorkspaceSessionFile.mockResolvedValue(
      undefined,
    );
    window.localStorage.clear();
    resetWorkspaceStore();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("builds a serializable workspace session from current shell state", () => {
    const localMachine = machine({
      id: "local-pwsh",
      kind: "local",
      profileId: "profile-pwsh",
    });
    const remoteMachine = machine({
      id: "host-prod",
      kind: "ssh",
      remoteGroupId: "remote-group",
    });
    const containerMachine = machine({
      id: "container-api",
      kind: "dockerContainer",
      parentMachineId: "host-prod",
    });
    const machineGroups: MachineGroup[] = [
      {
        id: "local",
        machines: [localMachine],
        title: "Local",
      },
      {
        id: "remote-group",
        machines: [remoteMachine, containerMachine],
        title: "Remote",
      },
    ];
    const terminalPanes: TerminalPane[] = [
      {
        id: "pane-1",
        lines: [],
        machineId: "local-pwsh",
        mode: "local",
        prompt: ">",
        status: "online",
        title: "PowerShell",
      },
    ];
    const terminalTabs: TerminalTab[] = [
      {
        id: "tab-1",
        layout: { paneId: "pane-1", type: "pane" },
        machineId: "local-pwsh",
        title: "PowerShell",
      },
    ];

    const snapshot = buildWorkspaceSessionSnapshot({
      activeTabId: "tab-1",
      focusedPaneId: "pane-1",
      machineGroups,
      removedSidebarMachineIds: ["local-hidden"],
      selectedMachineId: "local-pwsh",
      shellLayout: {
        bottomToolPanelHeight: 280,
        collapsedMachineGroupIds: ["remote-group"],
        leftPanelCollapsed: true,
        leftPanelWidth: 288,
        leftToolPanelWidth: 340,
        toolPanelWidth: 360,
      },
      terminalPanes,
      terminalTabGroupPreferences: {
        "local-pwsh": {
          color: "blue",
          title: "本地组",
        },
      },
      terminalTabs,
    });

    expect(snapshot).toMatchObject({
      activeTabId: "tab-1",
      focusedPaneId: "pane-1",
      removedSidebarMachineIds: ["local-hidden"],
      selectedMachineId: "local-pwsh",
      shellLayout: {
        bottomToolPanelHeight: 280,
        collapsedMachineGroupIds: ["remote-group"],
        leftPanelCollapsed: true,
        leftPanelWidth: 288,
        leftToolPanelWidth: 340,
        toolPanelWidth: 360,
      },
      terminalTabGroupPreferences: {
        "local-pwsh": {
          color: "blue",
          title: "本地组",
        },
      },
      terminalPanes,
      terminalTabs,
    });
    expect(snapshot.sidebarMachines).toEqual([
      { ...localMachine, remoteGroupId: "local" },
      { ...containerMachine, remoteGroupId: "remote-group" },
    ]);
  });

  it("keeps the stable key unchanged for volatile terminal pane fields", () => {
    const terminalPanes: TerminalPane[] = [
      {
        currentCwd: "C:/repo",
        id: "pane-1",
        latencyMs: 12,
        lines: ["old line"],
        machineId: "local-pwsh",
        mode: "local",
        outputHistory: "old output",
        prompt: ">",
        status: "online",
        title: "PowerShell",
      },
    ];
    const terminalTabs: TerminalTab[] = [
      {
        id: "tab-1",
        layout: { paneId: "pane-1", type: "pane" },
        machineId: "local-pwsh",
        title: "PowerShell",
      },
    ];
    const input = {
      activeTabId: "tab-1",
      focusedPaneId: "pane-1",
      machineGroups: [],
      removedSidebarMachineIds: [],
      selectedMachineId: "local-pwsh",
      terminalPanes,
      terminalTabGroupPreferences: {},
      terminalTabs,
    };

    expect(
      buildWorkspaceSessionStableKey({
        ...input,
        shellLayout: {
          collapsedMachineGroupIds: ["remote-group"],
          leftPanelWidth: 320,
        },
      }),
    ).not.toBe(buildWorkspaceSessionStableKey(input));
    expect(
      buildWorkspaceSessionStableKey({
        ...input,
        terminalPanes: [
          {
            ...terminalPanes[0],
            currentCwd: "C:/repo/src",
            latencyMs: 48,
            lines: ["new line"],
            outputHistory: "new output",
            status: "offline",
          },
        ],
      }),
    ).toBe(buildWorkspaceSessionStableKey(input));
    expect(
      buildWorkspaceSessionStableKey({
        ...input,
        terminalPanes: [
          {
            ...terminalPanes[0],
            title: "Renamed shell",
          },
        ],
      }),
    ).not.toBe(buildWorkspaceSessionStableKey(input));
  });

  it("loads workspace sessions from the file API", async () => {
    const session = restorableWorkspaceSession();
    workspaceSessionApiMocks.loadWorkspaceSessionFile.mockResolvedValue(session);

    await renderWorkspaceSessionPersistenceHost();

    expect(useWorkspaceStore.getState().activeTabId).toBe("tab-restored");
    expect(useWorkspaceStore.getState().focusedPaneId).toBe("pane-restored");
    expect(useWorkspaceStore.getState().terminalPanes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "pane-restored",
          outputHistory: "restored output",
        }),
      ]),
    );
  });

  it.each([
    {
      kind: "unsupported",
      message: "ignored detail",
      version: 4,
    },
    {
      kind: "invalid",
      message: "ignored detail",
    },
    {
      kind: "transport-failure",
      message: "ignored detail",
    },
  ] satisfies WorkspaceSessionLoadResult[])(
    "blocks writes after a $kind session load result",
    async (loadResult) => {
      const onPersistenceBlocked = vi.fn();
      workspaceSessionApiMocks.loadWorkspaceSessionFile.mockResolvedValue(
        loadResult,
      );

      const { unmount } = render(
        createElement(WorkspaceSessionPersistenceNoticeHost, {
          onPersistenceBlocked,
        }),
      );
      await settleWorkspaceSessionPersistence();

      act(() => {
        useWorkspaceStore.getState().addTerminalTab();
      });
      fireEvent(window, new Event("pagehide"));
      await settleWorkspaceSessionPersistence();

      expect(onPersistenceBlocked).toHaveBeenCalledWith(
        expect.stringContaining("原文件未覆盖"),
      );
      expect(workspaceSessionApiMocks.saveWorkspaceSessionFile).not.toHaveBeenCalled();
      unmount();
    },
  );

  it("stops retrying and reports a save failure", async () => {
    const onPersistenceBlocked = vi.fn();
    workspaceSessionApiMocks.saveWorkspaceSessionFile.mockRejectedValueOnce(
      new Error("write failure"),
    );
    const { unmount } = render(
      createElement(WorkspaceSessionPersistenceNoticeHost, {
        onPersistenceBlocked,
      }),
    );
    await settleWorkspaceSessionPersistence();

    act(() => {
      useWorkspaceStore.getState().addTerminalTab();
    });
    await settleWorkspaceSessionPersistence();
    expect(onPersistenceBlocked).toHaveBeenCalledWith(
      expect.stringContaining("已停止继续写入"),
    );

    workspaceSessionApiMocks.saveWorkspaceSessionFile.mockClear();
    fireEvent(window, new Event("pagehide"));
    await settleWorkspaceSessionPersistence();
    expect(workspaceSessionApiMocks.saveWorkspaceSessionFile).not.toHaveBeenCalled();
    unmount();
  });

  it("does not save an empty startup session when no file session is loaded", async () => {
    const { unmount } = await renderWorkspaceSessionPersistenceHost();

    fireEvent(window, new Event("pagehide"));
    unmount();
    await settleWorkspaceSessionPersistence();

    expect(workspaceSessionApiMocks.saveWorkspaceSessionFile).not.toHaveBeenCalled();
  });

  it("does not replace a loaded terminal session with an empty snapshot if restore drops every pane", async () => {
    workspaceSessionApiMocks.loadWorkspaceSessionFile.mockResolvedValue(
      restorableWorkspaceSession({
        focusedPaneId: "pane-missing",
        terminalPanes: [],
        terminalTabs: [
          {
            id: "tab-restored",
            layout: { paneId: "pane-missing", type: "pane" },
            machineId: "machine-local-1",
            title: "Restored PowerShell",
          } as TerminalTab,
        ],
      }),
    );

    await renderWorkspaceSessionPersistenceHost();
    fireEvent(window, new Event("pagehide"));
    await settleWorkspaceSessionPersistence();

    expect(useWorkspaceStore.getState().terminalTabs).toEqual([]);
    expect(workspaceSessionApiMocks.saveWorkspaceSessionFile).not.toHaveBeenCalled();
  });

  it("restores shell layout from the file API", async () => {
    const shellLayout = {
      collapsedMachineGroupIds: ["local", "remote-group"],
      leftPanelCollapsed: true,
      leftPanelWidth: 312,
      toolPanelWidth: 420,
    };
    const onShellLayoutRestored = vi.fn();
    workspaceSessionApiMocks.loadWorkspaceSessionFile.mockResolvedValue(
      restorableWorkspaceSession({ shellLayout }),
    );

    function ShellLayoutPersistenceHost() {
      useWorkspaceSessionPersistence({
        onShellLayoutRestored,
        shellLayout: {
          collapsedMachineGroupIds: [],
          leftPanelCollapsed: false,
          leftPanelWidth: 240,
          toolPanelWidth: 300,
        },
      });
      return null;
    }

    render(createElement(ShellLayoutPersistenceHost));
    await settleWorkspaceSessionPersistence();

    expect(onShellLayoutRestored).toHaveBeenCalledWith(shellLayout);
    expect(lastSavedWorkspaceSession().shellLayout).toEqual(shellLayout);
  });

  it("saves workspace sessions through the file API when available", async () => {
    workspaceSessionApiMocks.loadWorkspaceSessionFile.mockResolvedValue(null);
    workspaceSessionApiMocks.saveWorkspaceSessionFile.mockResolvedValue(
      undefined,
    );

    await renderWorkspaceSessionPersistenceHost();

    act(() => {
      useWorkspaceStore.getState().addTerminalTab();
    });
    const paneId = useWorkspaceStore.getState().terminalPanes[0]?.id;
    if (!paneId) {
      throw new Error("Expected a local terminal pane to be created.");
    }
    act(() => {
      useWorkspaceStore.getState().updatePaneOutputHistory(paneId, "file save");
    });
    fireEvent(window, new Event("pagehide"));
    await settleWorkspaceSessionPersistence();

    expect(workspaceSessionApiMocks.saveWorkspaceSessionFile).toHaveBeenCalledWith(
      expect.objectContaining({
        terminalPanes: expect.arrayContaining([
          expect.objectContaining({
            id: paneId,
            outputHistory: "file save",
          }),
        ]),
      }),
    );
  });

  it("allows saving an empty session after the user closes the last restored tab", async () => {
    await renderWorkspaceSessionPersistenceHost();

    act(() => {
      useWorkspaceStore.getState().addTerminalTab();
    });
    await settleWorkspaceSessionPersistence();
    workspaceSessionApiMocks.saveWorkspaceSessionFile.mockClear();

    act(() => {
      useWorkspaceStore.getState().closeTerminalTab("tab-local-1");
    });
    await settleWorkspaceSessionPersistence();

    expect(workspaceSessionApiMocks.saveWorkspaceSessionFile).toHaveBeenCalledWith(
      expect.objectContaining({
        activeTabId: "",
        focusedPaneId: "",
        selectedMachineId: "",
        terminalPanes: [],
        terminalTabs: [],
      }),
    );
  });

  it("saves split terminal layouts immediately as stable session changes", async () => {
    await renderWorkspaceSessionPersistenceHost();

    act(() => {
      useWorkspaceStore.getState().addTerminalTab({ title: "本地 PowerShell" });
    });
    await settleWorkspaceSessionPersistence();
    workspaceSessionApiMocks.saveWorkspaceSessionFile.mockClear();

    act(() => {
      useWorkspaceStore.getState().splitFocusedPane("horizontal");
    });
    await settleWorkspaceSessionPersistence();

    expect(
      workspaceSessionApiMocks.saveWorkspaceSessionFile,
    ).toHaveBeenCalledTimes(1);
    const savedSession = lastSavedWorkspaceSession();
    const savedTab = savedSession.terminalTabs.find(
      (tab) => tab.id === savedSession.activeTabId,
    );
    expect(savedSession.terminalPanes.map((pane) => pane.id)).toEqual([
      "pane-local-1",
      "pane-local-2",
    ]);
    expect(savedTab).toMatchObject({
      layout: {
        direction: "horizontal",
        type: "split",
      },
    });
  });

  it("saves split terminal layout sizes immediately as stable session changes", async () => {
    await renderWorkspaceSessionPersistenceHost();

    act(() => {
      useWorkspaceStore.getState().addTerminalTab({ title: "本地 PowerShell" });
      useWorkspaceStore.getState().splitFocusedPane("horizontal");
    });
    await settleWorkspaceSessionPersistence();
    workspaceSessionApiMocks.saveWorkspaceSessionFile.mockClear();

    act(() => {
      useWorkspaceStore.getState().updateTerminalSplitLayoutSizes("split-1", {
        "pane-local-1": 35,
        "pane-local-2": 65,
      });
    });
    await settleWorkspaceSessionPersistence();

    expect(
      workspaceSessionApiMocks.saveWorkspaceSessionFile,
    ).toHaveBeenCalledTimes(1);
    const savedSession = lastSavedWorkspaceSession();
    const savedTab = savedSession.terminalTabs.find(
      (tab) => tab.id === savedSession.activeTabId,
    );
    expect(savedTab).toMatchObject({
      layout: {
        sizes: {
          "pane-local-1": 35,
          "pane-local-2": 65,
        },
      },
    });
  });

  it("flushes the latest pane output history from the workspace store", async () => {
    await renderWorkspaceSessionPersistenceHost();

    act(() => {
      useWorkspaceStore.getState().addTerminalTab();
    });
    const paneId = useWorkspaceStore.getState().terminalPanes[0]?.id;
    if (!paneId) {
      throw new Error("Expected a local terminal pane to be created.");
    }
    expect(paneId).toBe("pane-local-1");

    act(() => {
      useWorkspaceStore
        .getState()
        .updateTerminalTabGroupPreference("machine-local-1", {
          color: "pink",
          title: "工作组",
        });
      useWorkspaceStore
        .getState()
        .updatePaneOutputHistory(paneId, "latest terminal output");
    });
    fireEvent(window, new Event("pagehide"));
    await settleWorkspaceSessionPersistence();

    const savedSession = lastSavedWorkspaceSession();
    expect(savedSession.terminalPanes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: paneId,
          outputHistory: "latest terminal output",
        }),
      ]),
    );
    expect(savedSession.terminalTabGroupPreferences).toEqual({
      "machine-local-1": {
        color: "pink",
        title: "工作组",
      },
    });
  });

  it("debounces volatile-only session writes and saves the latest output", async () => {
    vi.useFakeTimers();
    await renderWorkspaceSessionPersistenceHost();

    act(() => {
      useWorkspaceStore.getState().addTerminalTab();
    });
    const paneId = useWorkspaceStore.getState().terminalPanes[0]?.id;
    if (!paneId) {
      throw new Error("Expected a local terminal pane to be created.");
    }
    workspaceSessionApiMocks.saveWorkspaceSessionFile.mockClear();

    act(() => {
      useWorkspaceStore.getState().updatePaneOutputHistory(paneId, "chunk 1");
      useWorkspaceStore.getState().updatePaneOutputHistory(paneId, "chunk 2");
      useWorkspaceStore.getState().updatePaneOutputHistory(paneId, "chunk 3");
    });

    expect(workspaceSessionApiMocks.saveWorkspaceSessionFile).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(WORKSPACE_SESSION_SAVE_DELAY_MS - 1);
    });
    expect(workspaceSessionApiMocks.saveWorkspaceSessionFile).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    await settleWorkspaceSessionPersistence();

    expect(workspaceSessionApiMocks.saveWorkspaceSessionFile).toHaveBeenCalledTimes(1);
    const savedSession = lastSavedWorkspaceSession();
    expect(savedSession.terminalPanes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: paneId,
          outputHistory: "chunk 3",
        }),
      ]),
    );
  });

  it("flushes pending terminal output buffers before pagehide saves", async () => {
    await renderWorkspaceSessionPersistenceHost();

    act(() => {
      useWorkspaceStore.getState().addTerminalTab();
    });
    const paneId = useWorkspaceStore.getState().terminalPanes[0]?.id;
    if (!paneId) {
      throw new Error("Expected a local terminal pane to be created.");
    }

    const manual = createManualTimer();
    const buffer = createTerminalOutputHistoryBuffer({
      onOutputHistoryChangeRef: {
        current: (outputHistory) => {
          useWorkspaceStore
            .getState()
            .updatePaneOutputHistory(paneId, outputHistory);
        },
      },
      outputHistoryRef: { current: undefined },
      timer: manual.timer,
    });
    buffer.append("pending terminal output");

    expect(manual.pendingCount()).toBe(1);

    workspaceSessionApiMocks.saveWorkspaceSessionFile.mockClear();
    fireEvent(window, new Event("pagehide"));
    await settleWorkspaceSessionPersistence();

    const savedSession = lastSavedWorkspaceSession();
    expect(savedSession.terminalPanes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: paneId,
          outputHistory: "pending terminal output",
        }),
      ]),
    );
    expect(manual.pendingCount()).toBe(0);

    buffer.dispose();
  });

  it("flushes pending terminal output buffers before unmount saves", async () => {
    const { unmount } = await renderWorkspaceSessionPersistenceHost();

    act(() => {
      useWorkspaceStore.getState().addTerminalTab();
    });
    const paneId = useWorkspaceStore.getState().terminalPanes[0]?.id;
    if (!paneId) {
      throw new Error("Expected a local terminal pane to be created.");
    }

    const manual = createManualTimer();
    const buffer = createTerminalOutputHistoryBuffer({
      onOutputHistoryChangeRef: {
        current: (outputHistory) => {
          useWorkspaceStore
            .getState()
            .updatePaneOutputHistory(paneId, outputHistory);
        },
      },
      outputHistoryRef: { current: undefined },
      timer: manual.timer,
    });
    buffer.append("pending terminal output before unmount");

    expect(manual.pendingCount()).toBe(1);

    workspaceSessionApiMocks.saveWorkspaceSessionFile.mockClear();
    unmount();
    await settleWorkspaceSessionPersistence();

    const savedSession = lastSavedWorkspaceSession();
    expect(savedSession.terminalPanes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: paneId,
          outputHistory: "pending terminal output before unmount",
        }),
      ]),
    );
    expect(manual.pendingCount()).toBe(0);

    buffer.dispose();
  });
});
