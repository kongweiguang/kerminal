// @author kongweiguang
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useKerminalShellTabClose } from "../../../src/app/useKerminalShellTabClose";
import type { TerminalTab } from "../../../src/features/workspace/types";

const terminalTab: TerminalTab = {
  id: "tab-terminal",
  layout: { paneId: "pane-terminal", type: "pane" },
  machineId: "machine-local",
  title: "终端",
};
const fileTab: TerminalTab = {
  access: "editable",
  id: "tab-file",
  kind: "workspaceFile",
  machineId: "host-1",
  path: "/srv/app.toml",
  source: "sftp",
  target: { hostId: "host-1", kind: "ssh" },
  title: "app.toml",
};

describe("useKerminalShellTabClose", () => {
  it("requires dirty-file confirmation before closing a workspace file", () => {
    const closeTerminalTab = vi.fn();
    const { result } = renderHook(() =>
      useKerminalShellTabClose({
        closeTerminalTab,
        confirmTerminalClose: true,
        terminalTabs: [terminalTab, fileTab],
        workspaceFileDirtyState: { [fileTab.id]: true },
      }),
    );

    act(() => result.current.requestCloseTab(fileTab.id));
    expect(result.current.pendingDirtyFileTabCount).toBe(1);
    expect(result.current.dirtyFileTabCount).toBe(1);
    expect(closeTerminalTab).not.toHaveBeenCalled();

    act(() => result.current.confirmDirtyFileTabs());
    expect(closeTerminalTab).toHaveBeenCalledWith(fileTab.id);
    expect(result.current.pendingDirtyFileTabCount).toBe(0);
  });

  it("requires terminal confirmation and closes after acceptance", () => {
    const closeTerminalTab = vi.fn();
    const { result } = renderHook(() =>
      useKerminalShellTabClose({
        closeTerminalTab,
        confirmTerminalClose: true,
        terminalTabs: [terminalTab],
        workspaceFileDirtyState: {},
      }),
    );

    act(() => result.current.requestCloseTab(terminalTab.id));
    expect(result.current.pendingTerminalTabCount).toBe(1);
    act(() => result.current.confirmTerminalTabs());
    expect(closeTerminalTab).toHaveBeenCalledWith(terminalTab.id);
  });

  it("closes immediately when terminal confirmation is disabled", () => {
    const closeTerminalTab = vi.fn();
    const onTabsClosed = vi.fn();
    const { result } = renderHook(() =>
      useKerminalShellTabClose({
        closeTerminalTab,
        confirmTerminalClose: false,
        onTabsClosed,
        terminalTabs: [terminalTab],
        workspaceFileDirtyState: {},
      }),
    );
    act(() => result.current.requestCloseTab(terminalTab.id));
    expect(closeTerminalTab).toHaveBeenCalledWith(terminalTab.id);
    expect(onTabsClosed).toHaveBeenCalledWith([terminalTab.id]);
    expect(result.current.pendingTerminalTabCount).toBe(0);
  });

  it("notifies the lifecycle owner only after confirmed tabs close", () => {
    const closeTerminalTab = vi.fn();
    const onTabsClosed = vi.fn();
    const { result } = renderHook(() =>
      useKerminalShellTabClose({
        closeTerminalTab,
        confirmTerminalClose: true,
        onTabsClosed,
        terminalTabs: [terminalTab],
        workspaceFileDirtyState: {},
      }),
    );

    act(() => result.current.requestCloseTab(terminalTab.id));
    expect(onTabsClosed).not.toHaveBeenCalled();

    act(() => result.current.confirmTerminalTabs());
    expect(onTabsClosed).toHaveBeenCalledTimes(1);
    expect(onTabsClosed).toHaveBeenCalledWith([terminalTab.id]);
  });
});
