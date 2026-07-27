/**
 * @author kongweiguang
 */

import type { SftpBookmarkTarget } from "../../../lib/sftpBookmarkApi";
import type { SftpFileTarget } from "../sftp-tool-content/types";

/** 将文件浏览 target 收窄为书签持久化所需的稳定身份。 */
export function sftpBookmarkTargetFromFileTarget(
  target: SftpFileTarget,
): SftpBookmarkTarget {
  if (target.kind === "ssh") {
    return { hostId: target.hostId, kind: "ssh" };
  }
  return {
    containerId: target.containerId,
    hostId: target.hostId,
    kind: "dockerContainer",
    runtime: target.runtime,
  };
}

export function sftpBookmarkTargetKey(target: SftpBookmarkTarget): string {
  if (target.kind === "ssh") {
    return `ssh:${target.hostId.trim()}`;
  }
  return `${target.runtime ?? "docker"}:${target.hostId.trim()}:${target.containerId.trim()}`;
}
