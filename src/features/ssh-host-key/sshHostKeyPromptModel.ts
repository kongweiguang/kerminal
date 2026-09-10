// @author kongweiguang

import type { SshHostKeyInspection } from "../../lib/sshHostKeyApi";

export interface SshHostKeyPromptViewModel {
  algorithm: string;
  fingerprint: string;
  targetLabel: string;
}

/**
 * 将后端 inspection 转成弹层展示字段；目标和指纹都从同一快照派生，避免异步重渲染时交叉展示。
 */
export function createSshHostKeyPromptViewModel(
  inspection: SshHostKeyInspection,
): SshHostKeyPromptViewModel {
  return {
    algorithm: inspection.algorithm,
    fingerprint: inspection.fingerprint,
    targetLabel: formatSshHostKeyTarget(inspection.host, inspection.port),
  };
}

/** IPv6 主机必须加括号，否则 host 与 port 在确认文案中不可区分。 */
export function formatSshHostKeyTarget(host: string, port: number) {
  return host.includes(":") ? `[${host}]:${port}` : `${host}:${port}`;
}

/**
 * 校验信任命令返回的身份绑定；只有同一主机、算法和指纹仍为 known 才允许恢复流程继续。
 * changed、未知状态和任一字段不一致均失败关闭，防止确认等待期间的 key 变化被误信任。
 */
export function validateTrustedSshHostKey(
  expected: SshHostKeyInspection,
  actual: SshHostKeyInspection,
): string | null {
  if (
    actual.status !== "known" ||
    actual.hostId !== expected.hostId ||
    actual.host !== expected.host ||
    actual.port !== expected.port ||
    actual.algorithm !== expected.algorithm ||
    actual.fingerprint !== expected.fingerprint
  ) {
    if (actual.status === "changed") {
      return "SSH 主机密钥已变化，已拒绝连接。";
    }
    return "SSH 主机指纹确认结果已变化，已拒绝连接。";
  }
  return null;
}

/** 将未知后端错误安全地转换为弹层中的可见错误，不把对象序列化到 UI。 */
export function formatSshHostKeyPromptError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "SSH 主机身份确认失败。";
}
