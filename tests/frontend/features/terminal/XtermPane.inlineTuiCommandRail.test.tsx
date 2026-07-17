// @author kongweiguang

import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { defaultAppSettings } from "../../../../src/features/settings/settingsModel";
import {
  mocks,
  setTerminalBufferLines,
} from "../../support/terminal/XtermPane.testSupport.tsx";
import { XtermPane } from "../../../../src/features/terminal/XtermPane";
import { getTerminalPaneSessionRecord } from "../../../../src/features/terminal/terminalSessionRegistry";

describe("XtermPane inline TUI command rail", () => {
  it("suppresses a launch rail on the first input before Agent signals", async () => {
    render(
      <XtermPane
        focused
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
        data: "Codex starting\r\n",
        kind: "data",
        sessionId: "session-1",
      });
      terminal.onWriteParsedCallback?.();
    });
    expect(await screen.findByLabelText("折叠命令块 dz")).toBeInTheDocument();

    setTerminalBufferLines(terminal, { 3: "› 你" }, 3);
    act(() => {
      terminal.onDataCallback?.("你");
    });

    await waitFor(() => {
      expect(screen.queryByLabelText("命令块色条")).not.toBeInTheDocument();
    });
    expect(screen.getByLabelText("dz xterm 终端").parentElement).toHaveClass(
      "pl-3",
    );

    act(() => {
      terminal.onDataCallback?.("好\r");
    });
    expect(
      getTerminalPaneSessionRecord("pane-local")?.commandBlockText,
    ).toBeUndefined();

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
  });
});
