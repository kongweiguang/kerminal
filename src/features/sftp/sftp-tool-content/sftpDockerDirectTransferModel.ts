/**
 * Docker container direct transfer UI snapshots.
 *
 * @author kongweiguang
 */

import type { DockerContainerTransferRequest } from "../../../lib/containerFilesApi";
import type {
  SftpTransferDirection,
  SftpTransferStatus,
  SftpTransferSummary,
} from "../../../lib/sftpApi";
import { fileNameFromPath } from "../sftpFileUtils";
import type { SftpFileTarget } from "./types";

type DockerContainerFileTarget = Extract<SftpFileTarget, { kind: "dockerContainer" }>;

type BuildDockerDirectTransferSummaryOptions = {
  createdAt: number;
  direction: SftpTransferDirection;
  error?: string | null;
  fileTarget: DockerContainerFileTarget;
  id: string;
  request: DockerContainerTransferRequest;
  status: SftpTransferStatus;
  updatedAt: number;
  viewScope?: string | null;
};

export function dockerContainerTransferHostId(target: DockerContainerFileTarget) {
  return `container:${target.hostId}:${target.containerId}`;
}

/** 容器直传没有可中断的后台任务 ID，不能借用 cancelRequested 伪造取消状态。 */
export function buildDockerDirectTransferSummary({
  createdAt,
  direction,
  error = null,
  fileTarget,
  id,
  request,
  status,
  updatedAt,
  viewScope,
}: BuildDockerDirectTransferSummaryOptions): SftpTransferSummary {
  const syntheticHostId = dockerContainerTransferHostId(fileTarget);
  const hostLabel = fileTarget.containerName || fileTarget.summary || fileTarget.containerId;
  const source =
    direction === "upload"
      ? ({ kind: "local", path: request.localPath } as const)
      : ({
          hostId: syntheticHostId,
          hostLabel,
          kind: "remote",
          path: request.remotePath,
        } as const);
  const target =
    direction === "upload"
      ? ({
          hostId: syntheticHostId,
          hostLabel,
          kind: "remote",
          path: request.remotePath,
        } as const)
      : ({ kind: "local", path: request.localPath } as const);

  return {
    bytesTransferred: 0,
    cancelRequested: false,
    cancelable: false,
    conflictPolicy: null,
    createdAt,
    currentItem: fileNameFromPath(
      direction === "upload" ? request.localPath : request.remotePath,
      request.kind === "directory" ? "folder" : "file",
    ),
    direction,
    error,
    hostId: syntheticHostId,
    id,
    kind: request.kind,
    localPath: request.localPath,
    operation: direction,
    phase:
      status === "running"
        ? direction === "upload"
          ? "uploading"
          : "downloading"
        : null,
    remotePath: request.remotePath,
    source,
    status,
    target,
    totalBytes: null,
    transportMode: "clientBridge",
    updatedAt,
    viewScope: viewScope ?? null,
  };
}
