import type { DockerContainerDirectoryListing } from "../../../lib/containerFilesApi";
import type { SftpDirectoryListing } from "../../../lib/sftpApi";
import type { RemoteTargetRef } from "../../../lib/targetModel";
import type { Machine } from "../../workspace/contracts/index";
import { normalizeRemotePath } from "./sftpPathModel";
import type {
  DockerContainerTargetRef,
  RemoteDirectoryListing,
  SftpFileTarget,
} from "./types";

export function resolveFileTarget(machine: Machine | undefined): SftpFileTarget | null {
  if (!machine) {
    return null;
  }

  if (machine.target?.kind === "dockerContainer") {
    return dockerContainerFileTarget(machine, machine.target);
  }
  if (machine.kind === "dockerContainer") {
    return dockerContainerFileTarget(machine, {
      containerId: machine.containerId ?? machine.id,
      containerName: machine.containerName ?? machine.name,
      hostId: machine.parentMachineId ?? machine.remoteGroupId ?? "",
      kind: "dockerContainer",
      runtime: machine.runtime ?? "docker",
      user: machine.user,
      workdir: machine.workdir,
    });
  }

  if (
    machine.target?.kind === "ssh" ||
    machine.kind === "ssh" ||
    machine.kind === "sftp"
  ) {
    const hostId = machine.target?.kind === "ssh" ? machine.target.hostId : machine.id;
    return {
      hostId,
      initialPath: normalizeRemotePath(machine.cwd ?? "/"),
      kind: "ssh",
      protocol: "sftp://",
      summary: `${machine.username ?? "ssh"}@${machine.host ?? hostId}:${
        machine.port ?? 22
      }`,
    };
  }

  return null;
}

function dockerContainerFileTarget(
  machine: Machine,
  target: DockerContainerTargetRef,
): SftpFileTarget | null {
  const hostId = target.hostId.trim();
  const containerId = target.containerId.trim();
  if (!hostId || !containerId) {
    return null;
  }
  const runtime = target.runtime ?? "docker";
  return {
    containerId,
    ...(target.containerName ? { containerName: target.containerName } : {}),
    hostId,
    initialPath: normalizeRemotePath(target.workdir ?? machine.workdir ?? "/"),
    kind: "dockerContainer",
    protocol: "container://",
    runtime,
    summary: `${runtime}:${hostId}:${target.containerName ?? containerId}`,
  };
}

export function fileTargetToRemoteTarget(
  target: SftpFileTarget | null,
): RemoteTargetRef | null {
  if (!target) {
    return null;
  }
  if (target.kind === "ssh") {
    return {
      hostId: target.hostId,
      kind: "ssh",
    };
  }
  return {
    containerId: target.containerId,
    ...(target.containerName ? { containerName: target.containerName } : {}),
    hostId: target.hostId,
    kind: "dockerContainer",
    runtime: target.runtime,
    workdir: target.initialPath,
  };
}

export function normalizeDirectoryListing(
  listing: SftpDirectoryListing | DockerContainerDirectoryListing,
): RemoteDirectoryListing {
  return {
    entries: listing.entries,
    hostId: listing.hostId,
    ...(listing.parentPath ? { parentPath: listing.parentPath } : {}),
    path: listing.path,
  };
}
