// @author kongweiguang

import { useCallback, useEffect, useRef } from "react";
import {
  useWorkspaceStore,
  type WorkspaceState,
} from "../features/workspace/workspaceStore";
import type {
  WorkspaceShellLayout,
  WorkspaceSessionLoadResult,
  WorkspaceSessionSnapshot,
} from "../features/workspace/workspaceSession";
import {
  loadWorkspaceSession,
  saveWorkspaceSession,
} from "../features/workspace/workspaceSessionStorage";
import { flushPendingTerminalOutputHistoryBuffers } from "../features/terminal/terminalOutputHistoryBuffer";
import type {
  MachineGroup,
  TerminalPane,
  TerminalTab,
  TerminalTabGroups,
  TerminalTabGroupPreferences,
} from "../features/workspace/types";
import {
  captureWorkspaceSession,
  workspaceSessionStableKey,
} from "../features/workspace/workspaceSessionCapture";
import { WORKSPACE_SESSION_SAVE_DELAY_MS } from "./KerminalShell.static";

interface WorkspaceSessionSnapshotInput {
  activeTabId: string;
  focusedPaneId: string;
  machineGroups: MachineGroup[];
  removedSidebarMachineIds: string[];
  selectedMachineId: string;
  shellLayout?: WorkspaceShellLayout;
  terminalPanes: TerminalPane[];
  terminalTabGroups?: TerminalTabGroups;
  terminalTabGroupPreferences: TerminalTabGroupPreferences;
  terminalTabs: TerminalTab[];
}

interface WorkspaceSessionPersistenceOptions {
  beforeRestore?: () => Promise<void> | void;
  onPersistenceBlocked?: (message: string | null) => void;
  onShellLayoutRestored?: (shellLayout: WorkspaceShellLayout) => void;
  shellLayout?: WorkspaceShellLayout;
}

export function buildWorkspaceSessionSnapshot({
  activeTabId,
  focusedPaneId,
  machineGroups,
  removedSidebarMachineIds,
  selectedMachineId,
  shellLayout,
  terminalPanes,
  terminalTabGroups,
  terminalTabGroupPreferences,
  terminalTabs,
}: WorkspaceSessionSnapshotInput): WorkspaceSessionSnapshot {
  return captureWorkspaceSession({
    activeTabId,
    focusedPaneId,
    machineGroups,
    removedSidebarMachineIds,
    selectedMachineId,
    shellLayout,
    terminalPanes,
    terminalTabGroups: terminalTabGroups ?? {},
    terminalTabGroupPreferences,
    terminalTabs,
  });
}

export function buildWorkspaceSessionStableKey({
  activeTabId,
  focusedPaneId,
  machineGroups,
  removedSidebarMachineIds,
  selectedMachineId,
  shellLayout,
  terminalPanes,
  terminalTabGroups,
  terminalTabGroupPreferences,
  terminalTabs,
}: WorkspaceSessionSnapshotInput): string {
  return workspaceSessionStableKey({
    activeTabId,
    focusedPaneId,
    machineGroups,
    removedSidebarMachineIds,
    selectedMachineId,
    shellLayout,
    terminalPanes,
    terminalTabGroups: terminalTabGroups ?? {},
    terminalTabGroupPreferences,
    terminalTabs,
  });
}

/**
 * 在恢复结果确认安全后才开启保存；任何读取或写入异常都会永久关闭本次挂载的
 * 自动写入，避免 pagehide/卸载阶段的补写把用户无法解析的 session 覆盖掉。
 */
