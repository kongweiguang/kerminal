// @author kongweiguang

import {
  Ban,
  CircleCheck,
  FolderOpen,
  Link2,
  LoaderCircle,
  Power,
  Route,
  ShieldAlert,
  Terminal,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "../../../components/ui/button";
import { cn } from "../../../lib/cn";
import {
  getExternalLaunchDeepLinkStatus,
  registerExternalLaunchDeepLink,
  unregisterExternalLaunchDeepLink,
  type ExternalLaunchDeepLinkStatus,
} from "../../../lib/externalLaunchApi";
import {
  externalLaunchSourceTools,
  type ExternalLaunchSettings,
  type ExternalLaunchSourceTool,
} from "../settingsModel";
import {
  PolicyToggle,
  SettingsDisclosure,
} from "./shared-controls";

const launchExamples = [
  {
    command:
      'kerminal.exe -ssh ${USER}@${HOST} -P ${PORT} -pw "<PASSWORD_FROM_PLATFORM>"',
    label: "PuTTY 参数",
  },
  {
    command: 'kerminal.exe -newtab "ssh -p ${PORT} ${USER}@${HOST}"',
    label: "MobaXterm 参数",
  },
  {
    command:
      'kerminal.exe -url "ssh://${USER}:<PASSWORD_FROM_PLATFORM>@${HOST}:${PORT}"',
    label: "Xshell 参数",
  },
  {
    command:
      'kerminal.exe /SSH2 /L ${USER} /P ${PORT} /PASSWORD "<PASSWORD_FROM_PLATFORM>" ${HOST}',
    label: "SecureCRT 参数",
  },
  {
    command: "kerminal.exe -p ${PORT} -l ${USER} ${HOST}",
    label: "OpenSSH 参数",
  },
  {
    command:
      'kerminal.exe "sftp://${USER}:<PASSWORD_FROM_PLATFORM>@${HOST}:${PORT}/path/"',
    label: "WinSCP / FileZilla SFTP URL",
  },
  {
    command:
      "kerminal.exe --external-ssh --host ${HOST} --port ${PORT} --user ${USER}",
    label: "Kerminal flags",
  },
  {
    command:
      'kerminal.exe --external-ssh-json {"host":"${HOST}","port":${PORT},"username":"${USER}"}',
    label: "Kerminal JSON",
  },
  {
    command:
      "kerminal://ssh?host=${HOST}&port=${PORT}&user=${USER}&openSftp=true",
    label: "Kerminal URL",
  },
];

const launchToolLabels: Record<
  ExternalLaunchSourceTool,
  { description: string; label: string }
> = {
  putty: {
    description: "PuTTY / Plink 参数 persona。",
    label: "PuTTY",
  },
  mobaxterm: {
    description: "MobaXterm newtab / exec 参数。",
    label: "MobaXterm",
  },
  xshell: {
    description: "Xshell ssh:// URL 或 b64 参数。",
    label: "Xshell",
  },
  securecrt: {
    description: "SecureCRT /SSH2 参数。",
    label: "SecureCRT",
  },
  openssh: {
    description: "OpenSSH ssh 命令参数。",
    label: "OpenSSH",
  },
  "sftp-client": {
    description: "WinSCP / FileZilla / 通用 SFTP URL 参数。",
    label: "SFTP 客户端参数",
  },
  "kerminal-native": {
    description: "Kerminal flags / JSON / URL。",
    label: "Kerminal native",
  },
};

export function ExternalLaunchSettingsSection({
  externalLaunch,
  revealCompatibility = false,
  updateExternalLaunch,
}: {
  externalLaunch: ExternalLaunchSettings;
  revealCompatibility?: boolean;
  updateExternalLaunch: (settings: Partial<ExternalLaunchSettings>) => void;
}) {
  const [deepLinkStatus, setDeepLinkStatus] =
    useState<ExternalLaunchDeepLinkStatus | null>(null);
  const [deepLinkBusy, setDeepLinkBusy] = useState(false);
  const [deepLinkError, setDeepLinkError] = useState("");
  const disabledToolSet = new Set(externalLaunch.disabledTools);
  const disabledToolCount = externalLaunch.disabledTools.length;
  const setToolEnabled = (tool: ExternalLaunchSourceTool, enabled: boolean) => {
    updateExternalLaunch({
      disabledTools: enabled
        ? externalLaunch.disabledTools.filter((item) => item !== tool)
        : [...externalLaunch.disabledTools, tool],
    });
  };

  useEffect(() => {
    let active = true;
    void getExternalLaunchDeepLinkStatus()
      .then((status) => {
        if (active) {
          setDeepLinkStatus(status);
        }
      })
      .catch(() => {
        if (active) {
          setDeepLinkError("无法读取系统协议注册状态。");
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const updateDeepLinkRegistration = async (register: boolean) => {
    if (deepLinkBusy) {
      return;
    }
    setDeepLinkBusy(true);
    setDeepLinkError("");
    try {
      setDeepLinkStatus(
        register
          ? await registerExternalLaunchDeepLink()
          : await unregisterExternalLaunchDeepLink(),
      );
    } catch {
      setDeepLinkError(
        register ? "系统协议注册失败。" : "系统协议注销失败。",
      );
    } finally {
      setDeepLinkBusy(false);
    }
  };

  return (
    <section
      className="kerminal-solid-surface rounded-[var(--radius-panel)] border p-4"
      id="settings-external-launch-panel"
    >
      <div className="flex items-center gap-2 text-sm font-semibold text-zinc-950 dark:text-zinc-50">
        <Route className="h-4 w-4 text-sky-500 dark:text-sky-300" />
        外部 SSH 启动
      </div>

      <div className="mt-3 flex items-start gap-2 rounded-[var(--radius-control)] border border-amber-300/25 bg-amber-400/10 px-3 py-2 text-xs leading-5 text-amber-800 dark:border-amber-300/20 dark:bg-amber-400/10 dark:text-amber-100">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
        外部传入的密码和私钥口令仅用于当前会话，不写入连接配置。
      </div>

      <section className="mt-4 grid gap-3 lg:grid-cols-2">
        <PolicyToggle
          checked={externalLaunch.enabled}
          icon={Power}
          label="启用外部 SSH 启动"
          onChange={(enabled) => updateExternalLaunch({ enabled })}
        />
        <PolicyToggle
          checked={externalLaunch.acceptVendorArgs}
          icon={Terminal}
          label="接受常见终端参数"
          onChange={(acceptVendorArgs) =>
            updateExternalLaunch({ acceptVendorArgs })
          }
        />
        <PolicyToggle
          checked={externalLaunch.autoOpenSftp}
          icon={FolderOpen}
          label="连接后自动打开 SFTP"
          onChange={(autoOpenSftp) => updateExternalLaunch({ autoOpenSftp })}
        />
      </section>

      <div className="mt-4 border-y border-[var(--border-subtle)] py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2">
            <Link2 className="mt-0.5 h-4 w-4 shrink-0 text-sky-500 dark:text-sky-300" />
            <div className="min-w-0">
              <div className="text-sm font-medium text-[var(--text-primary)]">
                kerminal:// 系统协议
              </div>
              <div className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">
                {deepLinkStatus?.supported
                  ? deepLinkStatus.registered
                    ? "已为当前 Windows 用户注册"
                    : "未注册，外部链接不会唤起 Kerminal"
                  : "当前平台不提供生产级协议注册"}
              </div>
            </div>
          </div>
          {deepLinkStatus?.supported ? (
            <Button
              disabled={deepLinkBusy}
              onClick={() =>
                void updateDeepLinkRegistration(!deepLinkStatus.registered)
              }
              size="sm"
              type="button"
              variant={deepLinkStatus.registered ? "ghost" : "primary"}
            >
              {deepLinkBusy ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : deepLinkStatus.registered ? (
                <CircleCheck className="h-4 w-4" />
              ) : (
                <Link2 className="h-4 w-4" />
              )}
              {deepLinkStatus.registered ? "注销协议" : "注册协议"}
            </Button>
          ) : null}
        </div>
        {deepLinkError ? (
          <div
            className="mt-2 text-xs text-red-700 dark:text-red-300"
            role="alert"
          >
            {deepLinkError}
          </div>
        ) : null}
      </div>

      <div className="mt-4">
        <SettingsDisclosure
          reveal={revealCompatibility}
          summary={`${externalLaunchSourceTools.length - disabledToolCount} 个来源`}
          targetId="settings-external-launch-compatibility"
          title="参数兼容性"
        >
          <div className="flex items-center gap-2 text-sm font-medium text-zinc-800 dark:text-zinc-200">
            <Ban className="h-4 w-4 text-zinc-400" />
            允许来源
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {externalLaunchSourceTools.map((tool) => {
              const metadata = launchToolLabels[tool];
              const enabled = !disabledToolSet.has(tool);
              return (
                <button
                  aria-checked={enabled}
                  aria-label={`允许 ${metadata.label}`}
                  className={cn(
                    "kerminal-focus-ring kerminal-pressable flex min-h-20 flex-col items-start rounded-[var(--radius-control)] border px-3 py-3 text-left transition-[background-color,border-color,transform,filter]",
                    enabled
                      ? "border-sky-400/35 bg-[var(--surface-selected)] text-[var(--text-primary)] ring-1 ring-sky-500/10 hover:brightness-105 dark:border-sky-300/25 dark:ring-sky-300/10"
                      : "bg-[var(--surface-content)] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]",
                  )}
                  data-state={enabled ? "checked" : "unchecked"}
                  key={tool}
                  onClick={() => setToolEnabled(tool, !enabled)}
                  role="switch"
                  type="button"
                >
                  <span className="flex w-full items-center justify-between gap-2">
                    <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                      {metadata.label}
                    </span>
                    <span
                      className={cn(
                        "rounded-full border px-2.5 py-1 text-[11px] font-medium leading-none transition-colors",
                        enabled
                          ? "border-sky-400/35 bg-[rgb(var(--app-accent)/0.15)] text-sky-700 dark:text-sky-100"
                          : "border-[var(--border-subtle)] bg-[var(--surface-muted)] text-zinc-500 dark:text-zinc-400",
                      )}
                    >
                      {enabled ? "允许" : "禁用"}
                    </span>
                  </span>
                  <span className="mt-2 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
                    {metadata.description}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="mt-5 flex items-center gap-2 text-sm font-medium text-zinc-800 dark:text-zinc-200">
            <Terminal className="h-4 w-4 text-zinc-400" />
            命令模板
          </div>
          <div className="mt-3 grid gap-3">
            {launchExamples.map((example) => (
              <LaunchExample key={example.label} {...example} />
            ))}
          </div>
        </SettingsDisclosure>
      </div>
    </section>
  );
}

function LaunchExample({
  command,
  label,
}: {
  command: string;
  label: string;
}) {
  return (
    <div className="grid min-w-0 gap-2 border-b border-[var(--border-subtle)] px-1 py-2.5 last:border-b-0 sm:grid-cols-[7rem_minmax(0,1fr)] sm:items-start">
      <div className="text-xs font-medium leading-5 text-zinc-500 dark:text-zinc-400">
        {label}
      </div>
      <code className="block min-w-0 whitespace-pre-wrap break-all rounded-lg bg-[var(--surface-muted)] px-2 py-2 font-mono text-xs leading-5 text-zinc-800 dark:text-zinc-100">
        {command}
      </code>
    </div>
  );
}
