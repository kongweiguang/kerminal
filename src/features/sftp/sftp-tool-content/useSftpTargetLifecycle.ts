/**
 * SFTP 目标生命周期与异步回写门禁。
 *
 * @author kongweiguang
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Machine } from "../../workspace/contracts/index";
import type { SftpBrowserMode } from "./sftpBrowserModeModel";
import { resolveFileTarget } from "./sftpFileTargetModel";
import type { SftpClipboard, SftpFileTarget } from "./types";

/** 远端动作发起时冻结的目标快照。 */
export interface SftpTargetBindingToken {
  readonly bindingKey: string;
  readonly generation: number;
  readonly target: SftpFileTarget;
}

/**
 * 目录加载器可携带动作发起时的目标令牌，避免旧动作完成后改为刷新新目标。
 */
export interface SftpTargetBoundDirectoryLoader {
  (path: string, binding?: SftpTargetBindingToken | null): Promise<void>;
  readonly captureTarget?: (
    expectedTarget?: SftpFileTarget | null,
  ) => SftpTargetBindingToken | null;
  readonly isTargetBindingCurrent?: (
    binding: SftpTargetBindingToken | null,
  ) => boolean;
}

interface SftpTargetLifecycleState {
  active: boolean;
  bindingKey: string;
  generation: number;
  target: SftpFileTarget | null;
}

/** 生成只包含资源身份的稳定 key，不把展示文案和初始目录混入目标身份。 */
export function sftpFileTargetBindingKey(target: SftpFileTarget | null) {
  if (!target) {
    return "none";
  }
  if (target.kind === "ssh") {
    return `ssh:${target.hostId}`;
  }
  return `container:${target.hostId}:${target.runtime}:${target.containerId}`;
}

/** 为独立 hook 调用创建立即有效的目标快照；生产组件优先使用 lifecycle capture。 */
export function createSftpTargetBindingSnapshot(
  target: SftpFileTarget,
): SftpTargetBindingToken {
  return {
    bindingKey: `active:${sftpFileTargetBindingKey(target)}`,
    generation: 0,
    target,
  };
}

/** 仅在目标变化时更换会话实例；右栏暂时隐藏时保留当前目录。 */
function sftpTargetSessionKey({
  fallbackTargetKey,
  target,
}: {
  fallbackTargetKey?: string;
  target: SftpFileTarget | null;
}) {
  return target
    ? sftpFileTargetBindingKey(target)
    : (fallbackTargetKey ?? "none");
}

/**
 * 把跨目标应保留的显示偏好和剪贴板放在会话外层，目标相关状态则交给 keyed 子树。
 */
export function useSftpTargetSessionBoundary({
  controlledClipboard,
  onClipboardChange,
  selectedMachine,
}: {
  controlledClipboard?: SftpClipboard | null;
  onClipboardChange?: (clipboard: SftpClipboard | null) => void;
  selectedMachine?: Machine;
}) {
  const [showHiddenFiles, setShowHiddenFiles] = useState(true);
  const [browserMode, setBrowserMode] = useState<SftpBrowserMode>("list");
  const [followTerminalDirectory, setFollowTerminalDirectory] = useState(false);
  const [uncontrolledClipboard, setUncontrolledClipboard] =
    useState<SftpClipboard | null>(null);
  const fileTarget = useMemo(
    () => resolveFileTarget(selectedMachine),
    [selectedMachine],
  );
  const setSftpClipboard = useCallback(
    (clipboard: SftpClipboard | null) => {
      if (onClipboardChange) {
        onClipboardChange(clipboard);
        return;
      }
      setUncontrolledClipboard(clipboard);
    },
    [onClipboardChange],
  );
  const fallbackTargetKey = selectedMachine
    ? `machine:${selectedMachine.kind}:${selectedMachine.id}`
    : undefined;

  return {
    browserMode,
    fileTarget,
    followTerminalDirectory,
    sessionKey: sftpTargetSessionKey({
      fallbackTargetKey,
      target: fileTarget,
    }),
    setBrowserMode,
    setFollowTerminalDirectory,
    setShowHiddenFiles,
    setSftpClipboard,
    showHiddenFiles,
    sftpClipboard:
      controlledClipboard !== undefined
        ? controlledClipboard
        : uncontrolledClipboard,
  };
}

/** 给跨层传递的目录加载器附加同一套目标门禁，避免中间 hook 重复透传参数。 */
export function bindSftpTargetDirectoryLoader(
  loader: SftpTargetBoundDirectoryLoader,
  captureTarget: NonNullable<SftpTargetBoundDirectoryLoader["captureTarget"]>,
  isTargetBindingCurrent: NonNullable<
    SftpTargetBoundDirectoryLoader["isTargetBindingCurrent"]
  >,
): SftpTargetBoundDirectoryLoader {
  return Object.assign(loader, { captureTarget, isTargetBindingCurrent });
}

/**
 * 为一次资源挂载维护单调代次。`active` 只阻止隐藏面板发起新 I/O；同目标
 * 已经在途的请求仍可提交终态，避免面板暂时收起后永久遗留 loading。
 * 目标切换或真实卸载仍会更换代次，写动作始终使用令牌中的冻结目标。
 */
export function useSftpTargetLifecycle({
  active,
  target,
}: {
  active: boolean;
  target: SftpFileTarget | null;
}) {
  const bindingKey = sftpFileTargetBindingKey(target);
  const stateRef = useRef<SftpTargetLifecycleState | null>(null);
  const activeRef = useRef(active);
  const targetRef = useRef(target);
  activeRef.current = active;
  targetRef.current = target;
  const previous = stateRef.current;
  if (!previous || previous.bindingKey !== bindingKey) {
    stateRef.current = {
      active,
      bindingKey,
      generation: (previous?.generation ?? 0) + 1,
      target,
    };
  } else {
    previous.active = active;
    previous.target = target;
  }

  useEffect(() => {
    const mounted = stateRef.current;
    if (mounted?.bindingKey === bindingKey) {
      mounted.active = activeRef.current;
      // StrictMode 会执行 cleanup/setup 重放；setup 必须恢复目标，才能再次发起首次目录读取。
      mounted.target = targetRef.current;
    }
    return () => {
      // 资源切换或卸载时同步失效在途 Promise；单纯隐藏由 render 更新 active，不更换代次。
      const current = stateRef.current;
      if (current?.bindingKey === bindingKey) {
        current.active = false;
        current.generation += 1;
        current.target = null;
      }
    };
  }, [bindingKey]);

  const captureTarget = useCallback(
    (expectedTarget?: SftpFileTarget | null): SftpTargetBindingToken | null => {
      const current = stateRef.current;
      if (!current?.active || !current.target) {
        return null;
      }
      if (
        expectedTarget &&
        sftpFileTargetBindingKey(expectedTarget) !==
          sftpFileTargetBindingKey(current.target)
      ) {
        return null;
      }
      const targetSnapshot = expectedTarget ?? current.target;
      return {
        bindingKey: current.bindingKey,
        generation: current.generation,
        target: Object.freeze({ ...targetSnapshot }) as SftpFileTarget,
      };
    },
    [],
  );

  const isCurrent = useCallback((binding: SftpTargetBindingToken | null) => {
    if (!binding) {
      return false;
    }
    const current = stateRef.current;
    return Boolean(
      current?.bindingKey === binding.bindingKey &&
      current.generation === binding.generation &&
      current.target &&
      sftpFileTargetBindingKey(current.target) ===
        sftpFileTargetBindingKey(binding.target),
    );
  }, []);

  return {
    bindingKey,
    captureTarget,
    isCurrent,
  };
}
