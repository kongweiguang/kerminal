import type { TerminalRendererType } from "../settings/contracts/index";
import {
  createXtermWebglCompatibilityAdapter,
  VERIFIED_XTERM_WEBGL_COMPATIBILITY_VERSIONS,
} from "./terminalRendererCompatibility";
import {
  createTerminalRendererLifecycle,
  type TerminalRendererGenerationToken,
} from "./terminalRendererLifecycle";
import { createTerminalRendererHealthController, type TerminalRendererHealthObservation } from "./terminalRendererHealth";
import {
  createTerminalRendererPerformanceTelemetry,
  type TerminalRendererPerformanceTelemetry,
} from "./terminalRendererPerformanceTelemetry";
import type { TerminalRendererFallbackReason } from "./terminalRendererPolicy";
import { detectTerminalGpuPlatform, shouldUseAutoGpuRenderer } from "./terminalRendererPlatform";
import {
  DEFAULT_ATTACH_TIMEOUT_MS,
  DEFAULT_CONTEXT_LOSS_WINDOW_MS,
  DEFAULT_MAX_RECOVERY_ATTEMPTS,
  DEFAULT_MAX_RECOVERY_ELAPSED_MS,
  DEFAULT_RECOVERY_JITTER_RATIO,
  DEFAULT_RECOVERY_RETRY_DELAYS_MS,
  jitterDelay,
  normalizeRetryDelays,
  shouldAttemptGpuRenderer,
  validatePositiveDuration,
  validatePositiveInteger,
  validateRatio,
} from "./terminalRenderer.controller.config";
import type {
  CreateTerminalRendererControllerOptions,
  TerminalRendererController,
  TerminalRendererDiagnostics,
  TerminalRendererState,
  TerminalRendererTerminal,
  TerminalRendererTimerHandle,
} from "./terminalRenderer.controller.contracts";
import {
  createWebglRendererCandidate,
  loadWebglRendererCandidate,
  type ActiveWebglRenderer,
  type WebglAddonLike,
} from "./terminalRenderer.webglResources";

type TimerHandle = TerminalRendererTimerHandle;
type GpuOperationKind = "attach" | "recovery";

interface GpuOperation {
  attempt: number;
  kind: GpuOperationKind;
  startedAt: number;
  token: TerminalRendererGenerationToken;
}

/**
 * 创建 pane 级 renderer controller。
 *
 * xterm core、buffer 和 PTY 始终由调用方持有；本控制器只管理可替换的
 * WebGL addon，因此任何 GPU 故障都只能回退 CPU，不能销毁终端会话。
 */
