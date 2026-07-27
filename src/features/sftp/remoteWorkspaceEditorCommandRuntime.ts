// @author kongweiguang

import type * as Monaco from "monaco-editor";
import {
  readDesktopClipboardText,
  writeDesktopClipboardText,
} from "../../lib/desktopClipboardApi";
import type { RemoteWorkspaceEditorCommandId } from "./remoteWorkspaceEditorCommandModel";

const EDITOR_TEXT_FOCUS_CONTEXT = "editorTextFocus";

export function registerRemoteWorkspaceEditorKeybindings({
  editor,
  monaco,
  runCommand,
}: {
  editor: Monaco.editor.IStandaloneCodeEditor;
  monaco: typeof Monaco;
  runCommand: (command: RemoteWorkspaceEditorCommandId) => void;
}) {
  const register = (
    keybinding: number,
    command: RemoteWorkspaceEditorCommandId,
  ) => {
    // 查找框获得焦点时仍位于 Monaco 编辑器内；只在正文光标聚焦时接管快捷键。
    editor.addCommand(
      keybinding,
      () => runCommand(command),
      EDITOR_TEXT_FOCUS_CONTEXT,
    );
  };

  register(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, "save");
  register(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyF, "find");
  register(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyH, "replace");
  register(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyA, "selectAll");
  register(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyC, "copy");
  register(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyX, "cut");
  register(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyV, "paste");
  register(monaco.KeyMod.Shift | monaco.KeyCode.Insert, "paste");
  register(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyZ, "undo");
  register(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyY, "redo");
  register(
    monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyZ,
    "redo",
  );
}

export async function runRemoteWorkspaceEditorMonacoCommand(
  editor: Monaco.editor.IStandaloneCodeEditor | null,
  command: RemoteWorkspaceEditorCommandId,
) {
  if (!editor) {
    return;
  }

  editor.focus();
  if (command === "copy") {
    await runMonacoActionOrFallback(
      editor,
      "editor.action.clipboardCopyAction",
      () => copySelectedEditorText(editor),
    );
    return;
  }
  if (command === "cut") {
    await runMonacoActionOrFallback(
      editor,
      "editor.action.clipboardCutAction",
      () => cutSelectedEditorText(editor),
    );
    return;
  }
  if (command === "paste") {
    await runMonacoActionOrFallback(
      editor,
      "editor.action.clipboardPasteAction",
      () => pasteClipboardTextIntoEditor(editor),
    );
    return;
  }
  if (command === "undo") {
    if (!(await runMonacoAction(editor, "undo"))) {
      editor.trigger("kerminal", "undo", null);
    }
    return;
  }
  if (command === "redo") {
    if (!(await runMonacoAction(editor, "redo"))) {
      editor.trigger("kerminal", "redo", null);
    }
    return;
  }
  if (command === "selectAll") {
    if (!(await runMonacoAction(editor, "editor.action.selectAll"))) {
      editor.trigger("kerminal", "editor.action.selectAll", null);
    }
    return;
  }
  if (command === "find") {
    await runMonacoAction(editor, "actions.find");
    return;
  }
  if (command === "replace") {
    await runMonacoAction(editor, "editor.action.startFindReplaceAction");
  }
}

export function editorShouldHandleNativeTextEdit(
  editor: Monaco.editor.IStandaloneCodeEditor | null,
) {
  if (!editor) {
    return false;
  }
  if (editor.hasTextFocus()) {
    return true;
  }
  const activeElement = document.activeElement;
  return Boolean(
    activeElement instanceof Element &&
      activeElement.closest("[data-kerminal-text-editor]"),
  );
}

async function runMonacoActionOrFallback(
  editor: Monaco.editor.IStandaloneCodeEditor,
  actionId: string,
  fallback: () => Promise<void>,
) {
  if (await runMonacoAction(editor, actionId)) {
    return;
  }
  await fallback();
  editor.focus();
}

async function runMonacoAction(
  editor: Monaco.editor.IStandaloneCodeEditor,
  actionId: string,
) {
  const action = editor.getAction(actionId);
  if (!action) {
    return false;
  }
  await action.run();
  editor.focus();
  return true;
}

async function copySelectedEditorText(
  editor: Monaco.editor.IStandaloneCodeEditor,
) {
  const selectedText = selectedEditorText(editor);
  if (!selectedText) {
    return;
  }
  await writeDesktopClipboardText(selectedText);
}

async function cutSelectedEditorText(
  editor: Monaco.editor.IStandaloneCodeEditor,
) {
  const selection = editor.getSelection();
  const selectedText = selectedEditorText(editor);
  if (!selection || !selectedText) {
    return;
  }
  await writeDesktopClipboardText(selectedText);
  editor.pushUndoStop();
  editor.executeEdits("kerminal-cut", [
    { forceMoveMarkers: true, range: selection, text: "" },
  ]);
  editor.pushUndoStop();
}

async function pasteClipboardTextIntoEditor(
  editor: Monaco.editor.IStandaloneCodeEditor,
) {
  const selection = editor.getSelection();
  if (!selection) {
    return;
  }
  const text = await readDesktopClipboardText();
  if (!text) {
    return;
  }
  editor.pushUndoStop();
  editor.executeEdits("kerminal-paste", [
    { forceMoveMarkers: true, range: selection, text },
  ]);
  editor.pushUndoStop();
}

function selectedEditorText(editor: Monaco.editor.IStandaloneCodeEditor) {
  const model = editor.getModel();
  const selection = editor.getSelection();
  if (!model || !selection || selection.isEmpty()) {
    return "";
  }
  return model.getValueInRange(selection);
}
