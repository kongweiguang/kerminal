// @author kongweiguang

import { describe, expect, it } from "vitest";
import type { Machine } from "../../../../src/features/workspace/types";
import { serverInfoTargetContext } from "../../../../src/features/tool-panel/serverInfoTargetModel";

describe("serverInfoTargetModel", () => {
  it("builds an SSH server info target with endpoint labels", () => {
    const machine: Machine = {
      description: "deploy@prod.internal:22",
      host: "prod.internal",
      id: "prod-api",
      kind: "ssh",
      name: "prod api",
      port: 22,
      status: "online",
      tags: [],
      username: "deploy",
    };

    expect(serverInfoTargetContext(machine)).toMatchObject({
      cacheKey: "ssh:prod-api",
      hostId: "prod-api",
      refreshAriaLabel: "刷新服务器信息",
      subtitle: "deploy@prod.internal:22",
      target: { hostId: "prod-api", kind: "ssh" },
      title: "远程服务器",
    });
  });

  it("builds a docker container target from machine metadata", () => {
    const machine: Machine = {
      containerId: "c0ffee1234567890",
      containerName: "api",
      description: "prod api / api",
      host: "prod.internal",
      id: "docker:prod-api:c0ffee1234567890",
      kind: "dockerContainer",
      name: "api",
      parentMachineId: "prod-api",
      runtime: "docker",
      status: "online",
      tags: [],
      username: "deploy",
      workdir: "/app",
    };

    const context = serverInfoTargetContext(machine);
    expect(context).toMatchObject({
      cacheKey: "docker:prod-api:c0ffee1234567890",
      hostId: "prod-api",
      refreshAriaLabel: "刷新容器系统信息",
      subtitle: "api · docker @ deploy@prod.internal",
      target: {
        containerId: "c0ffee1234567890",
        containerName: "api",
        hostId: "prod-api",
        kind: "dockerContainer",
        runtime: "docker",
        workdir: "/app",
      },
      title: "容器系统",
    });
    expect(context?.badgeText).toBeUndefined();
  });

  it("omits badges for SSH targets", () => {
    const machine: Machine = {
      description: "dev@dev.internal:22",
      host: "dev.internal",
      id: "dev-api",
      kind: "ssh",
      name: "dev api",
      port: 22,
      status: "online",
      tags: [],
      username: "dev",
    };

    expect(serverInfoTargetContext(machine)?.badgeText).toBeUndefined();
  });

  it("builds a local system target from the active terminal profile", () => {
    expect(
      serverInfoTargetContext({
        description: "PowerShell 7",
        id: "profile:powershell",
        kind: "local",
        name: "PowerShell",
        profileId: "powershell",
        shell: "pwsh.exe",
        status: "online",
        tags: [],
        target: { kind: "local", profileId: "powershell" },
      }),
    ).toEqual({
      cacheKey: "local:powershell",
      hostId: "profile:powershell",
      refreshAriaLabel: "刷新本机系统信息",
      subtitle: "PowerShell · pwsh.exe",
      target: { kind: "local", profileId: "powershell" },
      title: "本机系统",
    });
  });

  it("returns no target for incomplete containers", () => {
    expect(
      serverInfoTargetContext({
        description: "missing parent/container",
        id: "container",
        kind: "dockerContainer",
        name: "Container",
        status: "offline",
        tags: [],
      }),
    ).toBeUndefined();
  });
});
