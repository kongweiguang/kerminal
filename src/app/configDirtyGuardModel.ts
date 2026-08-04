// @author kongweiguang

import type { SettingsSaveState } from "../features/settings/SettingsToolContent";
import type { Machine, MachineGroup } from "../features/workspace/types";
import type { RemoteHost } from "../lib/remoteHostApi";

export interface ConfigEditConflict {
  message: string;
}

export function shouldKeepSettingsEditorDraft({
  dialogOpen,
  dirty,
  saveState,
}: {
  dialogOpen: boolean;
  dirty: boolean;
  saveState: SettingsSaveState;
}) {
  return (
    dialogOpen &&
    (dirty || saveState === "saving" || saveState === "error")
  );
}

export function resolveConnectionEditConflict({
  editingHost,
  editingLocalMachine,
  groups,
}: {
  editingHost?: RemoteHost;
  editingLocalMachine?: Machine;
  groups: MachineGroup[];
}): ConfigEditConflict | null {
  if (editingLocalMachine) {
    const currentMachine = findMachine(groups, editingLocalMachine.id);
    if (!currentMachine) {
      return {
        message: "当前本地配置已在外部删除，请关闭后重新打开。",
      };
    }
    if (
      comparableRevisionChanged(
        editingLocalMachine.updatedAt,
        currentMachine.updatedAt,
      )
    ) {
      return {
        message: "当前本地配置已在外部更新，请关闭后重新打开。",
      };
    }
    if (
      localMachineFingerprint(currentMachine) !==
      localMachineFingerprint(editingLocalMachine)
    ) {
      return {
        message: "当前本地配置已在外部更新，请关闭后重新打开。",
      };
    }
    return null;
  }

  if (!editingHost) {
    return null;
  }

  const currentMachine = findMachine(groups, editingHost.id);
  if (!currentMachine) {
    return {
      message: "当前主机已在外部删除，请关闭后重新打开。",
    };
  }
  if (comparableRevisionChanged(editingHost.updatedAt, currentMachine.updatedAt)) {
    return {
      message: "当前主机已在外部更新，请关闭后重新打开。",
    };
  }
  if (
    remoteMachineFingerprint(currentMachine) !==
    remoteHostFingerprint(editingHost)
  ) {
    return {
      message: "当前主机已在外部更新，请关闭后重新打开。",
    };
  }
  return null;
}

export function resolveRemoteGroupEditConflict({
  group,
  groups,
}: {
  group?: MachineGroup;
  groups: MachineGroup[];
}): ConfigEditConflict | null {
  if (!group) {
    return null;
  }

  const currentGroup = groups.find((candidate) => candidate.id === group.id);
  if (!currentGroup) {
    return {
      message: "当前主机分组已在外部删除，请关闭后重新打开。",
    };
  }
  if (comparableRevisionChanged(group.updatedAt, currentGroup.updatedAt)) {
    return {
      message: "当前主机分组已在外部更新，请关闭后重新打开。",
    };
  }
  if (groupFingerprint(currentGroup) !== groupFingerprint(group)) {
    return {
      message: "当前主机分组已在外部更新，请关闭后重新打开。",
    };
  }
  return null;
}

function findMachine(groups: MachineGroup[], machineId: string) {
  return groups
    .flatMap((group) => group.machines)
    .find((machine) => machine.id === machineId);
}

function groupFingerprint(group: MachineGroup) {
  return stableStringify({
    id: group.id,
    pinned: group.pinned ?? null,
    sortOrder: group.sortOrder ?? null,
    title: group.title,
  });
}

function localMachineFingerprint(machine: Machine) {
  return stableStringify({
    args: machine.args ?? [],
    cwd: machine.cwd ?? null,
    env: sortRecord(machine.env),
    id: machine.id,
    kind: machine.kind,
    name: machine.name,
    profileId: machine.profileId ?? null,
    remoteGroupId: machine.remoteGroupId ?? null,
    shell: machine.shell ?? null,
    sortOrder: machine.sortOrder ?? null,
    tags: [...machine.tags].sort(),
  });
}

function remoteMachineFingerprint(machine: Machine) {
  return stableStringify({
    authType: machine.authType ?? "agent",
    credentialRef:
      machine.authType === "key" ? (machine.credentialRef ?? null) : null,
    groupId: machine.remoteGroupId ?? null,
    host: machine.host ?? machine.description,
    id: machine.id,
    kind: machine.kind,
    name: machine.name,
    port:
      machine.port ??
      (machine.kind === "rdp" ? 3389 : machine.kind === "telnet" ? 23 : 1),
    sortOrder: machine.sortOrder ?? 0,
    tags: [...machine.tags].sort(),
    username: machine.username ?? "",
  });
}

function remoteHostFingerprint(host: RemoteHost) {
  return stableStringify({
    authType: host.authType,
    credentialRef: host.authType === "key" ? (host.credentialRef ?? null) : null,
    groupId: host.groupId ?? null,
    host: host.host,
    id: host.id,
    kind: host.tags.includes("rdp")
      ? "rdp"
      : host.tags.includes("telnet")
        ? "telnet"
        : host.tags.includes("serial")
          ? "serial"
          : "ssh",
    name: host.name,
    port: host.port,
    sortOrder: host.sortOrder,
    tags: [...host.tags].sort(),
    username: host.username,
  });
}

function comparableRevisionChanged(
  previous: string | undefined,
  current: string | undefined,
) {
  return Boolean(previous && current && previous !== current);
}

function sortRecord(record: Record<string, string> | undefined) {
  if (!record) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(record).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function stableStringify(value: unknown) {
  return JSON.stringify(value);
}
