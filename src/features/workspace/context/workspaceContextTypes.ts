// @author kongweiguang

import type { RemoteTargetRef } from "../../../lib/targetModel";
import type {
  Machine,
  MachineGroup,
  TerminalPane,
  TerminalTab,
  WorkspaceFileDirtyState,
  WorkspaceFileRevealRequest,
} from "../types";

type WorkspaceContextSource =
  | "workspace"
  | "terminal"
  | "sftp"
  | "runtime"
  | "agentRepository"
  | "agentSignal";

/**
 * 工作台上下文版本。兼容数字型 store revision 与动作层使用的字符串型版本，
 * 集成层应在一次投影生命周期内保持值稳定。
 */
export type WorkspaceContextRevision = string | number;

type WorkspaceContextSourceStatus =
  "available" | "loading" | "stale" | "unavailable" | "error";

/**
 * 描述一个真实状态源的可用性。该类型只携带元数据，禁止放入终端输出、
 * Agent prompt、凭据或异常堆栈等正文。
 */
export interface WorkspaceContextSourceState {
  readonly source: WorkspaceContextSource;
  readonly revision?: string | number;
  readonly updatedAt?: string;
  readonly status: WorkspaceContextSourceStatus;
  readonly diagnosticId?: string;
}

export interface WorkspaceContextFreshness {
  readonly state: "fresh" | "partial" | "stale";
  readonly sources: readonly WorkspaceContextSourceState[];
}

type WorkspaceContextDiagnosticSeverity = "info" | "warning" | "error";

/**
 * 可展示、可定位但不包含敏感正文的投影诊断。
 */
export interface WorkspaceContextDiagnostic {
  readonly id: string;
  readonly code:
    | "active-tab-missing"
    | "focused-pane-missing"
    | "pane-outside-active-tab"
    | "selected-machine-missing"
    | "pane-machine-missing"
    | "target-kind-mismatch"
    | "source-loading"
    | "source-stale"
    | "source-unavailable"
    | "source-error";
  readonly severity: WorkspaceContextDiagnosticSeverity;
  readonly summary: string;
  readonly source?: WorkspaceContextSource;
  readonly recoverable: boolean;
}

export interface WorkspaceContextMachine {
  readonly id: string;
  readonly name: string;
  readonly kind: Machine["kind"];
  readonly status: Machine["status"];
  readonly groupId: string | null;
}

export interface WorkspaceContextTarget {
  readonly id: string;
  readonly kind:
    "local" | "ssh" | "external" | "container" | "telnet" | "serial" | "rdp";
  readonly label: string;
  readonly hostLabel?: string;
  readonly containerLabel?: string;
  readonly ref?: RemoteTargetRef;
}

export interface WorkspaceContextLocation {
  readonly cwd: string | null;
  readonly cwdSource:
    "pane" | "osc7" | "workspaceFile" | "machineDefault" | "unknown";
  readonly pathStyle: "posix" | "windows" | "unknown";
  readonly confidence: "high" | "medium" | "low";
  readonly observedAt?: string;
}

export interface WorkspaceContextSubject {
  readonly kind:
    | "terminalPane"
    | "workspaceFile"
    | "sftpTransfer"
    | "agentSession"
    | "machine"
    | "empty";
  readonly id: string | null;
  readonly title: string;
  readonly dirty?: boolean;
  readonly filePath?: string;
}

interface WorkspaceContextPaneRef {
  readonly id: string;
  readonly title: string;
  readonly machineId: string;
  readonly mode: TerminalPane["mode"];
  readonly status: TerminalPane["status"];
  readonly focused: boolean;
}

interface WorkspaceContextTabRef {
  readonly id: string;
  readonly title: string;
  readonly kind: "terminal" | "sftpTransfer" | "workspaceFile";
  readonly active: boolean;
}

interface WorkspaceContextResources {
  readonly tabs: readonly WorkspaceContextTabRef[];
  readonly panes: readonly WorkspaceContextPaneRef[];
  readonly activeTabPaneIds: readonly string[];
  readonly workspaceFileCount: number;
  readonly dirtyWorkspaceFileCount: number;
  readonly sftpRevealRequest: WorkspaceFileRevealRequest | null;
}

interface WorkspaceContextRuntime {
  readonly connectionStatus:
    TerminalPane["status"] | Machine["status"] | "unknown";
  readonly paneMode: TerminalPane["mode"] | null;
  readonly latencyMs: number | null;
  readonly tmuxAttached: boolean;
}

export interface WorkspaceContextAgent {
  readonly sessionId: string | null;
  readonly status: "active" | "loading" | "stale" | "unavailable";
  readonly title?: string;
}

/**
 * 工作台统一只读投影。它只从真实 store/runtime 快照派生，不提供写方法，
 * 也不拥有任何需要持久化或迁移的业务状态。
 */
export interface WorkspaceContextProjection {
  readonly schemaVersion: 1;
  readonly revision: WorkspaceContextRevision;
  readonly generatedAt: string;
  readonly activeTabId: string | null;
  readonly focusedPaneId: string | null;
  readonly machine: WorkspaceContextMachine | null;
  readonly target: WorkspaceContextTarget | null;
  readonly location: WorkspaceContextLocation;
  readonly subject: WorkspaceContextSubject;
  readonly resources: WorkspaceContextResources;
  readonly runtime: WorkspaceContextRuntime;
  readonly agent: WorkspaceContextAgent;
  readonly freshness: WorkspaceContextFreshness;
  readonly diagnostics: readonly WorkspaceContextDiagnostic[];
}

/**
 * 集成层一次性读取真实状态后传入的窄快照。数组元素保持现有领域类型，
 * selector 不会回写或异步刷新这些对象。
 */
export interface WorkspaceContextProjectionInput {
  readonly revision: WorkspaceContextRevision;
  readonly generatedAt: string;
  readonly activeTabId?: string | null;
  readonly focusedPaneId?: string | null;
  readonly selectedMachineId?: string | null;
  readonly agent?: WorkspaceContextAgent;
  readonly machineGroups: readonly MachineGroup[];
  readonly terminalTabs: readonly TerminalTab[];
  readonly terminalPanes: readonly TerminalPane[];
  readonly workspaceFileDirtyState?: Readonly<WorkspaceFileDirtyState>;
  readonly workspaceFileRevealRequest?: WorkspaceFileRevealRequest | null;
  readonly sources?: readonly WorkspaceContextSourceState[];
}
