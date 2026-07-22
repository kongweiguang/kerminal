import type { IDisposable, ITerminalAddon, Terminal } from "@xterm/xterm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTerminalRendererController,
  type TerminalRendererState,
  type TerminalRendererTerminal,
} from "../../../../src/features/terminal/terminalRenderer";

class FakeTerminal implements TerminalRendererTerminal {
  element: HTMLElement | null = document.createElement("div");
  loadedAddons: ITerminalAddon[] = [];
  refresh = vi.fn();
  rows = 12;

  loadAddon(addon: ITerminalAddon): void {
    this.loadedAddons.push(addon);
    addon.activate(this as unknown as Terminal);
  }
}

class FakeWebglAddon implements ITerminalAddon {
  static instances: FakeWebglAddon[] = [];

  private atlasAddListeners: Array<(canvas: HTMLCanvasElement) => void> = [];
  private atlasChangeListeners: Array<(canvas: HTMLCanvasElement) => void> = [];
  private contextLossListeners: Array<() => void> = [];
  private atlasRemoveListeners: Array<(canvas: HTMLCanvasElement) => void> = [];
  activate = vi.fn();
  clearTextureAtlas = vi.fn();
  dispose = vi.fn();
  textureAtlas = document.createElement("canvas");
  _renderer = {
    _atlas: {},
    _canvas: document.createElement("canvas"),
    _charAtlas: {},
    _gl: {},
  };

  constructor() {
    FakeWebglAddon.instances.push(this);
  }

  onAddTextureAtlasCanvas(listener: (canvas: HTMLCanvasElement) => void) {
    this.atlasAddListeners.push(listener);
    return {
      dispose: vi.fn(() => {
        this.atlasAddListeners = this.atlasAddListeners.filter(
          (candidate) => candidate !== listener,
        );
      }),
    };
  }

  onChangeTextureAtlas(listener: (canvas: HTMLCanvasElement) => void) {
    this.atlasChangeListeners.push(listener);
    return {
      dispose: vi.fn(() => {
        this.atlasChangeListeners = this.atlasChangeListeners.filter(
          (candidate) => candidate !== listener,
        );
      }),
    };
  }

  onContextLoss(listener: () => void): IDisposable {
    this.contextLossListeners.push(listener);
    return {
      dispose: vi.fn(() => {
        this.contextLossListeners = this.contextLossListeners.filter(
          (candidate) => candidate !== listener,
        );
      }),
    };
  }

  onRemoveTextureAtlasCanvas(listener: (canvas: HTMLCanvasElement) => void) {
    this.atlasRemoveListeners.push(listener);
    return {
      dispose: vi.fn(() => {
        this.atlasRemoveListeners = this.atlasRemoveListeners.filter(
          (candidate) => candidate !== listener,
        );
      }),
    };
  }

  emitAddTextureAtlasCanvas(canvas: HTMLCanvasElement): void {
    for (const listener of [...this.atlasAddListeners]) {
      listener(canvas);
    }
  }

  emitChangeTextureAtlas(canvas: HTMLCanvasElement): void {
    for (const listener of [...this.atlasChangeListeners]) {
      listener(canvas);
    }
  }

  emitContextLoss(): void {
    for (const listener of [...this.contextLossListeners]) {
      listener();
    }
  }

  emitRemoveTextureAtlasCanvas(canvas: HTMLCanvasElement): void {
    for (const listener of [...this.atlasRemoveListeners]) {
      listener(canvas);
    }
  }
}

class TrackedCanvasWebglAddon implements ITerminalAddon {
  static instances: TrackedCanvasWebglAddon[] = [];

  rendererCanvas = document.createElement("canvas");
  textureAtlas = document.createElement("canvas");
  _renderer = {
    _atlas: {},
    _canvas: this.rendererCanvas,
    _charAtlas: {},
    _gl: {},
  };

  constructor() {
    TrackedCanvasWebglAddon.instances.push(this);
  }

  activate(terminal: Terminal): void {
    terminal.element?.append(this.rendererCanvas, this.textureAtlas);
  }

  dispose(): void {
    this.rendererCanvas.remove();
    this.textureAtlas.remove();
  }

  onContextLoss(): IDisposable {
    return { dispose: vi.fn() };
  }
}

