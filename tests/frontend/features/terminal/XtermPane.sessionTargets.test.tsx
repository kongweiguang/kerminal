/**
 * @author kongweiguang
 */

import { render, screen, waitFor } from "@testing-library/react";
import { defaultAppSettings } from "../../../../src/features/settings/settingsModel";
import { describe, expect, it, vi } from "vitest";
import {
  mocks,
} from "../../support/terminal/XtermPane.testSupport.tsx";
import { XtermPane, collectCurrentDirOscSequences } from "../../../../src/features/terminal/XtermPane";
import { getTerminalPaneSessionRecord } from "../../../../src/features/terminal/terminalSessionRegistry";

describe("XtermPane session targets and appearance", () => {
  it("creates a command block for an empty enter without recording history", async () => {
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

    mocks.terminalInstances[0].onDataCallback?.("\r");

    expect(
      await screen.findByLabelText("折叠命令块 空命令"),
    ).toBeInTheDocument();
    expect(mocks.api.writeTerminal).toHaveBeenCalledWith("session-1", "\r");
    expect(mocks.api.recordCommandHistory).not.toHaveBeenCalled();
  });

  it("collects current directory OSC 1337 sequences from terminal output", () => {
    expect(collectCurrentDirOscSequences("", "plain output")).toEqual({
      buffer: "",
      paths: [],
    });

    let state = collectCurrentDirOscSequences(
      "",
      "prompt \u001b]1337;CurrentDir=/srv/app\u0007$ ",
    );
    expect(state).toEqual({ buffer: "", paths: ["/srv/app"] });

    state = collectCurrentDirOscSequences(
      "",
      "\u001b]1337;CurrentDir=/opt/app\u001b\\",
    );
    expect(state).toEqual({ buffer: "", paths: ["/opt/app"] });

    state = collectCurrentDirOscSequences("", "\u001b]1337;Curr");
    expect(state.paths).toEqual([]);
    state = collectCurrentDirOscSequences(
      state.buffer,
      "entDir=/var/www/site\u001b\\",
    );
    expect(state).toEqual({ buffer: "", paths: ["/var/www/site"] });

    state = collectCurrentDirOscSequences(
      "",
      "\u001b]1337;CurrentDir=relative/path\u0007",
    );
    expect(state).toEqual({ buffer: "", paths: [] });

    state = collectCurrentDirOscSequences("", "\r\nroot@pkuai01:/dev# ");
    expect(state).toEqual({ buffer: "", paths: ["/dev"] });

    state = collectCurrentDirOscSequences("", "\r\nroot@pkuai01:/de");
    expect(state.paths).toEqual([]);
    state = collectCurrentDirOscSequences(state.buffer, "v# ");
    expect(state).toEqual({ buffer: "", paths: ["/dev"] });

    state = collectCurrentDirOscSequences("", "\r\nroot@pkuai01:~# ");
    expect(state).toEqual({ buffer: "", paths: [] });

    state = collectCurrentDirOscSequences(
      "",
      "\u001b]7;file://prod.internal/srv/release%20candidate\u0007",
    );
    expect(state).toEqual({
      buffer: "",
      paths: ["/srv/release candidate"],
    });

    state = collectCurrentDirOscSequences("", "\u001b]7;file://prod.internal/srv");
    expect(state.paths).toEqual([]);
    state = collectCurrentDirOscSequences(
      state.buffer,
      "/split-path\u001b\\",
    );
    expect(state).toEqual({ buffer: "", paths: ["/srv/split-path"] });

    expect(
      collectCurrentDirOscSequences(
        "",
        "\u001b]7;https://prod.internal/srv/app\u0007",
      ).paths,
    ).toEqual([]);
    expect(
      collectCurrentDirOscSequences(
        "",
        "\u001b]7;file://prod.internal/srv/app?token=secret\u0007",
      ).paths,
    ).toEqual([]);

    state = collectCurrentDirOscSequences(
      "",
      "\u001b]7;file://prod.internal/srv/release\u0007\r\nroot@prod.internal:/stale# ",
    );
    expect(state).toEqual({ buffer: "", paths: ["/srv/release"] });
  });

  it("keeps SSH protocol cwd after prompt fallback text appears", async () => {
    const onCurrentCwdChange = vi.fn();

    render(
      <XtermPane
        focused
        onCurrentCwdChange={onCurrentCwdChange}
        paneId="pane-ssh"
        remoteHostId="host-lab"
        resolvedTheme="dark"
        terminalAppearance={defaultAppSettings.terminal}
        title="lab server"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("已连接")).toBeInTheDocument();
    });

    mocks.getLatestOutputHandler()?.({
      data: "\u001b]1337;CurrentDir=/var/log\u0007",
      kind: "data",
      sessionId: "ssh-session-1",
    });
    expect(onCurrentCwdChange).toHaveBeenLastCalledWith("/var/log");

    mocks.getLatestOutputHandler()?.({
      data: "\u001b]1337;CurrentDir=/srv/app\u001b\\",
      kind: "data",
      sessionId: "ssh-session-1",
    });
    expect(onCurrentCwdChange).toHaveBeenLastCalledWith("/srv/app");

    mocks.getLatestOutputHandler()?.({
      data: "\r\nroot@pkuai01:/dev# ",
      kind: "data",
      sessionId: "ssh-session-1",
    });
    expect(onCurrentCwdChange).toHaveBeenCalledTimes(2);
    expect(onCurrentCwdChange).toHaveBeenLastCalledWith("/srv/app");
  });

  it("trusts OSC 7 cwd updates only for local shell integration enabled sessions", async () => {
    const onCurrentCwdChange = vi.fn();
    mocks.api.createTerminalSession.mockImplementationOnce(
      async (_request, onOutput) => {
        mocks.setLatestOutputHandler(onOutput);
        return {
          cols: 80,
          id: "session-integrated",
          rows: 24,
          shell: "pwsh.exe",
          shellIntegration: {
            shell: "powershell7",
            status: "enabled",
          },
          status: "running",
        };
      },
    );

    render(
      <XtermPane
        focused
        onCurrentCwdChange={onCurrentCwdChange}
        paneId="pane-local-integrated"
        resolvedTheme="dark"
        terminalAppearance={defaultAppSettings.terminal}
        title="local pwsh"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("已连接")).toBeInTheDocument();
    });

    expect(mocks.terminalInstances[0].triggerOsc(7, "file:///C:/dev/app")).toBe(
      true,
    );
    expect(onCurrentCwdChange).toHaveBeenLastCalledWith("C:/dev/app");

    expect(mocks.terminalInstances[0].triggerOsc(133, "C")).toBe(true);
    expect(
      mocks.terminalInstances[0].triggerOsc(7, "file:///C:/tmp/spoof"),
    ).toBe(true);
    expect(onCurrentCwdChange).not.toHaveBeenLastCalledWith("C:/tmp/spoof");

    expect(mocks.terminalInstances[0].triggerOsc(133, "D;0")).toBe(true);
    expect(mocks.terminalInstances[0].triggerOsc(7, "file://host/c/work")).toBe(
      true,
    );
    expect(onCurrentCwdChange).toHaveBeenLastCalledWith("C:/work");
  });

  it("uses trusted OSC 133 command start before creating integrated command blocks", async () => {
    mocks.api.createTerminalSession.mockImplementationOnce(
      async (_request, onOutput) => {
        mocks.setLatestOutputHandler(onOutput);
        return {
          cols: 80,
          id: "session-integrated-command",
          rows: 24,
          shell: "pwsh.exe",
          shellIntegration: {
            shell: "powershell7",
            status: "enabled",
          },
          status: "running",
        };
      },
    );

    render(
      <XtermPane
        focused
        paneId="pane-local-integrated-command"
        resolvedTheme="dark"
        terminalAppearance={defaultAppSettings.terminal}
        title="local pwsh"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("已连接")).toBeInTheDocument();
    });

    mocks.terminalInstances[0].onDataCallback?.("echo hi\r");
    expect(screen.queryByLabelText("折叠命令块 echo hi")).not.toBeInTheDocument();
    expect(mocks.api.writeTerminal).toHaveBeenCalledWith(
      "session-integrated-command",
      "echo hi\r",
    );
    expect(mocks.api.recordCommandHistory).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "echo hi",
        sessionId: "session-integrated-command",
        target: "local",
      }),
    );

    mocks.getLatestOutputHandler()?.({
      data: "\u001b]133;C;echo hi\u0007hello\r\n\u001b]133;D;0\u0007PS> ",
      kind: "data",
      sessionId: "session-integrated-command",
    });

    expect(
      await screen.findByLabelText("折叠命令块 echo hi"),
    ).toBeInTheDocument();
    mocks.terminalInstances[0].triggerOsc(133, "D;0");
    await waitFor(() => {
      expect(
        getTerminalPaneSessionRecord("pane-local-integrated-command")
          ?.commandBlockText,
      ).toContain("hello");
    });
    expect(
      getTerminalPaneSessionRecord("pane-local-integrated-command")
        ?.commandBlockText,
    ).not.toContain("PS>");
  });

  it("ignores OSC 7 cwd updates for local shell integration disabled sessions", async () => {
    const onCurrentCwdChange = vi.fn();

    render(
      <XtermPane
        focused
        onCurrentCwdChange={onCurrentCwdChange}
        paneId="pane-local-disabled"
        resolvedTheme="dark"
        terminalAppearance={defaultAppSettings.terminal}
        title="local shell"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("已连接")).toBeInTheDocument();
    });

    expect(
      mocks.terminalInstances[0].triggerOsc(7, "file://host/srv/app"),
    ).toBe(false);
    expect(onCurrentCwdChange).not.toHaveBeenCalled();
  });

  it("does not create command blocks for agent terminals with shell assist disabled", async () => {
    mocks.api.createTerminalSession.mockImplementationOnce(
      async (_request, onOutput) => {
        mocks.setLatestOutputHandler(onOutput);
        return {
          cols: 80,
          id: "session-agent-integrated",
          rows: 24,
          shell: "pwsh.exe",
          shellIntegration: {
            shell: "powershell7",
            status: "enabled",
          },
          status: "running",
        };
      },
    );

    render(
      <XtermPane
        focused
        paneId="pane-agent-integrated"
        resolvedTheme="dark"
        shellAssistEnabled={false}
        terminalAppearance={defaultAppSettings.terminal}
        title="agent terminal"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("已连接")).toBeInTheDocument();
    });

    mocks.terminalInstances[0].onDataCallback?.("echo hidden\r");
    mocks.getLatestOutputHandler()?.({
      data: "\u001b]133;C;echo hidden\u0007hidden\r\n\u001b]133;D;0\u0007",
      kind: "data",
      sessionId: "session-agent-integrated",
    });
    mocks.terminalInstances[0].triggerOsc(133, "C;echo hidden");

    expect(screen.queryByLabelText(/命令块 echo hidden/)).not.toBeInTheDocument();
    expect(mocks.api.recordCommandHistory).not.toHaveBeenCalled();
    expect(
      getTerminalPaneSessionRecord("pane-agent-integrated")?.commandBlockText,
    ).toBeUndefined();
  });

  it("routes agent signal events without writing them into the terminal", async () => {
    const onAgentSignal = vi.fn();

    render(
      <XtermPane
        focused
        onAgentSignal={onAgentSignal}
        paneId="pane-agent-signal"
        resolvedTheme="dark"
        shellAssistEnabled={false}
        terminalAppearance={defaultAppSettings.terminal}
        title="agent terminal"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("已连接")).toBeInTheDocument();
    });

    mocks.terminalInstances[0].write.mockClear();
    mocks.getLatestOutputHandler()?.({
      agentSignal: {
        agent: "codex",
        agentSessionId: "ags-codex",
        status: "working",
        terminalSessionId: "session-1",
      },
      data: "",
      kind: "agentSignal",
      sessionId: "session-1",
    });

    expect(onAgentSignal).toHaveBeenCalledWith({
      agent: "codex",
      agentSessionId: "ags-codex",
      status: "working",
      terminalSessionId: "session-1",
    });
    expect(mocks.terminalInstances[0].write).not.toHaveBeenCalled();
    expect(mocks.api.recordCommandHistory).not.toHaveBeenCalled();
  });

  it("starts an SSH terminal session when a remote host id is provided", async () => {
    render(
      <XtermPane
        focused
        paneId="pane-ssh"
        remoteHostId="host-lab"
        resolvedTheme="dark"
        terminalAppearance={defaultAppSettings.terminal}
        title="lab server"
      />,
    );

    await waitFor(() => {
      expect(mocks.api.createSshTerminalSession).toHaveBeenCalledWith(
        { cols: 100, hostId: "host-lab", rows: 30 },
        expect.any(Function),
      );
    });

    expect(mocks.api.createTerminalSession).not.toHaveBeenCalled();
    expect(mocks.terminalInstances[0].write).toHaveBeenCalledWith(
      expect.stringContaining("正在连接 SSH 主机"),
    );
    await waitFor(() => {
      expect(mocks.terminalInstances[0].write).toHaveBeenCalledWith(
        "hello from ssh",
      );
    });
  });

  it("keeps an external SSH launch alive when its terminal pane transiently unmounts", async () => {
    const view = render(
      <XtermPane
        focused
        paneId="pane-external-ssh"
        remoteHostId="external:launch-reconnect"
        resolvedTheme="dark"
        terminalAppearance={defaultAppSettings.terminal}
        title="external server"
      />,
    );

    await waitFor(() => {
      expect(mocks.api.createSshTerminalSession).toHaveBeenCalledWith(
        { cols: 100, hostId: "external:launch-reconnect", rows: 30 },
        expect.any(Function),
      );
    });

    view.unmount();

    await waitFor(() => {
      expect(mocks.api.closeTerminal).toHaveBeenCalledWith("ssh-session-1");
      expect(mocks.api.closeExternalSshLaunch).not.toHaveBeenCalled();
    });
  });

  it("clears the default SSH startup notice before redacted auth output", async () => {
    mocks.api.createSshTerminalSession.mockImplementationOnce(
      async (_request, onOutput) => {
        mocks.setLatestOutputHandler(onOutput);
        mocks.getLatestOutputHandler()?.({
          data: "\r\x1b[2K",
          kind: "data",
          sessionId: "ssh-session-redacted",
        });
        mocks.getLatestOutputHandler()?.({
          data: "ubuntu@ubuntu:~$ ",
          kind: "data",
          sessionId: "ssh-session-redacted",
        });
        return {
          cols: 80,
          id: "ssh-session-redacted",
          rows: 24,
          shell: "ssh",
          shellIntegration: { reason: "remote test default", status: "disabled" },
          status: "running",
        };
      },
    );

    render(
      <XtermPane
        focused
        paneId="pane-ssh-redacted"
        remoteHostId="host-lab"
        resolvedTheme="dark"
        terminalAppearance={defaultAppSettings.terminal}
        title="lab server"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("已连接")).toBeInTheDocument();
    });

    const writes = mocks.terminalInstances[0].write.mock.calls.map(([data]) =>
      String(data),
    );
    const startupIndex = writes.findIndex((data) =>
      data.includes("正在连接 SSH 主机"),
    );
    const frontendClearIndex = writes.indexOf("\x1b[1A\x1b[2K\r");
    const authClearIndex = writes.indexOf("\r\x1b[2K");
    const promptIndex = writes.indexOf("ubuntu@ubuntu:~$ ");

    expect(startupIndex).toBeGreaterThanOrEqual(0);
    expect(frontendClearIndex).toBeGreaterThan(startupIndex);
    expect(authClearIndex).toBeGreaterThan(frontendClearIndex);
    expect(promptIndex).toBeGreaterThan(authClearIndex);
  });

  it("passes the tracked cwd when starting an SSH split terminal", async () => {
    render(
      <XtermPane
        currentCwd="/dev"
        focused
        paneId="pane-ssh"
        remoteHostId="host-lab"
        resolvedTheme="dark"
        terminalAppearance={defaultAppSettings.terminal}
        title="lab server"
      />,
    );

    await waitFor(() => {
      expect(mocks.api.createSshTerminalSession).toHaveBeenCalledWith(
        { cols: 100, cwd: "/dev", hostId: "host-lab", rows: 30 },
        expect.any(Function),
      );
    });
  });

  it("starts Telnet and Serial terminal sessions from target refs", async () => {
    const telnetRender = render(
      <XtermPane
        focused
        paneId="pane-telnet"
        resolvedTheme="dark"
        target={{ hostId: "telnet-lab", kind: "telnet" }}
        terminalAppearance={defaultAppSettings.terminal}
        title="lab telnet"
      />,
    );

    await waitFor(() => {
      expect(mocks.api.createTelnetTerminalSession).toHaveBeenCalledWith(
        { cols: 100, hostId: "telnet-lab", rows: 30 },
        expect.any(Function),
      );
    });
    expect(mocks.terminalInstances[0].write).toHaveBeenCalledWith(
      expect.stringContaining("正在连接 Telnet 主机"),
    );
    await waitFor(() => {
      expect(mocks.terminalInstances[0].write).toHaveBeenCalledWith(
        "hello from telnet",
      );
    });
    telnetRender.unmount();
    mocks.terminalInstances.length = 0;

    render(
      <XtermPane
        focused
        paneId="pane-serial"
        resolvedTheme="dark"
        target={{ hostId: "serial-console", kind: "serial" }}
        terminalAppearance={defaultAppSettings.terminal}
        title="console serial"
      />,
    );

    await waitFor(() => {
      expect(mocks.api.createSerialTerminalSession).toHaveBeenCalledWith(
        { cols: 100, hostId: "serial-console", rows: 30 },
        expect.any(Function),
      );
    });
    expect(mocks.api.createSshTerminalSession).not.toHaveBeenCalled();
    expect(mocks.api.createTerminalSession).not.toHaveBeenCalled();
    expect(mocks.terminalInstances[0].write).toHaveBeenCalledWith(
      expect.stringContaining("正在连接 Serial 设备"),
    );
    await waitFor(() => {
      expect(mocks.terminalInstances[0].write).toHaveBeenCalledWith(
        "hello from serial",
      );
    });
  });

  it("closes the terminal session when unmounted", async () => {
    const { unmount } = render(
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

    unmount();

    expect(mocks.api.closeTerminal).toHaveBeenCalledWith("session-1");
    expect(mocks.terminalInstances[0].dispose).toHaveBeenCalled();
  });

  it("passes terminal appearance and theme options to xterm", async () => {
    render(
      <XtermPane
        focused
        paneId="pane-local"
        resolvedTheme="light"
        terminalAppearance={{
          ...defaultAppSettings.terminal,
          colorScheme: "github",
          cursorBlink: false,
          cursorStyle: "bar",
          darkColorScheme: "github",
          fontFamily: "Consolas, monospace",
          fontSize: 16,
          fontWeight: "bold",
          lightColorScheme: "github",
          lineHeight: 1.5,
          macOptionIsMeta: true,
          scrollback: 12000,
        }}
        title="本地 PowerShell"
      />,
    );

    await waitFor(() => {
      expect(mocks.api.createTerminalSession).toHaveBeenCalled();
    });

    expect(mocks.terminalInstances[0].options).toMatchObject({
      cursorBlink: false,
      cursorStyle: "bar",
      fontFamily: "Consolas, monospace",
      fontSize: 16,
      fontWeight: 600,
      fontWeightBold: 700,
      lineHeight: 1.5,
      macOptionIsMeta: true,
      scrollback: 12000,
    });
    expect(mocks.terminalInstances[0].options.theme).toMatchObject({
      background: "#ffffff",
      foreground: "#24292f",
    });
  });

  it("updates an existing xterm instance when terminal font settings change", async () => {
    const { rerender } = render(
      <XtermPane
        focused
        paneId="pane-local"
        resolvedTheme="dark"
        terminalAppearance={{
          ...defaultAppSettings.terminal,
          fontFamily: "Cascadia Mono, monospace",
          fontSize: 14,
          fontWeight: "normal",
        }}
        title="本地 PowerShell"
      />,
    );

    await waitFor(() => {
      expect(mocks.api.createTerminalSession).toHaveBeenCalled();
    });

    const terminal = mocks.terminalInstances[0];
    const terminalElement = screen.getByLabelText("本地 PowerShell xterm 终端");
    expect(terminal.options).toMatchObject({
      fontFamily: "Cascadia Mono, monospace",
      fontSize: 14,
      fontWeight: 400,
    });
    expect(terminalElement).toHaveStyle({
      fontFamily: "Cascadia Mono, monospace",
    });

    rerender(
      <XtermPane
        focused
        paneId="pane-local"
        resolvedTheme="dark"
        terminalAppearance={{
          ...defaultAppSettings.terminal,
          fontFamily: "JetBrains Mono, monospace",
          fontSize: 18,
          fontWeight: "bold",
        }}
        title="本地 PowerShell"
      />,
    );

    await waitFor(() => {
      expect(terminal.options).toMatchObject({
        fontFamily: "JetBrains Mono, monospace",
        fontSize: 18,
        fontWeight: 600,
      });
    });
    expect(terminalElement).toHaveStyle({
      fontFamily: "JetBrains Mono, monospace",
    });
    expect(terminal.refresh).not.toHaveBeenCalled();
    expect(mocks.fitInstances[0].fit).toHaveBeenCalled();
    expect(mocks.terminalInstances).toHaveLength(1);
  });

});
