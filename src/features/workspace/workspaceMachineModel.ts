// @author kongweiguang

import {
  browserPreviewProfiles,
  type TerminalProfile,
} from "../../lib/profileApi";
import type { DockerContainerSummary } from "../../lib/dockerApi";
import {
  dockerContainerTarget,
  localTarget,
  serialTarget,
  sshTarget,
  targetStableId,
  telnetTarget,
  type ContainerRuntime,
} from "../../lib/targetModel";
import {
  UNGROUPED_REMOTE_HOST_GROUP_ID,
  type RemoteHostGroupWithHosts,
} from "../../lib/remoteHostApi";
import type { Machine, MachineGroup } from "./types";
import type { WorkspaceSessionSnapshot } from "./workspaceSession";

export interface ContainerMachineOptions {
  groupId?: string;
  shell?: string;
  user?: string;
  workdir?: string;
}

export function localMachineIdForProfile(profileId: string) {
  return `profile:${profileId}`;
}

export function findMachine(
  groups: readonly MachineGroup[],
  machineId: string,
): Machine | undefined {
  for (const group of groups) {
    const machine = group.machines.find((candidate) => candidate.id === machineId);
    if (machine) {
      return machine;
    }
  }
  return undefined;
}

export function sidebarMachinesForWorkspaceSession(
  groups: MachineGroup[],
): Machine[] {
  return collectPersistentSidebarMachines(groups);
}

export function buildMachineGroups(
  remoteGroups: RemoteHostGroupWithHosts[],
): MachineGroup[] {
  const remoteMachineGroups: MachineGroup[] = [...remoteGroups]
    .sort(
      (left, right) =>
        left.sortOrder - right.sortOrder || left.name.localeCompare(right.name),
    )
    .map((group) => ({
      id: group.id,
      machines: [...group.hosts]
        .sort(
          (left, right) =>
            left.sortOrder - right.sortOrder ||
            left.name.localeCompare(right.name),
        )
        .map((host) => {
          const kind = host.protocol === "sftp"
            ? ("sftp" as const)
            : isSerialRemoteHost(host)
            ? ("serial" as const)
            : isTelnetRemoteHost(host)
              ? ("telnet" as const)
              : isRdpRemoteHost(host)
                ? ("rdp" as const)
                : ("ssh" as const);
          return {
            authType: host.authType,
            createdAt: host.createdAt,
            credentialRef: host.credentialRef,
            credentialSecret: host.credentialSecret,
            description:
              kind === "rdp"
                ? rdpMachineDescription(host)
                : kind === "telnet"
                  ? telnetMachineDescription(host)
                  : kind === "serial"
                    ? serialMachineDescription(host)
                  : kind === "sftp"
                    ? `SFTP · ${host.username}@${host.host}:${host.port}`
                    : `${host.username}@${host.host}:${host.port}`,
            host: host.host,
            id: host.id,
            kind,
            name: host.name,
            port: host.port,
            remoteGroupId: host.groupId,
            sortOrder: host.sortOrder,
            sshOptions: host.sshOptions,
            status: "offline" as const,
            target:
              kind === "ssh" || kind === "sftp"
                ? sshTarget(host.id)
                : kind === "telnet"
                  ? telnetTarget(host.id)
                  : kind === "serial"
                    ? serialTarget(host.id)
                    : undefined,
            tags: host.tags,
            updatedAt: host.updatedAt,
            username: host.username,
          };
        }),
      createdAt: group.createdAt,
      pinned: isPinnedSortOrder(group.sortOrder),
      title: group.name,
      sortOrder: group.sortOrder,
      updatedAt: group.updatedAt,
    }));
  return remoteMachineGroups;
}

