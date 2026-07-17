/**
 * @author kongweiguang
 */

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultAppSettings } from "../../../../src/features/settings/settingsModel";
import {
  mocks,
  setTerminalBufferLines,
} from "../../support/terminal/XtermPane.testSupport.tsx";
import { XtermPane } from "../../../../src/features/terminal/XtermPane";
import {
  getAgentSendRequestSnapshot,
  consumeAgentSendRequest,
} from "../../../../src/features/agent-workflow/agentSendRequestStore";
import { getTerminalPaneSessionRecord } from "../../../../src/features/terminal/terminalSessionRegistry";
import { readXtermPanePromptSource } from "../../../../src/features/terminal/XtermPane.promptSourceRegistry";

describe("XtermPane command rail boundaries", () => {
  beforeEach(() => {
    const pendingRequest = getAgentSendRequestSnapshot().request;
    if (pendingRequest) consumeAgentSendRequest(pendingRequest.id);
  });

  it("copies command block text through the desktop clipboard facade", async () => {
    const user = userEvent.setup();

    render(
      <XtermPane
        focused
        paneId="pane-local"
        resolvedTheme="dark"
        terminalAppearance={defaultAppSettings.terminal}
        title="本地 PowerShell"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("已连接")).toBeInTheDocument();
    });

    const terminal = mocks.terminalInstances[0];
    setTerminalBufferLines(
      terminal,
      {
        0: "PS C:\\Users\\24052> pwd",
      },
      0,
    );
    act(() => {
      terminal.onDataCallback?.("pwd\r");
      mocks.getLatestOutputHandler()?.({
        data: "C:\\Users\\24052\r\nPS C:\\Users\\24052>",
        kind: "data",
        sessionId: "session-1",
      });
    });
    setTerminalBufferLines(
      terminal,
      {
        0: "PS C:\\Users\\24052> pwd",
        1: "C:\\Users\\24052",
        2: "PS C:\\Users\\24052>",
      },
      2,
    );
    act(() => {
      terminal.onWriteParsedCallback?.();
    });

    const commandRail = await screen.findByLabelText("折叠命令块 pwd");
    fireEvent.contextMenu(commandRail, { clientX: 24, clientY: 48 });
    await user.click(screen.getByRole("menuitem", { name: "复制文本块 pwd" }));

    await waitFor(() =>
      expect(mocks.api.writeDesktopClipboardText).toHaveBeenCalledWith(
        expect.stringContaining("$ pwd"),
      ),
    );
    expect(mocks.api.writeDesktopClipboardText).toHaveBeenCalledWith(
      expect.stringContaining("C:\\Users\\24052"),
    );
  });

  it("routes the clicked command block to Agent instead of using an unrelated block", async () => {
    const user = userEvent.setup();

    render(
      <XtermPane
        focused
        paneId="pane-local"
        resolvedTheme="dark"
        tabId="tab-local"
        terminalAppearance={defaultAppSettings.terminal}
        title="本地 PowerShell"
      />,
    );
    await waitFor(() => {
      expect(screen.getByText("已连接")).toBeInTheDocument();
    });

    const terminal = mocks.terminalInstances[0];
    setTerminalBufferLines(
      terminal,
      {
        0: "PS C:\\\\Users\\\\24052> pwd",
      },
      0,
    );
    act(() => {
      terminal.onDataCallback?.("pwd\r");
      mocks.getLatestOutputHandler()?.({
        data: "C:\\\\Users\\\\24052\r\nPS C:\\\\Users\\\\24052>",
        kind: "data",
        sessionId: "session-1",
      });
    });
    setTerminalBufferLines(
      terminal,
      {
        0: "PS C:\\\\Users\\\\24052> pwd",
        1: "C:\\\\Users\\\\24052",
        2: "PS C:\\\\Users\\\\24052>",
      },
      2,
    );
    act(() => {
      terminal.onWriteParsedCallback?.();
    });

    act(() => {
      terminal.onDataCallback?.("whoami\r");
      mocks.getLatestOutputHandler()?.({
        data: "kong\r\nPS C:\\\\Users\\\\24052>",
        kind: "data",
        sessionId: "session-1",
      });
    });
    setTerminalBufferLines(
      terminal,
      {
        0: "PS C:\\\\Users\\\\24052> pwd",
        1: "C:\\\\Users\\\\24052",
        2: "PS C:\\\\Users\\\\24052> whoami",
        3: "kong",
        4: "PS C:\\\\Users\\\\24052>",
      },
      4,
    );
    act(() => {
      terminal.onWriteParsedCallback?.();
    });
    await screen.findByLabelText("折叠命令块 whoami");

    fireEvent.contextMenu(await screen.findByLabelText("折叠命令块 pwd"));
    await user.click(
      screen.getByRole("menuitem", { name: "发送命令块 pwd 到 Agent" }),
    );

    expect(getAgentSendRequestSnapshot().request).toMatchObject({
      paneId: "pane-local",
      source: "commandBlock",
      tabId: "tab-local",
    });
    expect(
      getTerminalPaneSessionRecord("pane-local")?.commandBlockText,
    ).toContain("$ pwd");
    expect(
      getTerminalPaneSessionRecord("pane-local")?.commandBlockText,
    ).toContain("C:\\\\Users\\\\24052");
    expect(readXtermPanePromptSource("pane-local")?.commandBlockText).toContain(
      "$ pwd",
    );
    expect(
      readXtermPanePromptSource("pane-local")?.commandBlockText,
    ).not.toContain("$ whoami");
  });

  it("keeps the current prompt rail aligned after the context-menu clear action", async () => {
    const user = userEvent.setup();

    render(
      <XtermPane
        focused
        paneId="pane-local"
        resolvedTheme="dark"
        terminalAppearance={defaultAppSettings.terminal}
        title="本地 PowerShell"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("已连接")).toBeInTheDocument();
    });

    const terminal = mocks.terminalInstances[0];
    setTerminalBufferLines(
      terminal,
      {
        0: "PS C:\\Users\\24052> pwd",
      },
      0,
    );

    act(() => {
      terminal.onDataCallback?.("pwd\r");
      mocks.getLatestOutputHandler()?.({
        data: "C:\\Users\\24052\r\nPS C:\\Users\\24052>",
        kind: "data",
        sessionId: "session-1",
      });
    });
    setTerminalBufferLines(
      terminal,
      {
        0: "PS C:\\Users\\24052> pwd",
        1: "C:\\Users\\24052",
        2: "PS C:\\Users\\24052>",
      },
      2,
    );
    act(() => {
      terminal.onWriteParsedCallback?.();
    });

    expect(await screen.findByLabelText("折叠命令块 pwd")).toBeInTheDocument();
    mocks.api.writeTerminal.mockImplementation(async (_sessionId, data) => {
      if (data === "\x0c") {
        setTerminalBufferLines(
          terminal,
          {
            0: "PS C:\\Users\\24052>",
          },
          0,
        );
      }
    });

    fireEvent.contextMenu(screen.getByLabelText("本地 PowerShell xterm 终端"), {
      clientX: 32,
      clientY: 48,
    });
    await user.click(screen.getByRole("menuitem", { name: "清屏" }));

    expect(terminal.clear).not.toHaveBeenCalled();
    expect(mocks.api.writeTerminal).toHaveBeenCalledWith("session-1", "\x0c");
    act(() => {
      terminal.onWriteParsedCallback?.();
    });
    expect(screen.queryByLabelText("折叠命令块 pwd")).not.toBeInTheDocument();
    const clearedPromptRail =
      await screen.findByLabelText("当前命令行色条 当前命令行");
    expect(commandRailTop(clearedPromptRail as HTMLElement)).toBe(0);

    act(() => {
      terminal.onDataCallback?.("\r");
    });

    const pendingEmptyEnterRail =
      await screen.findByLabelText("折叠命令块 空命令");
    expect(commandRailTop(pendingEmptyEnterRail as HTMLElement)).toBe(0);
    expect(
      screen.queryByLabelText("当前命令行色条 当前命令行"),
    ).not.toBeInTheDocument();

    act(() => {
      mocks.getLatestOutputHandler()?.({
        data: "\r\nPS C:\\Users\\24052>",
        kind: "data",
        sessionId: "session-1",
      });
    });
    setTerminalBufferLines(
      terminal,
      {
        0: "PS C:\\Users\\24052>",
        1: "PS C:\\Users\\24052>",
      },
      1,
    );
    act(() => {
      terminal.onWriteParsedCallback?.();
    });

    const emptyEnterRail = await screen.findByLabelText("折叠命令块 空命令");
    expect(commandRailTop(emptyEnterRail as HTMLElement)).toBe(0);
    expect(commandRailHeight(emptyEnterRail as HTMLElement)).toBeGreaterThan(
      17,
    );
    const currentPromptRail =
      screen.getByLabelText("当前命令行色条 当前命令行");
    expect(commandRailTop(currentPromptRail as HTMLElement)).toBeCloseTo(
      commandRailHeight(emptyEnterRail as HTMLElement),
    );
  });

  it("keeps command block rails when the terminal erases below the cursor", async () => {
    render(
      <XtermPane
        focused
        paneId="pane-local"
        resolvedTheme="dark"
        terminalAppearance={defaultAppSettings.terminal}
        title="本地 PowerShell"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("已连接")).toBeInTheDocument();
    });

    const terminal = mocks.terminalInstances[0];
    act(() => {
      terminal.onDataCallback?.("pwd\r");
    });

    expect(await screen.findByLabelText("折叠命令块 pwd")).toBeInTheDocument();

    act(() => {
      terminal.buffer.active.cursorY = 1;
      expect(terminal.triggerCsi("J", [0])).toBe(false);
    });

    expect(await screen.findByLabelText("折叠命令块 pwd")).toBeInTheDocument();
  });

  it("keeps the first command block rail when the shell redraws after enter", async () => {
    render(
      <XtermPane
        focused
        paneId="pane-local"
        resolvedTheme="dark"
        terminalAppearance={defaultAppSettings.terminal}
        title="本地 PowerShell"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("已连接")).toBeInTheDocument();
    });

    const terminal = mocks.terminalInstances[0];
    setTerminalBufferLines(
      terminal,
      {
        0: "PS C:\\Users\\24052>",
      },
      0,
    );
    act(() => {
      terminal.onWriteParsedCallback?.();
    });
    expect(
      await screen.findByLabelText("当前命令行色条 当前命令行"),
    ).toBeInTheDocument();

    setTerminalBufferLines(
      terminal,
      {
        0: "PS C:\\Users\\24052> pwd",
      },
      0,
    );
    act(() => {
      terminal.onDataCallback?.("pwd\r");
    });

    expect(await screen.findByLabelText("折叠命令块 pwd")).toBeInTheDocument();

    act(() => {
      terminal.buffer.active.cursorX = 0;
      terminal.buffer.active.cursorY = 0;
      expect(terminal.triggerCsi("J", [0])).toBe(false);
    });

    expect(await screen.findByLabelText("折叠命令块 pwd")).toBeInTheDocument();
  });

  it("backfills a missing first empty enter rail from consecutive SSH prompts", async () => {
    render(
      <XtermPane
        focused
        paneId="pane-local"
        resolvedTheme="dark"
        terminalAppearance={defaultAppSettings.terminal}
        title="SSH ubuntu"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("已连接")).toBeInTheDocument();
    });

    const terminal = mocks.terminalInstances[0];
    const registerMarker = vi.spyOn(terminal, "registerMarker") as unknown as {
      mock: { results: Array<{ value: unknown }> };
    };
    setTerminalBufferLines(
      terminal,
      {
        0: "*** System restart required ***",
        1: "Last login: Sun Jun 21 09:22:20 2026 from 172.16.10.123",
        2: "ubuntu@ubuntu:~$",
      },
      2,
    );
    act(() => {
      terminal.onWriteParsedCallback?.();
    });

    const firstPromptRail =
      await screen.findByLabelText("当前命令行色条 当前命令行");
    const rowHeight = commandRailHeight(firstPromptRail as HTMLElement);
    expect(commandRailTop(firstPromptRail as HTMLElement)).toBeCloseTo(
      rowHeight * 2,
    );

    act(() => {
      terminal.onDataCallback?.("\r");
    });
    setTerminalBufferLines(
      terminal,
      {
        0: "*** System restart required ***",
        1: "Last login: Sun Jun 21 09:22:20 2026 from 172.16.10.123",
        2: "ubuntu@ubuntu:~$",
        3: "ubuntu@ubuntu:~$",
      },
      3,
    );
    act(() => {
      terminal.onWriteParsedCallback?.();
    });

    const firstStartMarker = registerMarker.mock.results[0]?.value as
      { dispose: () => void } | undefined;
    act(() => {
      firstStartMarker?.dispose();
      terminal.onWriteParsedCallback?.();
    });
    const backfilledFirstRail =
      await screen.findByLabelText("折叠命令块 空命令");
    expect(commandRailTop(backfilledFirstRail as HTMLElement)).toBeCloseTo(
      rowHeight * 2,
    );

    act(() => {
      terminal.onDataCallback?.("\r");
    });
    setTerminalBufferLines(
      terminal,
      {
        0: "*** System restart required ***",
        1: "Last login: Sun Jun 21 09:22:20 2026 from 172.16.10.123",
        2: "ubuntu@ubuntu:~$",
        3: "ubuntu@ubuntu:~$",
        4: "ubuntu@ubuntu:~$",
      },
      4,
    );
    act(() => {
      terminal.onWriteParsedCallback?.();
    });

    const emptyRails = await screen.findAllByLabelText("折叠命令块 空命令");
    expect(
      emptyRails.map((rail) => commandRailTop(rail as HTMLElement)),
    ).toEqual([rowHeight * 2, rowHeight * 3]);
    const emptyRailColors = emptyRails.map(
      (rail) => (rail as HTMLElement).style.backgroundColor,
    );
    expect(new Set(emptyRailColors).size).toBe(2);
    expect(
      commandRailTop(
        screen.getByLabelText("当前命令行色条 当前命令行") as HTMLElement,
      ),
    ).toBeCloseTo(rowHeight * 4);
    expect(
      (screen.getByLabelText("当前命令行色条 当前命令行") as HTMLElement).style
        .backgroundColor,
    ).not.toBe(emptyRailColors[1]);
  });

  it("does not backfill command output lines that only end like prompts", async () => {
    render(
      <XtermPane
        focused
        paneId="pane-local"
        resolvedTheme="dark"
        terminalAppearance={defaultAppSettings.terminal}
        title="SSH ubuntu"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("已连接")).toBeInTheDocument();
    });

    const terminal = mocks.terminalInstances[0];
    setTerminalBufferLines(
      terminal,
      {
        0: "ubuntu@ubuntu:~$",
      },
      0,
    );
    act(() => {
      terminal.onWriteParsedCallback?.();
    });

    setTerminalBufferLines(
      terminal,
      {
        0: "ubuntu@ubuntu:~$ printf",
      },
      0,
    );
    act(() => {
      terminal.onDataCallback?.("printf\r");
      mocks.getLatestOutputHandler()?.({
        data: "value $\r\nubuntu@ubuntu:~$",
        kind: "data",
        sessionId: "session-1",
      });
    });
    setTerminalBufferLines(
      terminal,
      {
        0: "ubuntu@ubuntu:~$ printf",
        1: "value $",
        2: "ubuntu@ubuntu:~$",
      },
      2,
    );
    act(() => {
      terminal.onWriteParsedCallback?.();
    });

    expect(
      await screen.findByLabelText("折叠命令块 printf"),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText("折叠命令块 空命令"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByLabelText("当前命令行色条 当前命令行"),
    ).toBeInTheDocument();
  });

  it("clears command block rails when a clear command erases below from the screen origin", async () => {
    render(
      <XtermPane
        focused
        paneId="pane-local"
        resolvedTheme="dark"
        terminalAppearance={defaultAppSettings.terminal}
        title="本地 PowerShell"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("已连接")).toBeInTheDocument();
    });

    const terminal = mocks.terminalInstances[0];
    act(() => {
      terminal.onDataCallback?.("cls\r");
    });

    expect(await screen.findByLabelText("折叠命令块 cls")).toBeInTheDocument();

    act(() => {
      terminal.buffer.active.cursorX = 0;
      terminal.buffer.active.cursorY = 0;
      expect(terminal.triggerCsi("J", [0])).toBe(false);
    });

    await waitFor(() => {
      expect(screen.queryByLabelText("折叠命令块 cls")).not.toBeInTheDocument();
    });
  });

  it("uses the next command block color when typed input is submitted", async () => {
    render(
      <XtermPane
        focused
        paneId="pane-local"
        resolvedTheme="dark"
        terminalAppearance={defaultAppSettings.terminal}
        title="本地 PowerShell"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("已连接")).toBeInTheDocument();
    });

    const terminal = mocks.terminalInstances[0];
    setTerminalBufferLines(terminal, { 0: "ubuntu@ubuntu:~$ ls" }, 0);

    act(() => {
      terminal.onDataCallback?.("ls\r");
      mocks.getLatestOutputHandler()?.({
        data: "geo-guard kong plugin_config.json\r\nubuntu@ubuntu:~$",
        kind: "data",
        sessionId: "session-1",
      });
    });
    setTerminalBufferLines(
      terminal,
      {
        0: "ubuntu@ubuntu:~$ ls",
        1: "geo-guard kong plugin_config.json",
        2: "ubuntu@ubuntu:~$",
      },
      2,
    );
    act(() => {
      terminal.onWriteParsedCallback?.();
    });

    const lsRail = await screen.findByLabelText("折叠命令块 ls");
    const lsColor = (lsRail as HTMLElement).style.backgroundColor;
    const currentPromptRail =
      screen.getByLabelText("当前命令行色条 当前命令行");
    expect(commandRailTop(currentPromptRail as HTMLElement)).toBeCloseTo(
      commandRailTop(lsRail as HTMLElement) +
        commandRailHeight(lsRail as HTMLElement),
    );

    setTerminalBufferLines(
      terminal,
      {
        0: "ubuntu@ubuntu:~$ ls",
        1: "geo-guard kong plugin_config.json",
        2: "ubuntu@ubuntu:~$ g",
      },
      2,
    );
    act(() => {
      terminal.onDataCallback?.("g");
    });

    expect(
      screen.getByLabelText("当前命令行色条 当前命令行"),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("折叠命令块 g")).not.toBeInTheDocument();

    act(() => {
      terminal.onDataCallback?.("\r");
    });

    const submittedRail = await screen.findByLabelText("折叠命令块 g");
    expect((submittedRail as HTMLElement).style.backgroundColor).not.toBe(
      lsColor,
    );
  });

  it("suppresses command rails for an inline Agent TUI launched through an alias", async () => {
    const onAgentSignal = vi.fn();
    render(
      <XtermPane
        focused
        onAgentSignal={onAgentSignal}
        paneId="pane-local"
        resolvedTheme="dark"
        terminalAppearance={defaultAppSettings.terminal}
        title="dz"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("已连接")).toBeInTheDocument();
    });

    const terminal = mocks.terminalInstances[0];
    setTerminalBufferLines(
      terminal,
      { 0: "PS C:\\dev\\rust\\kerminal> dz" },
      0,
    );
    act(() => {
      terminal.onDataCallback?.("dz\r");
      mocks.getLatestOutputHandler()?.({
        data: "Agent TUI starting\r\n",
        kind: "data",
        sessionId: "session-1",
      });
      terminal.onWriteParsedCallback?.();
    });
    expect(await screen.findByLabelText("折叠命令块 dz")).toBeInTheDocument();

    act(() => {
      mocks.getLatestOutputHandler()?.({
        agentSignal: {
          agent: "codex",
          agentSessionId: "agent-session-1",
          status: "working",
          terminalSessionId: "session-1",
        },
        data: "",
        kind: "agentSignal",
        sessionId: "session-1",
      });
    });

    await waitFor(() => {
      expect(screen.queryByLabelText("命令块色条")).not.toBeInTheDocument();
    });
    expect(screen.getByLabelText("dz xterm 终端").parentElement).toHaveClass(
      "pl-3",
    );
    expect(
      getTerminalPaneSessionRecord("pane-local")?.commandBlockText,
    ).toBeUndefined();
    expect(onAgentSignal).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "working" }),
    );
    expect(terminal.options.cursorBlink).toBe(true);

    setTerminalBufferLines(terminal, { 4: "Write tests for @filename" }, 4);
    act(() => {
      terminal.onDataCallback?.("Write tests for @filename\r");
      terminal.onWriteParsedCallback?.();
      mocks.getLatestOutputHandler()?.({
        agentSignal: {
          agent: "codex",
          agentSessionId: "agent-session-1",
          status: "finished",
          terminalSessionId: "session-1",
        },
        data: "",
        kind: "agentSignal",
        sessionId: "session-1",
      });
    });
    expect(screen.queryByLabelText("命令块色条")).not.toBeInTheDocument();
    expect(
      getTerminalPaneSessionRecord("pane-local")?.commandBlockText,
    ).toBeUndefined();
    expect(terminal.options.cursorBlink).toBe(true);

    act(() => {
      mocks.getLatestOutputHandler()?.({
        agentSignal: {
          agent: "codex",
          agentSessionId: "agent-session-1",
          status: "exited",
          terminalSessionId: "session-1",
        },
        data: "",
        kind: "agentSignal",
        sessionId: "session-1",
      });
    });
    setTerminalBufferLines(
      terminal,
      { 6: "PS C:\\dev\\rust\\kerminal> pwd" },
      6,
    );
    act(() => {
      terminal.onDataCallback?.("pwd\r");
      terminal.onWriteParsedCallback?.();
    });

    expect(await screen.findByLabelText("折叠命令块 pwd")).toBeInTheDocument();
    expect(screen.getByLabelText("dz xterm 终端").parentElement).toHaveClass(
      "pl-6",
    );
    expect(
      getTerminalPaneSessionRecord("pane-local")?.commandBlockText,
    ).toContain("$ pwd");
    expect(terminal.options.cursorBlink).toBe(true);
  });
});

function commandRailTop(rail: HTMLElement) {
  const top = Number.parseFloat(rail.parentElement?.style.top ?? "");
  expect(Number.isFinite(top)).toBe(true);
  return top;
}

function commandRailHeight(rail: HTMLElement) {
  const height = Number.parseFloat(rail.parentElement?.style.height ?? "");
  expect(Number.isFinite(height)).toBe(true);
  return height;
}
