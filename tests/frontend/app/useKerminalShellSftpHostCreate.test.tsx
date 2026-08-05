// @author kongweiguang

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useKerminalShellSftpHostCreate } from "../../../src/app/useKerminalShellSftpHostCreate";
import {
  createDefaultSshOptions,
  type RemoteHost,
} from "../../../src/lib/remoteHostApi";

const sshHost: RemoteHost = {
  authType: "agent",
  createdAt: "1",
  host: "10.0.0.8",
  id: "host-1",
  name: "dev-api",
  port: 22,
  protocol: "ssh",
  sortOrder: 1,
  sshOptions: createDefaultSshOptions(),
  tags: ["ssh"],
  updatedAt: "1",
  username: "deploy",
};

describe("useKerminalShellSftpHostCreate", () => {
  it("returns a newly created SSH host to the requesting workbench side", async () => {
    const options = createOptions();
    const { result } = renderHook(() => useKerminalShellSftpHostCreate(options));

    act(() =>
      result.current.openSftpTransferHostCreateDialog({
        side: "right",
        workspaceTabId: "transfer-1",
      }),
    );
    expect(options.openConnectionDialog).toHaveBeenCalledWith({ mode: "sftp" });

    await act(() => result.current.handleConnectionDialogCreated(sshHost));

    expect(options.handleRemoteHostCreated).toHaveBeenCalledWith(sshHost);
    expect(result.current.createdSftpHostTarget).toEqual({
      hostId: sshHost.id,
      sequence: 1,
      side: "right",
      workspaceTabId: "transfer-1",
    });
  });

  it("does not open a dialog for a request without a workspace tab", () => {
    const options = createOptions();
    const { result } = renderHook(() => useKerminalShellSftpHostCreate(options));

    act(() =>
      result.current.openSftpTransferHostCreateDialog({
        side: "left",
        workspaceTabId: "",
      }),
    );

    expect(options.openConnectionDialog).not.toHaveBeenCalled();
  });

  it("keeps non-SFTP hosts out of the workbench return channel", async () => {
    const options = createOptions();
    const { result } = renderHook(() => useKerminalShellSftpHostCreate(options));
    act(() =>
      result.current.openSftpTransferHostCreateDialog({
        side: "left",
        workspaceTabId: "transfer-2",
      }),
    );

    await act(() =>
      result.current.handleConnectionDialogCreated({
        ...sshHost,
        id: "rdp-host",
        protocol: "rdp",
        tags: ["rdp"],
      }),
    );

    expect(options.handleRemoteHostCreated).toHaveBeenCalled();
    expect(result.current.createdSftpHostTarget).toBeUndefined();
  });
});

function createOptions() {
  return {
    closeConnectionDialog: vi.fn(),
    handleRemoteHostCreated: vi.fn(async () => undefined),
    openConnectionDialog: vi.fn(),
  };
}
