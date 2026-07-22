import type * as Monaco from "monaco-editor";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import {
  KERMINAL_TEXT_EDIT_COMMAND_EVENT,
  type KerminalTextEditCommandEventDetail,
} from "../../contracts/textEditCommands";
import { targetStableId, type RemoteTargetRef } from "../../lib/targetModel";
import { defaultTerminalAppearance } from "../settings/defaults/index";
import {
  terminalFontWeightValue,
  type TerminalAppearance,
} from "../settings/contracts/index";
import type { MonacoTextEditorMountHandler } from "./MonacoTextEditor";
import { RemoteWorkspaceEditorView } from "./RemoteWorkspaceEditor/RemoteWorkspaceEditorView";
import {
  applyOpenTabError,
  applyReloadError,
  applyReloadSuccess,
  applySaveError,
  applySaveSuccess,
  cleanSaveStatus,
  closeFileTabState,
  createLoadedTab,
  createLoadingTab,
  createRootNode,
  entryToTreeNode,
  errorMessage,
  isDirtyTab,
  normalizeRemotePath,
  readonlySaveStatus,
  resolveWorkspaceTarget,
  startReloadingTab,
  startSavingTab,
  updateTreeNode,
  type OpenFileTab,
  type RemoteWorkspaceStatus,
  type WorkspaceTreeNode,
} from "./remoteWorkspaceEditorModel";
import {
  buildRemoteWorkspaceEditorCommandGroups,
  isRemoteWorkspaceEditorCommandEnabled,
  resolveRemoteWorkspaceEditorContextMenuPosition,
  type RemoteWorkspaceEditorCommandId,
  type RemoteWorkspaceEditorCommandState,
} from "./remoteWorkspaceEditorCommandModel";
import {
  editorShouldHandleNativeTextEdit,
  registerRemoteWorkspaceEditorKeybindings,
  runRemoteWorkspaceEditorMonacoCommand,
} from "./remoteWorkspaceEditorCommandRuntime";
import {
  isRemoteWorkspaceBinaryFileReadError,
  listRemoteWorkspaceDirectory,
  readRemoteWorkspaceTextFile,
  writeRemoteWorkspaceTextFile,
} from "./remoteWorkspaceEditorTransport";
import { resolveWorkspaceFilePreviewPolicy } from "./workspaceFilePreviewPolicy";
import {
  BINARY_WORKSPACE_FILE_PREVIEW_NOTICE,
  buildWorkspaceFilePreviewUnsupportedNotice,
} from "./workspaceFilePreviewPresentation";

const MAX_EDITOR_BYTES = 10 * 1024 * 1024;

export type RemoteWorkspaceOpenCommand = {
  nonce: number;
  path: string;
};

export type { RemoteWorkspaceStatus } from "./remoteWorkspaceEditorModel";

