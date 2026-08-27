// @author kongweiguang

import {
  loadWorkspaceSessionPayload,
  saveWorkspaceSessionPayload,
} from "../../lib/workspaceSessionApi.tauri";
import {
  decodeWorkspaceSessionSnapshot,
  normalizeWorkspaceSessionSnapshot,
  WORKSPACE_SESSION_VERSION,
  type WorkspaceSessionLoadResult,
  type WorkspaceSessionSnapshot,
} from "./workspaceSession";

export type { WorkspaceSessionLoadResult } from "./workspaceSession";

/**
 * 读取并解码 workspace session，保留缺失、未来版本、非法内容和 transport 失败，
 * 让上层在不确定时停止写入而不是把原文件当作空快照覆盖。
 */
export async function loadWorkspaceSessionFile(): Promise<WorkspaceSessionLoadResult> {
  try {
    const payload = await loadWorkspaceSessionPayload();
    return payload === null
      ? { kind: "missing" }
      : decodeWorkspaceSessionSnapshot(payload);
  } catch {
    return {
      kind: "transport-failure",
      message: "工作区会话读取失败，原文件未覆盖；本次运行不会持久化标签变化。",
    };
  }
}

/** 保存已归一化的 workspace session，保持既有空快照 no-op 语义。 */
export async function saveWorkspaceSessionFile(
  session: WorkspaceSessionSnapshot,
): Promise<void> {
  const normalized = normalizeWorkspaceSessionSnapshot(session);
  if (!normalized) {
    return;
  }
  await saveWorkspaceSessionPayload({
    ...normalized,
    version: WORKSPACE_SESSION_VERSION,
  });
}
