/**
 * @author kongweiguang
 */

import { StrictMode } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import {
  createSftpTransferSummary,
  fileDialogMocks,
  sftpApiMocks,
  sshCommandApiMocks,
  sshMachine,
  stageSshMachine,
} from "../../support/sftp/SftpToolContent.testSupport.tsx";
import { SftpToolContent } from "../../../../src/features/sftp/SftpToolContent";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

describe("SftpToolContent target binding", () => {
  it("在 StrictMode effect 重放后仍自动加载首次目录", async () => {
    sftpApiMocks.listSftpDirectory.mockImplementation(
      async ({ hostId, path }: { hostId: string; path: string }) =>
        listing(hostId, path),
    );

    render(
      <StrictMode>
        <SftpToolContent active selectedMachine={sshMachine} />
      </StrictMode>,
    );

    expect(await screen.findByText("prod-api.txt")).toBeInTheDocument();
    expect(sftpApiMocks.listSftpDirectory).toHaveBeenLastCalledWith({
      hostId: "prod-api",
      path: "/",
    });
  });

  it("keeps the current directory while inactive and loads only a changed target", async () => {
    const user = userEvent.setup();
    sftpApiMocks.listSftpDirectory.mockImplementation(
      async ({ hostId, path }: { hostId: string; path: string }) =>
        listing(hostId, path),
    );
    const { rerender } = render(
      <SftpToolContent active selectedMachine={sshMachine} />,
    );

    expect(await screen.findByText("prod-api.txt")).toBeInTheDocument();
    const pathInput = screen.getByLabelText("当前远程路径");
    await user.clear(pathInput);
    await user.type(pathInput, "/var/log{Enter}");
    expect(await screen.findByText("prod-api.txt")).toBeInTheDocument();
    expect(pathInput).toHaveValue("/var/log");
    expect(sftpApiMocks.listSftpDirectory).toHaveBeenLastCalledWith({
      hostId: "prod-api",
      path: "/var/log",
    });

    rerender(<SftpToolContent active={false} selectedMachine={sshMachine} />);
    expect(screen.getByLabelText("当前远程路径")).toHaveValue("/var/log");
    expect(screen.getByText("prod-api.txt")).toBeInTheDocument();
    sftpApiMocks.listSftpDirectory.mockClear();

    rerender(<SftpToolContent active selectedMachine={sshMachine} />);
    expect(screen.getByLabelText("当前远程路径")).toHaveValue("/var/log");
    expect(screen.getByText("prod-api.txt")).toBeInTheDocument();
    expect(sftpApiMocks.listSftpDirectory).not.toHaveBeenCalled();

    rerender(<SftpToolContent active={false} selectedMachine={sshMachine} />);

    rerender(
      <SftpToolContent active={false} selectedMachine={stageSshMachine} />,
    );
    await flushPromises();
    expect(sftpApiMocks.listSftpDirectory).not.toHaveBeenCalled();

    rerender(<SftpToolContent active selectedMachine={stageSshMachine} />);
    expect(await screen.findByText("stage-api.txt")).toBeInTheDocument();
    expect(sftpApiMocks.listSftpDirectory).toHaveBeenCalledTimes(1);
    expect(sftpApiMocks.listSftpDirectory).toHaveBeenCalledWith({
      hostId: "stage-api",
      path: "/",
    });
  });

  it("restores an independent current directory for each still-open tab", async () => {
    const user = userEvent.setup();
    sftpApiMocks.listSftpDirectory.mockImplementation(
      async ({ hostId, path }: { hostId: string; path: string }) =>
        listing(hostId, path),
    );
    const availableSessionScopeIds = ["tab-a", "tab-b"];
    const { rerender } = render(
      <SftpToolContent
        active
        availableSessionScopeIds={availableSessionScopeIds}
        selectedMachine={sshMachine}
        sessionScopeId="tab-a"
      />,
    );

    await screen.findByText("prod-api.txt");
    const tabAPath = screen.getByLabelText("当前远程路径");
    await user.clear(tabAPath);
    await user.type(tabAPath, "/var/log{Enter}");
    await waitFor(() => expect(tabAPath).toHaveValue("/var/log"));

    rerender(
      <SftpToolContent
        active
        availableSessionScopeIds={availableSessionScopeIds}
        selectedMachine={sshMachine}
        sessionScopeId="tab-b"
      />,
    );
    await waitFor(() =>
      expect(screen.getByLabelText("当前远程路径")).toHaveValue("/"),
    );

    rerender(
      <SftpToolContent
        active
        availableSessionScopeIds={availableSessionScopeIds}
        selectedMachine={sshMachine}
        sessionScopeId="tab-a"
      />,
    );
    await waitFor(() =>
      expect(screen.getByLabelText("当前远程路径")).toHaveValue("/var/log"),
    );
    expect(sftpApiMocks.listSftpDirectory).toHaveBeenLastCalledWith({
      hostId: "prod-api",
      path: "/var/log",
    });
  });

  it("keeps a slow old target listing out of the new target view", async () => {
    const prodRequest = deferred<ReturnType<typeof listing>>();
    const stageRequest = deferred<ReturnType<typeof listing>>();
    sftpApiMocks.listSftpDirectory.mockImplementation(
      ({ hostId }: { hostId: string }) =>
        hostId === "prod-api" ? prodRequest.promise : stageRequest.promise,
    );
    const { rerender } = render(
      <SftpToolContent selectedMachine={sshMachine} />,
    );
    await waitFor(() =>
      expect(sftpApiMocks.listSftpDirectory).toHaveBeenCalledWith({
        hostId: "prod-api",
        path: "/",
      }),
    );

    rerender(<SftpToolContent selectedMachine={stageSshMachine} />);
    await waitFor(() =>
      expect(sftpApiMocks.listSftpDirectory).toHaveBeenCalledWith({
        hostId: "stage-api",
        path: "/",
      }),
    );

    await act(async () => {
      stageRequest.resolve(listing("stage-api", "/"));
      await stageRequest.promise;
    });
    expect(await screen.findByText("stage-api.txt")).toBeInTheDocument();

    await act(async () => {
      prodRequest.resolve(listing("prod-api", "/"));
      await prodRequest.promise;
    });
    expect(screen.getByText("stage-api.txt")).toBeInTheDocument();
    expect(screen.queryByText("prod-api.txt")).not.toBeInTheDocument();
  });

  it("keeps an in-flight read when only same-target metadata changes", async () => {
    const request = deferred<ReturnType<typeof listing>>();
    sftpApiMocks.listSftpDirectory.mockReturnValue(request.promise);
    const { rerender } = render(
      <SftpToolContent selectedMachine={sshMachine} />,
    );
    await waitFor(() =>
      expect(sftpApiMocks.listSftpDirectory).toHaveBeenCalledTimes(1),
    );

    rerender(
      <SftpToolContent
        selectedMachine={{ ...sshMachine, name: "prod api renamed" }}
      />,
    );
    await act(async () => {
      request.resolve(listing("prod-api", "/"));
      await request.promise;
    });

    expect(await screen.findByText("prod-api.txt")).toBeInTheDocument();
    expect(sftpApiMocks.listSftpDirectory).toHaveBeenCalledTimes(1);
  });

  it("does not reload or update the new target after an old mutation finishes", async () => {
    const user = userEvent.setup();
    const createRequest = deferred<boolean>();
    sftpApiMocks.listSftpDirectory.mockImplementation(
      async ({ hostId, path }: { hostId: string; path: string }) =>
        listing(hostId, path),
    );
    sftpApiMocks.createSftpDirectory.mockReturnValue(createRequest.promise);
    const { rerender } = render(
      <SftpToolContent selectedMachine={sshMachine} />,
    );

    expect(await screen.findByText("prod-api.txt")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "新建目录" }));
    await user.clear(screen.getByLabelText("新目录路径"));
    await user.type(screen.getByLabelText("新目录路径"), "reports");
    await user.click(screen.getByRole("button", { name: "创建" }));
    expect(sftpApiMocks.createSftpDirectory).toHaveBeenCalledWith({
      hostId: "prod-api",
      path: "/reports",
    });

    rerender(<SftpToolContent selectedMachine={stageSshMachine} />);
    expect(await screen.findByText("stage-api.txt")).toBeInTheDocument();
    expect(
      screen.queryByRole("dialog", { name: "新建目录" }),
    ).not.toBeInTheDocument();

    await act(async () => {
      createRequest.resolve(true);
      await createRequest.promise;
    });
    await flushPromises();

    expect(
      sftpApiMocks.listSftpDirectory.mock.calls.filter(
        ([request]) => request.hostId === "prod-api",
      ),
    ).toHaveLength(1);
    expect(screen.getByText("stage-api.txt")).toBeInTheDocument();
    expect(screen.queryByText(/目录已创建/)).not.toBeInTheDocument();
  });

  it("closes an old target dialog as soon as the target changes", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <SftpToolContent selectedMachine={sshMachine} />,
    );

    await screen.findByText("var");
    await user.click(screen.getByRole("button", { name: "新建目录" }));
    expect(
      screen.getByRole("dialog", { name: "新建目录" }),
    ).toBeInTheDocument();

    rerender(<SftpToolContent selectedMachine={stageSshMachine} />);
    expect(
      screen.queryByRole("dialog", { name: "新建目录" }),
    ).not.toBeInTheDocument();
  });

  it("does not publish old remote setup completion into the new target", async () => {
    const user = userEvent.setup();
    const setupRequest = deferred<{
      durationMs: number;
      exitCode: number;
      host: string;
      hostId: string;
      hostName: string;
      maxOutputBytes: number;
      port: number;
      stderr: string;
      stderrBytes: number;
      stderrTruncated: boolean;
      stdout: string;
      stdoutBytes: number;
      stdoutTruncated: boolean;
      success: boolean;
      username: string;
    }>();
    sshCommandApiMocks.executeSshCommand.mockReturnValue(setupRequest.promise);
    const { rerender } = render(
      <SftpToolContent selectedMachine={sshMachine} />,
    );

    await screen.findByText("var");
    await user.click(
      screen.getByRole("button", { name: "自动设置 SFTP 目录跟随" }),
    );
    expect(sshCommandApiMocks.executeSshCommand).toHaveBeenCalledWith(
      expect.objectContaining({ hostId: "prod-api" }),
    );

    rerender(<SftpToolContent selectedMachine={stageSshMachine} />);
    await screen.findByText(/stage.internal:22/);
    await act(async () => {
      setupRequest.resolve(successfulSetupOutput("prod-api"));
      await setupRequest.promise;
    });
    await flushPromises();

    expect(screen.queryByText(/目录跟随已配置/)).not.toBeInTheDocument();
  });

  it("does not merge an old transfer completion into the new target", async () => {
    const user = userEvent.setup();
    const enqueueRequest =
      deferred<ReturnType<typeof createSftpTransferSummary>>();
    sftpApiMocks.enqueueSftpTransfer.mockReturnValue(enqueueRequest.promise);
    fileDialogMocks.selectLocalFile.mockResolvedValue("C:/release.tgz");
    const { rerender } = render(
      <SftpToolContent selectedMachine={sshMachine} />,
    );

    await screen.findByText("var");
    await user.click(screen.getByRole("button", { name: "上传" }));
    await user.click(screen.getByRole("menuitem", { name: "上传文件" }));
    await waitFor(() =>
      expect(sftpApiMocks.enqueueSftpTransfer).toHaveBeenCalledWith({
        conflictPolicy: "overwrite",
        direction: "upload",
        hostId: "prod-api",
        kind: "file",
        localPath: "C:/release.tgz",
        remotePath: "/release.tgz",
      }),
    );

    rerender(<SftpToolContent selectedMachine={stageSshMachine} />);
    await screen.findByText(/stage.internal:22/);
    await act(async () => {
      enqueueRequest.resolve(
        createSftpTransferSummary({
          direction: "upload",
          hostId: "prod-api",
          id: "prod-upload",
          localPath: "C:/release.tgz",
          remotePath: "/release.tgz",
        }),
      );
      await enqueueRequest.promise;
    });
    await flushPromises();

    expect(screen.queryByText("SFTP 传输队列")).not.toBeInTheDocument();
    expect(screen.queryByText("release.tgz")).not.toBeInTheDocument();
  });

  it("discards an old conflict prompt when the target changes", async () => {
    const user = userEvent.setup();
    const statRequest = deferred<{
      hostId: string;
      kind: "file";
      path: string;
      readonly: boolean;
    }>();
    sftpApiMocks.statSftpPath.mockReturnValue(statRequest.promise);
    fileDialogMocks.selectLocalFile.mockResolvedValue("C:/release.tgz");
    const { rerender } = render(
      <SftpToolContent selectedMachine={sshMachine} />,
    );

    await screen.findByText("var");
    await user.click(screen.getByRole("button", { name: "上传" }));
    await user.click(screen.getByRole("menuitem", { name: "上传文件" }));
    await waitFor(() => expect(sftpApiMocks.statSftpPath).toHaveBeenCalled());

    rerender(<SftpToolContent selectedMachine={stageSshMachine} />);
    await screen.findByText(/stage.internal:22/);
    await act(async () => {
      statRequest.resolve({
        hostId: "prod-api",
        kind: "file",
        path: "/release.tgz",
        readonly: false,
      });
      await statRequest.promise;
    });
    await flushPromises();

    expect(screen.queryByText("处理传输冲突")).not.toBeInTheDocument();
    expect(sftpApiMocks.enqueueSftpTransfer).not.toHaveBeenCalled();
  });
});

function listing(hostId: string, path: string) {
  return {
    entries: [
      {
        kind: "file" as const,
        name: `${hostId}.txt`,
        path: `${path === "/" ? "" : path}/${hostId}.txt`,
        permissions: "-rw-r--r--",
        raw: `-rw-r--r-- ${hostId}.txt`,
        size: 1,
      },
    ],
    hostId,
    path,
  };
}

function successfulSetupOutput(hostId: string) {
  return {
    durationMs: 1,
    exitCode: 0,
    host: `${hostId}.internal`,
    hostId,
    hostName: hostId,
    maxOutputBytes: 4096,
    port: 22,
    stderr: "",
    stderrBytes: 0,
    stderrTruncated: false,
    stdout: "configured",
    stdoutBytes: 10,
    stdoutTruncated: false,
    success: true,
    username: "deploy",
  };
}

async function flushPromises() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}