export function useWorkspaceSessionPersistence({
  beforeRestore,
  onPersistenceBlocked,
  onShellLayoutRestored,
  shellLayout,
}: WorkspaceSessionPersistenceOptions = {}) {
  const workspaceSessionRestoredRef = useRef(false);
  const workspaceSessionSaveTimerRef = useRef<number | null>(null);
  const latestWorkspaceSessionRef = useRef<WorkspaceSessionSnapshot | null>(
    null,
  );
  const latestWorkspaceStateRef = useRef<WorkspaceState | null>(null);
  const latestWorkspaceSessionStableKeyRef = useRef<string | null>(null);
  const queuedWorkspaceSessionSaveRef =
    useRef<WorkspaceSessionSnapshot | null>(null);
  const workspaceSessionSaveInFlightRef = useRef<Promise<void> | null>(null);
  const volatileWorkspaceSessionDirtyRef = useRef(false);
  const canSaveEmptyWorkspaceSessionRef = useRef(false);
  const workspaceSessionPersistenceBlockedRef = useRef(false);
  const latestShellLayoutRef = useRef<WorkspaceShellLayout | undefined>(
    shellLayout,
  );
  const beforeRestoreRef = useRef(beforeRestore);
  const onPersistenceBlockedRef = useRef(onPersistenceBlocked);
  const onShellLayoutRestoredRef = useRef(onShellLayoutRestored);

  useEffect(() => {
    beforeRestoreRef.current = beforeRestore;
  }, [beforeRestore]);

  useEffect(() => {
    onPersistenceBlockedRef.current = onPersistenceBlocked;
  }, [onPersistenceBlocked]);

  useEffect(() => {
    onShellLayoutRestoredRef.current = onShellLayoutRestored;
  }, [onShellLayoutRestored]);

  /**
   * 持久化失败后保持 fail-closed：清掉排队快照和定时器，避免 pagehide、
   * 组件卸载或后续 store 变化再次覆盖用户原文件；只向 UI 暴露固定中文消息。
   */
  const blockWorkspaceSessionPersistence = useCallback((message: string) => {
    if (!workspaceSessionPersistenceBlockedRef.current) {
      workspaceSessionPersistenceBlockedRef.current = true;
      onPersistenceBlockedRef.current?.(message);
    }
    queuedWorkspaceSessionSaveRef.current = null;
    if (workspaceSessionSaveTimerRef.current !== null) {
      window.clearTimeout(workspaceSessionSaveTimerRef.current);
      workspaceSessionSaveTimerRef.current = null;
    }
  }, []);

  /** 读取安全或缺失快照后清除旧阻断状态，并让宿主收起告警。 */
  const allowWorkspaceSessionPersistence = useCallback(() => {
    if (!workspaceSessionPersistenceBlockedRef.current) {
      onPersistenceBlockedRef.current?.(null);
    }
  }, []);

  const enqueueWorkspaceSessionSave = useCallback(
    (session: WorkspaceSessionSnapshot) => {
      if (workspaceSessionPersistenceBlockedRef.current) {
        return;
      }
      if (hasWorkspaceSessionTerminalSurface(session)) {
        canSaveEmptyWorkspaceSessionRef.current = true;
      } else if (!canSaveEmptyWorkspaceSessionRef.current) {
        return;
      }

      queuedWorkspaceSessionSaveRef.current = session;
      if (workspaceSessionSaveInFlightRef.current) {
        return;
      }

      const saveInFlight = (async () => {
        while (queuedWorkspaceSessionSaveRef.current) {
          const nextSession = queuedWorkspaceSessionSaveRef.current;
          queuedWorkspaceSessionSaveRef.current = null;
          try {
            await saveWorkspaceSession(nextSession);
          } catch {
            blockWorkspaceSessionPersistence(
              "工作区会话保存失败，原文件未覆盖；本次运行已停止继续写入。",
            );
            break;
          }
        }
      })().finally(() => {
        if (workspaceSessionSaveInFlightRef.current === saveInFlight) {
          workspaceSessionSaveInFlightRef.current = null;
        }
        if (
          queuedWorkspaceSessionSaveRef.current &&
          !workspaceSessionPersistenceBlockedRef.current
        ) {
          enqueueWorkspaceSessionSave(queuedWorkspaceSessionSaveRef.current);
        }
      });

      workspaceSessionSaveInFlightRef.current = saveInFlight;
    },
    [blockWorkspaceSessionPersistence],
  );

  const flushWorkspaceSession = useCallback(() => {
    flushPendingTerminalOutputHistoryBuffers();
    if (workspaceSessionPersistenceBlockedRef.current) {
      return;
    }
    const latestState = useWorkspaceStore.getState();
    if (latestState) {
      latestWorkspaceSessionRef.current = buildWorkspaceSessionSnapshotFromState(
        latestState,
        latestShellLayoutRef.current,
      );
      latestWorkspaceSessionStableKeyRef.current =
        buildWorkspaceSessionStableKeyFromState(
          latestState,
          latestShellLayoutRef.current,
        );
      volatileWorkspaceSessionDirtyRef.current = false;
    }
    const session = latestWorkspaceSessionRef.current;
    if (!session) {
      return;
    }

    if (workspaceSessionSaveTimerRef.current !== null) {
      window.clearTimeout(workspaceSessionSaveTimerRef.current);
      workspaceSessionSaveTimerRef.current = null;
    }

    enqueueWorkspaceSessionSave(session);
  }, [enqueueWorkspaceSessionSave]);

  const captureWorkspaceSession = useCallback((state: WorkspaceState) => {
    if (!workspaceSessionRestoredRef.current) {
      return;
    }

    latestWorkspaceStateRef.current = state;
    const stableKey = buildWorkspaceSessionStableKeyFromState(
      state,
      latestShellLayoutRef.current,
    );
    const stableSessionChanged =
      latestWorkspaceSessionStableKeyRef.current !== stableKey;

    if (workspaceSessionSaveTimerRef.current !== null) {
      window.clearTimeout(workspaceSessionSaveTimerRef.current);
      workspaceSessionSaveTimerRef.current = null;
    }

    if (stableSessionChanged || !latestWorkspaceSessionRef.current) {
      latestWorkspaceSessionRef.current = buildWorkspaceSessionSnapshotFromState(
        state,
        latestShellLayoutRef.current,
      );
      latestWorkspaceSessionStableKeyRef.current = stableKey;
      volatileWorkspaceSessionDirtyRef.current = false;
      enqueueWorkspaceSessionSave(latestWorkspaceSessionRef.current);
      return;
    }

    volatileWorkspaceSessionDirtyRef.current = true;
    workspaceSessionSaveTimerRef.current = window.setTimeout(() => {
      workspaceSessionSaveTimerRef.current = null;
      const latestState = latestWorkspaceStateRef.current;
      if (latestState && volatileWorkspaceSessionDirtyRef.current) {
        latestWorkspaceSessionRef.current = buildWorkspaceSessionSnapshotFromState(
          latestState,
          latestShellLayoutRef.current,
        );
        latestWorkspaceSessionStableKeyRef.current =
          buildWorkspaceSessionStableKeyFromState(
            latestState,
            latestShellLayoutRef.current,
          );
        volatileWorkspaceSessionDirtyRef.current = false;
      }
      const session = latestWorkspaceSessionRef.current;
      if (session) {
        enqueueWorkspaceSessionSave(session);
      }
    }, WORKSPACE_SESSION_SAVE_DELAY_MS);
  }, [enqueueWorkspaceSessionSave]);

  useEffect(() => {
    latestShellLayoutRef.current = shellLayout;
    if (workspaceSessionRestoredRef.current) {
      captureWorkspaceSession(useWorkspaceStore.getState());
    }
  }, [captureWorkspaceSession, shellLayout]);

  useEffect(() => {
    let disposed = false;
    const unsubscribe = useWorkspaceStore.subscribe((state) => {
      captureWorkspaceSession(state);
    });

    void Promise.resolve()
      .then(() => beforeRestoreRef.current?.())
      .catch(() => undefined)
      .then(() => ({
        requestedFromStableKey: buildWorkspaceSessionStableKeyFromState(
          useWorkspaceStore.getState(),
          latestShellLayoutRef.current,
        ),
      }))
      .then(async ({ requestedFromStableKey }) => ({
        requestedFromStableKey,
        session: await loadWorkspaceSession(),
      }))
      .then(({ requestedFromStableKey, session }) => {
        if (disposed) {
          return;
        }

        const currentStableKey = buildWorkspaceSessionStableKeyFromState(
          useWorkspaceStore.getState(),
          latestShellLayoutRef.current,
        );
        const responseIsCurrent = requestedFromStableKey === currentStableKey;
        if (session.kind === "loaded" && responseIsCurrent) {
          if (!hasWorkspaceSessionTerminalSurface(session.session)) {
            canSaveEmptyWorkspaceSessionRef.current = true;
          }
          useWorkspaceStore.getState().restoreWorkspaceSession(session.session);
          if (session.session.shellLayout) {
            latestShellLayoutRef.current = session.session.shellLayout;
            onShellLayoutRestoredRef.current?.(session.session.shellLayout);
          }
        }
        if (session.kind === "loaded" || session.kind === "missing") {
          allowWorkspaceSessionPersistence();
        } else {
          blockWorkspaceSessionPersistence(workspaceSessionLoadBlockedMessage(session));
        }
        workspaceSessionRestoredRef.current = true;
        captureWorkspaceSession(useWorkspaceStore.getState());
      });

    return () => {
      disposed = true;
      unsubscribe();
      if (workspaceSessionSaveTimerRef.current !== null) {
        window.clearTimeout(workspaceSessionSaveTimerRef.current);
        workspaceSessionSaveTimerRef.current = null;
      }
    };
  }, [
    allowWorkspaceSessionPersistence,
    blockWorkspaceSessionPersistence,
    captureWorkspaceSession,
  ]);

  useEffect(() => {
    window.addEventListener("pagehide", flushWorkspaceSession);
    return () => {
      window.removeEventListener("pagehide", flushWorkspaceSession);
      flushWorkspaceSession();
    };
  }, [flushWorkspaceSession]);
}

