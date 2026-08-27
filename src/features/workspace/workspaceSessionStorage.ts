// @author kongweiguang

import {
  decodeWorkspaceSessionSnapshot,
  normalizeWorkspaceSessionSnapshot,
  type WorkspaceSessionLoadResult,
  type WorkspaceSessionSnapshot,
} from "./workspaceSession";
import {
  loadWorkspaceSessionFile,
  saveWorkspaceSessionFile,
} from "./workspaceSessionApi";

/** 读取工作区会话并保留 missing、损坏、未来版本和 transport failure 的区别。 */
export async function loadWorkspaceSession(): Promise<WorkspaceSessionLoadResult> {
  try {
    const result: unknown = await loadWorkspaceSessionFile();
    if (result === null) {
      // 兼容旧的测试 transport；真实 API 已返回带 kind 的判别式结果。
      return { kind: "missing" };
    }
    if (isWorkspaceSessionLoadResult(result)) {
      return result;
    }
    // 旧的调用方 mock 直接返回快照时仍走同一领域解码，避免让兼容逻辑
    // 绕过未来版本和关键数组校验。
    return decodeWorkspaceSessionSnapshot(result);
  } catch {
    return {
      kind: "transport-failure",
      message: "工作区会话读取失败，原文件未覆盖；本次运行不会持久化标签变化。",
    };
  }
}

/** 保存工作区会话并向上抛出失败，让持久化 hook 能停止后续重试并提示用户。 */
export async function saveWorkspaceSession(
  session: WorkspaceSessionSnapshot,
): Promise<void> {
  const normalized = normalizeWorkspaceSessionSnapshot(session);
  if (!normalized) {
    return;
  }

  await saveWorkspaceSessionFile(normalized);
}

/** 判断 transport 返回是否已经是受信任的 load 判别式结果。 */
function isWorkspaceSessionLoadResult(
  value: unknown,
): value is WorkspaceSessionLoadResult {
  if (!isRecord(value) || typeof value.kind !== "string") {
    return false;
  }
  switch (value.kind) {
    case "missing":
      return true;
    case "loaded":
      return isRecord(value.session);
    case "unsupported":
      return typeof value.version === "number" && typeof value.message === "string";
    case "invalid":
    case "transport-failure":
      return typeof value.message === "string";
    default:
      return false;
  }
}

/** 只在兼容判别式结果前检查对象，避免对 primitive 调用属性访问。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