describe("terminalRenderer", () => {
  beforeEach(() => {
    FakeWebglAddon.instances = [];
    TrackedCanvasWebglAddon.instances = [];
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      () => null,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps CPU mode on the default xterm renderer without loading WebGL", () => {
    const loadWebglAddon = vi.fn();
    const terminal = new FakeTerminal();
    const controller = createTerminalRendererController({
      loadWebglAddon,
      paneId: "pane-1",
      rendererType: "cpu",
      terminal,
    });

    controller.attach();

    expect(loadWebglAddon).not.toHaveBeenCalled();
    expect(terminal.loadedAddons).toHaveLength(0);
    expect(controller.getState()).toEqual({
      backend: "cpu",
      canvasCount: 0,
      fallbackReason: undefined,
      mode: "cpu",
    });
  });

  it("keeps Auto on CPU when the platform is definitively software rendered", () => {
    const loadWebglAddon = vi.fn();
    const terminal = new FakeTerminal();
    const controller = createTerminalRendererController({
      gpuPlatformClass: "software",
      loadWebglAddon,
      paneId: "pane-software-gpu",
      rendererType: "auto",
      shouldUseAutoGpu: () => false,
      terminal,
    });

    controller.attach();
    controller.retryGpu();

    expect(loadWebglAddon).not.toHaveBeenCalled();
    expect(controller.canAttemptGpu()).toBe(false);
    expect(controller.getState()).toEqual({
      backend: "cpu",
      canvasCount: 0,
      fallbackReason: "software-gpu",
      mode: "auto",
    });
    expect(controller.getDiagnostics().gpuPlatformClass).toBe(
      "software",
    );
  });

  it("still honors explicit GPU mode on a software-rendered platform", async () => {
    const loadWebglAddon = vi
      .fn()
      .mockResolvedValue({ WebglAddon: FakeWebglAddon });
    const controller = createTerminalRendererController({
      loadWebglAddon,
      paneId: "pane-forced-software-gpu",
      rendererType: "gpu",
      shouldUseAutoGpu: () => false,
      terminal: new FakeTerminal(),
    });

    controller.attach();
    await vi.waitFor(() => {
      expect(controller.getState().backend).toBe("gpu");
    });

    expect(controller.canAttemptGpu()).toBe(true);
    expect(loadWebglAddon).toHaveBeenCalledTimes(1);
  });

  it("clears software fallback before switching Auto to explicit GPU", async () => {
    const states: TerminalRendererState[] = [];
    const controller = createTerminalRendererController({
      loadWebglAddon: async () => ({ WebglAddon: FakeWebglAddon }),
      onStateChange: (state) => states.push(state),
      paneId: "pane-software-auto-to-gpu",
      rendererType: "auto",
      shouldUseAutoGpu: () => false,
      terminal: new FakeTerminal(),
    });

    expect(controller.getState().fallbackReason).toBe("software-gpu");
    controller.updateMode("gpu");
    await vi.waitFor(() => {
      expect(controller.getState().backend).toBe("gpu");
    });

    expect(
      states.some(
        (state) =>
          state.mode === "gpu" && state.fallbackReason === "software-gpu",
      ),
    ).toBe(false);
  });

  it("keeps a stable CPU rollback when lifecycle V2 is disabled", () => {
    const loadWebglAddon = vi.fn();
    const controller = createTerminalRendererController({
      lifecycleV2Enabled: false,
      loadWebglAddon,
      paneId: "pane-1",
      rendererType: "gpu",
      terminal: new FakeTerminal(),
    });

    controller.attach();
    controller.retryGpu();

    expect(loadWebglAddon).not.toHaveBeenCalled();
    expect(controller.getState()).toEqual({
      backend: "cpu",
      canvasCount: 0,
      fallbackReason: undefined,
      mode: "gpu",
    });
    expect(controller.getDiagnostics().lifecycle.state).toBe("cpu-ready");
  });

  it("attaches the WebGL addon in auto mode", async () => {
    const terminal = new FakeTerminal();
    const controller = createTerminalRendererController({
      loadWebglAddon: vi.fn().mockResolvedValue({ WebglAddon: FakeWebglAddon }),
      paneId: "pane-1",
      rendererType: "auto",
      terminal,
    });

    controller.attach();
    await flushPromises();

    expect(terminal.loadedAddons).toHaveLength(1);
    expect(FakeWebglAddon.instances[0].activate).toHaveBeenCalled();
    expect(controller.getState()).toEqual({
      backend: "gpu",
      canvasCount: 1,
      fallbackReason: undefined,
      mode: "auto",
    });
    expect(terminal.refresh).not.toHaveBeenCalled();
  });

  it("falls back to CPU when the WebGL chunk fails to load", async () => {
    const logger = { warn: vi.fn() };
    const controller = createTerminalRendererController({
      loadWebglAddon: vi.fn().mockRejectedValue(new Error("chunk failed")),
      logger,
      paneId: "pane-1",
      rendererType: "auto",
      terminal: new FakeTerminal(),
    });

    controller.attach();
    await flushPromises();

    expect(controller.getState()).toEqual({
      backend: "cpu",
      canvasCount: 0,
      fallbackReason: "import-failed",
      mode: "auto",
    });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("WebGL renderer chunk failed"),
      expect.any(Error),
    );
  });

  it("falls back to CPU when xterm rejects the WebGL addon", async () => {
    const logger = { warn: vi.fn() };
    const terminal = new FakeTerminal();
    terminal.loadAddon = vi.fn(() => {
      throw new Error("load failed");
    });
    const controller = createTerminalRendererController({
      loadWebglAddon: vi.fn().mockResolvedValue({ WebglAddon: FakeWebglAddon }),
      logger,
      paneId: "pane-1",
      rendererType: "gpu",
      terminal,
    });

    controller.attach();
    await flushPromises();

    expect(controller.getState()).toEqual({
      backend: "cpu",
      canvasCount: 0,
      fallbackReason: "load-failed",
      mode: "gpu",
    });
    expect(FakeWebglAddon.instances[0].dispose).toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("WebGL renderer unavailable"),
      expect.any(Error),
    );
  });

  it("falls back on context loss and retries while GPU remains enabled", async () => {
    const scheduler = new ManualTimerScheduler();
    const terminal = new FakeTerminal();
    const controller = createTerminalRendererController({
      loadWebglAddon: vi.fn().mockResolvedValue({ WebglAddon: FakeWebglAddon }),
      paneId: "pane-1",
      recoveryJitterRatio: 0,
      rendererType: "auto",
      scheduleRetry: scheduler.schedule,
      cancelRetry: scheduler.cancel,
      terminal,
    });

    controller.attach();
    await flushPromises();

    FakeWebglAddon.instances[0].emitContextLoss();

    expect(controller.getState()).toEqual({
      backend: "cpu",
      canvasCount: 0,
      fallbackReason: "context-lost",
      mode: "auto",
    });
    expect(scheduler.pendingCount()).toBe(1);
    expect(FakeWebglAddon.instances[0].dispose).toHaveBeenCalled();

    scheduler.runNext();
    await flushPromises();

    expect(FakeWebglAddon.instances).toHaveLength(2);
    expect(controller.getState()).toEqual({
      backend: "gpu",
      canvasCount: 1,
      fallbackReason: undefined,
      mode: "auto",
    });
  });

  it("tracks texture atlas canvases from WebGL events", async () => {
    const onStateChange = vi.fn();
    const terminal = new FakeTerminal();
    const controller = createTerminalRendererController({
      loadWebglAddon: vi.fn().mockResolvedValue({ WebglAddon: FakeWebglAddon }),
      onStateChange,
      paneId: "pane-1",
      rendererType: "auto",
      terminal,
    });

    controller.attach();
    await flushPromises();
    const addon = FakeWebglAddon.instances[0];
    const extraCanvas = document.createElement("canvas");
    const changedCanvas = document.createElement("canvas");

    addon.emitAddTextureAtlasCanvas(extraCanvas);
    addon.emitChangeTextureAtlas(changedCanvas);

    expect(controller.getState().canvasCount).toBe(3);

    addon.emitRemoveTextureAtlasCanvas(extraCanvas);

    expect(controller.getState().canvasCount).toBe(2);
    expect(onStateChange).toHaveBeenCalledWith(
      expect.objectContaining({ backend: "gpu", canvasCount: 2 }),
    );
  });


});

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

class ManualTimerScheduler {
  private callbacks = new Map<number, () => void>();
  private nextHandle = 1;

  cancel = vi.fn((handle: number) => {
    this.callbacks.delete(handle);
  });

  schedule = vi.fn((callback: () => void) => {
    const handle = this.nextHandle++;
    this.callbacks.set(handle, callback);
    return handle;
  });

  pendingCount() {
    return this.callbacks.size;
  }

  runNext() {
    const next = this.callbacks.entries().next().value as
      [number, () => void] | undefined;
    if (!next) {
      return;
    }
    const [handle, callback] = next;
    this.callbacks.delete(handle);
    callback();
  }

  runAll() {
    while (this.callbacks.size > 0) {
      this.runNext();
    }
  }
}
