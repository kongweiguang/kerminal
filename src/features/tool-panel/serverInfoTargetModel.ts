// @author kongweiguang

import { targetStableId, type RemoteTargetRef } from "../../lib/targetModel";
import type { Machine } from "../workspace/contracts/index";

/** 系统信息面板当前支持的本机、SSH 主机和容器目标。 */
type ServerInfoTargetRef =
  | Extract<RemoteTargetRef, { kind: "local" }>
  | Extract<RemoteTargetRef, { kind: "ssh" }>
  | Extract<RemoteTargetRef, { kind: "dockerContainer" }>;

/** 系统信息展示与采集共享的稳定目标上下文。 */
export interface ServerInfoTargetContext {
  badgeText?: string;
  cacheKey: string;
  hostId: string;
  refreshAriaLabel: string;
  subtitle: string;
  target: ServerInfoTargetRef;
  title: string;
}

/** 系统面板没有可绑定目标时仍展示本机，并复用统一监控工作台。 */
export function defaultLocalServerInfoTargetContext(): ServerInfoTargetContext {
  const target: ServerInfoTargetRef = { kind: "local" };
  return {
    cacheKey: targetStableId(target),
    hostId: "local",
    refreshAriaLabel: "刷新本机系统信息",
    subtitle: "本地终端",
    target,
    title: "本机系统",
  };
}

/** 从当前工作区机器解析系统信息目标；不支持的目标返回空。 */
export function serverInfoTargetContext(
  selectedMachine?: Machine,
): ServerInfoTargetContext | undefined {
  if (!selectedMachine) {
    return undefined;
  }
  if (selectedMachine.kind === "local") {
    const target: ServerInfoTargetRef =
      selectedMachine.target?.kind === "local"
        ? selectedMachine.target
        : {
            kind: "local",
            ...(selectedMachine.profileId
              ? { profileId: selectedMachine.profileId }
              : {}),
          };
    return {
      cacheKey: targetStableId(target),
      hostId: selectedMachine.id,
      refreshAriaLabel: "刷新本机系统信息",
      subtitle: localSystemSubtitle(selectedMachine),
      target,
      title: "本机系统",
    };
  }
  if (selectedMachine.kind === "ssh") {
    const target: ServerInfoTargetRef =
      selectedMachine.target?.kind === "ssh"
        ? selectedMachine.target
        : { hostId: selectedMachine.id, kind: "ssh" };
    const endpoint = selectedMachine.host
      ? `${selectedMachine.username ? `${selectedMachine.username}@` : ""}${selectedMachine.host}${selectedMachine.port ? `:${selectedMachine.port}` : ""}`
      : undefined;
    return {
      cacheKey: targetStableId(target),
      hostId: target.hostId,
      refreshAriaLabel: "刷新服务器信息",
      subtitle: endpoint ?? "SSH 主机",
      target,
      title: "远程服务器",
    };
  }
  if (selectedMachine.kind === "dockerContainer") {
    const target: ServerInfoTargetRef | undefined =
      selectedMachine.target?.kind === "dockerContainer"
        ? selectedMachine.target
        : selectedMachine.parentMachineId && selectedMachine.containerId
          ? {
              containerId: selectedMachine.containerId,
              ...(selectedMachine.containerName
                ? { containerName: selectedMachine.containerName }
                : {}),
              hostId: selectedMachine.parentMachineId,
              kind: "dockerContainer",
              runtime: selectedMachine.runtime ?? "docker",
              ...(selectedMachine.user ? { user: selectedMachine.user } : {}),
              ...(selectedMachine.workdir
                ? { workdir: selectedMachine.workdir }
                : {}),
            }
          : undefined;
    if (!target || target.kind !== "dockerContainer") {
      return undefined;
    }
    const runtime = target.runtime ?? selectedMachine.runtime ?? "docker";
    const containerName =
      target.containerName ??
      selectedMachine.containerName ??
      selectedMachine.name ??
      target.containerId.slice(0, 12);
    const hostLabel = selectedMachine.host
      ? `${selectedMachine.username ? `${selectedMachine.username}@` : ""}${selectedMachine.host}`
      : target.hostId;
    return {
      cacheKey: targetStableId(target),
      hostId: target.hostId,
      refreshAriaLabel: "刷新容器系统信息",
      subtitle: `${containerName} · ${runtime} @ ${hostLabel}`,
      target,
      title: "容器系统",
    };
  }
  return undefined;
}

/** 生成本机目标的紧凑说明，避免名称、Shell 和描述重复显示。 */
function localSystemSubtitle(machine: Machine) {
  const detail = machine.shell ?? machine.description;
  return detail && detail !== machine.name
    ? `${machine.name} · ${detail}`
    : machine.name || "本地终端";
}
