// @author kongweiguang

import type {
  Machine,
  MachineGroup,
  MachineKind,
  MachineStatus,
  TerminalSplitPlacement,
} from "../workspace/contracts/index";

const terminalSplitMachineKinds = [
  "local",
  "ssh",
  "telnet",
  "serial",
  "dockerContainer",
] as const satisfies readonly MachineKind[];

type TerminalSplitMachineKind = (typeof terminalSplitMachineKinds)[number];

export interface TerminalSplitPaneOptions {
  placement?: TerminalSplitPlacement;
  sourcePaneId?: string;
  targetMachineId?: string;
}

export interface SplitTargetOption {
  groupId: string;
  groupTitle: string;
  hostLabel: string;
  id: string;
  kind: TerminalSplitMachineKind;
  status: MachineStatus;
  subtitle: string;
  title: string;
}

export function isTerminalSplitMachineKind(
  kind: MachineKind,
): kind is TerminalSplitMachineKind {
  return terminalSplitMachineKinds.includes(kind as TerminalSplitMachineKind);
}

export function createSplitTargetOptions(
  machineGroups: MachineGroup[],
): SplitTargetOption[] {
  return machineGroups.flatMap((group) =>
    group.machines.flatMap((machine) => {
      if (!isTerminalSplitMachineKind(machine.kind)) {
        return [];
      }
      return [createSplitTargetOption(machine, group.id, group.title)];
    }),
  );
}

function createSplitTargetOption(
  machine: Machine,
  groupId: string,
  groupTitle: string,
): SplitTargetOption {
  const hostLabel = buildHostLabel(machine);
  const subtitleParts = [
    hostLabel,
    machine.status !== "online" ? machine.status : undefined,
    typeof machine.latencyMs === "number" ? `${machine.latencyMs}ms` : undefined,
  ].filter((part): part is string => Boolean(part));

  return {
    groupId,
    groupTitle,
    hostLabel,
    id: machine.id,
    kind: machine.kind as TerminalSplitMachineKind,
    status: machine.status,
    subtitle: subtitleParts.join(" · "),
    title: machine.name,
  };
}

function buildHostLabel(machine: Machine) {
  if (machine.kind === "local") {
    return machine.description || machine.shell || machine.id;
  }
  if (machine.kind === "dockerContainer") {
    return [
      machine.runtime,
      machine.containerName || machine.containerId,
      machine.parentMachineId,
    ]
      .filter((part): part is string => Boolean(part))
      .join(" · ");
  }
  const endpoint = [machine.host, machine.port ? String(machine.port) : undefined]
    .filter((part): part is string => Boolean(part))
    .join(":");
  return [machine.username, endpoint || machine.description]
    .filter((part): part is string => Boolean(part))
    .join("@");
}
