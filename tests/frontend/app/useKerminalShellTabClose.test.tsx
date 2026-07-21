// @author kongweiguang

import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useKerminalShellTabClose } from "../../../src/app/useKerminalShellTabClose";
import { registerExternalSftpTabCloseHandler } from "../../../src/features/sftp/externalSftpLaunchLifecycle";
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
const externalSftpTab: TerminalTab = {
  externalLaunchId: "launch-sftp",
  id: "tab-external-sftp",
  kind: "sftpTransfer",
  machineId: "external:launch-sftp",
  rightHostId: "external:launch-sftp",
  title: "临时堡垒机传输",
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
    const { result } = renderHook(() =>
      useKerminalShellTabClose({
        closeTerminalTab,
        confirmTerminalClose: false,
        terminalTabs: [terminalTab],
        workspaceFileDirtyState: {},
      }),
    );
    act(() => result.current.requestCloseTab(terminalTab.id));
    expect(closeTerminalTab).toHaveBeenCalledWith(terminalTab.id);
    expect(result.current.pendingTerminalTabCount).toBe(0);
  });

  it("removes an external SFTP tab while its cleanup is still pending", async () => {
    let resolveCleanup: (() => void) | undefined;
    const cleanup = new Promise<void>((resolve) => {
      resolveCleanup = resolve;
    });
    const unregister = registerExternalSftpTabCloseHandler(
      externalSftpTab.id,
      () => ({ canClose: true, cleanup }),
    );
    const closeTerminalTab = vi.fn();
    const removeSidebarMachine = vi.fn();
    const { result } = renderHook(() =>
      useKerminalShellTabClose({
        closeTerminalTab,
        confirmTerminalClose: false,
        removeSidebarMachine,
        terminalTabs: [externalSftpTab],
        workspaceFileDirtyState: {},
      }),
    );

    act(() => result.current.requestCloseTab(externalSftpTab.id));

    await waitFor(() =>
      expect(closeTerminalTab).toHaveBeenCalledWith(externalSftpTab.id),
    );
    expect(removeSidebarMachine).toHaveBeenCalledWith(externalSftpTab.machineId);
    resolveCleanup?.();
    unregister();
  });

  it("keeps an external SFTP tab when active-transfer confirmation is cancelled", async () => {
    const unregister = registerExternalSftpTabCloseHandler(
      externalSftpTab.id,
      () => ({ canClose: false }),
    );
    const closeTerminalTab = vi.fn();
    const removeSidebarMachine = vi.fn();
    const { result } = renderHook(() =>
      useKerminalShellTabClose({
        closeTerminalTab,
        confirmTerminalClose: false,
        removeSidebarMachine,
        terminalTabs: [externalSftpTab],
        workspaceFileDirtyState: {},
      }),
    );

    await act(async () => result.current.requestCloseTab(externalSftpTab.id));

    expect(closeTerminalTab).not.toHaveBeenCalled();
    expect(removeSidebarMachine).not.toHaveBeenCalled();
    unregister();
  });
});
