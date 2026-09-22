/** @author kongweiguang */

import { Network } from "lucide-react";
import {
  SFTP_GLOBAL_TRANSFERS_MAX,
  SFTP_GLOBAL_TRANSFERS_MIN,
  SFTP_HOST_TRANSFERS_MAX,
  SFTP_HOST_TRANSFERS_MIN,
  SFTP_PACKET_BYTES_MAX,
  SFTP_PACKET_BYTES_MIN,
  SFTP_PIPELINE_DEPTH_MAX,
  SFTP_PIPELINE_DEPTH_MIN,
  SFTP_IDLE_TIMEOUT_SECONDS_MAX,
  SFTP_IDLE_TIMEOUT_SECONDS_MIN,
  type AppSettings,
  type SftpPerformanceSettings,
} from "../settingsModel";
import { NumberSetting, SettingsDisclosure } from "./shared-controls";

interface SftpSettingsSectionProps {
  normalizedSettings: AppSettings;
  updateSftp: (sftp: Partial<SftpPerformanceSettings>) => void;
}

export function SftpSettingsSection({
  normalizedSettings,
  updateSftp,
}: SftpSettingsSectionProps) {
  return (
    <div className="space-y-4" id="settings-sftp-panel">
      <section className="kerminal-solid-surface rounded-[var(--radius-panel)] border p-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-zinc-950 dark:text-zinc-50">
          <Network className="h-4 w-4 text-sky-500 dark:text-sky-300" />
          SFTP 传输
        </div>
        <p className="mt-2 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
          参数仅影响新任务。
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
            <NumberSetting
              help="所有任务共享。"
              label="全局传输并发"
              max={SFTP_GLOBAL_TRANSFERS_MAX}
              min={SFTP_GLOBAL_TRANSFERS_MIN}
              onChange={(globalTransfers) => updateSftp({ globalTransfers })}
              value={normalizedSettings.sftp.globalTransfers}
            />
            <NumberSetting
              help="限制单机压力。"
              label="单主机并发"
              max={SFTP_HOST_TRANSFERS_MAX}
              min={SFTP_HOST_TRANSFERS_MIN}
              onChange={(hostTransfers) => updateSftp({ hostTransfers })}
              value={normalizedSettings.sftp.hostTransfers}
            />
        </div>
      </section>

      <SettingsDisclosure
        summary={`总时长不限 · ${formatIdleTimeoutSummary(normalizedSettings.sftp.idleTimeoutSeconds)}`}
        title="高级传输参数"
      >
        <div className="grid gap-3 md:grid-cols-3">
            <NumberSetting
              help="提高吞吐，也增加压力。"
              label="流水线深度"
              max={SFTP_PIPELINE_DEPTH_MAX}
              min={SFTP_PIPELINE_DEPTH_MIN}
              onChange={(pipelineDepth) => updateSftp({ pipelineDepth })}
              value={normalizedSettings.sftp.pipelineDepth}
            />
            <NumberSetting
              displayScale={1024 * 1024}
              help="单位 M；0.25 = 256K。"
              label="最大包大小"
              max={SFTP_PACKET_BYTES_MAX}
              min={SFTP_PACKET_BYTES_MIN}
              onChange={(packetBytes) => updateSftp({ packetBytes })}
              step={SFTP_PACKET_BYTES_MIN}
              suffix="M"
              value={normalizedSettings.sftp.packetBytes}
            />
            <NumberSetting
              help="仅在连续无数据时停止，不限制文件大小或总时长。"
              label="无进度超时"
              max={SFTP_IDLE_TIMEOUT_SECONDS_MAX}
              min={SFTP_IDLE_TIMEOUT_SECONDS_MIN}
              onChange={(idleTimeoutSeconds) => updateSftp({ idleTimeoutSeconds })}
              suffix="秒"
              value={normalizedSettings.sftp.idleTimeoutSeconds}
            />
        </div>
      </SettingsDisclosure>
    </div>
  );
}

/**
 * 将设置值压缩为折叠区摘要；分钟整除时优先使用分钟，避免用户把保护阈值误读为总时长。
 *
 * @author kongweiguang
 */
function formatIdleTimeoutSummary(seconds: number) {
  return seconds % 60 === 0
    ? `${seconds / 60} 分钟无进度保护`
    : `${seconds} 秒无进度保护`;
}
