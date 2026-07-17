// @author kongweiguang
import type { TerminalRendererPerformanceTelemetry } from "./terminalRendererPerformanceTelemetry";
import {
  discardForegroundRenderSettle,
  writeForegroundTerminalChunk,
  type ForegroundTerminalOutputTarget,
} from "./terminalForegroundRenderSettle";
import {
  coalescedTuiFrameNeedsCursorRestore,
  CURSOR_SHOW,
  previewPendingData,
  removeTransientCursorShowSequences,
  scanSynchronizedOutput,
  TUI_SYNCHRONIZED_FLUSH_MAX_CHARS,
  TUI_SYNCHRONIZED_FRAME_COALESCE_MS,
  TUI_SYNCHRONIZED_FRAME_HOLD_MS,
} from "./terminalTuiCursorProtection";

type TerminalOutputSink = ForegroundTerminalOutputTarget;

export interface TerminalOutputScheduler {
  cancel(handle: number): void;
  request(callback: () => void, delayMs?: number): number;
}

type TerminalOutputCadence = "focused" | "visible" | "hidden";
type TerminalOutputCallbackMode = "auto" | "required" | "unsupported";

interface TerminalOutputWriterOptions {
  adaptive?: boolean;
  callbackMode?: TerminalOutputCallbackMode;
  cadence?: TerminalOutputCadence;
  cadenceDelaysMs?: Partial<Record<TerminalOutputCadence, number>>;
  initialCharsPerFlush?: number;
  maxCharsPerFlush?: number;
  minCharsPerFlush?: number;
  now?: () => number;
  onWriteError?: (error: unknown, data: string) => void;
  scheduler?: TerminalOutputScheduler;
  slowFlushMs?: number;
  targetWriteCallbackMs?: number;
  telemetry?: TerminalRendererPerformanceTelemetry;
}

export interface TerminalOutputWriterStats {
  adaptationDecreaseCount?: number;
  adaptationIncreaseCount?: number;
  currentCharsPerFlush?: number;
  drainCount?: number;
  inFlight?: boolean;
  flushCount: number;
  lastDrainMs?: number;
  lastFlushChars: number;
  lastFlushMs?: number;
  lastSlowFlushAt?: number;
  maxDrainMs?: number;
  maxFlushMs: number;
  pendingBytes: number;
  pendingChars: number;
  pendingChunks: number;
  pendingHighWaterChars?: number;
  slowFlushCount: number;
  splitFrameCount: number;
  targetWriteCallbackMs?: number;
  totalFlushChars: number;
  writeErrorCount: number;
  writeNowCount: number;
}

export interface TerminalOutputWriter {
  dispose(): void;
  flush(): void;
  isTuiCursorProtectionActive?(): boolean;
  pendingLength(): number;
  setCadence(cadence: TerminalOutputCadence): void;
  setTuiCursorProtection?(active: boolean): void;
  stats(): TerminalOutputWriterStats;
  write(data: string): void;
  writeNow(data: string): void;
}

const DEFAULT_MIN_CHARS_PER_FLUSH = 4 * 1024;
const DEFAULT_INITIAL_CHARS_PER_FLUSH = 16 * 1024;
const DEFAULT_MAX_CHARS_PER_FLUSH = 64 * 1024;
const DEFAULT_TARGET_WRITE_CALLBACK_MS = 6;
const DEFAULT_SLOW_FLUSH_MS = 16;
const FRAME_FALLBACK_MS = 16;
const ADAPTATION_HYSTERESIS_SAMPLES = 2;
const HIDDEN_PRESSURE_THRESHOLD_CHARS = 256 * 1024;

const DEFAULT_CADENCE_DELAYS_MS: Record<TerminalOutputCadence, number> = {
  focused: 0,
  visible: 16,
  hidden: 100,
};

/**
 * 创建 callback-aware xterm 输出调度器。
 *
 * 同一时刻最多一个 xterm.write 在途；后续批次只有在 callback 完成后才提交，
 * 从而让 renderer 恢复、主线程拥塞和高频输出之间形成自然背压。
 */
