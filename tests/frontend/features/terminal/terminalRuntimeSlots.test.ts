// @author kongweiguang

import { describe, expect, it } from "vitest";
import {
  pruneTerminalRuntimeSlots,
  updateTerminalRuntimeSlot,
  type TerminalRuntimeSlots,
} from "../../../../src/features/terminal/terminalRuntimeSlots";

describe("terminalRuntimeSlots", () => {
  it("removes only the exact slot that unmounts while a pane stays live", () => {
    const first = document.createElement("div");
    const second = document.createElement("div");
    let slots: TerminalRuntimeSlots = {};
    slots = mount(slots, "pane-shared", first, false);
    slots = mount(slots, "pane-shared", second, true);

    slots = updateTerminalRuntimeSlot(slots, {
      active: false,
      element: first,
      mounted: false,
      paneId: "pane-shared",
      retainUnmounted: false,
    });

    expect(slots["pane-shared"]).toEqual([
      { active: true, element: second, mounted: true },
    ]);
  });

  it("retains a detached slot through retirement and prunes it afterwards", () => {
    const element = document.createElement("div");
    let slots = mount({}, "pane-closing", element, true);

    const retained = updateTerminalRuntimeSlot(slots, {
      active: true,
      element,
      mounted: false,
      paneId: "pane-closing",
      retainUnmounted: true,
    });
    expect(retained).not.toBe(slots);
    expect(retained["pane-closing"]).toEqual([
      { active: true, element, mounted: false },
    ]);

    slots = pruneTerminalRuntimeSlots(retained, new Set());
    expect(slots).toEqual({});
  });

  it("replaces a retained unmounted slot when the same pane id mounts again", () => {
    const retiredElement = document.createElement("div");
    const nextElement = document.createElement("div");
    let slots: TerminalRuntimeSlots = {};
    slots = mount(slots, "pane-reopen", retiredElement, true);
    slots = updateTerminalRuntimeSlot(slots, {
      active: true,
      element: retiredElement,
      mounted: false,
      paneId: "pane-reopen",
      retainUnmounted: true,
    });

    slots = mount(slots, "pane-reopen", nextElement, true);

    expect(slots["pane-reopen"]).toEqual([
      { active: true, element: nextElement, mounted: true },
    ]);
  });

  it("keeps other mounted slots of the same pane while evicting a retained one", () => {
    const tabOneElement = document.createElement("div");
    const tabTwoElement = document.createElement("div");
    const nextElement = document.createElement("div");
    let slots: TerminalRuntimeSlots = {};
    slots = mount(slots, "pane-multitab", tabOneElement, false);
    slots = mount(slots, "pane-multitab", tabTwoElement, true);
    slots = updateTerminalRuntimeSlot(slots, {
      active: false,
      element: tabOneElement,
      mounted: false,
      paneId: "pane-multitab",
      retainUnmounted: true,
    });

    slots = mount(slots, "pane-multitab", nextElement, true);

    expect(slots["pane-multitab"]).toEqual([
      { active: true, element: tabTwoElement, mounted: true },
      { active: true, element: nextElement, mounted: true },
    ]);
  });

  it("does not accumulate slots across repeated open and close cycles", () => {
    let slots: TerminalRuntimeSlots = {};
    for (let index = 0; index < 100; index += 1) {
      const paneId = `pane-${index}`;
      const element = document.createElement("div");
      slots = mount(slots, paneId, element, true);
      slots = updateTerminalRuntimeSlot(slots, {
        active: true,
        element,
        mounted: false,
        paneId,
        retainUnmounted: true,
      });
      slots = pruneTerminalRuntimeSlots(slots, new Set());
    }

    expect(slots).toEqual({});
  });
});

function mount(
  current: TerminalRuntimeSlots,
  paneId: string,
  element: HTMLElement,
  active: boolean,
) {
  return updateTerminalRuntimeSlot(current, {
    active,
    element,
    mounted: true,
    paneId,
    retainUnmounted: false,
  });
}
