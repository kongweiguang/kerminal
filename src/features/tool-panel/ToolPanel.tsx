/**
 * @author kongweiguang
 */

import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import {
  Bot,
  Cpu,
  FileText,
  FolderOpen,
  History,
  Network,
  PanelsTopLeft,
  ScanSearch,
} from "lucide-react";
import { RenderErrorBoundary } from "../../components/RenderErrorBoundary";
import { Button } from "../../components/ui/button";
import { cn } from "../../lib/cn";
import {
  defaultTerminalAppearance,
  type AppSettings,
  type ResolvedTheme,
  type TerminalAppearance,
} from "../settings/contracts/index";
import type { SettingsSectionId } from "../settings/view/index";
import type {
  Machine,
  TerminalPane,
  TerminalTab,
  ToolId,
  ToolSummary,
  WorkspaceFileDirtyState,
  WorkspaceFileRevealRequest,
} from "../workspace/contracts/index";
import { isWorkspaceFileTab } from "../workspace/contracts/index";
import type {
  AddTerminalTabOptions,
  OpenWorkspaceFileTabOptions,
  TmuxAttachPlacement,
} from "../workspace/state/index";
import type { WorkspaceContextProjection } from "../workspace/context";
import type { TerminalArtifactActionRequest } from "../terminal/artifacts/public/index";
import type { TmuxAttachLaunch } from "../../lib/tmuxApi";
import { sftpSidebarTransferViewScope } from "../sftp/tool/scope/index";
import {
  claimAgentSendRequestAutoOpen,
  useAgentSendRequestSnapshot,
} from "../agent-workflow/state/index";
import { resolveToolPanelBinding } from "./toolPanelContextModel";

interface ToolPanelProps {
  activeTool: ToolId | null;
  activeMachine?: Machine;
  activeTab?: TerminalTab;
  defaultRemoteGroupId?: string;
  defaultRemoteHostId?: string;
  focusedPane?: TerminalPane;
  selectedMachine?: Machine;
  terminalPanes?: TerminalPane[];
  terminalTabs?: TerminalTab[];
  workspaceFileDirtyState?: WorkspaceFileDirtyState;
  tools: ToolSummary[];
  settings?: AppSettings;
  snippetConfigRevision?: number;
  sftpRevealRequest?: WorkspaceFileRevealRequest | null;
  resolvedTheme?: ResolvedTheme;
  terminalAppearance?: TerminalAppearance;
  workflowConfigRevision?: number;
  workspaceContext?: WorkspaceContextProjection;
  onArtifactActionRequest?: (request: TerminalArtifactActionRequest) => void;
  onActiveToolChange: (toolId: ToolId) => void;
  onCreateTerminal?: (options?: AddTerminalTabOptions) => void;
  onFocusTab?: (tabId: string) => void;
  onClosePane?: (paneId: string) => void;
  onOpenSettingsSection?: (sectionId: SettingsSectionId) => void;
  onOpenSshTerminal?: (hostId: string) => void;
  onOpenWorkspaceFileTab?: (options: OpenWorkspaceFileTabOptions) => void;
  onOpenTmuxTerminal?: (
    launch: TmuxAttachLaunch,
    placement?: TmuxAttachPlacement,
  ) => void;
  onRemoteHostCreated?: () => void | Promise<void>;
  onSettingsChange?: (settings: AppSettings) => void;
  onSplitPane?: (direction: "horizontal" | "vertical") => void;
}

const toolIcons: Partial<Record<ToolId, typeof Bot>> = {
  agentLauncher: Bot,
  context: ScanSearch,
  system: Cpu,
  sftp: FolderOpen,
  ports: Network,
  tmux: PanelsTopLeft,
  snippets: FileText,
  logs: History,
};