export function containerToMachine(
  container: DockerContainerSummary,
  hostMachine: Machine,
  options: ContainerMachineOptions = {},
): Machine {
  const running = container.status === "running";
  const target = dockerContainerTarget({
    containerId: container.id,
    containerName: container.name,
    hostId: container.hostId,
    runtime: container.runtime as ContainerRuntime,
    user: options.user,
    workdir: options.workdir,
  });

  return {
    containerId: container.id,
    containerName: container.name,
    description: container.statusText
      ? `${container.image} · ${container.statusText}`
      : container.image,
    host: hostMachine.host,
    id: targetStableId(target),
    kind: "dockerContainer",
    name: container.name,
    parentMachineId: container.hostId,
    remoteGroupId: options.groupId ?? hostMachine.remoteGroupId,
    runtime: container.runtime,
    sortOrder: hostMachine.sortOrder,
    status: running ? "offline" : "warning",
    tags: ["container", container.runtime, container.status],
    shell: options.shell,
    target,
    user: options.user,
    username: hostMachine.username,
    workdir: options.workdir,
  };
}

export function profileToLocalMachine(profile: TerminalProfile): Machine {
  return {
    args: profile.args,
    createdAt: profile.createdAt,
    cwd: profile.cwd,
    description: localProfileDescription(profile),
    env: profile.env,
    id: localMachineIdForProfile(profile.id),
    kind: "local",
    name: profile.name,
    profileId: profile.id,
    remoteGroupId: profile.sidebarGroupId,
    shell: profile.shell,
    sortOrder: profile.sortOrder,
    status: "offline",
    target: localTarget(profile.id),
    tags: profile.isDefault ? ["local", "default"] : ["local"],
    updatedAt: profile.updatedAt,
  };
}

export function localRuntimeDescription(config: {
  args?: string[];
  cwd?: string;
  shell?: string;
}) {
  const args = config.args && config.args.length > 0 ? ` ${config.args.join(" ")}` : "";
  const cwd = config.cwd ? ` · ${config.cwd}` : "";
  return `${config.shell || "本地会话"}${args}${cwd}`;
}

export function isPersistedLocalProfile(profile: TerminalProfile) {
  return !browserPreviewProfiles.some(
    (previewProfile) =>
      previewProfile.id === profile.id && previewProfile.shell === profile.shell,
  );
}

export function syncLocalSidebarMachines(
  groups: MachineGroup[],
  profiles: TerminalProfile[],
) {
  const profilesById = new Map(profiles.map((profile) => [profile.id, profile]));
  return groups
    .map((group) => ({
      ...group,
      machines: group.machines.map((machine) => {
        if (machine.kind !== "local" || !machine.profileId) {
          return machine;
        }
        const profile = profilesById.get(machine.profileId);
        if (!profile || !isPersistedLocalProfile(profile)) {
          return machine;
        }
        return {
          ...profileToLocalMachine(profile),
          remoteGroupId: profile.sidebarGroupId ?? machine.remoteGroupId,
        };
      }),
    }))
    .filter(
      (group) =>
        group.id !== UNGROUPED_REMOTE_HOST_GROUP_ID || group.machines.length > 0,
    );
}

export function sidebarMachinesFromProfiles(profiles: TerminalProfile[]) {
  return profiles
    .filter(
      (profile) => profile.sidebarGroupId && isPersistedLocalProfile(profile),
    )
    .map(profileToLocalMachine);
}

export function collectPersistentSidebarMachines(groups: MachineGroup[]) {
  return groups.flatMap((group) =>
    group.machines
      .filter(
        (machine) =>
          machine.kind === "local" || machine.kind === "dockerContainer",
      )
      .map((machine) => ({
        ...machine,
        remoteGroupId: machine.remoteGroupId ?? group.id,
        status: machine.kind === "local" ? ("offline" as const) : machine.status,
      })),
  );
}

