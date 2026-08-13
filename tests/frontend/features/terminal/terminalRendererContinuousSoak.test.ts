// @author kongweiguang

import { Terminal, type IDisposable, type ITerminalAddon } from "@xterm/xterm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTerminalOutputWriter } from "../../../../src/features/terminal/terminalOutputWriter";
import { disposeXtermTerminal } from "../../../../src/features/terminal/terminalDisposalCompatibility";
import { createTerminalRendererController } from "../../../../src/features/terminal/terminalRenderer";
import {
  createTerminalRendererHealthWatchdog,
  type TerminalRendererHealthWatchdogScheduler,
} from "../../../../src/features/terminal/terminalRendererHealthWatchdog";
import { createTerminalRendererRegistry } from "../../../../src/features/terminal/terminalRendererRegistry";
import {
  createTerminalRendererSurfaceCoordinator,
  type TerminalRendererSurfaceScheduler,
} from "../../../../src/features/terminal/terminalRendererSurfaceCoordinator";

declare const process: {
  env: Record<string, string | undefined>;
  getBuiltinModule(name: "node:v8"): {
    queryObjects(constructor: abstract new (...args: never[]) => object): number;
    setFlagsFromString(flags: string): void;
  };
  getBuiltinModule(name: "node:vm"): {
    runInNewContext(code: string): unknown;
  };
  memoryUsage(): { heapUsed: number };
};

const configuredDurationMs =
  process.env.TERMINAL_RENDERER_SOAK_DURATION_MS;
const durationMs = readPositiveNumber(configuredDurationMs, 1_000);
const MAX_HEAP_GROWTH_BYTES = 32 * 1024 * 1024;
const MAX_HEAP_GROWTH_RATIO = 1.5;
const PANES_PER_CYCLE = 2;
const WARMUP_CYCLES = 4;
const cycleIntervalMs = Math.min(
  10_000,
  Math.max(250, Math.floor(durationMs / 10)),
);
const soakListenerTracker = {
  domEntries: [] as Array<{
    listener: EventListenerOrEventListenerObject;
    options?: boolean | AddEventListenerOptions;
    target: EventTarget;
    type: string;
  }>,
  mediaEntries: [] as Array<{
    listener: EventListenerOrEventListenerObject;
    query: string;
  }>,
};
let soakListenerBaseline = 0;
let restoreSoakBrowserPrimitives: (() => void) | undefined;

afterEach(() => {
  // soak 会替换浏览器原语并建立大量 DOM；逐项恢复避免同 worker 的后续测试继承观测器。
  restoreSoakBrowserPrimitives?.();
  restoreSoakBrowserPrimitives = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
  soakListenerTracker.domEntries.length = 0;
  soakListenerTracker.mediaEntries.length = 0;
  soakListenerBaseline = 0;
});