export function RemoteWorkspaceEditor({
  hostId,
  onDirtyStateChange,
  onOpenDirectory,
  onStatus,
  openCommand,
  rootPath,
  target,
  terminalAppearance = defaultTerminalAppearance,
  variant = "embedded",
}: {
  hostId?: string;
  onDirtyStateChange?: (dirty: boolean) => void;
  onOpenDirectory?: (path: string) => Promise<void> | void;
  onStatus?: (status: RemoteWorkspaceStatus) => void;
  openCommand?: RemoteWorkspaceOpenCommand | null;
  rootPath: string;
  target?: RemoteTargetRef;
  terminalAppearance?: TerminalAppearance;
  variant?: "embedded" | "fullscreen" | "workspace";
}) {
  const expanded = variant !== "embedded";
  const targetKind = target?.kind;
  const targetHostId = target && target.kind !== "local" ? target.hostId : "";
  const targetContainerId =
    target?.kind === "dockerContainer" ? target.containerId : "";
  const targetContainerName =
    target?.kind === "dockerContainer" ? target.containerName : undefined;
  const targetContainerRuntime =
    target?.kind === "dockerContainer" ? target.runtime : undefined;
  const targetContainerUser =
    target?.kind === "dockerContainer" ? target.user : undefined;
  const targetContainerWorkdir =
    target?.kind === "dockerContainer" ? target.workdir : undefined;
  const workspaceTarget = useMemo(
    () =>
      resolveWorkspaceTarget(
        targetKind === "dockerContainer" && targetHostId && targetContainerId
          ? {
              containerId: targetContainerId,
              ...(targetContainerName
                ? { containerName: targetContainerName }
                : {}),
              hostId: targetHostId,
              kind: "dockerContainer",
              runtime: targetContainerRuntime,
              ...(targetContainerUser ? { user: targetContainerUser } : {}),
              ...(targetContainerWorkdir
                ? { workdir: targetContainerWorkdir }
                : {}),
            }
          : targetKind === "ssh" && targetHostId
            ? { hostId: targetHostId, kind: "ssh" }
            : undefined,
        hostId,
      ),
    [
      hostId,
      targetContainerId,
      targetContainerName,
      targetContainerRuntime,
      targetContainerUser,
      targetContainerWorkdir,
      targetHostId,
      targetKind,
    ],
  );
  const workspaceTargetKey = workspaceTarget
    ? targetStableId(workspaceTarget)
    : "none";
  const workspaceProtocol =
    workspaceTarget?.kind === "dockerContainer" ? "container://" : "sftp://";
  const normalizedRootPath = normalizeRemotePath(rootPath);
  const [workspaceRoot, setWorkspaceRoot] = useState(normalizedRootPath);
  const [rootDraft, setRootDraft] = useState(normalizedRootPath);
  const [treeNodes, setTreeNodes] = useState<WorkspaceTreeNode[]>(() => [
    createRootNode(normalizedRootPath),
  ]);
  const [treeStatus, setTreeStatus] = useState<RemoteWorkspaceStatus | null>(
    null,
  );
  const [tabs, setTabs] = useState<OpenFileTab[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [pendingClosePath, setPendingClosePath] = useState<string | null>(null);
  const [openTreePaths, setOpenTreePaths] = useState<Set<string>>(
    () => new Set([normalizedRootPath]),
  );
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const runEditorCommandRef = useRef<
    (command: RemoteWorkspaceEditorCommandId) => void
  >(() => undefined);
  const tabsRef = useRef<OpenFileTab[]>([]);
  // 每条文件路径只允许最新一代读取回写，避免关闭、重开或切换目标后的旧响应污染当前 Tab。
  const fileRequestSequenceRef = useRef(0);
  const activeFileRequestByPathRef = useRef(new Map<string, number>());
  const [editorContextMenu, setEditorContextMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.path === activePath) ?? null,
    [activePath, tabs],
  );
  const pendingCloseTab = useMemo(
    () => tabs.find((tab) => tab.path === pendingClosePath) ?? null,
    [pendingClosePath, tabs],
  );
  const dirtyTabCount = tabs.filter(isDirtyTab).length;
  const hasConflict =
    activeTab?.error?.includes("远端文件已变更") ||
    activeTab?.error?.includes("conflict");
  const pathUnsupportedNotice = useMemo(() => {
    if (!activeTab) {
      return null;
    }
    const decision = resolveWorkspaceFilePreviewPolicy(activeTab.path);
    return decision.kind === "unsupported"
      ? buildWorkspaceFilePreviewUnsupportedNotice(decision)
      : null;
  }, [activeTab]);
  const unsupportedNotice =
    pathUnsupportedNotice ??
    (activeTab?.binary ? BINARY_WORKSPACE_FILE_PREVIEW_NOTICE : null);
  const editorCommandState = useMemo<RemoteWorkspaceEditorCommandState>(
    () => ({
      dirty: activeTab ? isDirtyTab(activeTab) : false,
      hasConflict: Boolean(hasConflict),
      hasEditor: Boolean(activeTab && !activeTab.loading && !unsupportedNotice),
      loading: Boolean(activeTab?.loading),
      readOnly: Boolean(activeTab?.readonly),
      saving: Boolean(activeTab?.saving),
    }),
    [activeTab, hasConflict, unsupportedNotice],
  );
  const editorCommandGroups = useMemo(
    () => buildRemoteWorkspaceEditorCommandGroups(editorCommandState),
    [editorCommandState],
  );
  const editorFontOptions = useMemo(
    () => ({
      fontFamily: terminalAppearance.fontFamily,
      fontSize: terminalAppearance.fontSize,
      fontWeight: String(
        terminalFontWeightValue(terminalAppearance.fontWeight),
      ),
    }),
    [
      terminalAppearance.fontFamily,
      terminalAppearance.fontSize,
      terminalAppearance.fontWeight,
    ],
  );

  const setTab = useCallback(
    (path: string, updater: (tab: OpenFileTab) => OpenFileTab) => {
      setTabs((current) =>
        current.map((tab) => (tab.path === path ? updater(tab) : tab)),
      );
    },
    [],
  );

  const beginFileRequest = useCallback((path: string) => {
    const requestId = fileRequestSequenceRef.current + 1;
    fileRequestSequenceRef.current = requestId;
    activeFileRequestByPathRef.current.set(path, requestId);
    return requestId;
  }, []);

  const isCurrentFileRequest = useCallback(
    (path: string, requestId: number) =>
      activeFileRequestByPathRef.current.get(path) === requestId,
    [],
  );

  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  useEffect(() => {
    onDirtyStateChange?.(dirtyTabCount > 0);
  }, [dirtyTabCount, onDirtyStateChange]);

  const loadChildren = useCallback(
    async (path: string, replaceRoot = false) => {
      const normalizedPath = normalizeRemotePath(path);
      setOpenTreePaths((current) => {
        if (current.has(normalizedPath)) {
          return current;
        }
        const next = new Set(current);
        next.add(normalizedPath);
        return next;
      });
      setTreeStatus(null);
      setTreeNodes((current) =>
        replaceRoot
          ? [{ ...createRootNode(normalizedPath), loading: true }]
          : updateTreeNode(current, normalizedPath, (node) => ({
              ...node,
              error: null,
              loading: true,
            })),
      );

      try {
        const listing = await listRemoteWorkspaceDirectory(
          workspaceTarget,
          normalizedPath,
        );
        const children = listing.entries.map(entryToTreeNode);
        setTreeNodes((current) =>
          replaceRoot
            ? [
                {
                  ...createRootNode(normalizedPath),
                  children,
                  loaded: true,
                  loading: false,
                },
              ]
            : updateTreeNode(current, normalizedPath, (node) => ({
                ...node,
                children,
                error: null,
                loaded: true,
                loading: false,
              })),
        );
      } catch (error) {
        const message = errorMessage(error);
        setTreeNodes((current) =>
          replaceRoot
            ? [
                {
                  ...createRootNode(normalizedPath),
                  error: message,
                  loaded: false,
                  loading: false,
                },
              ]
            : updateTreeNode(current, normalizedPath, (node) => ({
                ...node,
                error: message,
                loading: false,
              })),
        );
        setTreeStatus({ kind: "error", message });
      }
    },
    [workspaceTarget],
  );

  useEffect(() => {
    setWorkspaceRoot(normalizedRootPath);
    setRootDraft(normalizedRootPath);
    setOpenTreePaths(new Set([normalizedRootPath]));
    setTreeNodes([{ ...createRootNode(normalizedRootPath), loading: true }]);
    void loadChildren(normalizedRootPath, true);
  }, [loadChildren, normalizedRootPath, workspaceTargetKey]);

  useEffect(() => {
    activeFileRequestByPathRef.current.clear();
    setTabs([]);
    setActivePath(null);
    editorRef.current = null;
  }, [workspaceTargetKey]);

  const openFile = useCallback(
    async (path: string) => {
      const normalizedPath = normalizeRemotePath(path);
      setActivePath(normalizedPath);
      if (
        tabsRef.current.some((tab) => tab.path === normalizedPath) ||
        activeFileRequestByPathRef.current.has(normalizedPath)
      ) {
        return;
      }
      const requestId = beginFileRequest(normalizedPath);
      const previewDecision = resolveWorkspaceFilePreviewPolicy(normalizedPath);
      setTabs((current) => {
        if (current.some((tab) => tab.path === normalizedPath)) {
          return current;
        }
        return [
          ...current,
          previewDecision.kind === "unsupported"
            ? applyUnsupportedPreview(createLoadingTab(normalizedPath))
            : createLoadingTab(normalizedPath),
        ];
      });

      if (previewDecision.kind === "unsupported") {
        onStatus?.({ kind: "info", message: previewDecision.message });
        return;
      }

      try {
        const response = await readRemoteWorkspaceTextFile({
          maxBytes: MAX_EDITOR_BYTES,
          path: normalizedPath,
          target: workspaceTarget,
        });
        if (!isCurrentFileRequest(normalizedPath, requestId)) {
          return;
        }
        const nextTab = createLoadedTab(normalizedPath, response);
        setTabs((current) =>
          current.map((tab) => (tab.path === normalizedPath ? nextTab : tab)),
        );
        onStatus?.(
          response.binary
            ? {
                kind: "info",
                message: BINARY_WORKSPACE_FILE_PREVIEW_NOTICE.detail,
              }
            : {
                kind: "info",
                message: `已打开远程文件：${normalizedPath}`,
              },
        );
      } catch (error) {
        if (!isCurrentFileRequest(normalizedPath, requestId)) {
          return;
        }
        if (isRemoteWorkspaceBinaryFileReadError(error)) {
          setTab(normalizedPath, applyUnsupportedPreview);
          onStatus?.({
            kind: "info",
            message: BINARY_WORKSPACE_FILE_PREVIEW_NOTICE.detail,
          });
          return;
        }
        const message = errorMessage(error);
        setTabs((current) =>
          current.map((tab) =>
            tab.path === normalizedPath ? applyOpenTabError(tab, message) : tab,
          ),
        );
        onStatus?.({ kind: "error", message });
      }
    },
    [beginFileRequest, isCurrentFileRequest, onStatus, setTab, workspaceTarget],
  );

  useEffect(() => {
    if (!openCommand?.path) {
      return;
    }
    void openFile(openCommand.path);
  }, [openCommand?.nonce, openCommand?.path, openFile]);

  const saveFile = useCallback(
    async (path: string, overwriteOnConflict = false): Promise<boolean> => {
      const tab = tabs.find((item) => item.path === path);
      if (!tab || tab.loading || tab.saving) {
        return false;
      }
      const readonlyStatus = readonlySaveStatus(tab);
      if (readonlyStatus) {
        setTab(path, (current) => ({
          ...current,
          error: readonlyStatus.message,
        }));
        onStatus?.(readonlyStatus);
        return false;
      }
      const cleanStatus = cleanSaveStatus(tab, overwriteOnConflict);
      if (cleanStatus) {
        onStatus?.(cleanStatus);
        return true;
      }

      setTab(path, startSavingTab);
      try {
        const response = await writeRemoteWorkspaceTextFile({
          content: tab.content,
          expectedRevision: tab.revision,
          overwriteOnConflict,
          path,
          target: workspaceTarget,
        });
        setTab(path, (current) => applySaveSuccess(current, response));
        onStatus?.({ kind: "success", message: `已保存：${path}` });
        return true;
      } catch (error) {
        const message = errorMessage(error);
        setTab(path, (current) => applySaveError(current, message));
        onStatus?.({ kind: "error", message });
        return false;
      }
    },
    [onStatus, setTab, tabs, workspaceTarget],
  );

  const reloadFile = useCallback(
    async (path: string) => {
      const currentTab = tabsRef.current.find((tab) => tab.path === path);
      if (
        !currentTab ||
        currentTab.binary ||
        currentTab.loading ||
        currentTab.saving ||
        resolveWorkspaceFilePreviewPolicy(path).kind === "unsupported"
      ) {
        return;
      }
      const requestId = beginFileRequest(path);
      setTab(path, startReloadingTab);
      try {
        const response = await readRemoteWorkspaceTextFile({
          maxBytes: MAX_EDITOR_BYTES,
          path,
          target: workspaceTarget,
        });
        if (!isCurrentFileRequest(path, requestId)) {
          return;
        }
        setTab(path, (tab) => applyReloadSuccess(tab, response));
        onStatus?.(
          response.binary
            ? {
                kind: "info",
                message: BINARY_WORKSPACE_FILE_PREVIEW_NOTICE.detail,
              }
            : { kind: "info", message: `已重新加载：${path}` },
        );
      } catch (error) {
        if (!isCurrentFileRequest(path, requestId)) {
          return;
        }
        if (isRemoteWorkspaceBinaryFileReadError(error)) {
          setTab(path, applyUnsupportedPreview);
          onStatus?.({
            kind: "info",
            message: BINARY_WORKSPACE_FILE_PREVIEW_NOTICE.detail,
          });
          return;
        }
        const message = errorMessage(error);
        setTab(path, (tab) => applyReloadError(tab, message));
        onStatus?.({ kind: "error", message });
      }
    },
    [beginFileRequest, isCurrentFileRequest, onStatus, setTab, workspaceTarget],
  );

  const closeTabNow = useCallback(
    (path: string) => {
      activeFileRequestByPathRef.current.delete(path);
      setTabs((current) => {
        const nextState = closeFileTabState(current, activePath, path);
        setActivePath(nextState.activePath);
        return nextState.tabs;
      });
    },
    [activePath],
  );

  const requestCloseTab = useCallback(
    (path: string) => {
      const tab = tabsRef.current.find((item) => item.path === path);
      if (tab && isDirtyTab(tab)) {
        setPendingClosePath(path);
        return;
      }
      closeTabNow(path);
    },
    [closeTabNow],
  );

  const openWorkspaceFolder = useCallback(async () => {
    const nextRoot = normalizeRemotePath(rootDraft);
    setWorkspaceRoot(nextRoot);
    setRootDraft(nextRoot);
    setOpenTreePaths(new Set([nextRoot]));
    await onOpenDirectory?.(nextRoot);
    await loadChildren(nextRoot, true);
  }, [loadChildren, onOpenDirectory, rootDraft]);

  const toggleTreeDirectory = useCallback(
    (item: WorkspaceTreeNode) => {
      const opening = !openTreePaths.has(item.path);
      setOpenTreePaths((current) => {
        const next = new Set(current);
        if (next.has(item.path)) {
          next.delete(item.path);
        } else {
          next.add(item.path);
        }
        return next;
      });
      if (opening && !item.loaded && !item.loading) {
        void loadChildren(item.path);
      }
    },
    [loadChildren, openTreePaths],
  );

  const runEditorAction = useCallback((actionId: string) => {
    const action = editorRef.current?.getAction(actionId);
    void action?.run();
    editorRef.current?.focus();
  }, []);

  const runWorkspaceEditorCommand = useCallback(
    async (command: RemoteWorkspaceEditorCommandId) => {
      setEditorContextMenu(null);
      if (!isRemoteWorkspaceEditorCommandEnabled(command, editorCommandState)) {
        return;
      }

      if (command === "save") {
        if (activePath) {
          await saveFile(activePath, Boolean(hasConflict));
        }
        return;
      }
      if (command === "reload") {
        if (activePath) {
          await reloadFile(activePath);
        }
        return;
      }

      await runRemoteWorkspaceEditorMonacoCommand(editorRef.current, command);
    },
    [activePath, editorCommandState, hasConflict, reloadFile, saveFile],
  );

  useEffect(() => {
    runEditorCommandRef.current = (command) => {
      void runWorkspaceEditorCommand(command);
    };
  }, [runWorkspaceEditorCommand]);

  const handleEditorMount = useCallback<MonacoTextEditorMountHandler>(
    (editor, monaco) => {
      editorRef.current = editor;
      registerRemoteWorkspaceEditorKeybindings({
        editor,
        monaco,
        runCommand: (command) => runEditorCommandRef.current(command),
      });
    },
    [],
  );

  useEffect(() => {
    if (!activeTab || activeTab.loading || unsupportedNotice) {
      editorRef.current = null;
      setEditorContextMenu(null);
    }
  }, [activeTab, unsupportedNotice]);

  useEffect(() => {
    const handleTextEditCommand = (event: Event) => {
      const detail = (event as CustomEvent<KerminalTextEditCommandEventDetail>)
        .detail;
      if (!detail || !editorShouldHandleNativeTextEdit(editorRef.current)) {
        return;
      }

      detail.handled = true;
      runEditorCommandRef.current(detail.command);
    };

    window.addEventListener(
      KERMINAL_TEXT_EDIT_COMMAND_EVENT,
      handleTextEditCommand,
    );
    return () => {
      window.removeEventListener(
        KERMINAL_TEXT_EDIT_COMMAND_EVENT,
        handleTextEditCommand,
      );
    };
  }, []);

  const openEditorContextMenu = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (!activeTab || activeTab.loading || unsupportedNotice) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const position = resolveRemoteWorkspaceEditorContextMenuPosition({
        viewportHeight: window.innerHeight,
        viewportWidth: window.innerWidth,
        x: event.clientX,
        y: event.clientY,
      });
      setEditorContextMenu(position);
    },
    [activeTab, unsupportedNotice],
  );

  return (
    <RemoteWorkspaceEditorView
      activePath={activePath}
      activeTab={activeTab}
      closeTabNow={closeTabNow}
      dirtyTabCount={dirtyTabCount}
      editorCommandGroups={editorCommandGroups}
      editorContextMenu={editorContextMenu}
      editorFontOptions={editorFontOptions}
      expanded={expanded}
      handleEditorMount={handleEditorMount}
      hasConflict={Boolean(hasConflict)}
      loadChildren={loadChildren}
      onEditorContextMenu={openEditorContextMenu}
      openFile={openFile}
      openTreePaths={openTreePaths}
      openWorkspaceFolder={openWorkspaceFolder}
      pendingClosePath={pendingClosePath}
      pendingCloseTab={pendingCloseTab}
      reloadFile={reloadFile}
      requestCloseTab={requestCloseTab}
      rootDraft={rootDraft}
      runEditorAction={runEditorAction}
      runWorkspaceEditorCommand={runWorkspaceEditorCommand}
      saveFile={saveFile}
      setActivePath={setActivePath}
      setEditorContextMenu={setEditorContextMenu}
      setPendingClosePath={setPendingClosePath}
      setRootDraft={setRootDraft}
      setTab={setTab}
      tabs={tabs}
      toggleTreeDirectory={toggleTreeDirectory}
      treeNodes={treeNodes}
      treeStatus={treeStatus}
      unsupportedNotice={unsupportedNotice}
      workspaceProtocol={workspaceProtocol}
      workspaceRoot={workspaceRoot}
    />
  );
}

/** 把已知不支持类型或旧后端二进制错误收敛为不可编辑、无正文的稳定 Tab 状态。 */
function applyUnsupportedPreview(tab: OpenFileTab): OpenFileTab {
  return {
    ...tab,
    binary: true,
    content: "",
    encoding: "binary",
    error: null,
    loading: false,
    readonly: true,
    savedContent: "",
    saving: false,
  };
}