export function createTerminalRendererController({
  attachTimeoutMs = DEFAULT_ATTACH_TIMEOUT_MS,
  cancelRetry = window.clearTimeout.bind(window),
  compatibilityAdapter,
  compatibilityGate,
  contextLossCircuitThreshold = DEFAULT_MAX_RECOVERY_ATTEMPTS,
  contextLossWindowMs = DEFAULT_CONTEXT_LOSS_WINDOW_MS,
  healthWatchdogEnabled = true,
  gpuPlatformClass,
  lifecycleV2Enabled = true,
  loadWebglAddon = defaultLoadWebglAddon,
  logger = console,
  maxRecoveryAttempts = DEFAULT_MAX_RECOVERY_ATTEMPTS,
  maxRecoveryElapsedMs = DEFAULT_MAX_RECOVERY_ELAPSED_MS,
  now = () => Date.now(),
  onStateChange,
  paneId,
  random = Math.random,
  recoveryJitterRatio = DEFAULT_RECOVERY_JITTER_RATIO,
  rendererType,
  retryDelayMs,
  retryDelaysMs = retryDelayMs === undefined
    ? DEFAULT_RECOVERY_RETRY_DELAYS_MS
    : [retryDelayMs],
  scheduleRetry = window.setTimeout.bind(window),
  shouldUseAutoGpu = shouldUseAutoGpuRenderer,
  telemetry = createTerminalRendererPerformanceTelemetry(),
  terminal,
}: CreateTerminalRendererControllerOptions): TerminalRendererController {
  validatePositiveDuration("attachTimeoutMs", attachTimeoutMs);
  validatePositiveInteger(
    "contextLossCircuitThreshold",
    contextLossCircuitThreshold,
  );
  validatePositiveDuration("contextLossWindowMs", contextLossWindowMs);
  validatePositiveInteger("maxRecoveryAttempts", maxRecoveryAttempts);
  validatePositiveDuration("maxRecoveryElapsedMs", maxRecoveryElapsedMs);
  validateRatio("recoveryJitterRatio", recoveryJitterRatio);

  const lifecycle = createTerminalRendererLifecycle({ now, paneId });
  const health = createTerminalRendererHealthController({
    l2CircuitThreshold: contextLossCircuitThreshold,
    l2FaultWindowMs: contextLossWindowMs,
  });
  const compat =
    compatibilityAdapter ??
    createXtermWebglCompatibilityAdapter({
      capabilityGate: compatibilityGate,
      logger,
      versions: VERIFIED_XTERM_WEBGL_COMPATIBILITY_VERSIONS,
    });
  const resolvedRetryDelays = normalizeRetryDelays(retryDelaysMs);
  const resolvedGpuPlatformClass =
    gpuPlatformClass ?? detectTerminalGpuPlatform();
  const autoGpuAllowed = shouldUseAutoGpu(resolvedGpuPlatformClass);

  let activeWebgl: ActiveWebglRenderer | null = null;
  let attachTimeoutHandle: TimerHandle | null = null;
  let circuitOpen = false;
  let contextLossCount = 0;
  let contextLossWindowStartedAt: number | undefined;
  let disposed = false;
  let fallbackReason: TerminalRendererFallbackReason | undefined =
    rendererType === "auto" && !autoGpuAllowed ? "software-gpu" : undefined;
  let mode = rendererType;
  let recoveryStartedAt: number | undefined;
  let retryCount = 0;
  let retryHandle: TimerHandle | null = null;

  const state = (): TerminalRendererState => ({
    backend: activeWebgl ? "gpu" : "cpu",
    canvasCount: activeWebgl?.canvases.size ?? 0,
    fallbackReason,
    mode,
  });

  const syncTelemetryResources = () => {
    telemetry.setResources({
      activeCanvases: activeWebgl?.canvases.size ?? 0,
      activeContexts: activeWebgl ? 1 : 0,
      activeGpuPanes: activeWebgl ? 1 : 0,
    });
  };

  const emitStateChange = () => {
    syncTelemetryResources();
    onStateChange?.(state());
  };

  const clearAttachTimeout = () => {
    if (attachTimeoutHandle === null) {
      return;
    }
    cancelRetry(attachTimeoutHandle);
    attachTimeoutHandle = null;
  };

  const clearRetry = () => {
    if (retryHandle === null) {
      return;
    }
    cancelRetry(retryHandle);
    retryHandle = null;
  };

  const clearTimers = () => {
    clearAttachTimeout();
    clearRetry();
  };

  const recordStaleCommit = () => {
    telemetry.increment("staleCommitRejectedCount");
  };

  const canCommit = (token: TerminalRendererGenerationToken) => {
    const accepted = lifecycle.canCommitGeneration(token);
    if (!accepted) {
      recordStaleCommit();
    }
    return accepted;
  };

  const setFallbackReason = (reason: TerminalRendererFallbackReason) => {
    fallbackReason = reason;
    emitStateChange();
  };

  const disposeRendererResources = (renderer: ActiveWebglRenderer) => {
    for (const disposable of renderer.disposables) {
      try {
        disposable.dispose();
      } catch (error) {
        logger.warn("[kerminal-terminal-renderer] dispose event failed", error);
      }
    }
    // xterm 会让相同配置的终端共享 atlas；释放单个 pane 时清空它会让其它
    // renderer 保留失效的纹理坐标，表现为选中或 resize 前持续乱码。
    compat.dispose({
      addon: renderer.addon,
      canvases: renderer.canvases,
    });
  };

  const disposeActiveWebgl = () => {
    const active = activeWebgl;
    if (!active) {
      return;
    }
    activeWebgl = null;
    disposeRendererResources(active);
    telemetry.increment("rendererSwapCount");
    emitStateChange();
  };

  const disposeCandidate = (renderer: ActiveWebglRenderer) => {
    disposeRendererResources(renderer);
  };

  const transitionToCpuReady = (
    reason: "mode-cpu" | "operation-cancelled" | "hidden-reaped",
  ) => {
    const snapshot = lifecycle.getSnapshot();
    if (
      snapshot.state === "cpu-ready" ||
      snapshot.state === "disposing" ||
      snapshot.state === "disposed"
    ) {
      return;
    }
    lifecycle.transition({ reason, to: "cpu-ready" });
  };

  const finishFailedOperation = (
    operation: GpuOperation,
    reason: TerminalRendererFallbackReason,
    error: unknown,
  ) => {
    clearAttachTimeout();
    if (!canCommit(operation.token)) {
      return;
    }
    lifecycle.transition({
      attempt: operation.attempt,
      durationMs: Math.max(0, now() - operation.startedAt),
      fallbackReason: reason,
      reason:
        operation.kind === "recovery" ? "recovery-failed" : "gpu-attach-failed",
      to: "cpu-cooldown",
      token: operation.token,
    });
    setFallbackReason(reason);
    const message =
      reason === "import-failed"
        ? `[kerminal-terminal-renderer] WebGL renderer chunk failed in pane ${paneId}; using CPU renderer.`
        : operation.kind === "recovery"
          ? `[kerminal-terminal-renderer] WebGL recovery failed in pane ${paneId}; using CPU renderer.`
          : `[kerminal-terminal-renderer] WebGL renderer unavailable in pane ${paneId}; using CPU renderer.`;
    logger.warn(message, error);
  };

  const recoveryElapsed = () =>
    recoveryStartedAt === undefined
      ? 0
      : Math.max(0, now() - recoveryStartedAt);

  const canRetryRecovery = (nextAttempt: number) =>
    !disposed &&
    !circuitOpen &&
    shouldAttemptGpuRenderer(mode) &&
    nextAttempt <= maxRecoveryAttempts &&
    recoveryElapsed() <= maxRecoveryElapsedMs;

  const openCircuit = (
    operation: GpuOperation | undefined,
    reason: TerminalRendererFallbackReason,
  ) => {
    circuitOpen = true;
    clearTimers();
    if (operation && lifecycle.canCommitGeneration(operation.token)) {
      lifecycle.transition({
        attempt: operation.attempt,
        durationMs: Math.max(0, now() - operation.startedAt),
        fallbackReason: reason,
        reason:
          operation.kind === "recovery"
            ? "recovery-failed"
            : "gpu-attach-failed",
        to: "cpu-cooldown",
        token: operation.token,
      });
    } else {
      transitionToCpuReady("operation-cancelled");
    }
    setFallbackReason(reason);
  };

  const scheduleRecoveryAttempt = (
    operation: GpuOperation | undefined,
    attempt: number,
  ) => {
    if (!canRetryRecovery(attempt)) {
      openCircuit(operation, "retry-exhausted");
      return;
    }
    clearRetry();
    retryCount = attempt;
    const baseDelay =
      resolvedRetryDelays[
        Math.min(attempt - 1, resolvedRetryDelays.length - 1)
      ] ?? 0;
    const delayMs = jitterDelay(baseDelay, recoveryJitterRatio, random);
    retryHandle = scheduleRetry(() => {
      retryHandle = null;
      if (
        disposed ||
        circuitOpen ||
        !shouldAttemptGpuRenderer(mode) ||
        lifecycle.getSnapshot().state === "suspended"
      ) {
        return;
      }

      if (operation && lifecycle.canCommitGeneration(operation.token)) {
        runGpuOperation(operation);
        return;
      }

      const result = lifecycle.transition({
        attempt,
        reason: "request-gpu",
        to: "gpu-attaching",
      });
      if (!result.accepted || !result.generationToken) {
        return;
      }
      runGpuOperation({
        attempt,
        kind: "recovery",
        startedAt: now(),
        token: result.generationToken,
      });
    }, delayMs);
    emitStateChange();
  };

  const handleOperationFailure = (
    operation: GpuOperation,
    reason: TerminalRendererFallbackReason,
    error: unknown,
  ) => {
    finishFailedOperation(operation, reason, error);
    if (
      operation.kind !== "recovery" ||
      disposed ||
      !shouldAttemptGpuRenderer(mode)
    ) {
      return;
    }
    const nextAttempt = operation.attempt + 1;
    if (!canRetryRecovery(nextAttempt)) {
      openCircuit(undefined, "retry-exhausted");
      return;
    }
    scheduleRecoveryAttempt(undefined, nextAttempt);
  };

  const handleContextLoss = (addon: WebglAddonLike) => {
    if (!activeWebgl || activeWebgl.addon !== addon || disposed) {
      return;
    }
    const timestamp = now();
    if (
      contextLossWindowStartedAt === undefined ||
      timestamp - contextLossWindowStartedAt > contextLossWindowMs
    ) {
      contextLossWindowStartedAt = timestamp;
      contextLossCount = 0;
    }
    contextLossCount += 1;
    fallbackReason = "context-lost";
    logger.warn(
      `[kerminal-terminal-renderer] WebGL context lost in pane ${paneId}; falling back to CPU renderer.`,
    );

    const lifecycleState = lifecycle.getSnapshot().state;
    if (lifecycleState === "suspended") {
      transitionToCpuReady("hidden-reaped");
      disposeActiveWebgl();
      refreshTerminal(terminal, telemetry);
      return;
    }

    const transition = lifecycle.transition({
      attempt: 1,
      fallbackReason: "context-lost",
      reason: "gpu-fault",
      to: "recovering",
    });
    disposeActiveWebgl();
    refreshTerminal(terminal, telemetry);

    if (!transition.accepted || !transition.generationToken) {
      return;
    }
    const operation: GpuOperation = {
      attempt: 1,
      kind: "recovery",
      startedAt: timestamp,
      token: transition.generationToken,
    };
    recoveryStartedAt = timestamp;
    if (
      contextLossCount >= contextLossCircuitThreshold ||
      !shouldAttemptGpuRenderer(mode)
    ) {
      openCircuit(operation, "recovery-storm");
      return;
    }
    scheduleRecoveryAttempt(operation, 1);
  };

  const beginControlledRecovery = (
    fallback: TerminalRendererFallbackReason,
    openHealthCircuit: boolean,
  ) => {
    if (!activeWebgl || lifecycle.getSnapshot().state !== "gpu-ready") {
      return;
    }
    const timestamp = now();
    const transition = lifecycle.transition({
      attempt: 1,
      fallbackReason: fallback,
      reason: "gpu-fault",
      to: "recovering",
    });
    if (!transition.accepted || !transition.generationToken) {
      return;
    }
    const operation: GpuOperation = {
      attempt: 1,
      kind: "recovery",
      startedAt: timestamp,
      token: transition.generationToken,
    };
    fallbackReason = fallback;
    recoveryStartedAt = timestamp;
    disposeActiveWebgl();
    refreshTerminal(terminal, telemetry);
    if (openHealthCircuit) {
      openCircuit(operation, "recovery-storm");
      return;
    }
    scheduleRecoveryAttempt(operation, 1);
  };

  function runGpuOperation(operation: GpuOperation) {
    if (!canCommit(operation.token) || disposed) {
      return;
    }
    const element = terminal.element;
    if (!element || !shouldAttemptGpuRenderer(mode)) {
      transitionToCpuReady("operation-cancelled");
      return;
    }

    clearAttachTimeout();
    attachTimeoutHandle = scheduleRetry(() => {
      attachTimeoutHandle = null;
      if (!canCommit(operation.token)) {
        return;
      }
      handleOperationFailure(
        operation,
        "retry-exhausted",
        new Error(`WebGL attach timed out after ${attachTimeoutMs}ms`),
      );
    }, attachTimeoutMs);

    void loadWebglAddon()
      .then(({ WebglAddon }) => {
        if (!canCommit(operation.token) || disposed) {
          clearAttachTimeout();
          return;
        }

        let addon: WebglAddonLike;
        try {
          addon = new WebglAddon();
        } catch (error) {
          handleOperationFailure(operation, "load-failed", error);
          return;
        }

        const candidate = createWebglRendererCandidate(addon);
        try {
          loadWebglRendererCandidate({
            element,
            onContextLoss: () => handleContextLoss(addon),
            onResourcesChanged: emitStateChange,
            renderer: candidate,
            terminal,
          });
        } catch (error) {
          disposeCandidate(candidate);
          handleOperationFailure(operation, "load-failed", error);
          return;
        }

        clearAttachTimeout();
        if (!canCommit(operation.token) || disposed) {
          disposeCandidate(candidate);
          return;
        }

        const transition = lifecycle.transition({
          attempt: operation.attempt,
          durationMs: Math.max(0, now() - operation.startedAt),
          reason:
            operation.kind === "recovery"
              ? "recovery-succeeded"
              : "gpu-attached",
          to: "gpu-ready",
          token: operation.token,
        });
        if (!transition.accepted) {
          recordStaleCommit();
          disposeCandidate(candidate);
          return;
        }

        activeWebgl = candidate;
        fallbackReason = undefined;
        recoveryStartedAt = undefined;
        retryCount = 0;
        telemetry.increment("rendererRebuildCount");
        emitStateChange();
      })
      .catch((error: unknown) => {
        if (!canCommit(operation.token) || disposed) {
          clearAttachTimeout();
          return;
        }
        handleOperationFailure(operation, "import-failed", error);
      });
  }

  const beginAttach = (
    reason: "manual-retry" | "request-gpu",
    kind: GpuOperationKind,
    attempt: number,
  ) => {
    if (
      disposed ||
      activeWebgl ||
      !lifecycleV2Enabled ||
      !shouldAttemptGpuRenderer(mode) ||
      lifecycle.getSnapshot().state === "suspended"
    ) {
      return;
    }
    if (circuitOpen && reason !== "manual-retry") {
      return;
    }
    const element = terminal.element;
    if (!element) {
      return;
    }
    clearRetry();
    const result = lifecycle.transition({
      attempt,
      reason,
      to: "gpu-attaching",
    });
    if (!result.accepted || !result.generationToken) {
      return;
    }
    runGpuOperation({
      attempt,
      kind,
      startedAt: now(),
      token: result.generationToken,
    });
  };

  const attach = () => {
    if (mode === "auto" && !autoGpuAllowed) {
      return;
    }
    beginAttach("request-gpu", "attach", 1);
  };

  const updateMode = (nextMode: TerminalRendererType) => {
    if (mode === nextMode) {
      return;
    }
    mode = nextMode;
    clearTimers();
    if (mode === "auto" && !autoGpuAllowed) {
      fallbackReason = "software-gpu";
      circuitOpen = false;
      recoveryStartedAt = undefined;
      retryCount = 0;
      transitionToCpuReady("operation-cancelled");
      disposeActiveWebgl();
      refreshTerminal(terminal, telemetry);
      emitStateChange();
      return;
    }
    if (!shouldAttemptGpuRenderer(mode)) {
      fallbackReason = undefined;
      circuitOpen = false;
      recoveryStartedAt = undefined;
      retryCount = 0;
      transitionToCpuReady("mode-cpu");
      disposeActiveWebgl();
      refreshTerminal(terminal, telemetry);
      emitStateChange();
      return;
    }
    fallbackReason = undefined;
    emitStateChange();
    attach();
  };

  const clearTextureAtlas = () => {
    const active = activeWebgl;
    if (!active) {
      return;
    }
    try {
      active.addon.clearTextureAtlas?.();
      telemetry.increment("atlasClearCount");
      refreshTerminal(terminal, telemetry);
    } catch (error) {
      logger.warn(
        "[kerminal-terminal-renderer] WebGL texture atlas clear failed",
        error,
      );
      emitStateChange();
      throw error;
    }
    emitStateChange();
  };

  const reportHealth = (
    observation: Omit<TerminalRendererHealthObservation, "backend">,
  ) => {
    const healthDecision = health.observe({
      ...observation,
      backend:
        healthWatchdogEnabled && lifecycleV2Enabled && activeWebgl
          ? "gpu"
          : "cpu",
    });
    switch (healthDecision.action) {
      case "refresh":
        refreshTerminal(terminal, telemetry);
        break;
      case "clear-atlas-and-refresh":
        try {
          clearTextureAtlas();
        } catch {
          beginControlledRecovery("atlas-clear-failed", false);
        }
        break;
      case "rebuild-renderer":
        beginControlledRecovery(
          healthDecision.reason === "context-lost"
            ? "context-lost"
            : healthDecision.reason === "atlas-operation-failed"
              ? "atlas-clear-failed"
              : "retry-exhausted",
          false,
        );
        break;
      case "fallback-cpu":
        beginControlledRecovery("recovery-storm", true);
        break;
      case "none":
      case "wait-for-stable-surface":
        break;
    }
    return healthDecision;
  };

  const suspend = () => {
    if (disposed || lifecycle.getSnapshot().state !== "gpu-ready") {
      return;
    }
    lifecycle.transition({ reason: "suspend", to: "suspended" });
    clearTimers();
    emitStateChange();
  };

  const resume = () => {
    if (disposed || lifecycle.getSnapshot().state !== "suspended") {
      return;
    }
    lifecycle.transition({ reason: "resume", to: "gpu-ready" });
    emitStateChange();
  };

  const retryGpu = () => {
    if (
      disposed ||
      activeWebgl ||
      !shouldAttemptGpuRenderer(mode) ||
      (mode === "auto" && !autoGpuAllowed)
    ) {
      return;
    }
    clearTimers();
    circuitOpen = false;
    contextLossCount = 0;
    contextLossWindowStartedAt = undefined;
    health.resetCircuit();
    recoveryStartedAt = now();
    retryCount = 0;
    transitionToCpuReady("operation-cancelled");
    beginAttach("manual-retry", "recovery", 1);
  };

  const dispose = () => {
    if (disposed) {
      return;
    }
    disposed = true;
    clearTimers();
    lifecycle.dispose();
    disposeActiveWebgl();
    emitStateChange();
  };

  const getDiagnostics = (): TerminalRendererDiagnostics => ({
    activeTimerCount:
      Number(attachTimeoutHandle !== null) + Number(retryHandle !== null),
    circuitOpen,
    contextLossCount,
    gpuPlatformClass: resolvedGpuPlatformClass,
    health: health.getSnapshot(),
    lifecycle: lifecycle.getSnapshot(),
    retryCount,
    telemetry: telemetry.snapshot(),
    transitions: lifecycle.getLedger(),
  });

  return {
    attach,
    canAttemptGpu: () =>
      lifecycleV2Enabled && (mode !== "auto" || autoGpuAllowed),
    clearTextureAtlas,
    dispose,
    getDiagnostics,
    getTrackedRendererCanvases: () =>
      activeWebgl ? [...activeWebgl.rendererCanvases] : [],
    getState: state,
    reportHealth,
    resume,
    retryGpu,
    suspend,
    updateMode,
  };
}

async function defaultLoadWebglAddon() {
  return import("@xterm/addon-webgl");
}

function refreshTerminal(
  terminal: TerminalRendererTerminal,
  telemetry: TerminalRendererPerformanceTelemetry,
) {
  if (terminal.rows <= 0) {
    return;
  }
  try {
    terminal.refresh?.(0, terminal.rows - 1);
    telemetry.increment("fullRefreshCount");
  } catch {
    // CPU fallback 必须继续完成，refresh 失败不能破坏 renderer 状态。
  }
}
