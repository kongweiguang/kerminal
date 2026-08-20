// @author kongweiguang

import type {
  MachineGroup,
  TerminalPane,
  TerminalTab,
  ToolSummary,
} from "./types";
import { toolRailDefinitions } from "../tool-panel";

export const machineGroups: MachineGroup[] = [];

export const terminalTabs: TerminalTab[] = [];

export const terminalPanes: TerminalPane[] = [];

export const tools: ToolSummary[] = [
  ...toolRailDefinitions.map(({ Icon: _Icon, ...tool }) => tool),
  {
    id: "settings",
    title: "设置",
    description: "主题、MCP、快捷键",
  },
];