export function addPersistentSidebarMachines(
  groups: MachineGroup[],
  machines: Machine[],
): MachineGroup[] {
  const uniqueMachines = uniqueMachinesById(machines);
  let nextGroups = addLocalMachinesToGroups(
    groups,
    uniqueMachines.filter((machine) => machine.kind === "local"),
  );

  const orphanContainers: Machine[] = [];
  for (const machine of uniqueMachines) {
    if (machine.kind !== "dockerContainer") {
      continue;
    }
    const hostId = machine.parentMachineId;
    const hostMachine = hostId ? findMachine(nextGroups, hostId) : undefined;
    if (!hostId || !hostMachine || hostMachine.kind !== "ssh") {
      orphanContainers.push(machine);
      continue;
    }

    const syncedMachine = syncDockerContainerMachine(machine, hostMachine);
    nextGroups = addDockerContainerMachineToGroup(
      nextGroups,
      syncedMachine,
      syncedMachine.remoteGroupId,
    );
  }

  for (const container of orphanContainers.reverse()) {
    nextGroups = addDockerContainerMachineToGroup(
      nextGroups,
      container,
      container.remoteGroupId,
    );
  }

  return nextGroups;
}

export function mergeSidebarMachines(...groups: Machine[][]) {
  return uniqueMachinesById(groups.flat());
}

export function removeMachineFromGroups(
  groups: MachineGroup[],
  machineId: string,
): MachineGroup[] {
  return groups
    .map((group) => ({
      ...group,
      machines: group.machines.filter((machine) => machine.id !== machineId),
    }))
    .filter(
      (group) =>
        group.id !== UNGROUPED_REMOTE_HOST_GROUP_ID || group.machines.length > 0,
    );
}

/**
 * 只从历史侧栏范围的 pane 重建本地 Machine；workspace 临时终端由 pane 本身
 * 提供运行上下文，恢复时不得因此重新出现在左栏。
 */
export function localMachinesFromSession(
  session: WorkspaceSessionSnapshot,
): Machine[] {
  const machines = new Map<string, Machine>();

  for (const pane of session.terminalPanes) {
    if (
      pane.mode !== "local" ||
      pane.localMachineScope === "workspace" ||
      machines.has(pane.machineId)
    ) {
      continue;
    }

    machines.set(pane.machineId, {
      args: pane.args,
      cwd: pane.currentCwd ?? pane.cwd,
      description: pane.shell ?? "本地会话",
      env: pane.env,
      id: pane.machineId,
      kind: "local",
      name: pane.title,
      profileId: pane.profileId,
      shell: pane.shell,
      status: "online",
      target: localTarget(pane.profileId),
      tags: ["local"],
    });
  }

  return [...machines.values()];
}

export function dockerContainerMachinesFromSession(
  session: WorkspaceSessionSnapshot,
): Machine[] {
  const machines = new Map<string, Machine>();

  for (const pane of session.terminalPanes) {
    if (
      pane.mode !== "container" ||
      machines.has(pane.machineId) ||
      pane.target?.kind !== "dockerContainer"
    ) {
      continue;
    }

    machines.set(pane.machineId, {
      containerId: pane.target.containerId,
      containerName: pane.target.containerName,
      description: pane.title,
      id: pane.machineId,
      kind: "dockerContainer",
      name: pane.title,
      parentMachineId: pane.target.hostId,
      runtime: pane.target.runtime,
      shell: pane.shell,
      status: pane.status,
      tags: ["container", pane.target.runtime ?? "docker"],
      target: pane.target,
      user: pane.target.user,
      workdir: pane.target.workdir,
    });
  }

  return [...machines.values()];
}

export function addDockerContainerMachineToGroup(
  groups: MachineGroup[],
  machine: Machine,
  groupId: string | undefined,
): MachineGroup[] {
  const targetGroupId = resolveTargetGroupId(groups, groupId);
  const machineWithGroup = {
    ...machine,
    remoteGroupId: targetGroupId,
  };
  const groupsWithoutMachine = pruneEmptyUngroupedGroup(
    groups.map((group) => ({
      ...group,
      machines: group.machines.filter((item) => item.id !== machineWithGroup.id),
    })),
  );

  if (groupsWithoutMachine.some((group) => group.id === targetGroupId)) {
    return groupsWithoutMachine.map((group) =>
      group.id === targetGroupId
        ? {
            ...group,
            machines: insertDockerContainerMachine(group.machines, machineWithGroup),
          }
        : group,
    );
  }

  return [
    {
      id: targetGroupId,
      machines: [machineWithGroup],
      title: fallbackGroupTitle(targetGroupId),
    },
    ...groupsWithoutMachine,
  ];
}

