import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import type * as Monaco from "monaco-editor";
import {
  AlertTriangle,
  FileText,
  RefreshCw,
  Replace,
  Save,
  Search,
} from "lucide-react";
import {
  KERMINAL_TEXT_EDIT_COMMAND_EVENT,
  type KerminalTextEditCommandEventDetail,
} from "../../contracts/textEditCommands";
import { Button } from "../../components/ui/button";
import { UserFacingNotice } from "../../components/ui/user-facing-notice";
import { cn } from "../../lib/cn";
import { configureKerminalMonaco } from "../../lib/monacoTheme";
import type { RemoteTargetRef } from "../../lib/targetModel";
import {
  buildUserFacingError,
  type UserFacingMessage,
} from "../../lib/userFacingMessage";
import { defaultTerminalAppearance } from "../settings/defaults/index";
import {
  terminalFontWeightValue,
  type TerminalAppearance,
} from "../settings/contracts/index";
import {
  MonacoTextEditor,
  type MonacoTextEditorMountHandler,
} from "../sftp/editor/index";
import {
  activeTabStatus,
  applyReloadError,
  applyReloadSuccess,
  applySaveError,
  applySaveSuccess,
  cleanSaveStatus,
  createLoadedTab,
  createLoadingTab,
  errorMessage,
  isDirtyTab,
  readonlySaveStatus,
  startReloadingTab,
  startSavingTab,
  type OpenFileTab,
  type RemoteWorkspaceStatus,
} from "../sftp/editor/index";
import {
  buildRemoteWorkspaceEditorCommandGroups,
  isRemoteWorkspaceEditorCommandEnabled,
  resolveRemoteWorkspaceEditorContextMenuPosition,
  type RemoteWorkspaceEditorCommandId,
} from "../sftp/editor/index";
import {
  editorShouldHandleNativeTextEdit,
  registerRemoteWorkspaceEditorKeybindings,
  runRemoteWorkspaceEditorMonacoCommand,
} from "../sftp/editor/index";
import { RemoteWorkspaceEditorContextMenu } from "../sftp/editor/index";
import {
  isRemoteWorkspaceBinaryFileReadError,
  readRemoteWorkspaceTextFile,
  writeRemoteWorkspaceTextFile,
  type RemoteWorkspaceReadTextFileResponse,
} from "../sftp/editor/index";
import { resolveWorkspaceFilePreviewPolicy } from "../sftp/editor/index";
import {
  BINARY_WORKSPACE_FILE_PREVIEW_NOTICE,
  buildWorkspaceFilePreviewUnsupportedNotice,
} from "../sftp/editor/index";
import {
  WORKSPACE_FILE_TAB_COMMAND_EVENT,
  type WorkspaceFileTabCommandEventDetail,
} from "./workspaceFileTabActions";
import type { WorkspaceFileTab } from "./types";

const MAX_FILE_BYTES = 10 * 1024 * 1024;

export interface WorkspaceFileTabSurfaceProps {
  active: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  tab: WorkspaceFileTab;
  terminalAppearance?: TerminalAppearance;
}

