// @author kongweiguang
import { describe, expect, it } from "vitest";
import {
  buildAgentSessionScope,
  formatCurrentAgentTargetLabel,
} from "../../../../../src/features/tool-panel/agent-launcher/agentSessionTargetModel";

function terminalTab() {
  return {
    id: "tab-main",
    layout: {
      children: [
        { paneId: "pane-a", type: "pane" },
        {
          children: [
            { paneId: "pane-b", type: "pane" },
            { paneId: "pane-c", type: "pane" },
          ],
          id: "split-nested",
          type: "split",
        },
      ],
      direction: "horizontal",
      id: "split-root",
      type: "split",
    },
    machineId: "local",
    title: "开发 Tab",
  } as never;
}

describe("agentSessionTargetModel scope", () => {
  it("uses the active tab for right-panel ownership while Rust keeps terminal access global", () => {
    const tab = terminalTab();

    expect(buildAgentSessionScope(tab)).toEqual({
      kind: "tab",
      tabId: "tab-main",
    });
    expect(formatCurrentAgentTargetLabel(undefined, tab)).toBe(
      "当前 Tab · 3 个终端 · 开发 Tab",
    );
  });

  it("keeps a separate assistant on every tab and only falls back to global without a tab", () => {
    const tab = terminalTab();

    expect(buildAgentSessionScope(tab, "unbound")).toEqual({
      kind: "tab",
      tabId: "tab-main",
    });
    expect(
      buildAgentSessionScope({ id: "sftp", kind: "sftpTransfer" } as never),
    ).toEqual({ kind: "tab", tabId: "sftp" });
    expect(buildAgentSessionScope()).toEqual({ kind: "global" });
    expect(formatCurrentAgentTargetLabel(undefined, undefined)).toBe(
      "整个 Kerminal",
    );
  });
});
