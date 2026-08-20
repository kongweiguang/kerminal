// @author kongweiguang

import { useCallback, useEffect } from "react";
import {
  dispatchKerminalTextEditCommand,
  shouldAppHandleKeybinding,
  type KerminalTextEditCommand,
} from "../contracts/textEditCommands";
import {
  keybindingMatchesEvent,
  shortcutPlatform,
} from "../features/settings/keybindingUtils";
import type { SettingsSectionId } from "../features/settings/SettingsToolContent";
import type { AppSettings } from "../features/settings/settingsModel";
import { isToolId, type ToolId } from "../features/workspace/types";
import type { useWorkspaceStore } from "../features/workspace/workspaceStore";
import {
  listenNativeMenuActions,
  type NativeMenuAction,
} from "../lib/nativeMenuApi";

type WorkspaceState = ReturnType<typeof useWorkspaceStore.getState>;

const nativeTextEditCommandByAction: Partial<
  Record<NativeMenuAction, KerminalTextEditCommand>
> = {
  editCopy: "copy",
  editCut: "cut",
  editPaste: "paste",
  editRedo: "redo",
  editSelectAll: "selectAll",
  editUndo: "undo",
};

export function useKerminalShellCommands({
  activeTabId,
  addTerminalTab,
  closeAllTools,
  closePane,
  closeTerminalTab,
  focusPane,
  focusedPaneId,
  keybindings,
  openSettingsTool,
  openTool,
  selectTab,
  splitFocusedPane,
  terminalTabs,
  toggleTool,
}: {
  activeTabId: string | null;
  addTerminalTab: WorkspaceState["addTerminalTab"];
  closeAllTools: () => void;
  closePane: WorkspaceState["closePane"];
  closeTerminalTab: WorkspaceState["closeTerminalTab"];
  focusPane: WorkspaceState["focusPane"];
  focusedPaneId: string | null;
  keybindings: AppSettings["keybindings"];
  openSettingsTool: (sectionId?: SettingsSectionId) => void;
  openTool: (toolId: ToolId) => void;
  selectTab: WorkspaceState["selectTab"];
  splitFocusedPane: WorkspaceState["splitFocusedPane"];
  terminalTabs: WorkspaceState["terminalTabs"];
  toggleTool: (toolId: ToolId) => void;
}) {
  const openLogsTool = useCallback(() => openTool("logs"), [openTool]);

  const activateTool = useCallback(
    (toolId: ToolId) => {
      if (toolId === "settings") {
        openSettingsTool();
        return;
      }
      toggleTool(toolId);
    },
    [openSettingsTool, toggleTool],
  );

  const selectRelativeTerminalTab = useCallback(
    (offset: number) => {
      if (terminalTabs.length === 0) {
        return false;
      }

      const currentIndex = Math.max(
        terminalTabs.findIndex((tab) => tab.id === activeTabId),
        0,
      );
      const nextIndex =
        (currentIndex + offset + terminalTabs.length) % terminalTabs.length;
      selectTab(terminalTabs[nextIndex].id);
      return true;
    },
    [activeTabId, selectTab, terminalTabs],
  );

  const focusTerminalWorkspace = useCallback(() => {
    closeAllTools();
    if (!activeTabId) {
      addTerminalTab();
      return true;
    }

    selectTab(activeTabId);
    if (focusedPaneId) {
      focusPane(focusedPaneId);
    }
    return true;
  }, [
    activeTabId,
    addTerminalTab,
    focusPane,
    focusedPaneId,
    selectTab,
    closeAllTools,
  ]);

  const runKeybindingAction = useCallback(
    (action: string) => {
      if (action.startsWith("tool.")) {
        const toolId = action.slice("tool.".length);
        if (isToolId(toolId)) {
          activateTool(toolId);
          return true;
        }
      }

      if (action === "settings.open") {
        openSettingsTool();
        return true;
      }
      if (action === "settings.keybindings") {
        openSettingsTool("settings-keybindings");
        return true;
      }
      if (action === "terminal.focus") {
        return focusTerminalWorkspace();
      }
      if (action === "terminal.newTab") {
        addTerminalTab();
        return true;
      }
      if (action === "terminal.closeTab") {
        if (activeTabId) {
          closeTerminalTab(activeTabId);
        }
        return true;
      }
      if (action === "terminal.closePane") {
        if (focusedPaneId) {
          closePane(focusedPaneId);
        }
        return true;
      }
      if (action === "terminal.splitHorizontal") {
        splitFocusedPane("horizontal");
        return true;
      }
      if (action === "terminal.splitVertical") {
        splitFocusedPane("vertical");
        return true;
      }
      if (action === "terminal.previousTab") {
        return selectRelativeTerminalTab(-1);
      }
      if (action === "terminal.nextTab") {
        return selectRelativeTerminalTab(1);
      }

      return false;
    },
    [
      activateTool,
      activeTabId,
      addTerminalTab,
      closePane,
      closeTerminalTab,
      focusTerminalWorkspace,
      focusedPaneId,
      openSettingsTool,
      selectRelativeTerminalTab,
      splitFocusedPane,
    ],
  );

  const handleNativeMenuAction = useCallback(
    (action: NativeMenuAction) => {
      const textEditCommand = nativeTextEditCommandByAction[action];
      if (textEditCommand) {
        dispatchKerminalTextEditCommand(textEditCommand);
      } else if (action === "newTerminal") {
        addTerminalTab();
      } else if (action === "closeTab") {
        if (activeTabId) {
          closeTerminalTab(activeTabId);
        }
      } else if (action === "closePane") {
        if (focusedPaneId) {
          closePane(focusedPaneId);
        }
      } else if (action === "openSettings") {
        openSettingsTool();
      } else if (action === "splitHorizontal") {
        splitFocusedPane("horizontal");
      } else if (action === "splitVertical") {
        splitFocusedPane("vertical");
      } else if (action === "openLogs") {
        openTool("logs");
      } else if (action === "openAgentLauncher") {
        openTool("agentLauncher");
      } else if (action === "openSystem") {
        openTool("system");
      } else if (action === "openSftp") {
        openTool("sftp");
      } else if (action === "openPorts") {
        openTool("ports");
      } else if (action === "openSnippets") {
        openTool("snippets");
      }
    },
    [
      activeTabId,
      addTerminalTab,
      closePane,
      closeTerminalTab,
      focusedPaneId,
      openSettingsTool,
      openTool,
      splitFocusedPane,
    ],
  );

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    listenNativeMenuActions(handleNativeMenuAction)
      .then((nextUnlisten) => {
        if (disposed) {
          nextUnlisten();
          return;
        }
        unlisten = nextUnlisten;
      })
      .catch(() => {
        // 原生菜单只在 Tauri 桌面端可用，监听失败不影响浏览器预览。
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [handleNativeMenuAction]);

  useEffect(() => {
    const platform = shortcutPlatform();
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (!shouldAppHandleKeybinding(event)) {
        return;
      }

      const matchedKeybinding = keybindings.find((keybinding) =>
        keybindingMatchesEvent(keybinding, event, platform),
      );
      if (!matchedKeybinding) {
        return;
      }

      if (runKeybindingAction(matchedKeybinding.action)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [keybindings, runKeybindingAction]);

  return {
    activateTool,
    openLogsTool,
  };
}
