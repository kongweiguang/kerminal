import { describe, expect, it } from "vitest";
import { createDefaultSshOptions, type RemoteHost } from "../../../src/lib/remoteHostApi";
import type { Machine, MachineGroup } from "../../../src/features/workspace/types";
import {
  resolveConnectionEditConflict,
  resolveRemoteGroupEditConflict,
  shouldKeepSettingsEditorDraft,
} from "../../../src/app/configDirtyGuardModel";

const host: RemoteHost = {
  authType: "agent",
  createdAt: "1",
  groupId: "group-dev",
  host: "10.0.0.8",
  id: "host-1",
  name: "dev-api",
  port: 22,
  protocol: "ssh",
  production: false,
  sortOrder: 10,
  sshOptions: createDefaultSshOptions(),
  tags: ["ssh"],
  updatedAt: "1",
  username: "deploy",
};

const machine: Machine = {
  authType: "agent",
  description: "deploy@10.0.0.8:22",
  host: "10.0.0.8",
  id: "host-1",
  kind: "ssh",
  name: "dev-api",
  port: 22,
  production: false,
  remoteGroupId: "group-dev",
  sortOrder: 10,
  status: "offline",
  tags: ["ssh"],
  updatedAt: "1",
  username: "deploy",
};

describe("configDirtyGuardModel", () => {
  it("keeps a settings editor draft after user edits or failed saves", () => {
    expect(
      shouldKeepSettingsEditorDraft({
        dialogOpen: true,
        dirty: true,
        saveState: "saved",
      }),
    ).toBe(true);
    expect(
      shouldKeepSettingsEditorDraft({
        dialogOpen: true,
        dirty: false,
        saveState: "error",
      }),
    ).toBe(true);
    expect(
      shouldKeepSettingsEditorDraft({
        dialogOpen: false,
        dirty: true,
        saveState: "saving",
      }),
    ).toBe(false);
  });

  it("detects changed and deleted remote host edit targets", () => {
    expect(
      resolveConnectionEditConflict({
        editingHost: host,
        groups: [groupWithMachines([machine])],
      }),
    ).toBeNull();

    expect(
      resolveConnectionEditConflict({
        editingHost: host,
        groups: [
          groupWithMachines([
            {
              ...machine,
              name: "dev-api-renamed",
              updatedAt: "2",
            },
          ]),
        ],
      })?.message,
    ).toBe("当前主机已在外部更新，请关闭后重新打开。");

    expect(
      resolveConnectionEditConflict({
        editingHost: host,
        groups: [groupWithMachines([])],
      })?.message,
    ).toBe("当前主机已在外部删除，请关闭后重新打开。");
  });

  it("detects changed and deleted group edit targets", () => {
    const group = groupWithMachines([]);

    expect(
      resolveRemoteGroupEditConflict({
        group,
        groups: [group],
      }),
    ).toBeNull();

    expect(
      resolveRemoteGroupEditConflict({
        group,
        groups: [{ ...group, title: "prod", updatedAt: "2" }],
      })?.message,
    ).toBe("当前主机分组已在外部更新，请关闭后重新打开。");

    expect(
      resolveRemoteGroupEditConflict({
        group,
        groups: [],
      })?.message,
    ).toBe("当前主机分组已在外部删除，请关闭后重新打开。");
  });

  it("keeps edit conflict messages in user language", () => {
    const messages = [
      resolveConnectionEditConflict({
        editingHost: host,
        groups: [groupWithMachines([])],
      })?.message,
      resolveRemoteGroupEditConflict({
        group: groupWithMachines([]),
        groups: [],
      })?.message,
    ];

    for (const message of messages) {
      expect(message).toBeDefined();
      expect(message).toContain("请关闭后重新打开");
      expect(message).not.toMatch(/cfg:|externally|close \+ reopen/i);
    }
  });
});

function groupWithMachines(machines: Machine[]): MachineGroup {
  return {
    id: "group-dev",
    machines,
    sortOrder: 10,
    title: "dev",
    updatedAt: "1",
  };
}
