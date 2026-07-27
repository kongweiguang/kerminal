// @author kongweiguang

import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CommandHistoryEntry } from "../../../../src/lib/commandHistoryApi";
import type { TerminalPane } from "../../../../src/features/workspace/types";
import { LogToolContent } from "../../../../src/features/logs/LogToolContent";

const commandHistoryApiMocks = vi.hoisted(() => ({
  clearCommandHistory: vi.fn(),
  deleteCommandHistory: vi.fn(),
  listCommandHistory: vi.fn(),
}));

vi.mock("../../../../src/lib/commandHistoryApi", () => ({
  clearCommandHistory: (...args: unknown[]) =>
    commandHistoryApiMocks.clearCommandHistory(...args),
  deleteCommandHistory: (...args: unknown[]) =>
    commandHistoryApiMocks.deleteCommandHistory(...args),
  listCommandHistory: (...args: unknown[]) =>
    commandHistoryApiMocks.listCommandHistory(...args),
}));

const sshPane: TerminalPane = {
  id: "pane-ssh-1",
  lines: [],
  machineId: "ubuntu-dev",
  mode: "ssh",
  prompt: "deploy@dev:~$",
  remoteHostId: "ubuntu-dev",
  status: "online",
  title: "ubuntu-dev",
};

const stageSshPane: TerminalPane = {
  ...sshPane,
  id: "pane-ssh-2",
  machineId: "ubuntu-stage",
  remoteHostId: "ubuntu-stage",
  title: "ubuntu-stage",
};

const telnetPane: TerminalPane = {
  ...sshPane,
  id: "pane-telnet-1",
  machineId: "legacy-router",
  mode: "telnet",
  remoteHostId: "legacy-router",
  title: "legacy-router",
};

const serialPane: TerminalPane = {
  ...sshPane,
  id: "pane-serial-1",
  machineId: "serial-com3",
  mode: "serial",
  remoteHostId: undefined,
  title: "COM3",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, reject, resolve };
}

function historyEntry(
  command: string,
  pane: TerminalPane,
): CommandHistoryEntry {
  return {
    command,
    createdAt: "1",
    id: `history-${pane.id}`,
    paneId: pane.id,
    remoteHostId: pane.remoteHostId,
    source: "user",
    target: "ssh",
  };
}

describe("LogToolContent", () => {
  beforeEach(() => {
    commandHistoryApiMocks.clearCommandHistory.mockReset();
    commandHistoryApiMocks.clearCommandHistory.mockResolvedValue(0);
    commandHistoryApiMocks.deleteCommandHistory.mockReset();
    commandHistoryApiMocks.listCommandHistory.mockReset();
    commandHistoryApiMocks.listCommandHistory.mockResolvedValue([]);
  });

  it("loads command history for the focused SSH pane", async () => {
    render(<LogToolContent focusedPane={sshPane} />);

    await waitFor(() =>
      expect(commandHistoryApiMocks.listCommandHistory).toHaveBeenCalledWith({
        limit: 100,
        paneId: "pane-ssh-1",
        remoteHostId: "ubuntu-dev",
        source: undefined,
        target: "ssh",
        query: undefined,
      }),
    );
  });

  it("does not fall back to global history without a focused pane", async () => {
    render(<LogToolContent />);

    await screen.findByText("未聚焦终端");
    expect(
      screen.getByRole("button", { name: "刷新命令历史" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "清空命令历史" }),
    ).toBeDisabled();
    expect(commandHistoryApiMocks.listCommandHistory).not.toHaveBeenCalled();
  });

  it.each([
    [telnetPane, "telnet", "legacy-router"],
    [serialPane, "serial", "serial-com3"],
  ] as const)(
    "binds %s history to its real terminal target",
    async (pane, target, remoteHostId) => {
      render(<LogToolContent focusedPane={pane} />);

      await waitFor(() =>
        expect(commandHistoryApiMocks.listCommandHistory).toHaveBeenCalledWith(
          expect.objectContaining({
            paneId: pane.id,
            remoteHostId,
            target,
          }),
        ),
      );
    },
  );

  it("clears only the focused pane history", async () => {
    const user = userEvent.setup();
    commandHistoryApiMocks.listCommandHistory.mockResolvedValue([
      historyEntry("echo scoped", sshPane),
    ]);
    commandHistoryApiMocks.clearCommandHistory.mockResolvedValue(1);
    render(<LogToolContent focusedPane={sshPane} />);

    await user.click(
      await screen.findByRole("button", { name: "清空命令历史" }),
    );

    expect(commandHistoryApiMocks.clearCommandHistory).toHaveBeenCalledWith({
      paneId: "pane-ssh-1",
      remoteHostId: "ubuntu-dev",
      target: "ssh",
    });
  });

  it("shows a compact command-only history list", async () => {
    commandHistoryApiMocks.listCommandHistory.mockResolvedValue([
      historyEntry("echo compact", sshPane),
    ]);
    render(<LogToolContent focusedPane={sshPane} />);

    expect(await screen.findByText("最近命令")).toBeInTheDocument();
    expect(screen.getByText("echo compact")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("搜索命令")).toBeInTheDocument();
    expect(screen.queryByText("应用日志")).not.toBeInTheDocument();
    expect(screen.queryByText("类型")).not.toBeInTheDocument();
  });

  it("does not read while inactive and reloads the current pane when reopened", async () => {
    const { rerender } = render(
      <LogToolContent active={false} focusedPane={sshPane} />,
    );

    await act(async () => undefined);
    expect(commandHistoryApiMocks.listCommandHistory).not.toHaveBeenCalled();

    rerender(<LogToolContent active focusedPane={stageSshPane} />);

    await waitFor(() =>
      expect(commandHistoryApiMocks.listCommandHistory).toHaveBeenCalledWith(
        expect.objectContaining({
          paneId: "pane-ssh-2",
          remoteHostId: "ubuntu-stage",
        }),
      ),
    );
  });

  it("keeps the fast current pane history when the previous pane resolves later", async () => {
    const slowDev = deferred<CommandHistoryEntry[]>();
    const fastStage = deferred<CommandHistoryEntry[]>();
    commandHistoryApiMocks.listCommandHistory
      .mockReturnValueOnce(slowDev.promise)
      .mockReturnValueOnce(fastStage.promise);

    const { rerender } = render(
      <LogToolContent active focusedPane={sshPane} />,
    );
    await waitFor(() =>
      expect(commandHistoryApiMocks.listCommandHistory).toHaveBeenCalledTimes(
        1,
      ),
    );

    rerender(<LogToolContent active focusedPane={stageSshPane} />);
    await waitFor(() =>
      expect(commandHistoryApiMocks.listCommandHistory).toHaveBeenCalledTimes(
        2,
      ),
    );

    await act(async () => {
      fastStage.resolve([historyEntry("echo stage", stageSshPane)]);
      await fastStage.promise;
    });
    expect(await screen.findByText("echo stage")).toBeInTheDocument();

    await act(async () => {
      slowDev.resolve([historyEntry("echo dev", sshPane)]);
      await slowDev.promise;
    });
    expect(screen.getByText("echo stage")).toBeInTheDocument();
    expect(screen.queryByText("echo dev")).not.toBeInTheDocument();
  });
});
