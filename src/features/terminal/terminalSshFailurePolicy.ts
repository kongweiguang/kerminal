type SshTerminalFailureClass =
  | "authCanceled"
  | "badCredential"
  | "keyPassphraseMissing"
  | "unknownHostKey"
  | "hostKeyChanged"
  | "jumpFailed"
  | "timeout"
  | "channelUnsupported"
  | "permissionDenied"
  | "remoteExit"
  | "canceled"
  | "cleanupFailed"
  | "networkUnreachable"
  | "remoteShellStartup"
  | "disconnect"
  | "unknown";

export interface SshTerminalFailure {
  class: SshTerminalFailureClass;
  nextAction: string;
  retryable: boolean;
  userMessage: string;
  reconnectHint: string;
}

export interface SshTerminalReconnectDecision {
  autoReconnect: boolean;
  delayMs: number;
  notice: string;
  nextAttempt: number;
}

interface ReconnectPolicyInput {
  appearanceAutoReconnect: boolean;
  attempt: number;
  failure?: SshTerminalFailure;
}

const MAX_AUTO_RECONNECT_ATTEMPTS = 3;
const DEFAULT_RECONNECT_DELAY_MS = 3_000;
const MAX_TRACKED_SSH_OUTPUT_CHARS = 12_000;

const SSH_FAILURE_PATTERNS: Array<{
  class: SshTerminalFailureClass;
  patterns: RegExp[];
}> = [
  {
    class: "authCanceled",
    patterns: [
      /auth(?:entication)? cancel(?:ed|led)/i,
      /user cancel(?:ed|led) authentication/i,
      /认证已取消/i,
      /用户取消认证/i,
    ],
  },
  {
    class: "keyPassphraseMissing",
    patterns: [
      /key passphrase missing/i,
      /private key passphrase missing/i,
      /encrypted private key requires passphrase/i,
      /missing key passphrase/i,
      /缺少私钥 passphrase/i,
      /需要私钥 passphrase/i,
    ],
  },
  {
    class: "hostKeyChanged",
    patterns: [
      /remote host identification has changed/i,
      /host key verification failed/i,
      /offending .*known_hosts/i,
      /host key (?:changed|mismatch)/i,
      /主机密钥已变化/i,
    ],
  },
  {
    class: "unknownHostKey",
    patterns: [
      /no .* host key is known/i,
      /unknown host key/i,
      /unknown server key/i,
      /未知.*主机密钥/i,
    ],
  },
  {
    class: "permissionDenied",
    patterns: [
      /unprotected private key file/i,
      /permissions .* too open/i,
      /bad permissions/i,
      /load key .* permission denied/i,
      /permission denied$/i,
      /权限(?:不足|被拒绝)/i,
    ],
  },
  {
    class: "badCredential",
    patterns: [
      /permission denied \((?:publickey|password|keyboard-interactive|gssapi)[^)]+\)/i,
      /authentication failed/i,
      /too many authentication failures/i,
      /all configured authentication methods failed/i,
      /bad credentials?/i,
      /认证失败/i,
      /密码错误/i,
    ],
  },
  {
    class: "jumpFailed",
    patterns: [
      /stdio forwarding failed/i,
      /proxycommand/i,
      /proxyjump/i,
      /jump host/i,
      /bastion/i,
      /跳板/i,
      /channel \d+: open failed/i,
      /connection closed by unknown port/i,
    ],
  },
  {
    class: "timeout",
    patterns: [
      /timed out/i,
      /timeout/i,
      /operation timed out/i,
      /connection timed out/i,
      /执行超时/i,
      /启动确认超时/i,
    ],
  },
  {
    class: "channelUnsupported",
    patterns: [
      /does not support/i,
      /unsupported/i,
      /unwired/i,
      /subsystem request failed/i,
      /shell request failed/i,
      /exec request failed/i,
      /远端拒绝.*(?:请求|执行)/i,
    ],
  },
  {
    class: "remoteExit",
    patterns: [
      /remote exit/i,
      /exit status/i,
      /exit code/i,
      /exited with/i,
      /退出(?:码|状态)/i,
    ],
  },
  {
    class: "cleanupFailed",
    patterns: [
      /cleanup failed/i,
      /cleanup failure/i,
      /close failed/i,
      /kill failed/i,
      /清理失败/i,
      /关闭失败/i,
    ],
  },
  {
    class: "canceled",
    patterns: [/cancel(?:ed|led)/i, /cancel token/i, /已取消/i, /用户取消/i],
  },
  {
    class: "networkUnreachable",
    patterns: [
      /network is unreachable/i,
      /no route to host/i,
      /connection refused/i,
      /could not resolve hostname/i,
      /temporary failure in name resolution/i,
      /name or service not known/i,
    ],
  },
  {
    class: "remoteShellStartup",
    patterns: [
      /shell request failed/i,
      /exec request failed/i,
      /could not chdir to home directory/i,
      /(?:sh|bash|zsh|fish): .*not found/i,
      /no such file or directory/i,
      /cd: .*no such file or directory/i,
      /exec: .*not found/i,
    ],
  },
  {
    class: "disconnect",
    patterns: [
      /connection reset by peer/i,
      /broken pipe/i,
      /write failed/i,
      /received disconnect/i,
      /connection closed by/i,
      /client_loop: send disconnect/i,
    ],
  },
];