(configuredDurationMs ? describe : describe.skip)(
  "terminal renderer continuous soak",
  () => {
    it(
      "keeps renderer, writer, listener, canvas, and timer resources bounded in one process",
      async () => {
        installSoakBrowserStubs();
      ContinuousSoakWebglAddon.activeCanvases = 0;
      ContinuousSoakWebglAddon.activeListeners = 0;
      ContinuousSoakSurfaceScheduler.activeFrames = 0;
      ContinuousSoakWatchdogScheduler.activeTimers = 0;
      soakListenerTracker.domEntries.length = 0;
      soakListenerTracker.mediaEntries.length = 0;
      const registry = createTerminalRendererRegistry({
        rendererType: "auto",
      });
      // 多轮真实 xterm warm-up 覆盖字体/Unicode/DOM 初始化和 V8 优化；这些一次性
      // 成本不应被算作稳定态泄漏，随后仍以同样路径持续循环并检查净增长。
      for (let cycle = 0; cycle < WARMUP_CYCLES; cycle += 1) {
        const warmupPanes = await Promise.all(
          Array.from({ length: PANES_PER_CYCLE }, (_, index) =>
            createSoakPane(registry, -cycle - 1, index),
          ),
        );
        for (const pane of warmupPanes) {
          pane.writer.write(`warmup-${cycle}\r\n`);
          pane.writer.flush();
          await flushTimers();
          pane.dispose();
        }
        await flushTimers();
      }
      soakListenerBaseline = soakListenerTracker.domEntries.length;
      const collectGarbage = resolveSoakGarbageCollector();
      collectGarbage();
      const startedAt = Date.now();
      const heapStarted = process.memoryUsage().heapUsed;
      let cycles = 0;
      let contextLossCount = 0;
      let maxHeapUsed = heapStarted;
      let modeSwitchCount = 0;
      let paneCycles = 0;
      let visibilityCycleCount = 0;
      const heapSamples: number[] = [];
      const queryObjects = process.getBuiltinModule("node:v8").queryObjects;
      const terminalObjectsStarted = queryObjects(Terminal);
      const textNodesStarted = queryObjects(Text);
      const htmlElementsStarted = queryObjects(HTMLElement);

      while (Date.now() - startedAt < durationMs) {
        const cycleStartedAt = Date.now();
        const panes = await Promise.all(
          Array.from({ length: PANES_PER_CYCLE }, (_, index) =>
            createSoakPane(registry, cycles, index),
          ),
        );
        paneCycles += panes.length;

        for (const [index, pane] of panes.entries()) {
          pane.writer.write(
            `cycle-${cycles}-pane-${index} 中文 emoji 🚀\r\n`,
          );
          pane.writer.flush();
          await flushTimers();
          expect(pane.writer.pendingLength()).toBe(0);
          pane.surfaceSize.width = 800 + ((cycles + index) % 3) * 16;
          pane.surfaceSize.height = 600 + ((cycles + index) % 2) * 12;
          pane.surfaceCoordinator.notify();
          pane.surfaceScheduler.flushAll();
          pane.watchdog.check();
        }

        const contextLossPane = panes[cycles % panes.length];
        const contextLossAddon = contextLossPane.readLoadedAddon();
        expect(contextLossAddon).not.toBeNull();
        contextLossAddon?.emitContextLoss();
        contextLossCount += 1;
        await flushTimers();
        expect(contextLossPane.controller.getState().backend).toBe("gpu");

        const modePane = panes[(cycles + 1) % panes.length];
        modePane.controller.updateMode("cpu");
        modePane.controller.updateMode("auto");
        modeSwitchCount += 1;
        await flushTimers();
        expect(modePane.controller.getState().backend).toBe("gpu");

        const visibilityPane = panes[(cycles + 2) % panes.length];
        visibilityPane.controller.suspend();
        registry.updatePaneVisibility(visibilityPane.paneId, false);
        registry.updatePaneVisibility(visibilityPane.paneId, true);
        visibilityPane.controller.resume();
        visibilityCycleCount += 1;

        for (const pane of panes) {
          pane.dispose();
          expect(pane.container.isConnected).toBe(false);
          const diagnostics = pane.controller.getDiagnostics();
          expect(diagnostics.activeTimerCount).toBe(0);
          expect(diagnostics.lifecycle.state).toBe("disposed");
        }
        expect(ContinuousSoakWebglAddon.activeCanvases).toBe(0);
        expect(ContinuousSoakWebglAddon.activeListeners).toBe(0);
        expect(ContinuousSoakSurfaceScheduler.activeFrames).toBe(0);
        expect(ContinuousSoakWatchdogScheduler.activeTimers).toBe(0);
        cycles += 1;
        collectGarbage();
        const heapSample = process.memoryUsage().heapUsed;
        heapSamples.push(heapSample);
        maxHeapUsed = Math.max(maxHeapUsed, heapSample);
        if (process.env.TERMINAL_RENDERER_SOAK_DEBUG === "1") {
          console.log(
            `TERMINAL_RENDERER_SOAK_HEAP=${cycles}:${heapSample}`,
          );
        }
        await waitForNextSoakCycle(cycleStartedAt);
      }

      registry.dispose();
      // soak 子进程显式开放 GC，先回收已释放 runtime 的暂态对象，再判断真正存活的引用。
      collectGarbage();
      const heapEnded = process.memoryUsage().heapUsed;
      const heapLimit = Math.max(
        Math.floor(heapStarted * MAX_HEAP_GROWTH_RATIO),
        heapStarted + MAX_HEAP_GROWTH_BYTES,
      );
      const heapGrowthSlopeBytesPerCycle = linearRegressionSlope(heapSamples);
      const terminalObjectsEnded = queryObjects(Terminal);
      const textNodesEnded = queryObjects(Text);
      const htmlElementsEnded = queryObjects(HTMLElement);
      const resources = {
        activeCanvases: ContinuousSoakWebglAddon.activeCanvases,
        activeListeners: ContinuousSoakWebglAddon.activeListeners,
        activeDomListeners: Math.max(
          0,
          soakListenerTracker.domEntries.length - soakListenerBaseline,
        ),
        activeMediaListeners: soakListenerTracker.mediaEntries.length,
        activeSurfaceFrames: ContinuousSoakSurfaceScheduler.activeFrames,
        activeTerminalRoots: document.querySelectorAll(".xterm").length,
        activeWatchdogTimers: ContinuousSoakWatchdogScheduler.activeTimers,
        registryControllers: registry.getSnapshot().activeControllers,
      };
      const listenerDetails = soakListenerTracker.domEntries.map((entry) => ({
        target:
          entry.target === window
            ? "window"
            : entry.target === document
              ? "document"
              : entry.target instanceof Element
                ? entry.target.tagName
                : "other",
        type: entry.type,
      }));
      const resourcesBounded = Object.values(resources).every(
        (value) => value === 0,
      );
      const heapWithinLimit = heapEnded <= heapLimit;
      // JavaScript 函数栈会保留最后一轮 panes 数组到测试返回；允许恰好一轮的
      // 已 dispose Terminal，但任何跨轮累积仍会超过这个固定上限。
      const terminalObjectLimit = terminalObjectsStarted + PANES_PER_CYCLE;
      const terminalObjectsWithinLimit =
        terminalObjectsEnded <= terminalObjectLimit;
      const report = {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        actualDurationMs: Date.now() - startedAt,
        contextLossCount,
        cycles,
        modeSwitchCount,
        paneCycles,
        heap: {
          endBytes: heapEnded,
          limitBytes: heapLimit,
          maxBytes: maxHeapUsed,
          startBytes: heapStarted,
          gcAvailable: true,
          growthSlopeBytesPerCycle: heapGrowthSlopeBytesPerCycle,
          gating: false,
          withinLimit: heapWithinLimit,
        },
        terminalObjects: {
          endCount: terminalObjectsEnded,
          limitCount: terminalObjectLimit,
          startCount: terminalObjectsStarted,
          withinLimit: terminalObjectsWithinLimit,
        },
        jsdomObjects: {
          htmlElements: {
            endCount: htmlElementsEnded,
            startCount: htmlElementsStarted,
          },
          textNodes: {
            endCount: textNodesEnded,
            startCount: textNodesStarted,
          },
        },
        listenerBaseline: soakListenerBaseline,
        cycleIntervalMs,
        resources,
        listenerDetails,
        visibilityCycleCount,
        pass:
          resourcesBounded &&
          terminalObjectsWithinLimit,
      };
      console.log(
        `TERMINAL_RENDERER_SOAK_REPORT=${JSON.stringify(report)}`,
      );
      expect(cycles).toBeGreaterThan(0);
      expect(resourcesBounded).toBe(true);
      expect(terminalObjectsEnded).toBeLessThanOrEqual(terminalObjectLimit);
      },
      durationMs + 60_000,
    );
  },
);

