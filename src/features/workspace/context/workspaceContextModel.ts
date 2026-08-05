// @author kongweiguang

import { isExternalSshMachineId } from "../../external-launch/index";
import { targetStableId, type RemoteTargetRef } from "../../../lib/targetModel";
import {
  isSftpTransferWorkspaceTab,
  isWorkspaceFileTab,
  type Machine,
  type TerminalPane,
  type TerminalTab,
} from "../types";
import {
  resolveWorkspaceTargetSelection,
  type WorkspaceTargetSelectionIssue,
} from "../workspaceTargetSelection";
import {
  buildSourceDiagnostics,
  resolveWorkspaceContextFreshness,
} from "./workspaceContextDiagnostics";
import type {
  WorkspaceContextDiagnostic,
  WorkspaceContextLocation,
  WorkspaceContextMachine,
  WorkspaceContextProjection,
  WorkspaceContextProjectionInput,
  WorkspaceContextSourceState,
  WorkspaceContextSubject,
  WorkspaceContextTarget,
} from "./workspaceContextTypes";

interface MachineLookupValue {
  machine: Machine;
  groupId: string;
}

interface ProjectionResolution {
  activeTab: TerminalTab | undefined;
  focusedPane: TerminalPane | undefined;
  machineValue: MachineLookupValue | undefined;
  activeTabPaneIds: string[];
  diagnostics: WorkspaceContextDiagnostic[];
}

/**
 * 从单次输入快照构建只读 projection。函数不缓存、不请求外部能力，也不读取
 * Zustand；调用方可以在 store selector 中安全复用。
 */
export function buildWorkspaceContextProjection(
  input: WorkspaceContextProjectionInput,
): WorkspaceContextProjection {
  const resolution = resolveProjection(input);
  const target = resolveTarget(
    resolution.activeTab,
    resolution.focusedPane,
    resolution.machineValue?.machine,
  );
  const sources = normalizeSources(input);
  const diagnostics = [
    ...resolution.diagnostics,
    ...buildSourceDiagnostics(sources),
    ...buildTargetDiagnostics(resolution.focusedPane, target),
  ];

  return {
    activeTabId: resolution.activeTab?.id ?? null,
    agent: input.agent ?? { sessionId: null, status: "unavailable" },
    diagnostics,
    focusedPaneId: resolution.focusedPane?.id ?? null,
    freshness: resolveWorkspaceContextFreshness(sources),
    generatedAt: input.generatedAt,
    location: resolveLocation(
      resolution.activeTab,
      resolution.focusedPane,
      resolution.machineValue?.machine,
    ),
    machine: toContextMachine(resolution.machineValue),
    resources: {
      activeTabPaneIds: resolution.activeTabPaneIds,
      dirtyWorkspaceFileCount: Object.values(
        input.workspaceFileDirtyState ?? {},
      ).filter(Boolean).length,
      panes: input.terminalPanes.map((pane) => ({
        focused: pane.id === resolution.focusedPane?.id,
        id: pane.id,
        machineId: pane.machineId,
        mode: pane.mode,
        status: pane.status,
        title: pane.title,
      })),
      sftpRevealRequest: input.workspaceFileRevealRequest ?? null,
      tabs: input.terminalTabs.map((tab) => ({
        active: tab.id === resolution.activeTab?.id,
        id: tab.id,
        kind: isWorkspaceFileTab(tab)
          ? "workspaceFile"
          : isSftpTransferWorkspaceTab(tab)
            ? "sftpTransfer"
            : "terminal",
        title: tab.title,
      })),
      workspaceFileCount: input.terminalTabs.filter(isWorkspaceFileTab).length,
    },
    revision: input.revision,
    runtime: {
      connectionStatus:
        resolution.focusedPane?.status ??
        resolution.machineValue?.machine.status ??
        "unknown",
      latencyMs:
        resolution.focusedPane?.latencyMs ??
        resolution.machineValue?.machine.latencyMs ??
        null,
      paneMode: resolution.focusedPane?.mode ?? null,
      tmuxAttached: Boolean(resolution.focusedPane?.tmuxBinding),
    },
    schemaVersion: 1,
    subject: resolveSubject(
      resolution.activeTab,
      resolution.focusedPane,
      resolution.machineValue?.machine,
      input.workspaceFileDirtyState ?? {},
    ),
    target,
  };
}

/**
 * 解析焦点、活动页签和机器引用。无效 id 会降级为空或相邻有效对象，
 * 同时生成诊断，避免消费者把陈旧 id 当成当前真实目标。
 */
