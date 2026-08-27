// @author kongweiguang

import {
  collectPaneIds,
  findFirstPaneId,
} from "./workspaceLayout";
import type {
  Machine,
  MachineStatus,
  LocalMachineScope,
  TerminalLayoutNode,
  TerminalPane,
  TerminalSplitLayoutSizes,
  TerminalTab,
  TerminalTabGroups,
  TerminalTabGroupPreferences,
} from "./types";
import type { TmuxPaneBinding } from "../../lib/tmuxApi";
import {
  isTerminalTabGroupColor,
  isSftpTransferWorkspaceTab,
  isTerminalSessionTab,
  isWorkspaceFileTab,
} from "./types";
import {
  legacyPreferencesFromGroups,
  migrateTerminalTabGroups,
  normalizeTerminalTabGroupPreferences,
} from "./workspaceSessionTabGroupMigration";
import {
  dockerContainerTarget,
  localTarget,
  normalizeRemoteTargetRef,
} from "../../lib/targetModel";
import {
  normalizeWorkspaceFilePath,
  titleForWorkspaceFilePath,
  workspaceFileMachineId,
  workspaceFileTargetHostId,
} from "./workspaceFileTabModel";
import { runtimeCompatibilityDiagnostics } from "../../platform/runtime/compatibilityDiagnostics";

export const WORKSPACE_SESSION_VERSION = 3;
export const TERMINAL_OUTPUT_HISTORY_MAX_CHARS = 128 * 1024;

export interface WorkspaceSessionSnapshot {
  activeTabId: string;
  focusedPaneId: string;
  selectedMachineId: string;
  removedSidebarMachineIds?: string[];
  shellLayout?: WorkspaceShellLayout;
  sidebarMachines: Machine[];
  terminalTabGroups?: TerminalTabGroups;
  /** @deprecated v1/v2 迁移和旧测试读取；v3 运行态以 terminalTabGroups 为准。 */
  terminalTabGroupPreferences?: TerminalTabGroupPreferences;
  terminalPanes: TerminalPane[];
  terminalTabs: TerminalTab[];
}

export type WorkspaceSessionDecodeResult =
  | { kind: "loaded"; session: WorkspaceSessionSnapshot }
  | { kind: "unsupported"; message: string; version: number }
  | { kind: "invalid"; message: string };

export type WorkspaceSessionLoadResult =
  | WorkspaceSessionDecodeResult
  | { kind: "missing" }
  | { kind: "transport-failure"; message: string };

export interface WorkspaceShellLayout {
  bottomToolPanelHeight?: number;
  collapsedMachineGroupIds?: string[];
  leftPanelCollapsed?: boolean;
  leftPanelWidth?: number;
  leftToolPanelWidth?: number;
  toolPanelWidth?: number;
}

/**
 * 将外部 session 收敛为可恢复快照；Shell 尺寸与终端资源共享同一容错边界，
 * 单个非法尺寸只被丢弃或夹紧，不能阻断用户其余会话恢复。
 */