class ContinuousSoakWebglAddon implements ITerminalAddon {
  static activeCanvases = 0;
  static activeListeners = 0;
  static instances = new WeakMap<Terminal, ContinuousSoakWebglAddon>();

  private canvas: HTMLCanvasElement | null = null;
  private listeners = new Set<() => void>();

  /** 以可计数 DOM 资源替代 GPU context，保留 controller 对 addon 的真实 ownership。 */
  activate(terminal: Terminal): void {
    ContinuousSoakWebglAddon.instances.set(terminal, this);
    this.canvas = document.createElement("canvas");
    this.canvas.width = 800;
    this.canvas.height = 600;
    this.canvas.getBoundingClientRect = () => rect(800, 600);
    terminal.element?.append(this.canvas);
    ContinuousSoakWebglAddon.activeCanvases += 1;
  }

  /** 释放计数资源，让 soak 能直接断言 controller 未遗留 canvas 或 callback。 */
  dispose(): void {
    if (this.canvas) {
      this.canvas.remove();
      this.canvas = null;
      ContinuousSoakWebglAddon.activeCanvases -= 1;
    }
    ContinuousSoakWebglAddon.activeListeners -= this.listeners.size;
    this.listeners.clear();
  }

  /** 保存 context-loss 订阅，验证 renderer 恢复后订阅可被统一撤销。 */
  onContextLoss(listener: () => void): IDisposable {
    this.listeners.add(listener);
    ContinuousSoakWebglAddon.activeListeners += 1;
    return {
      dispose: () => {
        if (this.listeners.delete(listener)) {
          ContinuousSoakWebglAddon.activeListeners -= 1;
        }
      },
    };
  }

