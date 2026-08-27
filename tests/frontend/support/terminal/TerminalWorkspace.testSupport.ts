// @author kongweiguang

import type { ComponentProps } from "react";
import { vi } from "vitest";
import { defaultAppSettings } from "../../../../src/features/settings/settingsModel";
import type { MachineGroup, TerminalPane, TerminalTab } from "../../../../src/features/workspace/types";
import type { TerminalWorkspace } from "../../../../src/features/terminal/TerminalWorkspace";

export type TerminalWorkspaceProps = ComponentProps<typeof TerminalWorkspace>;

export const baseTerminalPane: TerminalPane = {
  id: "pane-local",
  lines: [],
  machineId: "local-powershell",
  mode: "local",
  prompt: "PS>",
  status: "online",
  title: "本地 PowerShell",
};

export const baseTerminalTab: TerminalTab = {
  id: "tab-local",
  layout: {
    type: "pane",
    paneId: "pane-local",
  },
  machineId: "local-powershell",
  title: "本地 PowerShell",
};

export const terminalMachineGroups: MachineGroup[] = [
  {
    id: "local-group",
    machines: [
      {
        description: "Windows PowerShell",
        id: "local-powershell",
        kind: "local",
        name: "本地 PowerShell",
        status: "online",
        tags: [],
      },
      {
        description: "Remote Desktop",
        id: "rdp-office",
        kind: "rdp",
        name: "办公桌面",
        status: "online",
        tags: [],
      },
    ],
    title: "本机",
  },
  {
    id: "remote-group",
    machines: [
      {
        description: "SSH production host",
        host: "prod.internal",
        id: "host-prod",
        kind: "ssh",
        name: "生产 SSH",
        port: 22,
        status: "online",
        tags: [],
        username: "deploy",
      },
      {
        description: "Serial console",
        id: "serial-console",
        kind: "serial",
        name: "串口控制台",
        status: "warning",
        tags: [],
      },
    ],
    title: "远程",
  },
];

export const sftpTransferTab: TerminalTab = {
  id: "tab-sftp-transfer-1",
  kind: "sftpTransfer",
  leftHostId: "host-left",
  lockedLeftHostId: "host-left",
  machineId: "host-left",
  rightHostId: "host-right",
  title: "host-left 传输",
};

export function workspaceProps(
  overrides: Partial<TerminalWorkspaceProps> = {},
): TerminalWorkspaceProps {
  return {
    activeTabId: "tab-local",
    broadcastDraft: "",
    focusedPaneId: "pane-local",
    onBroadcastCommand: vi.fn().mockResolvedValue({
      missingPaneIds: [],
      sentPaneIds: ["pane-local"],
    }),
    onBroadcastDraftChange: vi.fn(),
    onClosePane: vi.fn(),
    onCloseTabs: vi.fn(),
    onFocusPane: vi.fn(),
    onRenameTab: vi.fn(),
    onSelectTab: vi.fn(),
    onSplitPane: vi.fn(),
    onUpdateTabGroupPreference: vi.fn(),
    panes: [baseTerminalPane],
    resolvedTheme: "dark",
    tabs: [baseTerminalTab],
    terminalTabGroups: {
      "group-dev": {
        collapsed: false,
        title: "dev.internal",
      },
    },
    terminalAppearance: defaultAppSettings.terminal,
    ...overrides,
  };
}

export const batchPanes = [
  {
    ...baseTerminalPane,
    id: "pane-batch-local",
    mode: "local" as const,
    title: "本地批量",
  },
  {
    ...baseTerminalPane,
    id: "pane-batch-ssh",
    machineId: "host-batch",
    mode: "ssh" as const,
    remoteHostId: "host-batch",
    title: "SSH 批量",
  },
];

export const batchTabs = [
  {
    id: "tab-batch",
    layout: {
      type: "split" as const,
      id: "split-batch",
      direction: "horizontal" as const,
      children: [
        { type: "pane" as const, paneId: "pane-batch-local" },
        { type: "pane" as const, paneId: "pane-batch-ssh" },
      ],
    },
    machineId: "host-batch",
    title: "批量终端",
  },
];

