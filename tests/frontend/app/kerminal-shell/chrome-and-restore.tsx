// @author kongweiguang

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { defaultAppSettings } from "../../../../src/features/settings/settingsModel";
import { KerminalShell } from "../../../../src/app/KerminalShell";
import {
  mocks,
  windowChromeMocks,
} from "./setup";

export function registerChromeAndRestoreTests() {
  it("applies the resolved theme to the document root for portal dialogs", async () => {
    render(<KerminalShell />);

    await waitFor(() => {
      expect(document.documentElement).toHaveClass("dark");
      expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    });

    fireEvent.keyDown(window, {
      altKey: true,
      ctrlKey: true,
      key: "s",
    });

    const dialog = await screen.findByRole("dialog", { name: "设置" });
    expect(dialog.closest(".dark")).toBe(document.documentElement);
  });

  it("opens keybinding settings from the Find Action style shortcut", async () => {
    render(<KerminalShell />);

    await waitFor(() => {
      expect(mocks.settingsApi.getSettings).toHaveBeenCalled();
    });

    fireEvent.keyDown(window, {
      ctrlKey: true,
      key: "a",
      shiftKey: true,
    });

    expect(await screen.findByText("查看快捷键与动作")).toBeInTheDocument();
    expect(
      screen.getByLabelText("查看快捷键与动作 Windows 快捷键"),
    ).toHaveValue("Ctrl+Shift+A");
  });

  it("keeps the expanded left title strip available for native window dragging", () => {
    const { container } = render(<KerminalShell />);

    const dragRegions = [
      ...container.querySelectorAll("[data-tauri-drag-region]"),
    ];
    const leftTitleStrip = dragRegions.find((element) => {
      const className = element.getAttribute("class") ?? "";
      return className.includes("col-[1/2]") && className.includes("row-[1/2]");
    });
    const rightTitleStrip = dragRegions.find((element) => {
      const className = element.getAttribute("class") ?? "";
      return className.includes("col-[2/6]") && className.includes("row-[1/2]");
    });

    expect(leftTitleStrip).toBeInTheDocument();
    expect(leftTitleStrip).not.toHaveClass("border-r");
    expect(rightTitleStrip).toBeInTheDocument();
    expect(rightTitleStrip).not.toHaveClass("border-r");
  });

  it("publishes the resolved desktop platform and window frame on the shell root", () => {
    windowChromeMocks.platform = "linux";
    windowChromeMocks.frameState = "maximized";

    const { container } = render(<KerminalShell />);
    const shell = container.firstElementChild;

    expect(shell).toHaveAttribute("data-desktop-platform", "linux");
    expect(shell).toHaveAttribute("data-window-frame", "maximized");
    expect(shell).not.toHaveAttribute("data-window-controls-platform");
    expect(document.documentElement).toHaveAttribute(
      "data-desktop-platform",
      "linux",
    );
    expect(document.documentElement).toHaveAttribute(
      "data-window-frame",
      "maximized",
    );
  });

  it("leaves shell drag-region double-click handling to the Tauri runtime", () => {
    windowChromeMocks.platform = "windows";
    const { container } = render(<KerminalShell />);
    const dragRegion = [
      ...container.querySelectorAll("[data-tauri-drag-region]"),
    ].find((element) =>
      (element.getAttribute("class") ?? "").includes("col-[1/2]"),
    );

    expect(dragRegion).toBeInTheDocument();
    expect(dragRegion).toHaveAttribute("data-tauri-drag-region");
    fireEvent.doubleClick(dragRegion!);
  });

  it("keeps the overlaid title bar transparent so terminal tabs stay framed", () => {
    render(<KerminalShell />);

    const titleBar = screen.getByRole("banner");

    expect(titleBar).toHaveClass("z-[var(--layer-chrome)]");
    expect(titleBar).not.toHaveClass("kerminal-material-nav");
    expect(titleBar).not.toHaveClass("border-b");
    expect(screen.getByLabelText("终端标签栏").parentElement).toHaveClass(
      "kerminal-material-nav",
    );
  });

  it("keeps the terminal navigation width independent from the right tool panel", async () => {
    const user = userEvent.setup();
    const { container } = render(<KerminalShell />);

    const workspace = await screen.findByRole("main", { name: "终端工作区" });
    const shell = container.firstElementChild as HTMLElement;
    expect(shell).toHaveStyle({
      gridTemplateRows: "36px minmax(0, 1fr)",
    });
    expect(workspace.parentElement).toHaveStyle({ gridColumn: "3 / 6" });

    const content = container.querySelector(
      "[data-terminal-workspace-content]",
    ) as HTMLElement;
    expect(content).toHaveStyle({ marginRight: "44px" });

    await user.click(
      screen.getByRole("button", { name: "打开 命令历史" }),
    );

    expect(
      screen.getByRole("complementary", { name: "工具面板" }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(workspace.parentElement).toHaveStyle({ gridColumn: "3 / 6" });
    expect(screen.getByLabelText("终端标签栏").parentElement).not.toHaveStyle({
      marginRight: "340px",
    });
    await waitFor(() => {
      const expandedContent = container.querySelector(
        "[data-terminal-workspace-content]",
      ) as HTMLElement;
      expect(expandedContent).toHaveStyle({ marginRight: "340px" });
    });
  });

  it("allows the right tool panel to expand to the wider resize limit", async () => {
    const user = userEvent.setup();
    const { container } = render(<KerminalShell />);

    await user.click(
      screen.getByRole("button", { name: "打开 命令历史" }),
    );

    const rightSeparator = screen.getByRole("separator", {
      name: "调整工具面板宽度",
    });
    for (let index = 0; index < 12; index += 1) {
      fireEvent.keyDown(rightSeparator, { key: "ArrowLeft", shiftKey: true });
    }

    const shell = container.firstElementChild as HTMLElement;
    expect(shell.style.gridTemplateColumns).toContain("720px");
  });

  it("matches the expanded left sidebar resize column to the shell glass surface", () => {
    render(<KerminalShell />);

    const leftSeparator = screen.getByRole("separator", {
      name: "调整主机侧边栏宽度",
    });

    expect(leftSeparator).toHaveClass("kerminal-shell-separator");
    expect(leftSeparator).not.toHaveClass("kerminal-material-nav");
    expect(leftSeparator).not.toHaveClass("kerminal-terminal-surface");
  });

  it("removes the whole left sidebar when collapsed from the title bar", async () => {
    const user = userEvent.setup();
    const { container } = render(<KerminalShell />);

    expect(
      await screen.findByRole("complementary", { name: "主机侧边栏" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "折叠主机侧边栏" }));

    const shell = container.firstElementChild as HTMLElement;
    expect(
      screen.queryByRole("complementary", { name: "主机侧边栏" }),
    ).not.toBeInTheDocument();
    expect(shell.style.gridTemplateColumns).toMatch(/^0px 0px /);
    expect(screen.getByLabelText("终端标签栏").parentElement).toHaveStyle({
      paddingLeft: "48px",
    });
  });

  it("applies appearance language and workspace background settings", async () => {
    mocks.settingsApi.getSettings.mockResolvedValue({
      ...defaultAppSettings,
      appearance: {
        ...defaultAppSettings.appearance,
        backgroundEnabled: true,
        backgroundFit: "tile",
        backgroundImagePath: "C:\\Users\\dev\\Pictures\\bg.png",
        backgroundOpacity: 64,
        interfaceLanguage: "enUS",
        windowOpacity: 72,
      },
      themeMode: "light",
    });

    const { container } = render(<KerminalShell />);
    const frame = container.firstElementChild as HTMLElement;

    await waitFor(() => {
      expect(frame).toHaveAttribute("data-language", "enUS");
      expect(document.documentElement).not.toHaveClass("dark");
      expect(document.documentElement).toHaveAttribute("data-theme", "light");
      expect(document.documentElement).toHaveAttribute("data-language", "enUS");
    });
    expect(frame).toHaveAttribute("lang", "en-US");
    expect(frame.style.backgroundImage).toContain("linear-gradient");
    expect(frame.style.backgroundImage).toContain("radial-gradient");
    expect(frame.style.backgroundColor).toBe("rgba(245, 245, 247, 0.72)");
    expect(frame.style.getPropertyValue("--app-background-veil-opacity")).toBe(
      "0.532",
    );
    expect(frame.style.backgroundImage).toContain(
      "var(--app-background-veil-opacity)",
    );
    expect(frame.style.getPropertyValue("--app-window-opacity")).toBe("0.72");
    expect(frame.style.getPropertyValue("--app-nav-surface-opacity")).toBe(
      "0.7336",
    );
    expect(
      frame.style.getPropertyValue("--app-workspace-surface-opacity"),
    ).toBe("0.7336");
    expect(frame.style.getPropertyValue("--app-terminal-header-opacity")).toBe(
      "0.7452",
    );
    expect(frame.style.getPropertyValue("--app-terminal-surface-opacity")).toBe(
      "0.6952",
    );
    expect(frame.style.backgroundImage).toContain(
      "file:///C:/Users/dev/Pictures/bg.png",
    );
    expect(frame.style.backgroundRepeat).toBe("repeat");
    expect(frame.style.backgroundSize).toBe("auto");
  });

  it("restores saved terminal tabs from the previous workspace session", async () => {
    mocks.workspaceSessionApi.loadWorkspaceSessionFile.mockResolvedValue({
      activeTabId: "tab-local-3",
      focusedPaneId: "pane-local-3",
      selectedMachineId: "machine-local-3",
      terminalPanes: [
        {
          args: ["-NoLogo"],
          cwd: "C:\\\\dev\\\\kerminal",
          env: { TERM: "xterm-256color" },
          id: "pane-local-3",
          lines: ["old output"],
          machineId: "machine-local-3",
          mode: "local",
          prompt: "PS>",
          shell: "pwsh.exe",
          status: "online",
          title: "恢复会话",
        },
      ],
      terminalTabs: [
        {
          id: "tab-local-3",
          layout: { type: "pane", paneId: "pane-local-3" },
          machineId: "machine-local-3",
          title: "恢复会话",
        },
      ],
    });

    render(<KerminalShell />);

    expect(
      await screen.findByRole("button", { name: "恢复会话" }),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(mocks.terminalApi.createTerminalSession).toHaveBeenCalledWith(
        {
          args: ["-NoLogo"],
          cols: 80,
          cwd: "C:\\\\dev\\\\kerminal",
          env: { TERM: "xterm-256color" },
          rows: 24,
          shell: "pwsh.exe",
        },
        expect.any(Function),
      );
    });
  });

  it("restores saved workspace file tabs into the central tab surface", async () => {
    mocks.workspaceSessionApi.loadWorkspaceSessionFile.mockResolvedValue({
      activeTabId: "tab-file-1",
      focusedPaneId: "",
      selectedMachineId: "",
      terminalPanes: [],
      terminalTabs: [
        {
          access: "readonly",
          id: "tab-file-1",
          kind: "workspaceFile",
          machineId: "db980b17-2ed0-44e5-b72a-6ecadf788439",
          path: "/opt/app/docker-compose.yml",
          source: "composeYaml",
          target: {
            hostId: "db980b17-2ed0-44e5-b72a-6ecadf788439",
            kind: "ssh",
          },
          title: "docker-compose.yml",
        },
      ],
    });

    render(<KerminalShell />);

    expect(
      await screen.findByRole("button", { name: "docker-compose.yml" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByLabelText("Compose YAML Monaco editor"),
    ).toHaveValue("name: kerminal\n");
    expect(
      mocks.remoteWorkspaceEditorTransport.readRemoteWorkspaceTextFile,
    ).toHaveBeenCalledWith({
      maxBytes: 10 * 1024 * 1024,
      path: "/opt/app/docker-compose.yml",
      target: {
        hostId: "db980b17-2ed0-44e5-b72a-6ecadf788439",
        kind: "ssh",
      },
    });
    expect(mocks.terminalApi.createTerminalSession).not.toHaveBeenCalled();
    expect(mocks.terminalApi.createSshTerminalSession).not.toHaveBeenCalled();
  });

  it("saves edits from a restored central workspace file tab", async () => {
    const user = userEvent.setup();
    mocks.remoteWorkspaceEditorTransport.readRemoteWorkspaceTextFile.mockResolvedValue(
      {
        binary: false,
        bytesRead: 10,
        content: "port=8080\n",
        encoding: "utf-8",
        hostId: "db980b17-2ed0-44e5-b72a-6ecadf788439",
        lineEnding: "lf",
        maxBytes: 10 * 1024 * 1024,
        path: "/etc/app.conf",
        readonly: false,
        revision: { contentSha256: "sha-a", size: 10 },
        truncated: false,
      },
    );
    mocks.remoteWorkspaceEditorTransport.writeRemoteWorkspaceTextFile.mockResolvedValue(
      {
        bytesWritten: 11,
        encoding: "utf-8",
        hostId: "db980b17-2ed0-44e5-b72a-6ecadf788439",
        lineEnding: "lf",
        path: "/etc/app.conf",
        revision: { contentSha256: "sha-b", size: 11 },
      },
    );
    mocks.workspaceSessionApi.loadWorkspaceSessionFile.mockResolvedValue({
      activeTabId: "tab-file-editable",
      focusedPaneId: "",
      selectedMachineId: "",
      terminalPanes: [],
      terminalTabs: [
        {
          access: "editable",
          id: "tab-file-editable",
          kind: "workspaceFile",
          machineId: "db980b17-2ed0-44e5-b72a-6ecadf788439",
          path: "/etc/app.conf",
          source: "sftp",
          target: {
            hostId: "db980b17-2ed0-44e5-b72a-6ecadf788439",
            kind: "ssh",
          },
          title: "app.conf",
        },
      ],
    });

    render(<KerminalShell />);

    const editor = await screen.findByLabelText("Compose YAML Monaco editor");
    expect(editor).toHaveValue("port=8080\n");

    await user.clear(editor);
    await user.type(editor, "port=9090\n");
    await user.click(screen.getByRole("button", { name: "保存文件" }));

    await waitFor(() => {
      expect(
        mocks.remoteWorkspaceEditorTransport.writeRemoteWorkspaceTextFile,
      ).toHaveBeenCalledWith({
        content: "port=9090\n",
        expectedRevision: { contentSha256: "sha-a", size: 10 },
        overwriteOnConflict: false,
        path: "/etc/app.conf",
        target: {
          hostId: "db980b17-2ed0-44e5-b72a-6ecadf788439",
          kind: "ssh",
        },
      });
    });
  });

  it("guards dirty workspace file tabs when the native close tab command runs", async () => {
    const user = userEvent.setup();
    let nativeMenuHandler: ((action: "closeTab") => void) | undefined;
    mocks.nativeMenuApi.listenNativeMenuActions.mockImplementation(
      async (handler: (action: "closeTab") => void) => {
        nativeMenuHandler = handler;
        return () => undefined;
      },
    );
    mocks.remoteWorkspaceEditorTransport.readRemoteWorkspaceTextFile.mockResolvedValue(
      {
        binary: false,
        bytesRead: 10,
        content: "port=8080\n",
        encoding: "utf-8",
        hostId: "db980b17-2ed0-44e5-b72a-6ecadf788439",
        lineEnding: "lf",
        maxBytes: 10 * 1024 * 1024,
        path: "/etc/app.conf",
        readonly: false,
        revision: { contentSha256: "sha-a", size: 10 },
        truncated: false,
      },
    );
    mocks.workspaceSessionApi.loadWorkspaceSessionFile.mockResolvedValue({
      activeTabId: "tab-file-editable",
      focusedPaneId: "",
      selectedMachineId: "",
      terminalPanes: [],
      terminalTabs: [
        {
          access: "editable",
          id: "tab-file-editable",
          kind: "workspaceFile",
          machineId: "db980b17-2ed0-44e5-b72a-6ecadf788439",
          path: "/etc/app.conf",
          source: "sftp",
          target: {
            hostId: "db980b17-2ed0-44e5-b72a-6ecadf788439",
            kind: "ssh",
          },
          title: "app.conf",
        },
      ],
    });

    render(<KerminalShell />);

    const editor = await screen.findByLabelText("Compose YAML Monaco editor");
    await user.clear(editor);
    await user.type(editor, "port=9090\n");
    await act(async () => {
      nativeMenuHandler?.("closeTab");
    });

    expect(
      screen.getByRole("dialog", { name: "关闭未保存文件" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "app.conf" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "放弃修改并关闭" }));

    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: "app.conf" }),
      ).not.toBeInTheDocument();
    });
  });

  it("restores saved left sidebar layout from the previous workspace session", async () => {
    mocks.workspaceSessionApi.loadWorkspaceSessionFile.mockResolvedValue({
      activeTabId: "",
      focusedPaneId: "",
      removedSidebarMachineIds: [],
      selectedMachineId: "",
      shellLayout: {
        collapsedMachineGroupIds: ["30fbc381-2884-4b75-9f88-0e28f31ca8b0"],
        leftPanelCollapsed: false,
        leftPanelWidth: 312,
        toolPanelWidth: 444,
      },
      sidebarMachines: [],
      terminalPanes: [],
      terminalTabGroupPreferences: {},
      terminalTabs: [],
    });

    const { container } = render(<KerminalShell />);
    const shell = container.firstElementChild as HTMLElement;

    await waitFor(() => {
      expect(shell).toHaveStyle({
        gridTemplateColumns: "312px 0px minmax(0, 1fr) 0px 44px",
      });
    });
    const groupButton = await screen.findByRole("button", { name: /bwy/ });
    expect(groupButton).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByRole("button", { name: /172\.16\.41\.60/ }),
    ).not.toBeInTheDocument();

    fireEvent(window, new Event("pagehide"));

    await waitFor(() => {
      expect(
        mocks.workspaceSessionApi.saveWorkspaceSessionFile,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          shellLayout: {
            collapsedMachineGroupIds: ["30fbc381-2884-4b75-9f88-0e28f31ca8b0"],
            leftPanelCollapsed: false,
            leftPanelWidth: 312,
            toolPanelWidth: 444,
          },
        }),
      );
    });
  });

  it("keeps restored terminal tabs mounted when switching tabs", async () => {
    const user = userEvent.setup();
    mocks.workspaceSessionApi.loadWorkspaceSessionFile.mockResolvedValue({
      activeTabId: "tab-local-1",
      focusedPaneId: "pane-local-1",
      selectedMachineId: "machine-local-1",
      terminalPanes: [
        {
          id: "pane-local-1",
          lines: [],
          machineId: "machine-local-1",
          mode: "local",
          outputHistory: "first history\r\n",
          prompt: "PS>",
          shell: "pwsh.exe",
          status: "online",
          title: "第一恢复会话",
        },
        {
          id: "pane-local-2",
          lines: [],
          machineId: "machine-local-2",
          mode: "local",
          outputHistory: "second history\r\n",
          prompt: "PS>",
          shell: "pwsh.exe",
          status: "online",
          title: "第二恢复会话",
        },
      ],
      terminalTabs: [
        {
          id: "tab-local-1",
          layout: { type: "pane", paneId: "pane-local-1" },
          machineId: "machine-local-1",
          title: "第一恢复会话",
        },
        {
          id: "tab-local-2",
          layout: { type: "pane", paneId: "pane-local-2" },
          machineId: "machine-local-2",
          title: "第二恢复会话",
        },
      ],
    });

    render(<KerminalShell />);

    await waitFor(() => {
      expect(mocks.terminalApi.createTerminalSession).toHaveBeenCalledTimes(2);
    });
    const createCount =
      mocks.terminalApi.createTerminalSession.mock.calls.length;
    const closeCount = mocks.terminalApi.closeTerminal.mock.calls.length;

    await user.click(screen.getByRole("button", { name: "第二恢复会话" }));
    await user.click(screen.getByRole("button", { name: "第一恢复会话" }));

    expect(mocks.terminalApi.createTerminalSession).toHaveBeenCalledTimes(
      createCount,
    );
    expect(mocks.terminalApi.closeTerminal).toHaveBeenCalledTimes(closeCount);
  });

}
