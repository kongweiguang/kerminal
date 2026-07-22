// @author kongweiguang

import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_TERMINAL_RENDERER_FEATURE_GATES,
  TERMINAL_RENDERER_FEATURE_GATES_STORAGE_KEY,
  resolveRuntimeTerminalRendererFeatureGates,
  resolveTerminalRendererFeatureGates,
} from "../../../../src/features/terminal/terminalRendererFeatureGates";

describe("terminalRendererFeatureGates", () => {
  it("enables stable defaults but keeps private cleanup opt-in", () => {
    expect(DEFAULT_TERMINAL_RENDERER_FEATURE_GATES).toEqual({
      adaptiveOutputScheduler: true,
      healthWatchdog: true,
      performanceTelemetry: true,
      privateCleanupCompat: false,
    });
  });

  it("supports independent operational gates without a legacy lifecycle switch", () => {
    expect(
      resolveTerminalRendererFeatureGates({
        adaptiveOutputScheduler: false,
      }),
    ).toEqual({
      adaptiveOutputScheduler: false,
      healthWatchdog: true,
      performanceTelemetry: true,
      privateCleanupCompat: false,
    });
  });

  it("combines deployment defaults with a local emergency override", () => {
    const storage = {
      getItem: vi.fn((key: string) =>
        key === TERMINAL_RENDERER_FEATURE_GATES_STORAGE_KEY
          ? JSON.stringify({
              adaptiveOutputScheduler: false,
            })
          : null,
      ),
    };

    expect(
      resolveRuntimeTerminalRendererFeatureGates({
        env: {
          VITE_TERMINAL_RENDERER_HEALTH_WATCHDOG: "0",
        },
        storage,
      }),
    ).toEqual({
      adaptiveOutputScheduler: false,
      healthWatchdog: false,
      performanceTelemetry: true,
      privateCleanupCompat: false,
    });
  });
});