export function classifySshTerminalFailure(
  output: string,
): SshTerminalFailure | undefined {
  const normalized = stripAnsi(output);
  for (const candidate of SSH_FAILURE_PATTERNS) {
    if (candidate.patterns.some((pattern) => pattern.test(normalized))) {
      return sshFailureForClass(candidate.class);
    }
  }
  return undefined;
}

export function createSshTerminalFailureTracker() {
  let tail = "";
  let current: SshTerminalFailure | undefined;
  return {
    append(data: string) {
      if (current) {
        return current;
      }
      tail = `${tail}${data}`.slice(-MAX_TRACKED_SSH_OUTPUT_CHARS);
      current = classifySshTerminalFailure(tail);
      return current;
    },
    reset() {
      tail = "";
      current = undefined;
    },
    current() {
      return current;
    },
  };
}

export function decideSshTerminalReconnect({
  appearanceAutoReconnect,
  attempt,
  failure,
}: ReconnectPolicyInput): SshTerminalReconnectDecision {
  const nextAttempt = attempt + 1;
  if (!appearanceAutoReconnect) {
    return {
      autoReconnect: false,
      delayMs: DEFAULT_RECONNECT_DELAY_MS,
      nextAttempt,
      notice: "\r\n自动重连已关闭，可通过右键菜单重新连接。\r\n",
    };
  }
  if (failure && !failure.retryable) {
    return {
      autoReconnect: false,
      delayMs: DEFAULT_RECONNECT_DELAY_MS,
      nextAttempt,
      notice: `\r\n已停止自动重连：${failure.reconnectHint}\r\n`,
    };
  }
  if (nextAttempt > MAX_AUTO_RECONNECT_ATTEMPTS) {
    return {
      autoReconnect: false,
      delayMs: DEFAULT_RECONNECT_DELAY_MS,
      nextAttempt,
      notice:
        "\r\n自动重连已达到上限，可通过右键菜单在检查网络后重新连接。\r\n",
    };
  }
  return {
    autoReconnect: true,
    delayMs: DEFAULT_RECONNECT_DELAY_MS,
    nextAttempt,
    notice: `\r\n3 秒后自动重新连接...（第 ${nextAttempt}/${MAX_AUTO_RECONNECT_ATTEMPTS} 次）\r\n`,
  };
}

export function formatSshTerminalFailureMessage(
  failure: SshTerminalFailure | undefined,
  fallback: string,
) {
  return failure ? `\r\nSSH 会话已结束：${failure.userMessage}\r\n` : fallback;
}