export function createTerminalOutputWriter(
  terminal: TerminalOutputSink,
  options: TerminalOutputWriterOptions = {},
): TerminalOutputWriter {
  const scheduler = options.scheduler ?? browserFrameScheduler;
  const now = options.now ?? nowMs;
  const telemetry = options.telemetry;
  const adaptive = options.adaptive ?? true;
  const callbackMode = options.callbackMode ?? "auto";
  const slowFlushMs = Math.max(0, options.slowFlushMs ?? DEFAULT_SLOW_FLUSH_MS);
  const targetWriteCallbackMs = clampFinite(
    options.targetWriteCallbackMs ?? DEFAULT_TARGET_WRITE_CALLBACK_MS,
    1,
    50,
  );
  const requestedMaxCharsPerFlush = Math.max(
    1,
    Math.floor(options.maxCharsPerFlush ?? DEFAULT_MAX_CHARS_PER_FLUSH),
  );
  const minCharsPerFlush = Math.max(
    1,
    Math.min(
      requestedMaxCharsPerFlush,
      Math.floor(
        options.minCharsPerFlush ??
          Math.min(DEFAULT_MIN_CHARS_PER_FLUSH, requestedMaxCharsPerFlush),
      ),
    ),
  );
  const maxCharsPerFlush = Math.max(
    minCharsPerFlush,
    requestedMaxCharsPerFlush,
  );
  let currentCharsPerFlush = clampFinite(
    Math.floor(options.initialCharsPerFlush ?? DEFAULT_INITIAL_CHARS_PER_FLUSH),
    minCharsPerFlush,
    maxCharsPerFlush,
  );
  const cadenceDelaysMs = {
    ...DEFAULT_CADENCE_DELAYS_MS,
    ...options.cadenceDelaysMs,
  };
  const chunks: string[] = [];
  let adaptationDirection: "increase" | "decrease" | null = null;
  let adaptationStreak = 0;
  let cadence = options.cadence ?? "focused";
  let chunkHead = 0;
  let disposed = false;
  let drainStartedAt: number | undefined;
  let inFlight = false;
  let pendingBytes = 0;
  let pendingChars = 0;
  let scheduledHandle: number | null = null;
  let synchronizedOutputActive = false;
  let synchronizedOutputScanTail = "";
  let tuiCoalescedFlushPending = false;
  let tuiPostFrameCoalesceActive = false;
  let tuiCursorProtection = false;
  const flushStats = {
    adaptationDecreaseCount: 0,
    adaptationIncreaseCount: 0,
    drainCount: 0,
    flushCount: 0,
    lastDrainMs: undefined as number | undefined,
    lastFlushChars: 0,
    lastFlushMs: undefined as number | undefined,
    lastSlowFlushAt: undefined as number | undefined,
    maxDrainMs: 0,
    maxFlushMs: 0,
    pendingHighWaterChars: 0,
    slowFlushCount: 0,
    splitFrameCount: 0,
    totalFlushChars: 0,
    writeErrorCount: 0,
    writeNowCount: 0,
  };

  const callbackSupported =
    callbackMode === "required" ||
    (callbackMode === "auto" && terminal.write.length >= 2);

  const cancelScheduledFlush = () => {
    if (scheduledHandle === null) {
      return;
    }
    scheduler.cancel(scheduledHandle);
    scheduledHandle = null;
  };

  const pendingChunkCount = () => Math.max(0, chunks.length - chunkHead);

  const syncTelemetry = () => {
    telemetry?.setResources({
      pendingBytes,
      pendingChunks: pendingChunkCount(),
    });
  };

  const scheduleFlush = (immediate = false, delayOverrideMs?: number) => {
    if (
      disposed ||
      inFlight ||
      scheduledHandle !== null ||
      pendingChars === 0
    ) {
      return;
    }
    const configuredDelay = Math.max(
      0,
      delayOverrideMs ?? cadenceDelaysMs[cadence] ?? 0,
    );
    const pressureDelay =
      cadence === "hidden" && pendingChars >= HIDDEN_PRESSURE_THRESHOLD_CHARS
        ? FRAME_FALLBACK_MS
        : configuredDelay;
    scheduledHandle = scheduler.request(
      flushFrame,
      immediate ? 0 : pressureDelay,
    );
  };

  const schedulePendingFlush = () => {
    if (tuiCursorProtection && synchronizedOutputActive) {
      scheduleFlush(false, TUI_SYNCHRONIZED_FRAME_HOLD_MS);
      return;
    }
    if (tuiCursorProtection && tuiPostFrameCoalesceActive) {
      scheduleFlush(false, TUI_SYNCHRONIZED_FRAME_COALESCE_MS);
      return;
    }
    scheduleFlush();
  };

  const compactQueue = () => {
    if (chunkHead === 0) {
      return;
    }
    if (chunkHead >= chunks.length) {
      chunks.length = 0;
      chunkHead = 0;
      return;
    }
    if (chunkHead >= 1024 && chunkHead * 2 >= chunks.length) {
      chunks.splice(0, chunkHead);
      chunkHead = 0;
    }
  };

  const takeBatch = (maxChars: number) => {
    let remaining = maxChars;
    let batch = "";

    while (chunkHead < chunks.length && remaining > 0) {
      const current = chunks[chunkHead] ?? "";
      if (current.length <= remaining) {
        batch += current;
        chunkHead += 1;
        pendingChars -= current.length;
        pendingBytes -= utf8ByteLength(current);
        remaining -= current.length;
        continue;
      }

      const splitAt = safeSplitIndex(current, remaining, batch.length === 0);
      if (splitAt <= 0) {
        break;
      }
      const consumed = current.slice(0, splitAt);
      batch += consumed;
      chunks[chunkHead] = current.slice(splitAt);
      pendingChars -= splitAt;
      pendingBytes -= utf8ByteLength(consumed);
      if (splitAt < current.length) {
        flushStats.splitFrameCount += 1;
      }
      break;
    }

    compactQueue();
    syncTelemetry();
    return batch;
  };

  const clearQueue = () => {
    chunks.length = 0;
    chunkHead = 0;
    pendingBytes = 0;
    pendingChars = 0;
    syncTelemetry();
  };

  const applyAdaptation = (durationMs: number, batchChars: number) => {
    if (!adaptive) {
      return;
    }
    let direction: "increase" | "decrease" | null = null;
    if (durationMs > targetWriteCallbackMs * 1.25) {
      direction = "decrease";
    } else if (
      durationMs < targetWriteCallbackMs * 0.65 &&
      batchChars >= currentCharsPerFlush * 0.8
    ) {
      direction = "increase";
    }

    if (!direction) {
      adaptationDirection = null;
      adaptationStreak = 0;
      return;
    }
    if (adaptationDirection === direction) {
      adaptationStreak += 1;
    } else {
      adaptationDirection = direction;
      adaptationStreak = 1;
    }
    if (adaptationStreak < ADAPTATION_HYSTERESIS_SAMPLES) {
      return;
    }

    adaptationStreak = 0;
    const next =
      direction === "increase"
        ? Math.ceil(currentCharsPerFlush * 1.25)
        : Math.floor(currentCharsPerFlush * 0.75);
    const clamped = Math.max(
      minCharsPerFlush,
      Math.min(maxCharsPerFlush, next),
    );
    if (clamped === currentCharsPerFlush) {
      return;
    }
    currentCharsPerFlush = clamped;
    if (direction === "increase") {
      flushStats.adaptationIncreaseCount += 1;
    } else {
      flushStats.adaptationDecreaseCount += 1;
    }
  };

  const finishDrainIfIdle = (completedAt: number) => {
    if (pendingChars > 0 || inFlight || drainStartedAt === undefined) {
      return;
    }
    const drainMs = Math.max(0, completedAt - drainStartedAt);
    flushStats.drainCount += 1;
    flushStats.lastDrainMs = drainMs;
    flushStats.maxDrainMs = Math.max(flushStats.maxDrainMs, drainMs);
    telemetry?.recordDuration("drainMs", drainMs);
    drainStartedAt = undefined;
  };

  const recordCompletedWrite = (
    batch: string,
    startedAt: number,
    completedAt: number,
  ) => {
    const durationMs = Math.max(0, completedAt - startedAt);
    flushStats.flushCount += 1;
    flushStats.lastFlushChars = batch.length;
    flushStats.lastFlushMs = durationMs;
    flushStats.maxFlushMs = Math.max(flushStats.maxFlushMs, durationMs);
    flushStats.totalFlushChars += batch.length;
    telemetry?.recordDuration("writeCallbackMs", durationMs);
    if (durationMs >= slowFlushMs) {
      flushStats.slowFlushCount += 1;
      flushStats.lastSlowFlushAt = completedAt;
    }
    applyAdaptation(durationMs, batch.length);
  };

  const writeBatch = (batch: string) => {
    if (!batch || disposed || inFlight) {
      return;
    }
    const protectedBatch = tuiCursorProtection
      ? removeTransientCursorShowSequences(batch)
      : batch;
    const settleForegroundRender =
      tuiCursorProtection &&
      (batch.includes("\x1b[?2026") || batch.includes(CURSOR_SHOW));
    inFlight = true;
    const startedAt = now();
    let completed = false;
    const complete = () => {
      if (completed) {
        return;
      }
      completed = true;
      const completedAt = now();
      recordCompletedWrite(protectedBatch, startedAt, completedAt);
      inFlight = false;
      finishDrainIfIdle(completedAt);
      schedulePendingFlush();
    };

    const fail = (error: unknown) => {
      if (completed) {
        return;
      }
      completed = true;
      inFlight = false;
      flushStats.writeErrorCount += 1;
      options.onWriteError?.(error, protectedBatch);
      finishDrainIfIdle(now());
      schedulePendingFlush();
    };

    try {
      if (callbackSupported && settleForegroundRender) {
        writeForegroundTerminalChunk(terminal, protectedBatch, {
          followupViewportRefresh: batch.includes(CURSOR_SHOW),
          forceViewportRefresh: true,
          onParsed: complete,
          onWriteFailure: fail,
        });
      } else if (callbackSupported) {
        terminal.write(protectedBatch, complete);
      } else {
        terminal.write(protectedBatch);
        complete();
      }
    } catch (error: unknown) {
      fail(error);
    }
  };

  function flushFrame() {
    scheduledHandle = null;
    if (disposed || inFlight) {
      return;
    }
    const batchLimit = tuiCoalescedFlushPending
      ? Math.max(
          currentCharsPerFlush,
          Math.min(pendingChars, TUI_SYNCHRONIZED_FLUSH_MAX_CHARS),
        )
      : currentCharsPerFlush;
    tuiCoalescedFlushPending = false;
    tuiPostFrameCoalesceActive = false;
    writeBatch(takeBatch(batchLimit));
  }

  const flush = () => {
    if (disposed || pendingChars === 0 || inFlight) {
      return;
    }
    cancelScheduledFlush();
    writeBatch(takeBatch(currentCharsPerFlush));
  };

  const enqueue = (data: string) => {
    if (!data) {
      return;
    }
    if (drainStartedAt === undefined) {
      drainStartedAt = now();
    }
    chunks.push(data);
    pendingBytes += utf8ByteLength(data);
    pendingChars += data.length;
    flushStats.pendingHighWaterChars = Math.max(
      flushStats.pendingHighWaterChars,
      pendingChars,
    );
    syncTelemetry();
  };

  const writeNow = (data: string) => {
    if (disposed) {
      return;
    }
    cancelScheduledFlush();
    flush();
    if (data) {
      flushStats.writeNowCount += 1;
      enqueue(data);
    }
    if (inFlight) {
      schedulePendingFlush();
    } else {
      flush();
    }
  };

  return {
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      cancelScheduledFlush();
      discardForegroundRenderSettle(terminal);
      clearQueue();
    },
    flush,
    isTuiCursorProtectionActive() {
      return tuiCursorProtection;
    },
    pendingLength() {
      return pendingChars;
    },
    setCadence(nextCadence) {
      if (cadence === nextCadence) {
        return;
      }
      cadence = nextCadence;
      if (scheduledHandle !== null) {
        cancelScheduledFlush();
        scheduleFlush();
      }
    },
    setTuiCursorProtection(active) {
      if (tuiCursorProtection === active) {
        return;
      }
      tuiCursorProtection = active;
      synchronizedOutputActive = false;
      synchronizedOutputScanTail = "";
      tuiCoalescedFlushPending = false;
      tuiPostFrameCoalesceActive = false;
      if (!active && scheduledHandle !== null && pendingChars > 0) {
        cancelScheduledFlush();
        scheduleFlush(true);
      }
    },
    stats() {
      const snapshot: TerminalOutputWriterStats = {
        adaptationDecreaseCount: flushStats.adaptationDecreaseCount,
        adaptationIncreaseCount: flushStats.adaptationIncreaseCount,
        currentCharsPerFlush,
        drainCount: flushStats.drainCount,
        flushCount: flushStats.flushCount,
        inFlight,
        lastFlushChars: flushStats.lastFlushChars,
        maxDrainMs: flushStats.maxDrainMs,
        maxFlushMs: flushStats.maxFlushMs,
        pendingBytes,
        pendingChars,
        pendingChunks: pendingChunkCount(),
        pendingHighWaterChars: flushStats.pendingHighWaterChars,
        slowFlushCount: flushStats.slowFlushCount,
        splitFrameCount: flushStats.splitFrameCount,
        targetWriteCallbackMs,
        totalFlushChars: flushStats.totalFlushChars,
        writeErrorCount: flushStats.writeErrorCount,
        writeNowCount: flushStats.writeNowCount,
      };
      if (flushStats.lastDrainMs !== undefined) {
        snapshot.lastDrainMs = flushStats.lastDrainMs;
      }
      if (flushStats.lastFlushMs !== undefined) {
        snapshot.lastFlushMs = flushStats.lastFlushMs;
      }
      if (flushStats.lastSlowFlushAt !== undefined) {
        snapshot.lastSlowFlushAt = flushStats.lastSlowFlushAt;
      }
      return snapshot;
    },
    write(data: string) {
      if (disposed || !data) {
        return;
      }
      enqueue(data);
      const transition = scanSynchronizedOutput(data, {
        active: synchronizedOutputActive,
        tail: synchronizedOutputScanTail,
      });
      synchronizedOutputActive = transition.active;
      synchronizedOutputScanTail = transition.tail;
      // 手动启动或 shell integration 信号延迟时仍要保护标准 DEC 2026 重绘。
      if (transition.started) {
        tuiCursorProtection = true;
      }
      if (tuiCursorProtection) {
        if (transition.started && synchronizedOutputActive) {
          cancelScheduledFlush();
        }
        if (synchronizedOutputActive) {
          scheduleFlush(false, TUI_SYNCHRONIZED_FRAME_HOLD_MS);
          return;
        }
        if (transition.ended) {
          cancelScheduledFlush();
          tuiCoalescedFlushPending = true;
          const pendingData = previewPendingData(
            chunks,
            chunkHead,
            TUI_SYNCHRONIZED_FLUSH_MAX_CHARS,
          );
          if (coalescedTuiFrameNeedsCursorRestore(pendingData)) {
            tuiPostFrameCoalesceActive = true;
            scheduleFlush(false, TUI_SYNCHRONIZED_FRAME_COALESCE_MS);
          } else {
            tuiPostFrameCoalesceActive = false;
            scheduleFlush(true);
          }
          return;
        }
        if (tuiPostFrameCoalesceActive) {
          const pendingData = previewPendingData(
            chunks,
            chunkHead,
            TUI_SYNCHRONIZED_FLUSH_MAX_CHARS,
          );
          if (!coalescedTuiFrameNeedsCursorRestore(pendingData)) {
            cancelScheduledFlush();
            tuiCoalescedFlushPending = true;
            tuiPostFrameCoalesceActive = false;
            scheduleFlush(true);
          }
          return;
        }
      }
      scheduleFlush();
    },
    writeNow,
  };
}

