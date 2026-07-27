// @author kongweiguang

import { Select } from "../../../components/ui/select";
import { Switch } from "../../../components/ui/switch";
import {
  serialDataBitOptions,
  serialFlowOptions,
  serialParityOptions,
  serialStopBitOptions,
} from "./model";
import {
  FieldRow,
  GroupSelectRow,
  inputClassName,
  PasswordInput,
} from "./shared-ui";

export function TelnetPropertiesPanel({
  groupId,
  groupOptions,
  host,
  name,
  onCreateGroupClick,
  port,
  setGroupId,
  setHost,
  setName,
  setPort,
  setTelnetNote,
  telnetNote,
}: {
  groupId: string;
  groupOptions: Array<{ label: string; value: string }>;
  host: string;
  name: string;
  onCreateGroupClick?: () => void;
  port: string;
  setGroupId: (value: string) => void;
  setHost: (value: string) => void;
  setName: (value: string) => void;
  setPort: (value: string) => void;
  setTelnetNote: (value: string) => void;
  telnetNote: string;
}) {
  return (
    <div className="grid gap-3">
      <FieldRow label="名称">
        <input
          aria-label="名称"
          autoFocus
          className={inputClassName}
          onChange={(event) => setName(event.currentTarget.value)}
          placeholder="例如：lab-telnet"
          value={name}
        />
      </FieldRow>
      <GroupSelectRow
        groupId={groupId}
        groupOptions={groupOptions}
        onCreateGroupClick={onCreateGroupClick}
        setGroupId={setGroupId}
      />
      <FieldRow label="主机">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_136px]">
          <input
            aria-label="主机"
            className={inputClassName}
            onChange={(event) => setHost(event.currentTarget.value)}
            placeholder="telnet.internal 或 192.168.1.10"
            value={host}
          />
          <input
            aria-label="端口"
            className={inputClassName}
            inputMode="numeric"
            onChange={(event) => setPort(event.currentTarget.value)}
            value={port}
          />
        </div>
      </FieldRow>
      <FieldRow label="备注">
        <textarea
          aria-label="备注"
          className={`${inputClassName} min-h-[128px] resize-none py-2`}
          onChange={(event) => setTelnetNote(event.currentTarget.value)}
          placeholder="可选备注"
          value={telnetNote}
        />
      </FieldRow>
    </div>
  );
}

export function SerialPropertiesPanel({
  groupId,
  groupOptions,
  name,
  onCreateGroupClick,
  serialNote,
  setGroupId,
  setName,
  setSerialNote,
}: {
  groupId: string;
  groupOptions: Array<{ label: string; value: string }>;
  name: string;
  onCreateGroupClick?: () => void;
  serialNote: string;
  setGroupId: (value: string) => void;
  setName: (value: string) => void;
  setSerialNote: (value: string) => void;
}) {
  return (
    <div className="grid gap-3">
      <FieldRow label="名称">
        <input
          aria-label="名称"
          autoFocus
          className={inputClassName}
          onChange={(event) => setName(event.currentTarget.value)}
          placeholder="例如：console-serial"
          value={name}
        />
      </FieldRow>
      <GroupSelectRow
        groupId={groupId}
        groupOptions={groupOptions}
        onCreateGroupClick={onCreateGroupClick}
        setGroupId={setGroupId}
      />
      <FieldRow label="备注">
        <textarea
          aria-label="备注"
          className={`${inputClassName} min-h-[180px] resize-none py-2`}
          onChange={(event) => setSerialNote(event.currentTarget.value)}
          placeholder="可选。记录设备用途、机柜位置或接线说明。"
          value={serialNote}
        />
      </FieldRow>
    </div>
  );
}

export function SerialOptionsPanel({
  serialBaud,
  serialDataBits,
  serialFlow,
  serialParity,
  serialPort,
  serialStopBits,
  setSerialBaud,
  setSerialDataBits,
  setSerialFlow,
  setSerialParity,
  setSerialPort,
  setSerialStopBits,
}: {
  serialBaud: string;
  serialDataBits: string;
  serialFlow: string;
  serialParity: string;
  serialPort: string;
  serialStopBits: string;
  setSerialBaud: (value: string) => void;
  setSerialDataBits: (value: string) => void;
  setSerialFlow: (value: string) => void;
  setSerialParity: (value: string) => void;
  setSerialPort: (value: string) => void;
  setSerialStopBits: (value: string) => void;
}) {
  return (
    <div className="grid gap-3">
      <FieldRow label="串口">
        <input
          aria-label="串口"
          className={inputClassName}
          onChange={(event) => setSerialPort(event.currentTarget.value)}
          placeholder="例如：COM3 或 /dev/ttyUSB0"
          value={serialPort}
        />
      </FieldRow>
      <FieldRow label="波特率">
        <input
          aria-label="波特率"
          className={inputClassName}
          inputMode="numeric"
          onChange={(event) => setSerialBaud(event.currentTarget.value)}
          placeholder="9600"
          value={serialBaud}
        />
      </FieldRow>
      <FieldRow label="数据位">
        <Select
          aria-label="数据位"
          buttonClassName="h-9"
          onValueChange={setSerialDataBits}
          options={serialDataBitOptions}
          value={serialDataBits}
        />
      </FieldRow>
      <FieldRow label="停止位">
        <Select
          aria-label="停止位"
          buttonClassName="h-9"
          onValueChange={setSerialStopBits}
          options={serialStopBitOptions}
          value={serialStopBits}
        />
      </FieldRow>
      <FieldRow label="校验">
        <Select
          aria-label="校验"
          buttonClassName="h-9"
          onValueChange={setSerialParity}
          options={serialParityOptions}
          value={serialParity}
        />
      </FieldRow>
      <FieldRow label="流控">
        <Select
          aria-label="流控"
          buttonClassName="h-9"
          onValueChange={setSerialFlow}
          options={serialFlowOptions}
          value={serialFlow}
        />
      </FieldRow>
    </div>
  );
}

