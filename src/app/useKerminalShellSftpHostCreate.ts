import { useCallback, useRef, useState } from "react";
import type {
  SftpTransferCreatedHostTarget,
  SftpTransferCreateHostRequest,
} from "../features/sftp/SftpTransferWorkbench";
import type { RemoteHost } from "../lib/remoteHostApi";
import { isSftpCapableRemoteHost } from "./KerminalShell.contextWorkspaceShellHelpers";

interface UseKerminalShellSftpHostCreateOptions {
  closeConnectionDialog: () => void;
  handleRemoteHostCreated: (host: RemoteHost) => Promise<void>;
  openConnectionDialog: (options: { mode: "sftp" }) => void;
}

/** 维护 SFTP 工作台发起的新主机请求，并把创建结果回传到原工作台侧。 */
export function useKerminalShellSftpHostCreate({
  closeConnectionDialog,
  handleRemoteHostCreated,
  openConnectionDialog,
}: UseKerminalShellSftpHostCreateOptions) {
  const [pendingTarget, setPendingTarget] =
    useState<SftpTransferCreateHostRequest | null>(null);
  const [createdTarget, setCreatedTarget] =
    useState<SftpTransferCreatedHostTarget>();
  const createdSequenceRef = useRef(0);

  const openSftpTransferHostCreateDialog = useCallback(
    (request: SftpTransferCreateHostRequest) => {
      if (!request.workspaceTabId) {
        return;
      }
      setPendingTarget(request);
      openConnectionDialog({ mode: "sftp" });
    },
    [openConnectionDialog],
  );

  const handleConnectionDialogClose = useCallback(() => {
    setPendingTarget(null);
    closeConnectionDialog();
  }, [closeConnectionDialog]);

  const handleConnectionDialogCreated = useCallback(
    async (host: RemoteHost) => {
      await handleRemoteHostCreated(host);
      if (pendingTarget && isSftpCapableRemoteHost(host)) {
        createdSequenceRef.current += 1;
        setCreatedTarget({
          hostId: host.id,
          sequence: createdSequenceRef.current,
          side: pendingTarget.side,
          workspaceTabId: pendingTarget.workspaceTabId,
        });
      }
      setPendingTarget(null);
    },
    [handleRemoteHostCreated, pendingTarget],
  );

  return {
    createdSftpHostTarget: createdTarget,
    handleConnectionDialogClose,
    handleConnectionDialogCreated,
    openSftpTransferHostCreateDialog,
  };
}