function nowMs() {
  if (
    typeof globalThis.performance !== "undefined" &&
    typeof globalThis.performance.now === "function"
  ) {
    return globalThis.performance.now();
  }
  return Date.now();
}

function safeSplitIndex(
  text: string,
  maxChars: number,
  allowPairOverflow: boolean,
) {
  const capped = Math.min(text.length, maxChars);
  if (capped <= 0) {
    return 0;
  }

  const previousCodeUnit = text.charCodeAt(capped - 1);
  const nextCodeUnit = text.charCodeAt(capped);
  const splitAfterHighSurrogate =
    previousCodeUnit >= 0xd800 && previousCodeUnit <= 0xdbff;
  const splitBeforeLowSurrogate =
    nextCodeUnit >= 0xdc00 && nextCodeUnit <= 0xdfff;
  if (
    capped === 1 &&
    capped < text.length &&
    splitAfterHighSurrogate &&
    splitBeforeLowSurrogate
  ) {
    // 已有批次应等待下一批；空批次允许多取一个 code unit，避免预算为 1 时永久停滞。
    return allowPairOverflow ? 2 : 0;
  }
  if (
    capped < text.length &&
    (splitAfterHighSurrogate || splitBeforeLowSurrogate)
  ) {
    return capped - 1;
  }
  return capped;
}

