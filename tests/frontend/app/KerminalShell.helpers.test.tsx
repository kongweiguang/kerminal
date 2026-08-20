// @author kongweiguang

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  DeleteConfirmationDialog,
  resolveShellLayout,
} from "../../../src/app/KerminalShell.helpers.tsx";

describe("resolveShellLayout", () => {
  it("fully removes the left sidebar column when collapsed", () => {
    const layout = resolveShellLayout({
      bottomToolPanelHeight: 280,
      leftPanelCollapsed: true,
      leftPanelWidth: 280,
      leftToolPanelWidth: 320,
      openToolPlacements: [],
      toolPanelWidth: 320,
      viewportWidth: 1280,
    });

    expect(layout.effectiveLeftPanelCollapsed).toBe(true);
    expect(layout.leftPanelColumnWidth).toBe(0);
    expect(layout.gridTemplateColumns).toBe(
      "0px 0px 0px 0px minmax(0, 1fr) 0px 44px",
    );
  });

  it("keeps the left sidebar column on wide expanded layouts", () => {
    const layout = resolveShellLayout({
      bottomToolPanelHeight: 280,
      leftPanelCollapsed: false,
      leftPanelWidth: 280,
      leftToolPanelWidth: 320,
      openToolPlacements: ["attached"],
      toolPanelWidth: 320,
      viewportWidth: 1280,
    });

    expect(layout.effectiveLeftPanelCollapsed).toBe(false);
    expect(layout.leftPanelColumnWidth).toBe(280);
    expect(layout.gridTemplateColumns).toBe(
      "280px 0px 0px 0px minmax(0, 1fr) 0px 320px",
    );
  });

  it("keeps only the rail width when tool content opens as a floating window", () => {
    const layout = resolveShellLayout({
      bottomToolPanelHeight: 280,
      leftPanelCollapsed: false,
      leftPanelWidth: 280,
      leftToolPanelWidth: 420,
      openToolPlacements: ["center"],
      toolPanelWidth: 420,
      viewportWidth: 1280,
    });

    expect(layout.effectiveRightPanelOpen).toBe(false);
    expect(layout.rightPanelColumnWidth).toBe(44);
    expect(layout.rightWorkspaceInset).toBe(44);
    expect(layout.gridTemplateColumns).toBe(
      "280px 0px 0px 0px minmax(0, 1fr) 0px 44px",
    );
  });

  it("allocates a real column between the machine sidebar and terminal for left placement", () => {
    const layout = resolveShellLayout({
      bottomToolPanelHeight: 280,
      leftPanelCollapsed: false,
      leftPanelWidth: 280,
      leftToolPanelWidth: 420,
      openToolPlacements: ["left"],
      toolPanelWidth: 420,
      viewportWidth: 1280,
    });

    expect(layout.effectiveLeftToolPanelOpen).toBe(true);
    expect(layout.effectiveRightPanelOpen).toBe(false);
    expect(layout.leftWorkspaceInset).toBe(420);
    expect(layout.rightWorkspaceInset).toBe(44);
    expect(layout.gridTemplateColumns).toBe(
      "280px 0px 420px 0px minmax(0, 1fr) 0px 44px",
    );
  });

  it("allocates independent left, right, and bottom slots together", () => {
    const layout = resolveShellLayout({
      bottomToolPanelHeight: 300,
      leftPanelCollapsed: false,
      leftPanelWidth: 280,
      leftToolPanelWidth: 360,
      openToolPlacements: ["left", "attached", "bottom", "center"],
      toolPanelWidth: 400,
      viewportWidth: 1600,
    });

    expect(layout.effectiveLeftToolPanelOpen).toBe(true);
    expect(layout.effectiveRightPanelOpen).toBe(true);
    expect(layout.effectiveBottomToolPanelOpen).toBe(true);
    expect(layout.gridTemplateColumns).toBe(
      "280px 0px 360px 0px minmax(0, 1fr) 0px 400px",
    );
    expect(layout.gridTemplateRows).toBe(
      "36px minmax(0, 1fr) 0px 300px",
    );
  });

  it("keeps delete errors concise while preserving hidden diagnostics", () => {
    render(
      <DeleteConfirmationDialog
        deleteError={{
          detail: "本地保存的配置没有被删除。",
          recoveryAction: "请检查配置目录权限后重试。",
          severity: "error",
          technicalDetail: 'permission denied password="[已隐藏]"',
          title: "连接未删除",
        }}
        deleting={false}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        pendingDelete={{
          id: "host-1",
          title: "生产主机",
          type: "machine",
        }}
      />,
    );

    expect(screen.getByText("连接未删除")).toBeVisible();
    expect(screen.getByText(/permission denied/)).not.toBeVisible();
  });
});