  /** 主动触发一次 context loss，覆盖发布环境中 GPU renderer 的恢复分支。 */
  emitContextLoss(): void {
    for (const listener of [...this.listeners]) {
      listener();
    }
  }
}

/** 用显式 frame 计数替代 rAF，确保每次 surface 调度都能被清理断言覆盖。 */
class ContinuousSoakSurfaceScheduler
  implements TerminalRendererSurfaceScheduler
{
  static activeFrames = 0;

  private callbacks = new Map<number, () => void>();
  private nextHandle = 1;

  /** 取消尚未执行的 surface frame，避免把已回收任务计作活动资源。 */
  cancel(handle: number): void {
    if (this.callbacks.delete(handle)) {
      ContinuousSoakSurfaceScheduler.activeFrames -= 1;
    }
  }

  /** 立即执行测试帧，避免依赖 jsdom 不稳定的动画帧时序。 */
  flushAll(): void {
    const pending = [...this.callbacks.values()];
    ContinuousSoakSurfaceScheduler.activeFrames -= this.callbacks.size;
    this.callbacks.clear();
    for (const callback of pending) {
      callback();
    }
  }

  /** 登记待执行 frame，使每轮结束能验证 coordinator 已撤销全部工作。 */
  request(callback: () => void): number {
    const handle = this.nextHandle++;
    this.callbacks.set(handle, callback);
    ContinuousSoakSurfaceScheduler.activeFrames += 1;
    return handle;
  }
}

/** 用显式 timer 计数替代真实间隔，确保 watchdog ownership 可重复审计。 */
class ContinuousSoakWatchdogScheduler
  implements TerminalRendererHealthWatchdogScheduler
{
  static activeTimers = 0;

  private callbacks = new Map<number, () => void>();
  private nextHandle = 1;

  /** 撤销 watchdog timer，让 renderer dispose 后的存活计数可被直接审计。 */
  cancel(handle: number): void {
    if (this.callbacks.delete(handle)) {
      ContinuousSoakWatchdogScheduler.activeTimers -= 1;
    }
  }

  /** 记录 watchdog 工作而不等待真实秒级时间，保持长稳循环可控。 */
  schedule(callback: () => void): number {
    const handle = this.nextHandle++;
    this.callbacks.set(handle, callback);
    ContinuousSoakWatchdogScheduler.activeTimers += 1;
    return handle;
  }
}