export function WorkspaceFileTabSurface({
  active,
  onDirtyChange,
  tab,
  terminalAppearance = defaultTerminalAppearance,
}: WorkspaceFileTabSurfaceProps) {
  const [fileTab, setFileTab] = useState<OpenFileTab | null>(null);
  const [status, setStatus] = useState<RemoteWorkspaceStatus | null>(null);
  const [errorNotice, setErrorNotice] = useState<UserFacingMessage | null>(
    null,
  );
  const [readFailureNotice, setReadFailureNotice] =
    useState<UserFacingMessage | null>(null);
  const [contentUnsupportedNotice, setContentUnsupportedNotice] =
    useState<UserFacingMessage | null>(null);
  const [editorContextMenu, setEditorContextMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const requestIdRef = useRef(0);
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const onDirtyChangeRef = useRef(onDirtyChange);
  const runEditorCommandRef = useRef<
    (command: RemoteWorkspaceEditorCommandId) => void
  >(() => undefined);
  const targetLabel = useMemo(
    () => labelForWorkspaceFileTarget(tab.target),
    [tab.target],
  );
  const pathPreviewDecision = useMemo(
    () => resolveWorkspaceFilePreviewPolicy(tab.path),
    [tab.path],
  );
  const pathUnsupportedNotice = useMemo<UserFacingMessage | null>(
    () =>
      pathPreviewDecision.kind === "unsupported"
        ? buildWorkspaceFilePreviewUnsupportedNotice(pathPreviewDecision)
        : null,
    [pathPreviewDecision],
  );
  const unsupportedNotice =
    pathUnsupportedNotice ??
    contentUnsupportedNotice ??
    (fileTab?.binary ? BINARY_WORKSPACE_FILE_PREVIEW_NOTICE : null);
  const dirty = fileTab ? isDirtyTab(fileTab) : false;
  const hasConflict =
    fileTab?.error?.includes("远端文件已变更") ||
    fileTab?.error?.includes("conflict");
  const readonly = fileTab?.readonly ?? tab.access === "readonly";
  const editorCommandState = useMemo(
    () => ({
      dirty,
      hasConflict: Boolean(hasConflict),
      hasEditor: Boolean(fileTab && !fileTab.loading && !unsupportedNotice),
      loading: Boolean(fileTab?.loading),
      readOnly: readonly,
      saving: Boolean(fileTab?.saving),
    }),
    [dirty, fileTab, hasConflict, readonly, unsupportedNotice],
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

  const loadFile = useCallback(async () => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setStatus(null);
    setErrorNotice(null);
    setReadFailureNotice(null);
    setContentUnsupportedNotice(null);
    if (pathPreviewDecision.kind === "unsupported") {
      setFileTab(null);
      return;
    }
    setFileTab(createLoadingTab(tab.path));
    try {
      const response = await readRemoteWorkspaceTextFile({
        maxBytes: MAX_FILE_BYTES,
        path: tab.path,
        target: tab.target,
      });
      if (requestIdRef.current !== requestId) {
        return;
      }
      if (response.binary) {
        setFileTab(null);
        setContentUnsupportedNotice(BINARY_WORKSPACE_FILE_PREVIEW_NOTICE);
        return;
      }
      setFileTab(
        createWorkspaceLoadedTab(
          { access: tab.access, path: tab.path },
          response,
        ),
      );
    } catch (error) {
      if (requestIdRef.current !== requestId) {
        return;
      }
      if (isRemoteWorkspaceBinaryFileReadError(error)) {
        setFileTab(null);
        setContentUnsupportedNotice(BINARY_WORKSPACE_FILE_PREVIEW_NOTICE);
        return;
      }
      const message = errorMessage(error);
      const notice = buildUserFacingError(error, {
        recoveryAction: "请检查连接和文件权限后重试。",
        title: "文件读取失败",
      });
      setFileTab({
        ...createLoadingTab(tab.path),
        error: message,
        loading: false,
        readonly: true,
      });
      setStatus({ kind: "error", message: notice.title });
      setReadFailureNotice(notice);
    }
  }, [pathPreviewDecision.kind, tab.access, tab.path, tab.target]);

  const saveFile = useCallback(
    async (overwriteOnConflict = false) => {
      if (!fileTab || fileTab.loading || fileTab.saving) {
        return false;
      }
      const readonlyStatus = readonlySaveStatus(fileTab);
      if (readonlyStatus) {
        setFileTab((current) =>
          current ? { ...current, error: readonlyStatus.message } : current,
        );
        setStatus(readonlyStatus);
        return false;
      }
      const cleanStatus = cleanSaveStatus(fileTab, overwriteOnConflict);
      if (cleanStatus) {
        setStatus(cleanStatus);
        return true;
      }

      setFileTab(startSavingTab(fileTab));
      setErrorNotice(null);
      try {
        const response = await writeRemoteWorkspaceTextFile({
          content: fileTab.content,
          expectedRevision: fileTab.revision,
          overwriteOnConflict,
          path: tab.path,
          target: tab.target,
        });
        setFileTab((current) =>
          current ? applySaveSuccess(current, response) : current,
        );
        setStatus({ kind: "success", message: `已保存 ${fileTab.name}` });
        setErrorNotice(null);
        return true;
      } catch (error) {
        const message = errorMessage(error);
        const notice = buildUserFacingError(error, {
          recoveryAction: "请检查连接、权限或文件冲突后重试。",
          title: "文件保存失败",
        });
        setFileTab((current) =>
          current ? applySaveError(current, message) : current,
        );
        setStatus({ kind: "error", message: notice.title });
        setErrorNotice(notice);
        return false;
      }
    },
    [fileTab, tab.path, tab.target],
  );

  const reloadFile = useCallback(async () => {
    if (unsupportedNotice) {
      return;
    }
    if (!fileTab || fileTab.loading) {
      await loadFile();
      return;
    }
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setStatus(null);
    setErrorNotice(null);
    setReadFailureNotice(null);
    setContentUnsupportedNotice(null);
    setFileTab(startReloadingTab(fileTab));
    try {
      const response = await readRemoteWorkspaceTextFile({
        maxBytes: MAX_FILE_BYTES,
        path: tab.path,
        target: tab.target,
      });
      if (requestIdRef.current !== requestId) {
        return;
      }
      if (response.binary) {
        setFileTab(null);
        setContentUnsupportedNotice(BINARY_WORKSPACE_FILE_PREVIEW_NOTICE);
        return;
      }
      setFileTab((current) =>
        current
          ? normalizeLoadedAccess(tab, applyReloadSuccess(current, response))
          : current,
      );
      setStatus({ kind: "info", message: `已重新加载 ${fileTab.name}` });
      setErrorNotice(null);
    } catch (error) {
      if (requestIdRef.current !== requestId) {
        return;
      }
      if (isRemoteWorkspaceBinaryFileReadError(error)) {
        setFileTab(null);
        setStatus(null);
        setContentUnsupportedNotice(BINARY_WORKSPACE_FILE_PREVIEW_NOTICE);
        return;
      }
      const message = errorMessage(error);
      const notice = buildUserFacingError(error, {
        recoveryAction: "请检查连接后重试。",
        title: "文件重新加载失败",
      });
      setFileTab((current) =>
        current ? applyReloadError(current, message) : current,
      );
      setStatus({ kind: "error", message: notice.title });
      setErrorNotice(notice);
    }
  }, [fileTab, loadFile, tab, unsupportedNotice]);

  const runEditorCommand = useCallback(
    async (command: RemoteWorkspaceEditorCommandId) => {
      setEditorContextMenu(null);
      if (!isRemoteWorkspaceEditorCommandEnabled(command, editorCommandState)) {
        return;
      }

      if (command === "save") {
        await saveFile(Boolean(hasConflict));
        return;
      }
      if (command === "reload") {
        await reloadFile();
        return;
      }
      await runRemoteWorkspaceEditorMonacoCommand(editorRef.current, command);
    },
    [editorCommandState, hasConflict, reloadFile, saveFile],
  );

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
    if (!active) {
      return;
    }
    void loadFile();
  }, [active, loadFile]);

  useEffect(() => {
    onDirtyChangeRef.current = onDirtyChange;
  }, [onDirtyChange]);

  useEffect(() => {
    setFileTab(null);
    setStatus(null);
    setErrorNotice(null);
    setReadFailureNotice(null);
    setContentUnsupportedNotice(null);
    setEditorContextMenu(null);
    onDirtyChangeRef.current?.(false);
  }, [tab.id, tab.path]);

  useEffect(() => {
    onDirtyChangeRef.current?.(dirty);
  }, [dirty]);

  useEffect(() => () => onDirtyChangeRef.current?.(false), []);

  useEffect(() => {
    if (!fileTab || fileTab.loading || unsupportedNotice || readFailureNotice) {
      editorRef.current = null;
    }
  }, [fileTab, readFailureNotice, unsupportedNotice]);

  useEffect(() => {
    runEditorCommandRef.current = (command) => {
      void runEditorCommand(command);
    };
  }, [runEditorCommand]);

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

  useEffect(() => {
    const handleWorkspaceFileCommand = (event: Event) => {
      const detail = (event as CustomEvent<WorkspaceFileTabCommandEventDetail>)
        .detail;
      if (!detail || detail.tabId !== tab.id) {
        return;
      }
      if (detail.command === "reload") {
        void reloadFile();
      }
    };

    window.addEventListener(
      WORKSPACE_FILE_TAB_COMMAND_EVENT,
      handleWorkspaceFileCommand,
    );
    return () => {
      window.removeEventListener(
        WORKSPACE_FILE_TAB_COMMAND_EVENT,
        handleWorkspaceFileCommand,
      );
    };
  }, [reloadFile, tab.id]);

  const inlineStatus = status ?? activeTabStatus(fileTab);
  const openEditorContextMenu = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (!fileTab || fileTab.loading) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      setEditorContextMenu(
        resolveRemoteWorkspaceEditorContextMenuPosition({
          viewportHeight: window.innerHeight,
          viewportWidth: window.innerWidth,
          x: event.clientX,
          y: event.clientY,
        }),
      );
    },
    [fileTab],
  );

  return (
    <>
      <section
        aria-label={`文件 ${tab.title}`}
        className="kerminal-solid-surface flex h-full min-h-0 flex-col overflow-hidden rounded-[var(--radius-card)] border text-zinc-900 dark:text-zinc-100"
        data-testid="workspace-file-tab-surface"
      >
        <header className="flex shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] px-3 py-2">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-sky-500/20 bg-sky-500/10 text-sky-700 dark:border-sky-300/20 dark:bg-sky-300/10 dark:text-sky-300">
            <FileText className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{tab.title}</div>
            <div className="truncate font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
              {targetLabel} · {tab.path}
            </div>
          </div>
          {inlineStatus && !errorNotice && !readFailureNotice ? (
            <span
              className="sr-only"
              role={inlineStatus.kind === "error" ? "alert" : "status"}
            >
              {inlineStatus.message}
            </span>
          ) : null}
          <div
            aria-label="文件操作"
            className="flex shrink-0 items-center gap-0.5"
            role="group"
          >
            <Button
              aria-label="查找"
              className="h-8 w-8 rounded-lg"
              disabled={
                !fileTab || fileTab.loading || Boolean(unsupportedNotice)
              }
              onClick={() => runEditorCommandRef.current("find")}
              size="icon"
              title="查找"
              type="button"
              variant="ghost"
            >
              <Search className="h-3.5 w-3.5" />
            </Button>
            <Button
              aria-label="替换"
              className="h-8 w-8 rounded-lg"
              disabled={!fileTab || fileTab.loading || readonly}
              onClick={() => runEditorCommandRef.current("replace")}
              size="icon"
              title="替换"
              type="button"
              variant="ghost"
            >
              <Replace className="h-3.5 w-3.5" />
            </Button>
            <span
              aria-hidden="true"
              className="mx-1 h-4 w-px bg-[var(--border-subtle)]"
            />
            <Button
              aria-label="重新加载文件"
              className="h-8 w-8 rounded-lg"
              disabled={
                Boolean(unsupportedNotice) ||
                !fileTab ||
                fileTab.loading ||
                fileTab.saving
              }
              onClick={() => void reloadFile()}
              size="icon"
              title="重新加载"
              type="button"
              variant="ghost"
            >
              <RefreshCw
                className={cn(
                  "h-3.5 w-3.5",
                  fileTab?.loading && "animate-spin",
                )}
              />
            </Button>
            {hasConflict ? (
              <Button
                aria-label="覆盖保存"
                className="h-8 w-8 rounded-lg text-amber-600 dark:text-amber-300"
                disabled={!fileTab || fileTab.saving}
                onClick={() => void saveFile(true)}
                size="icon"
                title="远端文件已变化，覆盖保存"
                type="button"
                variant="ghost"
              >
                <AlertTriangle className="h-3.5 w-3.5" />
              </Button>
            ) : null}
            <Button
              aria-label="保存文件"
              className="h-8 w-8 rounded-lg"
              disabled={
                !fileTab ||
                fileTab.loading ||
                fileTab.saving ||
                readonly ||
                !dirty
              }
              onClick={() => void saveFile()}
              size="icon"
              title={readonly ? "只读文件" : dirty ? "保存" : "已保存"}
              type="button"
              variant="primary"
            >
              {fileTab?.saving ? (
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
            </Button>
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-hidden">
          {unsupportedNotice ? (
            <div className="grid h-full place-items-center p-4">
              <UserFacingNotice
                className="w-full max-w-md"
                compact
                message={unsupportedNotice}
              />
            </div>
          ) : !fileTab || fileTab.loading ? (
            <WorkspaceFileMessage
              icon={<RefreshCw className="h-4 w-4 animate-spin" />}
              message="正在读取文件..."
            />
          ) : readFailureNotice ? (
            <div className="grid h-full place-items-center p-4">
              <UserFacingNotice compact message={readFailureNotice}>
                <Button
                  className="h-8 rounded-md px-2 text-xs"
                  onClick={() => void loadFile()}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  重试
                </Button>
              </UserFacingNotice>
            </div>
          ) : (
            <WorkspaceFileEditorContent
              editorFontOptions={editorFontOptions}
              errorNotice={errorNotice}
              onChange={(value) => {
                setErrorNotice(null);
                setFileTab((current) =>
                  current
                    ? { ...current, content: value, error: null }
                    : current,
                );
              }}
              onContextMenu={openEditorContextMenu}
              onMount={handleEditorMount}
              tab={fileTab}
            />
          )}
        </div>
      </section>
      {editorContextMenu && fileTab ? (
        <RemoteWorkspaceEditorContextMenu
          groups={editorCommandGroups}
          onAction={(command) => void runEditorCommand(command)}
          onClose={() => setEditorContextMenu(null)}
          position={editorContextMenu}
          title={fileTab.name}
        />
      ) : null}
    </>
  );
}

function WorkspaceFileEditorContent({
  editorFontOptions,
  errorNotice,
  onChange,
  onContextMenu,
  onMount,
  tab,
}: {
  editorFontOptions: {
    fontFamily: string;
    fontSize: number;
    fontWeight: string;
  };
  errorNotice: UserFacingMessage | null;
  onChange: (value: string) => void;
  onContextMenu: (event: MouseEvent<HTMLDivElement>) => void;
  onMount: MonacoTextEditorMountHandler;
  tab: OpenFileTab;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      {errorNotice ? (
        <UserFacingNotice
          className="m-2 mb-0 shrink-0"
          compact
          message={errorNotice}
        />
      ) : null}
      <div
        className="min-h-0 flex-1 bg-zinc-950"
        data-kerminal-text-editor
        onContextMenu={onContextMenu}
      >
        <MonacoTextEditor
          beforeMount={configureKerminalMonaco}
          height="100%"
          language={tab.language}
          onChange={onChange}
          onMount={onMount}
          options={{
            automaticLayout: true,
            contextmenu: false,
            fontFamily: editorFontOptions.fontFamily,
            fontSize: editorFontOptions.fontSize,
            fontWeight: editorFontOptions.fontWeight,
            minimap: { enabled: true },
            padding: { bottom: 12, top: 12 },
            readOnly: tab.readonly,
            renderLineHighlight: "all",
            renderWhitespace: "selection",
            scrollBeyondLastLine: false,
            smoothScrolling: true,
            tabSize: 2,
            wordWrap: "on",
          }}
          path={tab.path}
          theme="kerminal-dark"
          value={tab.content}
        />
      </div>
    </div>
  );
}

function WorkspaceFileMessage({
  action,
  icon,
  message,
  tone = "muted",
}: {
  action?: ReactNode;
  icon: ReactNode;
  message: string;
  tone?: "danger" | "muted";
}) {
  return (
    <div
      className={cn(
        "flex h-full min-h-0 items-center justify-center gap-3 px-4 text-sm",
        tone === "danger"
          ? "text-rose-700 dark:text-rose-300"
          : "text-zinc-500 dark:text-zinc-400",
      )}
    >
      {icon}
      <span>{message}</span>
      {action}
    </div>
  );
}

function labelForWorkspaceFileTarget(target: RemoteTargetRef): string {
  if (target.kind === "dockerContainer") {
    return `${target.runtime ?? "docker"}:${target.hostId}:${target.containerName ?? target.containerId}`;
  }
  if (target.kind === "ssh") {
    return `ssh:${target.hostId}`;
  }
  if (target.kind === "local") {
    return target.profileId ? `local:${target.profileId}` : "local";
  }
  return `${target.kind}:${target.hostId}`;
}

function createWorkspaceLoadedTab(
  workspaceTab: Pick<WorkspaceFileTab, "access" | "path">,
  response: RemoteWorkspaceReadTextFileResponse,
) {
  return normalizeLoadedAccess(
    workspaceTab,
    createLoadedTab(workspaceTab.path, response),
  );
}

function normalizeLoadedAccess(
  workspaceTab: Pick<WorkspaceFileTab, "access">,
  fileTab: OpenFileTab,
): OpenFileTab {
  if (workspaceTab.access === "editable") {
    return fileTab;
  }
  return {
    ...fileTab,
    readonly: true,
  };
}