const SftpToolContent = lazy(async () => ({
  default: (await import("../sftp/tool/view/index")).SftpToolContent,
}));
const ServerInfoToolContent = lazy(async () => ({
  default: (await import("./ServerInfoToolContent")).ServerInfoToolContent,
}));
const PortForwardToolContent = lazy(async () => ({
  default: (await import("./PortForwardToolContent")).PortForwardToolContent,
}));
const SnippetToolContent = lazy(async () => ({
  default: (await import("../snippets/view/index")).SnippetToolContent,
}));
const LogToolContent = lazy(async () => ({
  default: (await import("../logs")).LogToolContent,
}));
const AgentLauncherToolContent = lazy(async () => ({
  default: (await import("./AgentLauncherToolContent"))
    .AgentLauncherToolContent,
}));
const TmuxToolContent = lazy(async () => ({
  default: (await import("./TmuxToolContent")).TmuxToolContent,
}));
const ContextInspectorToolContent = lazy(async () => ({
  default: (await import("./context-inspector")).ContextInspectorToolContent,
}));
const ContextInspectorTerminalArtifacts = lazy(async () => ({
  default: (await import("./context-inspector"))
    .ContextInspectorTerminalArtifacts,
}));

export function ToolPanel({
  activeTool,
  activeMachine,
  activeTab,
  focusedPane,
  selectedMachine,
  onClosePane,
  onActiveToolChange,
  onArtifactActionRequest,
  onFocusTab,
  onOpenWorkspaceFileTab,
  onOpenTmuxTerminal,
  resolvedTheme = "dark",
  settings,
  snippetConfigRevision,
  sftpRevealRequest,
  terminalPanes,
  terminalTabs,
  terminalAppearance,
  workspaceFileDirtyState,
  workspaceContext,
  tools,
}: ToolPanelProps) {
  const railTools = tools;
  const defaultContentToolId =
    tools.find((tool) => tool.id === "agentLauncher")?.id ??
    tools.find((tool) => tool.id !== "settings")?.id ??
    null;
  const contentTool =
    activeTool === null
      ? null
      : activeTool === "settings"
        ? defaultContentToolId
        : activeTool;
  const [mountedToolIds, setMountedToolIds] = useState<ToolId[]>(() =>
    contentTool ? [contentTool] : [],
  );
  const renderedToolIds = useMemo(() => {
    const availableToolIds = new Set(tools.map((tool) => tool.id));
    const nextToolIds = mountedToolIds.filter((toolId) =>
      availableToolIds.has(toolId),
    );
    if (contentTool && !nextToolIds.includes(contentTool)) {
      return [...nextToolIds, contentTool];
    }
    return nextToolIds;
  }, [contentTool, mountedToolIds, tools]);
  const renderedTools = useMemo(
    () =>
      renderedToolIds
        .map((toolId) => tools.find((tool) => tool.id === toolId))
        .filter((tool): tool is ToolSummary => Boolean(tool)),
    [renderedToolIds, tools],
  );
  const agentSendRequest = useAgentSendRequestSnapshot().request;
  const active = contentTool
    ? (tools.find((tool) => tool.id === contentTool) ?? railTools[0])
    : undefined;
  const drawerOpen = Boolean(contentTool && active);
  const interfaceDensity = settings?.interfaceDensity ?? "comfortable";
  const compactDensity = interfaceDensity === "compact";
  const spaciousDensity = interfaceDensity === "spacious";
  const drawerPaddingClass = compactDensity
    ? "scrollbar-none overflow-y-auto p-3"
    : spaciousDensity
      ? "scrollbar-none overflow-y-auto p-5"
      : "scrollbar-none overflow-y-auto p-4";
  const railClassName = compactDensity
    ? "flex w-11 shrink-0 flex-col items-center gap-1.5 py-2.5"
    : spaciousDensity
      ? "flex w-14 shrink-0 flex-col items-center gap-2 py-4"
      : "flex w-12 shrink-0 flex-col items-center gap-1.5 py-3";
  const railButtonDensityClassName = compactDensity
    ? "h-7 w-7 rounded-lg"
    : spaciousDensity
      ? "h-9 w-9 rounded-lg"
      : "h-8 w-8 rounded-lg";

  useEffect(() => {
    if (!contentTool) {
      return;
    }
    setMountedToolIds((current) =>
      current.includes(contentTool) ? current : [...current, contentTool],
    );
  }, [contentTool]);

  useEffect(() => {
    if (
      !agentSendRequest ||
      !claimAgentSendRequestAutoOpen(agentSendRequest.id)
    ) {
      return;
    }
    if (
      activeTool !== "agentLauncher" &&
      tools.some((tool) => tool.id === "agentLauncher")
    ) {
      onActiveToolChange("agentLauncher");
    }
  }, [activeTool, agentSendRequest, onActiveToolChange, tools]);

  return (
    <aside
      aria-label="工具面板"
      aria-expanded={drawerOpen}
      className="kerminal-material-nav flex h-full w-full min-w-0 border-l"
    >
      <div
        aria-hidden={!drawerOpen}
        className="relative min-w-0 flex-1 overflow-hidden"
        hidden={!drawerOpen}
      >
          {renderedTools.map((tool) => {
            const toolId = tool.id;
            const selected = toolId === contentTool;
            const binding = resolveToolPanelBinding(toolId, {
              activeMachine,
              activeTab,
              focusedPane,
              selectedMachine,
              workspaceRevision: workspaceContext?.revision,
            });
            const fullHeightTool =
              toolId === "agentLauncher" || toolId === "sftp";
            const contentOwnsHeader =
              toolId === "system" || toolId === "ports" || toolId === "tmux";
            return (
              <div
                aria-hidden={!selected}
                className={cn(
                  "absolute inset-0 min-w-0",
                  fullHeightTool
                    ? "flex flex-col overflow-hidden"
                    : drawerPaddingClass,
                )}
                hidden={!selected}
                key={toolId}
              >
                {fullHeightTool || contentOwnsHeader ? null : (
                  <header className="mb-3">
                    <h2 className="min-w-0 text-lg font-semibold text-zinc-950 dark:text-zinc-50">
                      {tool.title}
                    </h2>
                  </header>
                )}

                <RenderErrorBoundary
                  fallback={() => (
                    <ToolContentCrashFallback title={tool.title} />
                  )}
                >
                  <Suspense
                    fallback={<ToolContentLoadingFallback title={tool.title} />}
                  >
                    {toolId === "agentLauncher" ? (
                      <AgentLauncherToolContent
                        activeTab={binding.activeTab}
                        desktopNotifications={settings?.desktopNotifications}
                        focusedPane={binding.focusedPane}
                        resolvedTheme={resolvedTheme}
                        terminalAppearance={
                          terminalAppearance ??
                          settings?.terminal ??
                          defaultTerminalAppearance
                        }
                        terminalPanes={terminalPanes}
                        terminalTabs={terminalTabs}
                      />
                    ) : null}
                    {toolId === "system" ? (
                      <ServerInfoToolContent
                        active={selected}
                        selectedMachine={binding.machine}
                      />
                    ) : null}
                    {toolId === "context" && workspaceContext ? (
                      <ContextInspectorToolContent
                        active={selected}
                        context={workspaceContext}
                        isNavigationAvailable={(navigationId) =>
                          Boolean(onFocusTab && navigationId.startsWith("tab:"))
                        }
                        onNavigate={(navigationId) => {
                          if (navigationId.startsWith("tab:")) {
                            onFocusTab?.(navigationId.slice(4));
                          }
                        }}
                      />
                    ) : null}
                    {toolId === "context" && workspaceContext?.focusedPaneId ? (
                      <ContextInspectorTerminalArtifacts
                        onActionRequest={onArtifactActionRequest}
                        paneId={workspaceContext.focusedPaneId}
                      />
                    ) : null}
                    {toolId === "sftp" ? (
                      <SftpToolContent
                        active={selected}
                        followedLocalPath={
                          binding.focusedPane?.mode === "local" &&
                          binding.focusedPane.machineId === binding.machine?.id
                            ? (binding.focusedPane.currentCwd ??
                              binding.focusedPane.cwd)
                            : undefined
                        }
                        followedRemotePath={
                          binding.focusedPane?.mode === "ssh" &&
                          binding.focusedPane.remoteHostId === binding.machine?.id
                            ? (binding.focusedPane.currentCwd ??
                              binding.focusedPane.cwd)
                            : binding.focusedPane?.mode === "container" &&
                                binding.focusedPane.machineId ===
                                  binding.machine?.id
                              ? binding.focusedPane.currentCwd
                              : undefined
                        }
                        interfaceDensity={interfaceDensity}
                        onOpenWorkspaceFileTab={onOpenWorkspaceFileTab}
                        selectedMachine={binding.machine}
                        sftpRevealRequest={sftpRevealRequest}
                        transferViewScope={sftpSidebarTransferViewScope({
                          hostId: binding.machine?.id,
                          tabId: binding.activeTab?.id,
                        })}
                        workspaceFileDirtyState={workspaceFileDirtyState}
                        workspaceFileTabs={terminalTabs?.filter(
                          isWorkspaceFileTab,
                        )}
                      />
                    ) : null}
                    {toolId === "ports" ? (
                      <PortForwardToolContent
                        active={selected}
                        focusedPane={binding.focusedPane}
                        selectedMachine={binding.machine}
                      />
                    ) : null}
                    {toolId === "tmux" ? (
                      <TmuxToolContent
                        active={selected}
                        activeMachine={
                          binding.source === "selectedMachine"
                            ? undefined
                            : binding.machine
                        }
                        activeTab={binding.activeTab}
                        focusedPane={binding.focusedPane}
                        onClosePane={onClosePane}
                        onFocusTab={onFocusTab}
                        onOpenTmuxTerminal={onOpenTmuxTerminal}
                        selectedMachine={
                          binding.source === "selectedMachine"
                            ? binding.machine
                            : undefined
                        }
                        terminalPanes={terminalPanes}
                        terminalTabs={terminalTabs}
                      />
                    ) : null}
                    {toolId === "snippets" ? (
                      <SnippetToolContent
                        activeTabId={binding.activeTab?.id}
                        configRevision={snippetConfigRevision}
                        focusedPane={binding.focusedPane}
                      />
                    ) : null}
                    {toolId === "logs" ? (
                      <LogToolContent
                        active={selected}
                        focusedPane={binding.focusedPane}
                      />
                    ) : null}
                  </Suspense>
                </RenderErrorBoundary>
              </div>
            );
          })}
      </div>
      <nav
        aria-label="工具栏"
        className={cn(
          railClassName,
          drawerOpen && "border-l border-[var(--border-subtle)]",
        )}
      >
        {railTools.map((tool) => {
          const Icon = toolIcons[tool.id];
          const selected = tool.id === activeTool;
          if (!Icon) {
            return null;
          }

          return (
            <Button
              aria-label={`${selected ? "收起" : "打开"} ${tool.title}`}
              aria-pressed={selected}
              className={cn(
                railButtonDensityClassName,
                tool.id === "logs" && "mt-auto",
                selected &&
                  "bg-[var(--surface-selected)] text-sky-700 shadow-sm shadow-sky-500/10 dark:text-sky-100",
              )}
              key={tool.id}
              onClick={() => onActiveToolChange(tool.id)}
              size="icon"
              title={tool.title}
              variant="ghost"
            >
              <Icon className="h-4 w-4" />
            </Button>
          );
        })}
      </nav>
    </aside>
  );
}

function ToolContentLoadingFallback({ title }: { title?: string }) {
  return (
    <div
      aria-live="polite"
      className="kerminal-solid-surface rounded-lg border px-4 py-3 text-sm text-zinc-600 dark:text-zinc-300"
    >
      <div className="font-medium text-zinc-800 dark:text-zinc-100">
        正在加载{title ?? "工具"}
      </div>
      <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        请稍候...
      </div>
    </div>
  );
}

function ToolContentCrashFallback({ title }: { title?: string }) {
  return (
    <div className="rounded-lg border border-rose-300/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-100">
      <div className="font-medium">{title ?? "工具"}加载失败</div>
      <div className="mt-1 text-xs opacity-80">
        收起右栏后重新打开可重试，详细信息已写入应用日志。
      </div>
    </div>
  );
}