export function normalizeWorkspaceSessionSnapshot(
  value: unknown,
): WorkspaceSessionSnapshot {
  const source = isRecord(value)
    ? (value as Partial<WorkspaceSessionSnapshot> & Record<string, unknown>)
    : null;
  const rawPanes = Array.isArray(source?.terminalPanes)
    ? source.terminalPanes
    : [];
  const terminalPanes = rawPanes
    .map(normalizeTerminalPane)
    .filter((pane): pane is TerminalPane => Boolean(pane));
  const paneIds = new Set(terminalPanes.map((pane) => pane.id));
  const rawTabs = Array.isArray(source?.terminalTabs) ? source.terminalTabs : [];
  const terminalTabs = rawTabs
    .map((tab) => normalizeTerminalTab(tab, paneIds))
    .filter((tab): tab is TerminalTab => Boolean(tab));
  const rawSidebarMachines = Array.isArray(source?.sidebarMachines)
    ? source.sidebarMachines
    : [];
  const sidebarMachines = rawSidebarMachines
    .map(normalizeSidebarMachine)
    .filter((machine): machine is Machine => Boolean(machine));
  const removedSidebarMachineIds = uniqueStrings(
    normalizeStringArray(source?.removedSidebarMachineIds) ?? [],
  );
  const legacyPreferences = normalizeTerminalTabGroupPreferences(
    source?.terminalTabGroupPreferences,
  );
  const shellLayout = normalizeWorkspaceShellLayout(source?.shellLayout);
  const migratedGroups = migrateTerminalTabGroups({
    source,
    terminalTabs,
    terminalTabGroups: normalizeTerminalTabGroups(source?.terminalTabGroups),
    legacyPreferences,
    panes: terminalPanes,
    sidebarMachines,
  });
  const referencedPaneIds = new Set(
    migratedGroups.terminalTabs.flatMap((tab) =>
      isTerminalSessionTab(tab) ? collectPaneIds(tab.layout) : [],
    ),
  );
  const referencedPanes = terminalPanes.filter((pane) =>
    referencedPaneIds.has(pane.id),
  );
  const selection = resolveWorkspaceSessionSelection({
    activeTabId: readString(source?.activeTabId),
    focusedPaneId: readString(source?.focusedPaneId),
    referencedPanes,
    selectedMachineId: readString(source?.selectedMachineId),
    terminalTabs: migratedGroups.terminalTabs,
  });

  return {
    activeTabId: selection.activeTabId,
    focusedPaneId: selection.focusedPaneId,
    selectedMachineId: selection.selectedMachineId,
    removedSidebarMachineIds,
    shellLayout,
    sidebarMachines,
    terminalTabGroups: migratedGroups.terminalTabGroups,
    terminalTabGroupPreferences:
      legacyPreferences ?? legacyPreferencesFromGroups(migratedGroups.terminalTabGroups),
    terminalPanes: selection.activeTabId ? referencedPanes : [],
    terminalTabs: migratedGroups.terminalTabs,
  };
}

/**
 * 解码文件 transport 返回的 workspace session。
 *
 * normalizer 继续隔离单个坏条目；根结构、未来版本或全部 tab 都损坏时拒绝
 * 恢复，避免把不可读的用户 session 归一化为空快照后覆盖原文件。
 */
export function decodeWorkspaceSessionSnapshot(
  value: unknown,
): WorkspaceSessionDecodeResult {
  if (!isRecord(value)) {
    return invalidWorkspaceSessionResult();
  }
  const version = value.version;
  if (version !== undefined) {
    if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
      return invalidWorkspaceSessionResult();
    }
    if (version > WORKSPACE_SESSION_VERSION) {
      return {
        kind: "unsupported",
        message: "工作区会话版本较新，原文件未覆盖；本次运行不会持久化标签变化。",
        version,
      };
    }
  }
  if (
    !Array.isArray(value.sidebarMachines) ||
    !Array.isArray(value.terminalPanes) ||
    !Array.isArray(value.terminalTabs)
  ) {
    return invalidWorkspaceSessionResult();
  }

  const normalized = normalizeWorkspaceSessionSnapshot(value);
  if (value.terminalTabs.length > 0 && normalized.terminalTabs.length === 0) {
    return invalidWorkspaceSessionResult();
  }
  if (
    value.terminalTabs.length === 0 &&
    value.sidebarMachines.length > 0 &&
    normalized.sidebarMachines.length === 0
  ) {
    return invalidWorkspaceSessionResult();
  }
  if (version === undefined || version === 1) {
    runtimeCompatibilityDiagnostics.recordActivation(
      "workspace.schema-v1-migration",
      version === 1 ? "schema-v1" : "unversioned-session",
    );
  }
  return { kind: "loaded", session: normalized };
}

/** 将根结构或关键数组损坏统一报告为安全消息，避免把内部解析细节暴露给 UI。 */
function invalidWorkspaceSessionResult(): WorkspaceSessionDecodeResult {
  return {
    kind: "invalid",
    message: "工作区会话内容无法验证，原文件未覆盖；本次运行不会持久化标签变化。",
  };
}

