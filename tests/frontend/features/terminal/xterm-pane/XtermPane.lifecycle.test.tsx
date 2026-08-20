// @author kongweiguang

import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { defaultAppSettings } from "../../../../../src/features/settings/settingsModel";
import { mocks } from "../../../support/terminal/XtermPane.testSupport.tsx";
import { XtermPane } from "../../../../../src/features/terminal/XtermPane";
import { terminalSuggestionProbeScheduler } from "../../../../../src/features/terminal/terminalSuggestionProbeScheduler";
import { TerminalPaneLayout } from "../../../../../src/features/terminal/TerminalPaneLayout";
import type { TerminalLayoutNode, TerminalPane } from "../../../../../src/features/workspace/types";

describe("XtermPane sessions and command blocks", () => {
  it("enables the proposed xterm decoration API required by keyword highlights", async () => {
    render(
      <XtermPane
        focused
        paneId="pane-keyword-highlights"
        resolvedTheme="dark"
        terminalAppearance={defaultAppSettings.terminal}
        title="Keyword highlights"
      />,
    );

    await waitFor(() => {
      expect(mocks.api.createTerminalSession).toHaveBeenCalled();
    });

    expect(mocks.terminalInstances[0].options).toMatchObject({
      allowProposedApi: true,
    });
  });

  it("clears a transient agent startup message when real output arrives", async () => {
    render(
      <XtermPane
        focused
        paneId="pane-agent-claude"
        resolvedTheme="dark"
        startupMessage={"正在加载 Claude...\r\n"}
        terminalAppearance={defaultAppSettings.terminal}
        title="Claude"
        transientStartupMessage
      />,
    );

    await waitFor(() => {
      expect(mocks.api.createTerminalSession).toHaveBeenCalled();
    });

    expect(mocks.terminalInstances[0].write).toHaveBeenCalledWith(
      "正在加载 Claude...\r\n",
    );
    expect(mocks.terminalInstances[0].write).toHaveBeenCalledWith(
      "\x1b[1A\x1b[2K\r",
    );
    await waitFor(() => {
      expect(mocks.terminalInstances[0].write).toHaveBeenCalledWith(
        "hello from pty",
      );
    });
  });

  it("replays saved terminal output and persists new output chunks", async () => {
    const onOutputHistoryChange = vi.fn();

    render(
      <XtermPane
        focused
        onOutputHistoryChange={onOutputHistoryChange}
        outputHistory={"previous output\r\n"}
        paneId="pane-local"
        resolvedTheme="dark"
        terminalAppearance={defaultAppSettings.terminal}
        title="本地 PowerShell"
      />,
    );

    await waitFor(() => {
      expect(mocks.api.createTerminalSession).toHaveBeenCalled();
    });

    expect(mocks.terminalInstances[0].write).toHaveBeenCalledWith(
      "previous output\r\n",
    );
    await waitFor(() => {
      expect(onOutputHistoryChange).toHaveBeenCalledWith(
        "previous output\r\nhello from pty",
      );
    });
  });

  it("cancels suggestion probes without closing the session when hidden", async () => {
    const cancelOwner = vi.spyOn(terminalSuggestionProbeScheduler, "cancelOwner");
    const setOwnerDisabled = vi.spyOn(
      terminalSuggestionProbeScheduler,
      "setOwnerDisabled",
    );
    const { rerender } = render(
      <XtermPane
        focused
        paneId="pane-local"
        resolvedTheme="dark"
        terminalAppearance={defaultAppSettings.terminal}
        title="本地 PowerShell"
        visible
      />,
    );

    await waitFor(() => {
      expect(mocks.api.createTerminalSession).toHaveBeenCalled();
    });
    cancelOwner.mockClear();

    rerender(
      <XtermPane
        focused={false}
        paneId="pane-local"
        resolvedTheme="dark"
        terminalAppearance={defaultAppSettings.terminal}
        title="本地 PowerShell"
        visible={false}
      />,
    );

    expect(cancelOwner).toHaveBeenCalledWith("pane-local");
    expect(setOwnerDisabled).toHaveBeenCalledWith("pane-local", "hidden-pane");
    expect(mocks.api.closeTerminal).not.toHaveBeenCalled();
  });

  it("runs the standard visible recovery flow after a hidden pane returns", async () => {
    const frameCallbacks = new Map<number, FrameRequestCallback>();
    let nextFrameId = 1;
    const requestAnimationFrameSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        const frameId = nextFrameId;
        nextFrameId += 1;
        frameCallbacks.set(frameId, callback);
        return frameId;
      });
    const cancelAnimationFrameSpy = vi
      .spyOn(window, "cancelAnimationFrame")
      .mockImplementation((frameId) => {
        frameCallbacks.delete(frameId);
      });

    try {
      const { rerender } = render(
        <XtermPane
          focused={false}
          paneId="pane-local"
          resolvedTheme="dark"
          terminalAppearance={defaultAppSettings.terminal}
          title="本地 PowerShell"
          visible={false}
        />,
      );

      await waitFor(() => {
        expect(mocks.api.createTerminalSession).toHaveBeenCalled();
      });

      const terminal = mocks.terminalInstances[0];
      const fitAddon = mocks.fitInstances[0];
      mocks.api.closeTerminal.mockClear();
      mocks.api.resizeTerminal.mockClear();
      mocks.api.writeTerminal.mockClear();
      fitAddon.fit.mockClear();
      terminal.refresh.mockClear();
      terminal.cols = 80;
      terminal.rows = 24;
      for (const frameId of [...frameCallbacks.keys()]) {
        runFrame(frameCallbacks, frameId);
      }
      frameCallbacks.clear();
      nextFrameId = 1;
      const terminalContainer = screen.getByLabelText(
        "本地 PowerShell xterm 终端",
      );
      vi.spyOn(terminalContainer, "getBoundingClientRect").mockReturnValue({
        bottom: 600,
        height: 600,
        left: 0,
        right: 800,
        top: 0,
        width: 800,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      });

      rerender(
        <XtermPane
          focused
          paneId="pane-local"
          resolvedTheme="dark"
          terminalAppearance={defaultAppSettings.terminal}
          title="本地 PowerShell"
          visible
        />,
      );

      expect(frameCallbacks.has(1)).toBe(true);
      runFrame(frameCallbacks, 1);
      expect(frameCallbacks.has(2)).toBe(true);
      expect(fitAddon.fit).toHaveBeenCalledTimes(1);

      runFrame(frameCallbacks, 2);

      expect(fitAddon.fit).toHaveBeenCalledTimes(1);
      expect(mocks.api.resizeTerminal).not.toHaveBeenCalledWith("session-1", {
        cols: 100,
        rows: 30,
      });
      expect(terminal.refresh).not.toHaveBeenCalled();
      expect(mocks.api.closeTerminal).not.toHaveBeenCalled();

      act(() => {
        terminal.onDataCallback?.("r");
      });

      expect(mocks.api.writeTerminal).toHaveBeenCalledWith("session-1", "r");
    } finally {
      requestAnimationFrameSpy.mockRestore();
      cancelAnimationFrameSpy.mockRestore();
    }
  });

  it("replays saved terminal output from a stable snapshot resolver", async () => {
    const onOutputHistoryChange = vi.fn();

    render(
      <XtermPane
        focused
        onOutputHistoryChange={onOutputHistoryChange}
        paneId="pane-local"
        resolveInitialOutputHistory={() => "resolver output\r\n"}
        resolvedTheme="dark"
        terminalAppearance={defaultAppSettings.terminal}
        title="本地 PowerShell"
      />,
    );

    await waitFor(() => {
      expect(mocks.api.createTerminalSession).toHaveBeenCalled();
    });

    expect(mocks.terminalInstances[0].write).toHaveBeenCalledWith(
      "resolver output\r\n",
    );
    await waitFor(() => {
      expect(onOutputHistoryChange).toHaveBeenCalledWith(
        "resolver output\r\nhello from pty",
      );
    });
  });

  it("does not reconnect when equivalent launch options are recreated", async () => {
    const { rerender } = render(
      <XtermPane
        args={["-NoLogo"]}
        env={{ KERMINAL_TEST: "1" }}
        focused
        paneId="pane-local"
        resolvedTheme="dark"
        shell="powershell.exe"
        target={{ kind: "local", profileId: "default" }}
        terminalAppearance={defaultAppSettings.terminal}
        title="本地 PowerShell"
      />,
    );

    await waitFor(() => {
      expect(mocks.api.createTerminalSession).toHaveBeenCalledTimes(1);
    });

    rerender(
      <XtermPane
        args={["-NoLogo"]}
        env={{ KERMINAL_TEST: "1" }}
        focused={false}
        paneId="pane-local"
        resolvedTheme="dark"
        shell="powershell.exe"
        target={{ kind: "local", profileId: "default" }}
        terminalAppearance={defaultAppSettings.terminal}
        title="本地 PowerShell"
      />,
    );

    expect(mocks.api.closeTerminal).not.toHaveBeenCalledWith("session-1");
    expect(mocks.api.createTerminalSession).toHaveBeenCalledTimes(1);
  });

  it("keeps an existing pane session mounted when the layout becomes split", async () => {
    const sourcePane: TerminalPane = {
      currentCwd: "/dev",
      id: "pane-ssh-1",
      lines: [],
      machineId: "host-lab",
      mode: "ssh",
      prompt: "root@host:~#",
      remoteHostId: "host-lab",
      status: "online",
      title: "host-lab",
    };
    const splitPane: TerminalPane = {
      ...sourcePane,
      id: "pane-ssh-2",
      title: "右侧分屏",
    };
    const singleLayout: TerminalLayoutNode = {
      paneId: sourcePane.id,
      type: "pane",
    };
    const splitLayout: TerminalLayoutNode = {
      children: [
        { paneId: sourcePane.id, type: "pane" },
        { paneId: splitPane.id, type: "pane" },
      ],
      direction: "horizontal",
      id: "split-1",
      type: "split",
    };
    const props = {
      focusedPaneId: sourcePane.id,
      onClosePane: vi.fn(),
      onFocusPane: vi.fn(),
      onSplitPane: vi.fn(),
      panelGroupId: "tab-ssh-1",
      panesById: new Map([[sourcePane.id, sourcePane]]),
      resolvedTheme: "dark" as const,
      terminalAppearance: defaultAppSettings.terminal,
    };
    const { rerender } = render(
      <TerminalPaneLayout {...props} layout={singleLayout} />,
    );

    await waitFor(() => {
      expect(mocks.api.createSshTerminalSession).toHaveBeenCalledTimes(1);
    });

    rerender(
      <TerminalPaneLayout
        {...props}
        focusedPaneId={splitPane.id}
        layout={splitLayout}
        panesById={
          new Map([
            [sourcePane.id, sourcePane],
            [splitPane.id, splitPane],
          ])
        }
      />,
    );

    await waitFor(() => {
      expect(mocks.api.createSshTerminalSession).toHaveBeenCalledTimes(2);
    });
    expect(mocks.api.closeTerminal).not.toHaveBeenCalledWith("ssh-session-1");
    expect(mocks.terminalInstances[0].dispose).not.toHaveBeenCalled();
    expect(mocks.api.createSshTerminalSession).toHaveBeenNthCalledWith(
      2,
      { cols: 100, cwd: "/dev", hostId: "host-lab", rows: 30 },
      expect.any(Function),
    );
  });

});

function runFrame(
  callbacks: Map<number, FrameRequestCallback>,
  frameId: number,
) {
  const callback = callbacks.get(frameId);
  expect(callback).toBeTypeOf("function");
  callbacks.delete(frameId);
  act(() => {
    callback?.(performance.now());
  });
}
