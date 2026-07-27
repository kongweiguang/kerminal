// @author kongweiguang

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  KERMINAL_TEXT_EDIT_COMMAND_EVENT,
  type KerminalTextEditCommandEventDetail,
} from "../../../../src/contracts/textEditCommands";
import { RemoteWorkspaceEditor } from "../../../../src/features/sftp/RemoteWorkspaceEditor";

const sftpApiMocks = vi.hoisted(() => ({
  listSftpDirectory: vi.fn(),
  readSftpTextFile: vi.fn(),
  writeSftpTextFile: vi.fn(),
}));

const containerFilesApiMocks = vi.hoisted(() => ({
  listDockerContainerDirectory: vi.fn(),
  readDockerContainerTextFile: vi.fn(),
  writeDockerContainerTextFile: vi.fn(),
}));

const desktopClipboardApiMocks = vi.hoisted(() => ({
  readDesktopClipboardText: vi.fn(),
  writeDesktopClipboardText: vi.fn(),
}));

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function sftpReadResponse(overrides: Record<string, unknown> = {}) {
  return {
    binary: false,
    bytesRead: 10,
    content: "port=8080\n",
    encoding: "utf-8",
    hostId: "prod-api",
    lineEnding: "lf",
    maxBytes: 1024,
    path: "/etc/app.conf",
    readonly: false,
    revision: {
      contentSha256: "sha-a",
      modified: "Jun 18 16:30",
      permissions: "-rw-r--r--",
      permissionsMode: 420,
      size: 10,
    },
    truncated: false,
    ...overrides,
  };
}

const monacoEditorMocks = vi.hoisted(() => {
  const actionRuns = new Map<string, ReturnType<typeof vi.fn>>();
  const disabledActions = new Set<string>();
  const selection = {
    endColumn: 5,
    endLineNumber: 1,
    isEmpty: vi.fn(() => false),
    positionColumn: 5,
    positionLineNumber: 1,
    selectionStartColumn: 1,
    selectionStartLineNumber: 1,
    startColumn: 1,
    startLineNumber: 1,
  };
  const model = {
    getValueInRange: vi.fn(() => "port"),
  };
  const ensureActionRun = (id: string) => {
    let run = actionRuns.get(id);
    if (!run) {
      run = vi.fn();
      actionRuns.set(id, run);
    }
    return run;
  };
  const editor = {
    addCommand: vi.fn(),
    executeEdits: vi.fn(),
    focus: vi.fn(),
    getAction: vi.fn((id: string) =>
      disabledActions.has(id) ? null : { run: ensureActionRun(id) },
    ),
    getModel: vi.fn(() => model),
    getSelection: vi.fn(() => selection),
    hasTextFocus: vi.fn(() => true),
    pushUndoStop: vi.fn(),
    trigger: vi.fn(),
  };

  return {
    actionRun: ensureActionRun,
    disabledActions,
    editor,
    keyCode: {
      Insert: 52,
      KeyA: 31,
      KeyC: 33,
      KeyF: 36,
      KeyH: 38,
      KeyS: 49,
      KeyV: 55,
      KeyX: 56,
      KeyY: 57,
      KeyZ: 58,
    },
    keyMod: {
      CtrlCmd: 2048,
      Shift: 1024,
    },
    model,
    reset: () => {
      actionRuns.clear();
      disabledActions.clear();
      Object.values(editor).forEach((value) => {
        if (typeof value === "function" && "mockClear" in value) {
          value.mockClear();
        }
      });
      editor.getAction.mockImplementation((id: string) =>
        disabledActions.has(id) ? null : { run: ensureActionRun(id) },
      );
      editor.getModel.mockReturnValue(model);
      editor.getSelection.mockReturnValue(selection);
      editor.hasTextFocus.mockReturnValue(true);
      model.getValueInRange.mockReturnValue("port");
      selection.isEmpty.mockReturnValue(false);
    },
    selection,
  };
});

