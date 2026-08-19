// @author kongweiguang

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getTerminalPaneSession,
  getTerminalPaneSessionRecord,
  markTerminalPaneSessionDisconnected,
  markTerminalPaneSessionReconnected,
  registerTerminalPaneSession,
  runSnippetCommand,
  updateTerminalPaneSessionCwd,
  unregisterTerminalPaneSession,
  writeBroadcastCommand,
  writePaneCommand,
  writeSnippetCommand,
  writeWorkflowCommand,
} from "../../../../src/features/terminal/terminalSessionRegistry";
import {
  clearRemoteSocksAutoInjection,
  setRemoteSocksAutoInjection,
} from "../../../../src/features/terminal/terminalProxyAutoInjection";
import { unregisterTestTerminalPaneSessions } from "../../support/terminalSessionRegistry.testSupport";

const writeTerminalMock = vi.hoisted(() => vi.fn());
const recordCommandHistoryMock = vi.hoisted(() => vi.fn());
const registerTerminalSessionBindingMock = vi.hoisted(() => vi.fn());
const markTerminalSessionBindingReadyMock = vi.hoisted(() => vi.fn());
const markTerminalSessionBindingDisconnectedMock = vi.hoisted(() => vi.fn());
const closeTerminalSessionBindingMock = vi.hoisted(() => vi.fn());

vi.mock("../../../../src/lib/terminalApi", () => ({
  writeTerminal: (...args: unknown[]) => writeTerminalMock(...args),
}));

vi.mock("../../../../src/lib/commandHistoryApi", () => ({
  recordCommandHistory: (...args: unknown[]) =>
    recordCommandHistoryMock(...args),
}));

vi.mock("../../../../src/lib/paneSessionTraceApi", () => ({
  closeTerminalSessionBinding: (...args: unknown[]) =>
    closeTerminalSessionBindingMock(...args),
  markTerminalSessionBindingReady: (...args: unknown[]) =>
    markTerminalSessionBindingReadyMock(...args),
  markTerminalSessionBindingDisconnected: (...args: unknown[]) =>
    markTerminalSessionBindingDisconnectedMock(...args),
  registerTerminalSessionBinding: (...args: unknown[]) =>
    registerTerminalSessionBindingMock(...args),
}));

