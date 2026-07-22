// @author kongweiguang

import type {
  ManagedSshRuntimeSnapshot,
  ManagedSshSessionSnapshot,
} from "../../lib/diagnosticsApi";
import type { SshTerminalFailure } from "../terminal/ssh/index";
import { classifySshTerminalFailure } from "../terminal/ssh/index";
import type { Machine, TerminalPane } from "../workspace/contracts/index";

type ManagedSshToolCapability = "shell" | "sftp" | "exec" | "forward";

type ManagedSshToolAvailabilityKind =
  | "managed-reusable"
  | "terminal-connected"
  | "auth-required"
  | "host-key-required"
  | "action-required"
  | "unsupported"
  | "no-target";

export interface ManagedSshToolAvailabilityInput {
  focusedPane?: TerminalPane;
  managedSsh?: ManagedSshRuntimeSnapshot | null;
  requiredCapability?: ManagedSshToolCapability;
  selectedMachine?: Machine;
}

export interface ManagedSshToolAvailability {
  canAttemptConnection: boolean;
  canUseConnectedSession: boolean;
  detail: string;
  kind: ManagedSshToolAvailabilityKind;
  label: string;
  session?: ManagedSshSessionSnapshot;
  targetLabel?: string;
}

export function resolveManagedSshToolAvailability({
  focusedPane,
  managedSsh,
  selectedMachine,
}: ManagedSshToolAvailabilityInput): ManagedSshToolAvailability {
  if (!selectedMachine) {
    return {
      canAttemptConnection: false,
      canUseConnectedSession: false,
      detail: "没有选中的目标主机。",
      kind: "no-target",
      label: "未选择主机",
    };
  }

  if (selectedMachine.kind !== "ssh") {
    return {
      canAttemptConnection: false,
      canUseConnectedSession: false,
      detail: "当前目标不是 SSH 主机，无法使用此工具。",
      kind: "unsupported",
      label: "当前不可用",
      targetLabel: selectedMachine.name,
    };
  }

  const targetLabel = sshMachineTargetLabel(selectedMachine);
  const session = findManagedSessionForMachine(managedSsh, selectedMachine);
  const diagnosticFailure = classifyAvailabilityFailure(session?.lastError);

  if (
    diagnosticFailure &&
    isHostKeyFailureClass(diagnosticFailure.class)
  ) {
    return {
      canAttemptConnection: false,
      canUseConnectedSession: false,
      detail: availabilityFailureDetail(diagnosticFailure),
      kind: "host-key-required",
      label: "需确认主机",
      session,
      targetLabel,
    };
  }

  if (
    diagnosticFailure &&
    isCredentialFailureClass(diagnosticFailure.class)
  ) {
    return {
      canAttemptConnection: false,
      canUseConnectedSession: false,
      detail: availabilityFailureDetail(diagnosticFailure),
      kind: "auth-required",
      label: "需认证",
      session,
      targetLabel,
    };
  }

  if (
    diagnosticFailure?.class === "channelUnsupported"
  ) {
    return {
      canAttemptConnection: false,
      canUseConnectedSession: false,
      detail:
        diagnosticFailure
          ? availabilityFailureDetail(diagnosticFailure)
          : "当前主机不支持此操作，可更换主机或使用其它方式完成。",
      kind: "unsupported",
      label: "当前不可用",
      session,
      targetLabel,
    };
  }

  if (diagnosticFailure && diagnosticFailure.class !== "unknown") {
    return {
      canAttemptConnection: diagnosticFailure.retryable,
      canUseConnectedSession: false,
      detail: availabilityFailureDetail(diagnosticFailure),
      kind: "action-required",
      label: "需处理",
      session,
      targetLabel,
    };
  }

  if (session?.state === "ready") {
    return {
      canAttemptConnection: true,
      canUseConnectedSession: true,
      detail: "已连接到当前 SSH 主机，可以直接使用此工具。",
      kind: "managed-reusable",
      label: "已连接",
      session,
      targetLabel,
    };
  }

  if (focusedPaneMatchesSshMachine(focusedPane, selectedMachine)) {
    return {
      canAttemptConnection: true,
      canUseConnectedSession: false,
      detail: "当前终端已连接到该主机，使用此工具时会建立单独连接。",
      kind: "terminal-connected",
      label: "需连接",
      targetLabel,
    };
  }

  return {
    canAttemptConnection: true,
    canUseConnectedSession: false,
    detail: "使用此工具前需要连接并完成 SSH 认证。",
    kind: "auth-required",
    label: "需认证",
    session,
    targetLabel,
  };
}

