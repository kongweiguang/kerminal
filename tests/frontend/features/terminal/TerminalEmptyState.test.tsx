/**
 * @author kongweiguang
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TerminalEmptyState } from "../../../../src/features/terminal/TerminalEmptyState";

describe("TerminalEmptyState", () => {
  it("keeps the brand placeholder quiet when no actions are available", () => {
    render(<TerminalEmptyState />);

    expect(screen.getByRole("img", { name: "Kerminal" })).toBeInTheDocument();
    expect(
      screen.getByText("光标还没闪，AI 已经开始脑补命令了。"),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("空终端工作区操作")).not.toBeInTheDocument();
  });

  it("keeps workspace actions hidden even when handlers are available", () => {
    const onCreateTerminal = vi.fn();
    const onOpenConnection = vi.fn();
    const onOpenAgentTool = vi.fn();

    render(
      <TerminalEmptyState
        onCreateTerminal={onCreateTerminal}
        onOpenAgentTool={onOpenAgentTool}
        onOpenConnection={onOpenConnection}
      />,
    );

    expect(screen.queryByLabelText("空终端工作区操作")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "本地终端" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "添加连接" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "打开 Agent 面板" }),
    ).not.toBeInTheDocument();

    expect(onCreateTerminal).not.toHaveBeenCalled();
    expect(onOpenConnection).not.toHaveBeenCalled();
    expect(onOpenAgentTool).not.toHaveBeenCalled();
  });

  it("uses the terminal glass surface when a shell background is visible", () => {
    const { container } = render(<TerminalEmptyState backgroundImageVisible />);

    expect(container.firstElementChild).toHaveClass(
      "kerminal-terminal-surface",
    );
    expect(container.firstElementChild).not.toHaveClass(
      "kerminal-solid-surface",
    );
  });
});