vi.mock("../../../../src/features/sftp/MonacoTextEditor", () => ({
  MonacoTextEditor: ({
    beforeMount,
    onChange,
    onMount,
    value,
  }: {
    beforeMount?: (monaco: unknown) => void;
    onChange?: (value: string) => void;
    onMount?: (editor: unknown, monaco: unknown) => void;
    value?: string;
  }) => {
    const monaco = {
      KeyCode: monacoEditorMocks.keyCode,
      KeyMod: monacoEditorMocks.keyMod,
      editor: { defineTheme: vi.fn() },
    };
    beforeMount?.(monaco);
    onMount?.(monacoEditorMocks.editor, monaco);
    return (
      <textarea
        aria-label="Monaco 编辑器"
        onChange={(event) => onChange?.(event.target.value)}
        value={value ?? ""}
      />
    );
  },
}));

vi.mock("../../../../src/lib/desktopClipboardApi", () => ({
  readDesktopClipboardText: (...args: unknown[]) =>
    desktopClipboardApiMocks.readDesktopClipboardText(...args),
  writeDesktopClipboardText: (...args: unknown[]) =>
    desktopClipboardApiMocks.writeDesktopClipboardText(...args),
}));

vi.mock("../../../../src/lib/sftpApi", () => ({
  listSftpDirectory: (...args: unknown[]) =>
    sftpApiMocks.listSftpDirectory(...args),
  readSftpTextFile: (...args: unknown[]) =>
    sftpApiMocks.readSftpTextFile(...args),
  writeSftpTextFile: (...args: unknown[]) =>
    sftpApiMocks.writeSftpTextFile(...args),
}));

vi.mock("../../../../src/lib/containerFilesApi", () => ({
  listDockerContainerDirectory: (...args: unknown[]) =>
    containerFilesApiMocks.listDockerContainerDirectory(...args),
  readDockerContainerTextFile: (...args: unknown[]) =>
    containerFilesApiMocks.readDockerContainerTextFile(...args),
  writeDockerContainerTextFile: (...args: unknown[]) =>
    containerFilesApiMocks.writeDockerContainerTextFile(...args),
}));

