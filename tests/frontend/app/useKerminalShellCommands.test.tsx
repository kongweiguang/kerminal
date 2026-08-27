// @author kongweiguang

import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useKerminalShellCommands } from "../../../src/app/useKerminalShellCommands";
import {
  defaultAppSettings,
  type AppSettings,
} from "../../../src/features/settings/settingsModel";
import type { AddTerminalTabOptions } from "../../../src/features/workspace/workspaceStore";
import type { NativeMenuAction } from "../../../src/lib/nativeMenuApi";

const nativeMenuMock = vi.hoisted(() => ({
  listener: undefined as ((action: NativeMenuAction) => void) | undefined,
}));

vi.mock("../../../src/lib/nativeMenuApi", async () => {
  const actual = await vi.importActual<
    typeof import("../../../src/lib/nativeMenuApi")
  >("../../../src/lib/nativeMenuApi");
  return {
    ...actual,
    listenNativeMenuActions: vi.fn(
      async (listener: (action: NativeMenuAction) => void) => {
        nativeMenuMock.listener = listener;
        return () => {
          if (nativeMenuMock.listener === listener) {
            nativeMenuMock.listener = undefined;
          }
        };
      },
    ),
  };
});

/** 挂载真实 command hook，只替换外部动作端口以观察键盘和菜单路由。 */
function CommandHarness({
  addTerminalTab,
  keybindings = defaultAppSettings.keybindings,
}: {
  addTerminalTab: (options?: AddTerminalTabOptions) => void;
  keybindings?: AppSettings["keybindings"];
}) {
  useKerminalShellCommands({
    activeTabId: null,
    addTerminalTab,
    closeAllTools: vi.fn(),
    closePane: vi.fn(),
    closeTerminalTab: vi.fn(),
    focusPane: vi.fn(),
    focusedPaneId: null,
    keybindings,
    openSettingsTool: vi.fn(),
    openTool: vi.fn(),
    selectTab: vi.fn(),
    splitFocusedPane: vi.fn(),
    terminalTabs: [],
    toggleTool: vi.fn(),
  });
  return null;
}

/** 从指定 DOM 目标派发可取消的真实 keydown，覆盖 window capture listener。 */
function dispatchKeydown(
  target: Element,
  options: KeyboardEventInit,
): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ...options,
  });
  target.dispatchEvent(event);
  return event;
}

describe("useKerminalShellCommands", () => {
  beforeEach(() => {
    nativeMenuMock.listener = undefined;
  });

  it("lets only the configured new-tab action pass through focused xterm", () => {
    const addTerminalTab = vi.fn(
      (_options?: AddTerminalTabOptions) => undefined,
    );
    render(<CommandHarness addTerminalTab={addTerminalTab} />);
    const xtermInput = document.createElement("textarea");
    xtermInput.className = "xterm-helper-textarea";
    document.body.append(xtermInput);

    const newTabEvent = dispatchKeydown(xtermInput, {
      ctrlKey: true,
      key: "T",
      shiftKey: true,
    });

    expect(addTerminalTab).toHaveBeenCalledWith({
      localMachineScope: "workspace",
    });
    expect(newTabEvent.defaultPrevented).toBe(true);

    addTerminalTab.mockClear();
    const shellInterruptEvent = dispatchKeydown(xtermInput, {
      ctrlKey: true,
      key: "c",
    });
    expect(addTerminalTab).not.toHaveBeenCalled();
    expect(shellInterruptEvent.defaultPrevented).toBe(false);
    xtermInput.remove();
  });

  it("follows a customized new-tab binding when deciding xterm passthrough", () => {
    const addTerminalTab = vi.fn(
      (_options?: AddTerminalTabOptions) => undefined,
    );
    const keybindings = defaultAppSettings.keybindings.map((keybinding) =>
      keybinding.action === "terminal.newTab"
        ? {
            ...keybinding,
            binding: "Ctrl+Alt+N",
            windowsBinding: "Ctrl+Alt+N",
          }
        : keybinding,
    );
    render(
      <CommandHarness
        addTerminalTab={addTerminalTab}
        keybindings={keybindings}
      />,
    );
    const xtermInput = document.createElement("textarea");
    xtermInput.className = "xterm-helper-textarea";
    document.body.append(xtermInput);

    const staleDefaultEvent = dispatchKeydown(xtermInput, {
      ctrlKey: true,
      key: "t",
      shiftKey: true,
    });
    const configuredEvent = dispatchKeydown(xtermInput, {
      altKey: true,
      ctrlKey: true,
      key: "n",
    });

    expect(addTerminalTab).toHaveBeenCalledTimes(1);
    expect(addTerminalTab).toHaveBeenCalledWith({
      localMachineScope: "workspace",
    });
    expect(staleDefaultEvent.defaultPrevented).toBe(false);
    expect(configuredEvent.defaultPrevented).toBe(true);
    xtermInput.remove();
  });

  it("handles ordinary surfaces but protects editable, composing, and repeated input", () => {
    const addTerminalTab = vi.fn(
      (_options?: AddTerminalTabOptions) => undefined,
    );
    render(<CommandHarness addTerminalTab={addTerminalTab} />);
    const surface = document.createElement("button");
    const input = document.createElement("input");
    document.body.append(surface, input);

    dispatchKeydown(surface, { ctrlKey: true, key: "t", shiftKey: true });
    dispatchKeydown(input, { ctrlKey: true, key: "t", shiftKey: true });
    dispatchKeydown(surface, {
      ctrlKey: true,
      isComposing: true,
      key: "t",
      shiftKey: true,
    });
    dispatchKeydown(surface, {
      ctrlKey: true,
      key: "t",
      repeat: true,
      shiftKey: true,
    });

    expect(addTerminalTab).toHaveBeenCalledTimes(1);
    expect(addTerminalTab).toHaveBeenCalledWith({
      localMachineScope: "workspace",
    });
    surface.remove();
    input.remove();
  });

  it("routes the native new-terminal menu through the same workspace action", async () => {
    const addTerminalTab = vi.fn(
      (_options?: AddTerminalTabOptions) => undefined,
    );
    render(<CommandHarness addTerminalTab={addTerminalTab} />);
    await waitFor(() => expect(nativeMenuMock.listener).toBeDefined());

    act(() => nativeMenuMock.listener?.("newTerminal"));

    expect(addTerminalTab).toHaveBeenCalledWith({
      localMachineScope: "workspace",
    });
  });
});