function resolveProjection(
  input: WorkspaceContextProjectionInput,
): ProjectionResolution {
  const selection = resolveWorkspaceTargetSelection({
    activeTabId: normalizeId(input.activeTabId) ?? "",
    focusedPaneId: normalizeId(input.focusedPaneId) ?? "",
    machineGroups: input.machineGroups,
    selectedMachineId: normalizeId(input.selectedMachineId) ?? "",
    terminalPanes: input.terminalPanes,
    terminalTabs: input.terminalTabs,
  });
  const machine =
    selection.activeMachine ??
    (!selection.activeTab ? selection.selectedMachine : undefined);
  const machineValue = machine
    ? {
        groupId:
          input.machineGroups.find((group) =>
            group.machines.some((candidate) => candidate.id === machine.id),
          )?.id ??
          machine.remoteGroupId ??
          "runtime",
        machine,
      }
    : undefined;
  const diagnostics = selection.issues
    .filter(
      (issue) =>
        issue !== "selected-machine-missing" || !selection.activeMachine,
    )
    .map(diagnosticForSelectionIssue);

  return {
    activeTab: selection.activeTab,
    activeTabPaneIds: selection.activeTabPaneIds,
    diagnostics,
    focusedPane: selection.focusedPane,
    machineValue,
  };
}

function diagnosticForSelectionIssue(
  issue: WorkspaceTargetSelectionIssue,
): WorkspaceContextDiagnostic {
  const messages: Record<WorkspaceTargetSelectionIssue, string> = {
    "active-tab-missing": "活动页签已不存在，当前上下文已降级。",
    "focused-pane-missing": "焦点终端已不存在，当前上下文已降级。",
    "pane-machine-missing":
      "当前终端引用的机器已不存在，保留终端身份并降级机器信息。",
    "pane-outside-active-tab":
      "焦点终端不属于活动页签，已改用活动页签中的终端。",
    "selected-machine-missing": "选中的机器已不存在，当前上下文已降级。",
  };
  return referenceDiagnostic(issue, messages[issue]);
}

function resolveTarget(
  activeTab: TerminalTab | undefined,
  pane: TerminalPane | undefined,
  machine: Machine | undefined,
): WorkspaceContextTarget | null {
  const target = isWorkspaceFileTab(activeTab)
    ? activeTab.target
    : (pane?.target ?? machine?.target ?? inferTarget(pane, machine));
  if (!target && machine?.kind !== "rdp") {
    return null;
  }

  if (machine?.kind === "rdp") {
    return {
      hostLabel: machine.host,
      id: `rdp:${machine.id}`,
      kind: "rdp",
      label: machine.name,
    };
  }
  if (!target) {
    return null;
  }

  const external =
    target.kind === "ssh" &&
    isExternalSshMachineId(pane?.machineId ?? machine?.id ?? "");
  return {
    ...(target.kind === "dockerContainer"
      ? { containerLabel: target.containerName ?? target.containerId }
      : {}),
    ...(target.kind !== "local"
      ? { hostLabel: machine?.host ?? target.hostId }
      : {}),
    id: targetStableId(target),
    kind: external
      ? "external"
      : target.kind === "dockerContainer"
        ? "container"
        : target.kind,
    label: machine?.name ?? targetLabel(target),
    ref: target,
  };
}

function inferTarget(
  pane: TerminalPane | undefined,
  machine: Machine | undefined,
): RemoteTargetRef | undefined {
  if (pane?.mode === "local") {
    return {
      kind: "local",
      ...(pane.profileId ? { profileId: pane.profileId } : {}),
    };
  }
  if (pane?.mode === "ssh" && (pane.remoteHostId || machine?.id)) {
    return { hostId: pane.remoteHostId ?? machine!.id, kind: "ssh" };
  }
  if (pane?.mode === "telnet" && (pane.remoteHostId || machine?.id)) {
    return { hostId: pane.remoteHostId ?? machine!.id, kind: "telnet" };
  }
  if (pane?.mode === "serial" && (pane.remoteHostId || machine?.id)) {
    return { hostId: pane.remoteHostId ?? machine!.id, kind: "serial" };
  }
  if (pane?.mode === "container" && pane.containerId) {
    return {
      containerId: pane.containerId,
      hostId:
        pane.remoteHostId ?? machine?.parentMachineId ?? machine?.id ?? "local",
      kind: "dockerContainer",
      runtime: machine?.runtime,
    };
  }
  return machine?.target;
}

function targetLabel(target: RemoteTargetRef): string {
  if (target.kind === "local") {
    return target.profileId ?? "Local";
  }
  if (target.kind === "dockerContainer") {
    return target.containerName ?? target.containerId;
  }
  return target.hostId;
}

function resolveLocation(
  activeTab: TerminalTab | undefined,
  pane: TerminalPane | undefined,
  machine: Machine | undefined,
): WorkspaceContextLocation {
  if (isWorkspaceFileTab(activeTab)) {
    return locationFromPath(
      resolveWorkspaceFileParentPath(activeTab.path),
      "workspaceFile",
      "high",
    );
  }
  if (pane?.currentCwd) {
    return locationFromPath(pane.currentCwd, "osc7", "high");
  }
  if (pane?.cwd) {
    return locationFromPath(pane.cwd, "pane", "medium");
  }
  if (machine?.cwd || machine?.workdir) {
    return locationFromPath(
      machine.cwd ?? machine.workdir ?? "",
      "machineDefault",
      "low",
    );
  }
  return {
    confidence: "low",
    cwd: null,
    cwdSource: "unknown",
    pathStyle: "unknown",
  };
}

