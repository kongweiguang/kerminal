// @author kongweiguang

import { useState, type ReactNode } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { TerminalPane, TerminalTab } from "../../../../src/features/workspace/types";
import { TerminalWorkspace } from "../../../../src/features/terminal/TerminalWorkspace";
import {
  baseTerminalPane,
  batchPanes,
  batchTabs,
  mixedSplitPanes,
  mixedSplitTabs,
  previewOnlyPanes,
  previewOnlyTabs,
  workspaceProps,
} from "../../support/terminal/TerminalWorkspace.testSupport.ts";

vi.mock("../../../../src/features/terminal/XtermPane", () => ({
  XtermPane: ({ title }: { title: string }) => (
    <div aria-label={`${title} xterm 终端`}>本地终端测试替身</div>
  ),
}));

vi.mock("../../../../src/components/ui/resizable", () => ({
  ResizableHandle: ({ "aria-label": ariaLabel }: { "aria-label"?: string }) => (
    <div aria-label={ariaLabel} role="separator" />
  ),
  ResizablePanel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ResizablePanelGroup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

describe("TerminalWorkspace broadcast command", () => {
  it("updates the broadcast command draft", async () => {
    const user = userEvent.setup();
    const onBroadcastDraftChange = vi.fn();

    function ControlledWorkspace() {
      const [broadcastDraft, setBroadcastDraft] = useState("");

      return (
        <TerminalWorkspace
          {...workspaceProps({
            activeTabId: "tab-mixed-split",
            broadcastDraft,
            focusedPaneId: "pane-split-local",
            onBroadcastDraftChange: (draft) => {
              setBroadcastDraft(draft);
              onBroadcastDraftChange(draft);
            },
            panes: mixedSplitPanes,
            tabs: mixedSplitTabs,
          })}
        />
      );
    }

    render(<ControlledWorkspace />);

    await user.type(screen.getByLabelText("批量命令"), "uptime");

    expect(onBroadcastDraftChange).toHaveBeenLastCalledWith("uptime");
  });

  it("sends a safe command to the active local pane without confirmation", async () => {
    const user = userEvent.setup();
    const onBroadcastCommand = vi.fn().mockResolvedValue({
      missingPaneIds: [],
      sentPaneIds: ["pane-split-local"],
    });

    function ControlledWorkspace() {
      const [broadcastDraft, setBroadcastDraft] = useState("");

      return (
        <TerminalWorkspace
          {...workspaceProps({
            activeTabId: "tab-mixed-split",
            broadcastDraft,
            focusedPaneId: "pane-split-local",
            onBroadcastCommand,
            onBroadcastDraftChange: setBroadcastDraft,
            panes: mixedSplitPanes,
            tabs: mixedSplitTabs,
          })}
        />
      );
    }

    render(<ControlledWorkspace />);

    await user.type(screen.getByLabelText("批量命令"), "uptime");
    await user.click(screen.getByRole("button", { name: "发送到 1 个目标" }));

    expect(onBroadcastCommand).toHaveBeenCalledWith({
      command: "uptime",
      data: "uptime\r",
      targetPaneIds: ["pane-split-local"],
    });
    expect(screen.getByRole("status")).toHaveTextContent("已发送到 1 个分屏");
    expect(screen.getByLabelText("批量命令")).toHaveValue("");
  });

  it("sends to multiple or SSH panes without confirmation", async () => {
    const user = userEvent.setup();
    const onBroadcastCommand = vi.fn().mockResolvedValue({
      missingPaneIds: ["pane-batch-ssh"],
      sentPaneIds: ["pane-batch-local"],
    });
    const onBroadcastDraftChange = vi.fn();

    function ControlledWorkspace() {
      const [broadcastDraft, setBroadcastDraft] = useState("");

      return (
        <TerminalWorkspace
          {...workspaceProps({
            activeTabId: "tab-batch",
            broadcastDraft,
            focusedPaneId: "pane-batch-local",
            onBroadcastCommand,
            onBroadcastDraftChange: (draft) => {
              setBroadcastDraft(draft);
              onBroadcastDraftChange(draft);
            },
            panes: batchPanes,
            tabs: batchTabs,
          })}
        />
      );
    }

    render(<ControlledWorkspace />);

    await user.click(screen.getByLabelText("批量命令"));
    expect(screen.getByLabelText("批量命令")).toHaveFocus();
    await user.keyboard("systemctl status nginx");
    expect(onBroadcastDraftChange).toHaveBeenCalled();
    expect(screen.getByLabelText("批量命令")).toHaveValue("systemctl status nginx");
    expect(screen.getByRole("button", { name: "发送到 2 个目标" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "发送到 2 个目标" }));

    expect(onBroadcastCommand).toHaveBeenCalledWith({
      command: "systemctl status nginx",
      data: "systemctl status nginx\r",
      targetPaneIds: ["pane-batch-local", "pane-batch-ssh"],
    });
    expect(screen.getByRole("status")).toHaveTextContent("1 个分屏尚未连接");
  });

  it("can send only to the focused pane from a split tab", async () => {
    const user = userEvent.setup();
    const onBroadcastCommand = vi.fn().mockResolvedValue({
      missingPaneIds: [],
      sentPaneIds: ["pane-batch-ssh"],
    });

    function ControlledWorkspace() {
      const [broadcastDraft, setBroadcastDraft] = useState("");

      return (
        <TerminalWorkspace
          {...workspaceProps({
            activeTabId: "tab-batch",
            broadcastDraft,
            focusedPaneId: "pane-batch-ssh",
            onBroadcastCommand,
            onBroadcastDraftChange: setBroadcastDraft,
            panes: batchPanes,
            tabs: batchTabs,
          })}
        />
      );
    }

    render(<ControlledWorkspace />);

    await user.type(screen.getByLabelText("批量命令"), "hostname");
    await user.click(
      screen.getByRole("button", { name: "发送目标：全部分屏 · 2" }),
    );
    await user.click(
      within(screen.getByRole("menu", { name: "发送目标选择" })).getByRole(
        "button",
        { name: /当前分屏/ },
      ),
    );
    await user.click(screen.getByRole("button", { name: "发送到 1 个目标" }));

    expect(onBroadcastCommand).toHaveBeenCalledWith({
      command: "hostname",
      data: "hostname\r",
      targetPaneIds: ["pane-batch-ssh"],
    });
  });

  it("can send to a custom subset of split panes", async () => {
    const user = userEvent.setup();
    const onBroadcastCommand = vi.fn().mockResolvedValue({
      missingPaneIds: [],
      sentPaneIds: ["pane-batch-local"],
    });

    function ControlledWorkspace() {
      const [broadcastDraft, setBroadcastDraft] = useState("");

      return (
        <TerminalWorkspace
          {...workspaceProps({
            activeTabId: "tab-batch",
            broadcastDraft,
            focusedPaneId: "pane-batch-local",
            onBroadcastCommand,
            onBroadcastDraftChange: setBroadcastDraft,
            panes: batchPanes,
            tabs: batchTabs,
          })}
        />
      );
    }

    render(<ControlledWorkspace />);

    await user.type(screen.getByLabelText("批量命令"), "date");
    await user.click(
      screen.getByRole("button", { name: "发送目标：全部分屏 · 2" }),
    );
    const targetMenu = screen.getByRole("menu", { name: "发送目标选择" });
    await user.click(within(targetMenu).getByRole("button", { name: /自定义/ }));
    await user.click(
      within(targetMenu).getByRole("checkbox", { name: /SSH 批量/ }),
    );
    await user.click(screen.getByRole("button", { name: "发送到 1 个目标" }));

    expect(onBroadcastCommand).toHaveBeenCalledWith({
      command: "date",
      data: "date\r",
      targetPaneIds: ["pane-batch-local"],
    });
  });

  it("hides broadcast controls after switching from a split tab to a single pane tab", async () => {
    const user = userEvent.setup();
    const onBroadcastCommand = vi.fn().mockResolvedValue({
      missingPaneIds: [],
      sentPaneIds: ["pane-local"],
    });

    function ControlledWorkspace() {
      const [activeTabId, setActiveTabId] = useState("tab-batch");
      const [broadcastDraft, setBroadcastDraft] = useState("");
      const focusedPaneId =
        activeTabId === "tab-batch" ? "pane-batch-local" : "pane-local";

      return (
        <>
          <button onClick={() => setActiveTabId("tab-local")} type="button">
            切换到本地
          </button>
          <TerminalWorkspace
            {...workspaceProps({
              activeTabId,
              broadcastDraft,
              focusedPaneId,
              onBroadcastCommand,
              onBroadcastDraftChange: setBroadcastDraft,
              panes: [...batchPanes, baseTerminalPane],
              tabs: [...batchTabs, {
                ...baseTerminalPane,
                id: "tab-local",
                layout: { paneId: "pane-local", type: "pane" as const },
                machineId: "local-powershell",
                title: "本地 PowerShell",
              } as TerminalTab],
            })}
          />
        </>
      );
    }

    render(<ControlledWorkspace />);

    await user.click(
      screen.getByRole("button", { name: "发送目标：全部分屏 · 2" }),
    );
    await user.click(
      within(screen.getByRole("menu", { name: "发送目标选择" })).getByRole(
        "button",
        { name: /自定义/ },
      ),
    );
    expect(
      screen.getByRole("button", { name: "发送目标：自定义 · 2" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "切换到本地" }));

    expect(screen.queryByLabelText("批量命令")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /发送目标/ }),
    ).not.toBeInTheDocument();
    expect(onBroadcastCommand).not.toHaveBeenCalled();
  });

  it("includes telnet and serial panes in broadcast targets without confirmation", async () => {
    const user = userEvent.setup();
    const onBroadcastCommand = vi.fn().mockResolvedValue({
      missingPaneIds: [],
      sentPaneIds: ["pane-broadcast-telnet", "pane-broadcast-serial"],
    });
    const panes: TerminalPane[] = [
      {
        ...baseTerminalPane,
        id: "pane-broadcast-telnet",
        machineId: "telnet-host",
        mode: "telnet",
        title: "Telnet 设备",
      },
      {
        ...baseTerminalPane,
        id: "pane-broadcast-serial",
        machineId: "serial-device",
        mode: "serial",
        title: "Serial 设备",
      },
      {
        ...baseTerminalPane,
        id: "pane-broadcast-preview",
        machineId: "preview-helper",
        mode: "preview",
        title: "预览辅助",
      },
    ];
    const tabs: TerminalTab[] = [
      {
        id: "tab-device-broadcast",
        layout: {
          type: "split",
          id: "split-device-broadcast",
          direction: "horizontal",
          children: [
            { type: "pane", paneId: "pane-broadcast-telnet" },
            { type: "pane", paneId: "pane-broadcast-serial" },
            { type: "pane", paneId: "pane-broadcast-preview" },
          ],
        },
        machineId: "telnet-host",
        title: "设备批量",
      },
    ];

    function ControlledWorkspace() {
      const [broadcastDraft, setBroadcastDraft] = useState("");

      return (
        <TerminalWorkspace
          {...workspaceProps({
            activeTabId: "tab-device-broadcast",
            broadcastDraft,
            focusedPaneId: "pane-broadcast-telnet",
            onBroadcastCommand,
            onBroadcastDraftChange: setBroadcastDraft,
            panes,
            tabs,
          })}
        />
      );
    }

    render(<ControlledWorkspace />);

    await user.type(screen.getByLabelText("批量命令"), "show version");
    await user.click(screen.getByRole("button", { name: "发送到 2 个目标" }));

    expect(onBroadcastCommand).toHaveBeenCalledWith({
      command: "show version",
      data: "show version\r",
      targetPaneIds: ["pane-broadcast-telnet", "pane-broadcast-serial"],
    });
  });

  it("disables broadcast when the active tab has no real terminal panes", async () => {
    const user = userEvent.setup();
    const onBroadcastCommand = vi.fn();

    function ControlledWorkspace() {
      const [broadcastDraft, setBroadcastDraft] = useState("");

      return (
        <TerminalWorkspace
          {...workspaceProps({
            activeTabId: "tab-preview-only",
            broadcastDraft,
            focusedPaneId: "pane-preview-a",
            onBroadcastCommand,
            onBroadcastDraftChange: setBroadcastDraft,
            panes: previewOnlyPanes,
            tabs: previewOnlyTabs,
          })}
        />
      );
    }

    render(<ControlledWorkspace />);

    await user.type(screen.getByLabelText("批量命令"), "uptime");

    expect(screen.getByRole("button", { name: "没有可发送目标" })).toBeDisabled();
    expect(onBroadcastCommand).not.toHaveBeenCalled();
  });
});
