import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SnippetToolContentV2 } from "../../../../src/features/snippets/SnippetToolContentV2";
import { requestSnippetPanelOpen } from "../../../../src/features/snippets/snippetPanelEvents";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  insert: vi.fn(),
  run: vi.fn(),
  record: vi.fn(),
  usage: vi.fn(),
  favorite: vi.fn(),
  clipboard: vi.fn(),
  clearUsage: vi.fn(),
  documents: vi.fn(),
  history: vi.fn(),
  openPath: vi.fn(),
  workspaceStatus: vi.fn(),
}));

vi.mock("../../../../src/lib/snippetApi", async (original) => ({
  ...(await original()),
  listSnippetCatalog: (...args: unknown[]) => mocks.list(...args),
  clearSnippetUsage: (...args: unknown[]) => mocks.clearUsage(...args),
  listSnippetDocuments: (...args: unknown[]) => mocks.documents(...args),
  recordSnippetUsage: (...args: unknown[]) => mocks.usage(...args),
  setSnippetFavorite: (...args: unknown[]) => mocks.favorite(...args),
}));
vi.mock("../../../../src/lib/desktopClipboardApi", () => ({
  writeDesktopClipboardText: (...args: unknown[]) => mocks.clipboard(...args),
}));
vi.mock("../../../../src/lib/commandHistoryApi", () => ({
  listCommandHistory: (...args: unknown[]) => mocks.history(...args),
}));
vi.mock("../../../../src/lib/agentLauncherApi", () => ({
  getExternalAgentWorkspaceStatus: (...args: unknown[]) =>
    mocks.workspaceStatus(...args),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({
  openPath: (...args: unknown[]) => mocks.openPath(...args),
}));
vi.mock("../../../../src/features/terminal/terminalSessionRegistry", () => ({
  getTerminalPaneSessionRecord: (...args: unknown[]) => mocks.record(...args),
  runSnippetCommand: (...args: unknown[]) => mocks.run(...args),
  writeSnippetCommand: (...args: unknown[]) => mocks.insert(...args),
}));

const item = {
  capabilities: ["curl"],
  contextBindings: [],
  category: "network",
  defaultAction: "insert" as const,
  deprecated: false,
  description: "检查响应头",
  duration: "instant" as const,
  favorite: false,
  id: "http-head",
  origin: "builtin" as const,
  pack: "core",
  platforms: ["windows"],
  risk: "inspect" as const,
  scope: "local" as const,
  sensitive: false,
  shells: ["powerShell"],
  sortOrder: 1,
  tags: ["http"],
  template: "curl -I {{ url }}",
  title: "HTTP 响应头",
  updatedAt: "2026-07-13",
  useCount: 0,
  variables: [
    {
      description: "完整 URL",
      kind: "url" as const,
      label: "URL",
      name: "url",
      renderStrategy: "shellArg" as const,
      required: true,
      sensitive: false,
      suggestions: [],
    },
  ],
};

describe("SnippetToolContentV2", () => {
  beforeEach(() => {
    mocks.list.mockReset().mockResolvedValue([item]);
    mocks.insert.mockReset().mockResolvedValue({ paneId: "pane-1", sent: true });
    mocks.run.mockReset().mockResolvedValue({ paneId: "pane-1", sent: true });
    mocks.record.mockReset().mockReturnValue({
      connectionGeneration: 7,
      sessionId: "session-1",
      shell: "pwsh.exe",
      target: "local",
    });
    mocks.usage.mockReset().mockResolvedValue(true);
    mocks.favorite.mockReset().mockResolvedValue(undefined);
    mocks.clipboard.mockReset().mockResolvedValue({ ok: true });
    mocks.clearUsage.mockReset().mockResolvedValue(2);
    mocks.documents.mockReset().mockResolvedValue({ snippets: [], warnings: [] });
    mocks.history.mockReset().mockResolvedValue([]);
    mocks.openPath.mockReset().mockResolvedValue(undefined);
    mocks.workspaceStatus.mockReset().mockResolvedValue({
      workspaceDir: "C:/Users/test/.kerminal",
      validator: {
        available: true,
        command: "kerminal.config.validate",
        detail: "ready",
        status: "ready",
      },
    });
  });

  it("searches, expands, renders parameters and inserts without running", async () => {
    render(
      <SnippetToolContentV2
        activeTabId="tab-1"
        focusedPane={{ id: "pane-1", mode: "local", title: "PowerShell" } as never}
      />,
    );
    fireEvent.click(await screen.findByText("HTTP 响应头"));
    fireEvent.change(screen.getByLabelText("URL"), {
      target: { value: "https://example.com/a b" },
    });
    expect(screen.getByText(/curl -I 'https:\/\/example.com\/a b'/)).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "片段管理" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "终端操作" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /填入终端/ }));
    await waitFor(() =>
      expect(mocks.insert).toHaveBeenCalledWith({
        command: "curl -I 'https://example.com/a b'",
        expectedConnectionGeneration: 7,
        expectedSessionId: "session-1",
        expectedTargetRef: "session-1",
        paneId: "pane-1",
        tabId: "tab-1",
      }),
    );
    expect(mocks.run).not.toHaveBeenCalled();
    expect(mocks.usage).toHaveBeenCalledWith("builtin", "http-head", "insert");
    expect(await screen.findByText("命令已填入，可继续编辑")).toBeInTheDocument();
  });

  it("copies rendered non-sensitive commands and records usage", async () => {
    render(
      <SnippetToolContentV2
        focusedPane={{ id: "pane-1", mode: "local", title: "PowerShell" } as never}
      />,
    );
    fireEvent.click(await screen.findByText("HTTP 响应头"));
    fireEvent.change(screen.getByLabelText("URL"), {
      target: { value: "https://example.com/a b" },
    });
    fireEvent.click(screen.getByRole("button", { name: "复制结果" }));

    await waitFor(() =>
      expect(mocks.clipboard).toHaveBeenCalledWith(
        "curl -I 'https://example.com/a b'",
      ),
    );
    expect(mocks.usage).toHaveBeenCalledWith(
      "builtin",
      "http-head",
      "copyRendered",
    );
    expect(await screen.findByText("渲染后的命令已复制")).toBeInTheDocument();
  });

  it("runs inspect commands without capability recognition", async () => {
    render(
      <SnippetToolContentV2
        focusedPane={{ id: "pane-1", mode: "local", title: "PowerShell" } as never}
      />,
    );
    fireEvent.click(await screen.findByText("HTTP 响应头"));
    fireEvent.change(screen.getByLabelText("URL"), {
      target: { value: "https://example.com" },
    });

    const run = screen.getByRole("button", { name: "运行" });
    expect(run).not.toHaveAttribute("aria-disabled");
    fireEvent.click(run);

    await waitFor(() =>
      expect(mocks.run).toHaveBeenCalledWith(
        expect.objectContaining({ command: "curl -I 'https://example.com'" }),
      ),
    );
    expect(
      screen.queryByRole("dialog", { name: "确认运行命令" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/尚未识别|尚未验证|环境未完全确认/)).not.toBeInTheDocument();
  });

  it("ignores platform, shell, scope and context compatibility metadata", async () => {
    mocks.list.mockResolvedValue([{
      ...item,
      capabilities: ["missing-command"],
      contextBindings: [{ kind: "host", targetId: "another-host" }],
      platforms: ["linux"],
      scope: "ssh",
      shells: ["bash"],
    }]);
    mocks.record.mockReturnValue({
      connectionGeneration: 7,
      remoteHostId: "host-a",
      sessionId: "session-ssh",
      shell: "/bin/bash",
      target: "ssh",
    });

    render(
      <SnippetToolContentV2
        focusedPane={{
          id: "pane-ssh",
          mode: "ssh",
          remoteHostId: "host-a",
          title: "Ubuntu",
        } as never}
      />,
    );
    fireEvent.click(await screen.findByText("HTTP 响应头"));
    fireEvent.change(screen.getByLabelText("URL"), {
      target: { value: "https://example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "运行" }));

    await waitFor(() => expect(mocks.run).toHaveBeenCalledTimes(1));
    expect(
      screen.queryByText(/尚未读取|尚未识别|尚未验证|不兼容|环境未完全确认/),
    ).not.toBeInTheDocument();
  });

  it("masks secret values by default, reveals only while held, and disables copy", async () => {
    const secret = "token-should-stay-hidden";
    mocks.list.mockResolvedValue([
      {
        ...item,
        capabilities: [],
        sensitive: true,
        template: "echo {{ token }}",
        variables: [
          {
            description: "临时令牌",
            kind: "secret" as const,
            label: "令牌",
            name: "token",
            renderStrategy: "shellArg" as const,
            required: true,
            sensitive: true,
            suggestions: [],
          },
        ],
      },
    ]);
    render(
      <SnippetToolContentV2
        focusedPane={{ id: "pane-1", mode: "local", title: "PowerShell" } as never}
      />,
    );
    fireEvent.click(await screen.findByText("HTTP 响应头"));
    fireEvent.change(screen.getByLabelText("令牌"), { target: { value: secret } });

    expect(screen.queryByText(new RegExp(secret))).not.toBeInTheDocument();
    expect(screen.getByText(/已隐藏/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "复制结果" })).toBeDisabled();

    const reveal = screen.getByRole("button", { name: "按住显示敏感值" });
    fireEvent.pointerDown(reveal);
    expect(screen.getByText(new RegExp(secret))).toBeInTheDocument();
    fireEvent.pointerUp(reveal);
    expect(screen.queryByText(new RegExp(secret))).not.toBeInTheDocument();
    expect(mocks.clipboard).not.toHaveBeenCalled();
  });

  it("supports insert and run keyboard shortcuts from parameter fields", async () => {
    mocks.list.mockResolvedValue([{ ...item, capabilities: [] }]);
    render(
      <SnippetToolContentV2
        focusedPane={{ id: "pane-1", mode: "local", title: "PowerShell" } as never}
      />,
    );
    fireEvent.click(await screen.findByText("HTTP 响应头"));
    const input = screen.getByLabelText("URL");
    fireEvent.change(input, { target: { value: "https://example.com" } });

    fireEvent.keyDown(input, { ctrlKey: true, key: "Enter" });
    await waitFor(() => expect(mocks.insert).toHaveBeenCalledTimes(1));
    fireEvent.keyDown(input, { ctrlKey: true, key: "Enter", shiftKey: true });
    await waitFor(() => expect(mocks.run).toHaveBeenCalledTimes(1));
  });

  it("prefills the editor from the current terminal command", async () => {
    mocks.record.mockReturnValue({
      commandBlockText: "git status --short",
      connectionGeneration: 7,
      sessionId: "session-1",
      shell: "pwsh.exe",
      target: "local",
    });
    render(
      <SnippetToolContentV2
        focusedPane={{ id: "pane-1", mode: "local", title: "PowerShell" } as never}
      />,
    );
    await screen.findByText("HTTP 响应头");
    fireEvent.click(screen.getByRole("button", { name: "新建命令片段" }));

    expect(screen.getByRole("dialog", { name: "保存当前终端命令" })).toBeInTheDocument();
    expect(screen.getByLabelText("命令模板")).toHaveValue("git status --short");
  });

  it("exposes history creation, validation and clear-recent management", async () => {
    mocks.history.mockResolvedValue([
      {
        command: "kubectl get pods -A",
        createdAt: "2026-07-13T00:00:00Z",
        id: "history-1",
        source: "user",
        target: "local",
      },
    ]);
    render(
      <SnippetToolContentV2
        focusedPane={{ id: "pane-1", mode: "local", title: "PowerShell" } as never}
      />,
    );
    await screen.findByText("HTTP 响应头");
    fireEvent.click(screen.getByRole("button", { name: "片段库管理" }));

    expect(await screen.findByText("C:/Users/test/.kerminal/snippets")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "校验配置" }));
    expect(await screen.findByText("片段配置校验通过，共 0 项")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "清除最近" }));
    fireEvent.click(screen.getByRole("button", { name: "确认清除" }));
    expect(await screen.findByText("最近使用和次数已清除，收藏保持不变")).toBeInTheDocument();
    expect(mocks.clearUsage).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "选择历史命令" }));
    fireEvent.click(await screen.findByRole("button", { name: "kubectl get pods -A" }));
    expect(screen.getByRole("dialog", { name: "从命令历史创建片段" })).toBeInTheDocument();
    expect(screen.getByLabelText("命令模板")).toHaveValue("kubectl get pods -A");
  });

  it("keeps tabs and bounded catalog query stable", async () => {
    render(<SnippetToolContentV2 />);
    await screen.findByText("HTTP 响应头");
    fireEvent.click(screen.getByRole("tab", { name: "命令库" }));
    expect(screen.getByRole("tab", { name: "命令库" })).toHaveAttribute("aria-selected", "true");
    expect(mocks.list).toHaveBeenCalledWith({ limit: 2_000 });
  });

  it("supports scoped search and list keyboard navigation", async () => {
    render(<SnippetToolContentV2 />);
    await screen.findByText("HTTP 响应头");
    const panel = screen.getByLabelText("命令片段");
    const search = screen.getByLabelText("搜索命令片段");

    fireEvent.keyDown(panel, { key: "/" });
    expect(search).toHaveFocus();
    const row = screen.getByRole("button", { name: /^HTTP 响应头/ });
    row.focus();
    fireEvent.keyDown(row, { key: "ArrowDown" });
    expect(row).toHaveFocus();
    fireEvent.click(row);
    expect(row).toHaveAttribute("aria-expanded", "true");
    fireEvent.keyDown(panel, { key: "Escape" });
    expect(row).toHaveAttribute("aria-expanded", "false");
  });

  it("confirms change commands and keeps successful submission independent from usage storage", async () => {
    mocks.list.mockResolvedValue([
      { ...item, capabilities: [], risk: "change" as const },
    ]);
    mocks.usage.mockRejectedValue(new Error("sqlite busy"));
    render(
      <SnippetToolContentV2
        activeTabId="tab-1"
        focusedPane={{ id: "pane-1", mode: "local", title: "PowerShell" } as never}
      />,
    );
    fireEvent.click(await screen.findByText("HTTP 响应头"));
    fireEvent.change(screen.getByLabelText("URL"), {
      target: { value: "https://example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "运行" }));

    expect(await screen.findByRole("dialog", { name: "确认运行命令" })).toBeInTheDocument();
    expect(mocks.run).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "确认提交" }));

    await waitFor(() => expect(mocks.run).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("命令已提交")).toBeInTheDocument();
  });

  it("requires the current target name before submitting destructive commands", async () => {
    mocks.list.mockResolvedValue([
      { ...item, capabilities: [], risk: "destructive" as const },
    ]);
    render(
      <SnippetToolContentV2
        focusedPane={{ id: "pane-1", mode: "local", title: "PowerShell" } as never}
      />,
    );
    fireEvent.click(await screen.findByText("HTTP 响应头"));
    fireEvent.change(screen.getByLabelText("URL"), {
      target: { value: "https://example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "运行" }));

    const confirm = await screen.findByRole("button", { name: "确认提交" });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/输入目标名称/), {
      target: { value: "PowerShell" },
    });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    await waitFor(() => expect(mocks.run).toHaveBeenCalledTimes(1));
  });

  it("does not retarget a command-prompt navigation request to another pane", async () => {
    requestSnippetPanelOpen({ paneId: "pane-old", snippetId: item.id });
    render(
      <SnippetToolContentV2
        focusedPane={{ id: "pane-new", mode: "local", title: "另一终端" } as never}
      />,
    );

    expect(
      await screen.findByText("命令提示对应的终端已变化，请在目标终端重新选择片段。"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^HTTP 响应头/ })).toHaveAttribute("aria-expanded", "false");
  });

  it("invalidates an expanded target after focus moves to another pane", async () => {
    mocks.list.mockResolvedValue([
      { ...item, capabilities: [], template: "echo ok", variables: [] },
    ]);
    const { rerender } = render(
      <SnippetToolContentV2
        focusedPane={{ id: "pane-1", mode: "local", title: "原终端" } as never}
      />,
    );
    fireEvent.click(await screen.findByText("HTTP 响应头"));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /填入终端/ })).toBeEnabled(),
    );

    rerender(
      <SnippetToolContentV2
        focusedPane={{ id: "pane-2", mode: "local", title: "新终端" } as never}
      />,
    );

    expect(
      await screen.findByText("终端目标已变化，请收起后重新展开片段。"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /填入终端/ })).toBeDisabled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("virtualizes catalogs above two hundred rows", async () => {
    mocks.list.mockResolvedValue(
      Array.from({ length: 2_000 }, (_, index) => ({
        ...item,
        id: `item-${index}`,
        template: `echo ${index}`,
        title: `片段 ${index}`,
        variables: [],
      })),
    );
    render(<SnippetToolContentV2 />);
    await screen.findByText("片段 0");
    fireEvent.click(screen.getByRole("tab", { name: "命令库" }));

    const list = await screen.findByTestId("snippet-catalog-virtual-list");
    expect(list).toHaveAttribute("data-virtualized", "true");
    expect(Number(list.getAttribute("data-rendered-rows"))).toBeLessThan(40);
  });

  it("reveals a deep-linked item without rendering two thousand expanded rows", async () => {
    const entries = Array.from({ length: 2_000 }, (_, index) => ({
      ...item,
      id: `item-${index}`,
      template: `echo ${index}`,
      title: `片段 ${index}`,
      variables: [],
    }));
    mocks.list.mockResolvedValue(entries);
    requestSnippetPanelOpen({ snippetId: "item-1999" });
    render(<SnippetToolContentV2 />);

    const target = await screen.findByRole("button", { name: /^片段 1999/ });
    expect(target).toHaveAttribute("aria-expanded", "true");
    expect(screen.queryByTestId("snippet-catalog-virtual-list")).not.toBeInTheDocument();
    expect(screen.queryByText("片段 0")).not.toBeInTheDocument();
  });
});
