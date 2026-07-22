import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CommandSuggestionCandidate } from "../../../../src/lib/terminalSuggestionApi";
import { TerminalSuggestionMenu } from "../../../../src/features/terminal/TerminalSuggestionMenu";
import { createTerminalSuggestionMenuState } from "../../../../src/features/terminal/terminalSuggestionMenuModel";

describe("TerminalSuggestionMenu", () => {
  it("renders an ARIA listbox with selected option and candidate metadata", () => {
    renderMenu({
      candidates: [
        candidate({
          description: "查看工作区状态",
          id: "normal",
          provider: "git",
        }),
        candidate({
          description: "删除构建目录",
          id: "danger",
          metadata: { stale: true },
          provider: "history",
          sensitivity: "dangerous",
        }),
      ],
      open: true,
      selectedIndex: 1,
    });

    const listbox = screen.getByRole("listbox", { name: "终端命令候选" });
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(2);
    expect(options[1]).toHaveAttribute("aria-selected", "true");
    expect(listbox).toHaveAttribute("aria-activedescendant", options[1]?.id);
    expect(screen.getByText("查看工作区状态")).toBeInTheDocument();
    expect(screen.getByText("Git")).toBeInTheDocument();
    expect(screen.getByText("危险")).toBeInTheDocument();
    expect(screen.getByLabelText("缓存结果")).toBeInTheDocument();
    expect(options[1]).toHaveAttribute("data-dangerous", "true");
    expect(options[1]).toHaveAttribute("data-stale", "true");
  });

  it("emits move and accept intents without taking terminal focus", () => {
    const onIntent = vi.fn();
    renderMenu(
      {
        candidates: [candidate({ id: "a" }), candidate({ id: "b" })],
        open: true,
      },
      onIntent,
    );

    const options = screen.getAllByRole("option");
    fireEvent.mouseEnter(options[1]!);
    fireEvent.click(options[1]!);
    const mouseDown = new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
    });
    screen.getByRole("listbox").dispatchEvent(mouseDown);

    expect(onIntent).toHaveBeenNthCalledWith(1, { index: 1, type: "move" });
    expect(onIntent).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        candidate: expect.objectContaining({ id: "b" }),
        type: "accept",
      }),
    );
    expect(mouseDown.defaultPrevented).toBe(true);
  });

  it("inherits document theme tokens and reduced-motion class behavior", () => {
    document.documentElement.classList.add("dark");
    const { rerender } = renderMenu({
      candidates: [candidate()],
      open: true,
    });

    const listbox = screen.getByRole("listbox");
    expect(listbox).toHaveClass("kerminal-floating-enter");
    expect(listbox.className).toContain("var(--surface-overlay)");
    expect(listbox.className).toContain("var(--foreground)");
    expect(listbox).not.toHaveAttribute("data-theme");

    document.documentElement.classList.remove("dark");
    rerender(
      <TerminalSuggestionMenu
        anchor={{ height: 18, x: 12, y: 12 }}
        onIntent={vi.fn()}
        paneSize={{ height: 300, width: 500 }}
        state={createTerminalSuggestionMenuState({
          candidates: [candidate()],
          open: true,
        })}
      />,
    );
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });

  it("applies pane-local narrow and high-DPI positioning", () => {
    const rectSpy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockReturnValue({
        bottom: 220,
        height: 220,
        left: 0,
        right: 420,
        toJSON: () => ({}),
        top: 0,
        width: 420,
        x: 0,
        y: 0,
      });
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
      configurable: true,
      get: () => 420,
    });
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
      configurable: true,
      get: () => 220,
    });

    render(
      <TerminalSuggestionMenu
        anchor={{ height: 17.2, x: 230.2, y: 255.2 }}
        devicePixelRatio={2}
        onIntent={vi.fn()}
        paneSize={{ height: 300, width: 280 }}
        state={createTerminalSuggestionMenuState({
          candidates: Array.from({ length: 8 }, (_, index) =>
            candidate({ id: String(index) }),
          ),
          open: true,
        })}
      />,
    );

    const listbox = screen.getByRole("listbox");
    expect(listbox).toHaveAttribute("data-placement", "above");
    expect(listbox).toHaveStyle({
      left: "8px",
      top: "29px",
      width: "264px",
    });
    rectSpy.mockRestore();
  });
});

function renderMenu(
  stateOverrides: Partial<
    ReturnType<typeof createTerminalSuggestionMenuState>
  >,
  onIntent = vi.fn(),
) {
  return render(
    <TerminalSuggestionMenu
      anchor={{ height: 18, x: 12, y: 12 }}
      onIntent={onIntent}
      paneSize={{ height: 300, width: 500 }}
      state={createTerminalSuggestionMenuState(stateOverrides)}
    />,
  );
}

function candidate(
  overrides: Partial<CommandSuggestionCandidate> = {},
): CommandSuggestionCandidate {
  return {
    acceptBoundaries: [4],
    allowedPresentations: ["inline", "menu"],
    contextKey: "ctx",
    displayText: "git status",
    id: "candidate",
    provider: "history",
    replacementRange: { end: 3, start: 0 },
    replacementText: "git status",
    score: 0.9,
    sensitivity: "normal",
    suffix: " status",
    ...overrides,
  };
}