export function addMachineToGroup(
  groups: MachineGroup[],
  machine: Machine,
  groupId: string | undefined,
): MachineGroup[] {
  const targetGroupId = resolveTargetGroupId(groups, groupId);
  const machineWithGroup = {
    ...machine,
    remoteGroupId: targetGroupId,
  };
  const groupsWithoutMachine = pruneEmptyUngroupedGroup(
    groups.map((group) => ({
      ...group,
      machines: group.machines.filter((item) => item.id !== machineWithGroup.id),
    })),
  );

  if (groupsWithoutMachine.some((group) => group.id === targetGroupId)) {
    return groupsWithoutMachine.map((group) =>
      group.id === targetGroupId
        ? {
            ...group,
            machines: [machineWithGroup, ...group.machines],
          }
        : group,
    );
  }

  return [
    {
      id: targetGroupId,
      machines: [machineWithGroup],
      title: fallbackGroupTitle(targetGroupId),
    },
    ...groupsWithoutMachine,
  ];
}

export function sortMachineGroups(groups: MachineGroup[]) {
  return [...groups].sort(
    (left, right) =>
      (left.sortOrder ?? 0) - (right.sortOrder ?? 0) ||
      left.title.localeCompare(right.title),
  );
}

export function nextPinnedSortOrder(groups: MachineGroup[]) {
  return Math.min(0, ...groups.map((group) => group.sortOrder ?? 0)) - 10;
}

export function nextUnpinnedSortOrder(groups: MachineGroup[], groupId: string) {
  return (
    Math.max(
      0,
      ...groups
        .filter((group) => group.id !== groupId && !isPinnedGroup(group))
        .map((group) => group.sortOrder ?? 0),
    ) + 10
  );
}

export function ungroupedGroupTitle(groups: MachineGroup[]) {
  return groups.find((group) => group.id === UNGROUPED_REMOTE_HOST_GROUP_ID)
    ?.title;
}

export function withUngroupedGroupTitle(
  groups: MachineGroup[],
  title: string | undefined,
) {
  if (!title) {
    return groups;
  }

  return groups.map((group) =>
    group.id === UNGROUPED_REMOTE_HOST_GROUP_ID ? { ...group, title } : group,
  );
}

function localProfileDescription(profile: TerminalProfile) {
  return localRuntimeDescription(profile);
}

function isRdpRemoteHost(host: RemoteHostGroupWithHosts["hosts"][number]) {
  return host.tags.some((tag) => tag.trim().toLowerCase() === "rdp");
}

function isTelnetRemoteHost(host: RemoteHostGroupWithHosts["hosts"][number]) {
  return host.tags.some((tag) => tag.trim().toLowerCase() === "telnet");
}

function isSerialRemoteHost(host: RemoteHostGroupWithHosts["hosts"][number]) {
  return host.tags.some((tag) => tag.trim().toLowerCase() === "serial");
}

function rdpMachineDescription(host: RemoteHostGroupWithHosts["hosts"][number]) {
  const userPrefix = host.username.trim() ? `${host.username}@` : "";
  return `${userPrefix}${host.host}:${host.port}`;
}

function telnetMachineDescription(host: RemoteHostGroupWithHosts["hosts"][number]) {
  return `${host.host}:${host.port}`;
}

function serialMachineDescription(host: RemoteHostGroupWithHosts["hosts"][number]) {
  const portName = serialPortName(host.tags) ?? host.host;
  return `${portName} · ${serialBaudRate(host.tags)} bps`;
}