export const mixedSplitPanes = [
  {
    ...baseTerminalPane,
    id: "pane-split-local",
    mode: "local" as const,
    title: "分屏本地",
  },
  {
    ...baseTerminalPane,
    id: "pane-split-preview",
    mode: "preview" as const,
    title: "辅助分屏",
  },
];

export const mixedSplitTabs = [
  {
    id: "tab-mixed-split",
    layout: {
      type: "split" as const,
      id: "split-mixed",
      direction: "horizontal" as const,
      children: [
        { type: "pane" as const, paneId: "pane-split-local" },
        { type: "pane" as const, paneId: "pane-split-preview" },
      ],
    },
    machineId: "local-powershell",
    title: "混合分屏",
  },
];

export const previewOnlyPanes = [
  {
    ...baseTerminalPane,
    id: "pane-preview-a",
    mode: "preview" as const,
    title: "只读分屏 A",
  },
  {
    ...baseTerminalPane,
    id: "pane-preview-b",
    mode: "preview" as const,
    title: "只读分屏 B",
  },
];

export const previewOnlyTabs = [
  {
    id: "tab-preview-only",
    layout: {
      type: "split" as const,
      id: "split-preview-only",
      direction: "horizontal" as const,
      children: [
        { type: "pane" as const, paneId: "pane-preview-a" },
        { type: "pane" as const, paneId: "pane-preview-b" },
      ],
    },
    machineId: "local-powershell",
    title: "只读分屏",
  },
];

export const alternateLocalTabs = [
  baseTerminalTab,
  {
    id: "tab-alt-local",
    layout: {
      type: "pane" as const,
      paneId: "pane-local",
    },
    machineId: "local-powershell",
    title: "备用本地终端",
  },
];

export const manyTerminalTabs: TerminalTab[] = Array.from(
  { length: 12 },
  (_, index) => ({
    id: `tab-many-${index + 1}`,
    layout: {
      type: "pane" as const,
      paneId: "pane-local",
    },
    machineId: `host-many-${index + 1}`,
    title: `远程会话 ${index + 1}`,
  }),
);

export const groupedSshPanes = [
  {
    ...baseTerminalPane,
    id: "pane-dev-a",
    machineId: "host-dev",
    mode: "ssh" as const,
    remoteHostId: "host-dev",
    title: "dev session A",
  },
  {
    ...baseTerminalPane,
    id: "pane-dev-b",
    machineId: "host-dev",
    mode: "ssh" as const,
    remoteHostId: "host-dev",
    title: "dev session B",
  },
  {
    ...baseTerminalPane,
    id: "pane-lab",
    machineId: "host-lab",
    mode: "ssh" as const,
    remoteHostId: "host-lab",
    title: "lab session",
  },
];

export const groupedSshTabs = [
  {
    id: "tab-dev-a",
    layout: {
      type: "pane" as const,
      paneId: "pane-dev-a",
    },
    machineId: "host-dev",
    tabGroupId: "group-dev",
    title: "dev.internal",
  },
  {
    id: "tab-dev-b",
    layout: {
      type: "pane" as const,
      paneId: "pane-dev-b",
    },
    machineId: "host-dev",
    tabGroupId: "group-dev",
    title: "dev.internal #2",
  },
  {
    id: "tab-lab",
    layout: {
      type: "pane" as const,
      paneId: "pane-lab",
    },
    machineId: "host-lab",
    title: "lab.internal",
  },
];

export const crashingPane = {
  ...baseTerminalPane,
  id: "pane-crash",
  mode: "local" as const,
  title: "崩溃终端",
};

export const crashingTabs = [
  {
    id: "tab-crash",
    layout: {
      type: "pane" as const,
      paneId: "pane-crash",
    },
    machineId: "local-powershell",
    title: "异常分屏",
  },
];