const UTF8_ENCODER = new TextEncoder();

function utf8ByteLength(value: string) {
  return UTF8_ENCODER.encode(value).byteLength;
}

function clampFinite(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}

const browserFrameScheduler: TerminalOutputScheduler = (() => {
  let nextHandle = 1;
  const active = new Map<
    number,
    { handle: number; kind: "animation-frame" | "timeout" }
  >();

  return {
    cancel(handle) {
      const scheduled = active.get(handle);
      if (!scheduled) {
        return;
      }
      active.delete(handle);
      if (scheduled.kind === "animation-frame") {
        window.cancelAnimationFrame(scheduled.handle);
      } else {
        window.clearTimeout(scheduled.handle);
      }
    },
    request(callback, delayMs = 0) {
      const publicHandle = nextHandle++;
      const run = () => {
        active.delete(publicHandle);
        callback();
      };
      if (delayMs <= 0 && canUseAnimationFrame()) {
        active.set(publicHandle, {
          handle: window.requestAnimationFrame(run),
          kind: "animation-frame",
        });
      } else {
        active.set(publicHandle, {
          handle: window.setTimeout(run, Math.max(delayMs, FRAME_FALLBACK_MS)),
          kind: "timeout",
        });
      }
      return publicHandle;
    },
  };
})();

function canUseAnimationFrame() {
  return (
    typeof window !== "undefined" &&
    typeof window.requestAnimationFrame === "function" &&
    typeof window.cancelAnimationFrame === "function"
  );
}
