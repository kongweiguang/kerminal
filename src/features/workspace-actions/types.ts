import type { UserFacingMessage } from "../../lib/userFacingMessage";

/** Workspace 上下文版本号，兼容投影层的数字版本与外部适配层的字符串版本。 */
export type WorkspaceActionRevision = string | number;

/** Workspace Action 对外声明的副作用等级。 */
type WorkspaceActionEffect =
  "read" | "local" | "write" | "remote" | "destructive";

/** 动作执行所依赖的最小上下文投影，避免 registry 成为第二套状态源。 */
export interface WorkspaceActionContext {
  revision: WorkspaceActionRevision;
  capabilities?: ReadonlySet<string>;
}

/** 动作当前可用，或携带稳定原因码说明为何不可用。 */
export type WorkspaceActionAvailability =
  | { available: true }
  | {
      available: false;
      code: string;
      reason: string;
    };

/** 集成层需要展示的确认请求；核心层不会自行确认或执行受保护动作。 */
export interface WorkspaceActionConfirmation {
  actionId: string;
  effect: Exclude<WorkspaceActionEffect, "read" | "local">;
  title: string;
  detail?: string;
}

/** Action executor 可返回的业务结果。 */
export type WorkspaceActionExecutionResult =
  | { kind: "completed"; value?: unknown }
  | { kind: "open-tool"; toolId: string; payload?: unknown }
  | { kind: "failure"; error: UserFacingMessage; errorKind?: string };

/** Invoker 的完整结果联合，调用方必须显式处理所有非成功状态。 */
export type WorkspaceActionInvocationResult =
  | WorkspaceActionExecutionResult
  | {
      kind: "confirmation-required";
      confirmation: WorkspaceActionConfirmation;
    }
  | { kind: "unavailable"; code: string; reason: string }
  | {
      kind: "stale-context";
      actualRevision: WorkspaceActionRevision;
      expectedRevision: WorkspaceActionRevision;
    }
  | { kind: "duplicate"; invocationKey: string }
  | { kind: "cancelled" };

/** 强类型动作描述；payload 只在 descriptor、invocation 和 executor 之间流动。 */
export interface WorkspaceActionDescriptor<
  TId extends string = string,
  TPayload = unknown,
> {
  id: TId;
  title: string;
  effect: WorkspaceActionEffect;
  availability?: WorkspaceActionAvailabilityPolicy<TPayload>;
  confirmationDetail?: (
    context: WorkspaceActionContext,
    payload: TPayload,
  ) => string | undefined;
}

/** 可替换的动作可用性策略。 */
export type WorkspaceActionAvailabilityPolicy<TPayload> = (
  context: WorkspaceActionContext,
  payload: TPayload,
) => WorkspaceActionAvailability;

/** 调用请求必须绑定生成它的 context revision，防止对过期目标执行动作。 */
export interface WorkspaceActionInvocation<
  TId extends string = string,
  TPayload = unknown,
> {
  actionId: TId;
  payload: TPayload;
  context: WorkspaceActionContext;
  expectedContextRevision: WorkspaceActionRevision;
  invocationKey?: string;
  signal?: AbortSignal;
}

/** 注入式 executor 只负责允许直接执行的 local/read 动作。 */
export interface WorkspaceActionExecutor {
  execute<TPayload>(
    descriptor: WorkspaceActionDescriptor<string, TPayload>,
    invocation: WorkspaceActionInvocation<string, TPayload>,
  ): Promise<WorkspaceActionExecutionResult>;
}

/** Registry 的类型目录：key 是 action id，value 是对应 payload。 */
export type WorkspaceActionCatalog = Record<string, unknown>;
