// @author kongweiguang

import { describe, expect, it, vi } from "vitest";
import {
  ACTUAL_XTERM_WEBGL_COMPATIBILITY_VERSIONS,
  VERIFIED_XTERM_WEBGL_COMPATIBILITY_VERSIONS,
  createXtermWebglCompatibilityAdapter,
  type XtermWebglCompatibilityVersions,
} from "../../../../src/features/terminal/terminalRendererCompatibility";

const VERIFIED_VERSIONS: XtermWebglCompatibilityVersions = {
  ...VERIFIED_XTERM_WEBGL_COMPATIBILITY_VERSIONS,
};

describe("terminalRendererCompatibility", () => {
  it("keeps build dependency versions separate from verified compatibility versions", () => {
    expect(ACTUAL_XTERM_WEBGL_COMPATIBILITY_VERSIONS).toEqual({
      webglAddon: "0.20.0-beta.287",
      xterm: "6.1.0-beta.288",
    });
    expect(ACTUAL_XTERM_WEBGL_COMPATIBILITY_VERSIONS).not.toEqual(
      VERIFIED_XTERM_WEBGL_COMPATIBILITY_VERSIONS,
    );
  });

  it("uses public dispose by default without touching private compatibility paths", () => {
    const canvas = document.createElement("canvas");
    const getContext = vi.fn();
    Object.defineProperty(canvas, "getContext", { value: getContext });
    const renderer = createPrivateRenderer();
    const addon = {
      _renderer: renderer,
      dispose: vi.fn(),
    };
    const adapter = createXtermWebglCompatibilityAdapter({
      versions: VERIFIED_VERSIONS,
    });

    adapter.dispose({ addon, canvases: [canvas] });

    expect(adapter.capabilities).toEqual({
      forceContextLoss: false,
      privateRendererCleanup: false,
    });
    expect(addon.dispose).toHaveBeenCalledOnce();
    expect(getContext).not.toHaveBeenCalled();
    expect(renderer._canvas).toBeDefined();
    expect(renderer._charAtlas).toBeDefined();
    expect(renderer._gl).toBeDefined();
  });

  it("enables forced context loss and private cleanup only for the verified version pair", () => {
    const loseContext = vi.fn();
    const getExtension = vi.fn(() => ({ loseContext }));
    const canvas = createWebglCanvas({
      getExtension,
      isContextLost: () => false,
    });
    const renderer = createPrivateRenderer();
    const addon = {
      _renderer: renderer,
      dispose: vi.fn(),
    };
    const adapter = createXtermWebglCompatibilityAdapter({
      capabilityGate: {
        forceContextLoss: true,
        privateRendererCleanup: true,
      },
      versions: VERIFIED_VERSIONS,
    });

    adapter.dispose({ addon, canvases: [canvas, canvas] });

    expect(adapter.capabilities).toEqual({
      forceContextLoss: true,
      privateRendererCleanup: true,
    });
    expect(addon.dispose).toHaveBeenCalledOnce();
    expect(getExtension).toHaveBeenCalledWith("WEBGL_lose_context");
    expect(loseContext).toHaveBeenCalledOnce();
    expect(addon.dispose.mock.invocationCallOrder[0]).toBeLessThan(
      loseContext.mock.invocationCallOrder[0],
    );
    expect(canvas.width).toBe(0);
    expect(canvas.height).toBe(0);
    expect(renderer).toEqual({
      _atlas: undefined,
      _canvas: undefined,
      _charAtlas: undefined,
      _gl: undefined,
      canvas: undefined,
      gl: undefined,
    });
  });

  it.each([
    {
      label: "xterm version mismatch",
      versions: { webglAddon: "0.19.0", xterm: "6.0.1" },
    },
    {
      label: "WebGL addon version mismatch",
      versions: { webglAddon: "0.19.1", xterm: "6.0.0" },
    },
  ])(
    "keeps private compatibility as a safe no-op for $label",
    ({ versions }) => {
      const canvas = document.createElement("canvas");
      const getContext = vi.fn();
      Object.defineProperty(canvas, "getContext", { value: getContext });
      const renderer = createPrivateRenderer();
      const addon = {
        _renderer: renderer,
        dispose: vi.fn(),
      };
      const adapter = createXtermWebglCompatibilityAdapter({
        capabilityGate: {
          forceContextLoss: true,
          privateRendererCleanup: true,
        },
        versions,
      });

      adapter.dispose({ addon, canvases: [canvas] });

      expect(adapter.capabilities).toEqual({
        forceContextLoss: false,
        privateRendererCleanup: false,
      });
      expect(addon.dispose).toHaveBeenCalledOnce();
      expect(getContext).not.toHaveBeenCalled();
      expect(renderer._canvas).toBeDefined();
      expect(renderer._charAtlas).toBeDefined();
      expect(renderer._gl).toBeDefined();
    },
  );

  it("keeps private cleanup disabled for the current unverified build even with an unsafe opt-in", () => {
    const canvas = document.createElement("canvas");
    const getContext = vi.fn();
    Object.defineProperty(canvas, "getContext", { value: getContext });
    const renderer = createPrivateRenderer();
    const addon = {
      _renderer: renderer,
      dispose: vi.fn(),
    };
    const logger = { warn: vi.fn() };
    const adapter = createXtermWebglCompatibilityAdapter({
      capabilityGate: {
        forceContextLoss: true,
        privateRendererCleanup: true,
      },
      logger,
      versions: ACTUAL_XTERM_WEBGL_COMPATIBILITY_VERSIONS,
    });

    adapter.dispose({ addon, canvases: [canvas] });

    expect(adapter.capabilities).toEqual({
      forceContextLoss: false,
      privateRendererCleanup: false,
    });
    expect(addon.dispose).toHaveBeenCalledOnce();
    expect(getContext).not.toHaveBeenCalled();
    expect(renderer._canvas).toBeDefined();
    expect(renderer._charAtlas).toBeDefined();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("unverified versions"),
      undefined,
    );
  });

  it("continues verified compatibility cleanup when public dispose throws", () => {
    const logger = { warn: vi.fn() };
    const loseContext = vi.fn();
    const canvas = createWebglCanvas({
      getExtension: () => ({ loseContext }),
      isContextLost: () => false,
    });
    const renderer = createPrivateRenderer();
    const addon = {
      _renderer: renderer,
      dispose: vi.fn(() => {
        throw new Error("dispose failed");
      }),
    };
    const adapter = createXtermWebglCompatibilityAdapter({
      capabilityGate: {
        forceContextLoss: true,
        privateRendererCleanup: true,
      },
      logger,
      versions: VERIFIED_VERSIONS,
    });

    expect(() => adapter.dispose({ addon, canvases: [canvas] })).not.toThrow();

    expect(addon.dispose).toHaveBeenCalledOnce();
    expect(loseContext).toHaveBeenCalledOnce();
    expect(renderer._gl).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("renderer dispose failed"),
      expect.any(Error),
    );
  });

  it("isolates context and private cleanup failures from the dispose boundary", () => {
    const logger = {
      warn: vi.fn(() => {
        throw new Error("logger failed");
      }),
    };
    const canvas = createWebglCanvas({
      getExtension: () => {
        throw new Error("extension failed");
      },
      isContextLost: () => false,
    });
    const renderer = createPrivateRenderer();
    Object.defineProperty(renderer, "_canvas", {
      configurable: true,
      get: () => canvas,
      set: () => {
        throw new Error("private cleanup failed");
      },
    });
    const addon = {
      _renderer: renderer,
      dispose: vi.fn(),
    };
    const adapter = createXtermWebglCompatibilityAdapter({
      capabilityGate: {
        forceContextLoss: true,
        privateRendererCleanup: true,
      },
      logger,
      versions: VERIFIED_VERSIONS,
    });

    expect(() => adapter.dispose({ addon, canvases: [canvas] })).not.toThrow();

    expect(addon.dispose).toHaveBeenCalledOnce();
    expect(renderer._canvas).toBe(canvas);
    expect(renderer._gl).toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
  });
});

function createPrivateRenderer() {
  return {
    _atlas: {},
    _canvas: document.createElement("canvas") as HTMLCanvasElement | undefined,
    _charAtlas: {},
    _gl: {},
    canvas: document.createElement("canvas") as HTMLCanvasElement | undefined,
    gl: {},
  };
}

function createWebglCanvas(context: TestWebglContext) {
  const canvas = document.createElement("canvas");
  Object.defineProperty(canvas, "getContext", {
    value: vi.fn((type: string) => (type === "webgl2" ? context : null)),
  });
  return canvas;
}

interface TestWebglContext {
  getExtension(name: string): { loseContext(): void } | null;
  isContextLost(): boolean;
}
