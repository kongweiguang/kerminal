// @author kongweiguang

import type { WorkspaceContextProjection } from "../../workspace/context";

/** Context Inspector 支持的稳定分区标识。 */
export type ContextInspectorSectionId =
  | "machine"
  | "target"
  | "tab-pane"
  | "location"
  | "resources"
  | "runtime"
  | "agent"
  | "freshness"
  | "diagnostics";

/** 只读字段；可选 navigationId 由集成层解析为既有跳转。 */
export interface ContextInspectorField {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly tone?: "default" | "muted" | "warning" | "danger" | "success";
  readonly navigationId?: string;
}

/** Inspector 分区 view model，不持有领域对象或执行能力。 */
export interface ContextInspectorSection {
  readonly id: ContextInspectorSectionId;
  readonly title: string;
  readonly status?: "normal" | "partial" | "stale" | "error";
  readonly fields: readonly ContextInspectorField[];
  readonly emptyMessage?: string;
}

/** 集成层从 Action Registry 派生的最小展示合同。 */
export interface ContextInspectorActionDescriptor {
  readonly id: string;
  readonly title: string;
  readonly effect: "read" | "local" | "write" | "remote" | "destructive";
  readonly available: boolean;
  readonly disabledReason?: string;
  readonly priority?: number;
}

/** Context Inspector 的完整只读 view model。 */
export interface ContextInspectorViewModel {
  readonly title: string;
  readonly subtitle: string;
  readonly status: "ready" | "partial" | "stale" | "error";
  readonly primaryFields: readonly ContextInspectorField[];
  readonly sections: readonly ContextInspectorSection[];
  readonly topActions: readonly ContextInspectorActionDescriptor[];
}

export interface ContextInspectorToolContentProps {
  readonly active?: boolean;
  readonly context: WorkspaceContextProjection;
  readonly actions?: readonly ContextInspectorActionDescriptor[];
  readonly autoFocus?: boolean;
  /** 只有集成层能够实际处理的导航 ID 才允许渲染为交互按钮。 */
  readonly isNavigationAvailable?: (navigationId: string) => boolean;
  readonly onAction?: (actionId: string) => void;
  readonly onNavigate?: (navigationId: string) => void;
}
