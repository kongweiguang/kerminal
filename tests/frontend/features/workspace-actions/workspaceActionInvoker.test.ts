import { describe, expect, it, vi } from "vitest";
import {
  WorkspaceActionInvoker,
  WorkspaceActionRegistry,
  type WorkspaceActionCatalog,
  type WorkspaceActionExecutor,
  type WorkspaceActionRevision,
} from "../../../../src/features/workspace-actions";

interface TestCatalog extends WorkspaceActionCatalog {
  inspect: { targetId: string };
}

function setup(execute: WorkspaceActionExecutor["execute"]) {
  const registry = new WorkspaceActionRegistry<TestCatalog>().register({
    id: "inspect",
    title: "检查目标",
    effect: "read",
  });
  return new WorkspaceActionInvoker(registry, { execute });
}

function invocation(
  overrides: Partial<{
    contextRevision: WorkspaceActionRevision;
    expectedContextRevision: WorkspaceActionRevision;
    invocationKey: string;
    signal: AbortSignal;
  }> = {},
) {
  return {
    actionId: "inspect" as const,
    payload: { targetId: "pane-1" },
    context: { revision: overrides.contextRevision ?? "revision-2" },
    expectedContextRevision: overrides.expectedContextRevision ?? "revision-2",
    invocationKey: overrides.invocationKey,
    signal: overrides.signal,
  };
}

describe("WorkspaceActionInvoker", () => {
  it("does not execute with a stale context revision", async () => {
    const execute = vi.fn();
    const invoker = setup(execute);

    await expect(
      invoker.invoke(invocation({ expectedContextRevision: "revision-1" })),
    ).resolves.toEqual({
      kind: "stale-context",
      actualRevision: "revision-2",
      expectedRevision: "revision-1",
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("accepts numeric revisions while keeping the stale guard strict", async () => {
    const execute = vi.fn(async () => ({ kind: "completed" as const }));
    const invoker = setup(execute);

    await expect(
      invoker.invoke(
        invocation({
          contextRevision: 2,
          expectedContextRevision: 2,
        }),
      ),
    ).resolves.toEqual({ kind: "completed" });
    await expect(
      invoker.invoke(
        invocation({
          contextRevision: 2,
          expectedContextRevision: "2",
        }),
      ),
    ).resolves.toEqual({
      kind: "stale-context",
      actualRevision: 2,
      expectedRevision: "2",
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("returns cancelled when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const execute = vi.fn();

    await expect(
      setup(execute).invoke(invocation({ signal: controller.signal })),
    ).resolves.toEqual({ kind: "cancelled" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("returns cancelled when an in-flight action is aborted", async () => {
    const controller = new AbortController();
    let finish: (() => void) | undefined;
    const execute = vi.fn(
      () =>
        new Promise<{ kind: "completed" }>((resolve) => {
          finish = () => resolve({ kind: "completed" });
        }),
    ) as WorkspaceActionExecutor["execute"];
    const invoker = setup(execute);
    const result = invoker.invoke(invocation({ signal: controller.signal }));

    controller.abort();

    await expect(result).resolves.toEqual({ kind: "cancelled" });
    await expect(invoker.invoke(invocation())).resolves.toEqual({
      kind: "duplicate",
      invocationKey: "inspect",
    });
    finish?.();
  });

  it("rejects duplicate in-flight invocations with the same key", async () => {
    let finish: (() => void) | undefined;
    const execute = vi.fn(
      () =>
        new Promise<{ kind: "completed" }>((resolve) => {
          finish = () => resolve({ kind: "completed" });
        }),
    ) as WorkspaceActionExecutor["execute"];
    const invoker = setup(execute);
    const first = invoker.invoke(invocation({ invocationKey: "pane-1" }));

    await expect(
      invoker.invoke(invocation({ invocationKey: "pane-1" })),
    ).resolves.toEqual({
      kind: "duplicate",
      invocationKey: "pane-1",
    });
    finish?.();
    await expect(first).resolves.toEqual({ kind: "completed" });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("classifies unknown executor errors as user-facing failures", async () => {
    const invoker = setup(async () => {
      throw new Error("token=secret-value");
    });

    const result = await invoker.invoke(invocation());

    expect(result).toMatchObject({
      kind: "failure",
      errorKind: "execution-failed",
      error: {
        title: "工作区动作执行失败",
        severity: "error",
      },
    });
    if (result.kind === "failure") {
      expect(result.error.technicalDetail).not.toContain("secret-value");
    }
  });

  it("classifies synchronous executor errors as user-facing failures", async () => {
    const execute = vi.fn(() => {
      throw new Error("token=sync-secret");
    }) as unknown as WorkspaceActionExecutor["execute"];
    const invoker = setup(execute);

    const result = await invoker.invoke(invocation());

    expect(result).toMatchObject({
      kind: "failure",
      errorKind: "execution-failed",
      error: {
        title: "工作区动作执行失败",
        severity: "error",
      },
    });
    expect(execute).toHaveBeenCalledTimes(1);
    await expect(invoker.invoke(invocation())).resolves.toMatchObject({
      kind: "failure",
      errorKind: "execution-failed",
    });
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("classifies unknown action ids as not-found failures", async () => {
    const registry = new WorkspaceActionRegistry<Record<string, unknown>>();
    const invoker = new WorkspaceActionInvoker(registry, {
      execute: vi.fn(),
    });

    await expect(
      invoker.invoke({
        actionId: "missing",
        payload: undefined,
        context: { revision: "revision-2" },
        expectedContextRevision: "revision-2",
      }),
    ).resolves.toMatchObject({
      kind: "failure",
      errorKind: "not-found",
    });
  });
});
