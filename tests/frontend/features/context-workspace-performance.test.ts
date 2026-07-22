// 项目测试 tsconfig 不加载 Node 类型；Vitest 运行时仍提供该内置模块。
// @ts-expect-error Node 内置模块由 Vitest 的 Node 运行时提供。
import { mkdirSync, writeFileSync } from "node:fs";

import { afterAll, describe, expect, it } from "vitest";

import { buildCommandPaletteItems } from "../../../src/features/command-palette";
import {
  QuickOpenCoordinator,
  type QuickOpenCandidate,
  type QuickOpenProvider,
} from "../../../src/features/quick-open";
import {
  createTerminalArtifactIndex,
  detectTerminalTextArtifacts,
} from "../../../src/features/terminal/artifacts/public";
import {
  requireWorkspaceCapabilities,
  WorkspaceActionRegistry,
} from "../../../src/features/workspace-actions";
import {
  buildWorkspaceContextProjection,
  type WorkspaceContextProjectionInput,
} from "../../../src/features/workspace/context";
import type {
  Machine,
  MachineGroup,
  TerminalPane,
  TerminalTab,
} from "../../../src/features/workspace/types";

const SAMPLE_COUNT = 120;
const WARMUP_COUNT = 20;
const EVIDENCE_DIRECTORY = ".updeng/docs/verification";
const EVIDENCE_PATH = `${EVIDENCE_DIRECTORY}/context-workspace-performance.json`;

interface PerformanceThreshold {
  p95Ms: number;
  maxMs: number;
}

interface PerformanceMeasurement {
  samples: number;
  workload: Record<string, number>;
  threshold: PerformanceThreshold;
  timingMs: {
    p50: number;
    p95: number;
    max: number;
  };
  passed: boolean;
}

const measurements: Record<string, PerformanceMeasurement> = {};

/**
 * 对同步 warm workload 预热后采样，证据只保留数量与耗时，不保留输入正文。
 */
function measureSync(
  name: string,
  workload: Record<string, number>,
  threshold: PerformanceThreshold,
  operation: () => void,
) {
  for (let index = 0; index < WARMUP_COUNT; index += 1) {
    operation();
  }
  const samples = Array.from({ length: SAMPLE_COUNT }, () => {
    const startedAt = performance.now();
    operation();
    return performance.now() - startedAt;
  });
  recordMeasurement(name, workload, threshold, samples);
}

/**
 * 异步 workload 使用相同的预热和采样口径，避免把首次 Promise 调度成本当作回归。
 */
async function measureAsync(
  name: string,
  workload: Record<string, number>,
  threshold: PerformanceThreshold,
  operation: () => Promise<void>,
) {
  for (let index = 0; index < WARMUP_COUNT; index += 1) {
    await operation();
  }
  const samples: number[] = [];
  for (let index = 0; index < SAMPLE_COUNT; index += 1) {
    const startedAt = performance.now();
    await operation();
    samples.push(performance.now() - startedAt);
  }
  recordMeasurement(name, workload, threshold, samples);
}

function recordMeasurement(
  name: string,
  workload: Record<string, number>,
  threshold: PerformanceThreshold,
  samples: readonly number[],
) {
  const ordered = [...samples].sort((left, right) => left - right);
  const timingMs = {
    p50: round(quantile(ordered, 0.5)),
    p95: round(quantile(ordered, 0.95)),
    max: round(ordered[ordered.length - 1] ?? 0),
  };
  const passed =
    timingMs.p95 <= threshold.p95Ms && timingMs.max <= threshold.maxMs;
  measurements[name] = {
    samples: samples.length,
    workload,
    threshold,
    timingMs,
    passed,
  };
  expect(timingMs.p95, `${name} p95`).toBeLessThanOrEqual(threshold.p95Ms);
  expect(timingMs.max, `${name} max`).toBeLessThanOrEqual(threshold.maxMs);
}

function quantile(ordered: readonly number[], ratio: number) {
  const index = Math.min(
    ordered.length - 1,
    Math.max(0, Math.ceil(ordered.length * ratio) - 1),
  );
  return ordered[index] ?? 0;
}

function round(value: number) {
  return Number(value.toFixed(3));
}

function createProjectionInput(): WorkspaceContextProjectionInput {
  const machines: Machine[] = Array.from({ length: 80 }, (_, index) => ({
    description: `Synthetic machine ${index}`,
    id: `machine-${index}`,
    kind: index % 2 === 0 ? "local" : "ssh",
    name: `Machine ${index}`,
    status: "online",
    tags: ["performance"],
  }));
  const machineGroups: MachineGroup[] = Array.from(
    { length: 8 },
    (_, groupIndex) => ({
      id: `group-${groupIndex}`,
      machines: machines.slice(groupIndex * 10, groupIndex * 10 + 10),
      title: `Group ${groupIndex}`,
    }),
  );
  const terminalPanes: TerminalPane[] = Array.from(
    { length: 80 },
    (_, index) => ({
      cwd: `/workspace/project-${index}`,
      id: `pane-${index}`,
      lines: [],
      machineId: `machine-${index}`,
      mode: index % 2 === 0 ? "local" : "ssh",
      prompt: "$",
      status: "online",
      title: `Pane ${index}`,
    }),
  );
  const terminalTabs: TerminalTab[] = terminalPanes.map((pane, index) => ({
    id: `tab-${index}`,
    layout: { paneId: pane.id, type: "pane" },
    machineId: pane.machineId,
    title: `Tab ${index}`,
  }));
  return {
    activeTabId: "tab-40",
    focusedPaneId: "pane-40",
    generatedAt: "2026-07-11T08:00:00.000Z",
    machineGroups,
    revision: 1,
    selectedMachineId: "machine-40",
    terminalPanes,
    terminalTabs,
  };
}

