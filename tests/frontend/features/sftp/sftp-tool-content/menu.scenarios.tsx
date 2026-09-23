// @author kongweiguang

import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import {
  containerFilesApiMocks,
  containerMachine,
  sftpApiMocks,
  sshMachine,
} from "../../../support/sftp/SftpToolContent.testSupport.tsx";
import { SftpToolContent } from "../../../../../src/features/sftp/SftpToolContent";


describe("SftpToolContent context menu behavior", () => {
  afterEach(() => {
    document.documentElement.classList.remove("dark");
  });

  it("opens a context menu from right clicking files and folders", async () => {

    const user = userEvent.setup();



    render(<SftpToolContent selectedMachine={sshMachine} />);



    expect(await screen.findByText("var")).toBeInTheDocument();

    fireEvent.contextMenu(

      screen.getByRole("button", { name: "打开目录 var" }),

      {

        clientX: 80,

        clientY: 120,

      },

    );



    expect(

      screen.getByRole("menu", { name: "SFTP var 右键菜单" }),

    ).toBeInTheDocument();

    expect(screen.getByRole("menuitem", { name: "打开" })).toBeInTheDocument();

    expect(

      screen.getByRole("menuitem", { name: "下载文件夹" }),

    ).toBeInTheDocument();

    expect(
      screen.queryByRole("menuitem", { name: "下载为 ZIP" }),
    ).not.toBeInTheDocument();
    expect(

      screen.getByRole("menuitem", { name: "下载到剪贴板" }),

    ).toBeInTheDocument();

    expect(

      screen

        .getByRole("button", { name: "打开目录 var" })

        .closest("[aria-selected='true']"),

    ).toBeInTheDocument();



    await user.dblClick(screen.getByRole("button", { name: "打开目录 log" }));
    expect(await screen.findByText("app.log")).toBeInTheDocument();

    fireEvent.contextMenu(

      screen.getByRole("button", { name: "文件 app.log" }),

      {

        clientX: 80,

        clientY: 160,

      },

    );



    expect(

      screen.getByRole("menu", { name: "SFTP app.log 右键菜单" }),

    ).toBeInTheDocument();

    expect(

      screen.getByRole("menuitem", { name: "打开编辑器" }),

    ).toBeInTheDocument();

    expect(screen.getByRole("menuitem", { name: "下载" })).not.toBeDisabled();

    expect(
      screen.queryByRole("menuitem", { name: "下载为 ZIP" }),
    ).not.toBeInTheDocument();
    expect(

      screen.getByRole("menuitem", { name: "下载到剪贴板" }),

    ).not.toBeDisabled();

    expect(

      screen

        .getByRole("button", { name: "文件 app.log" })

        .closest("[aria-selected='true']"),

    ).toBeInTheDocument();

  });



  it("lets the SFTP context menu follow the document theme", async () => {
    document.documentElement.classList.add("dark");
    render(<SftpToolContent selectedMachine={sshMachine} />);


    expect(await screen.findByText("var")).toBeInTheDocument();

    fireEvent.contextMenu(

      screen.getByRole("button", { name: "打开目录 var" }),

      {

        clientX: 80,

        clientY: 120,

      },

    );


    const menu = screen.getByRole("menu", { name: "SFTP var 右键菜单" });
    expect(document.documentElement).toHaveClass("dark");
    expect(menu).not.toHaveClass("dark");
    document.documentElement.classList.remove("dark");
    expect(menu).not.toHaveClass("dark");
    expect(menu.parentElement).toBe(document.body);
  });


  it("opens a context menu from a right mouse down event", async () => {

    render(<SftpToolContent selectedMachine={sshMachine} />);



    expect(await screen.findByText("var")).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByRole("button", { name: "打开目录 var" }), {

      button: 2,

      buttons: 2,

      clientX: 1800,

      clientY: 120,

    });



    const menu = screen.getByRole("menu", { name: "SFTP var 右键菜单" });

    expect(menu).toBeInTheDocument();

    expect(menu.parentElement).toBe(document.body);

    expect(screen.getByRole("menuitem", { name: "打开" })).toBeInTheDocument();

  });



  it("opens a context menu from a right pointer down event", async () => {

    render(<SftpToolContent selectedMachine={sshMachine} />);



    expect(await screen.findByText("var")).toBeInTheDocument();

    fireEvent.pointerDown(screen.getByText("var"), {

      button: 2,

      buttons: 2,

      clientX: 1800,

      clientY: 120,

      pointerType: "mouse",

    });



    const menu = screen.getByRole("menu", { name: "SFTP var 右键菜单" });

    expect(menu).toBeInTheDocument();

    expect(menu.parentElement).toBe(document.body);

  });



  it("jumps to an edited remote path from the header input", async () => {

    const user = userEvent.setup();



    render(<SftpToolContent selectedMachine={sshMachine} />);



    await screen.findByText("var");

    const pathInput = screen.getByLabelText("当前远程路径");

    await user.clear(pathInput);

    await user.type(pathInput, "/var/log{Enter}");



    expect(await screen.findByText("app.log")).toBeInTheDocument();

    expect(sftpApiMocks.listSftpDirectory).toHaveBeenLastCalledWith({

      hostId: "prod-api",

      path: "/var/log",

    });

  });



  it("allows downloading symlink entries from the context menu", async () => {
    const user = userEvent.setup();


    render(<SftpToolContent selectedMachine={sshMachine} />);



    await screen.findByText("var");

    await user.dblClick(screen.getByRole("button", { name: "打开目录 log" }));
    expect(await screen.findByText("current")).toBeInTheDocument();

    fireEvent.contextMenu(

      screen.getByRole("button", { name: "链接 current" }),

      {

        clientX: 80,

        clientY: 160,

      },

    );



    expect(screen.getByRole("menuitem", { name: "下载" })).not.toBeDisabled();
    expect(screen.getByRole("menuitem", { name: "打开编辑器" })).toBeDisabled();
  });

  it("shows direct Docker container transfer status at the bottom of the browser", async () => {
    const user = userEvent.setup();
    let resolveDownload: ((value: boolean) => void) | undefined;
    containerFilesApiMocks.downloadDockerContainerPath.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          resolveDownload = resolve;
        }),
    );

    render(<SftpToolContent selectedMachine={containerMachine} />);

    expect(await screen.findByText("package.json")).toBeInTheDocument();
    fireEvent.contextMenu(screen.getByRole("button", { name: "文件 package.json" }), {
      clientX: 80,
      clientY: 160,
    });
    await user.click(screen.getByRole("menuitem", { name: "下载" }));

    expect(containerFilesApiMocks.downloadDockerContainerPath).toHaveBeenCalledWith({
      containerId: "container-api",
      hostId: "prod-api",
      kind: "file",
      localPath: "/Users/me/Downloads/app.log",
      remotePath: "/app/package.json",
      runtime: "docker",
    });
    const progress = await screen.findByRole("progressbar", {
      name: "传输进度 package.json",
    });
    const transferStatusBar = screen.getByRole("status", {
      name: "SFTP 传输状态",
    });
    expect(progress).toHaveAttribute("aria-valuenow", "8");
    expect(transferStatusBar).toHaveTextContent("SFTP 传输队列");
    expect(transferStatusBar).toHaveTextContent("下载中");
    expect(transferStatusBar).toHaveTextContent("package.json");
    expect(screen.queryByTestId("sftp-operation-progress")).not.toBeInTheDocument();

    await act(async () => {
      resolveDownload?.(true);
    });

    expect(await screen.findByLabelText("完成")).toBeInTheDocument();
    expect(transferStatusBar).toHaveTextContent("100%");
    expect(screen.queryByTestId("sftp-operation-status")).not.toBeInTheDocument();
    const dropZone = screen.getByTestId("sftp-drop-zone");

    expect(
      dropZone.compareDocumentPosition(transferStatusBar) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

});