export function serialPortName(tags: string[]) {
  return readTaggedValue(tags, "serial-port");
}

function serialBaudRate(tags: string[]) {
  return readTaggedValue(tags, "serial-baud") ?? "9600";
}

function readTaggedValue(tags: string[], key: string) {
  const prefix = `${key}:`;
  const match = tags.find((tag) =>
    tag.trim().toLowerCase().startsWith(prefix.toLowerCase()),
  );
  return match?.slice(prefix.length).trim() || undefined;
}

function syncDockerContainerMachine(machine: Machine, hostMachine: Machine): Machine {
  const containerId = dockerContainerId(machine);
  if (!containerId) {
    return machine;
  }

  return {
    ...machine,
    containerId,
    host: hostMachine.host,
    parentMachineId: hostMachine.id,
    remoteGroupId: machine.remoteGroupId ?? hostMachine.remoteGroupId,
    sortOrder: hostMachine.sortOrder,
    target: dockerContainerTarget({
      containerId,
      containerName: machine.containerName,
      hostId: hostMachine.id,
      runtime: machine.runtime,
      user: machine.user,
      workdir: machine.workdir,
    }),
    username: hostMachine.username,
  };
}

function uniqueMachinesById(machines: Machine[]) {
  const byId = new Map<string, Machine>();
  for (const machine of machines) {
    byId.set(machine.id, machine);
  }
  return [...byId.values()];
}

function dockerContainerId(machine: Machine) {
  if (machine.containerId) {
    return machine.containerId;
  }
  return machine.target?.kind === "dockerContainer"
    ? machine.target.containerId
    : undefined;
}

function addLocalMachinesToGroups(
  groups: MachineGroup[],
  localMachines: Machine[],
): MachineGroup[] {
  return [...localMachines]
    .reverse()
    .reduce(
      (nextGroups, machine) =>
        addMachineToGroup(nextGroups, machine, machine.remoteGroupId),
      groups,
    );
}

const DEFAULT_UNGROUPED_GROUP_TITLE = "默认分组";

function insertDockerContainerMachine(machines: Machine[], machine: Machine) {
  const nextMachines = [...machines];
  const hostIndex = nextMachines.findIndex(
    (candidate) =>
      candidate.id === machine.parentMachineId && candidate.kind === "ssh",
  );
  if (hostIndex < 0) {
    return [machine, ...nextMachines];
  }
  nextMachines.splice(hostIndex + 1, 0, machine);
  return nextMachines;
}

function resolveTargetGroupId(groups: MachineGroup[], groupId: string | undefined) {
  const requestedGroupId = groupId?.trim();
  const realDefaultGroupId = groups.find(
    (group) =>
      group.id !== UNGROUPED_REMOTE_HOST_GROUP_ID &&
      group.title.trim() === DEFAULT_UNGROUPED_GROUP_TITLE,
  )?.id;
  if (!requestedGroupId || requestedGroupId === UNGROUPED_REMOTE_HOST_GROUP_ID) {
    return realDefaultGroupId ?? UNGROUPED_REMOTE_HOST_GROUP_ID;
  }
  return requestedGroupId;
}

function fallbackGroupTitle(groupId: string) {
  return groupId === UNGROUPED_REMOTE_HOST_GROUP_ID
    ? DEFAULT_UNGROUPED_GROUP_TITLE
    : DEFAULT_UNGROUPED_GROUP_TITLE;
}

function isPinnedSortOrder(sortOrder: number | undefined) {
  return (sortOrder ?? 0) < 0;
}

function isPinnedGroup(group: MachineGroup) {
  return Boolean(group.pinned ?? isPinnedSortOrder(group.sortOrder));
}

function pruneEmptyUngroupedGroup(groups: MachineGroup[]) {
  return groups.filter(
    (group) =>
      group.id !== UNGROUPED_REMOTE_HOST_GROUP_ID || group.machines.length > 0,
  );
}