/** Shell 布局只接受有限尺寸，避免手改文件后把终端压缩成不可操作区域。 */
function normalizeWorkspaceShellLayout(
  value: unknown,
): WorkspaceShellLayout | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const collapsedMachineGroupIds = uniqueStrings(
    normalizeStringArray(value.collapsedMachineGroupIds) ?? [],
  ).sort();
  const shellLayout: WorkspaceShellLayout = {
    ...(collapsedMachineGroupIds.length > 0
      ? { collapsedMachineGroupIds }
      : {}),
    ...(typeof value.leftPanelCollapsed === "boolean"
      ? { leftPanelCollapsed: value.leftPanelCollapsed }
      : {}),
    ...normalizeShellLayoutSizeProperty(value.leftPanelWidth, "leftPanelWidth", {
      max: 520,
      min: 220,
    }),
    ...normalizeShellLayoutSizeProperty(value.toolPanelWidth, "toolPanelWidth", {
      max: 620,
      min: 300,
    }),
    ...normalizeShellLayoutSizeProperty(
      value.leftToolPanelWidth,
      "leftToolPanelWidth",
      {
        max: 620,
        min: 300,
      },
    ),
    ...normalizeShellLayoutSizeProperty(
      value.bottomToolPanelHeight,
      "bottomToolPanelHeight",
      {
        max: 720,
        min: 180,
      },
    ),
  };

  return Object.keys(shellLayout).length > 0 ? shellLayout : undefined;
}

/** 同一数值归一器处理宽度和高度，并保留字段级上下限的类型约束。 */
function normalizeShellLayoutSizeProperty<
  Key extends
    | "bottomToolPanelHeight"
    | "leftPanelWidth"
    | "leftToolPanelWidth"
    | "toolPanelWidth",
>(
  value: unknown,
  key: Key,
  bounds: { max: number; min: number },
): Partial<Pick<WorkspaceShellLayout, Key>> {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return {};
  }

  const size = Math.min(Math.max(Math.round(value), bounds.min), bounds.max);
  return { [key]: size } as Pick<WorkspaceShellLayout, Key>;
}

/** 从恢复快照提升 pane、split、tab 与显式组 ID 的单调计数下界。 */
export function maxGeneratedTerminalCounters(session: WorkspaceSessionSnapshot) {
  const paneCount = Math.max(
    0,
    ...session.terminalPanes.map((pane) => numericSuffix(pane.id)),
  );
  const splitCount = Math.max(
    0,
    ...session.terminalTabs.flatMap((tab) =>
      isTerminalSessionTab(tab) ? collectSplitSuffixes(tab.layout) : [],
    ),
  );
  const tabCount = Math.max(
    0,
    ...session.terminalTabs.map((tab) => numericSuffix(tab.id)),
  );
  const tabGroupCount = Math.max(
    0,
    ...Object.keys(session.terminalTabGroups ?? {}).map(numericSuffix),
  );

  return { paneCount, splitCount, tabCount, tabGroupCount };
}

export function appendTerminalOutputHistory(
  currentHistory: string | undefined,
  data: string,
) {
  if (!data) {
    return currentHistory;
  }
  return trimTerminalOutputHistory(`${currentHistory ?? ""}${data}`);
}

/**
 * 归一化持久化 pane；旧快照没有 scope 时按 sidebar 处理，以保持既有本地连接
 * 的恢复语义，新 workspace scope 则作为显式字段保留下来。
 */
function normalizeTerminalPane(value: unknown): TerminalPane | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const id = readString(value.id);
  const title = readString(value.title);
  const machineId = readString(value.machineId);
  const mode = normalizePaneMode(value.mode);
  const remoteHostId = readOptionalString(value.remoteHostId);
  const profileId = readOptionalString(value.profileId);
  const prompt = readString(value.prompt) || "PS>";
  const status = normalizeMachineStatus(value.status);

  if (!id || !title || !machineId || !mode) {
    return undefined;
  }

  return {
    args: normalizeStringArray(value.args),
    containerId: readOptionalString(value.containerId),
    currentCwd: readOptionalString(value.currentCwd),
    cwd: readOptionalString(value.cwd),
    env: normalizeStringRecord(value.env),
    id,
    latencyMs: readOptionalNumber(value.latencyMs),
    localMachineScope:
      mode === "local"
        ? normalizeLocalMachineScope(value.localMachineScope)
        : undefined,
    lines: [],
    machineId,
    mode,
    outputHistory: normalizeTerminalOutputHistory(value.outputHistory),
    profileId,
    prompt,
    remoteCommand: readOptionalString(value.remoteCommand),
    remoteHostId,
    shell: readOptionalString(value.shell),
    status,
    target: normalizeRemoteTargetRef(value.target),
    tmuxBinding: normalizeTmuxPaneBinding(value.tmuxBinding),
    title,
  };
}

