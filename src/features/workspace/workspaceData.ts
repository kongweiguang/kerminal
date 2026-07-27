// @author kongweiguang

import type {
  MachineGroup,
  TerminalPane,
  TerminalTab,
  ToolSummary,
} from "./types";

export const machineGroups: MachineGroup[] = [];

export const terminalTabs: TerminalTab[] = [];

export const terminalPanes: TerminalPane[] = [];

export const tools: ToolSummary[] = [
  {
    id: "context",
    title: "当前上下文",
    description: "当前目标、终端、目录和运行状态",
  },
  {
    id: "agentLauncher",
    title: "Agent Launcher",
    description: "Codex、Claude、自定义 Agent",
  },
  {
    id: "sftp",
    title: "文件",
    description: "SSH/SFTP 与容器文件浏览",
  },
  {
    id: "snippets",
    title: "片段",
    description: "可复用脚本索引",
  },
  {
    id: "tmux",
    title: "tmux",
    description: "session、window 和 pane 管理",
  },
  {
    id: "ports",
    title: "端口",
    description: "SSH 端口转发",
  },
  {
    id: "system",
    title: "系统",
    description: "CPU、内存、网络和磁盘状态",
  },
  {
    id: "logs",
    title: "命令历史",
    description: "当前终端的最近命令",
  },
  {
    id: "settings",
    title: "设置",
    description: "主题、MCP、快捷键",
  },
];
