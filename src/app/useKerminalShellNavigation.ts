// @author kongweiguang

import { useCallback, type Dispatch, type SetStateAction } from "react";
import type { MachineSidebarViewMode } from "../features/machine-sidebar/MachineSidebar.shared";
import type { MachineGroup, ToolId } from "../features/workspace/types";
import type { WorkspaceState } from "../features/workspace/workspaceStore";
import type { DockerContainerSummary } from "../lib/dockerApi";
import { shellQuote } from "./KerminalShell.contextWorkspaceShellHelpers";

interface UseKerminalShellNavigationOptions {
  activeTool: WorkspaceState["activeTool"];
  machineGroups: MachineGroup[];
  openDockerContainerTerminal: WorkspaceState["openDockerContainerTerminal"];
  openSftpTransferTab: WorkspaceState["openSftpTransferTab"];
  openSshCommandTerminal: WorkspaceState["openSshCommandTerminal"];
  selectMachine: WorkspaceState["selectMachine"];
  closeTool: (toolId: ToolId) => void;
  openTool: (toolId: ToolId) => void;
  setHostContainersHostId: Dispatch<SetStateAction<string | null>>;
  setHostContainersInitialContainerId: Dispatch<SetStateAction<string | undefined>>;
  setMachineSidebarView: Dispatch<SetStateAction<MachineSidebarViewMode>>;
}

/** 统一 Shell 的主机、SFTP 与容器侧栏导航，避免视图组合层决定跳转细节。 */
export function useKerminalShellNavigation({
  activeTool,
  machineGroups,
  openDockerContainerTerminal,
  openSftpTransferTab,
  openSshCommandTerminal,
  selectMachine,
  closeTool,
  openTool,
  setHostContainersHostId,
  setHostContainersInitialContainerId,
  setMachineSidebarView,
}: UseKerminalShellNavigationOptions) {
  const selectHostContainersHost = useCallback(
    (machineId: string) => {
      selectMachine(machineId);
      setHostContainersHostId(machineId);
      setHostContainersInitialContainerId(undefined);
    },
    [selectMachine, setHostContainersHostId, setHostContainersInitialContainerId],
  );

  const openSftpForMachine = useCallback(
    (machineId: string) => {
      selectMachine(machineId);
      openTool("sftp");
    },
    [openTool, selectMachine],
  );

  const openSftpTransferWorkbench = useCallback(
    (machineId?: string) => {
      openSftpTransferTab(machineId ? { rightHostId: machineId } : undefined);
      closeTool("sftp");
    },
    [closeTool, openSftpTransferTab],
  );

  const openHostContainersSidebar = useCallback(
    (machineId: string, initialContainerId?: string) => {
      selectMachine(machineId);
      setHostContainersHostId(machineId);
      setHostContainersInitialContainerId(initialContainerId);
      setMachineSidebarView("containers");
      if (activeTool === "containers") {
        closeTool("containers");
      }
    },
    [
      activeTool,
      selectMachine,
      closeTool,
      setHostContainersHostId,
      setHostContainersInitialContainerId,
      setMachineSidebarView,
    ],
  );

  const openContainerDetails = useCallback(
    (machineId: string) => {
      const machine = machineGroups
        .flatMap((group) => group.machines)
        .find((candidate) => candidate.id === machineId);
      if (
        !machine ||
        machine.kind !== "dockerContainer" ||
        !machine.parentMachineId ||
        !machine.containerId
      ) {
        return;
      }
      openHostContainersSidebar(machine.parentMachineId, machine.containerId);
    },
    [machineGroups, openHostContainersSidebar],
  );

  const enterHostContainer = useCallback(
    (container: DockerContainerSummary) => {
      openDockerContainerTerminal(container);
      if (activeTool) {
        closeTool(activeTool);
      }
    },
    [activeTool, closeTool, openDockerContainerTerminal],
  );

  const openHostContainerLogs = useCallback(
    (container: DockerContainerSummary) => {
      const runtimeBin = container.runtime === "podman" ? "podman" : "docker";
      openSshCommandTerminal(container.hostId, {
        remoteCommand: `${runtimeBin} logs -f --tail 200 ${shellQuote(container.id)}`,
        title: `${container.name} logs`,
      });
      if (activeTool) {
        closeTool(activeTool);
      }
      setHostContainersHostId(null);
      setHostContainersInitialContainerId(undefined);
    },
    [
      openSshCommandTerminal,
      activeTool,
      closeTool,
      setHostContainersHostId,
      setHostContainersInitialContainerId,
    ],
  );

  return {
    enterHostContainer,
    openContainerDetails,
    openHostContainerLogs,
    openHostContainersSidebar,
    openSftpForMachine,
    openSftpTransferWorkbench,
    selectHostContainersHost,
  };
}