/** 将缺失或非法 scope 收敛到旧版 sidebar 语义。 */
function normalizeLocalMachineScope(value: unknown): LocalMachineScope {
  return value === "workspace" ? "workspace" : "sidebar";
}

function normalizeTmuxPaneBinding(value: unknown): TmuxPaneBinding | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const targetRef = readString(value.targetRef);
  const sessionId = readString(value.sessionId);
  const sessionName = readString(value.sessionName);
  const attachedAt = readString(value.attachedAt);
  if (!targetRef || !sessionId || !sessionName || !attachedAt) {
    return undefined;
  }

  return {
    attachedAt,
    sessionId,
    sessionName,
    socketName: readOptionalString(value.socketName),
    socketPath: readOptionalString(value.socketPath),
    targetRef,
  };
}

function normalizeSidebarMachine(value: unknown): Machine | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const kind = value.kind;
  if (kind !== "local" && kind !== "dockerContainer") {
    return undefined;
  }

  const id = readString(value.id);
  const name = readString(value.name);
  if (!id || !name) {
    return undefined;
  }

  const status = normalizeMachineStatus(value.status);
  const base = {
    args: normalizeStringArray(value.args),
    createdAt: readOptionalString(value.createdAt),
    cwd: readOptionalString(value.cwd),
    description: readString(value.description) || (kind === "local" ? "本地会话" : name),
    env: normalizeStringRecord(value.env),
    id,
    name,
    profileId: readOptionalString(value.profileId),
    remoteGroupId: readOptionalString(value.remoteGroupId),
    shell: readOptionalString(value.shell),
    sortOrder: readOptionalNumber(value.sortOrder),
    status,
    tags: normalizeStringArray(value.tags) ?? [],
    updatedAt: readOptionalString(value.updatedAt),
  };

  if (kind === "local") {
    return {
      ...base,
      kind,
      target: localTarget(base.profileId),
    };
  }

  const normalizedTarget = normalizeRemoteTargetRef(value.target);
  const parentMachineId =
    readOptionalString(value.parentMachineId) ??
    (normalizedTarget?.kind === "dockerContainer" ? normalizedTarget.hostId : undefined);
  const containerId =
    readOptionalString(value.containerId) ??
    (normalizedTarget?.kind === "dockerContainer" ? normalizedTarget.containerId : undefined);
  if (!parentMachineId || !containerId) {
    return undefined;
  }
  const runtime =
    value.runtime === "podman" || value.runtime === "docker"
      ? value.runtime
      : normalizedTarget?.kind === "dockerContainer"
        ? normalizedTarget.runtime
        : "docker";
  const containerName =
    readOptionalString(value.containerName) ??
    (normalizedTarget?.kind === "dockerContainer" ? normalizedTarget.containerName : undefined);
  const user =
    readOptionalString(value.user) ??
    (normalizedTarget?.kind === "dockerContainer" ? normalizedTarget.user : undefined);
  const workdir =
    readOptionalString(value.workdir) ??
    (normalizedTarget?.kind === "dockerContainer" ? normalizedTarget.workdir : undefined);

  return {
    ...base,
    containerId,
    containerName,
    host: readOptionalString(value.host),
    kind,
    parentMachineId,
    remoteGroupId: readOptionalString(value.remoteGroupId),
    runtime,
    target: dockerContainerTarget({
      containerId,
      containerName,
      hostId: parentMachineId,
      runtime,
      user,
      workdir,
    }),
    user,
    username: readOptionalString(value.username),
    workdir,
  };
}

