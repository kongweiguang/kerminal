// @author kongweiguang

import { describe, expect, it, vi } from "vitest";
import {
  patchXtermWebviewNamespace,
  prepareXtermWebviewCompatibility,
} from "../../../src/lib/xtermWebviewCompatibility";

describe("xterm WebView runtime patch", () => {
  it("uses a null-prototype namespace for the audited xterm initializer", () => {
    expect(patchXtermWebviewNamespace("})(n||={});")).toBe(
      "})(n ||= Object.create(null));",
    );
    expect(patchXtermWebviewNamespace("const n = {};")).toBe("const n = {};");
  });

  it("does not mutate a normally writable Object.prototype descriptor", () => {
    const defineProperty = vi.spyOn(Object, "defineProperty");
    prepareXtermWebviewCompatibility();
    expect(defineProperty).not.toHaveBeenCalled();
    defineProperty.mockRestore();
  });
});
