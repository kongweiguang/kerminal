/**
 * @author kongweiguang
 */

import { describe, expect, it, vi } from "vitest";
import type { MachineGroup } from "../../../../src/features/workspace/types";
import {
  collectSshMachines,
  createHostTab,
  firstValidHostId,
  pruneHostTabPaths,
  reconcileHostTabs,
  resolveActivePaneTabId,
  resolveActiveHostTabId,
  SFTP_TRANSFER_LOCAL_TAB_ID,
  type SftpTransferHostTabIdFactory,
} from "../../../../src/features/sftp/sftpTransferWorkbenchModel";

const stableTabId: SftpTransferHostTabIdFactory = ({
  hostId,
  locked,
  side,
}) => (locked ? `${side}-locked-${hostId}` : `${side}-${hostId}`);

const machineGroups: MachineGroup[] = [
  {
    id: "group-main",
    machines: [
      {
        description: "root@left.internal:22",
        id: "host-left",
        kind: "ssh",
        name: "left",
        status: "offline",
        tags: ["ssh"],
      },
      {
        description: "local profile",
        id: "local-default",
        kind: "local",
        name: "local",
        status: "online",
        tags: ["local"],
      },
    ],
    title: "主机",
  },
  {
    id: "group-backup",
    machines: [
      {
        description: "root@backup.internal:22",
        id: "host-backup",
        kind: "ssh",
        name: "backup",
        status: "offline",
        tags: ["ssh"],
      },
      {
        description: "SFTP · upload@files.internal:22",
        id: "host-files",
        kind: "sftp",
        name: "files-only",
        status: "offline",
        tags: ["files"],
      },
    ],
    title: "备份",
  },
];

describe("sftpTransferWorkbenchModel", () => {
  it("collects SSH machines and resolves the first valid host candidate", () => {
    const sshMachines = collectSshMachines(machineGroups);
    const hostIds = new Set(sshMachines.map((machine) => machine.id));

    expect(sshMachines.map((machine) => machine.id)).toEqual([
      "host-left",
      "host-backup",
      "host-files",
    ]);
    expect(firstValidHostId(hostIds, "missing", undefined, "host-backup")).toBe(
      "host-backup",
    );
    expect(firstValidHostId(hostIds, "missing")).toBeUndefined();
  });

  it("keeps one locked source tab first and appends a valid fallback host", () => {
    const nextTabs = reconcileHostTabs({
      createTabId: stableTabId,
      fallbackHostId: "host-right",
      hostIds: new Set(["host-left", "host-backup", "host-right"]),
      lockedHostId: "host-left",
      side: "right",
      tabs: [
        { hostId: "host-left", id: "old-unlocked-left" },
        { hostId: "host-backup", id: "existing-backup" },
        { hostId: "removed", id: "removed-tab" },
      ],
    });

    expect(nextTabs).toEqual([
      { hostId: "host-left", id: "right-locked-host-left", locked: true },
      { hostId: "host-backup", id: "existing-backup" },
      { hostId: "host-right", id: "right-host-right", locked: false },
    ]);
  });

  it("preserves duplicate host tabs and skips the id factory when no tab is created", () => {
    const createTabId = vi.fn(stableTabId);
    const duplicateTabs = [
      { hostId: "host-right", id: "right-tab-1" },
      { hostId: "host-right", id: "right-tab-2" },
    ];

    expect(
      reconcileHostTabs({
        createTabId,
        fallbackHostId: "host-right",
        hostIds: new Set(["host-right"]),
        side: "right",
        tabs: duplicateTabs,
      }),
    ).toEqual(duplicateTabs);
    expect(createTabId).not.toHaveBeenCalled();
  });

  it("filters removed hosts and does not create tabs when no valid SSH host remains", () => {
    expect(
      reconcileHostTabs({
        createTabId: stableTabId,
        fallbackHostId: "host-right",
        hostIds: new Set(["host-backup"]),
        side: "right",
        tabs: [
          { hostId: "host-right", id: "stale-right" },
          { hostId: "host-backup", id: "existing-backup" },
        ],
      }),
    ).toEqual([{ hostId: "host-backup", id: "existing-backup" }]);

    expect(
      reconcileHostTabs({
        createTabId: stableTabId,
        fallbackHostId: "host-right",
        hostIds: new Set(),
        lockedHostId: "host-left",
        side: "right",
        tabs: [{ hostId: "host-right", id: "stale-right" }],
      }),
    ).toEqual([]);
  });

  it("resolves active host tabs without reviving stale tab ids", () => {
    const tabs = [
      createHostTab("right", "host-left", { createTabId: stableTabId }),
      createHostTab("right", "host-right", { createTabId: stableTabId }),
    ];

    expect(
      resolveActiveHostTabId({
        currentTabId: "right-host-left",
        preferredHostId: "host-right",
        tabs,
      }),
    ).toBe("right-host-left");
    expect(
      resolveActiveHostTabId({
        currentTabId: "removed-tab",
        preferredHostId: "host-right",
        tabs,
      }),
    ).toBe("right-host-right");
    expect(
      resolveActiveHostTabId({
        currentTabId: "removed-tab",
        preferredHostId: "missing",
        tabs,
      }),
    ).toBe("right-host-left");
    expect(
      resolveActiveHostTabId({
        currentTabId: "removed-tab",
        tabs: [],
      }),
    ).toBe("");
  });

  it("resolves active pane tabs back to the local fallback", () => {
    const tabs = [
      createHostTab("left", "host-left", { createTabId: stableTabId }),
      createHostTab("left", "host-backup", { createTabId: stableTabId }),
    ];

    expect(
      resolveActivePaneTabId({
        currentTabId: SFTP_TRANSFER_LOCAL_TAB_ID,
        tabs,
      }),
    ).toBe(SFTP_TRANSFER_LOCAL_TAB_ID);
    expect(
      resolveActivePaneTabId({
        currentTabId: "left-host-backup",
        tabs,
      }),
    ).toBe("left-host-backup");
    expect(
      resolveActivePaneTabId({
        currentTabId: "removed-tab",
        tabs,
      }),
    ).toBe(SFTP_TRANSFER_LOCAL_TAB_ID);
    expect(
      resolveActivePaneTabId({
        currentTabId: "",
        tabs: [],
      }),
    ).toBe(SFTP_TRANSFER_LOCAL_TAB_ID);
  });

  it("prunes per-tab current paths for removed host tabs", () => {
    const paths = {
      "right-host-left": "/tmp",
      "right-host-right": "/srv",
      "stale-tab": "/old",
    };

    expect(
      pruneHostTabPaths(paths, [
        { hostId: "host-left", id: "right-host-left" },
        { hostId: "host-right", id: "right-host-right" },
      ]),
    ).toEqual({
      "right-host-left": "/tmp",
      "right-host-right": "/srv",
    });

    const stablePaths = { "right-host-left": "/tmp" };
    expect(
      pruneHostTabPaths(stablePaths, [
        { hostId: "host-left", id: "right-host-left" },
      ]),
    ).toBe(stablePaths);
  });
});
