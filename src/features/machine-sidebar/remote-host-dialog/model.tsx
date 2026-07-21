import {
  Cable,
  FolderKey,
  Monitor,
  Network,
  PanelTop,
  Settings,
  SquareTerminal,
  Terminal,
  Waypoints,
  type LucideIcon,
} from "lucide-react";
import type { SelectOption } from "../../../components/ui/select";
import type {
  RemoteHost,
  RemoteHostAuthType,
  RemoteHostCreateRequest,
  RemoteHostGroup,
  RemoteHostGroupCreateRequest,
  RemoteHostUpdateRequest,
  SshProxyProtocol,
  SshTunnelKind,
} from "../../../lib/remoteHostApi";
import type { Machine, MachineGroup } from "../../workspace/contracts/index";

export interface RemoteHostCreateDialogProps {
  defaultGroupId?: string;
  defaultMode?: ConnectionMode;
  editingHost?: RemoteHost;
  editingLocalMachine?: Machine;
  externalConfigConflict?: string;
  groups: MachineGroup[];
  open: boolean;
  onClose: () => void;
  onCreateLocal?: (
    options?: LocalTerminalCreateOptions,
  ) => void | Promise<void>;
  onCreateHost: (request: RemoteHostCreateRequest) => Promise<RemoteHost>;
  onCreateGroup?: (
    request: RemoteHostGroupCreateRequest,
  ) => Promise<RemoteHostGroup>;
  onUpdateHost?: (request: RemoteHostUpdateRequest) => Promise<RemoteHost>;
  onUpdateLocal?: (
    machineId: string,
    options: LocalTerminalCreateOptions,
  ) => void | Promise<void>;
  onCreated?: (host: RemoteHost) => void | Promise<void>;
  onGroupCreated?: (group: RemoteHostGroup) => void | Promise<void>;
}

export type ConnectionMode =
  | "ssh"
  | "sftp"
  | "local"
  | "rdp"
  | "telnet"
  | "serial"
  | "ftp"
  | "s3"
  | "smb"
  | "vnc"
  | "webdav";

export type DialogSection =
  | "properties"
  | "auth"
  | "proxy"
  | "tunnel"
  | "jump"
  | "terminal"
  | "transfer"
  | "environment"
  | "display"
  | "gateway"
  | "resources"
  | "serial"
  | "experience";

export interface LocalTerminalCreateOptions {
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  groupId?: string;
  shell?: string;
  title?: string;
}

export interface SectionTab {
  Icon: LucideIcon;
  description?: string;
  id: DialogSection;
  label: string;
}

export interface LocalShellPreset {
  args: string[];
  id: string;
  label: string;
  shell: string;
}

export const DEFAULT_LOCAL_SHELL_PRESET_ID = "default";
export const CUSTOM_LOCAL_SHELL_PRESET_ID = "custom";

export const localShellFallbackPresets: LocalShellPreset[] = [
  { args: [], id: "pwsh", label: "PowerShell 7", shell: "pwsh.exe" },
  {
    args: [],
    id: "windows-powershell",
    label: "Windows PowerShell",
    shell: "powershell.exe",
  },
  { args: [], id: "cmd", label: "Command Prompt", shell: "cmd.exe" },
  { args: [], id: "git-bash", label: "Git Bash", shell: "bash.exe" },
  { args: [], id: "wsl", label: "WSL", shell: "wsl.exe" },
];

export const protocolTabs: Array<{
  Icon: LucideIcon;
  id: ConnectionMode;
  label: string;
}> = [
  { Icon: SquareTerminal, id: "ssh", label: "SSH" },
  { Icon: FolderKey, id: "sftp", label: "SFTP" },
  { Icon: Terminal, id: "local", label: "Local" },
  { Icon: Monitor, id: "rdp", label: "RDP" },
  { Icon: Cable, id: "telnet", label: "Telnet" },
  { Icon: Cable, id: "serial", label: "Serial" },
];

export const sectionTabsByMode: Partial<Record<ConnectionMode, SectionTab[]>> =
  {
    ssh: [
      { Icon: Settings, id: "properties", label: "属性" },
      { Icon: Waypoints, id: "proxy", label: "代理" },
      { Icon: Network, id: "jump", label: "跳板机" },
      { Icon: Terminal, id: "terminal", label: "终端" },
    ],
    sftp: [
      { Icon: Settings, id: "properties", label: "属性" },
      { Icon: Waypoints, id: "proxy", label: "代理" },
      { Icon: Network, id: "jump", label: "跳板机" },
      { Icon: FolderKey, id: "transfer", label: "传输" },
    ],
    local: [
      { Icon: Monitor, id: "properties", label: "属性" },
      { Icon: Terminal, id: "environment", label: "终端" },
    ],
    rdp: [
      { Icon: Monitor, id: "properties", label: "属性" },
      { Icon: PanelTop, id: "display", label: "显示" },
    ],
    telnet: [{ Icon: Settings, id: "properties", label: "属性" }],
    serial: [
      { Icon: Settings, id: "properties", label: "属性" },
      { Icon: Cable, id: "serial", label: "串口" },
    ],
  };

export const serialDataBitOptions: SelectOption[] = [
  { label: "5", value: "5" },
  { label: "6", value: "6" },
  { label: "7", value: "7" },
  { label: "8", value: "8" },
];

export const serialStopBitOptions: SelectOption[] = [
  { label: "1", value: "1" },
  { label: "2", value: "2" },
];

export const serialParityOptions: SelectOption[] = [
  { label: "None", value: "none" },
  { label: "Odd", value: "odd" },
  { label: "Even", value: "even" },
];

export const serialFlowOptions: SelectOption[] = [
  { label: "None", value: "none" },
  { label: "XON/XOFF", value: "xonxoff" },
  { label: "RTS/CTS", value: "rtscts" },
];

export const authOptions: Array<{
  label: string;
  value: RemoteHostAuthType;
}> = [
  {
    label: "密码",
    value: "password",
  },
  {
    label: "密钥",
    value: "key",
  },
  {
    label: "SSH Agent",
    value: "agent",
  },
];

export const proxyProtocolOptions: Array<{
  label: string;
  value: SshProxyProtocol;
}> = [
  { label: "No", value: "none" },
  { label: "HTTP CONNECT", value: "http" },
  { label: "SOCKS5", value: "socks5" },
];

export const tunnelKindOptions: Array<{ label: string; value: SshTunnelKind }> =
  [
    { label: "Local", value: "local" },
    { label: "Remote", value: "remote" },
    { label: "Dynamic", value: "dynamic" },
  ];

export const terminalTypeOptions = [
  "xterm-256color",
  "xterm",
  "vt100",
  "linux",
];

const DEFAULT_GROUP_LABEL = "默认分组";

export function buildGroupOptions(groups: MachineGroup[]) {
  const options = groups.map((group) => ({
    label: group.title,
    value: group.id,
  }));
  const hasDefaultGroup = groups.some(
    (group) => group.title.trim() === DEFAULT_GROUP_LABEL,
  );
  return hasDefaultGroup
    ? options
    : [{ label: DEFAULT_GROUP_LABEL, value: "" }, ...options];
}

export function initialTargetGroupId(
  groups: MachineGroup[],
  defaultGroupId: string | undefined,
) {
  if (defaultGroupId && groups.some((group) => group.id === defaultGroupId)) {
    return defaultGroupId;
  }

  return (
    groups.find((group) => group.title.trim() === DEFAULT_GROUP_LABEL)?.id ?? ""
  );
}
