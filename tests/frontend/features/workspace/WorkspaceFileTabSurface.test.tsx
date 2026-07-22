import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  KERMINAL_TEXT_EDIT_COMMAND_EVENT,
  type KerminalTextEditCommandEventDetail,
} from "../../../../src/contracts/textEditCommands";
import { WorkspaceFileTabSurface } from "../../../../src/features/workspace/WorkspaceFileTabSurface";
import type { WorkspaceFileTab } from "../../../../src/features/workspace/types";

const transportMocks = vi.hoisted(() => ({
  readRemoteWorkspaceTextFile: vi.fn(),
  writeRemoteWorkspaceTextFile: vi.fn(),
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

const monacoEditorMocks = vi.hoisted(() => {
  const editor = {
    addCommand: vi.fn(),
    focus: vi.fn(),
    getAction: vi.fn((id: string) => ({ run: vi.fn(), id })),
    getModel: vi.fn(() => ({ getValueInRange: vi.fn(() => "port") })),
    getSelection: vi.fn(() => ({
      endColumn: 5,
      endLineNumber: 1,
      isEmpty: vi.fn(() => false),
      positionColumn: 5,
      positionLineNumber: 1,
      selectionStartColumn: 1,
      selectionStartLineNumber: 1,
      startColumn: 1,
      startLineNumber: 1,
    })),
    hasTextFocus: vi.fn(() => true),
    trigger: vi.fn(),
  };

  return {
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
    reset: () => {
      Object.values(editor).forEach((value) => {
        if (typeof value === "function" && "mockClear" in value) {
          value.mockClear();
        }
      });
    },
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

vi.mock(
  "../../../../src/features/sftp/remoteWorkspaceEditorTransport",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../../../../src/features/sftp/remoteWorkspaceEditorTransport")
      >();
    return {
      ...actual,
      readRemoteWorkspaceTextFile: (...args: unknown[]) =>
        transportMocks.readRemoteWorkspaceTextFile(...args),
      writeRemoteWorkspaceTextFile: (...args: unknown[]) =>
        transportMocks.writeRemoteWorkspaceTextFile(...args),
    };
  },
);

const editableTab: WorkspaceFileTab = {
  access: "editable",
  id: "tab-workspace-file-app",
  kind: "workspaceFile",
  machineId: "host-prod",
  path: "/etc/app.conf",
  source: "sftp",
  target: { hostId: "host-prod", kind: "ssh" },
  title: "app.conf",
};

function readResponse(overrides: Record<string, unknown> = {}) {
  return {
    binary: false,
    bytesRead: 10,
    content: "port=8080\n",
    encoding: "utf-8",
    lineEnding: "lf",
    maxBytes: 10 * 1024 * 1024,
    path: "/etc/app.conf",
    readonly: false,
    revision: {
      contentSha256: "sha-a",
      modified: "Jul 05 12:00",
      permissions: "-rw-r--r--",
      permissionsMode: 420,
      size: 10,
    },
    truncated: false,
    ...overrides,
  };
}

describe("WorkspaceFileTabSurface", () => {
  beforeEach(() => {
    transportMocks.readRemoteWorkspaceTextFile.mockReset();
    transportMocks.writeRemoteWorkspaceTextFile.mockReset();
    monacoEditorMocks.reset();
    transportMocks.readRemoteWorkspaceTextFile.mockResolvedValue(
      readResponse(),
    );
  });

  it("opens the Kerminal editor menu on right click instead of the browser menu", async () => {
    render(<WorkspaceFileTabSurface active tab={editableTab} />);
    const editor = await screen.findByLabelText("Monaco 编辑器");

    const contextMenuEvent = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: 64,
      clientY: 72,
    });
    editor.dispatchEvent(contextMenuEvent);

    expect(contextMenuEvent.defaultPrevented).toBe(true);
    expect(
      await screen.findByRole("menu", { name: "app.conf 编辑菜单" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /复制/ })).not.toBeDisabled();
  });

  it("uses one compact icon toolbar above the document", async () => {
    render(<WorkspaceFileTabSurface active tab={editableTab} />);

    await screen.findByLabelText("Monaco 编辑器");

    expect(screen.getByRole("group", { name: "文件操作" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "重新加载文件" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存文件" })).toBeDisabled();
    expect(screen.queryByText("重新加载")).not.toBeInTheDocument();
    expect(screen.queryByText("保存")).not.toBeInTheDocument();
    expect(screen.queryByText("查找")).not.toBeInTheDocument();
    expect(screen.queryByText("替换")).not.toBeInTheDocument();
    expect(screen.queryByText("utf-8")).not.toBeInTheDocument();
    expect(screen.queryByText("lf")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "查找" }));
    fireEvent.click(screen.getByRole("button", { name: "替换" }));

    await waitFor(() => {
      expect(monacoEditorMocks.editor.getAction).toHaveBeenCalledWith(
        "actions.find",
      );
      expect(monacoEditorMocks.editor.getAction).toHaveBeenCalledWith(
        "editor.action.startFindReplaceAction",
      );
    });
  });

  it("keeps write commands disabled in read-only workspace file tabs", async () => {
    transportMocks.readRemoteWorkspaceTextFile.mockResolvedValueOnce(
      readResponse({
        readonly: true,
        revision: {
          contentSha256: "sha-a",
          modified: "Jul 05 12:00",
          permissions: "-r--r--r--",
          permissionsMode: 292,
          size: 10,
        },
      }),
    );

    render(
      <WorkspaceFileTabSurface
        active
        tab={{ ...editableTab, access: "readonly" }}
      />,
    );
    const editor = await screen.findByLabelText("Monaco 编辑器");

    fireEvent.contextMenu(editor, { clientX: 24, clientY: 32 });

    await waitFor(() =>
      expect(screen.getByRole("menuitem", { name: /剪切/ })).toBeDisabled(),
    );
    expect(screen.getByRole("menuitem", { name: /粘贴/ })).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: /复制/ })).not.toBeDisabled();
  });

  it("keeps remote file failures in collapsed technical details", async () => {
    transportMocks.readRemoteWorkspaceTextFile.mockRejectedValueOnce(
      new Error(
        'managed sftp failed at /private/runtime.json with "password": "file-secret"',
      ),
    );

    render(<WorkspaceFileTabSurface active tab={editableTab} />);

    expect(await screen.findByText("文件读取失败")).toBeVisible();
    expect(screen.getByText("请检查连接和文件权限后重试。")).toBeVisible();
    const detail = screen.getByText(/managed sftp failed/);
    expect(detail.closest("details")).not.toHaveAttribute("open");
    expect(detail).not.toHaveTextContent("file-secret");

    fireEvent.click(screen.getByText("技术详情"));
    expect(detail.closest("details")).toHaveAttribute("open");
  });

  it("keeps reload disabled while the initial file read is pending", async () => {
    const pendingRead = createDeferred<ReturnType<typeof readResponse>>();
    transportMocks.readRemoteWorkspaceTextFile.mockImplementationOnce(
      () => pendingRead.promise,
    );

    render(<WorkspaceFileTabSurface active tab={editableTab} />);

    expect(screen.getByRole("button", { name: "重新加载文件" })).toBeDisabled();
    expect(screen.getByText("正在读取文件...")).toBeVisible();
    expect(transportMocks.readRemoteWorkspaceTextFile).toHaveBeenCalledTimes(1);
  });

  it("ignores an old reload response after switching to another file tab", async () => {
    const staleReload = createDeferred<ReturnType<typeof readResponse>>();
    const view = render(<WorkspaceFileTabSurface active tab={editableTab} />);
    expect(await screen.findByLabelText("Monaco 编辑器")).toHaveValue(
      "port=8080\n",
    );

    transportMocks.readRemoteWorkspaceTextFile.mockImplementationOnce(
      () => staleReload.promise,
    );
    fireEvent.click(screen.getByRole("button", { name: "重新加载文件" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "重新加载文件" }),
      ).toBeDisabled(),
    );
    transportMocks.readRemoteWorkspaceTextFile.mockResolvedValueOnce(
      readResponse({
        content: "feature=true\n",
        path: "/etc/feature.conf",
        revision: {
          contentSha256: "sha-feature",
          modified: "Jul 05 12:05",
          permissions: "-rw-r--r--",
          permissionsMode: 420,
          size: 13,
        },
      }),
    );

    view.rerender(
      <WorkspaceFileTabSurface
        active
        tab={{
          ...editableTab,
          id: "tab-workspace-file-feature",
          path: "/etc/feature.conf",
          title: "feature.conf",
        }}
      />,
    );
    expect(await screen.findByLabelText("Monaco 编辑器")).toHaveValue(
      "feature=true\n",
    );

    staleReload.resolve(
      readResponse({
        content: "port=7000\n",
        revision: {
          contentSha256: "sha-stale",
          modified: "Jul 05 12:03",
          permissions: "-rw-r--r--",
          permissionsMode: 420,
          size: 10,
        },
      }),
    );
    await waitFor(() =>
      expect(screen.getByLabelText("Monaco 编辑器")).toHaveValue(
        "feature=true\n",
      ),
    );
  });

  it("keeps an empty Monaco document mounted when reload fails", async () => {
    transportMocks.readRemoteWorkspaceTextFile.mockResolvedValueOnce(
      readResponse({
        bytesRead: 0,
        content: "",
        revision: {
          contentSha256: "sha-empty",
          modified: "Jul 05 12:00",
          permissions: "-rw-r--r--",
          permissionsMode: 420,
          size: 0,
        },
      }),
    );
    render(<WorkspaceFileTabSurface active tab={editableTab} />);
    expect(await screen.findByLabelText("Monaco 编辑器")).toHaveValue("");

    transportMocks.readRemoteWorkspaceTextFile.mockRejectedValueOnce(
      new Error("temporary reload failure"),
    );
    fireEvent.click(screen.getByRole("button", { name: "重新加载文件" }));

    expect(await screen.findByText("文件重新加载失败")).toBeVisible();
    expect(screen.getByLabelText("Monaco 编辑器")).toHaveValue("");
  });

  it("does not route native edit commands to an editor removed by an unsupported tab", async () => {
    const view = render(<WorkspaceFileTabSurface active tab={editableTab} />);
    await screen.findByLabelText("Monaco 编辑器");

    view.rerender(
      <WorkspaceFileTabSurface
        active
        tab={{
          ...editableTab,
          id: "tab-workspace-file-pdf",
          path: "/srv/contracts/agreement.pdf",
          title: "agreement.pdf",
        }}
      />,
    );
    expect(await screen.findByText("此文件不支持文本预览")).toBeVisible();

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

  it("blocks known non-text types before starting a file read", async () => {
    render(
      <WorkspaceFileTabSurface
        active
        tab={{
          ...editableTab,
          id: "tab-workspace-file-agreement",
          path: "/srv/contracts/agreement.PDF",
          title: "agreement.PDF",
        }}
      />,
    );

    expect(await screen.findByText("此文件不支持文本预览")).toBeVisible();
    expect(
      screen.getByText(
        "PDF 或电子书文件不能在文本编辑器中预览，可下载后使用对应阅读应用查看。",
      ),
    ).toBeVisible();
    expect(transportMocks.readRemoteWorkspaceTextFile).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Monaco 编辑器")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "重试" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重新加载文件" })).toBeDisabled();
  });

  it("treats detected binary responses as unsupported instead of opening Monaco", async () => {
    transportMocks.readRemoteWorkspaceTextFile.mockResolvedValueOnce(
      readResponse({
        binary: true,
        bytesRead: 4096,
        content: "",
        encoding: "binary",
        readonly: true,
        revision: {
          contentSha256: "sha-binary",
          size: 4096,
        },
      }),
    );

    render(
      <WorkspaceFileTabSurface
        active
        tab={{ ...editableTab, path: "/srv/data/blob.unknown" }}
      />,
    );

    expect(await screen.findByText("此文件不支持文本预览")).toBeVisible();
    expect(
      screen.getByText(
        "已检测到二进制内容，Kerminal 未将文件加载到文本编辑器。",
      ),
    ).toBeVisible();
    expect(transportMocks.readRemoteWorkspaceTextFile).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText("Monaco 编辑器")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "重试" }),
    ).not.toBeInTheDocument();
  });

  it("maps legacy binary read errors to the same non-retryable notice", async () => {
    transportMocks.readRemoteWorkspaceTextFile.mockRejectedValueOnce(
      new Error("远程文件包含二进制内容，暂不支持作为文本编辑"),
    );

    render(
      <WorkspaceFileTabSurface
        active
        tab={{ ...editableTab, path: "/srv/data/blob.unknown" }}
      />,
    );

    expect(await screen.findByText("此文件不支持文本预览")).toBeVisible();
    expect(screen.queryByText("文件读取失败")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "重试" }),
    ).not.toBeInTheDocument();
  });
});
