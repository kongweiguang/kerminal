// @author kongweiguang

import {
  ArrowLeftRight,
  HardDrive,
  RefreshCw,
  Trash2,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button } from "../../components/ui/button";
import { UserFacingNotice } from "../../components/ui/user-facing-notice";
import { cn } from "../../lib/cn";
import { closeExternalSshLaunch } from "../../lib/externalLaunchApi";
import {
  cancelSftpTransfer,
  listSftpTransfers,
} from "../../lib/sftpApi";
import { sshTarget } from "../../lib/targetModel";
import { defaultDesktopNotificationSettings } from "../settings/defaults/index";
import type {
  DesktopNotificationSettings,
  InterfaceDensity,
} from "../settings/contracts/index";
import type { Machine, MachineGroup } from "../workspace/contracts/index";
import { LocalTransferPane } from "./LocalTransferPane";
import type { SftpClipboard } from "./SftpToolContent";
import { SftpTransferQueuePanel } from "./SftpTransferQueuePanel";
import { HostTabButton } from "./SftpTransferWorkbench.parts";
import {
  RemoteHostPaneBody,
  SearchableSftpHostSelect,
} from "./SftpTransferWorkbenchHostViews";
import type { SftpTransferTarget } from "./sftp-tool-content/types";
import { sftpWorkbenchTransferViewScope } from "./sftp-tool-content/sftpTransferScopeModel";
import {
  wrapRemoteWorkbenchClipboard,
  type SftpWorkbenchClipboard,
  type SftpWorkbenchLocalClipboard,
} from "./sftpTransferClipboardModel";
import {
  activeTransferCount,
  canClearFinishedTransfers,
} from "./sftpTransferModel";
import { registerExternalSftpTabCloseHandler } from "./externalSftpLaunchLifecycle";
import {
  collectSshMachines,
  createHostTab,
  firstValidHostId,
  pruneHostTabPaths,
  reconcileHostTabs,
  resolveActivePaneTabId,
  resolveActiveHostTabId,
  SFTP_TRANSFER_LOCAL_TAB_ID,
  type SftpTransferHostSide,
  type SftpTransferHostTab,
} from "./sftpTransferWorkbenchModel";
import { useSftpManagedTransferQueue } from "./useSftpManagedTransferQueue";
import { useSftpTransferNotifications } from "./useSftpTransferNotifications";
import {
  buildSftpTransferQueueError,
  useSftpTransferQueueSync,
} from "./useSftpTransferQueueSync";

export interface SftpTransferWorkbenchProps {
  active?: boolean;
  createdHostTarget?: SftpTransferCreatedHostTarget;
  desktopNotifications?: DesktopNotificationSettings;
  groups: MachineGroup[];
  initialRightHostId?: string;
  initialRightPath?: string;
  initialRightSelection?: string;
  externalLaunchId?: string;
  interfaceDensity?: InterfaceDensity;
  lockedLeftHostId?: string;
  onCreateSshHost?: (request: SftpTransferCreateHostRequest) => void;
  workspaceTabId?: string;
}
export interface SftpTransferCreateHostRequest {
  side: SftpTransferHostSide;
  workspaceTabId?: string;
}

export interface SftpTransferCreatedHostTarget {
  hostId: string;
  sequence: number;
  side: SftpTransferHostSide;
  workspaceTabId?: string;
}

