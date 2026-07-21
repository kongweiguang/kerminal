/**
 * SFTP 传输工作台的主机 tab 纯状态模型。
 *
 * @author kongweiguang
 */

import type { MachineGroup } from "../workspace/contracts/index";

export type SftpTransferHostSide = "left" | "right";

export const SFTP_TRANSFER_LOCAL_TAB_ID = "left-local";

export type SftpTransferHostTab = {
  hostId: string;
  id: string;
  locked?: boolean;
};

export type SftpTransferHostTabIdFactory = (params: {
  hostId: string;
  locked: boolean;
  side: SftpTransferHostSide;
}) => string;

export function collectSshMachines(groups: MachineGroup[]) {
  return groups.flatMap((group) =>
    group.machines.filter(
      (machine) => machine.kind === "ssh" || machine.kind === "sftp",
    ),
  );
}

export function firstValidHostId(
  hostIds: ReadonlySet<string>,
  ...candidates: Array<string | undefined>
) {
  return candidates.find((candidate) => Boolean(candidate && hostIds.has(candidate)));
}

export function reconcileHostTabs({
  createTabId = defaultHostTabId,
  fallbackHostId,
  hostIds,
  lockedHostId,
  side,
  tabs,
}: {
  createTabId?: SftpTransferHostTabIdFactory;
  fallbackHostId?: string;
  hostIds: ReadonlySet<string>;
  lockedHostId?: string;
  side: SftpTransferHostSide;
  tabs: SftpTransferHostTab[];
}) {
  const lockedTab =
    lockedHostId && hostIds.has(lockedHostId)
      ? createHostTab(side, lockedHostId, {
          createTabId,
          locked: true,
        })
      : undefined;
  const validTabs = tabs.filter(
    (tab) => hostIds.has(tab.hostId) && tab.hostId !== lockedHostId,
  );
  const nextTabs = appendMissingFallbackHostTab({
    createTabId,
    fallbackHostId,
    hostIds,
    side,
    tabs: lockedTab ? [lockedTab, ...validTabs] : validTabs,
  });

  return nextTabs.length > 0 ? nextTabs : [];
}

export function resolveActiveHostTabId({
  currentTabId,
  preferredHostId,
  tabs,
}: {
  currentTabId: string;
  preferredHostId?: string;
  tabs: SftpTransferHostTab[];
}) {
  if (tabs.some((tab) => tab.id === currentTabId)) {
    return currentTabId;
  }
  if (preferredHostId) {
    const preferredTab = tabs.find((tab) => tab.hostId === preferredHostId);
    if (preferredTab) {
      return preferredTab.id;
    }
  }
  return tabs[0]?.id ?? "";
}

export function resolveActivePaneTabId({
  currentTabId,
  localTabId = SFTP_TRANSFER_LOCAL_TAB_ID,
  tabs,
}: {
  currentTabId: string;
  localTabId?: string;
  tabs: SftpTransferHostTab[];
}) {
  if (currentTabId === localTabId) {
    return localTabId;
  }
  if (tabs.some((tab) => tab.id === currentTabId)) {
    return currentTabId;
  }
  return localTabId;
}

export function createHostTab(
  side: SftpTransferHostSide,
  hostId: string,
  {
    createTabId = defaultHostTabId,
    locked = false,
  }: {
    createTabId?: SftpTransferHostTabIdFactory;
    locked?: boolean;
  } = {},
): SftpTransferHostTab {
  return {
    hostId,
    id: createTabId({ hostId, locked, side }),
    locked,
  };
}

export function pruneHostTabPaths(
  pathsByTabId: Record<string, string>,
  tabs: SftpTransferHostTab[],
) {
  const tabIds = new Set(tabs.map((tab) => tab.id));
  let changed = false;
  const nextPaths: Record<string, string> = {};

  for (const [tabId, path] of Object.entries(pathsByTabId)) {
    if (tabIds.has(tabId)) {
      nextPaths[tabId] = path;
    } else {
      changed = true;
    }
  }

  return changed ? nextPaths : pathsByTabId;
}

function appendMissingFallbackHostTab({
  createTabId,
  fallbackHostId,
  hostIds,
  side,
  tabs,
}: {
  createTabId: SftpTransferHostTabIdFactory;
  fallbackHostId?: string;
  hostIds: ReadonlySet<string>;
  side: SftpTransferHostSide;
  tabs: SftpTransferHostTab[];
}) {
  if (
    !fallbackHostId ||
    !hostIds.has(fallbackHostId) ||
    tabs.some((tab) => tab.hostId === fallbackHostId)
  ) {
    return tabs;
  }
  return [
    ...tabs,
    createHostTab(side, fallbackHostId, {
      createTabId,
    }),
  ];
}

function defaultHostTabId({
  hostId,
  locked,
  side,
}: Parameters<SftpTransferHostTabIdFactory>[0]) {
  return locked
    ? `${side}-locked-${hostId}`
    : `${side}-host-${hostId}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