/** 生产 xterm write/recovery 通过多层 microtask 完成；固定三层可稳定观察最终状态。 */
async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

/** 让真实 timer callback 与其后续 microtask 都完成，避免用任意长 sleep 掩盖泄漏。 */
async function flushTimers() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await flushPromises();
}

/**
 * jsdom 会在已释放 xterm DOM 上保留测试框架内部对象；按总时长节流可避免
 * 诊断容器自身 OOM，同时仍持续覆盖与真实 WebView2 验证相同的开关生命周期。
 */
async function waitForNextSoakCycle(cycleStartedAt: number) {
  const remainingMs = Math.max(0, cycleIntervalMs - (Date.now() - cycleStartedAt));
  await new Promise((resolve) => setTimeout(resolve, remainingMs));
}

/**
 * 每个 pane 使用真实 Terminal/AddonManager，只有 GPU 资源与调度器替换为
 * 可计数实现，从而把生产 ownership/disposal 顺序纳入 soak 证据。
 */
async function createSoakPane(
  registry: ReturnType<typeof createTerminalRendererRegistry>,
  cycle: number,
  index: number,
) {
  const paneId = `continuous-soak-${cycle}-${index}`;
  const container = document.createElement("div");
  container.getBoundingClientRect = () => rect(800, 600);
  document.body.append(container);
  const terminal = new Terminal({
    cols: 100,
    rows: 30,
    scrollback: 1000,
  });
  terminal.open(container);
  const controller = createTerminalRendererController({
    loadWebglAddon: async () => ({
      WebglAddon: ContinuousSoakWebglAddon,
    }),
    logger: { warn() {} },
    onStateChange: (state) => registry.updatePaneState(paneId, state),
    paneId,
    recoveryJitterRatio: 0,
    rendererType: "auto",
    retryDelaysMs: [0],
    shouldUseAutoGpu: () => true,
    terminal,
  });
  const unregister = registry.registerPane({
    controller,
    focused: index === 0,
    paneId,
    visible: true,
  });
  await flushPromises();
  expect(controller.getState().backend).toBe("gpu");

  const surfaceSize = { height: 600, width: 800 };
  const surfaceScheduler = new ContinuousSoakSurfaceScheduler();
  const surfaceCoordinator = createTerminalRendererSurfaceCoordinator({
    fit: () => ({ cols: 100, rows: 30 }),
    measure: () => ({
      dpr: 1 + (index % 4) * 0.25,
      height: surfaceSize.height,
      minimized: false,
      visible: true,
      width: surfaceSize.width,
    }),
    scheduler: surfaceScheduler,
    stableSamples: 1,
  });
  surfaceCoordinator.notify();
  surfaceScheduler.flushAll();
  const watchdogScheduler = new ContinuousSoakWatchdogScheduler();
  const watchdog = createTerminalRendererHealthWatchdog({
    container: terminal.element ?? container,
    renderer: controller,
    scheduler: watchdogScheduler,
    surfaceSnapshot: () => surfaceCoordinator.getSnapshot(),
  });
  watchdog.check();
  const writer = createTerminalOutputWriter(terminal, {
    callbackMode: "required",
  });

  return {
    controller,
    container,
    dispose() {
      writer.dispose();
      surfaceCoordinator.dispose();
      watchdog.dispose();
      disposeXtermTerminal(
        { dispose: () => terminal.dispose(), element: container },
        { unregisterRenderer: unregister },
      );
    },
    paneId,
    surfaceCoordinator,
    surfaceScheduler,
    surfaceSize,
    readLoadedAddon: () =>
      ContinuousSoakWebglAddon.instances.get(terminal) ?? null,
    terminal,
    watchdog,
    writer,
  };
}

