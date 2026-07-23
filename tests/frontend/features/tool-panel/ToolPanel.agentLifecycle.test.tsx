// @author kongweiguang
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { tools } from "../../../../src/features/workspace/workspaceData";
import { ToolPanel } from "../../../../src/features/tool-panel/ToolPanel";

const toolLifecycle = vi.hoisted(() => ({
  agent: { mounts: 0, unmounts: 0 },
  logs: { mounts: 0, unmounts: 0 },
}));

vi.mock(
  "../../../../src/features/tool-panel/AgentLauncherToolContent",
  async () => {
    const { createElement, useEffect } = await import("react");
    return {
      AgentLauncherToolContent: () => {
        useEffect(() => {
          toolLifecycle.agent.mounts += 1;
          return () => {
            toolLifecycle.agent.unmounts += 1;
          };
        }, []);
        return createElement("div", {
          "data-testid": "agent-launcher-live-session",
        });
      },
    };
  },
);

vi.mock("../../../../src/features/logs", async () => {
  const { createElement, useEffect } = await import("react");
  return {
    LogToolContent: () => {
      useEffect(() => {
        toolLifecycle.logs.mounts += 1;
        return () => {
          toolLifecycle.logs.unmounts += 1;
        };
      }, []);
      return createElement("div", {
        "data-testid": "logs-live-tool",
      });
    },
  };
});

describe("ToolPanel drawer lifecycle", () => {
  beforeEach(() => {
    toolLifecycle.agent.mounts = 0;
    toolLifecycle.agent.unmounts = 0;
    toolLifecycle.logs.mounts = 0;
    toolLifecycle.logs.unmounts = 0;
  });

  it("keeps an opened Agent session mounted when the right drawer is collapsed", async () => {
    const { rerender, unmount } = render(
      <ToolPanel
        activeTool="agentLauncher"
        onActiveToolChange={vi.fn()}
        tools={tools}
      />,
    );

    expect(
      await screen.findByTestId("agent-launcher-live-session"),
    ).toBeInTheDocument();
    expect(toolLifecycle.agent.mounts).toBe(1);

    rerender(
      <ToolPanel activeTool={null} onActiveToolChange={vi.fn()} tools={tools} />,
    );

    expect(
      screen.getByTestId("agent-launcher-live-session"),
    ).toBeInTheDocument();
    expect(toolLifecycle.agent.unmounts).toBe(0);
    expect(toolLifecycle.logs.mounts).toBe(0);

    unmount();
    expect(toolLifecycle.agent.unmounts).toBe(1);
  });

  it("keeps every opened right-panel tool mounted when the drawer is collapsed", async () => {
    const { rerender, unmount } = render(
      <ToolPanel activeTool="logs" onActiveToolChange={vi.fn()} tools={tools} />,
    );

    expect(await screen.findByTestId("logs-live-tool")).toBeInTheDocument();
    expect(toolLifecycle.logs.mounts).toBe(1);

    rerender(
      <ToolPanel activeTool={null} onActiveToolChange={vi.fn()} tools={tools} />,
    );

    expect(screen.getByTestId("logs-live-tool")).toBeInTheDocument();
    expect(toolLifecycle.logs.unmounts).toBe(0);
    expect(toolLifecycle.agent.mounts).toBe(0);

    unmount();
    expect(toolLifecycle.logs.unmounts).toBe(1);
  });
});