function locationFromPath(
  path: string,
  cwdSource: WorkspaceContextLocation["cwdSource"],
  confidence: WorkspaceContextLocation["confidence"],
): WorkspaceContextLocation {
  return {
    confidence,
    cwd: path,
    cwdSource,
    pathStyle:
      /^[A-Za-z]:[\\/]/.test(path) || path.includes("\\")
        ? "windows"
        : path.startsWith("/")
          ? "posix"
          : "unknown",
  };
}

/**
 * 按路径自身的格式解析工作区文件父目录，避免 Windows 前端在不同宿主平台上
 * 使用原生 path API 时误判 POSIX、盘符或 UNC 路径。
 */
function resolveWorkspaceFileParentPath(filePath: string): string {
  const normalized = filePath.trim();
  if (!normalized) {
    return "";
  }

  if (/^[A-Za-z]:[\\/]/.test(normalized)) {
    const root = normalized.slice(0, 3);
    const separatorIndex = Math.max(
      normalized.lastIndexOf("\\"),
      normalized.lastIndexOf("/"),
    );
    return separatorIndex < root.length
      ? root
      : normalized.slice(0, separatorIndex);
  }

  if (/^(?:\\\\|\/\/)[^\\/]+[\\/][^\\/]+/.test(normalized)) {
    const segments = normalized.split(/[\\/]+/).filter(Boolean);
    const prefix = normalized.startsWith("\\\\") ? "\\\\" : "//";
    return segments.length <= 2
      ? `${prefix}${segments.join("\\")}`
      : `${prefix}${segments.slice(0, -1).join("\\")}`;
  }

  if (normalized.startsWith("/")) {
    const separatorIndex = normalized.lastIndexOf("/");
    return separatorIndex <= 0 ? "/" : normalized.slice(0, separatorIndex);
  }

  const separatorIndex = Math.max(
    normalized.lastIndexOf("\\"),
    normalized.lastIndexOf("/"),
  );
  return separatorIndex < 0 ? "." : normalized.slice(0, separatorIndex) || ".";
}

function resolveSubject(
  activeTab: TerminalTab | undefined,
  pane: TerminalPane | undefined,
  machine: Machine | undefined,
  dirtyState: Readonly<Record<string, boolean>>,
): WorkspaceContextSubject {
  if (isWorkspaceFileTab(activeTab)) {
    return {
      dirty: Boolean(dirtyState[activeTab.id]),
      filePath: activeTab.path,
      id: activeTab.id,
      kind: "workspaceFile",
      title: activeTab.title,
    };
  }
  if (isSftpTransferWorkspaceTab(activeTab)) {
    return {
      id: activeTab.id,
      kind: "sftpTransfer",
      title: activeTab.title,
    };
  }
  if (pane) {
    return { id: pane.id, kind: "terminalPane", title: pane.title };
  }
  if (machine) {
    return { id: machine.id, kind: "machine", title: machine.name };
  }
  return { id: null, kind: "empty", title: "未选择上下文" };
}

function toContextMachine(
  value: MachineLookupValue | undefined,
): WorkspaceContextMachine | null {
  if (!value) {
    return null;
  }
  return {
    groupId: value.groupId,
    id: value.machine.id,
    kind: value.machine.kind,
    name: value.machine.name,
    status: value.machine.status,
  };
}

function normalizeSources(
  input: WorkspaceContextProjectionInput,
): readonly WorkspaceContextSourceState[] {
  if (input.sources?.some((source) => source.source === "workspace")) {
    return [...input.sources];
  }
  return [
    {
      revision: input.revision,
      source: "workspace",
      status: "available",
      updatedAt: input.generatedAt,
    },
    ...(input.sources ?? []),
  ];
}

function buildTargetDiagnostics(
  pane: TerminalPane | undefined,
  target: WorkspaceContextTarget | null,
): WorkspaceContextDiagnostic[] {
  if (!pane || !target || pane.mode === "preview") {
    return [];
  }
  const expectedKind = pane.mode === "container" ? "container" : pane.mode;
  if (
    target.kind === expectedKind ||
    (pane.mode === "ssh" && target.kind === "external")
  ) {
    return [];
  }
  return [
    referenceDiagnostic(
      "target-kind-mismatch",
      "终端模式与目标类型不一致，涉及写入的动作应重新确认目标。",
    ),
  ];
}

function referenceDiagnostic(
  code: Extract<
    WorkspaceContextDiagnostic["code"],
    | "active-tab-missing"
    | "focused-pane-missing"
    | "pane-outside-active-tab"
    | "selected-machine-missing"
    | "pane-machine-missing"
    | "target-kind-mismatch"
  >,
  summary: string,
): WorkspaceContextDiagnostic {
  return {
    code,
    id: `workspace:${code}`,
    recoverable: true,
    severity: "warning",
    summary,
  };
}

function normalizeId(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized || null;
}
