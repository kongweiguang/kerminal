// @author kongweiguang

import { beforeEach, describe, expect, it } from "vitest";
import type { ExternalSshLaunchResolvedRequest } from "../../../../src/features/external-launch/externalSshLaunchModel";
import {
  useWorkspaceStore,
} from "../../../../src/features/workspace/workspaceStore";
import { resetWorkspaceStore } from "../../support/workspace/workspaceStore.testSupport";

describe("workspaceStore external SSH launch", () => {
  beforeEach(() => {
    resetWorkspaceStore();
  });

  it("opens a temporary external SSH machine and terminal tab", () => {
    useWorkspaceStore.getState().openExternalSshLaunch(
      createResolvedLaunch({
        remoteCommand: "tail -f /var/log/app.log",
      }),
    );

    const state = useWorkspaceStore.getState();
    const machine = state.machineGroups
      .flatMap((group) => group.machines)
      .find((candidate) => candidate.id === "external:launch-1");
    const pane = state.terminalPanes[0];

    expect(machine).toMatchObject({
      authType: "password",
      description: "deploy@example.internal:2202 · PuTTY",
      host: "example.internal",
      kind: "ssh",
      name: "deploy@example.internal",
      port: 2202,
      target: { hostId: "external:launch-1", kind: "ssh" },
      username: "deploy",
    });
    expect(pane).toMatchObject({
      machineId: "external:launch-1",
      mode: "ssh",
      remoteCommand: "tail -f /var/log/app.log",
      remoteHostId: "external:launch-1",
      target: { hostId: "external:launch-1", kind: "ssh" },
      title: "deploy@example.internal",
    });
    expect(state.terminalTabs[0]).toMatchObject({
      machineId: "external:launch-1",
      title: "deploy@example.internal",
    });
    expect(state.selectedMachineId).toBe("external:launch-1");
  });

  it("opens the SFTP transfer workbench for the external target", () => {
    useWorkspaceStore.getState().openExternalSshLaunch(
      createResolvedLaunch({
        displayName: "Jump host file view",
        openSftp: true,
      }),
    );

    const state = useWorkspaceStore.getState();
    expect(state.activeTool).toBeNull();
    expect(state.terminalPanes[0]?.title).toBe("Jump host file view");
    expect(state.terminalTabs).toHaveLength(2);
    expect(state.terminalTabs[1]).toMatchObject({
      id: state.activeTabId,
      kind: "sftpTransfer",
      machineId: "external:launch-1",
      rightHostId: "external:launch-1",
      title: "Jump host file view 传输",
    });
  });

  it("removes only the requested temporary external SSH machine", () => {
    useWorkspaceStore.getState().openExternalSshLaunch(
      createResolvedLaunch({
        displayName: "Jump host one",
        id: "launch-1",
      }),
    );
    useWorkspaceStore.getState().openExternalSshLaunch(
      createResolvedLaunch({
        displayName: "Jump host two",
        id: "launch-2",
      }),
    );

    useWorkspaceStore.getState().removeSidebarMachine("external:launch-1");

    const state = useWorkspaceStore.getState();
    const machineIds = state.machineGroups.flatMap((group) =>
      group.machines.map((machine) => machine.id),
    );
    expect(machineIds).not.toContain("external:launch-1");
    expect(machineIds).toContain("external:launch-2");
    expect(state.removedSidebarMachineIds).toEqual([]);
    expect(state.selectedMachineId).toBe("external:launch-2");
  });
});

function createResolvedLaunch(
  overrides: {
    displayName?: string;
    id?: string;
    openSftp?: boolean;
    remoteCommand?: string;
  } = {},
): ExternalSshLaunchResolvedRequest {
  return {
    auth: {
      agent: false,
      hasKeyPassphrase: false,
      hasPassword: true,
      passwordFilePresent: false,
    },
    diagnostics: {
      argvRedacted: ["putty.exe", "-ssh", "deploy@example.internal"],
      parser: "putty",
      rawHash: "abc123",
      warnings: [],
    },
    id: overrides.id ?? "launch-1",
    options: {
      displayName: overrides.displayName,
      openSftp: overrides.openSftp ?? false,
      remoteCommand: overrides.remoteCommand,
    },
    receivedAt: "1760000000",
    source: {
      entrypoint: "single-instance",
      tool: "putty",
    },
    target: {
      host: "example.internal",
      port: 2202,
      route: [],
      username: "deploy",
    },
  };
}
