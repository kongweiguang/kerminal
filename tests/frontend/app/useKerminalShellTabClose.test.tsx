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
const externalTerminalTab: TerminalTab = {
  id: "tab-external-terminal",
  layout: { paneId: "pane-external-terminal", type: "pane" },
  machineId: "external:launch-terminal",
  title: "临时堡垒机终端",
};
const externalTerminalTabPeer: TerminalTab = {
  id: "tab-external-terminal-peer",
  layout: { paneId: "pane-external-terminal-peer", type: "pane" },
  machineId: externalTerminalTab.machineId,
  title: "临时堡垒机终端（二）",
};
const externalTerminalTabOwner: TerminalTab = {
  id: "tab-external-terminal-owner",
  layout: { paneId: "pane-external-terminal-owner", type: "pane" },
  machineId: externalTerminalTab.machineId,
  title: "临时堡垒机终端（保留）",
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

  it("does not confirm again when the workspace already confirmed the tab close", () => {
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

    act(() => result.current.closeConfirmedTab(terminalTab.id));

    expect(closeTerminalTab).toHaveBeenCalledWith(terminalTab.id);
    expect(onTabsClosed).toHaveBeenCalledWith([terminalTab.id]);
    expect(result.current.pendingTerminalTabCount).toBe(0);
  });

  it("closes a confirmed batch and releases a shared external launch once", async () => {
    const closeExternalLaunch = vi.fn().mockResolvedValue(1);
    const closeTerminalTab = vi.fn();
    const onTabsClosed = vi.fn();
    const removeSidebarMachine = vi.fn();
    const { result } = renderHook(() =>
      useKerminalShellTabClose({
        closeExternalLaunch,
        closeTerminalTab,
        confirmTerminalClose: true,
        onTabsClosed,
        removeSidebarMachine,
        terminalTabs: [externalTerminalTab, externalTerminalTabPeer],
        workspaceFileDirtyState: {},
      }),
    );

    act(() =>
      result.current.closeConfirmedTabs([
        externalTerminalTab.id,
        externalTerminalTabPeer.id,
      ]),
    );

    expect(closeTerminalTab).toHaveBeenNthCalledWith(
      1,
      externalTerminalTab.id,
    );
    expect(closeTerminalTab).toHaveBeenNthCalledWith(
      2,
      externalTerminalTabPeer.id,
    );
    expect(onTabsClosed).toHaveBeenCalledWith([
      externalTerminalTab.id,
      externalTerminalTabPeer.id,
    ]);
    expect(removeSidebarMachine).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(closeExternalLaunch).toHaveBeenCalledTimes(1),
    );
  });

  it("keeps a shared external launch while a non-closing owner remains", async () => {
    const closeExternalLaunch = vi.fn().mockResolvedValue(1);
    const closeTerminalTab = vi.fn();
    const onTabsClosed = vi.fn();
    const removeSidebarMachine = vi.fn();
    const { result } = renderHook(() =>
      useKerminalShellTabClose({
        closeExternalLaunch,
        closeTerminalTab,
        confirmTerminalClose: true,
        onTabsClosed,
        removeSidebarMachine,
        terminalTabs: [
          externalTerminalTab,
          externalTerminalTabPeer,
          externalTerminalTabOwner,
        ],
        workspaceFileDirtyState: {},
      }),
    );

    act(() =>
      result.current.closeConfirmedTabs([
        externalTerminalTab.id,
        externalTerminalTabPeer.id,
      ]),
    );

    await waitFor(() =>
      expect(onTabsClosed).toHaveBeenCalledWith([
        externalTerminalTab.id,
        externalTerminalTabPeer.id,
      ]),
    );
    expect(closeExternalLaunch).not.toHaveBeenCalled();
    expect(removeSidebarMachine).not.toHaveBeenCalled();
  });

  it("ignores duplicate and stale IDs and reports only tabs that actually closed", () => {
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

    act(() =>
      result.current.closeConfirmedTabs([
        terminalTab.id,
        terminalTab.id,
        "tab-does-not-exist",
      ]),
    );

    expect(closeTerminalTab).toHaveBeenCalledTimes(1);
    expect(closeTerminalTab).toHaveBeenCalledWith(terminalTab.id);
    expect(onTabsClosed).toHaveBeenCalledTimes(1);
    expect(onTabsClosed).toHaveBeenCalledWith([terminalTab.id]);
  });

  it("does not release an external owner when SFTP cleanup declines part of a batch", async () => {
    const blockedSftpTab: TerminalTab = {
      externalLaunchId: "launch-terminal",
      id: "tab-blocked-sftp",
      kind: "sftpTransfer",
      machineId: externalTerminalTab.machineId,
      rightHostId: externalTerminalTab.machineId,
      title: "仍在传输",
    };
    const unregister = registerExternalSftpTabCloseHandler(
      blockedSftpTab.id,
      () => ({ canClose: false }),
    );
    const closeExternalLaunch = vi.fn().mockResolvedValue(1);
    const closeTerminalTab = vi.fn();
    const onTabsClosed = vi.fn();
    const removeSidebarMachine = vi.fn();
    const { result } = renderHook(() =>
      useKerminalShellTabClose({
        closeExternalLaunch,
        closeTerminalTab,
        confirmTerminalClose: true,
        onTabsClosed,
        removeSidebarMachine,
        terminalTabs: [blockedSftpTab, externalTerminalTab],
        workspaceFileDirtyState: {},
      }),
    );

    act(() =>
      result.current.closeConfirmedTabs([
        blockedSftpTab.id,
        externalTerminalTab.id,
      ]),
    );

    await waitFor(() =>
      expect(onTabsClosed).toHaveBeenCalledWith([externalTerminalTab.id]),
    );
    expect(closeTerminalTab).toHaveBeenCalledTimes(1);
    expect(closeTerminalTab).toHaveBeenCalledWith(externalTerminalTab.id);
    expect(closeExternalLaunch).not.toHaveBeenCalled();
    expect(removeSidebarMachine).not.toHaveBeenCalled();
    unregister();
  });

  it("keeps a shared launch when only its SFTP tab closes", async () => {
    const sharedSftpTab: TerminalTab = {
      ...externalSftpTab,
      externalLaunchId: "launch-terminal",
      machineId: externalTerminalTab.machineId,
    };
    const unregister = registerExternalSftpTabCloseHandler(
      sharedSftpTab.id,
      () => ({ canClose: true, cleanup: Promise.resolve() }),
    );
    const closeExternalLaunch = vi.fn().mockResolvedValue(1);
    const closeTerminalTab = vi.fn();
    const removeSidebarMachine = vi.fn();
    const { result } = renderHook(() =>
      useKerminalShellTabClose({
        closeExternalLaunch,
        closeTerminalTab,
        confirmTerminalClose: false,
        removeSidebarMachine,
        terminalTabs: [sharedSftpTab, externalTerminalTab],
        workspaceFileDirtyState: {},
      }),
    );

    act(() => result.current.closeConfirmedTabs([sharedSftpTab.id]));
    await waitFor(() =>
      expect(closeTerminalTab).toHaveBeenCalledWith(sharedSftpTab.id),
    );
    expect(closeExternalLaunch).not.toHaveBeenCalled();
    expect(removeSidebarMachine).not.toHaveBeenCalled();
    unregister();
  });

  it("releases a mixed SSH and SFTP external launch once after both close", async () => {
    const sharedSftpTab: TerminalTab = {
      ...externalSftpTab,
      externalLaunchId: "launch-terminal",
      machineId: externalTerminalTab.machineId,
    };
    const unregister = registerExternalSftpTabCloseHandler(
      sharedSftpTab.id,
      () => ({ canClose: true, cleanup: Promise.resolve() }),
    );
    const closeExternalLaunch = vi.fn().mockResolvedValue(1);
    const closeTerminalTab = vi.fn();
    const removeSidebarMachine = vi.fn();
    const { result } = renderHook(() =>
      useKerminalShellTabClose({
        closeExternalLaunch,
        closeTerminalTab,
        confirmTerminalClose: false,
        removeSidebarMachine,
        terminalTabs: [sharedSftpTab, externalTerminalTab],
        workspaceFileDirtyState: {},
      }),
    );

    act(() =>
      result.current.closeConfirmedTabs([
        sharedSftpTab.id,
        externalTerminalTab.id,
      ]),
    );
    await waitFor(() => expect(closeExternalLaunch).toHaveBeenCalledTimes(1));
    expect(removeSidebarMachine).toHaveBeenCalledTimes(1);
    unregister();
  });

  it("releases an external SSH launch only when its terminal tab explicitly closes", async () => {
    const closeExternalLaunch = vi.fn().mockResolvedValue(1);
    const closeTerminalTab = vi.fn();
    const removeSidebarMachine = vi.fn();
    const { result } = renderHook(() =>
      useKerminalShellTabClose({
        closeExternalLaunch,
        closeTerminalTab,
        confirmTerminalClose: false,
        removeSidebarMachine,
        terminalTabs: [externalTerminalTab],
        workspaceFileDirtyState: {},
      }),
    );

    act(() => result.current.requestCloseTab(externalTerminalTab.id));

    expect(closeTerminalTab).toHaveBeenCalledWith(externalTerminalTab.id);
    expect(removeSidebarMachine).toHaveBeenCalledWith(
      externalTerminalTab.machineId,
    );
    await waitFor(() =>
      expect(closeExternalLaunch).toHaveBeenCalledWith("launch-terminal"),
    );
  });

  it("removes an external SFTP tab only after its cleanup succeeds", async () => {
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

    expect(closeTerminalTab).not.toHaveBeenCalled();
    resolveCleanup?.();
    await waitFor(() =>
      expect(closeTerminalTab).toHaveBeenCalledWith(externalSftpTab.id),
    );
    expect(removeSidebarMachine).toHaveBeenCalledWith(externalSftpTab.machineId);
    unregister();
  });

  it("keeps only the external SFTP tab whose cleanup fails", async () => {
    const failedSftpTab: TerminalTab = {
      ...externalSftpTab,
      id: "tab-external-sftp-failed",
    };
    const successfulSftpTab: TerminalTab = {
      ...externalSftpTab,
      id: "tab-external-sftp-successful",
      machineId: "external:launch-sftp-successful",
    };
    const unregisterFailed = registerExternalSftpTabCloseHandler(
      failedSftpTab.id,
      () => ({ canClose: true, cleanup: Promise.reject(new Error("cleanup failed")) }),
    );
    const unregisterSuccessful = registerExternalSftpTabCloseHandler(
      successfulSftpTab.id,
      () => ({ canClose: true, cleanup: Promise.resolve() }),
    );
    const closeTerminalTab = vi.fn();
    const onTabsClosed = vi.fn();
    const { result } = renderHook(() =>
      useKerminalShellTabClose({
        closeTerminalTab,
        confirmTerminalClose: false,
        onTabsClosed,
        terminalTabs: [failedSftpTab, successfulSftpTab],
        workspaceFileDirtyState: {},
      }),
    );

    act(() =>
      result.current.closeConfirmedTabs([
        failedSftpTab.id,
        successfulSftpTab.id,
      ]),
    );

    await waitFor(() =>
      expect(onTabsClosed).toHaveBeenCalledWith([successfulSftpTab.id]),
    );
    expect(closeTerminalTab).toHaveBeenCalledTimes(1);
    expect(closeTerminalTab).toHaveBeenCalledWith(successfulSftpTab.id);
    unregisterFailed();
    unregisterSuccessful();
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