describe("terminalSessionRegistry", () => {
  beforeEach(() => {
    unregisterTestTerminalPaneSessions();
    writeTerminalMock.mockReset();
    recordCommandHistoryMock.mockReset();
    closeTerminalSessionBindingMock.mockReset();
    closeTerminalSessionBindingMock.mockResolvedValue(undefined);
    markTerminalSessionBindingReadyMock.mockReset();
    markTerminalSessionBindingReadyMock.mockResolvedValue(undefined);
    markTerminalSessionBindingDisconnectedMock.mockReset();
    markTerminalSessionBindingDisconnectedMock.mockResolvedValue(undefined);
    registerTerminalSessionBindingMock.mockReset();
    registerTerminalSessionBindingMock.mockResolvedValue(undefined);
  });

  it("registers, writes and unregisters pane sessions", async () => {
    registerTerminalPaneSession("pane-a", "session-a", {
      profileId: "profile-a",
      shell: "pwsh.exe",
      target: "local",
    });
    registerTerminalPaneSession("pane-b", "session-b", {
      remoteHostId: "host-b",
      target: "ssh",
    });

    const result = await writeBroadcastCommand({
      command: "uptime",
      data: "uptime\r",
      targetPaneIds: ["pane-a", "pane-missing", "pane-b"],
    });

    expect(writeTerminalMock).toHaveBeenNthCalledWith(1, "session-a", "uptime\r");
    expect(writeTerminalMock).toHaveBeenNthCalledWith(2, "session-b", "uptime\r");
    expect(result.sentPaneIds).toEqual(["pane-a", "pane-b"]);
    expect(result.missingPaneIds).toEqual(["pane-missing"]);
    expect(recordCommandHistoryMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        command: "uptime",
        paneId: "pane-a",
        profileId: "profile-a",
        sessionId: "session-a",
        source: "broadcast",
        target: "local",
      }),
    );
    expect(recordCommandHistoryMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        command: "uptime",
        paneId: "pane-b",
        remoteHostId: "host-b",
        sessionId: "session-b",
        source: "broadcast",
        target: "ssh",
      }),
    );

    unregisterTerminalPaneSession("pane-a", "session-a");
    expect(getTerminalPaneSession("pane-a")).toBeUndefined();
  });

  it("auto injects remote SOCKS exports into later same-host SSH sessions", async () => {
    setRemoteSocksAutoInjection({
      command: "export ALL_PROXY='socks5h://127.0.0.1:18080'",
      hostId: "host-a",
      protocol: "socks5",
      proxyUrl: "socks5h://127.0.0.1:18080",
      sessionId: "forward-a",
    });

    registerTerminalPaneSession("pane-a", "session-a", {
      remoteHostId: "host-a",
      target: "ssh",
    });

    await vi.waitFor(() =>
      expect(writeTerminalMock).toHaveBeenCalledWith(
        "session-a",
        "export ALL_PROXY='socks5h://127.0.0.1:18080'\r",
      ),
    );
    expect(recordCommandHistoryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "export ALL_PROXY='socks5h://127.0.0.1:18080'",
        paneId: "pane-a",
        remoteHostId: "host-a",
        source: "tool",
        target: "ssh",
      }),
    );
  });

  it("does not auto inject remote SOCKS exports into a different host", async () => {
    setRemoteSocksAutoInjection({
      command: "export ALL_PROXY='socks5h://127.0.0.1:18080'",
      hostId: "host-a",
      protocol: "socks5",
      proxyUrl: "socks5h://127.0.0.1:18080",
      sessionId: "forward-a",
    });

    registerTerminalPaneSession("pane-b", "session-b", {
      remoteHostId: "host-b",
      target: "ssh",
    });

    await Promise.resolve();

    expect(writeTerminalMock).not.toHaveBeenCalled();
    expect(recordCommandHistoryMock).not.toHaveBeenCalled();
  });

  it("stops auto injecting after the remote SOCKS toggle is cleared", async () => {
    setRemoteSocksAutoInjection({
      command: "export ALL_PROXY='socks5h://127.0.0.1:18080'",
      hostId: "host-a",
      protocol: "socks5",
      proxyUrl: "socks5h://127.0.0.1:18080",
      sessionId: "forward-a",
    });
    clearRemoteSocksAutoInjection("host-a", "forward-a");

    registerTerminalPaneSession("pane-a", "session-a", {
      remoteHostId: "host-a",
      target: "ssh",
    });

    await Promise.resolve();

    expect(writeTerminalMock).not.toHaveBeenCalled();
    expect(recordCommandHistoryMock).not.toHaveBeenCalled();
  });

  it("does not repeat auto injection when the same pane session is registered again", () => {
    setRemoteSocksAutoInjection({
      command: "export ALL_PROXY='socks5h://127.0.0.1:18080'",
      hostId: "host-a",
      protocol: "socks5",
      proxyUrl: "socks5h://127.0.0.1:18080",
      sessionId: "forward-a",
    });

    registerTerminalPaneSession("pane-a", "session-a", {
      remoteHostId: "host-a",
      target: "ssh",
    });
    registerTerminalPaneSession("pane-a", "session-a", {
      remoteHostId: "host-a",
      target: "ssh",
    });

    expect(writeTerminalMock).toHaveBeenCalledTimes(1);
  });

  it("writes workflow commands after the pending remote SOCKS injection", async () => {
    setRemoteSocksAutoInjection({
      command: "export ALL_PROXY='socks5h://127.0.0.1:18080'",
      hostId: "host-a",
      protocol: "socks5",
      proxyUrl: "socks5h://127.0.0.1:18080",
      sessionId: "forward-a",
    });
    registerTerminalPaneSession("pane-a", "session-a", {
      remoteHostId: "host-a",
      target: "ssh",
    });

    await writeWorkflowCommand({
      command: "curl -I https://example.com",
      paneId: "pane-a",
    });

    expect(writeTerminalMock).toHaveBeenNthCalledWith(
      1,
      "session-a",
      "export ALL_PROXY='socks5h://127.0.0.1:18080'\r",
    );
    expect(writeTerminalMock).toHaveBeenNthCalledWith(
      2,
      "session-a",
      "curl -I https://example.com\r",
    );
  });

  it("does not unregister a newer session with a stale session id", () => {
    registerTerminalPaneSession("pane-a", "session-old");
    registerTerminalPaneSession("pane-a", "session-new");
    closeTerminalSessionBindingMock.mockClear();

    unregisterTerminalPaneSession("pane-a", "session-old");

    expect(getTerminalPaneSession("pane-a")).toBe("session-new");
    expect(closeTerminalSessionBindingMock).not.toHaveBeenCalled();
  });

  it("closes a preserved disconnected binding when the pane is later disposed", () => {
    registerTerminalPaneSession("pane-a", "session-disconnected");
    unregisterTerminalPaneSession("pane-a", "session-disconnected", {
      preserveBinding: true,
    });
    closeTerminalSessionBindingMock.mockClear();

    unregisterTerminalPaneSession("pane-a", "session-disconnected");

    expect(closeTerminalSessionBindingMock).toHaveBeenCalledWith({
      paneId: "pane-a",
      sessionId: "session-disconnected",
    });
  });

  it("reports metadata register and ready after registering a pane session", () => {
    registerTerminalPaneSession("pane-a", "session-a", {
      cwd: "/srv/app",
      profileId: "profile-a",
      remoteHostId: "host-a",
      shell: "bash",
      tabId: "tab-a",
      target: "ssh",
    });

    expect(registerTerminalSessionBindingMock).toHaveBeenCalledWith({
      metadata: {
        cwd: "/srv/app",
        profileId: "profile-a",
        remoteHostId: "host-a",
        shell: "bash",
        tabId: "tab-a",
        targetRef: "ssh:host:host-a:tab:tab-a:pane:pane-a",
        targetKind: "ssh",
      },
      paneId: "pane-a",
      sessionId: "session-a",
    });
    expect(markTerminalSessionBindingReadyMock).toHaveBeenCalledWith({
      metadata: {
        cwd: "/srv/app",
        profileId: "profile-a",
        remoteHostId: "host-a",
        shell: "bash",
        tabId: "tab-a",
        targetRef: "ssh:host:host-a:tab:tab-a:pane:pane-a",
        targetKind: "ssh",
      },
      paneId: "pane-a",
      sessionId: "session-a",
    });
  });

  it("normalizes stable target refs for terminal binding metadata", () => {
    registerTerminalPaneSession("pane-local", "session-local", {
      profileId: "profile-a",
      target: "local",
    });
    registerTerminalPaneSession("pane-ssh", "session-ssh", {
      remoteHostId: "host-a",
      tabId: "tab-a",
      target: "ssh",
    });
    registerTerminalPaneSession("pane-docker", "session-docker", {
      containerId: "container-a",
      containerRuntime: "podman",
      remoteHostId: "host-a",
      tabId: "tab-a",
      target: "dockerContainer",
    });
    registerTerminalPaneSession("pane-telnet", "session-telnet", {
      remoteHostId: "telnet-a",
      target: "telnet",
    });
    registerTerminalPaneSession("pane-serial", "session-serial", {
      remoteHostId: "serial-a",
      target: "serial",
    });

    expect(registerTerminalSessionBindingMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        metadata: expect.objectContaining({
          targetKind: "local",
          targetRef: "local:profile:profile-a:pane:pane-local",
        }),
      }),
    );
    expect(registerTerminalSessionBindingMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        metadata: expect.objectContaining({
          targetKind: "ssh",
          targetRef: "ssh:host:host-a:tab:tab-a:pane:pane-ssh",
        }),
      }),
    );
    expect(registerTerminalSessionBindingMock).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        metadata: expect.objectContaining({
          targetKind: "dockerContainer",
          targetRef:
            "dockerContainer:host:host-a:runtime:podman:container:container-a:tab:tab-a:pane:pane-docker",
        }),
      }),
    );
    expect(registerTerminalSessionBindingMock).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({
        metadata: expect.objectContaining({
          targetKind: "telnet",
          targetRef: "telnet:host:telnet-a:pane:pane-telnet",
        }),
      }),
    );
    expect(registerTerminalSessionBindingMock).toHaveBeenNthCalledWith(
      5,
      expect.objectContaining({
        metadata: expect.objectContaining({
          targetKind: "serial",
          targetRef: "serial:host:serial-a:pane:pane-serial",
        }),
      }),
    );
  });

  it("prefers backend session target refs over frontend fallback refs", () => {
    registerTerminalPaneSession("pane-ssh", "session-ssh", {
      remoteHostId: "host-ui",
      target: "ssh",
      targetRef: "ssh:host-backend",
      targetToken: "cap-token-1",
    });

    expect(registerTerminalSessionBindingMock).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          remoteHostId: "host-ui",
          targetKind: "ssh",
          targetRef: "ssh:host-backend",
        }),
        targetToken: "cap-token-1",
      }),
    );
  });

  it("does not let rejected closed reporting block unregistering", () => {
    closeTerminalSessionBindingMock.mockRejectedValueOnce(
      new Error("sidecar offline"),
    );
    registerTerminalPaneSession("pane-a", "session-a");

    unregisterTerminalPaneSession("pane-a", "session-a");

    expect(getTerminalPaneSession("pane-a")).toBeUndefined();
    expect(closeTerminalSessionBindingMock).toHaveBeenCalledWith({
      paneId: "pane-a",
      sessionId: "session-a",
    });
  });

  it("updates a registered pane session cwd for later command history", async () => {
    registerTerminalPaneSession("pane-a", "session-a", {
      cwd: "/srv/app",
      remoteHostId: "host-a",
      target: "ssh",
    });

    updateTerminalPaneSessionCwd("pane-a", "/srv/app/releases");
    await writePaneCommand({
      command: "ls",
      paneId: "pane-a",
      source: "tool",
    });

    expect(recordCommandHistoryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "ls",
        cwd: "/srv/app/releases",
        remoteHostId: "host-a",
        target: "ssh",
      }),
    );
  });

  it("re-registers current binding metadata when cwd changes", () => {
    registerTerminalPaneSession("pane-a", "session-a", {
      cwd: "/srv/app",
      remoteHostId: "host-a",
      shell: "bash",
      target: "ssh",
    });
    registerTerminalSessionBindingMock.mockClear();
    markTerminalSessionBindingReadyMock.mockClear();

    updateTerminalPaneSessionCwd("pane-a", "/srv/app/releases");

    expect(registerTerminalSessionBindingMock).toHaveBeenCalledWith({
      metadata: expect.objectContaining({
        cwd: "/srv/app/releases",
        remoteHostId: "host-a",
        shell: "bash",
        targetRef: "ssh:host:host-a:pane:pane-a",
        targetKind: "ssh",
      }),
      paneId: "pane-a",
      sessionId: "session-a",
    });
    expect(markTerminalSessionBindingReadyMock).toHaveBeenCalledWith({
      metadata: expect.objectContaining({
        cwd: "/srv/app/releases",
        remoteHostId: "host-a",
        shell: "bash",
        targetRef: "ssh:host:host-a:pane:pane-a",
        targetKind: "ssh",
      }),
      paneId: "pane-a",
      sessionId: "session-a",
    });
  });

  it("does not let rejected metadata reporting block cwd updates", async () => {
    registerTerminalPaneSession("pane-a", "session-a", {
      cwd: "/srv/app",
      target: "local",
    });
    registerTerminalSessionBindingMock.mockRejectedValueOnce(
      new Error("sidecar offline"),
    );

    updateTerminalPaneSessionCwd("pane-a", "/srv/app/releases");
    await writePaneCommand({
      command: "pwd",
      paneId: "pane-a",
      source: "tool",
    });

    expect(recordCommandHistoryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "pwd",
        cwd: "/srv/app/releases",
      }),
    );
  });

  it("reports disconnected and reconnected lifecycle for current bindings", () => {
    registerTerminalPaneSession("pane-a", "session-a", {
      cwd: "/srv/app",
      remoteHostId: "host-a",
      target: "ssh",
    });
    registerTerminalSessionBindingMock.mockClear();
    markTerminalSessionBindingReadyMock.mockClear();

    markTerminalPaneSessionDisconnected("pane-a", "session-a");
    markTerminalPaneSessionReconnected("pane-a", "session-a");

    expect(markTerminalSessionBindingDisconnectedMock).toHaveBeenCalledWith({
      metadata: expect.objectContaining({
        cwd: "/srv/app",
        remoteHostId: "host-a",
        targetRef: "ssh:host:host-a:pane:pane-a",
        targetKind: "ssh",
      }),
      paneId: "pane-a",
      sessionId: "session-a",
    });
    expect(registerTerminalSessionBindingMock).toHaveBeenCalledWith({
      metadata: expect.objectContaining({
        cwd: "/srv/app",
        remoteHostId: "host-a",
        targetRef: "ssh:host:host-a:pane:pane-a",
        targetKind: "ssh",
      }),
      paneId: "pane-a",
      sessionId: "session-a",
    });
    expect(markTerminalSessionBindingReadyMock).toHaveBeenCalledWith({
      metadata: expect.objectContaining({
        cwd: "/srv/app",
        remoteHostId: "host-a",
        targetRef: "ssh:host:host-a:pane:pane-a",
        targetKind: "ssh",
      }),
      paneId: "pane-a",
      sessionId: "session-a",
    });
  });

  it("ignores stale disconnected and reconnected reports", () => {
    registerTerminalPaneSession("pane-a", "session-old");
    registerTerminalPaneSession("pane-a", "session-new");
    markTerminalSessionBindingDisconnectedMock.mockClear();
    registerTerminalSessionBindingMock.mockClear();
    markTerminalSessionBindingReadyMock.mockClear();

    markTerminalPaneSessionDisconnected("pane-a", "session-old");
    markTerminalPaneSessionReconnected("pane-a", "session-old");

    expect(markTerminalSessionBindingDisconnectedMock).not.toHaveBeenCalled();
    expect(registerTerminalSessionBindingMock).not.toHaveBeenCalled();
    expect(markTerminalSessionBindingReadyMock).not.toHaveBeenCalled();
  });

  it("writes a snippet command to one pane and records snippet history", async () => {
    registerTerminalPaneSession("pane-a", "session-a", {
      cwd: "C:/dev/rust/kerminal",
      profileId: "profile-a",
      shell: "pwsh.exe",
      target: "local",
    });

    const result = await runSnippetCommand({
      command: " git status --short ",
      paneId: "pane-a",
      tabId: "tab-a",
    });

    expect(result).toEqual({
      paneId: "pane-a",
      sent: true,
      sessionId: "session-a",
      target: "local",
    });
    expect(writeTerminalMock).toHaveBeenCalledWith(
      "session-a",
      "git status --short\r",
    );
    expect(recordCommandHistoryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "git status --short",
        cwd: "C:/dev/rust/kerminal",
        paneId: "pane-a",
        profileId: "profile-a",
        sessionId: "session-a",
        shell: "pwsh.exe",
        source: "snippet",
        tabId: "tab-a",
        target: "local",
      }),
    );
  });

  it("inserts a snippet without appending carriage return or history", async () => {
    registerTerminalPaneSession("pane-a", "session-a", {
      target: "local",
    });

    await writeSnippetCommand({
      command: " git status --short ",
      paneId: "pane-a",
    });

    expect(writeTerminalMock).toHaveBeenCalledWith(
      "session-a",
      "git status --short",
    );
    expect(recordCommandHistoryMock).not.toHaveBeenCalled();
  });

  it("rejects multiline insertion because embedded newlines could submit early lines", async () => {
    registerTerminalPaneSession("pane-a", "session-a", { target: "local" });

    const result = await writeSnippetCommand({
      command: "pwd\nls",
      paneId: "pane-a",
    });

    expect(result).toEqual({
      paneId: "pane-a",
      reason: "multiline-unsupported",
      sent: false,
    });
    expect(writeTerminalMock).not.toHaveBeenCalled();
  });

  it("rejects a snippet intent after the pane reconnects", async () => {
    registerTerminalPaneSession("pane-a", "session-old", {
      remoteHostId: "host-a",
      target: "ssh",
    });
    const snapshot = getTerminalPaneSessionRecord("pane-a");
    registerTerminalPaneSession("pane-a", "session-new", {
      remoteHostId: "host-a",
      target: "ssh",
    });

    const result = await runSnippetCommand({
      command: "uptime",
      expectedConnectionGeneration: snapshot?.connectionGeneration,
      expectedSessionId: snapshot?.sessionId,
      expectedTargetRef:
        snapshot?.targetRef ?? snapshot?.remoteHostId ?? snapshot?.sessionId,
      paneId: "pane-a",
    });

    expect(result).toEqual({
      paneId: "pane-a",
      reason: "stale-binding",
      sent: false,
    });
    expect(writeTerminalMock).not.toHaveBeenCalled();
    expect(recordCommandHistoryMock).not.toHaveBeenCalled();
  });

  it("submits a sensitive snippet without persisting command history", async () => {
    registerTerminalPaneSession("pane-a", "session-a", { target: "local" });

    const result = await runSnippetCommand({
      command: "curl -H 'Authorization: Bearer secret-value' https://example.com",
      paneId: "pane-a",
      recordHistory: false,
    });

    expect(result.sent).toBe(true);
    expect(writeTerminalMock).toHaveBeenCalledWith(
      "session-a",
      "curl -H 'Authorization: Bearer secret-value' https://example.com\r",
    );
    expect(recordCommandHistoryMock).not.toHaveBeenCalled();
  });

  it("writes workflow commands through the generic pane writer", async () => {
    registerTerminalPaneSession("pane-a", "session-a", {
      cwd: "C:/dev/rust/kerminal",
      profileId: "profile-a",
      shell: "pwsh.exe",
      target: "local",
    });

    const result = await writeWorkflowCommand({
      command: " npm run check ",
      paneId: "pane-a",
      tabId: "tab-a",
    });

    expect(result).toEqual({
      paneId: "pane-a",
      sent: true,
      sessionId: "session-a",
      target: "local",
    });
    expect(writeTerminalMock).toHaveBeenCalledWith(
      "session-a",
      "npm run check\r",
    );
    expect(recordCommandHistoryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "npm run check",
        paneId: "pane-a",
        source: "workflow",
        tabId: "tab-a",
        target: "local",
      }),
    );
  });

  it("allows internal tools to use the generic pane writer", async () => {
    registerTerminalPaneSession("pane-a", "session-a");

    await writePaneCommand({
      command: "clear",
      paneId: "pane-a",
      source: "tool",
    });

    expect(recordCommandHistoryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "clear",
        source: "tool",
      }),
    );
  });

  it("reports missing snippet target sessions without writing", async () => {
    const result = await writeSnippetCommand({
      command: "uptime",
      paneId: "pane-missing",
    });

    expect(result).toEqual({
      paneId: "pane-missing",
      reason: "missing-session",
      sent: false,
    });
    expect(writeTerminalMock).not.toHaveBeenCalled();
    expect(recordCommandHistoryMock).not.toHaveBeenCalled();
  });
});
