// @author kongweiguang

export interface TerminalPaneRuntimeSlot {
  active: boolean;
  element: HTMLElement;
  /** slot 是否仍挂在对应 tab 的布局中；false 表示关闭退休期间被保留的旧 slot。 */
  mounted: boolean;
}

export type TerminalRuntimeSlots = Record<string, TerminalPaneRuntimeSlot[]>;

export type TerminalRuntimeSlotChangeHandler = (
  paneId: string,
  element: HTMLElement,
  active: boolean,
  mounted: boolean,
) => void;

interface UpdateTerminalRuntimeSlotOptions {
  active: boolean;
  element: HTMLElement;
  mounted: boolean;
  paneId: string;
  retainUnmounted: boolean;
}

export function updateTerminalRuntimeSlot(
  current: TerminalRuntimeSlots,
  {
    active,
    element,
    mounted,
    paneId,
    retainUnmounted,
  }: UpdateTerminalRuntimeSlotOptions,
): TerminalRuntimeSlots {
  const existingSlots = current[paneId] ?? [];
  if (!mounted) {
    if (!existingSlots.some((slot) => slot.element === element)) {
      return current;
    }
    if (retainUnmounted) {
      return replaceTerminalRuntimeSlots(
        current,
        paneId,
        existingSlots.map((slot) =>
          slot.element === element ? { active, element, mounted: false } : slot,
        ),
      );
    }
    return replaceTerminalRuntimeSlots(
      current,
      paneId,
      existingSlots.filter((slot) => slot.element !== element),
    );
  }

  // 新挂载接管该 pane 的渲染：淘汰此前保留的已卸载旧 slot，但保留同一 pane
  // 在其它仍挂载 tab 中的合法 slots。
  return replaceTerminalRuntimeSlots(current, paneId, [
    ...existingSlots.filter(
      (slot) => slot.mounted && slot.element !== element,
    ),
    { active, element, mounted: true },
  ]);
}

export function pruneTerminalRuntimeSlots(
  current: TerminalRuntimeSlots,
  retainedPaneIds: ReadonlySet<string>,
): TerminalRuntimeSlots {
  const stalePaneIds = Object.keys(current).filter(
    (paneId) => !retainedPaneIds.has(paneId),
  );
  if (stalePaneIds.length === 0) {
    return current;
  }

  const next = { ...current };
  for (const paneId of stalePaneIds) {
    delete next[paneId];
  }
  return next;
}

function replaceTerminalRuntimeSlots(
  current: TerminalRuntimeSlots,
  paneId: string,
  nextSlots: TerminalPaneRuntimeSlot[],
): TerminalRuntimeSlots {
  const existingSlots = current[paneId] ?? [];
  if (
    existingSlots.length === nextSlots.length &&
    nextSlots.every((slot, index) => existingSlots[index] === slot)
  ) {
    return current;
  }
  if (nextSlots.length === 0) {
    const next = { ...current };
    delete next[paneId];
    return next;
  }
  return { ...current, [paneId]: nextSlots };
}
