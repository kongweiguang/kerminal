/**
 * @author kongweiguang
 */

import { Plus, Search } from "lucide-react";
import {
  useCallback,
  useId,
  useMemo,
  useState,
  type FocusEvent,
} from "react";
import { cn } from "../../lib/cn";
import type { InterfaceDensity } from "../settings/contracts/index";
import type { Machine } from "../workspace/contracts/index";
import type { OpenWorkspaceFileTabOptions } from "../workspace/state/index";
import { SftpToolContent, type SftpClipboard } from "./SftpToolContent";
import type { SftpTransferCreateHostRequest } from "./SftpTransferWorkbench";
import type { SftpTransferTarget } from "./sftp-tool-content/types";
import {
  remoteClipboardFromWorkbenchClipboard,
  type SftpWorkbenchClipboard,
} from "./sftpTransferClipboardModel";
import type {
  SftpTransferHostSide,
  SftpTransferHostTab,
} from "./sftpTransferWorkbenchModel";

export function SearchableSftpHostSelect({
  ariaLabel,
  createDescription,
  disabled,
  interfaceDensity,
  machines,
  onAddHost,
  onCreateSshHost,
  side,
}: {
  ariaLabel: string;
  createDescription: string;
  disabled: boolean;
  interfaceDensity: InterfaceDensity;
  machines: Machine[];
  onAddHost: (hostId: string) => void;
  onCreateSshHost?: (request: SftpTransferCreateHostRequest) => void;
  side: SftpTransferHostSide;
}) {
  const listboxId = useId();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const compactDensity = interfaceDensity === "compact";
  const spaciousDensity = interfaceDensity === "spacious";
  const normalizedSearch = search.trim().toLowerCase();
  const filteredMachines = useMemo(
    () =>
      normalizedSearch
        ? machines.filter((machine) =>
            hostSearchText(machine).includes(normalizedSearch),
          )
        : machines,
    [machines, normalizedSearch],
  );
  const inputClass = compactDensity
    ? "h-7 rounded-[var(--radius-control)] pl-7 pr-3 text-xs"
    : spaciousDensity
      ? "h-9 rounded-[var(--radius-control)] pl-8 pr-3 text-xs"
      : "h-8 rounded-[var(--radius-control)] pl-7 pr-3 text-xs";

  const closeDropdown = () => {
    setOpen(false);
    setSearch("");
  };
  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) {
      return;
    }
    closeDropdown();
  };
  const selectHost = (hostId: string) => {
    onAddHost(hostId);
    closeDropdown();
  };
  const createSshHost = () => {
    onCreateSshHost?.({ side });
    closeDropdown();
  };

  return (
    <div
      className="relative w-[168px] max-w-[42vw] shrink-0"
      onBlur={handleBlur}
    >
      <label className="relative block min-w-0">
        <span className="sr-only">{ariaLabel}</span>
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500"
          strokeWidth={1.8}
        />
        <input
          aria-controls={open ? listboxId : undefined}
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-label={ariaLabel}
          className={cn(
            "kerminal-field-surface kerminal-focus-ring w-full border text-zinc-700 outline-none placeholder:text-zinc-400 disabled:cursor-not-allowed disabled:opacity-50 dark:text-zinc-200 dark:placeholder:text-zinc-600",
            inputClass,
          )}
          disabled={disabled}
          onChange={(event) => {
            setOpen(true);
            setSearch(event.currentTarget.value);
          }}
          onClick={() => {
            setOpen(true);
            setSearch("");
          }}
          onFocus={() => {
            setOpen(true);
            setSearch("");
          }}
          placeholder="搜索主机..."
          role="combobox"
          value={search}
        />
      </label>
      {open ? (
        <div
          className="kerminal-floating-surface kerminal-floating-enter kerminal-layer-popover absolute right-0 top-[calc(100%+0.375rem)] w-56 overflow-hidden rounded-[var(--radius-card)] border p-1 text-sm text-zinc-950 dark:text-zinc-100"
          id={listboxId}
          role="listbox"
        >
          <div className="scrollbar-none grid max-h-64 gap-1 overflow-y-auto">
            {filteredMachines.length > 0 ? (
              filteredMachines.map((machine) => (
                <button
                  aria-selected={false}
                  className="kerminal-focus-ring kerminal-pressable grid min-w-0 gap-0.5 rounded-[var(--radius-control)] px-2.5 py-2 text-left text-zinc-700 transition hover:bg-[var(--surface-hover)] hover:text-zinc-950 dark:text-zinc-300 dark:hover:text-zinc-50"
                  key={machine.id}
                  onClick={() => selectHost(machine.id)}
                  role="option"
                  type="button"
                >
                  <span className="truncate text-sm font-medium">
                    {machine.name}
                  </span>
                  <span
                    aria-hidden="true"
                    className="truncate font-mono text-[11px] text-zinc-500 dark:text-zinc-400"
                  >
                    {hostIdentity(machine)}
                  </span>
                </button>
              ))
            ) : (
              <div className="rounded-lg border border-dashed border-[var(--border-subtle)] px-3 py-4 text-center text-xs text-zinc-500 dark:text-zinc-400">
                没有匹配的主机。
              </div>
            )}
          </div>
          {onCreateSshHost ? (
            <button
              aria-selected={false}
              className="kerminal-focus-ring kerminal-pressable mt-1 flex w-full items-start gap-2 rounded-[var(--radius-control)] border-t border-[var(--border-subtle)] px-2.5 py-2 text-left text-zinc-700 transition hover:bg-[var(--surface-hover)] hover:text-zinc-950 dark:text-zinc-300 dark:hover:text-zinc-50"
              onClick={createSshHost}
              role="option"
              type="button"
            >
              <Plus
                aria-hidden="true"
                className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-500"
              />
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">
                  新建 SSH 主机...
                </span>
                <span
                  aria-hidden="true"
                  className="mt-0.5 block text-xs leading-4 text-zinc-500 dark:text-zinc-400"
                >
                  {createDescription}
                </span>
              </span>
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function RemoteHostPaneBody({
  active,
  activeTab,
  availableMachineCount,
  clipboard,
  emptyLabel,
  interfaceDensity,
  machinesById,
  onClipboardChange,
  onOpenWorkspaceFileTab,
  onPathChange,
  revealRequest,
  transferTarget,
  transferViewScope,
}: {
  active: boolean;
  activeTab: SftpTransferHostTab | undefined;
  availableMachineCount: number;
  clipboard: SftpWorkbenchClipboard | null;
  emptyLabel: string;
  interfaceDensity: InterfaceDensity;
  machinesById: Map<string, Machine>;
  onClipboardChange: (clipboard: SftpClipboard | null) => void;
  onOpenWorkspaceFileTab?: (options: OpenWorkspaceFileTabOptions) => void;
  onPathChange: (tabId: string, path: string) => void;
  revealRequest?: import("../workspace/contracts/index").WorkspaceFileRevealRequest;
  transferTarget?: SftpTransferTarget;
  transferViewScope: string;
}) {
  const selectedMachine = activeTab
    ? machinesById.get(activeTab.hostId)
    : undefined;
  const reportCurrentPath = useCallback(
    (path: string) => {
      if (activeTab) onPathChange(activeTab.id, path);
    },
    [activeTab, onPathChange],
  );

  if (!selectedMachine) {
    return (
      <div className="flex h-full items-center justify-center p-5 text-center text-sm text-zinc-500 dark:text-zinc-400">
        {availableMachineCount === 0
          ? "没有可用于 SFTP 的 SSH 服务器。"
          : emptyLabel}
      </div>
    );
  }

  return (
    <SftpToolContent
      active={active}
      compactHeader
      interfaceDensity={interfaceDensity}
      onCurrentPathChange={reportCurrentPath}
      onOpenWorkspaceFileTab={onOpenWorkspaceFileTab}
      onSftpClipboardChange={onClipboardChange}
      sftpRevealRequest={revealRequest}
      selectedMachine={selectedMachine}
      showLocalTransferActions={!transferTarget}
      showTerminalDirectoryControls={false}
      showTransferStatusBar={false}
      sftpClipboard={remoteClipboardFromWorkbenchClipboard(clipboard)}
      transferTarget={transferTarget}
      transferViewScope={transferViewScope}
      workbenchClipboard={clipboard}
    />
  );
}

function hostIdentity(machine: Machine) {
  if (machine.kind !== "ssh" && machine.kind !== "sftp") {
    return machine.description;
  }
  const username = machine.username ?? "ssh";
  const host = machine.host ?? machine.name;
  return `${username}@${host}:${machine.port ?? 22}`;
}

function hostSearchText(machine: Machine) {
  return [
    machine.name,
    machine.description,
    machine.kind === "ssh" || machine.kind === "sftp" ? machine.host : "",
    machine.kind === "ssh" || machine.kind === "sftp" ? machine.username : "",
    hostIdentity(machine),
    ...machine.tags,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}
