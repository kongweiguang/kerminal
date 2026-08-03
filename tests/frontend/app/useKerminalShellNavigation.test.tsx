// @author kongweiguang

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useKerminalShellNavigation } from "../../../src/app/useKerminalShellNavigation";
import type { MachineGroup } from "../../../src/features/workspace/types";
import { apiContainer } from "../support/workspace/workspaceStore.testSupport";

const machineGroups: MachineGroup[] = [
  {
    id: "remote-group",
    title: "远程主机",
    machines: [
      {
        containerId: apiContainer.id,
        containerName: apiContainer.name,
        description: "容器",
        id: "container-machine",
        kind: "dockerContainer",
        name: apiContainer.name,
        parentMachineId: apiContainer.hostId,
        runtime: apiContainer.runtime,
        status: "online",
        tags: ["container"],
      },
    ],
  },
];

describe("useKerminalShellNavigation", () => {
  it("opens SFTP tools with the selected machine and closes the workbench rail", () => {
    const options = createOptions();
    const { result } = renderHook(() => useKerminalShellNavigation(options));

    act(() => result.current.openSftpForMachine("host-1"));
    expect(options.selectMachine).toHaveBeenCalledWith("host-1");
    expect(options.setActiveTool).toHaveBeenCalledWith("sftp");

    act(() => result.current.openSftpTransferWorkbench("host-2"));
    expect(options.openSftpTransferTab).toHaveBeenCalledWith({
      rightHostId: "host-2",
    });
    expect(options.setActiveTool).toHaveBeenLastCalledWith(null);
  });

  it("routes a pinned container to its owning host and container detail", () => {
    const options = createOptions({ activeTool: "containers" });
    const { result } = renderHook(() => useKerminalShellNavigation(options));

    act(() => result.current.openContainerDetails("container-machine"));

    expect(options.selectMachine).toHaveBeenCalledWith(apiContainer.hostId);
    expect(options.setHostContainersHostId).toHaveBeenCalledWith(apiContainer.hostId);
    expect(options.setHostContainersInitialContainerId).toHaveBeenCalledWith(
      apiContainer.id,
    );
    expect(options.setMachineSidebarView).toHaveBeenCalledWith("containers");
    expect(options.setActiveTool).toHaveBeenCalledWith(null);
  });

  it("ignores a machine that is not a complete container binding", () => {
    const options = createOptions({ machineGroups: [] });
    const { result } = renderHook(() => useKerminalShellNavigation(options));

    act(() => result.current.openContainerDetails("missing"));

    expect(options.selectMachine).not.toHaveBeenCalled();
    expect(options.setMachineSidebarView).not.toHaveBeenCalled();
  });

  it("opens container logs through the host command terminal and clears sidebar state", () => {
    const options = createOptions();
    const { result } = renderHook(() => useKerminalShellNavigation(options));

    act(() =>
      result.current.openHostContainerLogs({
        ...apiContainer,
        id: "container with space",
        runtime: "podman",
      }),
    );

    expect(options.openSshCommandTerminal).toHaveBeenCalledWith(apiContainer.hostId, {
      remoteCommand: "podman logs -f --tail 200 'container with space'",
      title: `${apiContainer.name} logs`,
    });
    expect(options.setActiveTool).toHaveBeenCalledWith(null);
    expect(options.setHostContainersHostId).toHaveBeenCalledWith(null);
    expect(options.setHostContainersInitialContainerId).toHaveBeenCalledWith(undefined);
  });

  it("switches to a container tab before collapsing that new tab's right panel", () => {
    const options = createOptions();
    const { result } = renderHook(() => useKerminalShellNavigation(options));

    act(() => result.current.enterHostContainer(apiContainer));

    expect(options.openDockerContainerTerminal).toHaveBeenCalledWith(apiContainer);
    expect(options.setActiveTool).toHaveBeenCalledWith(null);
    expect(
      vi.mocked(options.openDockerContainerTerminal).mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(options.setActiveTool).mock.invocationCallOrder[0],
    );
  });
});

function createOptions(overrides: Record<string, unknown> = {}) {
  return {
    activeTool: null,
    machineGroups,
    openDockerContainerTerminal: vi.fn(),
    openSftpTransferTab: vi.fn(),
    openSshCommandTerminal: vi.fn(),
    selectMachine: vi.fn(),
    setActiveTool: vi.fn(),
    setHostContainersHostId: vi.fn(),
    setHostContainersInitialContainerId: vi.fn(),
    setMachineSidebarView: vi.fn(),
    ...overrides,
  } as Parameters<typeof useKerminalShellNavigation>[0];
}
