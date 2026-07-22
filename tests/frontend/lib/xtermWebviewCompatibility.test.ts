import { afterEach, describe, expect, it, vi } from "vitest";
import {
  patchXtermWebviewNamespace,
  prepareXtermWebviewCompatibility,
} from "../../../src/lib/xtermWebviewCompatibility";

const originalToStringDescriptor = Object.getOwnPropertyDescriptor(
  Object.prototype,
  "toString",
);

if (!originalToStringDescriptor) {
  throw new Error("Object.prototype.toString descriptor is unavailable");
}

describe("prepareXtermWebviewCompatibility", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(
      Object.prototype,
      "toString",
      originalToStringDescriptor,
    );
  });

  it("allows xterm namespace assignments when Object.prototype.toString is read only", () => {
    Object.defineProperty(Object.prototype, "toString", {
      ...originalToStringDescriptor,
      configurable: true,
      writable: false,
    });

    expect(() => {
      const namespaceTarget = {};
      (namespaceTarget as { toString: () => string }).toString = () => "before";
    }).toThrow(/read only property 'toString'/);

    prepareXtermWebviewCompatibility();

    const namespaceTarget = {};
    (namespaceTarget as { toString: () => string }).toString = () => "after";

    expect(
      Object.prototype.hasOwnProperty.call(namespaceTarget, "toString"),
    ).toBe(true);
    expect(namespaceTarget.toString()).toBe("after");
  });

  it("patches xterm namespace initializers to use null-prototype objects", () => {
    Object.defineProperty(Object.prototype, "toString", {
      ...originalToStringDescriptor,
      configurable: true,
      writable: false,
    });

    const source = `
      "use strict";
      var Qn;
      (o => {
        o.toString = () => "patched";
      })(Qn||={});
      return Qn.toString();
    `;

    let unpatchedThrew = false;
    const patchedResult = (() => {
      try {
        try {
          Function(source)();
        } catch {
          unpatchedThrew = true;
        }
        return Function(patchXtermWebviewNamespace(source))();
      } finally {
        Object.defineProperty(
          Object.prototype,
          "toString",
          originalToStringDescriptor,
        );
      }
    })();

    expect(unpatchedThrew).toBe(true);
    expect(patchedResult).toBe("patched");
  });

  it("patches every minified namespace initializer in the xterm bundle", () => {
    const source =
      "var ro;(l=>{l.isLessThan=()=>true})(ro||={});var Qn;(o=>{o.toString=()=>''})(Qn||={});";

    expect(patchXtermWebviewNamespace(source)).toBe(
      "var ro;(l=>{l.isLessThan=()=>true})(ro ||= Object.create(null));var Qn;(o=>{o.toString=()=>''})(Qn ||= Object.create(null));",
    );
  });

  it("allows xterm to import when Object.prototype.toString is read only but configurable", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);

    Object.defineProperty(Object.prototype, "toString", {
      ...originalToStringDescriptor,
      configurable: true,
      writable: false,
    });

    prepareXtermWebviewCompatibility();

    await expect(import("@xterm/xterm")).resolves.toHaveProperty("Terminal");
  });

  it("documents why Tauri freezePrototype cannot be repaired at runtime", () => {
    const frozenPrototype = {};
    Object.defineProperty(frozenPrototype, "toString", {
      configurable: false,
      enumerable: false,
      value: originalToStringDescriptor.value,
      writable: false,
    });

    expect(() => {
      Object.defineProperty(frozenPrototype, "toString", {
        configurable: false,
        enumerable: false,
        value: originalToStringDescriptor.value,
        writable: true,
      });
    }).toThrow();
  });

  it("leaves an already writable Object.prototype.toString descriptor unchanged", () => {
    prepareXtermWebviewCompatibility();

    expect(
      Object.getOwnPropertyDescriptor(Object.prototype, "toString"),
    ).toEqual(originalToStringDescriptor);
  });
});
