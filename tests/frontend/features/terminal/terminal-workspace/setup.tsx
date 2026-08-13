// @author kongweiguang

import { type ReactNode } from "react";
import { vi } from "vitest";
import { terminalChromeRuntimeStore } from "../../../../../src/features/terminal/terminalChromeRuntimeStore";

const hoistedXtermPaneMockState = vi.hoisted(() => ({
  mountedPaneIds: [] as string[],
  renderCount: 0,
  shouldThrow: false,
  unmountedPaneIds: [] as string[],
  visibleByPaneId: new Map<string, boolean>(),
}));
export const xtermPaneMockState = hoistedXtermPaneMockState;

const hoistedResizableMockState = vi.hoisted(() => ({
  groups: [] as Array<{
    defaultLayout?: Record<string, number>;
    id?: string;
    onLayoutChanged?: (layout: Record<string, number>) => void;
  }>,
}));
export const resizableMockState = hoistedResizableMockState;

const hoistedDesktopClipboardMocks = vi.hoisted(() => ({
  writeDesktopClipboardText: vi.fn(),
}));
export const desktopClipboardMocks = hoistedDesktopClipboardMocks;

export function mockTabListMetrics({
  clientWidth,
  scrollWidth,
}: {
  clientWidth: number;
  scrollWidth: number;
}) {
  const clientWidthSpy = vi
    .spyOn(HTMLElement.prototype, "clientWidth", "get")
    .mockImplementation(function (this: HTMLElement) {
      return this.getAttribute("aria-label") === "终端标签栏" ? clientWidth : 0;
    });
  const scrollWidthSpy = vi
    .spyOn(HTMLElement.prototype, "scrollWidth", "get")
    .mockImplementation(function (this: HTMLElement) {
      return this.getAttribute("aria-label") === "终端标签栏" ? scrollWidth : 0;
    });

  return () => {
    clientWidthSpy.mockRestore();
    scrollWidthSpy.mockRestore();
  };
}

vi.mock("../../../../../src/features/terminal/XtermPane", async () => {
  const React = await vi.importActual<typeof import("react")>("react");

  return {
    XtermPane: ({
      onConnectionStateChange,
      onOpenLogs,
      onSplitPane,
      paneId,
      title,
      visible = true,
    }: {
      onConnectionStateChange?: (state: "closed") => void;
      onOpenLogs?: () => void;
      onSplitPane?: (direction: "horizontal" | "vertical") => void;
      paneId: string;
      title: string;
      visible?: boolean;
    }) => {
      xtermPaneMockState.renderCount += 1;
      xtermPaneMockState.visibleByPaneId.set(paneId, visible);
      React.useEffect(() => {
        xtermPaneMockState.mountedPaneIds.push(paneId);
        return () => {
          xtermPaneMockState.unmountedPaneIds.push(paneId);
        };
      }, [paneId]);
      if (xtermPaneMockState.shouldThrow) {
        throw new Error("xterm render exploded");
      }

      return (
        <div aria-label={`${title} xterm 终端`}>
          本地终端测试替身
          <button onClick={onOpenLogs} type="button">
            测试打开日志
          </button>
          <button onClick={() => onSplitPane?.("horizontal")} type="button">
            测试左右分屏
          </button>
          <button
            onClick={() => onConnectionStateChange?.("closed")}
            type="button"
          >
            测试关闭状态
          </button>
        </div>
      );
    },
  };
});

vi.mock("../../../../../src/components/ui/resizable", () => ({
  ResizableHandle: ({ "aria-label": ariaLabel }: { "aria-label"?: string }) => (
    <div aria-label={ariaLabel} role="separator" />
  ),
  ResizablePanel: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  ResizablePanelGroup: ({
    children,
    defaultLayout,
    id,
    onLayoutChanged,
  }: {
    children: ReactNode;
    defaultLayout?: Record<string, number>;
    id?: string;
    onLayoutChanged?: (layout: Record<string, number>) => void;
  }) => (
    resizableMockState.groups.push({ defaultLayout, id, onLayoutChanged }),
    (
      <div
        data-default-layout={JSON.stringify(defaultLayout ?? null)}
        data-panel-group-id={id}
      >
        {children}
      </div>
    )
  ),
}));

vi.mock("../../../../../src/lib/desktopClipboardApi", () => ({
  writeDesktopClipboardText: (...args: unknown[]) =>
    desktopClipboardMocks.writeDesktopClipboardText(...args),
}));

export function resetTerminalWorkspaceTestState() {
  xtermPaneMockState.mountedPaneIds = [];
  xtermPaneMockState.renderCount = 0;
  xtermPaneMockState.shouldThrow = false;
  xtermPaneMockState.unmountedPaneIds = [];
  xtermPaneMockState.visibleByPaneId.clear();
  resizableMockState.groups = [];
  desktopClipboardMocks.writeDesktopClipboardText.mockReset();
  desktopClipboardMocks.writeDesktopClipboardText.mockResolvedValue({
    ok: true,
  });
  terminalChromeRuntimeStore.reset();
}

export function cleanupTerminalWorkspaceTestState() {
  document.documentElement.classList.remove("dark");
  terminalChromeRuntimeStore.reset();
}