function createQuickOpenCandidates(
  providerIndex: number,
): QuickOpenCandidate[] {
  return Array.from({ length: 100 }, (_, index) => ({
    description: `Synthetic result ${index}`,
    keywords: ["workspace", `group-${index % 10}`, "terminal"],
    label: `Project ${providerIndex}-${index}`,
    reference: {
      id: `item-${providerIndex}-${index}`,
      kind: index % 2 === 0 ? "terminal-pane" : "workspace-file",
      targetId: `target-${index % 8}`,
    },
    targetId: `target-${index % 8}`,
    targetLabel: `Target ${index % 8}`,
  }));
}

describe("Context Workspace performance matrix", () => {
  afterAll(() => {
    const evidence = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      policy: {
        samples: SAMPLE_COUNT,
        warmupIterations: WARMUP_COUNT,
        unit: "milliseconds",
        contentPolicy: "仅记录 workload 数量和耗时，不记录终端或 Agent 正文。",
      },
      measurements,
      passed: Object.values(measurements).every((item) => item.passed),
    };
    mkdirSync(EVIDENCE_DIRECTORY, { recursive: true });
    writeFileSync(
      EVIDENCE_PATH,
      `${JSON.stringify(evidence, null, 2)}\n`,
      "utf8",
    );
  });

  it("Context Projection 在多对象 warm workload 下保持低延迟", () => {
    const input = createProjectionInput();
    let revision = 1;
    let focusedPaneId: string | null = null;
    measureSync(
      "contextProjection",
      { machines: 80, panes: 80, tabs: 80 },
      { p95Ms: 15, maxMs: 60 },
      () => {
        const projection = buildWorkspaceContextProjection({
          ...input,
          revision: revision++,
        });
        focusedPaneId = projection.focusedPaneId;
      },
    );
    expect(focusedPaneId).toBe("pane-40");
  });

  it("Quick Open coordinator 与 scoring 在并发 provider 下保持低延迟", async () => {
    const providers: QuickOpenProvider[] = Array.from(
      { length: 4 },
      (_, providerIndex) => {
        const candidates = createQuickOpenCandidates(providerIndex);
        return {
          id: `provider-${providerIndex}`,
          kinds: ["terminal-pane", "workspace-file"],
          search: async () => candidates,
        };
      },
    );
    const coordinator = new QuickOpenCoordinator({
      getProviders: () => providers,
      limit: 100,
    });
    let finalStatus = "";
    let resultCount = 0;
    await measureAsync(
      "quickOpenCoordinatorAndScoring",
      { candidatesPerProvider: 100, providers: 4, resultLimit: 100 },
      { p95Ms: 20, maxMs: 80 },
      async () => {
        const result = await coordinator.search("project 2");
        finalStatus = result.status;
        resultCount = result.results.length;
      },
    );
    expect(finalStatus).toBe("ready");
    expect(resultCount).toBeGreaterThan(0);
  });

  it("Action Registry availability 与 query 派生保持低延迟", () => {
    const registry = new WorkspaceActionRegistry<Record<string, number>>();
    for (let index = 0; index < 200; index += 1) {
      registry.register({
        availability: requireWorkspaceCapabilities(`capability-${index % 12}`),
        effect: "read",
        id: `workspace.action.${index}`,
        title: `Workspace Action ${index}`,
      });
    }
    const context = {
      capabilities: new Set(
        Array.from({ length: 12 }, (_, index) => `capability-${index}`),
      ),
      revision: 1,
    };
    let itemCount = 0;
    measureSync(
      "actionRegistryAvailabilityAndQuery",
      { actions: 200, capabilities: 12 },
      { p95Ms: 15, maxMs: 60 },
      () => {
        const items = buildCommandPaletteItems(
          registry,
          context,
          "workspace action 12",
          () => 0,
          (descriptor) => ({
            category: "Workspace",
            keywords: ["context", descriptor.id],
            scope: "global",
          }),
        );
        itemCount = items.length;
      },
    );
    expect(itemCount).toBeGreaterThan(0);
  });

  it("Artifact detector 与有界 index 在批量输入下保持低延迟", () => {
    const lines = Array.from(
      { length: 80 },
      (_, index) =>
        `build-${index} https://example.invalid/jobs/${index} /workspace/logs/job-${index}.log C:\\work\\out\\job-${index}.txt`,
    );
    let artifactCount = 0;
    measureSync(
      "artifactDetectorAndIndex",
      { inputLines: 80, maxArtifacts: 200 },
      { p95Ms: 25, maxMs: 100 },
      () => {
        const index = createTerminalArtifactIndex({
          maxArtifacts: 200,
          maxCandidatesPerBatch: 400,
          now: () => 1,
          paneId: "pane-performance",
          target: { id: "local-performance", kind: "local" },
        });
        for (const line of lines) {
          index.accept(detectTerminalTextArtifacts(line));
        }
        artifactCount = index.getSnapshot().artifacts.length;
        index.dispose();
      },
    );
    expect(artifactCount).toBeGreaterThan(0);
  });
});