export function SftpTransferWorkbench({
  active = true,
  createdHostTarget,
  desktopNotifications = defaultDesktopNotificationSettings,
  groups,
  initialRightHostId,
  initialRightPath,
  initialRightSelection,
  externalLaunchId,
  interfaceDensity = "comfortable",
  lockedLeftHostId,
  onCreateSshHost,
  workspaceTabId,
}: SftpTransferWorkbenchProps) {
  const sshMachines = useMemo(() => collectSshMachines(groups), [groups]);
  const sshMachineIds = useMemo(
    () => new Set(sshMachines.map((machine) => machine.id)),
    [sshMachines],
  );
  const machinesById = useMemo(
    () => new Map(sshMachines.map((machine) => [machine.id, machine])),
    [sshMachines],
  );
  const hostLabelById = useMemo(
    () => new Map(sshMachines.map((machine) => [machine.id, machine.name])),
    [sshMachines],
  );
  const defaultRightHostId = firstValidHostId(
    sshMachineIds,
    initialRightHostId,
    lockedLeftHostId,
  );
  const [leftTabs, setLeftTabs] = useState<SftpTransferHostTab[]>([]);
  const [activeLeftTabId, setActiveLeftTabId] = useState(
    SFTP_TRANSFER_LOCAL_TAB_ID,
  );
  const [rightTabs, setRightTabs] = useState<SftpTransferHostTab[]>([]);
  const [activeRightTabId, setActiveRightTabId] = useState("");
  const [clipboard, setClipboard] = useState<SftpWorkbenchClipboard | null>(null);
  const [leftLocalPath, setLeftLocalPath] = useState<string | undefined>();
  const [leftCurrentPaths, setLeftCurrentPaths] = useState<Record<string, string>>(
    {},
  );
  const [rightCurrentPaths, setRightCurrentPaths] = useState<Record<string, string>>(
    {},
  );
  const transferScopeFallbackId = useId();
  const transferViewScope = useMemo(
    () =>
      sftpWorkbenchTransferViewScope({
        fallbackId: transferScopeFallbackId,
        workspaceTabId,
      }),
    [transferScopeFallbackId, workspaceTabId],
  );
  const handledCreatedHostSequenceRef = useRef<number | undefined>(undefined);
  const {
    clearQueueError,
    queueError,
    refreshTransfers,
    setQueueError,
    setTransfers,
    transfers,
  } = useSftpTransferQueueSync({ active, viewScope: transferViewScope });
  const transfersRef = useRef(transfers);

  useSftpTransferNotifications({
    active,
    desktopNotifications,
    hostLabelById,
    notificationKeyPrefix: transferViewScope,
    transfers,
  });

  transfersRef.current = transfers;

  useEffect(() => {
    if (!externalLaunchId || !workspaceTabId) {
      return;
    }
    return registerExternalSftpTabCloseHandler(workspaceTabId, () => {
      const activeTransfers = transfersRef.current.filter(
        (transfer) =>
          transfer.status === "queued" || transfer.status === "running",
      );
      if (
        activeTransfers.length > 0 &&
        !window.confirm(
          `当前工作台仍有 ${activeTransfers.length} 个活动传输。关闭将取消这些任务，是否继续？`,
        )
      ) {
        return { canClose: false };
      }

      const cleanup = (async () => {
        try {
          await Promise.all(
            activeTransfers.map((transfer) =>
              cancelSftpTransfer({
                transferId: transfer.id,
                viewScope: transferViewScope,
              }),
            ),
          );
          await waitForTransferScopeIdle(transferViewScope);
          await closeExternalSshLaunch(externalLaunchId);
        } catch (nextError) {
          setQueueError(buildSftpTransferQueueError(nextError));
          throw nextError;
        }
      })();
      return { canClose: true, cleanup };
    });
  }, [externalLaunchId, setQueueError, transferViewScope, workspaceTabId]);

  useEffect(() => {
    setLeftTabs((current) =>
      reconcileHostTabs({
        hostIds: sshMachineIds,
        side: "left",
        tabs: current,
      }),
    );
  }, [sshMachineIds]);

  useEffect(() => {
    setActiveLeftTabId((current) =>
      resolveActivePaneTabId({ currentTabId: current, tabs: leftTabs }),
    );
  }, [leftTabs]);

  useEffect(() => {
    setLeftCurrentPaths((current) => pruneHostTabPaths(current, leftTabs));
  }, [leftTabs]);

  useEffect(() => {
    setRightTabs((current) =>
      reconcileHostTabs({
        fallbackHostId: defaultRightHostId,
        hostIds: sshMachineIds,
        lockedHostId: lockedLeftHostId,
        side: "right",
        tabs: current,
      }),
    );
  }, [defaultRightHostId, lockedLeftHostId, sshMachineIds]);

  useEffect(() => {
    setActiveRightTabId((current) =>
      resolveActiveHostTabId({
        currentTabId: current,
        preferredHostId: defaultRightHostId,
        tabs: rightTabs,
      }),
    );
  }, [defaultRightHostId, rightTabs]);

  useEffect(() => {
    setRightCurrentPaths((current) => pruneHostTabPaths(current, rightTabs));
  }, [rightTabs]);

  const addLeftHostTab = useCallback(
    (hostId: string) => {
      const machine = machinesById.get(hostId);
      if (!machine) {
        return;
      }
      const nextTab = createHostTab("left", hostId);
      setLeftTabs((current) => [...current, nextTab]);
      setActiveLeftTabId(nextTab.id);
    },
    [machinesById],
  );

  const closeLeftHostTab = (tabId: string) => {
    setLeftTabs((current) => current.filter((tab) => tab.id !== tabId));
    setActiveLeftTabId((current) =>
      current === tabId ? SFTP_TRANSFER_LOCAL_TAB_ID : current,
    );
  };

  const addRightHostTab = useCallback(
    (hostId: string) => {
      const machine = machinesById.get(hostId);
      if (!machine) {
        return;
      }
      const nextTab = createHostTab("right", hostId);
      setRightTabs((current) => [...current, nextTab]);
      setActiveRightTabId(nextTab.id);
    },
    [machinesById],
  );

  const closeRightHostTab = (tabId: string) => {
    setRightTabs((current) => current.filter((tab) => tab.id !== tabId));
  };

  useEffect(() => {
    if (
      !createdHostTarget ||
      createdHostTarget.workspaceTabId !== workspaceTabId ||
      handledCreatedHostSequenceRef.current === createdHostTarget.sequence ||
      !machinesById.has(createdHostTarget.hostId)
    ) {
      return;
    }

    handledCreatedHostSequenceRef.current = createdHostTarget.sequence;
    if (createdHostTarget.side === "left") {
      addLeftHostTab(createdHostTarget.hostId);
      return;
    }
    addRightHostTab(createdHostTarget.hostId);
  }, [
    addLeftHostTab,
    addRightHostTab,
    createdHostTarget,
    machinesById,
    workspaceTabId,
  ]);

  const { cancelTransfer, clearFinishedTransfers, retryTransfer } =
    useSftpManagedTransferQueue({
      onCancelSuccess: clearQueueError,
      onClearSuccess: clearQueueError,
      onError: (error) => setQueueError(buildSftpTransferQueueError(error)),
      onRetrySuccess: clearQueueError,
      onRetryUnavailable: (message) =>
        setQueueError(buildSftpTransferQueueError(message)),
      refreshTransfers,
      setTransfers,
      viewScope: transferViewScope,
    });

  const updateRightPath = useCallback((tabId: string, path: string) => {
    setRightCurrentPaths((current) =>
      current[tabId] === path ? current : { ...current, [tabId]: path },
    );
  }, []);

  const updateLeftPath = useCallback((tabId: string, path: string) => {
    setLeftCurrentPaths((current) =>
      current[tabId] === path ? current : { ...current, [tabId]: path },
    );
  }, []);
  const handleRemoteClipboardChange = useCallback(
    (nextClipboard: SftpClipboard | null) => {
      setClipboard(wrapRemoteWorkbenchClipboard(nextClipboard));
    },
    [],
  );
  const handleLocalClipboardChange = useCallback(
    (nextClipboard: SftpWorkbenchLocalClipboard) => {
      setClipboard(nextClipboard);
    },
    [],
  );
  const requestCreateSshHost = useCallback(
    ({ side }: SftpTransferCreateHostRequest) => {
      onCreateSshHost?.({ side, workspaceTabId });
    },
    [onCreateSshHost, workspaceTabId],
  );

  const isLeftLocalActive = activeLeftTabId === SFTP_TRANSFER_LOCAL_TAB_ID;
  const leftActiveTab = isLeftLocalActive
    ? undefined
    : leftTabs.find((tab) => tab.id === activeLeftTabId);
  const leftMachine = leftActiveTab
    ? machinesById.get(leftActiveTab.hostId)
    : undefined;
  const leftCurrentPath = leftActiveTab
    ? (leftCurrentPaths[leftActiveTab.id] ?? "/")
    : undefined;
  const rightActiveTab = rightTabs.find((tab) => tab.id === activeRightTabId);
  const rightMachine = rightActiveTab
    ? machinesById.get(rightActiveTab.hostId)
    : undefined;
  const rightCurrentPath = rightActiveTab
    ? (rightCurrentPaths[rightActiveTab.id] ?? initialRightPath ?? "/")
    : undefined;
  const initialRightRevealRequest = useMemo(
    () =>
      initialRightSelection && initialRightPath && rightMachine
        ? {
            directoryPath: initialRightPath,
            filePath: `${initialRightPath.replace(/\/?$/, "/")}${initialRightSelection}`,
            id: 1,
            target: sshTarget(rightMachine.id),
          }
        : undefined,
    [initialRightPath, initialRightSelection, rightMachine],
  );
  const leftTransferTarget = useMemo<SftpTransferTarget | undefined>(
    () => {
      if (isLeftLocalActive) {
        return leftLocalPath
          ? { kind: "local", localPath: leftLocalPath, side: "left" }
          : undefined;
      }
      if (!leftMachine || !leftCurrentPath) {
        return undefined;
      }
      return {
        hostId: leftMachine.id,
        hostLabel: leftMachine.name,
        kind: "remote",
        remotePath: leftCurrentPath,
        side: "left",
      };
    },
    [isLeftLocalActive, leftCurrentPath, leftLocalPath, leftMachine],
  );
  const rightTransferTarget = useMemo<SftpTransferTarget | undefined>(
    () =>
      rightMachine && rightCurrentPath
        ? {
            hostId: rightMachine.id,
            hostLabel: rightMachine.name,
            kind: "remote",
            remotePath: rightCurrentPath,
            side: "right",
          }
        : undefined,
    [rightCurrentPath, rightMachine],
  );
  const canClearTransfers = canClearFinishedTransfers(transfers);
  const compactDensity = interfaceDensity === "compact";
  const spaciousDensity = interfaceDensity === "spacious";
  const headerPaddingClass = compactDensity
    ? "px-3 py-2"
    : spaciousDensity
      ? "px-5 py-4"
      : "px-4 py-3";
  const bodyGridClass = compactDensity
    ? "grid min-h-0 flex-1 grid-cols-1 gap-2 p-2 xl:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)]"
    : spaciousDensity
      ? "grid min-h-0 flex-1 grid-cols-1 gap-4 p-4 xl:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)]"
      : "grid min-h-0 flex-1 grid-cols-1 gap-3 p-3 xl:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)]";
  const headerIconClass = compactDensity
    ? "h-8 w-8 rounded-[var(--radius-control)]"
    : spaciousDensity
      ? "h-10 w-10 rounded-[var(--radius-control)]"
      : "h-9 w-9 rounded-[var(--radius-control)]";
  const headerActionClass = compactDensity
    ? "h-8 w-8 rounded-[var(--radius-control)]"
    : spaciousDensity
      ? "h-10 w-10 rounded-[var(--radius-control)]"
      : "h-9 w-9 rounded-[var(--radius-control)]";

  return (
    <section
      aria-label="SFTP 传输工作台"
      className="kerminal-solid-surface flex h-full min-h-0 flex-col overflow-hidden rounded-[var(--radius-card)] border"
    >
      <header
        className={cn(
          "flex shrink-0 items-center justify-between gap-3 border-b border-[var(--border-subtle)]",
          headerPaddingClass,
        )}
      >
        <div className="flex min-w-0 items-center gap-3">
          <span
            className={cn(
              "flex shrink-0 items-center justify-center bg-sky-500/10 text-sky-600 dark:bg-sky-400/14 dark:text-sky-200",
              headerIconClass,
            )}
          >
            <ArrowLeftRight className="h-4 w-4" />
          </span>
          <h2 className="truncate text-sm font-semibold text-zinc-950 dark:text-zinc-50">
            SFTP 传输
          </h2>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            aria-label="刷新传输队列"
            className={headerActionClass}
            onClick={refreshTransfers}
            size="icon"
            title="刷新传输队列"
            type="button"
            variant="ghost"
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button
            aria-label="清理完成的传输"
            className={headerActionClass}
            disabled={!canClearTransfers}
            onClick={() => void clearFinishedTransfers()}
            size="icon"
            title="清理完成的传输"
            type="button"
            variant="ghost"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <div className={bodyGridClass}>
        <LeftPane
          active={active}
          activeTab={leftActiveTab}
          activeTabId={activeLeftTabId}
          clipboard={clipboard}
          hostTabs={leftTabs}
          interfaceDensity={interfaceDensity}
          localActive={isLeftLocalActive}
          machines={sshMachines}
          machinesById={machinesById}
          onActivateLocal={() => setActiveLeftTabId(SFTP_TRANSFER_LOCAL_TAB_ID)}
          onActiveTabChange={setActiveLeftTabId}
          onAddHost={addLeftHostTab}
          onCreateSshHost={onCreateSshHost ? requestCreateSshHost : undefined}
          onClipboardChange={handleRemoteClipboardChange}
          onCloseTab={closeLeftHostTab}
          onCurrentPathChange={setLeftLocalPath}
          onLocalClipboardChange={handleLocalClipboardChange}
          onPathChange={updateLeftPath}
          onTransferQueued={refreshTransfers}
          targetMachine={rightMachine}
          targetPath={rightCurrentPath}
          transferTarget={rightTransferTarget}
          transferViewScope={transferViewScope}
        />
        <HostPane
          active={active}
          activeTab={rightActiveTab}
          activeTabId={activeRightTabId}
          clipboard={clipboard}
          hostTabs={rightTabs}
          interfaceDensity={interfaceDensity}
          machines={sshMachines}
          machinesById={machinesById}
          onActiveTabChange={setActiveRightTabId}
          onAddHost={addRightHostTab}
          onCreateSshHost={onCreateSshHost ? requestCreateSshHost : undefined}
          onClipboardChange={handleRemoteClipboardChange}
          onCloseTab={closeRightHostTab}
          onPathChange={updateRightPath}
          revealRequest={initialRightRevealRequest}
          side="right"
          title="右侧服务器"
          transferTarget={leftTransferTarget}
          transferViewScope={transferViewScope}
        />
      </div>

      {queueError ? (
        <div className="shrink-0 border-t border-[var(--border-subtle)] p-3">
          <UserFacingNotice compact message={queueError} />
        </div>
      ) : null}
      <SftpTransferQueuePanel
        error={null}
        onCancel={(transferId) => void cancelTransfer(transferId)}
        onRetry={(transfer) => void retryTransfer(transfer)}
        transfers={transfers}
      />
    </section>
  );
}