/** 环境变量来自脚本边界，非法值回退到短本地默认而不让测试悬挂。 */
function readPositiveNumber(value: string | undefined, fallback: number) {
  const parsed = value === undefined ? fallback : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** jsdom 不做布局；固定几何让 xterm surface/fit 路径仍执行真实测量。 */
function rect(width: number, height: number): DOMRect {
  return {
    bottom: height,
    height,
    left: 0,
    right: width,
    top: 0,
    width,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect;
}

/**
 * Vitest 默认 fork 不继承启动进程的 `--expose-gc`；在 worker 自身开启 V8
 * flag 并从独立 context 取得 GC，避免把未回收的暂态对象误判为真实泄漏。
 */
function resolveSoakGarbageCollector(): () => void {
  const exposed = (
    globalThis as typeof globalThis & { gc?: () => void }
  ).gc;
  if (typeof exposed === "function") {
    return exposed;
  }
  process.getBuiltinModule("node:v8").setFlagsFromString("--expose_gc");
  const resolved = process
    .getBuiltinModule("node:vm")
    .runInNewContext("gc");
  if (typeof resolved !== "function") {
    throw new Error("Failed to expose garbage collection in the soak worker.");
  }
  return resolved as () => void;
}

/** 计算强制 GC 后的稳定态斜率，区分一次性缓存增长和持续线性泄漏。 */
function linearRegressionSlope(samples: number[]): number {
  if (samples.length < 2) {
    return 0;
  }
  const xMean = (samples.length - 1) / 2;
  const yMean = samples.reduce((total, sample) => total + sample, 0) / samples.length;
  let numerator = 0;
  let denominator = 0;
  for (const [index, sample] of samples.entries()) {
    const xDelta = index - xMean;
    numerator += xDelta * (sample - yMean);
    denominator += xDelta * xDelta;
  }
  return denominator === 0 ? 0 : numerator / denominator;
}

/**
 * soak 只在 jsdom 边界补浏览器原语；Terminal、AddonManager、listener 和 DOM
 * 节点仍走生产实现，避免把资源释放误测成自定义 fake Terminal 的 remove。
 */
function installSoakBrowserStubs() {
  const originalAddEventListener = EventTarget.prototype.addEventListener;
  const originalRemoveEventListener = EventTarget.prototype.removeEventListener;
  const getContextDescriptor = Object.getOwnPropertyDescriptor(
    HTMLCanvasElement.prototype,
    "getContext",
  );
  const offsetWidthDescriptor = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "offsetWidth",
  );
  const offsetHeightDescriptor = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "offsetHeight",
  );
  EventTarget.prototype.addEventListener = function (
    type,
    listener,
    options,
  ) {
    if (listener && (this === window || this === document)) {
      soakListenerTracker.domEntries.push({
        listener,
        options,
        target: this,
        type,
      });
    }
    originalAddEventListener.call(this, type, listener, options);
  };
  EventTarget.prototype.removeEventListener = function (
    type,
    listener,
    options,
  ) {
    const index = soakListenerTracker.domEntries.findIndex(
      (entry) =>
        (this === window || this === document) &&
        entry.target === this &&
        entry.type === type &&
        entry.listener === listener &&
        listener !== null,
    );
    if (index >= 0) {
      soakListenerTracker.domEntries.splice(index, 1);
    }
    originalRemoveEventListener.call(this, type, listener, options);
  };
  vi.stubGlobal(
    "matchMedia",
    (query: string) => ({
      addEventListener: (...args: unknown[]) => {
        addMediaListener(query, args[args.length - 1]);
      },
      addListener: (listener: unknown) => {
        addMediaListener(query, listener);
      },
      dispatchEvent: () => false,
      matches: false,
      media: query,
      onchange: null,
      removeEventListener: (...args: unknown[]) => {
        removeMediaListener(query, args[args.length - 1]);
      },
      removeListener: (listener: unknown) => {
        removeMediaListener(query, listener);
      },
    }) as unknown as MediaQueryList,
  );
  vi.stubGlobal(
    "ResizeObserver",
    class ResizeObserver {
      /** jsdom 没有布局观察任务，空实现避免制造虚假异步资源。 */
      disconnect() {}
      /** xterm 仍可登记目标，但几何变化由可控 surface scheduler 驱动。 */
      observe() {}
      /** 单目标撤销不需要额外状态，因为测试观察器不会派发 callback。 */
      unobserve() {}
    },
  );
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    // xterm CPU 路径只需要 2D context；其余类型返回 null，避免 fake GPU 边界
    // 把非 GL stub 误记为兼容性失败。
    value: (type: string) =>
      type === "2d" ? createSoakCanvasContextStub() : null,
  });
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get: () => 320,
  });
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get: () => 16,
  });
  restoreSoakBrowserPrimitives = () => {
    // 不使用 vi.spyOn 是为了避免 mock.calls 强引用每个已释放 terminal DOM。
    EventTarget.prototype.addEventListener = originalAddEventListener;
    EventTarget.prototype.removeEventListener = originalRemoveEventListener;
    restorePropertyDescriptor(
      HTMLCanvasElement.prototype,
      "getContext",
      getContextDescriptor,
    );
    restorePropertyDescriptor(
      HTMLElement.prototype,
      "offsetWidth",
      offsetWidthDescriptor,
    );
    restorePropertyDescriptor(
      HTMLElement.prototype,
      "offsetHeight",
      offsetHeightDescriptor,
    );
  };
}

