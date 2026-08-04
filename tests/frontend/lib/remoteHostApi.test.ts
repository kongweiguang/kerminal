// @author kongweiguang

import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
const isTauriMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  isTauri: () => isTauriMock(),
}));

describe("remoteHostApi", () => {
  beforeEach(() => {
    vi.resetModules();
    invokeMock.mockReset();
    isTauriMock.mockReset();
    window.history.replaceState({}, "", "/");
  });

  it("lists the remote host tree through Tauri", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValue([
      {
        createdAt: "now",
        hosts: [],
        id: "group-1",
        name: "虚拟机",
        sortOrder: 10,
        updatedAt: "now",
      },
    ]);
    const { listRemoteHostTree } = await import("../../../src/lib/remoteHostApi");

    const tree = await listRemoteHostTree();

    expect(tree[0].name).toBe("虚拟机");
    expect(invokeMock).toHaveBeenCalledWith("remote_host_tree");
  });

  it("normalizes create host requests", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValue({
      authType: "agent",
      createdAt: "now",
      groupId: "group-1",
      host: "dev.internal",
      id: "host-1",
      name: "dev",
      port: 22,
      sortOrder: 10,
      tags: [],
      updatedAt: "now",
      username: "deploy",
    });
    const { createDefaultSshOptions, createRemoteHost } = await import(
      "../../../src/lib/remoteHostApi"
    );

    await createRemoteHost({
      groupId: "group-1",
      host: "dev.internal",
      name: "dev",
      username: "deploy",
    });

    expect(invokeMock).toHaveBeenCalledWith("remote_host_create", {
      request: {
        authType: "agent",
        credentialRef: undefined,
        credentialSecret: undefined,
        groupId: "group-1",
        host: "dev.internal",
        name: "dev",
        port: 22,
        protocol: "ssh",
        sshOptions: createDefaultSshOptions(),
        tags: [],
        username: "deploy",
      },
    });
  });

  it("preserves private key passphrase mutation semantics across Tauri IPC", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValue({});
    const { createRemoteHost, updateRemoteHost } = await import(
      "../../../src/lib/remoteHostApi"
    );

    await createRemoteHost({
      authType: "key",
      credentialRef: "/home/deploy/.ssh/id_ed25519",
      host: "key.internal",
      keyPassphraseSecret: "   ",
      name: "key host",
      username: "deploy",
    });
    expect(invokeMock).toHaveBeenLastCalledWith("remote_host_create", {
      request: expect.objectContaining({
        authType: "key",
        keyPassphraseSecret: "   ",
      }),
    });

    await updateRemoteHost({
      authType: "key",
      clearKeyPassphrase: true,
      credentialRef: "/home/deploy/.ssh/id_ed25519",
      host: "key.internal",
      id: "host-1",
      name: "key host",
      sortOrder: 10,
      username: "deploy",
    });
    expect(invokeMock).toHaveBeenLastCalledWith("remote_host_update", {
      request: expect.objectContaining({
        authType: "key",
        clearKeyPassphrase: true,
      }),
    });
  });

  it("normalizes ungrouped create host requests", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValue({
      authType: "agent",
      createdAt: "now",
      groupId: undefined,
      host: "dev.internal",
      id: "host-1",
      name: "dev",
      port: 22,
      sortOrder: 10,
      tags: [],
      updatedAt: "now",
      username: "deploy",
    });
    const { createDefaultSshOptions, createRemoteHost } = await import(
      "../../../src/lib/remoteHostApi"
    );

    await createRemoteHost({
      host: "dev.internal",
      name: "dev",
      username: "deploy",
    });

    expect(invokeMock).toHaveBeenCalledWith("remote_host_create", {
      request: {
        authType: "agent",
        credentialRef: undefined,
        credentialSecret: undefined,
        groupId: undefined,
        host: "dev.internal",
        name: "dev",
        port: 22,
        protocol: "ssh",
        sshOptions: createDefaultSshOptions(),
        tags: [],
        username: "deploy",
      },
    });
  });

  it("reveals a saved credential through Tauri", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValue({
      authType: "password",
      credentialSecret: "s3cr3t",
      hostId: "host-1",
      status: "available",
    });
    const { revealRemoteHostCredential } = await import("../../../src/lib/remoteHostApi");

    await expect(revealRemoteHostCredential("host-1")).resolves.toMatchObject({
      credentialSecret: "s3cr3t",
      status: "available",
    });
    expect(invokeMock).toHaveBeenCalledWith("remote_host_reveal_credential", {
      hostId: "host-1",
    });
  });

  it("starts with an empty browser remote host tree outside Tauri", async () => {
    isTauriMock.mockReturnValue(false);
    const { listRemoteHostTree } = await import("../../../src/lib/remoteHostApi");

    await expect(listRemoteHostTree()).resolves.toEqual([]);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("provides a deterministic system-info target only in preview mode", async () => {
    isTauriMock.mockReturnValue(false);
    window.history.replaceState({}, "", "/?preview=system-info");
    const { listRemoteHostTree } = await import("../../../src/lib/remoteHostApi");

    const tree = await listRemoteHostTree();

    expect(tree).toHaveLength(1);
    expect(tree[0]).toMatchObject({
      id: "group-preview-infrastructure",
      name: "基础设施",
    });
    expect(tree[0].hosts[0]).toMatchObject({
      authType: "agent",
      host: "preview.internal",
      id: "prod-api",
      name: "API 服务",
      username: "deploy",
    });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("creates browser preview hosts in the default group outside Tauri", async () => {
    isTauriMock.mockReturnValue(false);
    const { createRemoteHost, listRemoteHostTree } = await import(
      "../../../src/lib/remoteHostApi"
    );

    const host = await createRemoteHost({
      host: "dev.internal",
      name: "dev",
      username: "deploy",
    });

    const tree = await listRemoteHostTree();
    expect(tree).toHaveLength(1);
    expect(tree[0]).toMatchObject({
      id: "__ungrouped__",
      name: "默认分组",
    });
    expect(tree[0].hosts[0]).toMatchObject({
      groupId: undefined,
      id: host.id,
      name: "dev",
    });
  });

  it("moves browser preview hosts to ungrouped when deleting a group", async () => {
    isTauriMock.mockReturnValue(false);
    const {
      createRemoteHost,
      createRemoteHostGroup,
      deleteRemoteHostGroup,
      listRemoteHostTree,
    } = await import("../../../src/lib/remoteHostApi");

    const group = await createRemoteHostGroup({ name: "开发主机" });
    const host = await createRemoteHost({
      groupId: group.id,
      host: "dev.internal",
      name: "dev",
      username: "deploy",
    });

    await expect(deleteRemoteHostGroup(group.id)).resolves.toBe(true);

    const tree = await listRemoteHostTree();
    expect(tree.map((item) => item.id)).toEqual(["__ungrouped__"]);
    expect(tree[0].hosts[0]).toMatchObject({
      groupId: undefined,
      id: host.id,
      name: "dev",
    });
  });

  it("returns browser preview groups and hosts sorted by sort order", async () => {
    isTauriMock.mockReturnValue(false);
    const {
      createRemoteHost,
      createRemoteHostGroup,
      listRemoteHostTree,
      updateRemoteHost,
      updateRemoteHostGroup,
    } = await import("../../../src/lib/remoteHostApi");

    const firstGroup = await createRemoteHostGroup({ name: "First" });
    const pinnedGroup = await createRemoteHostGroup({ name: "Pinned" });
    const firstHost = await createRemoteHost({
      groupId: firstGroup.id,
      host: "first.internal",
      name: "first",
      username: "deploy",
    });
    const pinnedHost = await createRemoteHost({
      groupId: firstGroup.id,
      host: "pinned.internal",
      name: "pinned",
      username: "deploy",
    });

    await updateRemoteHostGroup({
      id: pinnedGroup.id,
      name: pinnedGroup.name,
      sortOrder: -10,
    });
    await updateRemoteHost({
      authType: "agent",
      groupId: firstGroup.id,
      host: pinnedHost.host,
      id: pinnedHost.id,
      name: pinnedHost.name,
      sortOrder: -10,
      tags: [],
      username: pinnedHost.username,
    });

    const tree = await listRemoteHostTree();
    expect(tree.map((group) => group.id)).toEqual([
      pinnedGroup.id,
      firstGroup.id,
    ]);
    expect(tree[1].hosts.map((host) => host.id)).toEqual([
      pinnedHost.id,
      firstHost.id,
    ]);
  });

  it("stores credential secrets in browser preview host state", async () => {
    isTauriMock.mockReturnValue(false);
    const {
      createRemoteHost,
      listRemoteHostTree,
      revealRemoteHostCredential,
      updateRemoteHost,
    } = await import("../../../src/lib/remoteHostApi");

    const host = await createRemoteHost({
      authType: "password",
      credentialSecret: "s3cr3t",
      host: "secret.internal",
      name: "secret",
      username: "deploy",
    });
    expect(host.credentialSecret).toBe("s3cr3t");
    await expect(listRemoteHostTree()).resolves.toMatchObject([
      {
        hosts: [
          {
            credentialSecret: "s3cr3t",
          },
        ],
      },
    ]);

    await updateRemoteHost({
      ...host,
      credentialSecret: "updated-s3cr3t",
      sortOrder: host.sortOrder,
    });

    const tree = await listRemoteHostTree();
    expect(tree[0].hosts[0]).toMatchObject({
      authType: "password",
      credentialRef: undefined,
      credentialSecret: "updated-s3cr3t",
      host: "secret.internal",
      name: "secret",
    });
    await expect(revealRemoteHostCredential(host.id)).resolves.toMatchObject({
      credentialSecret: "updated-s3cr3t",
      status: "available",
    });
  });
});
