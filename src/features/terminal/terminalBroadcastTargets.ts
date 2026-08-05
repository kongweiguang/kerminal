// @author kongweiguang

import type {
  MachineStatus,
  TerminalPane,
} from "../workspace/contracts/index";

export type BroadcastTargetMode = "focused" | "all" | "custom";

export interface BroadcastTargetOption {
  machineId: string;
  mode: TerminalPane["mode"];
  paneId: string;
  status: MachineStatus;
  subtitle: string;
  title: string;
}

export function createBroadcastTargetOption(
  pane: TerminalPane,
): BroadcastTargetOption {
  const subtitleParts = [
    pane.machineId,
    pane.status !== "online" ? pane.status : undefined,
    typeof pane.latencyMs === "number" ? `${pane.latencyMs}ms` : undefined,
  ].filter((part): part is string => Boolean(part));

  return {
    machineId: pane.machineId,
    mode: pane.mode,
    paneId: pane.id,
    status: pane.status,
    subtitle: subtitleParts.join(" · "),
    title: pane.title,
  };
}

export function resolveBroadcastTargetPaneIds(
  mode: BroadcastTargetMode,
  targetOptions: BroadcastTargetOption[],
  focusedPaneId: string,
  customTargetPaneIds: string[],
) {
  if (mode === "focused") {
    return targetOptions.some((target) => target.paneId === focusedPaneId)
      ? [focusedPaneId]
      : [];
  }

  if (mode === "custom") {
    const validTargetPaneIds = new Set(
      targetOptions.map((target) => target.paneId),
    );
    return customTargetPaneIds.filter((paneId) =>
      validTargetPaneIds.has(paneId),
    );
  }

  return targetOptions.map((target) => target.paneId);
}

export function filterBroadcastTargetsByPaneIds<
  T extends { paneId: string },
>(targets: T[], paneIds: string[]) {
  const selectedPaneIds = new Set(paneIds);
  return targets.filter((target) => selectedPaneIds.has(target.paneId));
}