function normalizeTerminalTab(
  value: unknown,
  paneIds: Set<string>,
): TerminalTab | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const id = readString(value.id);
  const title = readString(value.title);
  const machineId = readString(value.machineId);

  if (value.kind === "sftpTransfer") {
    if (!id || !title) {
      return undefined;
    }
    return {
      id,
      kind: "sftpTransfer",
      tabGroupId: readOptionalString(value.tabGroupId),
      leftHostId: readOptionalString(value.leftHostId),
      lockedLeftHostId: readOptionalString(value.lockedLeftHostId),
      machineId: machineId || "sftp-transfer",
      rightHostId: readOptionalString(value.rightHostId),
      title,
    };
  }

  if (value.kind === "workspaceFile") {
    const target = normalizeRemoteTargetRef(value.target);
    const access = normalizeWorkspaceFileAccess(value.access);
    const source = normalizeWorkspaceFileSource(value.source);
    if (!id || !target || !access || !source) {
      return undefined;
    }
    const path = normalizeWorkspaceFilePath(readString(value.path));
    const rootPath = readOptionalString(value.rootPath);
    return {
      access,
      id,
      kind: "workspaceFile",
      tabGroupId: readOptionalString(value.tabGroupId),
      machineId: workspaceFileMachineId(target),
      path,
      ...(rootPath
        ? { rootPath: normalizeWorkspaceFilePath(rootPath) }
        : {}),
      source,
      target,
      title: titleForWorkspaceFilePath(path),
    };
  }

  const layout = normalizeLayoutNode(value.layout, paneIds);

  if (!id || !title || !machineId || !layout) {
    return undefined;
  }

  return value.kind === "terminal"
    ? { id, kind: "terminal", layout, machineId, tabGroupId: readOptionalString(value.tabGroupId), title }
    : { id, layout, machineId, tabGroupId: readOptionalString(value.tabGroupId), title };
}

/** 只接纳标题有效的显式组，并清除非法颜色，避免坏组阻断其余 Session 恢复。 */
function normalizeTerminalTabGroups(value: unknown): TerminalTabGroups {
  if (!isRecord(value)) {
    return {};
  }
  const groups: TerminalTabGroups = {};
  for (const [groupId, rawDefinition] of Object.entries(value)) {
    if (!groupId || !isRecord(rawDefinition)) continue;
    const title = readOptionalString(rawDefinition.title)?.trim();
    if (!title) continue;
    groups[groupId] = {
      collapsed: rawDefinition.collapsed === true,
      ...(isTerminalTabGroupColor(rawDefinition.color)
        ? { color: rawDefinition.color }
        : {}),
      title,
    };
  }
  return groups;
}

function normalizeLayoutNode(
  value: unknown,
  paneIds: Set<string>,
): TerminalLayoutNode | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  if (value.type === "pane") {
    const paneId = readString(value.paneId);
    return paneId && paneIds.has(paneId) ? { type: "pane", paneId } : undefined;
  }

  if (value.type !== "split") {
    return undefined;
  }

  const id = readString(value.id);
  const direction =
    value.direction === "horizontal" || value.direction === "vertical"
      ? value.direction
      : undefined;
  const children = Array.isArray(value.children)
    ? value.children
        .map((child) => normalizeLayoutNode(child, paneIds))
        .filter((child): child is TerminalLayoutNode => Boolean(child))
    : [];

  if (!id || !direction || children.length === 0) {
    return undefined;
  }

  if (children.length === 1) {
    return children[0];
  }

  const sizes = normalizeSplitLayoutSizes(value.sizes, children);
  return { children, direction, id, ...(sizes ? { sizes } : {}), type: "split" };
}

function normalizeSplitLayoutSizes(
  value: unknown,
  children: TerminalLayoutNode[],
): TerminalSplitLayoutSizes | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const sizes: TerminalSplitLayoutSizes = {};
  for (const child of children) {
    const key = child.type === "pane" ? child.paneId : child.id;
    const size = value[key];
    if (typeof size !== "number" || !Number.isFinite(size) || size <= 0) {
      return undefined;
    }
    sizes[key] = Math.round(size * 1000) / 1000;
  }

  return Object.keys(sizes).length === children.length ? sizes : undefined;
}

function collectSplitSuffixes(layout: TerminalLayoutNode): number[] {
  if (layout.type === "pane") {
    return [];
  }

  return [
    numericSuffix(layout.id),
    ...layout.children.flatMap(collectSplitSuffixes),
  ];
}

interface WorkspaceSessionSelectionInput {
  activeTabId: string;
  focusedPaneId: string;
  referencedPanes: TerminalPane[];
  selectedMachineId: string;
  terminalTabs: TerminalTab[];
}

