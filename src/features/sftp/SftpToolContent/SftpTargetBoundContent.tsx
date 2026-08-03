// @author kongweiguang

import {
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { listDockerContainerDirectory } from "../../../lib/containerFilesApi";
import { listSftpDirectory, type SftpEntry } from "../../../lib/sftpApi";
import { localTarget, targetStableId } from "../../../lib/targetModel";
import { SftpTransferConflictDialog } from "../SftpTransferConflictDialog";
import { resolveSftpFileRowHeight } from "../sftpDensityModel";
import { LocalTransferPane } from "../LocalTransferPane";
import { SftpBrowserPresenter } from "../sftp-tool-content/SftpBrowserPresenter";
import { useSftpTransferActions } from "../sftp-tool-content/useSftpTransferActions";
import { useSftpContextMenuActions } from "../sftp-tool-content/useSftpContextMenuActions";
import { useSftpLocalUploadDropActions } from "../sftp-tool-content/useSftpLocalUploadDropActions";
import { useSftpDialogActions } from "../sftp-tool-content/useSftpDialogActions";
import { useSftpRemoteSetupActions } from "../sftp-tool-content/useSftpRemoteSetupActions";
import { useSftpTransferSync } from "../sftp-tool-content/useSftpTransferSync";
import { useSftpWorkspaceDialogActions } from "../sftp-tool-content/useSftpWorkspaceDialogActions";
import { useSftpBrowserCommands } from "../sftp-tool-content/useSftpBrowserCommands";
import { clampContextMenuPosition } from "../sftp-tool-content/sftpDragDropModel";
import {
  isHiddenEntry,
  transferKindFromEntry,
} from "../sftp-tool-content/sftpEntryModel";
import {
  fileTargetToRemoteTarget,
  normalizeDirectoryListing,
} from "../sftp-tool-content/sftpFileTargetModel";
import {
  bindSftpTargetDirectoryLoader,
  useSftpTargetLifecycle,
  type SftpTargetBoundDirectoryLoader,
} from "../sftp-tool-content/useSftpTargetLifecycle";
import { useSftpResumableDirectory } from "../sftp-tool-content/useSftpResumableDirectory";
import {
  normalizeFollowedRemotePath,
  resolveFollowedRemotePathChange,
  resolveFollowTerminalDirectoryToggle,
} from "../sftp-tool-content/sftpFollowDirectoryModel";
import { normalizeRemotePath } from "../sftp-tool-content/sftpPathModel";
import {
  initialSftpRemoteBrowserState,
  nextSftpRemoteBrowserRequestId,
  normalizeSftpRemoteBrowserError,
  resolveSftpRemoteBrowserSetState,
  sftpRemoteBrowserReducer,
  type SftpRemoteBrowserAction,
} from "../sftp-tool-content/sftpRemoteBrowserModel";
import {
  nextContextMenuSelection,
  nextSelectedEntryPaths,
} from "../sftp-tool-content/sftpSelectionModel";
import type {
  SftpContextMenuEvent,
  SftpContextMenuState,
  SftpDialogAction,
  SftpSelectionEvent,
  SftpStatus,
} from "../sftp-tool-content/types";

import type { SftpTargetBoundContentProps } from "./SftpToolContent";
import { buildSftpContextMenuScope } from "./contextMenuScope";
import {
  useSftpContextMenuDismiss,
  useSftpUploadMenuDismiss,
  useTransientSftpErrorStatus,
} from "./useSftpTransientUiEffects";

const EMPTY_SFTP_ENTRIES: SftpEntry[] = [];

/** 承载单个目标代次内的目录、对话框、设置和传输副作用。 */
export function SftpTargetBoundContent({
  active,
  browserMode,
  compactHeader = false,
  fileTarget,
  followedLocalPath,
  followedRemotePath,
  followTerminalDirectory,
  initialRemotePath,
  interfaceDensity = "comfortable",
  onCurrentPathChange,
  onOpenWorkspaceFileTab,
  selectedMachine,
  setBrowserMode,
  setFollowTerminalDirectory,
  setShowHiddenFiles,
  setSftpClipboard,
  showLocalTransferActions = true,
  showTerminalDirectoryControls = true,
  showHiddenFiles,
  showTransferStatusBar = true,
  sftpClipboard,
  transferViewScope,
  transferTarget,
  workbenchClipboard,
  sftpRevealRequest,
  workspaceFileDirtyState,
  workspaceFileTabs,
}: SftpTargetBoundContentProps) {
  const [remoteBrowserState, dispatchRemoteBrowser] = useReducer(
    sftpRemoteBrowserReducer,
    initialSftpRemoteBrowserState,
  );
  const [operationStatus, setOperationStatus] = useState<SftpStatus | null>(
    null,
  );
  const [dialogAction, setDialogAction] = useState<SftpDialogAction | null>(
    null,
  );
  const [dialogBusy, setDialogBusy] = useState(false);
  const [dialogStatus, setDialogStatus] = useState<SftpStatus | null>(null);
  const [contextMenu, setContextMenu] = useState<SftpContextMenuState | null>(
    null,
  );
  const [uploadMenuOpen, setUploadMenuOpen] = useState(false);
  const [dragDropActive, setDragDropActive] = useState(false);
  const [remoteDownloadDragActive, setRemoteDownloadDragActive] = useState(false);
  const [remoteDownloadDropActive, setRemoteDownloadDropActive] = useState(false);
  const lastAutoFollowedPathRef = useRef<string | undefined>(undefined);
  const followTerminalDirectoryRef = useRef(followTerminalDirectory);
  const remoteBrowserStateRef = useRef(remoteBrowserState);
  const dropZoneRef = useRef<HTMLDivElement | null>(null);
  const remoteDragEntriesRef = useRef<SftpEntry[]>([]);
  const uploadMenuRef = useRef<HTMLDivElement | null>(null);
  const {
    bindingKey: targetBindingKey,
    captureTarget,
    isCurrent: isTargetBindingCurrent,
  } = useSftpTargetLifecycle({ active, target: fileTarget });
  const workspaceTarget = useMemo(
    () => fileTargetToRemoteTarget(fileTarget),
    [fileTarget],
  );
  const localWorkspaceTarget = useMemo(() => {
    if (selectedMachine?.kind !== "local") {
      return null;
    }
    return selectedMachine.target?.kind === "local"
      ? selectedMachine.target
      : localTarget(selectedMachine.profileId);
  }, [selectedMachine]);
  const fileRowHeight = resolveSftpFileRowHeight(interfaceDensity);
  const supportsSftpAdvancedActions = fileTarget?.kind === "ssh";
  const targetInitialPath = initialRemotePath ?? fileTarget?.initialPath;
  const { openEditorEntry, openWorkspaceDirectory, resetWorkspaceDialog } =
    useSftpWorkspaceDialogActions({
      fileTarget,
      onOpenWorkspaceFileTab,
      setBrowserMode,
      setContextMenu,
      setDialogAction,
      setDialogStatus,
      setOperationStatus,
      workspaceTarget,
    });

  followTerminalDirectoryRef.current = followTerminalDirectory;
  remoteBrowserStateRef.current = remoteBrowserState;
  const dispatchRemoteBrowserAction = useCallback(
    (action: SftpRemoteBrowserAction) => {
      remoteBrowserStateRef.current = sftpRemoteBrowserReducer(
        remoteBrowserStateRef.current,
        action,
      );
      dispatchRemoteBrowser(action);
    },
    [],
  );
  const {
    error,
    listing,
    loading,
    pathDraft,
    selectedEntryPath,
    selectedEntryPaths,
  } = remoteBrowserState;
  const currentPath = listing?.path ?? "/";
  const normalizedFollowedPath = normalizeFollowedRemotePath(followedRemotePath);
  const entries = listing?.entries ?? EMPTY_SFTP_ENTRIES;
  const visibleEntries = useMemo(
    () =>
      showHiddenFiles
        ? entries
        : entries.filter((entry) => !isHiddenEntry(entry)),
    [entries, showHiddenFiles],
  );
  const hiddenEntryCount = entries.length - visibleEntries.length;
  const selectedEntries = useMemo(
    () => visibleEntries.filter((entry) => selectedEntryPaths.has(entry.path)),
    [selectedEntryPaths, visibleEntries],
  );
  const transferableSelectedEntries = useMemo(
    () => selectedEntries.filter((entry) => transferKindFromEntry(entry)),
    [selectedEntries],
  );
  const nextRemoteBrowserRequestId = useCallback(() => {
    const requestId = nextSftpRemoteBrowserRequestId(
      remoteBrowserStateRef.current.requestId,
    );
    remoteBrowserStateRef.current = {
      ...remoteBrowserStateRef.current,
      requestId,
    };
    return requestId;
  }, []);
  const setPathDraft = useCallback(
    (value: SetStateAction<string>) => {
      dispatchRemoteBrowserAction({
        pathDraft: resolveSftpRemoteBrowserSetState(
          remoteBrowserStateRef.current.pathDraft,
          value,
        ),
        type: "path-draft-changed",
      });
    },
    [dispatchRemoteBrowserAction],
  );
  const setSelectedEntryPath = useCallback(
    (value: SetStateAction<string | null>) => {
      dispatchRemoteBrowserAction({
        selectedEntryPath: resolveSftpRemoteBrowserSetState(
          remoteBrowserStateRef.current.selectedEntryPath,
          value,
        ),
        type: "selection-anchor-changed",
      });
    },
    [dispatchRemoteBrowserAction],
  );
  const setSelectedEntryPaths = useCallback(
    (value: SetStateAction<Set<string>>) => {
      const current = remoteBrowserStateRef.current;
      const nextEntryPaths = resolveSftpRemoteBrowserSetState(
        current.selectedEntryPaths,
        value,
      );
      const currentEntryPath = current.selectedEntryPath;
      dispatchRemoteBrowserAction({
        selectedEntryPath:
          currentEntryPath && nextEntryPaths.has(currentEntryPath)
            ? currentEntryPath
            : (nextEntryPaths.values().next().value ?? null),
        selectedEntryPaths: nextEntryPaths,
        type: "selection-changed",
      });
    },
    [dispatchRemoteBrowserAction],
  );
  useTransientSftpErrorStatus(operationStatus, setOperationStatus);
  useSftpUploadMenuDismiss(
    uploadMenuOpen,
    uploadMenuRef,
    setUploadMenuOpen,
  );
  const closeContextMenu = useCallback(() => setContextMenu(null), []);
  useSftpContextMenuDismiss(Boolean(contextMenu), closeContextMenu);

  const loadDirectoryRequest: SftpTargetBoundDirectoryLoader = useCallback(
    async (path, expectedBinding) => {
      const binding = expectedBinding ?? captureTarget();
      if (!binding || !isTargetBindingCurrent(binding)) {
        return;
      }
      const requestTarget = binding.target;
      const nextPath = normalizeRemotePath(path);
      const requestId = nextRemoteBrowserRequestId();
      dispatchRemoteBrowserAction({
        requestId,
        type: "load-started",
      });
      setContextMenu(null);
      setDialogAction(null);
      setDialogStatus(null);
      try {
        const nextListing =
          requestTarget.kind === "ssh"
            ? await listSftpDirectory({
                hostId: requestTarget.hostId,
                path: nextPath,
              })
            : await listDockerContainerDirectory({
                containerId: requestTarget.containerId,
                hostId: requestTarget.hostId,
                path: nextPath,
                runtime: requestTarget.runtime,
              });
        if (!isTargetBindingCurrent(binding)) {
          return;
        }
        dispatchRemoteBrowserAction({
          listing: normalizeDirectoryListing(nextListing),
          requestId,
          type: "load-succeeded",
        });
      } catch (nextError) {
        if (!isTargetBindingCurrent(binding)) {
          return;
        }
        dispatchRemoteBrowserAction({
          error: normalizeSftpRemoteBrowserError(nextError),
          requestId,
          type: "load-failed",
        });
      }
    },
    [
      captureTarget,
      dispatchRemoteBrowserAction,
      isTargetBindingCurrent,
      nextRemoteBrowserRequestId,
    ],
  );
  const loadDirectory = useMemo(
    () =>
      bindSftpTargetDirectoryLoader(
        loadDirectoryRequest,
        captureTarget,
        isTargetBindingCurrent,
      ),
    [captureTarget, isTargetBindingCurrent, loadDirectoryRequest],
  );
  const {
    cwdTrackingSetupBusy,
    hostKeyTrustBusy,
    setupRemoteCwdTracking,
    trustHostKey,
  } = useSftpRemoteSetupActions({
    currentPath,
    captureTarget,
    fileTarget,
    isTargetBindingCurrent,
    loadDirectory,
    setContextMenu,
    setDialogAction,
    setDialogStatus,
    setOperationStatus,
  });
  const setFollowTerminalDirectoryFromView = useCallback(
    (value: SetStateAction<boolean>) => {
      const current = followTerminalDirectoryRef.current;
      const next = resolveSftpRemoteBrowserSetState(current, value);
      const decision = resolveFollowTerminalDirectoryToggle({
        currentEnabled: current,
        hasFileTarget: Boolean(fileTarget),
        lastAutoFollowedPath: lastAutoFollowedPathRef.current,
        nextEnabled: next,
        normalizedFollowedPath,
      });
      followTerminalDirectoryRef.current = decision.enabled;
      setFollowTerminalDirectory(decision.enabled);
      lastAutoFollowedPathRef.current = decision.nextLastAutoFollowedPath;
      if (decision.clearOperationStatus) {
        setOperationStatus(null);
      }
      if (decision.loadPath) {
        void loadDirectory(decision.loadPath);
      }
    },
    [
      fileTarget,
      loadDirectory,
      normalizedFollowedPath,
      setFollowTerminalDirectory,
    ],
  );

  useEffect(() => {
    dispatchRemoteBrowserAction({
      requestId: nextRemoteBrowserRequestId(),
      type: "target-reset",
    });
    setOperationStatus(null);
    setDialogAction(null);
    setDialogStatus(null);
    setContextMenu(null);
    lastAutoFollowedPathRef.current = undefined;
    resetWorkspaceDialog();
    setDragDropActive(false);
    setRemoteDownloadDragActive(false);
    setRemoteDownloadDropActive(false);
    remoteDragEntriesRef.current = [];
    if (targetInitialPath) {
      void loadDirectory(targetInitialPath);
    }
  }, [
    dispatchRemoteBrowserAction,
    loadDirectory,
    nextRemoteBrowserRequestId,
    resetWorkspaceDialog,
    targetBindingKey,
    targetInitialPath,
  ]);

  useSftpResumableDirectory({
    active, currentPath: listing?.path, initialPath: targetInitialPath, loadDirectory, onCurrentPathChange, stateRef: remoteBrowserStateRef,
  });

  useEffect(() => {
    if (!active || !workspaceTarget || !sftpRevealRequest) {
      return;
    }
    if (
      targetStableId(workspaceTarget) !==
      targetStableId(sftpRevealRequest.target)
    ) {
      return;
    }
    setFollowTerminalDirectory(false);
    setOperationStatus(null);
    let canceled = false;
    const revealFile = async () => {
      await loadDirectory(sftpRevealRequest.directoryPath);
      if (canceled) {
        return;
      }
      setSelectedEntryPath(sftpRevealRequest.filePath);
      setSelectedEntryPaths(new Set([sftpRevealRequest.filePath]));
    };
    void revealFile();
    return () => {
      canceled = true;
    };
  }, [
    active,
    loadDirectory,
    setFollowTerminalDirectory,
    setSelectedEntryPath,
    setSelectedEntryPaths,
    sftpRevealRequest,
    workspaceTarget,
  ]);

  const { refreshTransfers, setTransfers, visibleTransfers } =
    useSftpTransferSync({
      active,
      currentPath,
      fileTarget,
      loadDirectory,
      viewScope: transferViewScope,
    });

  useEffect(() => {
    const decision = resolveFollowedRemotePathChange({
      enabled: followTerminalDirectory,
      hasFileTarget: Boolean(fileTarget),
      lastAutoFollowedPath: lastAutoFollowedPathRef.current,
      normalizedFollowedPath,
    });
    lastAutoFollowedPathRef.current = decision.nextLastAutoFollowedPath;
    if (decision.clearOperationStatus) {
      setOperationStatus(null);
    }
    if (decision.loadPath) {
      void loadDirectory(decision.loadPath);
    }
  }, [
    currentPath,
    followTerminalDirectory,
    loadDirectory,
    normalizedFollowedPath,
    fileTarget,
  ]);
  const openContextMenuAt = (
    clientX: number,
    clientY: number,
    entry: SftpEntry | null,
  ) => {
    const position = clampContextMenuPosition(clientX, clientY);
    const currentSelection = {
      selectedEntryPath: remoteBrowserStateRef.current.selectedEntryPath,
      selectedEntryPaths: remoteBrowserStateRef.current.selectedEntryPaths,
    };
    const nextSelection = nextContextMenuSelection(
      currentSelection,
      entry?.path ?? null,
    );
    if (nextSelection !== currentSelection) {
      dispatchRemoteBrowserAction({
        selectedEntryPath: nextSelection.selectedEntryPath,
        selectedEntryPaths: nextSelection.selectedEntryPaths,
        type: "selection-changed",
      });
    }
    const contextSelectedEntries = visibleEntries.filter((visibleEntry) =>
      nextSelection.selectedEntryPaths.has(visibleEntry.path),
    );
    const contextTransferableEntries = contextSelectedEntries.filter(
      (visibleEntry) => transferKindFromEntry(visibleEntry),
    );
    setContextMenu({
      entry,
      scope: buildSftpContextMenuScope({
        entry,
        selectedEntries: contextSelectedEntries,
        transferableSelectedEntries: contextTransferableEntries,
      }),
      x: position.x,
      y: position.y,
    });
  };

  const openContextMenu = (
    event: SftpContextMenuEvent,
    entry: SftpEntry | null,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    openContextMenuAt(event.clientX, event.clientY, entry);
  };

  const selectEntry = (entry: SftpEntry, event?: SftpSelectionEvent) => {
    const nextSelection = nextSelectedEntryPaths(
      visibleEntries,
      selectedEntryPaths,
      selectedEntryPath,
      entry.path,
      event,
    );
    setSelectedEntryPaths(nextSelection);
    setSelectedEntryPath(
      nextSelection.has(entry.path)
        ? entry.path
        : (nextSelection.values().next().value ?? null),
    );
  };

  const openContextMenuFromPress = (
    event: SftpContextMenuEvent,
    entry: SftpEntry | null,
  ) => {
    if (event.button !== 2) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    openContextMenuAt(event.clientX, event.clientY, entry);
  };

  const submitPathDraft = () => {
    const nextPath = normalizeRemotePath(pathDraft);
    setPathDraft(nextPath);
    setOperationStatus(null);
    void loadDirectory(nextPath);
  };

  const {
    cancelTransfer,
    clearFinishedTransfers,
    closeTransferConflictDialog,
    confirmTransferConflictPolicy,
    copyRemotePath,
    copySelectedRemoteItem,
    downloadEntry,
    downloadEntryAsArchive,
    downloadEntryToLocalClipboard,
    downloadSelectedEntries,
    finishRemoteEntryDrag,
    handleRemoteDownloadDragEnter,
    handleRemoteDownloadDragLeave,
    handleRemoteDownloadDragOver,
    handleRemoteDownloadDrop,
    handleSftpKeyDown: handleSftpTransferKeyDown,
    pasteSftpClipboard,
    pendingTransferConflict,
    retryTransfer,
    startRemoteEntryDrag,
    transferSelectedEntriesToTarget,
    uploadLocalArchive,
    uploadDroppedLocalPaths,
    uploadLocalDirectory,
    uploadLocalFile,
  } = useSftpTransferActions({
    currentPath,
    fileTarget,
    loadDirectory,
    refreshTransfers,
    remoteDragEntriesRef,
    selectedEntries,
    selectedEntryPaths,
    setContextMenu,
    setDialogAction,
    setDialogStatus,
    setDragDropActive,
    setOperationStatus,
    setRemoteDownloadDragActive,
    setRemoteDownloadDropActive,
    setSelectedEntryPath,
    setSelectedEntryPaths,
    setSftpClipboard,
    setTransfers,
    sftpClipboard,
    transferableSelectedEntries,
    transferTarget,
    viewScope: transferViewScope,
    workbenchClipboard,
  });

  useSftpLocalUploadDropActions({
    active,
    currentPath,
    dropZoneRef,
    fileTarget,
    setDragDropActive,
    setOperationStatus,
    uploadDroppedLocalPaths,
  });

  const {
    openChmodDialog,
    openDeleteDialog,
    openNewDirectoryDialog,
    openRenameDialog,
    submitDialogAction,
  } = useSftpDialogActions({
    captureTarget,
    currentPath,
    dialogAction,
    fileTarget,
    isTargetBindingCurrent,
    loadDirectory,
    setContextMenu,
    setDialogAction,
    setDialogBusy,
    setDialogStatus,
    setOperationStatus,
  });

  const { executeContextMenuAction } = useSftpContextMenuActions({
    contextMenu,
    copyRemotePath,
    copySelectedRemoteItem,
    currentPath,
    downloadEntry,
    downloadEntryAsArchive,
    downloadEntryToLocalClipboard,
    downloadSelectedEntries,
    loadDirectory,
    openChmodDialog,
    openDeleteDialog,
    openEditorEntry,
    openNewDirectoryDialog,
    openRenameDialog,
    openWorkspaceDirectory,
    pasteSftpClipboard,
    setContextMenu,
    setOperationStatus,
    setShowHiddenFiles,
    transferSelectedEntriesToTarget,
    uploadLocalArchive,
    uploadLocalDirectory,
    uploadLocalFile,
  });

  const { handleKeyDown } = useSftpBrowserCommands({
    handleTransferKeyDown: handleSftpTransferKeyDown,
    openDeleteDialog,
    openRenameDialog,
    selectedEntries,
  });

  if (selectedMachine?.kind === "local") {
    return (
      <LocalTransferPane
        active={active}
        followedPath={followedLocalPath}
        initialPath={followedLocalPath ?? selectedMachine.cwd}
        interfaceDensity={interfaceDensity}
        mode="browser"
        onOpenLocalFile={(entry) => {
          if (!localWorkspaceTarget || !onOpenWorkspaceFileTab) {
            return;
          }
          onOpenWorkspaceFileTab({
            access: "editable",
            path: entry.path,
            source: "local",
            target: localWorkspaceTarget,
          });
        }}
        targetMachine={undefined}
        targetPath={undefined}
        transferViewScope={transferViewScope}
      />
    );
  }

  return (
    <>
      <SftpBrowserPresenter
        capabilities={{
          compactHeader,
          cwdTrackingSetupBusy,
          fileRowHeight,
          hostKeyTrustBusy,
          interfaceDensity,
          setupRemoteCwdTracking,
          showLocalTransferActions,
          showTerminalDirectoryControls,
          showTransferStatusBar,
          supportsSftpAdvancedActions,
          trustHostKey,
          workspaceFileDirtyState,
          workspaceFileTabs,
          workspaceTarget,
        }}
        dialogs={{
          contextMenu,
          dialogAction,
          dialogBusy,
          dialogStatus,
          executeContextMenuAction,
          setContextMenu,
          setDialogAction,
          setDialogStatus,
          submitDialogAction,
        }}
        navigation={{
          browserMode,
          currentPath,
          fileTarget,
          followTerminalDirectory,
          listing,
          loadDirectory,
          loading,
          normalizedFollowedPath,
          pathDraft,
          setBrowserMode,
          setFollowTerminalDirectory: setFollowTerminalDirectoryFromView,
          setPathDraft,
          submitPathDraft,
        }}
        operations={{
          downloadSelectedEntries,
          dragDropActive,
          dropZoneRef,
          error,
          finishRemoteEntryDrag,
          handleKeyDown,
          handleRemoteDownloadDragEnter,
          handleRemoteDownloadDragLeave,
          handleRemoteDownloadDragOver,
          handleRemoteDownloadDrop,
          openContextMenu,
          openContextMenuFromPress,
          openEditorEntry,
          openNewDirectoryDialog,
          operationStatus,
          remoteDownloadDragActive,
          remoteDownloadDropActive,
          remoteDragEntriesRef,
          setOperationStatus,
          startRemoteEntryDrag,
        }}
        selection={{
          entries,
          hiddenEntryCount,
          selectEntry,
          selectedEntries,
          selectedEntryPath,
          selectedEntryPaths,
          setShowHiddenFiles,
          showHiddenFiles,
          transferableSelectedEntries,
          visibleEntries,
        }}
        transfers={{
          cancelTransfer,
          clearFinishedTransfers,
          retryTransfer,
          setUploadMenuOpen,
          transferSelectedEntriesToTarget,
          transferTarget,
          uploadLocalDirectory,
          uploadLocalFile,
          uploadMenuOpen,
          uploadMenuRef,
          visibleTransfers,
        }}
      />
      <SftpTransferConflictDialog
        conflictCount={pendingTransferConflict?.conflictCount ?? 0}
        onClose={closeTransferConflictDialog}
        onConfirm={(policy) => {
          void confirmTransferConflictPolicy(policy);
        }}
        open={Boolean(pendingTransferConflict)}
      />
    </>
  );
}