async function waitForTransferScopeIdle(viewScope: string) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const transfers = await listSftpTransfers({ viewScope });
    if (activeTransferCount(transfers) === 0) {
      return;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 100));
  }
  throw new Error("等待传输任务取消超时，外部 SFTP 工作台尚未关闭。");
}

function LeftPane({
  active,
  activeTab,
  activeTabId,
  clipboard,
  hostTabs,
  interfaceDensity,
  localActive,
  machines,
  machinesById,
  onActivateLocal,
  onActiveTabChange,
  onAddHost,
  onCreateSshHost,
  onClipboardChange,
  onLocalClipboardChange,
  onCloseTab,
  onCurrentPathChange,
  onPathChange,
  onTransferQueued,
  targetMachine,
  targetPath,
  transferTarget,
  transferViewScope,
}: {
  active: boolean;
  activeTab: SftpTransferHostTab | undefined;
  activeTabId: string;
  clipboard: SftpWorkbenchClipboard | null;
  hostTabs: SftpTransferHostTab[];
  interfaceDensity: InterfaceDensity;
  localActive: boolean;
  machines: Machine[];
  machinesById: Map<string, Machine>;
  onActivateLocal: () => void;
  onActiveTabChange: (tabId: string) => void;
  onAddHost: (hostId: string) => void;
  onCreateSshHost?: (request: SftpTransferCreateHostRequest) => void;
  onClipboardChange: (clipboard: SftpClipboard | null) => void;
  onCloseTab: (tabId: string) => void;
  onCurrentPathChange?: (path: string | undefined) => void;
  onLocalClipboardChange: (clipboard: SftpWorkbenchLocalClipboard) => void;
  onPathChange: (tabId: string, path: string) => void;
  onTransferQueued?: () => void;
  targetMachine: Machine | undefined;
  targetPath: string | undefined;
  transferTarget?: SftpTransferTarget;
  transferViewScope: string;
}) {
  const compactDensity = interfaceDensity === "compact";
  const spaciousDensity = interfaceDensity === "spacious";
  const targetBarPaddingClass = compactDensity
    ? "px-2.5 py-1.5"
    : spaciousDensity
      ? "px-3 py-2"
      : "px-3 py-2";
  const localTabButtonClass = compactDensity
    ? "h-7 rounded-[var(--radius-control)] px-2"
    : spaciousDensity
      ? "h-9 rounded-[var(--radius-control)] px-2.5"
      : "h-8 rounded-[var(--radius-control)] px-2";

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-hidden">
      <div
        aria-label="左侧目标"
        className={cn(
          "kerminal-muted-surface flex shrink-0 items-center gap-2 rounded-[var(--radius-control)] border",
          targetBarPaddingClass,
        )}
      >
        <div className="scrollbar-none flex min-w-0 flex-1 gap-1 overflow-x-auto">
          <button
            aria-pressed={localActive}
            className={cn(
              "kerminal-focus-ring kerminal-pressable flex max-w-[180px] items-center gap-1.5 text-xs transition",
              localTabButtonClass,
              localActive
                ? "bg-[var(--surface-selected)] text-sky-700 dark:text-sky-100"
                : "text-zinc-500 hover:bg-[var(--surface-hover)] hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-100",
            )}
            onClick={onActivateLocal}
            title="本机"
            type="button"
          >
            <HardDrive className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">本机</span>
          </button>
          {hostTabs.map((tab) => (
            <HostTabButton
              active={tab.id === activeTabId}
              interfaceDensity={interfaceDensity}
              key={tab.id}
              machine={machinesById.get(tab.hostId)}
              onActivate={() => onActiveTabChange(tab.id)}
              onClose={() => onCloseTab(tab.id)}
              tab={tab}
            />
          ))}
        </div>
        <SearchableSftpHostSelect
          ariaLabel="添加左侧服务器"
          createDescription="创建后加入左侧"
          disabled={!onCreateSshHost && machines.length === 0}
          interfaceDensity={interfaceDensity}
          machines={machines}
          onAddHost={onAddHost}
          onCreateSshHost={onCreateSshHost}
          side="left"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {localActive ? (
          <LocalTransferPane
            active={active}
            interfaceDensity={interfaceDensity}
            onCurrentPathChange={onCurrentPathChange}
            onLocalClipboardChange={onLocalClipboardChange}
            onTransferQueued={onTransferQueued}
            targetMachine={targetMachine}
            targetPath={targetPath}
            transferViewScope={transferViewScope}
          />
        ) : (
          <div className="kerminal-muted-surface flex h-full min-h-0 flex-col overflow-hidden rounded-[var(--radius-card)] border">
            <RemoteHostPaneBody
              active={active}
              activeTab={activeTab}
              availableMachineCount={machines.length}
              clipboard={clipboard}
              emptyLabel="选择左侧服务器。"
              interfaceDensity={interfaceDensity}
              machinesById={machinesById}
              onClipboardChange={onClipboardChange}
              onPathChange={onPathChange}
              transferTarget={transferTarget}
              transferViewScope={transferViewScope}
            />
          </div>
        )}
      </div>
    </div>
  );
}
function HostPane({
  active,
  activeTab,
  activeTabId,
  clipboard,
  hostTabs,
  interfaceDensity,
  machines,
  machinesById,
  onActiveTabChange,
  onAddHost,
  onCreateSshHost,
  onClipboardChange,
  onCloseTab,
  onPathChange,
  revealRequest,
  side,
  title,
  transferTarget,
  transferViewScope,
}: {
  active: boolean;
  activeTab: SftpTransferHostTab | undefined;
  activeTabId: string;
  clipboard: SftpWorkbenchClipboard | null;
  hostTabs: SftpTransferHostTab[];
  interfaceDensity: InterfaceDensity;
  machines: Machine[];
  machinesById: Map<string, Machine>;
  onActiveTabChange: (tabId: string) => void;
  onAddHost: (hostId: string) => void;
  onCreateSshHost?: (request: SftpTransferCreateHostRequest) => void;
  onClipboardChange: (clipboard: SftpClipboard | null) => void;
  onCloseTab: (tabId: string) => void;
  onPathChange: (tabId: string, path: string) => void;
  revealRequest?: import("../workspace/contracts/index").WorkspaceFileRevealRequest;
  side: SftpTransferHostSide;
  title: string;
  transferTarget?: SftpTransferTarget;
  transferViewScope: string;
}) {
  const availableMachines = machines;
  const compactDensity = interfaceDensity === "compact";
  const spaciousDensity = interfaceDensity === "spacious";
  const targetBarPaddingClass = compactDensity
    ? "px-2.5 py-1.5"
    : spaciousDensity
      ? "px-3 py-2"
      : "px-3 py-2";

  return (
    <div className="kerminal-muted-surface flex min-h-0 flex-col overflow-hidden rounded-[var(--radius-card)] border">
      <div
        aria-label={title}
        className={cn(
          "flex shrink-0 items-center gap-2 border-b border-[var(--border-subtle)]",
          targetBarPaddingClass,
        )}
      >
        <div className="scrollbar-none flex min-w-0 flex-1 gap-1 overflow-x-auto">
          {hostTabs.map((tab) => (
            <HostTabButton
              active={tab.id === activeTabId}
              interfaceDensity={interfaceDensity}
              key={tab.id}
              machine={machinesById.get(tab.hostId)}
              onActivate={() => onActiveTabChange(tab.id)}
              onClose={() => onCloseTab(tab.id)}
              tab={tab}
            />
          ))}
        </div>
        <SearchableSftpHostSelect
          ariaLabel={`添加${title}`}
          createDescription={`创建后加入${side === "right" ? "右侧" : "左侧"}`}
          disabled={!onCreateSshHost && availableMachines.length === 0}
          interfaceDensity={interfaceDensity}
          machines={availableMachines}
          onAddHost={onAddHost}
          onCreateSshHost={onCreateSshHost}
          side={side}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        <RemoteHostPaneBody
          active={active}
          activeTab={activeTab}
          availableMachineCount={availableMachines.length}
          clipboard={clipboard}
          emptyLabel={side === "right" ? "选择右侧服务器。" : "未选择主机。"}
          interfaceDensity={interfaceDensity}
          machinesById={machinesById}
          onClipboardChange={onClipboardChange}
          onPathChange={onPathChange}
          revealRequest={revealRequest}
          transferTarget={transferTarget}
          transferViewScope={transferViewScope}
        />
      </div>
    </div>
  );
}
