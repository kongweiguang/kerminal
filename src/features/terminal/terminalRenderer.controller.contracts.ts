import type { ITerminalAddon } from "@xterm/xterm";
import type { TerminalRendererType } from "../settings/contracts/index";
import type {
  XtermWebglCompatibilityAdapter,
  XtermWebglCompatibilityCapabilityGate,
} from "./terminalRendererCompatibility";
import type {
  TerminalRendererLifecycleSnapshot,
  TerminalRendererTransitionLedgerEntry,
} from "./terminalRendererLifecycle";
import type {
  TerminalRendererHealthDecision,
  TerminalRendererHealthObservation,
  TerminalRendererHealthSnapshot,
} from "./terminalRendererHealth";
import type {
  TerminalRendererPerformanceSnapshot,
  TerminalRendererPerformanceTelemetry,
} from "./terminalRendererPerformanceTelemetry";
import type {
  TerminalRendererBackend,
  TerminalRendererFallbackReason,
} from "./terminalRendererPolicy";
import type { TerminalGpuPlatformClass } from "./terminalRendererPlatform";
import type { WebglAddonConstructor } from "./terminalRenderer.webglResources";

export type TerminalRendererTimerHandle = ReturnType<typeof window.setTimeout>;

export interface TerminalRendererState {
  backend: TerminalRendererBackend;
  canvasCount: number;
  fallbackReason?: TerminalRendererFallbackReason;
  mode: TerminalRendererType;
}

export interface TerminalRendererDiagnostics {
  activeTimerCount: number;
  circuitOpen: boolean;
  contextLossCount: number;
  gpuPlatformClass: TerminalGpuPlatformClass;
  health: TerminalRendererHealthSnapshot;
  lifecycle: TerminalRendererLifecycleSnapshot;
  retryCount: number;
  telemetry: TerminalRendererPerformanceSnapshot;
  transitions: readonly TerminalRendererTransitionLedgerEntry[];
}

export interface TerminalRendererTerminal {
  element?: HTMLElement | null;
  loadAddon(addon: ITerminalAddon): void;
  refresh?(start: number, end: number): void;
  rows: number;
}

interface TerminalRendererLogger {
  warn(message: string, error?: unknown): void;
}

export interface TerminalRendererController {
  attach(): void;
  /** 返回当前灰度配置是否允许发起 GPU attach。 */
  canAttemptGpu(): boolean;
  clearTextureAtlas(): void;
  dispose(): void;
  getDiagnostics(): TerminalRendererDiagnostics;
  /** 返回主 WebGL renderer canvas，不包含 texture atlas 等辅助 canvas。 */
  getTrackedRendererCanvases(): readonly HTMLCanvasElement[];
  getState(): TerminalRendererState;
  reportHealth(
    observation: Omit<TerminalRendererHealthObservation, "backend">,
  ): TerminalRendererHealthDecision;
  resume(): void;
  retryGpu(): void;
  suspend(): void;
  updateMode(mode: TerminalRendererType): void;
}

export interface CreateTerminalRendererControllerOptions {
  attachTimeoutMs?: number;
  cancelRetry?: (handle: TerminalRendererTimerHandle) => void;
  compatibilityAdapter?: XtermWebglCompatibilityAdapter;
  compatibilityGate?: XtermWebglCompatibilityCapabilityGate;
  contextLossCircuitThreshold?: number;
  contextLossWindowMs?: number;
  healthWatchdogEnabled?: boolean;
  gpuPlatformClass?: TerminalGpuPlatformClass;
  lifecycleV2Enabled?: boolean;
  loadWebglAddon?: () => Promise<{ WebglAddon: WebglAddonConstructor }>;
  logger?: TerminalRendererLogger;
  maxRecoveryAttempts?: number;
  maxRecoveryElapsedMs?: number;
  now?: () => number;
  onStateChange?: (state: TerminalRendererState) => void;
  shouldUseAutoGpu?: (platformClass: TerminalGpuPlatformClass) => boolean;
  paneId: string;
  random?: () => number;
  recoveryJitterRatio?: number;
  rendererType: TerminalRendererType;
  retryDelayMs?: number;
  retryDelaysMs?: readonly number[];
  scheduleRetry?: (
    callback: () => void,
    delayMs: number,
  ) => TerminalRendererTimerHandle;
  telemetry?: TerminalRendererPerformanceTelemetry;
  terminal: TerminalRendererTerminal;
}