/** 按原 descriptor 恢复浏览器原语，避免 soak 结束后改变同 worker 的测试环境。 */
function restorePropertyDescriptor(
  target: object,
  property: PropertyKey,
  descriptor: PropertyDescriptor | undefined,
) {
  if (descriptor) {
    Object.defineProperty(target, property, descriptor);
    return;
  }
  Reflect.deleteProperty(target, property);
}

/** 只有真实 remove 才抵扣 legacy/modern MediaQueryList 的活动 listener。 */
function removeMediaListener(
  query: string,
  listener: unknown,
) {
  if (!isMediaListener(listener)) {
    return;
  }
  const index = soakListenerTracker.mediaEntries.findIndex(
    (entry) => entry.query === query && entry.listener === listener,
  );
  if (index >= 0) {
    soakListenerTracker.mediaEntries.splice(index, 1);
  }
}

/** 仅记录有效 listener，避免浏览器允许的 null 注册污染资源指标。 */
function addMediaListener(query: string, listener: unknown) {
  if (isMediaListener(listener)) {
    soakListenerTracker.mediaEntries.push({ listener, query });
  }
}

/** 收窄 listener 类型并排除 JavaScript 中 `typeof null === "object"` 的陷阱。 */
function isMediaListener(
  listener: unknown,
): listener is EventListenerOrEventListenerObject {
  return (
    listener !== null &&
    (typeof listener === "function" || typeof listener === "object")
  );
}
/**
 * 只补 xterm 在 jsdom 建立真实 Terminal 所需的测量/绘制入口；DOM ownership
 * 仍由 xterm 本身管理并在 pane.dispose 中回收。
 */
function createSoakCanvasContextStub() {
  return {
    beginPath: () => {},
    clearRect: () => {},
    clip: () => {},
    closePath: () => {},
    createLinearGradient: () => ({ addColorStop: () => {} }),
    drawImage: () => {},
    fillRect: () => {},
    fillText: () => {},
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
    measureText: () => ({ width: 10 }),
    putImageData: () => {},
    rect: () => {},
    restore: () => {},
    save: () => {},
    scale: () => {},
    setTransform: () => {},
    strokeRect: () => {},
    strokeText: () => {},
    translate: () => {},
  };
}