function sshFailureForClass(
  failureClass: SshTerminalFailureClass,
): SshTerminalFailure {
  switch (failureClass) {
    case "authCanceled":
      return {
        class: failureClass,
        nextAction: "重新连接并完成认证，或在主机设置中保存可用凭据。",
        reconnectHint: "认证已取消，需要用户重新发起连接并完成认证。",
        retryable: false,
        userMessage: "SSH 认证已取消。下一步：重新连接并完成认证。",
      };
    case "badCredential":
      return {
        class: failureClass,
        nextAction: "检查用户名、密码、私钥或 ssh-agent 后手动重连。",
        reconnectHint: "凭据认证失败，请检查用户名、密码、私钥或 agent 后手动重连。",
        retryable: false,
        userMessage:
          "SSH 凭据认证失败。下一步：检查用户名、密码、私钥或 ssh-agent。",
      };
    case "keyPassphraseMissing":
      return {
        class: failureClass,
        nextAction: "输入本次 passphrase，或保存到 encrypted vault 后重试。",
        reconnectHint: "私钥需要 passphrase，请输入或保存后手动重连。",
        retryable: false,
        userMessage:
          "私钥需要 passphrase。下一步：输入本次 passphrase 或保存到 encrypted vault。",
      };
    case "unknownHostKey":
      return {
        class: failureClass,
        nextAction: "核对主机指纹，确认可信后添加 known_hosts 或重新发起受控信任流程。",
        reconnectHint: "主机密钥尚未信任，请核对指纹后手动重连。",
        retryable: false,
        userMessage:
          "SSH 主机密钥尚未信任。下一步：核对指纹后再建立信任。",
      };
    case "hostKeyChanged":
      return {
        class: failureClass,
        nextAction: "先确认目标主机身份；确认安全后再更新 known_hosts。",
        reconnectHint: "主机密钥已变化，请确认目标身份后手动重连。",
        retryable: false,
        userMessage:
          "SSH 主机密钥已变化。下一步：确认目标身份，未确认前不要重连。",
      };
    case "jumpFailed":
      return {
        class: failureClass,
        nextAction: "检查跳板主机、代理命令、端口和凭据后手动重试。",
        reconnectHint: "跳板或代理链路失败，请检查配置后手动重连。",
        retryable: false,
        userMessage: "SSH 跳板或代理链路失败。下一步：检查跳板配置和凭据。",
      };
    case "timeout":
      return {
        class: failureClass,
        nextAction: "检查网络、DNS、端口、防火墙或远端负载后重试。",
        reconnectHint: "SSH 操作超时，可在检查网络后重试。",
        retryable: true,
        userMessage: "SSH 操作超时。下一步：检查网络、端口或远端负载。",
      };
    case "channelUnsupported":
      return {
        class: failureClass,
        nextAction: "切换到支持该能力的 backend，或显式使用 legacy compatibility mode。",
        reconnectHint: "当前 backend 不支持该 SSH channel，自动重连不会修复。",
        retryable: false,
        userMessage:
          "当前 SSH backend 不支持该 channel。下一步：切换 backend 或显式使用兼容模式。",
      };
    case "permissionDenied":
      return {
        class: failureClass,
        nextAction: "修正本地私钥权限、远端目录权限或命令权限后重试。",
        reconnectHint: "SSH 操作被权限拒绝，请修正权限后手动重连。",
        retryable: false,
        userMessage: "SSH 操作被权限拒绝。下一步：修正本地或远端权限。",
      };
    case "remoteExit":
      return {
        class: failureClass,
        nextAction: "查看远端 stdout/stderr，修正命令、工作目录或环境后重试。",
        reconnectHint: "远端命令失败退出，请修正命令或环境后手动重试。",
        retryable: false,
        userMessage: "远端命令已失败退出。下一步：查看输出并修正命令或环境。",
      };
    case "canceled":
      return {
        class: failureClass,
        nextAction: "确认这是预期取消；需要继续时重新执行该操作。",
        reconnectHint: "操作已取消，需要用户重新执行。",
        retryable: false,
        userMessage: "SSH 操作已取消。下一步：需要继续时重新执行。",
      };
    case "cleanupFailed":
      return {
        class: failureClass,
        nextAction: "关闭相关 session 或重启应用后再检查 runtime diagnostics。",
        reconnectHint: "SSH 资源清理失败，请先检查 diagnostics。",
        retryable: true,
        userMessage:
          "SSH 资源清理失败。下一步：关闭相关 session 或重启应用后检查 diagnostics。",
      };
    case "remoteShellStartup":
      return {
        class: failureClass,
        nextAction: "修正远端 shell、工作目录或启动命令后手动重连。",
        reconnectHint: "远端 shell、工作目录或启动命令失败，请修正后手动重连。",
        retryable: false,
        userMessage:
          "远端 shell、工作目录或启动命令失败。下一步：修正远端启动配置。",
      };
    case "networkUnreachable":
      return {
        class: failureClass,
        nextAction: "检查网络、DNS、端口或防火墙后重试。",
        reconnectHint: "网络暂不可达，请检查网络、DNS、端口或防火墙。",
        retryable: true,
        userMessage: "网络暂不可达。下一步：检查网络、DNS、端口或防火墙。",
      };
    case "disconnect":
      return {
        class: failureClass,
        nextAction: "等待网络恢复，必要时手动重连。",
        reconnectHint: "连接已断开，可等待网络恢复后重试。",
        retryable: true,
        userMessage: "连接已断开。下一步：等待网络恢复后重试。",
      };
    case "unknown":
      return {
        class: failureClass,
        nextAction: "查看脱敏 diagnostics 和终端输出，补充具体错误后再重试。",
        reconnectHint: "SSH 失败原因未归类，请查看终端输出后手动重连。",
        retryable: false,
        userMessage: "SSH 失败原因未归类。下一步：查看 diagnostics 和终端输出。",
      };
  }
}

function stripAnsi(value: string) {
  return value.replace(
    new RegExp(String.raw`\u001b\[[0-?]*[ -/]*[@-~]`, "g"),
    "",
  );
}