describe("RemoteWorkspaceEditor", () => {
  beforeEach(() => {
    sftpApiMocks.listSftpDirectory.mockReset();
    sftpApiMocks.readSftpTextFile.mockReset();
    sftpApiMocks.writeSftpTextFile.mockReset();
    containerFilesApiMocks.listDockerContainerDirectory.mockReset();
    containerFilesApiMocks.readDockerContainerTextFile.mockReset();
    containerFilesApiMocks.writeDockerContainerTextFile.mockReset();
    desktopClipboardApiMocks.readDesktopClipboardText.mockReset();
    desktopClipboardApiMocks.writeDesktopClipboardText.mockReset();
    monacoEditorMocks.reset();

    sftpApiMocks.listSftpDirectory.mockImplementation(
      async ({ hostId, path }: { hostId: string; path: string }) => {
        if (path === "/etc") {
          return {
            entries: [
              {
                kind: "file",
                modified: "Jun 18 16:30",
                name: "app.conf",
                path: "/etc/app.conf",
                permissions: "-rw-r--r--",
                raw: "-rw-r--r-- app.conf",
                size: 10,
              },
            ],
            hostId,
            parentPath: "/",
            path,
          };
        }
        return {
          entries: [
            {
              kind: "directory",
              modified: "Jun 18 16:00",
              name: "etc",
              path: "/etc",
              permissions: "drwxr-xr-x",
              raw: "drwxr-xr-x etc",
              size: 4096,
            },
            {
              kind: "file",
              modified: "Jun 18 16:00",
              name: "README.md",
              path: "/README.md",
              permissions: "-rw-r--r--",
              raw: "-rw-r--r-- README.md",
              size: 12,
            },
          ],
          hostId,
          path: "/",
        };
      },
    );
    sftpApiMocks.readSftpTextFile.mockResolvedValue(sftpReadResponse());
    sftpApiMocks.writeSftpTextFile.mockResolvedValue({
      bytesWritten: 10,
      encoding: "utf-8",
      hostId: "prod-api",
      lineEnding: "lf",
      path: "/etc/app.conf",
      revision: {
        contentSha256: "sha-b",
        modified: "Jun 18 16:31",
        permissions: "-rw-r--r--",
        permissionsMode: 420,
        size: 10,
      },
    });
    containerFilesApiMocks.listDockerContainerDirectory.mockResolvedValue({
      containerId: "container-api",
      entries: [
        {
          kind: "file",
          modified: "Jun 18 16:00",
          name: "package.json",
          path: "/app/package.json",
          permissions: "-rw-r--r--",
          raw: "-rw-r--r-- package.json",
          size: 18,
        },
      ],
      hostId: "prod-api",
      path: "/app",
    });
    containerFilesApiMocks.readDockerContainerTextFile.mockResolvedValue({
      binary: false,
      bytesRead: 18,
      containerId: "container-api",
      content: '{"name":"api"}\n',
      encoding: "utf-8",
      hostId: "prod-api",
      lineEnding: "lf",
      maxBytes: 1024,
      path: "/app/package.json",
      readonly: false,
      revision: {
        contentSha256: "container-sha-a",
        modified: "Jun 18 16:00",
        permissions: "-rw-r--r--",
        permissionsMode: 420,
        size: 18,
      },
      truncated: false,
    });
    containerFilesApiMocks.writeDockerContainerTextFile.mockResolvedValue({
      bytesWritten: 19,
      containerId: "container-api",
      encoding: "utf-8",
      hostId: "prod-api",
      lineEnding: "lf",
      path: "/app/package.json",
      revision: {
        contentSha256: "container-sha-b",
        modified: "Jun 18 16:01",
        permissions: "-rw-r--r--",
        permissionsMode: 420,
        size: 19,
      },
    });
    desktopClipboardApiMocks.readDesktopClipboardText.mockResolvedValue(
      "pasted=true",
    );
    desktopClipboardApiMocks.writeDesktopClipboardText.mockResolvedValue(
      undefined,
    );
  });

  it("registers editor shortcuts only while Monaco text has focus", async () => {
    const user = userEvent.setup();

    render(<RemoteWorkspaceEditor hostId="prod-api" rootPath="/" />);

    await user.click(await screen.findByRole("treeitem", { name: "etc" }));
    await user.click(await screen.findByRole("treeitem", { name: "app.conf" }));
    await screen.findByLabelText("Monaco 编辑器");

    expect(monacoEditorMocks.editor.addCommand).toHaveBeenCalledWith(
      monacoEditorMocks.keyMod.CtrlCmd | monacoEditorMocks.keyCode.KeyS,
      expect.any(Function),
      "editorTextFocus",
    );
    expect(monacoEditorMocks.editor.addCommand).toHaveBeenCalledWith(
      monacoEditorMocks.keyMod.CtrlCmd | monacoEditorMocks.keyCode.KeyC,
      expect.any(Function),
      "editorTextFocus",
    );
    expect(monacoEditorMocks.editor.addCommand).toHaveBeenCalledWith(
      monacoEditorMocks.keyMod.CtrlCmd | monacoEditorMocks.keyCode.KeyV,
      expect.any(Function),
      "editorTextFocus",
    );
    expect(monacoEditorMocks.editor.addCommand).toHaveBeenCalledWith(
      monacoEditorMocks.keyMod.CtrlCmd | monacoEditorMocks.keyCode.KeyZ,
      expect.any(Function),
      "editorTextFocus",
    );
    expect(monacoEditorMocks.editor.addCommand).toHaveBeenCalledWith(
      monacoEditorMocks.keyMod.CtrlCmd |
        monacoEditorMocks.keyMod.Shift |
        monacoEditorMocks.keyCode.KeyZ,
      expect.any(Function),
      "editorTextFocus",
    );
  });

  it("blocks known non-text files before starting a remote read", async () => {
    render(
      <RemoteWorkspaceEditor
        hostId="prod-api"
        openCommand={{ nonce: 1, path: "/contracts/agreement.PDF" }}
        rootPath="/"
      />,
    );

    expect(await screen.findByText("此文件不支持文本预览")).toBeVisible();
    expect(
      screen.getByText(
        "PDF 或电子书文件不能在文本编辑器中预览，可下载后使用对应阅读应用查看。",
      ),
    ).toBeVisible();
    expect(sftpApiMocks.readSftpTextFile).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Monaco 编辑器")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重新加载" })).toBeDisabled();
  });

  it("shows unknown binary content as unsupported and releases the stale editor", async () => {
    sftpApiMocks.readSftpTextFile
      .mockResolvedValueOnce(sftpReadResponse())
      .mockResolvedValueOnce(
        sftpReadResponse({
          binary: true,
          bytesRead: 4096,
          content: "",
          encoding: "binary",
          path: "/srv/blob.unknown",
          readonly: true,
          revision: {
            contentSha256: "sha-binary",
            size: 4096,
          },
        }),
      );
    const view = render(
      <RemoteWorkspaceEditor
        hostId="prod-api"
        openCommand={{ nonce: 1, path: "/etc/app.conf" }}
        rootPath="/"
      />,
    );
    await screen.findByLabelText("Monaco 编辑器");

    view.rerender(
      <RemoteWorkspaceEditor
        hostId="prod-api"
        openCommand={{ nonce: 2, path: "/srv/blob.unknown" }}
        rootPath="/"
      />,
    );

    expect(await screen.findByText("此文件不支持文本预览")).toBeVisible();
    expect(
      screen.getByText(
        "已检测到二进制内容，Kerminal 未将文件加载到文本编辑器。",
      ),
    ).toBeVisible();
    expect(screen.queryByLabelText("Monaco 编辑器")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "查找" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "替换" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "重新加载" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();

    const detail: KerminalTextEditCommandEventDetail = {
      command: "selectAll",
      handled: false,
    };
    window.dispatchEvent(
      new CustomEvent<KerminalTextEditCommandEventDetail>(
        KERMINAL_TEXT_EDIT_COMMAND_EVENT,
        { detail },
      ),
    );
    expect(detail.handled).toBe(false);
  });

  it("ignores a stale reload after the same path is closed and reopened", async () => {
    const user = userEvent.setup();
    const staleReload = createDeferred<ReturnType<typeof sftpReadResponse>>();
    sftpApiMocks.readSftpTextFile
      .mockResolvedValueOnce(sftpReadResponse())
      .mockImplementationOnce(() => staleReload.promise)
      .mockResolvedValueOnce(
        sftpReadResponse({
          content: "port=9090\n",
          revision: {
            contentSha256: "sha-new",
            modified: "Jun 18 16:35",
            permissions: "-rw-r--r--",
            permissionsMode: 420,
            size: 10,
          },
        }),
      );
    const view = render(
      <RemoteWorkspaceEditor
        hostId="prod-api"
        openCommand={{ nonce: 1, path: "/etc/app.conf" }}
        rootPath="/"
      />,
    );
    await screen.findByDisplayValue("port=8080");

    await user.click(screen.getByRole("button", { name: "重新加载" }));
    expect(await screen.findByText("正在打开 app.conf...")).toBeVisible();
    await user.click(screen.getByLabelText("关闭 app.conf"));
    await waitFor(() =>
      expect(screen.queryByLabelText("关闭 app.conf")).not.toBeInTheDocument(),
    );

    view.rerender(
      <RemoteWorkspaceEditor
        hostId="prod-api"
        openCommand={{ nonce: 2, path: "/etc/app.conf" }}
        rootPath="/"
      />,
    );
    expect(await screen.findByDisplayValue("port=9090")).toBeVisible();

    staleReload.resolve(
      sftpReadResponse({
        content: "port=7000\n",
        revision: {
          contentSha256: "sha-stale",
          modified: "Jun 18 16:33",
          permissions: "-rw-r--r--",
          permissionsMode: 420,
          size: 10,
        },
      }),
    );
    await waitFor(() =>
      expect(screen.getByLabelText("Monaco 编辑器")).toHaveValue("port=9090\n"),
    );
  });

  it("loads a remote tree, opens a text file, and saves edits", async () => {
    const user = userEvent.setup();
    const onStatus = vi.fn();

    render(
      <RemoteWorkspaceEditor
        hostId="prod-api"
        onStatus={onStatus}
        rootPath="/"
      />,
    );

    await user.click(await screen.findByRole("treeitem", { name: "etc" }));
    await user.click(await screen.findByRole("treeitem", { name: "app.conf" }));
    const editor = await screen.findByLabelText("Monaco 编辑器");
    await user.clear(editor);
    await user.type(editor, "port=9090\n");
    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(sftpApiMocks.writeSftpTextFile).toHaveBeenCalledWith({
        content: "port=9090\n",
        create: false,
        encoding: "utf-8",
        expectedRevision: {
          contentSha256: "sha-a",
          modified: "Jun 18 16:30",
          permissions: "-rw-r--r--",
          permissionsMode: 420,
          size: 10,
        },
        hostId: "prod-api",
        overwriteOnConflict: false,
        path: "/etc/app.conf",
      }),
    );
    expect(onStatus).toHaveBeenLastCalledWith({
      kind: "success",
      message: "已保存：/etc/app.conf",
    });
  });

  it("opens an editor context menu and runs Monaco copy", async () => {
    const user = userEvent.setup();

    render(<RemoteWorkspaceEditor hostId="prod-api" rootPath="/" />);

    await user.click(await screen.findByRole("treeitem", { name: "etc" }));
    await user.click(await screen.findByRole("treeitem", { name: "app.conf" }));
    const editor = await screen.findByLabelText("Monaco 编辑器");

    fireEvent.contextMenu(editor, { clientX: 88, clientY: 96 });
    await user.click(await screen.findByRole("menuitem", { name: /复制/ }));

    await waitFor(() =>
      expect(
        monacoEditorMocks.actionRun("editor.action.clipboardCopyAction"),
      ).toHaveBeenCalled(),
    );
    expect(
      screen.queryByRole("menu", { name: "app.conf 编辑菜单" }),
    ).not.toBeInTheDocument();
  });

  it("routes native text edit commands to the focused editor", async () => {
    const user = userEvent.setup();

    render(<RemoteWorkspaceEditor hostId="prod-api" rootPath="/" />);

    await user.click(await screen.findByRole("treeitem", { name: "etc" }));
    await user.click(await screen.findByRole("treeitem", { name: "app.conf" }));
    await screen.findByLabelText("Monaco 编辑器");

    const detail: KerminalTextEditCommandEventDetail = {
      command: "selectAll",
      handled: false,
    };
    window.dispatchEvent(
      new CustomEvent<KerminalTextEditCommandEventDetail>(
        KERMINAL_TEXT_EDIT_COMMAND_EVENT,
        { detail },
      ),
    );

    expect(detail.handled).toBe(true);
    await waitFor(() =>
      expect(
        monacoEditorMocks.actionRun("editor.action.selectAll"),
      ).toHaveBeenCalled(),
    );
  });

  it("falls back to desktop clipboard paste when Monaco paste is unavailable", async () => {
    const user = userEvent.setup();
    monacoEditorMocks.disabledActions.add("editor.action.clipboardPasteAction");

    render(<RemoteWorkspaceEditor hostId="prod-api" rootPath="/" />);

    await user.click(await screen.findByRole("treeitem", { name: "etc" }));
    await user.click(await screen.findByRole("treeitem", { name: "app.conf" }));
    await screen.findByLabelText("Monaco 编辑器");

    const detail: KerminalTextEditCommandEventDetail = {
      command: "paste",
      handled: false,
    };
    window.dispatchEvent(
      new CustomEvent<KerminalTextEditCommandEventDetail>(
        KERMINAL_TEXT_EDIT_COMMAND_EVENT,
        { detail },
      ),
    );

    expect(detail.handled).toBe(true);
    await waitFor(() =>
      expect(monacoEditorMocks.editor.executeEdits).toHaveBeenCalledWith(
        "kerminal-paste",
        [
          {
            forceMoveMarkers: true,
            range: monacoEditorMocks.selection,
            text: "pasted=true",
          },
        ],
      ),
    );
    expect(monacoEditorMocks.editor.pushUndoStop).toHaveBeenCalledTimes(2);
  });

  it("uses container file APIs when editing a container workspace", async () => {
    const user = userEvent.setup();

    render(
      <RemoteWorkspaceEditor
        rootPath="/app"
        target={{
          containerId: "container-api",
          hostId: "prod-api",
          kind: "dockerContainer",
          runtime: "docker",
        }}
      />,
    );

    await user.click(
      await screen.findByRole("treeitem", { name: "package.json" }),
    );
    const editor = await screen.findByLabelText("Monaco 编辑器");
    await user.clear(editor);
    fireEvent.change(editor, { target: { value: '{"name":"api2"}\n' } });
    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(
        containerFilesApiMocks.writeDockerContainerTextFile,
      ).toHaveBeenCalledWith({
        containerId: "container-api",
        content: '{"name":"api2"}\n',
        create: false,
        encoding: "utf-8",
        expectedRevision: {
          contentSha256: "container-sha-a",
          modified: "Jun 18 16:00",
          permissions: "-rw-r--r--",
          permissionsMode: 420,
          size: 18,
        },
        hostId: "prod-api",
        overwriteOnConflict: false,
        path: "/app/package.json",
        runtime: "docker",
      }),
    );
    expect(sftpApiMocks.writeSftpTextFile).not.toHaveBeenCalled();
  });

  it("offers overwrite save after a remote revision conflict", async () => {
    const user = userEvent.setup();
    sftpApiMocks.writeSftpTextFile
      .mockRejectedValueOnce(
        new Error("远端文件已变更，请重新加载或选择覆盖后再保存"),
      )
      .mockResolvedValueOnce({
        bytesWritten: 10,
        encoding: "utf-8",
        hostId: "prod-api",
        lineEnding: "lf",
        path: "/etc/app.conf",
        revision: {
          contentSha256: "sha-c",
          modified: "Jun 18 16:32",
          permissions: "-rw-r--r--",
          permissionsMode: 420,
          size: 10,
        },
      });

    render(<RemoteWorkspaceEditor hostId="prod-api" rootPath="/" />);

    await user.click(await screen.findByRole("treeitem", { name: "etc" }));
    await user.click(await screen.findByRole("treeitem", { name: "app.conf" }));
    const editor = await screen.findByLabelText("Monaco 编辑器");
    await user.clear(editor);
    await user.type(editor, "port=9090\n");
    await user.click(screen.getByRole("button", { name: "保存" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "远端文件已变更",
    );
    await user.click(screen.getByRole("button", { name: "覆盖保存" }));

    await waitFor(() =>
      expect(sftpApiMocks.writeSftpTextFile).toHaveBeenLastCalledWith(
        expect.objectContaining({
          overwriteOnConflict: true,
          path: "/etc/app.conf",
        }),
      ),
    );
  });

  it("confirms before closing a dirty tab and can save before closing", async () => {
    const user = userEvent.setup();

    render(<RemoteWorkspaceEditor hostId="prod-api" rootPath="/" />);

    await user.click(await screen.findByRole("treeitem", { name: "etc" }));
    await user.click(await screen.findByRole("treeitem", { name: "app.conf" }));
    const editor = await screen.findByLabelText("Monaco 编辑器");
    await user.clear(editor);
    await user.type(editor, "port=9090\n");
    await user.click(screen.getByLabelText("关闭 app.conf"));

    expect(
      screen.getByRole("dialog", { name: "关闭未保存文件" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "保存后关闭" }));

    await waitFor(() =>
      expect(sftpApiMocks.writeSftpTextFile).toHaveBeenCalledWith(
        expect.objectContaining({
          content: "port=9090\n",
          path: "/etc/app.conf",
        }),
      ),
    );
    await waitFor(() =>
      expect(screen.queryByLabelText("关闭 app.conf")).not.toBeInTheDocument(),
    );
  });
});
