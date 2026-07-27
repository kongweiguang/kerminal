// @author kongweiguang

import { useEffect, useMemo, useState } from "react";
import { CommandPalette } from "../features/command-palette";
import {
  QuickOpenCoordinator,
  type QuickOpenReference,
  type QuickOpenSearchState,
} from "../features/quick-open";
import {
  keybindingMatchesEvent,
  keyboardEventMatchesBinding,
  shortcutPlatform,
} from "../features/settings/keybindingUtils";
import type { AppSettings } from "../features/settings/settingsModel";
import {
  WorkspaceActionRegistry,
  type WorkspaceActionContext,
  type WorkspaceActionDescriptor,
  type WorkspaceActionExecutor,
} from "../features/workspace-actions";
import {
  WorkspacePaletteShell,
  type WorkspacePaletteItem,
  type WorkspacePaletteStatus,
} from "../features/workspace-overlay";
import {
  buildWorkspaceContextProjection,
  type WorkspaceContextProjection,
} from "../features/workspace/context";
import {
  isTerminalSessionTab,
  type MachineGroup,
  type TerminalLayoutNode,
  type TerminalPane,
  type TerminalSplitDirection,
  type TerminalTab,
  type ToolId,
} from "../features/workspace/types";
import { useWorkspaceStore } from "../features/workspace/workspaceStore";
import { shouldAppHandleKeybinding } from "../contracts/textEditCommands";
import {
  createKerminalQuickOpenRegistry,
  resolveKerminalQuickOpenReference,
} from "./KerminalShell.quickOpenSources";

export { createKerminalQuickOpenRegistry } from "./KerminalShell.quickOpenSources";

type ContextWorkspaceActionId =
  | "tool.context"
  | "tool.system"
  | "tool.sftp"
  | "tool.ports"
  | "tool.tmux"
  | "tool.snippets"
  | "tool.logs"
  | "settings.open"
  | "terminal.splitHorizontal"
  | "terminal.splitVertical"
  | "agent.sendPreview";

type ContextWorkspaceActionCatalog = Record<
  ContextWorkspaceActionId,
  undefined
>;

const EMPTY_QUICK_OPEN_STATE: QuickOpenSearchState = {
  failures: [],
  query: "",
  requestId: 0,
  results: [],
  status: "idle",
};

export const KERMINAL_QUICK_OPEN_COPY = {
  description:
    "搜索主机、终端、当前可见路径、命令历史、片段、工作流和 Agent 会话",
  emptyMessage: "没有匹配的工作区对象、命令或会话",
  loadingMessage: "正在查询工作区与配置事实源",
  placeholder: "搜索主机、终端、历史、片段、工作流或 Agent",
} as const;

interface KerminalShellContextWorkspaceProps {
  readonly activeTabId: string | null;
  readonly focusedPaneId: string | null;
  readonly keybindings: AppSettings["keybindings"];
  readonly machineGroups: readonly MachineGroup[];
  readonly onFocusPane: (paneId: string) => void;
  readonly onOpenSettings: () => void;
  readonly onOpenTool: (toolId: ToolId) => void;
  readonly onSelectMachine: (machineId: string) => void;
  readonly onSelectTab: (tabId: string) => void;
  readonly onSplitPane: (direction: TerminalSplitDirection) => void;
  readonly selectedMachineId: string;
  readonly terminalPanes: readonly TerminalPane[];
  readonly terminalTabs: readonly TerminalTab[];
}

function layoutContainsPane(
  layout: TerminalLayoutNode,
  paneId: string,
): boolean {
  return layout.type === "pane"
    ? layout.paneId === paneId
    : layout.children.some((child) => layoutContainsPane(child, paneId));
}

