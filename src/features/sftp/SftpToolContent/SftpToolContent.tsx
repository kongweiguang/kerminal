/**
 * @author kongweiguang
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { Machine, WorkspaceFileDirtyState, WorkspaceFileRevealRequest, WorkspaceFileTab } from "../../workspace/contracts/index";
import type { OpenWorkspaceFileTabOptions } from "../../workspace/state/index";
import type { InterfaceDensity } from "../../settings/contracts/index";
import type { SftpWorkbenchClipboard } from "../sftpTransferClipboardModel";
import type { SftpBrowserMode } from "../sftp-tool-content/sftpBrowserModeModel";
import { useSftpTargetSessionBoundary } from "../sftp-tool-content/useSftpTargetLifecycle";
import type { SftpClipboard, SftpFileTarget, SftpTransferTarget } from "../sftp-tool-content/types";
import { SftpTargetBoundContent } from "./SftpTargetBoundContent";

export type SftpToolContentProps = {
  active?: boolean;
  compactHeader?: boolean;
  followedLocalPath?: string;
  followedRemotePath?: string;
  interfaceDensity?: InterfaceDensity;
  availableSessionScopeIds?: string[];
  onCurrentPathChange?: (path: string) => void;
  onOpenWorkspaceFileTab?: (options: OpenWorkspaceFileTabOptions) => void;
  onSftpClipboardChange?: (clipboard: SftpClipboard | null) => void;
  selectedMachine?: Machine;
  sessionScopeId?: string;
  showLocalTransferActions?: boolean;
  showTerminalDirectoryControls?: boolean;
  showTransferStatusBar?: boolean;
  sftpClipboard?: SftpClipboard | null;
  transferViewScope?: string | null;
  transferTarget?: SftpTransferTarget;
  workbenchClipboard?: SftpWorkbenchClipboard | null;
  sftpRevealRequest?: WorkspaceFileRevealRequest | null;
  workspaceFileDirtyState?: WorkspaceFileDirtyState;
  workspaceFileTabs?: WorkspaceFileTab[];
};

export type SftpTargetBoundContentProps = SftpToolContentProps & {
  active: boolean;
  browserMode: SftpBrowserMode;
  fileTarget: SftpFileTarget | null;
  followTerminalDirectory: boolean;
  initialRemotePath?: string;
  setBrowserMode: Dispatch<SetStateAction<SftpBrowserMode>>;
  setFollowTerminalDirectory: Dispatch<SetStateAction<boolean>>;
  setShowHiddenFiles: Dispatch<SetStateAction<boolean>>;
  setSftpClipboard: (clipboard: SftpClipboard | null) => void;
  showHiddenFiles: boolean;
  sftpClipboard: SftpClipboard | null;
};

const DEFAULT_SFTP_SESSION_SCOPE_ID = "__kerminal_sftp_default_scope__";

/** 保留右栏切换期间的视图状态，并按资源身份隔离远端会话状态。 */
export function SftpToolContent(props: SftpToolContentProps) {
  const active = props.active ?? true;
  const onCurrentPathChange = props.onCurrentPathChange;
  const sessionScopeId =
    props.sessionScopeId?.trim() || DEFAULT_SFTP_SESSION_SCOPE_ID;
  const session = useSftpTargetSessionBoundary({
    controlledClipboard: props.sftpClipboard,
    onClipboardChange: props.onSftpClipboardChange,
    selectedMachine: props.selectedMachine,
  });
  const [remotePathByScope, setRemotePathByScope] = useState<
    Record<string, Record<string, string>>
  >({});
  const mountedSessionKey = `${sessionScopeId}\u0000${session.sessionKey}`;
  const initialRemotePathRef = useRef<{
    key: string;
    path?: string;
  }>({ key: "" });
  if (initialRemotePathRef.current.key !== mountedSessionKey) {
    initialRemotePathRef.current = {
      key: mountedSessionKey,
      path: remotePathByScope[sessionScopeId]?.[session.sessionKey],
    };
  }
  const initialRemotePath = initialRemotePathRef.current.path;
  const handleCurrentPathChange = useCallback(
    (path: string) => {
      setRemotePathByScope((current) => {
        const currentScope = current[sessionScopeId];
        if (currentScope?.[session.sessionKey] === path) {
          return current;
        }
        return {
          ...current,
          [sessionScopeId]: {
            ...currentScope,
            [session.sessionKey]: path,
          },
        };
      });
      onCurrentPathChange?.(path);
    },
    [onCurrentPathChange, session.sessionKey, sessionScopeId],
  );

  useEffect(() => {
    if (!props.availableSessionScopeIds) {
      return;
    }
    const availableScopeIds = new Set(props.availableSessionScopeIds);
    setRemotePathByScope((current) => {
      const next = Object.fromEntries(
        Object.entries(current).filter(([scopeId]) =>
          availableScopeIds.has(scopeId),
        ),
      );
      return Object.keys(next).length === Object.keys(current).length
        ? current
        : next;
    });
  }, [props.availableSessionScopeIds]);

  return (
    <SftpTargetBoundContent
      {...props}
      active={active}
      browserMode={session.browserMode}
      fileTarget={session.fileTarget}
      followTerminalDirectory={session.followTerminalDirectory}
      initialRemotePath={initialRemotePath}
      key={mountedSessionKey}
      onCurrentPathChange={handleCurrentPathChange}
      setBrowserMode={session.setBrowserMode}
      setFollowTerminalDirectory={session.setFollowTerminalDirectory}
      setShowHiddenFiles={session.setShowHiddenFiles}
      setSftpClipboard={session.setSftpClipboard}
      showHiddenFiles={session.showHiddenFiles}
      sftpClipboard={session.sftpClipboard}
    />
  );
}
