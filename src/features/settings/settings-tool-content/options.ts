// @author kongweiguang

import {
  Bell,
  Clipboard,
  GitBranch,
  KeyRound,
  Info,
  Keyboard,
  MonitorCog,
  Moon,
  Network,
  Puzzle,
  Route,
  Sun,
  Terminal,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type {
  KeybindingPlatform,
  TerminalInlineSuggestionAcceptKey,
  TerminalInlineSuggestionProviderSettings,
  ThemeMode,
} from "../settingsModel";
import type { VisibleSettingsSectionId } from "./types";

export const themeOptions: Array<{
  icon: typeof Moon;
  label: string;
  value: ThemeMode;
}> = [
  { icon: Moon, label: "深色", value: "dark" },
  { icon: Sun, label: "浅色", value: "light" },
  { icon: MonitorCog, label: "跟随系统", value: "system" },
];

export const inlineSuggestionAcceptKeyOptions: Array<{
  label: string;
  value: TerminalInlineSuggestionAcceptKey;
}> = [
  { label: "右方向键", value: "rightArrow" },
  { label: "不绑定", value: "disabled" },
];

export const commandSuggestionPresentationOptions = [
  { label: "灰色提示和候选列表", value: "inlineAndMenu" },
  { label: "仅灰色提示", value: "inline" },
  { label: "关闭", value: "off" },
] as const;

export const commandSuggestionRemoteRefreshOptions = [
  { label: "安全后台刷新", value: "safe" },
  { label: "仅使用已有缓存", value: "off" },
] as const;

export const inlineSuggestionProviderOptions: Array<{
  icon: LucideIcon;
  key: keyof TerminalInlineSuggestionProviderSettings;
  label: string;
}> = [
  { icon: Clipboard, key: "history", label: "历史" },
  { icon: Route, key: "remotePath", label: "远端路径" },
  { icon: Terminal, key: "remoteCommand", label: "远端命令" },
  { icon: GitBranch, key: "git", label: "Git" },
  { icon: Wrench, key: "spec", label: "CLI Spec" },
];

export const settingsSections: Array<{
  description: string;
  icon: LucideIcon;
  id: VisibleSettingsSectionId;
  label: string;
}> = [
  {
    description: "主题、语言和背景",
    icon: MonitorCog,
    id: "settings-appearance",
    label: "界面外观",
  },
  {
    description: "字体、渲染和交互",
    icon: Terminal,
    id: "settings-terminal",
    label: "终端",
  },
  {
    description: "历史、远端和来源",
    icon: Clipboard,
    id: "settings-suggestions",
    label: "命令提示",
  },
  {
    description: "并发、流水线与超时",
    icon: Network,
    id: "settings-sftp",
    label: "SFTP",
  },
  {
    description: "堡垒机、第三方 SSH 参数和协议",
    icon: Route,
    id: "settings-external-launch",
    label: "外部启动",
  },
  {
    description: "状态和 endpoint",
    icon: Puzzle,
    id: "settings-mcp",
    label: "MCP",
  },
  {
    description: "Git 与密钥",
    icon: KeyRound,
    id: "settings-sync",
    label: "同步",
  },
  {
    description: "通知和后台事件",
    icon: Bell,
    id: "settings-desktop",
    label: "桌面",
  },
  {
    description: "Win / macOS",
    icon: Keyboard,
    id: "settings-keybindings",
    label: "快捷键列表",
  },
  {
    description: "版本、更新与项目链接",
    icon: Info,
    id: "settings-about",
    label: "关于",
  },
];

export const settingsSearchEntries: Array<{
  description: string;
  keywords: string[];
  sectionId: VisibleSettingsSectionId;
  targetId: string;
  title: string;
}> = [
  {
    description: "切换深色、浅色或跟随系统。",
    keywords: ["dark", "light", "system", "theme", "主题", "深色", "浅色"],
    sectionId: "settings-appearance",
    targetId: "settings-interface-appearance-panel",
    title: "应用外观",
  },
  {
    description: "界面语言、密度和窗口透明度。",
    keywords: ["language", "density", "opacity", "语言", "密度", "透明度"],
    sectionId: "settings-appearance",
    targetId: "settings-interface-appearance-panel",
    title: "界面基础设置",
  },
  {
    description: "选择工作台背景图、透明度和铺放方式。",
    keywords: ["background", "image", "壁纸", "背景", "图片"],
    sectionId: "settings-appearance",
    targetId: "settings-background-panel",
    title: "主页面背景",
  },
  {
    description: "分别设置浅色和深色终端配色。",
    keywords: ["terminal", "color", "scheme", "终端", "主题", "配色"],
    sectionId: "settings-terminal",
    targetId: "settings-terminal-theme-panel",
    title: "终端主题",
  },
  {
    description: "终端字体、字号、行高和字重。",
    keywords: ["font", "size", "line height", "字体", "字号", "行高", "字重"],
    sectionId: "settings-terminal",
    targetId: "settings-terminal-font-panel",
    title: "字体配置",
  },
  {
    description: "切换 CPU、GPU 或自动 WebGL 渲染策略。",
    keywords: ["renderer", "webgl", "gpu", "cpu", "渲染", "显卡", "加速"],
    sectionId: "settings-terminal",
    targetId: "settings-terminal-renderer-panel",
    title: "终端渲染",
  },
  {
    description: "选中复制、右键行为、自动重连和滚屏缓冲。",
    keywords: ["copy", "right click", "reconnect", "scrollback", "右键", "复制", "重连", "缓冲"],
    sectionId: "settings-terminal",
    targetId: "settings-terminal-interaction-panel",
    title: "终端交互",
  },
  {
    description: "光标样式和闪烁行为。",
    keywords: ["cursor", "blink", "光标", "闪烁"],
    sectionId: "settings-terminal",
    targetId: "settings-terminal-cursor-panel",
    title: "光标形态",
  },
  {
    description: "灰色命令提示开关、接受按键和远端探测策略。",
    keywords: ["suggestion", "ghost", "inline", "提示", "灰色提示", "接受按键"],
    sectionId: "settings-suggestions",
    targetId: "settings-command-suggestions-policy-panel",
    title: "命令灰色提示",
  },
  {
    description: "历史、远端路径、远端命令、Git 和 CLI Spec provider。",
    keywords: ["provider", "history", "git", "remote", "历史", "远端", "spec"],
    sectionId: "settings-suggestions",
    targetId: "settings-command-suggestions-providers-panel",
    title: "提示 Provider",
  },
  {
    description: "SFTP 传输并发、pipeline 和超时。",
    keywords: ["sftp", "transfer", "pipeline", "timeout", "传输", "并发", "超时"],
    sectionId: "settings-sftp",
    targetId: "settings-sftp-panel",
    title: "SFTP 传输",
  },
  {
    description: "堡垒机、第三方 SSH 参数和 kerminal:// SSH 入口。",
    keywords: [
      "external",
      "bastion",
      "jump",
      "ssh",
      "putty",
      "mobaxterm",
      "xshell",
      "securecrt",
      "kerminal://",
      "跳板机",
      "堡垒机",
      "外部启动",
    ],
    sectionId: "settings-external-launch",
    targetId: "settings-external-launch-compatibility",
    title: "外部 SSH 启动",
  },
  {
    description: "Kerminal MCP Server 状态、endpoint 和工具导航。",
    keywords: ["mcp", "server", "endpoint", "agent", "工具"],
    sectionId: "settings-mcp",
    targetId: "settings-mcp-connection-info",
    title: "MCP Server",
  },
  {
    description: "Git、密钥和配置同步。",
    keywords: ["sync", "git", "key", "同步", "密钥"],
    sectionId: "settings-sync",
    targetId: "settings-sync-panel",
    title: "同步",
  },
  {
    description: "系统通知、后台事件和节流。",
    keywords: ["notification", "desktop", "background", "通知", "后台", "节流"],
    sectionId: "settings-desktop",
    targetId: "settings-desktop-panel",
    title: "桌面通知",
  },
  {
    description: "Windows 和 macOS 快捷键列表。",
    keywords: ["keyboard", "shortcut", "keybinding", "快捷键", "键盘"],
    sectionId: "settings-keybindings",
    targetId: "settings-keybindings-panel",
    title: "快捷键",
  },
  {
    description: "版本、更新和项目链接。",
    keywords: ["about", "version", "update", "关于", "版本", "更新"],
    sectionId: "settings-about",
    targetId: "settings-about-panel",
    title: "关于",
  },
];

export const keybindingPlatformOptions: Array<{
  label: string;
  value: KeybindingPlatform;
}> = [
  { label: "Windows", value: "windows" },
  { label: "macOS", value: "mac" },
];

