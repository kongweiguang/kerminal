// @author kongweiguang

import { describe, expect, it } from "vitest";

import type { MachineGroup } from "../../../src/features/workspace/types";
import {
  buildKerminalShellRemoteTargetModel,
  buildKerminalShellViewModel,
} from "../../../src/app/kerminalShellViewModel";

const groups: MachineGroup[] = [
  { id: "local", title: "本地", machines: [] },
  {
    id: "remote-fallback",
    title: "其他",
    machines: [
      {
        description: "fallback.example.com",
        id: "fallback-host",
        kind: "ssh",
        name: "Fallback",
        status: "online",
        tags: [],
      },
    ],
  },
  {
    id: "remote-default",
    title: "默认分组",
    machines: [],
  },
];

/** 为视图模型测试提供最小稳定壳状态，单个用例只覆盖自身差异。 */
function build(overrides: Partial<Parameters<typeof buildKerminalShellViewModel>[0]> = {}) {
  return buildKerminalShellViewModel({
    activeTool: "settings",
    compactShell: false,
    effectiveLeftPanelCollapsed: false,
    interfaceDensity: "comfortable",
    machineGroups: groups,
    profileLoadError: null,
    remoteHostLoadError: null,
    settingsLoadError: null,
    workspaceSessionPersistenceNotice: null,
    windowChrome: {
      controlMode: "custom",
      frameRadiusMode: "rounded",
      reserveTrafficLightInset: false,
      showMaximizeControl: true,
      showRestoreIcon: false,
    },
    ...overrides,
  });
}

describe("buildKerminalShellViewModel", () => {
  it("稳定选择默认远程分组和首个 SSH 主机", () => {
    const model = buildKerminalShellRemoteTargetModel(groups);

    expect(model.defaultRemoteGroupId).toBe("remote-default");
    expect(model.defaultRemoteHostId).toBe("fallback-host");
  });

  it("按显示状态和平台模型计算窗口留白", () => {
    expect(build().rightToolRailTitleBarFillWidth).toBe(48);
    expect(build().rightTitleBarInset).toBe(112);
    expect(build({ interfaceDensity: "spacious" }).rightToolRailTitleBarFillWidth).toBe(56);
    expect(build({ compactShell: true }).rightToolRailTitleBarFillWidth).toBe(44);
    expect(
      build({
        windowChrome: {
          controlMode: "native",
          frameRadiusMode: "native",
          reserveTrafficLightInset: false,
          showMaximizeControl: false,
          showRestoreIcon: false,
        },
      }).rightTitleBarInset,
    ).toBe(56);
    expect(
      build({
        effectiveLeftPanelCollapsed: true,
        windowChrome: {
          controlMode: "native",
          frameRadiusMode: "native",
          reserveTrafficLightInset: true,
          showMaximizeControl: false,
          showRestoreIcon: false,
        },
      }).leftTitleBarInset,
    ).toBe(112);
  });

  it("保持启动错误优先级并暴露外部配置冲突", () => {
    const model = build({
      editingRemoteGroup: groups[1],
      machineGroups: groups.filter((group) => group.id !== "remote-fallback"),
      profileLoadError: "profile",
      remoteHostLoadError: "remote",
      settingsLoadError: "settings",
    });

    expect(model.shellNoticeMessage).toBe("profile");
    expect(model.remoteGroupConfigConflict?.message).toContain("外部删除");
  });

  it("Session 数据保护告警优先于普通配置加载错误", () => {
    expect(
      build({
        profileLoadError: "profile",
        workspaceSessionPersistenceNotice: "session blocked",
      }).shellNoticeMessage,
    ).toBe("session blocked");
  });
});