function workspaceRevision(props: KerminalShellContextWorkspaceProps): number {
  const value = [
    props.activeTabId ?? "",
    props.focusedPaneId ?? "",
    props.selectedMachineId,
    props.machineGroups
      .map((group) => `${group.id}:${group.machines.length}`)
      .join("|"),
    props.terminalTabs.map((tab) => tab.id).join("|"),
    props.terminalPanes.map((pane) => `${pane.id}:${pane.status}`).join("|"),
  ].join(";");
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

/** 创建只委托现有 Shell command 的最小动作注册表。 */
export function createKerminalWorkspaceActionRegistry(): WorkspaceActionRegistry<ContextWorkspaceActionCatalog> {
  const registry = new WorkspaceActionRegistry<ContextWorkspaceActionCatalog>();
  const actions: Array<{
    id: ContextWorkspaceActionId;
    title: string;
    availability?: (
      context: WorkspaceActionContext,
    ) =>
      { available: true } | { available: false; code: string; reason: string };
  }> = [
    { id: "tool.context", title: "打开当前上下文" },
    { id: "tool.system", title: "打开系统信息与诊断" },
    { id: "tool.sftp", title: "打开 SFTP" },
    { id: "tool.ports", title: "打开端口转发" },
    { id: "tool.tmux", title: "打开 tmux" },
    { id: "tool.snippets", title: "打开脚本片段" },
    { id: "tool.logs", title: "打开命令历史" },
    { id: "settings.open", title: "打开设置" },
    {
      id: "terminal.splitHorizontal",
      title: "左右分屏",
      availability: (context) =>
        context.capabilities?.has("terminal.split")
          ? { available: true }
          : {
              available: false,
              code: "no-focused-pane",
              reason: "当前没有可分屏终端",
            },
    },
    {
      id: "terminal.splitVertical",
      title: "上下分屏",
      availability: (context) =>
        context.capabilities?.has("terminal.split")
          ? { available: true }
          : {
              available: false,
              code: "no-focused-pane",
              reason: "当前没有可分屏终端",
            },
    },
    { id: "agent.sendPreview", title: "发送到 Agent" },
  ];
  actions.forEach((action) =>
    registry.register({
      ...action,
      effect: "local",
      availability: action.availability
        ? (context) => action.availability?.(context) ?? { available: true }
        : undefined,
    }),
  );
  return registry;
}

function isProtectedAction(
  descriptor: Pick<WorkspaceActionDescriptor, "effect">,
): boolean {
  return (
    descriptor.effect === "write" ||
    descriptor.effect === "remote" ||
    descriptor.effect === "destructive"
  );
}

/** 没有确认控制器时，受保护动作必须在展示阶段禁用。 */
export function disableProtectedActionsWithoutConfirmation<
  TActionCatalog extends Record<string, unknown>,
>(
  registry: WorkspaceActionRegistry<TActionCatalog>,
  confirmationAvailable: boolean,
): WorkspaceActionRegistry<TActionCatalog> {
  if (confirmationAvailable) {
    return registry;
  }

  const safeRegistry = new WorkspaceActionRegistry<TActionCatalog>();
  registry.list().forEach((descriptor) => {
    safeRegistry.register({
      ...descriptor,
      availability: (context, payload) => {
        if (isProtectedAction(descriptor)) {
          return {
            available: false,
            code: "confirmation-unavailable",
            reason: "当前入口尚未接入安全确认流程",
          };
        }
        return (
          descriptor.availability?.(context, payload) ?? { available: true }
        );
      },
    });
  });
  return safeRegistry;
}

export function overlayBindingMatches(
  event: KeyboardEvent,
  keybindings: AppSettings["keybindings"],
  action: "workspace.quickOpen" | "workspace.commandPalette",
  fallback: string,
): boolean {
  const configured = keybindings.find(
    (keybinding) => keybinding.action === action,
  );
  if (configured) {
    return keybindingMatchesEvent(configured, event, shortcutPlatform());
  }
  if (
    keybindings.some((keybinding) =>
      keybindingMatchesEvent(keybinding, event, shortcutPlatform()),
    )
  ) {
    return false;
  }
  return keyboardEventMatchesBinding(event, fallback);
}

/** 只有活动终端投影中的存活 pane 才允许执行分屏。 */
export function canSplitWorkspaceProjection(
  projection: WorkspaceContextProjection,
  terminalTabs: readonly TerminalTab[],
  terminalPanes: readonly TerminalPane[],
): boolean {
  if (projection.subject.kind !== "terminalPane" || !projection.subject.id) {
    return false;
  }
  const activeTab = terminalTabs.find(
    (tab) => tab.id === projection.activeTabId,
  );
  return Boolean(
    activeTab &&
    isTerminalSessionTab(activeTab) &&
    layoutContainsPane(activeTab.layout, projection.subject.id) &&
    terminalPanes.some((pane) => pane.id === projection.subject.id),
  );
}

function KerminalQuickOpenPalette({
  context,
  coordinator,
  onClose,
  onSelect,
  open,
}: {
  readonly context: WorkspaceContextProjection;
  readonly coordinator: QuickOpenCoordinator;
  readonly onClose: () => void;
  readonly onSelect: (reference: QuickOpenReference) => void;
  readonly open: boolean;
}) {
  const [query, setQuery] = useState("");
  const [searchState, setSearchState] = useState(EMPTY_QUICK_OPEN_STATE);

  useEffect(() => {
    if (!open) {
      coordinator.cancel();
      return;
    }
    const controller = new AbortController();
    void coordinator.search(query, {
      context,
      signal: controller.signal,
      onUpdate: setSearchState,
    });
    return () => controller.abort();
  }, [context, coordinator, open, query]);

  const resultByItemId = useMemo(
    () =>
      new Map(
        searchState.results.map((result) => [
          `${result.providerId}:${result.reference.kind}:${result.reference.id}`,
          result,
        ]),
      ),
    [searchState.results],
  );
  const items = useMemo<readonly WorkspacePaletteItem[]>(
    () =>
      searchState.results.map((result) => ({
        description: result.description,
        id: `${result.providerId}:${result.reference.kind}:${result.reference.id}`,
        label: result.label,
        leading: result.leading,
        trailing: result.trailing ?? result.targetLabel,
      })),
    [searchState.results],
  );
  const status: WorkspacePaletteStatus =
    searchState.status === "idle" ? "ready" : searchState.status;

  return (
    <WorkspacePaletteShell
      description={KERMINAL_QUICK_OPEN_COPY.description}
      emptyMessage={KERMINAL_QUICK_OPEN_COPY.emptyMessage}
      items={items}
      loadingMessage={KERMINAL_QUICK_OPEN_COPY.loadingMessage}
      onClose={onClose}
      onQueryChange={setQuery}
      onSelect={(item) => {
        const result = resultByItemId.get(item.id);
        if (result) {
          onSelect(result.reference);
        }
      }}
      open={open}
      placeholder={KERMINAL_QUICK_OPEN_COPY.placeholder}
      query={query}
      status={status}
      statusMessage={
        searchState.failures.length > 0
          ? `${searchState.failures.length} 个数据源暂时不可用`
          : undefined
      }
      title="快速打开"
    />
  );
}

/** KerminalShell 的 Context Workspace overlay 组合层。 */
function KerminalShellContextWorkspace(
  props: KerminalShellContextWorkspaceProps,
) {
  const [openOverlay, setOpenOverlay] = useState<
    "quick-open" | "commands" | null
  >(null);
  const revision = workspaceRevision(props);
  const projection = useMemo<WorkspaceContextProjection>(
    () =>
      buildWorkspaceContextProjection({
        activeTabId: props.activeTabId,
        focusedPaneId: props.focusedPaneId,
        generatedAt: new Date().toISOString(),
        machineGroups: props.machineGroups,
        revision,
        selectedMachineId: props.selectedMachineId,
        sources: [{ source: "workspace", status: "available", revision }],
        terminalPanes: props.terminalPanes,
        terminalTabs: props.terminalTabs,
      }),
    [
      props.activeTabId,
      props.focusedPaneId,
      props.machineGroups,
      props.selectedMachineId,
      props.terminalPanes,
      props.terminalTabs,
      revision,
    ],
  );
  const quickOpenRegistry = useMemo(
    () =>
      createKerminalQuickOpenRegistry({
        machineGroups: props.machineGroups,
        terminalPanes: props.terminalPanes,
        terminalTabs: props.terminalTabs,
      }),
    [props.machineGroups, props.terminalPanes, props.terminalTabs],
  );
  const quickOpenCoordinator = useMemo(
    () =>
      new QuickOpenCoordinator({
        getProviders: () => quickOpenRegistry.list(),
      }),
    [quickOpenRegistry],
  );
  const actionRegistry = useMemo(
    () =>
      disableProtectedActionsWithoutConfirmation(
        createKerminalWorkspaceActionRegistry(),
        false,
      ),
    [],
  );
  const canSplitPane = canSplitWorkspaceProjection(
    projection,
    props.terminalTabs,
    props.terminalPanes,
  );
  const actionContext = useMemo<WorkspaceActionContext>(
    () => ({
      revision: String(revision),
      capabilities: new Set(canSplitPane ? ["terminal.split"] : []),
    }),
    [canSplitPane, revision],
  );
  const executor = useMemo<WorkspaceActionExecutor>(
    () => ({
      async execute(descriptor) {
        if (descriptor.id === "settings.open") {
          props.onOpenSettings();
          return { kind: "completed" };
        }
        if (descriptor.id === "terminal.splitHorizontal") {
          props.onSplitPane("horizontal");
          return { kind: "completed" };
        }
        if (descriptor.id === "terminal.splitVertical") {
          props.onSplitPane("vertical");
          return { kind: "completed" };
        }
        const toolId =
          descriptor.id === "agent.sendPreview"
            ? "agentLauncher"
            : descriptor.id.startsWith("tool.")
              ? descriptor.id.slice("tool.".length)
              : undefined;
        return toolId ? { kind: "open-tool", toolId } : { kind: "completed" };
      },
    }),
    [props],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const platform = shortcutPlatform();
      const quickOpenBinding = platform === "mac" ? "Cmd+P" : "Ctrl+P";
      const commandBinding =
        platform === "mac" ? "Cmd+Shift+P" : "Ctrl+Shift+P";
      const nextOverlay = overlayBindingMatches(
        event,
        props.keybindings,
        "workspace.commandPalette",
        commandBinding,
      )
        ? "commands"
        : overlayBindingMatches(
              event,
              props.keybindings,
              "workspace.quickOpen",
              quickOpenBinding,
            )
          ? "quick-open"
          : null;
      if (!nextOverlay) {
        return;
      }
      if (
        !shouldAppHandleKeybinding(event, {
          allowTerminalTarget: true,
        })
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      setOpenOverlay(nextOverlay);
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [props.keybindings]);

  const handleQuickOpenSelect = (reference: QuickOpenReference) => {
    const controller = new AbortController();
    setOpenOverlay(null);
    void resolveKerminalQuickOpenReference(reference, props, {
      signal: controller.signal,
    });
  };

  return (
    <>
      <KerminalQuickOpenPalette
        context={projection}
        coordinator={quickOpenCoordinator}
        onClose={() => setOpenOverlay(null)}
        onSelect={handleQuickOpenSelect}
        open={openOverlay === "quick-open"}
      />
      <CommandPalette
        context={actionContext}
        executor={executor}
        getPayload={() => undefined}
        getPresentation={(descriptor) => ({
          category: descriptor.id.startsWith("terminal.")
            ? "终端"
            : descriptor.id.startsWith("agent.")
              ? "Agent"
              : descriptor.id.startsWith("settings.")
                ? "设置"
                : "工作区",
          keybinding:
            descriptor.id === "terminal.splitHorizontal"
              ? "Ctrl+Alt+Right"
              : descriptor.id === "terminal.splitVertical"
                ? "Ctrl+Alt+Down"
                : undefined,
          scope: descriptor.id.startsWith("terminal.") ? "当前终端" : "应用",
        })}
        onClose={() => setOpenOverlay(null)}
        onConfirmationRequired={() => {
          throw new Error(
            "受保护动作必须在注册表中禁用，不能进入未接线的确认回调",
          );
        }}
        onOpenTool={(toolId) => {
          if (
            toolId === "context" ||
            toolId === "system" ||
            toolId === "sftp" ||
            toolId === "ports" ||
            toolId === "tmux" ||
            toolId === "snippets" ||
            toolId === "logs" ||
            toolId === "agentLauncher"
          ) {
            props.onOpenTool(toolId);
          }
          setOpenOverlay(null);
        }}
        open={openOverlay === "commands"}
        registry={actionRegistry}
      />
    </>
  );
}

/** 从现有 Workspace Store 读取真实状态，并把 Shell 特有的设置入口注入 overlay。 */
export function KerminalShellContextWorkspaceStoreBridge({
  onOpenSettings,
}: {
  readonly onOpenSettings: () => void;
}) {
  const activeTabId = useWorkspaceStore((state) => state.activeTabId);
  const focusedPaneId = useWorkspaceStore((state) => state.focusedPaneId);
  const keybindings = useWorkspaceStore((state) => state.settings.keybindings);
  const machineGroups = useWorkspaceStore((state) => state.machineGroups);
  const focusPane = useWorkspaceStore((state) => state.focusPane);
  const selectMachine = useWorkspaceStore((state) => state.selectMachine);
  const selectTab = useWorkspaceStore((state) => state.selectTab);
  const selectedMachineId = useWorkspaceStore(
    (state) => state.selectedMachineId,
  );
  const setActiveTool = useWorkspaceStore((state) => state.setActiveTool);
  const splitFocusedPane = useWorkspaceStore((state) => state.splitFocusedPane);
  const terminalPanes = useWorkspaceStore((state) => state.terminalPanes);
  const terminalTabs = useWorkspaceStore((state) => state.terminalTabs);

  return (
    <KerminalShellContextWorkspace
      activeTabId={activeTabId}
      focusedPaneId={focusedPaneId}
      keybindings={keybindings}
      machineGroups={machineGroups}
      onFocusPane={focusPane}
      onOpenSettings={onOpenSettings}
      onOpenTool={setActiveTool}
      onSelectMachine={selectMachine}
      onSelectTab={selectTab}
      onSplitPane={splitFocusedPane}
      selectedMachineId={selectedMachineId}
      terminalPanes={terminalPanes}
      terminalTabs={terminalTabs}
    />
  );
}
