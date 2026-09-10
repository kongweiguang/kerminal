// @author kongweiguang

import { invoke, isTauri } from "@tauri-apps/api/core";

type SshHostKeyStatus = "known" | "unknown" | "changed";

export interface SshHostKeyInspectRequest {
  hostId: string;
}

export interface SshHostKeyTrustRequest {
  expectedFingerprint: string;
  hostId: string;
}

export interface SshHostKeyInspection {
  algorithm: string;
  fingerprint: string;
  host: string;
  hostId: string;
  port: number;
  status: SshHostKeyStatus;
}

/**
 * 查询 SSH 主机当前服务端 key 与 known_hosts 的关系；探测只读且不承担信任副作用。
 * 预览模式返回稳定的已知占位结果，使浏览器预览不会伪造真实 SSH 探测。
 */
export async function inspectSshHostKey(
  request: SshHostKeyInspectRequest,
): Promise<SshHostKeyInspection> {
  if (isTauri()) {
    return invoke<SshHostKeyInspection>("ssh_host_key_inspect", {
      hostId: request.hostId,
    });
  }
  return browserPreviewInspection(request.hostId);
}

/**
 * 按用户确认的 fingerprint 请求后端二次核验并写入 known_hosts；前端仍需校验返回身份，
 * 因为确认等待期间服务端 key 可能发生变化，不能把一次 invoke 成功当作信任完成。
 */
export async function trustSshHostKey(
  request: SshHostKeyTrustRequest,
): Promise<SshHostKeyInspection> {
  if (isTauri()) {
    return invoke<SshHostKeyInspection>("ssh_host_key_trust", {
      expectedFingerprint: request.expectedFingerprint,
      hostId: request.hostId,
    });
  }
  return {
    ...browserPreviewInspection(request.hostId),
    fingerprint: request.expectedFingerprint,
  };
}

/** 浏览器预览固定返回已知占位身份，保持 DTO 形状但不模拟网络探测或 known_hosts 写入。 */
function browserPreviewInspection(hostId: string): SshHostKeyInspection {
  return {
    algorithm: "ssh-ed25519",
    fingerprint: "SHA256:browser-preview",
    host: "preview.invalid",
    hostId,
    port: 22,
    status: "known",
  };
}
