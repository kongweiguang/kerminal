// @author kongweiguang

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { defaultTerminalAppearance } from "../../../../../src/features/settings/settingsModel";
import { AgentTerminalView } from "../../../../../src/features/tool-panel/agent-launcher/AgentTerminalView";

vi.mock("../../../../../src/features/terminal/XtermPane", () => ({
  XtermPane: ({ focused }: { focused: boolean }) => (
    <div data-focused={String(focused)} data-testid="agent-xterm-mock" />
  ),
}));

const session = {
  agentId: "codex" as const,
  agentSessionId: "agent-session-current",
  args: [],
  commandLabel: "codex",
  cwd: "C:/workspace",
  permissionMode: "default" as const,
  shell: "powershell.exe",
  status: "running" as const,
  tabId: "tab-1",
  title: "Codex",
};

const preview = {
  byteLength: 12,
  createdAt: "2026-07-12T05:00:00.000Z",
  expiresAt: "2099-07-12T05:01:00.000Z",
  id: "preview-current",
  kind: "selection" as const,
  redacted: false,
  sessionId: session.agentSessionId,
  text: "cargo test",
  truncated: false,
};

describe("AgentTerminalView", () => {
  it("PI 会话使用专属 PI 图标并保留 Agent 标题", () => {
    const { container } = render(
      <AgentTerminalView
        focused
        onAgentSignal={vi.fn()}
        onBack={vi.fn()}
        onCancelPreview={vi.fn()}
        onConfirmPreview={vi.fn().mockResolvedValue({ outcome: "sent" })}
        preview={null}
        previewBusy={false}
        resolvedTheme="dark"
        session={{
          ...session,
          agentId: "pi",
          commandLabel: "pi",
          title: "PI Agent",
        }}
        terminalAppearance={defaultTerminalAppearance}
      />,
    );

    expect(screen.getByText("PI Agent")).toBeVisible();
    expect(container.querySelector(".lucide-pi")).toBeInTheDocument();
  });

  it("预览覆盖内容区但不替换或压缩已挂载的终端", () => {
    const baseProps = {
      focused: true,
      onAgentSignal: vi.fn(),
      onBack: vi.fn(),
      onCancelPreview: vi.fn(),
      onConfirmPreview: vi.fn().mockResolvedValue({ outcome: "sent" }),
      previewBusy: false,
      resolvedTheme: "dark" as const,
      session,
      terminalAppearance: defaultTerminalAppearance,
    };
    const { rerender } = render(
      <AgentTerminalView {...baseProps} preview={null} />,
    );
    const terminalContent = screen.getByTestId("agent-terminal-content");
    expect(screen.getByTestId("agent-xterm-mock")).toHaveAttribute(
      "data-focused",
      "true",
    );

    rerender(<AgentTerminalView {...baseProps} preview={preview} />);

    expect(screen.getByTestId("agent-terminal-content")).toBe(terminalContent);
    expect(terminalContent).toHaveClass("flex-1");
    expect(terminalContent).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByTestId("agent-send-preview-mode")).toHaveClass(
      "absolute",
      "inset-x-0",
      "bottom-0",
      "top-10",
    );
    expect(screen.getByTestId("agent-xterm-mock")).toHaveAttribute(
      "data-focused",
      "false",
    );
    expect(screen.getByRole("heading", { name: "确认发送" })).toBeVisible();
  });
});
