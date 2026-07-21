// @author kongweiguang

import type { TerminalSplitDropZone } from "../features/terminal/terminalSplitDropZones";
import type { RemoteHost } from "../lib/remoteHostApi";

const terminalSplitDropZoneLabels: Record<TerminalSplitDropZone, string> = {
  bottom: "下方",
  left: "左侧",
  right: "右侧",
  top: "上方",
};

export function terminalSplitDropZoneLabel(
  zone: TerminalSplitDropZone,
): string {
  return terminalSplitDropZoneLabels[zone];
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export function isSftpCapableRemoteHost(host: RemoteHost): boolean {
  return host.protocol === "ssh" || host.protocol === "sftp";
}
