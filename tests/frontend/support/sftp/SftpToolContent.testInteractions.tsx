// @author kongweiguang

import { fireEvent, screen } from "@testing-library/react";

/** 拖放场景使用可检查的数据传输对象，避免依赖浏览器禁止构造的原生实例。 */
export function createDragDataTransfer() {
  const store = new Map<string, string>();
  return {
    dropEffect: "none",
    effectAllowed: "all",
    clearData: vi.fn((type?: string) => {
      if (type) {
        store.delete(type);
        return;
      }
      store.clear();
    }),
    getData: vi.fn((type: string) => store.get(type) ?? ""),
    setData: vi.fn((type: string, value: string) => {
      store.set(type, value);
    }),
    setDragImage: vi.fn(),
  } as unknown as DataTransfer;
}

/** 统一打开当前 SFTP 目录菜单，让各场景从同一可见入口开始。 */
export function openCurrentDirectoryContextMenu() {
  fireEvent.contextMenu(screen.getByTestId("sftp-drop-zone"), {
    clientX: 24,
    clientY: 24,
  });
}