function resolveWorkspaceSessionSelection({
  activeTabId,
  focusedPaneId,
  referencedPanes,
  selectedMachineId,
  terminalTabs,
}: WorkspaceSessionSelectionInput) {
  const activeTab =
    terminalTabs.find((tab) => tab.id === activeTabId) ?? terminalTabs[0];
  if (!activeTab) {
    return {
      activeTabId: "",
      focusedPaneId: "",
      // 空工作区没有当前目标，避免持久化的最近主机污染 Context Inspector。
      selectedMachineId: "",
    };
  }

  const activePaneIds = isTerminalSessionTab(activeTab)
    ? collectPaneIds(activeTab.layout)
    : [];
  const focusedPane = referencedPanes.find(
    (pane) => pane.id === focusedPaneId && activePaneIds.includes(pane.id),
  );
  const fallbackFocusedPane =
    isTerminalSessionTab(activeTab)
      ? paneById(
          referencedPanes,
          focusedPane?.id ?? findFirstPaneId(activeTab.layout),
        )
      : undefined;
  const resolvedFocusedPane = focusedPane ?? fallbackFocusedPane;

  return {
    activeTabId: activeTab.id,
    focusedPaneId: resolvedFocusedPane?.id ?? "",
    selectedMachineId:
      selectedMachineId ||
      selectedMachineIdFromPane(resolvedFocusedPane) ||
      selectedMachineIdFromTab(activeTab),
  };
}

function paneById(panes: TerminalPane[], paneId: string | undefined) {
  return panes.find((pane) => pane.id === paneId);
}

function selectedMachineIdFromPane(pane: TerminalPane | undefined) {
  return pane?.remoteHostId || pane?.machineId || "";
}

function selectedMachineIdFromTab(tab: TerminalTab | undefined) {
  if (!tab) {
    return "";
  }
  if (isSftpTransferWorkspaceTab(tab)) {
    return (
      tab.rightHostId ||
      tab.lockedLeftHostId ||
      tab.leftHostId ||
      (tab.machineId !== "sftp-transfer" ? tab.machineId : "")
    );
  }
  if (isWorkspaceFileTab(tab)) {
    return workspaceFileTargetHostId(tab.target) ?? tab.machineId;
  }
  return tab.machineId;
}

function normalizeWorkspaceFileAccess(value: unknown) {
  return value === "readonly" || value === "editable" ? value : undefined;
}

function normalizeWorkspaceFileSource(value: unknown) {
  return value === "sftp" ||
    value === "container" ||
    value === "composeYaml" ||
    value === "workspace" ||
    value === "local"
    ? value
    : undefined;
}

function numericSuffix(value: string) {
  const match = /-(\d+)$/.exec(value);
  return match ? Number.parseInt(match[1], 10) : 0;
}

function normalizePaneMode(value: unknown): TerminalPane["mode"] | undefined {
  return value === "local" ||
    value === "ssh" ||
    value === "telnet" ||
    value === "serial" ||
    value === "container" ||
    value === "preview"
    ? value
    : undefined;
}

function normalizeMachineStatus(value: unknown): MachineStatus {
  return value === "online" || value === "offline" || value === "warning"
    ? value
    : "offline";
}

function normalizeTerminalOutputHistory(value: unknown) {
  return typeof value === "string" && value.length > 0
    ? trimTerminalOutputHistory(value)
    : undefined;
}

function trimTerminalOutputHistory(value: string) {
  if (value.length <= TERMINAL_OUTPUT_HISTORY_MAX_CHARS) {
    return value;
  }

  const trimmed = value.slice(-TERMINAL_OUTPUT_HISTORY_MAX_CHARS);
  const firstCodeUnit = trimmed.charCodeAt(0);
  const startsWithLowSurrogate =
    firstCodeUnit >= 0xdc00 && firstCodeUnit <= 0xdfff;
  return startsWithLowSurrogate ? trimmed.slice(1) : trimmed;
}

function normalizeStringArray(value: unknown) {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : undefined;
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function normalizeStringRecord(value: unknown) {
  if (!isRecord(value)) {
    return undefined;
  }

  const entries = Object.entries(value).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function readString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function readOptionalString(value: unknown) {
  const text = readString(value);
  return text || undefined;
}

function readOptionalNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
