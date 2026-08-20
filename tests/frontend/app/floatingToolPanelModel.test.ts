// @author kongweiguang

import { describe, expect, it } from "vitest";
import {
  clampFloatingToolPanelPoint,
  resolveInitialFloatingToolPanelPoint,
} from "../../../src/app/floatingToolPanelModel";

describe("floatingToolPanelModel", () => {
  it("centers the initial window below the native title bar", () => {
    expect(
      resolveInitialFloatingToolPanelPoint(
        { height: 800, width: 1200 },
        { height: 400, width: 600 },
      ),
    ).toEqual({ x: 300, y: 222 });
  });

  it("keeps the complete floating window inside the shell", () => {
    expect(
      clampFloatingToolPanelPoint(
        { x: 2_000, y: -100 },
        { height: 700, width: 1_000 },
        { height: 320, width: 420 },
      ),
    ).toEqual({ x: 572, y: 44 });
  });

  it("keeps the drag and close affordances reachable in undersized hosts", () => {
    expect(
      clampFloatingToolPanelPoint(
        { x: 400, y: 400 },
        { height: 260, width: 300 },
        { height: 500, width: 600 },
      ),
    ).toEqual({ x: 8, y: 44 });
  });
});