function findManagedSessionForMachine(
  managedSsh: ManagedSshRuntimeSnapshot | null | undefined,
  machine: Machine,
): ManagedSshSessionSnapshot | undefined {
  const sessions =
    managedSsh?.sessions.filter((session) =>
      targetMatchesMachine(session.key.target, machine),
    ) ?? [];
  return (
    sessions.find((session) => session.state === "ready") ?? sessions[0]
  );
}

function focusedPaneMatchesSshMachine(
  focusedPane: TerminalPane | undefined,
  machine: Machine,
): boolean {
  return Boolean(
    focusedPane?.mode === "ssh" &&
      (focusedPane.remoteHostId === machine.id ||
        focusedPane.machineId === machine.id),
  );
}

function targetMatchesMachine(target: string, machine: Machine): boolean {
  const normalizedTarget = target.toLowerCase();
  return machineTargetCandidates(machine).some((candidate) =>
    normalizedTarget.includes(candidate.toLowerCase()),
  );
}

function classifyAvailabilityFailure(
  ...values: Array<string | null | undefined>
): SshTerminalFailure | undefined {
  for (const value of values) {
    if (!value) {
      continue;
    }
    const failure = classifySshTerminalFailure(value);
    if (failure) {
      return failure;
    }
  }
  return undefined;
}

function availabilityFailureDetail(failure: SshTerminalFailure): string {
  switch (failure.class) {
    case "authCanceled":
      return "认证已取消，请重新连接并完成认证。";
    case "badCredential":
      return "认证失败，请检查用户名、密码或密钥后重试。";
    case "keyPassphraseMissing":
      return "私钥需要解锁密码，请输入后重试。";
    case "unknownHostKey":
      return "需要先确认主机身份后才能继续。";
    case "hostKeyChanged":
      return "主机身份信息已变化，请核对后重新连接。";
    case "jumpFailed":
      return "跳板机连接失败，请检查相关设置后重试。";
    case "timeout":
      return "连接或操作超时，请检查网络后重试。";
    case "channelUnsupported":
      return "当前主机不支持此操作，可更换主机或使用其它方式完成。";
    case "permissionDenied":
      return "当前凭据或文件权限不足，请检查后重试。";
    case "remoteExit":
      return "远程操作已结束，请重新执行。";
    case "canceled":
      return "操作已取消。";
    case "cleanupFailed":
      return "连接已结束，但部分资源未能正常关闭；可重试或重新连接。";
    case "networkUnreachable":
      return "无法连接主机，请检查地址和网络。";
    case "remoteShellStartup":
      return "远程终端无法启动，请检查默认终端或工作目录。";
    case "disconnect":
      return "连接已断开，请重新连接。";
    case "unknown":
      return "当前无法使用此操作，请稍后重试。";
  }
}

function isHostKeyFailureClass(failureClass: SshTerminalFailure["class"]) {
  return failureClass === "unknownHostKey" || failureClass === "hostKeyChanged";
}

function isCredentialFailureClass(failureClass: SshTerminalFailure["class"]) {
  return (
    failureClass === "authCanceled" ||
    failureClass === "badCredential" ||
    failureClass === "keyPassphraseMissing"
  );
}

function sshMachineTargetLabel(machine: Machine): string {
  const host = machine.host ?? machine.name ?? machine.id;
  const port = machine.port ?? 22;
  const username = machine.username ?? "ssh";
  return `${username}@${host}:${port}`;
}

function machineTargetCandidates(machine: Machine): string[] {
  const candidates = new Set<string>([machine.id]);
  if (machine.host) {
    candidates.add(machine.host);
    candidates.add(`${machine.host}:${machine.port ?? 22}`);
  }
  if (machine.host && machine.username) {
    candidates.add(`${machine.username}@${machine.host}`);
    candidates.add(sshMachineTargetLabel(machine));
  }
  return Array.from(candidates).filter(Boolean);
}