export function RdpPropertiesPanel({
  groupId,
  groupOptions,
  host,
  name,
  onCreateGroupClick,
  port,
  rdpNote,
  rdpPassword,
  rdpUsername,
  setGroupId,
  setHost,
  setName,
  setPort,
  setRdpNote,
  setRdpPassword,
  setRdpUsername,
}: {
  groupId: string;
  groupOptions: Array<{ label: string; value: string }>;
  host: string;
  name: string;
  onCreateGroupClick?: () => void;
  port: string;
  rdpNote: string;
  rdpPassword: string;
  rdpUsername: string;
  setGroupId: (value: string) => void;
  setHost: (value: string) => void;
  setName: (value: string) => void;
  setPort: (value: string) => void;
  setRdpNote: (value: string) => void;
  setRdpPassword: (value: string) => void;
  setRdpUsername: (value: string) => void;
}) {
  return (
    <div className="grid gap-3">
      <FieldRow label="名称">
        <input
          aria-label="名称"
          autoFocus
          className={inputClassName}
          onChange={(event) => setName(event.currentTarget.value)}
          placeholder="例如：office-rdp"
          value={name}
        />
      </FieldRow>
      <GroupSelectRow
        groupId={groupId}
        groupOptions={groupOptions}
        onCreateGroupClick={onCreateGroupClick}
        setGroupId={setGroupId}
      />
      <FieldRow label="主机">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_136px]">
          <input
            aria-label="主机"
            className={inputClassName}
            onChange={(event) => setHost(event.currentTarget.value)}
            placeholder="rdp.internal 或 workstation.example.com"
            value={host}
          />
          <input
            aria-label="端口"
            className={inputClassName}
            inputMode="numeric"
            onChange={(event) => setPort(event.currentTarget.value)}
            value={port}
          />
        </div>
      </FieldRow>
      <FieldRow label="用户名">
        <input
          aria-label="用户名"
          className={inputClassName}
          onChange={(event) => setRdpUsername(event.currentTarget.value)}
          placeholder="例如：administrator"
          value={rdpUsername}
        />
      </FieldRow>
      <FieldRow label="密码">
        <div className="grid gap-2">
          <PasswordInput
            ariaLabel="密码"
            onChange={setRdpPassword}
            placeholder="可选"
            value={rdpPassword}
          />
          <p className="text-xs leading-5 text-zinc-500 dark:text-zinc-400">
            密码保存在凭据保险箱中，编辑时可回显。
          </p>
        </div>
      </FieldRow>
      <FieldRow label="备注">
        <textarea
          aria-label="备注"
          className={`${inputClassName} min-h-[128px] resize-none py-2`}
          onChange={(event) => setRdpNote(event.currentTarget.value)}
          placeholder="可选备注"
          value={rdpNote}
        />
      </FieldRow>
    </div>
  );
}

export function RdpDisplayPanel({
  rdpFullscreen,
  rdpHeight,
  rdpWidth,
  setRdpFullscreen,
  setRdpHeight,
  setRdpWidth,
}: {
  rdpFullscreen: boolean;
  rdpHeight: string;
  rdpWidth: string;
  setRdpFullscreen: (value: boolean) => void;
  setRdpHeight: (value: string) => void;
  setRdpWidth: (value: string) => void;
}) {
  return (
    <div className="grid gap-3">
      <FieldRow label="模式">
        <div className="kerminal-field-surface flex min-h-9 items-center justify-between gap-3 rounded-[var(--radius-control)] border px-3 py-1.5 text-[13px] text-[var(--text-secondary)]">
          <span>全屏</span>
          <Switch
            aria-label="全屏"
            checked={rdpFullscreen}
            onCheckedChange={setRdpFullscreen}
          />
        </div>
      </FieldRow>
      <FieldRow label="分辨率">
        <div className="grid gap-3 md:grid-cols-2">
          <input
            aria-label="RDP 宽度"
            className={inputClassName}
            disabled={rdpFullscreen}
            inputMode="numeric"
            onChange={(event) => setRdpWidth(event.currentTarget.value)}
            placeholder="宽度"
            value={rdpWidth}
          />
          <input
            aria-label="RDP 高度"
            className={inputClassName}
            disabled={rdpFullscreen}
            inputMode="numeric"
            onChange={(event) => setRdpHeight(event.currentTarget.value)}
            placeholder="高度"
            value={rdpHeight}
          />
        </div>
      </FieldRow>
    </div>
  );
}
