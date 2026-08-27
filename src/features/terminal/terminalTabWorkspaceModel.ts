// @author kongweiguang

import {
  collectPaneIds,
  isTerminalSessionTab,
  type MachineStatus,
  type TerminalPane,
  type TerminalTab,
} from "../workspace/contracts/index";
import type { TerminalTabGroup } from "./terminalTabChrome";

/** 非终端工具 Tab 视为可用；终端组按所有 pane 状态合成在线、离线或警告。 */
export function resolveTerminalTabStatus(
  tab: TerminalTab,
  panesById: Map<string, TerminalPane>,
): MachineStatus {
  if (!isTerminalSessionTab(tab)) return "online";
  const statuses = collectPaneIds(tab.layout)
    .map((paneId) => panesById.get(paneId)?.status)
    .filter((status): status is MachineStatus => Boolean(status));
  if (statuses.length === 0) return "offline";
  if (statuses.every((status) => status === "online")) return "online";
  if (statuses.every((status) => status === "offline")) return "offline";
  return "warning";
}

/** 只比较影响标签栏视觉和成员顺序的字段，避免 pane 输出导致组快照抖动。 */
export function sameTerminalTabGroupSnapshot(
  left: TerminalTabGroup,
  right: TerminalTabGroup,
) {
  return (
    left.id === right.id &&
    left.title === right.title &&
    left.color === right.color &&
    left.grouped === right.grouped &&
    left.tabs.length === right.tabs.length &&
    left.tabs.every((tab, index) => tab.id === right.tabs[index]?.id)
  );
}
