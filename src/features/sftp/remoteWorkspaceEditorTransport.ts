// @author kongweiguang

import {
  listDockerContainerDirectory,
  readDockerContainerTextFile,
  writeDockerContainerTextFile,
  type DockerContainerDirectoryListing,
  type DockerContainerReadTextFileResponse,
  type DockerContainerWriteTextFileResponse,
} from "../../lib/containerFilesApi";
import {
  readLocalTextFile,
  writeLocalTextFile,
  type LocalReadTextFileResponse,
  type LocalWriteTextFileResponse,
} from "../../lib/localFilesApi";
import {
  listSftpDirectory,
  readSftpTextFile,
  writeSftpTextFile,
} from "../../lib/sftpApi";
import type {
  SftpDirectoryListing,
  SftpFileRevision,
  SftpReadTextFileResponse,
  SftpWriteTextFileResponse,
} from "../../lib/sftpApiTypes";
import type { RemoteTargetRef } from "../../lib/targetModel";

export const MISSING_REMOTE_WORKSPACE_TARGET_MESSAGE =
  "远程工作区缺少可用目标。";

export type RemoteWorkspaceDirectoryListing =
  DockerContainerDirectoryListing | SftpDirectoryListing;

export type RemoteWorkspaceReadTextFileResponse =
  | DockerContainerReadTextFileResponse
  | SftpReadTextFileResponse
  | LocalReadTextFileResponse;

export type RemoteWorkspaceWriteTextFileResponse =
  | DockerContainerWriteTextFileResponse
  | SftpWriteTextFileResponse
  | LocalWriteTextFileResponse;

export async function listRemoteWorkspaceDirectory(
  target: RemoteTargetRef | null | undefined,
  path: string,
): Promise<RemoteWorkspaceDirectoryListing> {
  if (target?.kind === "dockerContainer") {
    return listDockerContainerDirectory({
      containerId: target.containerId,
      hostId: target.hostId,
      path,
      runtime: target.runtime,
    });
  }
  if (target?.kind === "ssh") {
    return listSftpDirectory({
      hostId: target.hostId,
      path,
    });
  }
  throw new Error(MISSING_REMOTE_WORKSPACE_TARGET_MESSAGE);
}

export async function readRemoteWorkspaceTextFile({
  maxBytes,
  path,
  target,
}: {
  maxBytes: number;
  path: string;
  target: RemoteTargetRef | null | undefined;
}): Promise<RemoteWorkspaceReadTextFileResponse> {
  if (target?.kind === "dockerContainer") {
    return readDockerContainerTextFile({
      containerId: target.containerId,
      hostId: target.hostId,
      maxBytes,
      path,
      runtime: target.runtime,
    });
  }
  if (target?.kind === "ssh") {
    return readSftpTextFile({
      hostId: target.hostId,
      maxBytes,
      path,
    });
  }
  if (target?.kind === "local") {
    return readLocalTextFile({
      maxBytes,
      path,
    });
  }
  throw new Error(MISSING_REMOTE_WORKSPACE_TARGET_MESSAGE);
}

export async function writeRemoteWorkspaceTextFile({
  content,
  expectedRevision,
  overwriteOnConflict,
  path,
  target,
}: {
  content: string;
  expectedRevision?: SftpFileRevision | null;
  overwriteOnConflict: boolean;
  path: string;
  target: RemoteTargetRef | null | undefined;
}): Promise<RemoteWorkspaceWriteTextFileResponse> {
  if (target?.kind === "dockerContainer") {
    return writeDockerContainerTextFile({
      containerId: target.containerId,
      content,
      create: false,
      encoding: "utf-8",
      expectedRevision,
      hostId: target.hostId,
      overwriteOnConflict,
      path,
      runtime: target.runtime,
    });
  }
  if (target?.kind === "ssh") {
    return writeSftpTextFile({
      content,
      create: false,
      encoding: "utf-8",
      expectedRevision,
      hostId: target.hostId,
      overwriteOnConflict,
      path,
    });
  }
  if (target?.kind === "local") {
    return writeLocalTextFile({
      content,
      create: false,
      encoding: "utf-8",
      expectedRevision,
      overwriteOnConflict,
      path,
    });
  }
  throw new Error(MISSING_REMOTE_WORKSPACE_TARGET_MESSAGE);
}
