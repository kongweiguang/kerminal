// @author kongweiguang

import { useCallback, useEffect, useRef, useState } from "react";
import {
  normalizeAgentLauncherSettings,
  type AgentLauncherSettings,
  type AppSettings,
} from "../../settings/contracts/index";
import { buildUserFacingError } from "../../../lib/userFacingMessage";
import {
  AgentLauncherSettingsValidationError,
  deleteCustomAgentDefinition,
  saveCustomAgentDefinition,
  selectAgentLauncher,
  type CustomAgentMutationInput,
} from "./agentLauncherSettingsModel";

interface UseConfirmedAgentLauncherSettingsOptions {
  onConfirmedSettingsChange?: (
    nextSettings: AppSettings,
  ) => Promise<AppSettings>;
  settings: AppSettings;
}

/**
 * Agent 下拉框保留一份局部确认状态：操作时先给出即时反馈，只有 settings_update
 * 成功才提交；失败则回滚到同一请求前快照，避免列表和磁盘状态分叉。
 */
export function useConfirmedAgentLauncherSettings({
  onConfirmedSettingsChange,
  settings,
}: UseConfirmedAgentLauncherSettingsOptions) {
  const [launcherSettings, setLauncherSettings] = useState(() =>
    normalizeAgentLauncherSettings(settings.agentLauncher),
  );
  const [mutationPending, setMutationPending] = useState(false);
  const [mutationError, setMutationError] = useState<ReturnType<
    typeof buildUserFacingError
  > | null>(null);
  const launcherSettingsRef = useRef(launcherSettings);
  const settingsRef = useRef(settings);
  const mutationPendingRef = useRef(false);
  settingsRef.current = settings;

  useEffect(() => {
    if (mutationPendingRef.current) {
      return;
    }
    const next = normalizeAgentLauncherSettings(settings.agentLauncher);
    launcherSettingsRef.current = next;
    setLauncherSettings(next);
  }, [settings.agentLauncher]);

  /** 单飞执行确认式保存；UI pending 期间的重复操作直接忽略，避免旧失败覆盖新成功。 */
  const persistMutation = useCallback(
    async (
      mutate: (current: AgentLauncherSettings) => AgentLauncherSettings,
    ): Promise<boolean> => {
      if (mutationPendingRef.current) {
        return false;
      }
      const previous = launcherSettingsRef.current;
      if (!onConfirmedSettingsChange) {
        setMutationError(
          settingsMutationError(
            new AgentLauncherSettingsValidationError(
              "当前入口无法保存 Agent 设置，请在完整 Kerminal 窗口中重试。",
            ),
          ),
        );
        return false;
      }
      let next: AgentLauncherSettings;
      try {
        next = mutate(previous);
      } catch (error) {
        setMutationError(settingsMutationError(error));
        return false;
      }

      mutationPendingRef.current = true;
      launcherSettingsRef.current = next;
      setLauncherSettings(next);
      setMutationPending(true);
      setMutationError(null);
      try {
        const nextSettings = {
          ...settingsRef.current,
          agentLauncher: next,
        };
        const storedSettings = await onConfirmedSettingsChange(nextSettings);
        const storedLauncherSettings = normalizeAgentLauncherSettings(
          storedSettings.agentLauncher,
        );
        launcherSettingsRef.current = storedLauncherSettings;
        setLauncherSettings(storedLauncherSettings);
        return true;
      } catch (error) {
        launcherSettingsRef.current = previous;
        setLauncherSettings(previous);
        setMutationError(settingsMutationError(error));
        return false;
      } finally {
        mutationPendingRef.current = false;
        setMutationPending(false);
      }
    },
    [onConfirmedSettingsChange],
  );

  /** 选择变化与定义编辑共用确认式保存，确保“最后选择”真实落盘。 */
  const selectAgent = useCallback(
    (launcherKey: string) =>
      persistMutation((current) => selectAgentLauncher(current, launcherKey)),
    [persistMutation],
  );
  /** 保存成功后 model 同步选中新条目；失败由 mutation 层回滚列表。 */
  const saveCustomAgent = useCallback(
    (input: CustomAgentMutationInput) =>
      persistMutation((current) => saveCustomAgentDefinition(current, input)),
    [persistMutation],
  );
  /** 删除选中定义时 model 在同一 settings 快照内回退 Codex。 */
  const deleteCustomAgent = useCallback(
    (id: string) =>
      persistMutation((current) => deleteCustomAgentDefinition(current, id)),
    [persistMutation],
  );

  return {
    deleteCustomAgent,
    launcherSettings,
    mutationError,
    mutationPending,
    saveCustomAgent,
    selectAgent,
  };
}

/** 校验错误可直接展示，IPC/IO 错误只显示稳定摘要并保留脱敏技术详情。 */
function settingsMutationError(error: unknown) {
  const validationError = error instanceof AgentLauncherSettingsValidationError;
  return buildUserFacingError(error, {
    detail: validationError
      ? undefined
      : "本次修改未写入 settings.toml，已恢复原来的 Agent 列表。",
    recoveryAction: validationError
      ? "请修正后重试。"
      : "请检查文件权限或稍后重试。",
    title: validationError ? error.message : "Agent 设置保存失败",
  });
}
