/**
 * @author kongweiguang
 */

import type {
  TerminalAgentSignal,
  TerminalOutputEvent,
} from "../../lib/terminalApi";
import {
  runTerminalOutputInstrumentationStep,
  type TerminalOutputInstrumentation,
} from "./terminalOutputInstrumentation";
import type { TerminalOutputHistoryBuffer } from "./terminalOutputHistoryBuffer";
import type { TerminalOutputWriter } from "./terminalOutputWriter";
import type { InitialRemoteOutputGate } from "./terminalInitialRemoteOutputGate";
import { collectCurrentDirObservations } from "./XtermPane.helpers";

interface RefBox<T> {
  current: T;
}

interface CreateTerminalSessionOutputControllerOptions {
  activityRuntime: { markOutput(): void };
  artifactRuntime: { queueOutput(data: string): void };
  assistEnabled: boolean;
  commandBlockRuntime: {
    appendShellIntegrationCommandOutput(data: string): void;
  };
  cwdTrackingBufferRef: RefBox<string>;
  focusedRef: RefBox<boolean>;
  hasRemoteTerminalTarget: boolean;
  initialRemoteOutputGate: InitialRemoteOutputGate;
  instrumentation: TerminalOutputInstrumentation | null;
  isCurrent(): boolean;
  isSshTerminalTarget: boolean;
  onAgentSignal(signal: TerminalAgentSignal): void;
  onCurrentCwd(cwd: string): void;
  onReadError(event: TerminalOutputEvent): void;
  onSessionClosed(sessionId: string): void;
  outputHistoryBuffer: TerminalOutputHistoryBuffer;
  outputWriter: TerminalOutputWriter;
  remoteCwdTracking: boolean;
  sshFailureTracker: { append(data: string): void };
  transientStartupNoticeVisible: boolean;
  visibleRef: RefBox<boolean>;
}

/**
 * 固化单次会话的输出处理顺序。
 *
 * generation 的事实源仍由调用方持有；旧会话事件在进入任何写入副作用前被拒绝。
 */
export function createTerminalSessionOutputController({
  activityRuntime,
  artifactRuntime,
  assistEnabled,
  commandBlockRuntime,
  cwdTrackingBufferRef,
  focusedRef,
  hasRemoteTerminalTarget,
  initialRemoteOutputGate,
  instrumentation,
  isCurrent,
  isSshTerminalTarget,
  onAgentSignal,
  onCurrentCwd,
  onReadError,
  onSessionClosed,
  outputHistoryBuffer,
  outputWriter,
  remoteCwdTracking,
  sshFailureTracker,
  transientStartupNoticeVisible: initialStartupNoticeVisible,
  visibleRef,
}: CreateTerminalSessionOutputControllerOptions) {
  let transientStartupNoticeVisible = initialStartupNoticeVisible;
  let remoteCwdProtocolEstablished = false;
  let terminalControlSequenceTail = "";

  return (event: TerminalOutputEvent) => {
    if (!isCurrent()) {
      return;
    }
    if (event.kind === "agentSignal") {
      if (event.agentSignal) {
        outputWriter.setTuiCursorProtection?.(
          event.agentSignal.status !== "exited",
        );
        onAgentSignal(event.agentSignal);
      }
      return;
    }
    if (event.kind === "data") {
      artifactRuntime.queueOutput(event.data);
      activityRuntime.markOutput();
      if (isSshTerminalTarget) {
        sshFailureTracker.append(event.data);
      }
      if (transientStartupNoticeVisible) {
        outputWriter.writeNow("\x1b[1A\x1b[2K\r");
        transientStartupNoticeVisible = false;
      }
      if (remoteCwdTracking) {
        const tracked = runTerminalOutputInstrumentationStep(
          instrumentation,
          "cwdOsc",
          event.data.length,
          () =>
            collectCurrentDirObservations(
              cwdTrackingBufferRef.current,
              event.data,
            ),
        );
        cwdTrackingBufferRef.current = tracked.buffer;
        for (const observation of tracked.observations) {
          if (observation.source === "prompt" && remoteCwdProtocolEstablished) {
            continue;
          }
          if (observation.source !== "prompt") {
            remoteCwdProtocolEstablished = true;
          }
          onCurrentCwd(observation.path);
        }
      }
      if (assistEnabled) {
        runTerminalOutputInstrumentationStep(
          instrumentation,
          "commandBlock",
          event.data.length,
          () =>
            commandBlockRuntime.appendShellIntegrationCommandOutput(event.data),
        );
      }
      runTerminalOutputInstrumentationStep(
        instrumentation,
        "writer",
        event.data.length,
        () => {
          const terminalControlSequenceWindow =
            terminalControlSequenceTail + event.data;
          terminalControlSequenceTail = terminalControlSequenceWindow.slice(-16);
          if (
            terminalControlSequenceRequiresImmediateResponse(
              terminalControlSequenceWindow,
            )
          ) {
            terminalControlSequenceTail = "";
            outputWriter.writeNow(event.data);
            return;
          }
          if (
            hasRemoteTerminalTarget &&
            initialRemoteOutputGate.shouldWriteNow(event.data)
          ) {
            outputWriter.writeNow(event.data);
            return;
          }
          outputWriter.setCadence(
            visibleRef.current === false
              ? "hidden"
              : focusedRef.current
                ? "focused"
                : "visible",
          );
          outputWriter.write(event.data);
        },
      );
      runTerminalOutputInstrumentationStep(
        instrumentation,
        "history",
        event.data.length,
        () => outputHistoryBuffer.append(event.data),
      );
      return;
    }
    if (event.kind === "closed") {
      onSessionClosed(event.sessionId);
      return;
    }
    onReadError(event);
  };
}

/**
 * 终端能力探测有严格超时，必须立即交给 xterm 解析并回写 PTY。
 * DSR 查询用于取得 inline viewport 起始光标，OSC 10/11 查询用于生成与主题一致的
 * Codex 输入区背景；普通 Agent TUI 数据由 writer 合并同步帧并保护 cursor 状态。
 */
export function terminalControlSequenceRequiresImmediateResponse(data: string) {
  return (
    data.includes("\x1b[6n") ||
    data.includes("\x1b]10;?") ||
    data.includes("\x1b]11;?")
  );
}