function buildWorkspaceSessionSnapshotFromState(
  state: WorkspaceState,
  shellLayout?: WorkspaceShellLayout,
): WorkspaceSessionSnapshot {
  return buildWorkspaceSessionSnapshot({
    activeTabId: state.activeTabId,
    focusedPaneId: state.focusedPaneId,
    machineGroups: state.machineGroups,
    removedSidebarMachineIds: state.removedSidebarMachineIds,
    selectedMachineId: state.selectedMachineId,
    shellLayout,
    terminalPanes: state.terminalPanes,
    terminalTabGroups: state.terminalTabGroups,
    terminalTabGroupPreferences: state.terminalTabGroupPreferences,
    terminalTabs: state.terminalTabs,
  });
}

function buildWorkspaceSessionStableKeyFromState(
  state: WorkspaceState,
  shellLayout?: WorkspaceShellLayout,
): string {
  return buildWorkspaceSessionStableKey({
    activeTabId: state.activeTabId,
    focusedPaneId: state.focusedPaneId,
    machineGroups: state.machineGroups,
    removedSidebarMachineIds: state.removedSidebarMachineIds,
    selectedMachineId: state.selectedMachineId,
    shellLayout,
    terminalPanes: state.terminalPanes,
    terminalTabGroups: state.terminalTabGroups,
    terminalTabGroupPreferences: state.terminalTabGroupPreferences,
    terminalTabs: state.terminalTabs,
  });
}

function hasWorkspaceSessionTerminalSurface(session: WorkspaceSessionSnapshot) {
  return session.terminalTabs.length > 0 || session.terminalPanes.length > 0;
}

/** 将解码失败映射到不泄露路径、版本细节或底层错误的固定中文提示。 */
function workspaceSessionLoadBlockedMessage(
  result: Exclude<WorkspaceSessionLoadResult, { kind: "loaded" | "missing" }>,
): string {
  switch (result.kind) {
    case "unsupported":
      return "工作区会话版本较新，原文件未覆盖；本次运行不会持久化标签变化。";
    case "invalid":
      return "工作区会话内容无法验证，原文件未覆盖；本次运行不会持久化标签变化。";
    case "transport-failure":
      return "工作区会话读取失败，原文件未覆盖；本次运行不会持久化标签变化。";
  }
}
