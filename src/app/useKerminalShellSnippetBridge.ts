// @author kongweiguang

import { useEffect } from "react";

import {
  SNIPPET_PANEL_OPEN_EVENT,
  type SnippetPanelOpenRequest,
} from "../features/snippets/snippetPanelEvents";
import type { ToolId } from "../features/workspace/types";

interface UseKerminalShellSnippetBridgeOptions {
  focusPane: (paneId: string) => void;
  openTool: (toolId: ToolId) => void;
}

/**
 * 将终端片段打开事件桥接到主壳导航；事件语义固定为“打开”而非切换，避免面板
 * 已存在时由系统流程反向收起，并在卸载时释放全局监听。
 */
export function useKerminalShellSnippetBridge({
  focusPane,
  openTool,
}: UseKerminalShellSnippetBridgeOptions) {
  useEffect(() => {
    const handleSnippetPanelOpen = (event: Event) => {
      const request = (event as CustomEvent<SnippetPanelOpenRequest>).detail;
      if (!request?.snippetId) return;
      if (request.paneId) focusPane(request.paneId);
      openTool("snippets");
    };

    window.addEventListener(SNIPPET_PANEL_OPEN_EVENT, handleSnippetPanelOpen);
    return () =>
      window.removeEventListener(
        SNIPPET_PANEL_OPEN_EVENT,
        handleSnippetPanelOpen,
      );
  }, [focusPane, openTool]);
}
