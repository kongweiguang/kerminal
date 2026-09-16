#!/usr/bin/env node
// @author kongweiguang

import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_ARTIFACT_ROOT,
  DEFAULT_CDP_PORT,
  DEFAULT_SNAPSHOT_BYTES,
  DEFAULT_TIMEOUT_MS,
  KerminalMcpClient,
  assertSafeConfigRoot,
  markerCommand,
  normalizePath,
  parseArgs,
  readContextFiles,
  snapshotText,
  waitForSnapshotMarker,
} from "./verify-agent-global-terminal-support.mjs";
import {
  activateTab,
  assertNoBlockingUiError,
  captureThemeScreenshots,
  connectToTauriPage,
  createTwoLocalTabs,
  evaluate,
  invokeTauri,
  openAgentLauncherForScreenshot,
  prepareAgentWorkspace,
  readUiTerminals,
  waitForUiCommand,
  waitForUiMarker,
} from "./verify-agent-global-terminal-webview.mjs";

export {
  assertSafeConfigRoot,
  extractToolPayload,
  markerCommand,
  parseArgs,
  parseSseEvents,
} from "./verify-agent-global-terminal-support.mjs";

/** 兼容 Rust AgentSession 的 snake_case 与顶层 IPC 旧前端的 camelCase 字段。 */
function readAgentSessionId(record) {
  return record?.session?.agentSessionId ?? record?.session?.agent_session_id;
}

/** 兼容 Agent target 的 camelCase 与 Rust session 内部 snake_case 字段。 */
function readRecordTarget(record) {
  const target = record?.session?.target;
  if (!target) {
    return undefined;
  }
  return {
    paneId: target.paneId ?? target.pane_id,
    targetTerminalSessionId:
      target.targetTerminalSessionId ?? target.target_terminal_session_id,
  };
}

/** 报告 Tab/pane 可见身份但不泄露 PTY token、shell 路径或环境字段。 */
function summarizeTab(tab) {
  return {
    paneId: tab?.paneId,
    rendered: Boolean(tab?.rendered),
    tabId: tab?.tabId,
    title: tab?.title,
  };
}

/** 等待 headless session 从真实 TerminalManager 列表消失，确认 close 释放资源。 */
async function waitForSessionGone(client, sessionId, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const sessions = await invokeTauri(client, "terminal_list_sessions");
    if (!(sessions ?? []).some((session) => session?.id === sessionId)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for terminal.close to remove ${sessionId}`);
}

/** 组装只包含可复核事实的简洁 JSON 报告。 */
function buildReport(base) {
  return {
    tool: "verify-agent-global-terminal",
    version: 1,
    ...base,
  };
}

/** 执行真实 Tauri WebView2 + MCP global terminal 回归验收。 */
export async function runVerification(options = parseArgs()) {
  const artifactDir = path.join(
    options.artifactRoot,
    `run-${new Date().toISOString().replaceAll(/[:.]/g, "-")}-${process.pid}`,
  );
  await mkdir(artifactDir, { recursive: true });

  let client;
  let report = buildReport({
    status: "failed",
    cdpPort: options.cdpPort,
    artifactDir,
    agentCliStarted: false,
  });
  let phase = "connect";
  try {
    const connected = await connectToTauriPage(options.cdpPort);
    client = connected.client;
    const app = await evaluate(
      client,
      `({ title: document.title, url: location.href, tauri: Boolean(window.__TAURI_INTERNALS__) })`,
    );
    if (!app?.tauri) {
      throw new Error("Connected page is not a Tauri WebView");
    }
    await assertNoBlockingUiError(client);

    phase = "isolated-config-check";
    const workspace = await invokeTauri(client, "get_external_agent_workspace_status");
    const configRoot = assertSafeConfigRoot(workspace?.workspaceDir);
    if (options.configRoot && normalizePath(options.configRoot) !== configRoot) {
      throw new Error(
        `Running app config root does not match --config-root: ${workspace?.workspaceDir}`,
      );
    }

    phase = "mcp-start";
    let mcpStatus = await invokeTauri(client, "mcp_http_server_status");
    if (!mcpStatus?.running) {
      try {
        await invokeTauri(client, "mcp_http_server_start", { request: null });
      } catch (error) {
        mcpStatus = await invokeTauri(client, "mcp_http_server_status");
        if (!mcpStatus?.running) {
          throw error;
        }
      }
    }
    const mcpStartedAt = Date.now();
    while (!mcpStatus?.running && Date.now() - mcpStartedAt < options.timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      mcpStatus = await invokeTauri(client, "mcp_http_server_status");
    }
    if (!mcpStatus?.running || !mcpStatus.endpoint) {
      throw new Error("Kerminal MCP server did not become ready");
    }

    phase = "headless-terminal-create-write-snapshot-reap-close";
    const rootMcp = new KerminalMcpClient(mcpStatus.endpoint);
    await rootMcp.initialize();
    const initialUiTabs = await readUiTerminals(client);
    const headlessCreated = await rootMcp.callTool("terminal.create", {
      cols: 80,
      cwd: process.env.USERPROFILE ?? "C:/Users/24052",
      rows: 24,
      target: "local",
    });
    const headlessData = headlessCreated.data ?? {};
    const headlessSession = headlessData.session;
    const headlessSessionId = headlessData.sessionId ?? headlessSession?.id;
    const headlessTabCreated =
      headlessData.tabCreated ?? headlessData.ui?.tabCreated;
    const headlessPaneCreated =
      headlessData.paneCreated ?? headlessData.ui?.paneCreated;
    const headlessOutputBuffered =
      headlessData.outputBuffered ?? headlessData.output?.buffered;
    if (
      !headlessSessionId ||
      headlessData.headless !== true ||
      headlessTabCreated !== false ||
      headlessPaneCreated !== false ||
      headlessOutputBuffered !== true
    ) {
      throw new Error(
        `terminal.create did not return an isolated headless session: ${JSON.stringify({
          headless: headlessData.headless,
          sessionId: headlessSessionId,
          tabCreated: headlessTabCreated,
          paneCreated: headlessPaneCreated,
          outputBuffered: headlessOutputBuffered,
        })}`,
      );
    }
    const afterHeadlessCreateTabs = await readUiTerminals(client);
    if (afterHeadlessCreateTabs.length !== initialUiTabs.length) {
      throw new Error(
        `Headless terminal.create changed UI Tab count: ${initialUiTabs.length} -> ${afterHeadlessCreateTabs.length}`,
      );
    }
    const headlessMarker = `KERM_AGENT_HEADLESS_VERIFY_${Date.now().toString(36).toUpperCase()}`;
    const headlessCommand = markerCommand(
      headlessSession?.shell,
      headlessMarker,
    );
    if (headlessCommand.includes(headlessMarker)) {
      throw new Error("Headless marker command contains the complete expected marker");
    }
    await rootMcp.callTool("terminal.write", {
      data: headlessCommand,
      sessionId: headlessSessionId,
    });
    const headlessSnapshot = await waitForSnapshotMarker(
      rootMcp,
      headlessSessionId,
      undefined,
      headlessMarker,
      options.timeoutMs,
    );
    const reapResult = await invokeTauri(client, "terminal_reap_orphan_sessions");
    const reapedSessionIds = reapResult?.sessionIds ?? reapResult?.session_ids ?? [];
    if (reapedSessionIds.includes(headlessSessionId)) {
      throw new Error("terminal_reap_orphan_sessions reaped a live headless session");
    }
    const afterReapSessions = await invokeTauri(client, "terminal_list_sessions");
    if (!(afterReapSessions ?? []).some((session) => session?.id === headlessSessionId)) {
      throw new Error("headless session did not survive terminal_reap_orphan_sessions");
    }
    await rootMcp.callTool("terminal.close", { sessionId: headlessSessionId });
    await waitForSessionGone(client, headlessSessionId, options.timeoutMs);
    const afterHeadlessCloseTabs = await readUiTerminals(client);
    if (afterHeadlessCloseTabs.length !== initialUiTabs.length) {
      throw new Error("Headless terminal.close changed the UI Tab count");
    }
    const headlessList = await rootMcp.callTool("terminal.list", {});
    const headlessListEntries =
      headlessList.data?.terminals ?? headlessList.data?.sessions ?? [];
    if (
      headlessListEntries.some(
        (entry) => (entry?.sessionId ?? entry?.id) === headlessSessionId,
      )
    ) {
      throw new Error("terminal.close left the headless session in MCP terminal.list");
    }

    phase = "create-two-local-tabs";
    const tabs = await createTwoLocalTabs(client, options.timeoutMs);
    const entryA = tabs.created[0].session;
    const entryB = tabs.created[1].session;
    if (!entryA?.id || !entryB?.id) {
      throw new Error("The two new local panes did not resolve to live terminal sessions");
    }
    const targetA = {
      paneId: tabs.created[0].paneId,
      tabId: tabs.created[0].tabId,
      targetTerminalSessionId: entryA.id,
      targetRef: entryA.targetRef ?? "local",
      targetKind: entryA.targetKind ?? "local",
      ...(entryA.cwd ? { cwd: entryA.cwd } : {}),
      ...(entryA.shell ? { shell: entryA.shell } : {}),
      liveStatus: "ready",
    };
    const targetB = {
      paneId: tabs.created[1].paneId,
      tabId: tabs.created[1].tabId,
      targetTerminalSessionId: entryB.id,
      targetRef: entryB.targetRef ?? "local",
      targetKind: entryB.targetKind ?? "local",
      ...(entryB.cwd ? { cwd: entryB.cwd } : {}),
      ...(entryB.shell ? { shell: entryB.shell } : {}),
      liveStatus: "ready",
    };

    phase = "create-global-agent-session";
    const globalRecord = await invokeTauri(client, "agent_session_create", {
      request: {
        agentId: "codex",
        launcherKey: "builtin:codex",
        scope: { kind: "global" },
        title: "Global terminal verification",
        target: targetA,
      },
    });
    const globalSessionId = readAgentSessionId(globalRecord);
    if (!globalSessionId) {
      throw new Error("agent_session_create returned no global session id");
    }
    phase = "prepare-global-agent-workspace";
    const prepared = await prepareAgentWorkspace(client, globalSessionId);
    const scopedMcp = new KerminalMcpClient(prepared.endpoint);
    phase = "global-mcp-init-and-discovery";
    await scopedMcp.initialize();
    const currentSession = await scopedMcp.callTool("kerminal.agent.current_session", {
      agentSessionId: globalSessionId,
    });
    const targetContext = await scopedMcp.callTool("kerminal.agent.target_context", {
      agentSessionId: globalSessionId,
      maxBytes: DEFAULT_SNAPSHOT_BYTES,
    });
    const scopedList = await scopedMcp.callTool("terminal.list", {});
    const scopedEntries = scopedList.data?.terminals ?? scopedList.data?.sessions ?? [];
    const initialTargetBinding = targetContext.data?.targetBinding;
    if (initialTargetBinding?.targetTerminalSessionId !== entryA.id) {
      throw new Error(
        `target_context target binding mismatch: expected ${entryA.id}, got ${initialTargetBinding?.targetTerminalSessionId ?? "missing"}`,
      );
    }
    const scopedSessionIds = new Set(
      scopedEntries.map((entry) => entry?.sessionId ?? entry?.id).filter(Boolean),
    );
    if (!scopedSessionIds.has(entryA.id) || !scopedSessionIds.has(entryB.id)) {
      throw new Error(
        `global terminal.list did not include both sessions: ${JSON.stringify([...scopedSessionIds])}`,
      );
    }

    phase = "rebind-default-target";
    const reboundRecord = await invokeTauri(client, "agent_session_rebind_target", {
      agentSessionId: globalSessionId,
      target: targetB,
    });
    const reboundSnapshot = await scopedMcp.callTool("terminal.snapshot", {
      agentSessionId: globalSessionId,
      maxBytes: DEFAULT_SNAPSHOT_BYTES,
    });
    const reboundSnapshotSessionId = reboundSnapshot.data?.session?.id;
    if (reboundSnapshotSessionId !== entryB.id) {
      throw new Error(
        `target rebind did not move the default snapshot target to B: expected ${entryB.id}, got ${reboundSnapshotSessionId ?? "missing"}`,
      );
    }

    phase = "global-terminal-marker-roundtrip";
    const markerA = `KERM_AGENT_GLOBAL_VERIFY_A_${Date.now().toString(36).toUpperCase()}`;
    const markerB = `KERM_AGENT_GLOBAL_VERIFY_B_${Date.now().toString(36).toUpperCase()}`;
    const commandA = markerCommand(entryA.shell, markerA);
    const commandB = markerCommand(entryB.shell, markerB);
    if (commandA.includes(markerA) || commandB.includes(markerB)) {
      throw new Error("Marker command must not contain the complete expected stdout marker");
    }
    await scopedMcp.callTool("terminal.snapshot", {
      agentSessionId: globalSessionId,
      maxBytes: DEFAULT_SNAPSHOT_BYTES,
      sessionId: entryA.id,
    });
    await scopedMcp.callTool("terminal.write", {
      agentSessionId: globalSessionId,
      data: commandA,
      sessionId: entryA.id,
    });
    const snapshotA = await waitForSnapshotMarker(
      scopedMcp,
      entryA.id,
      globalSessionId,
      markerA,
      options.timeoutMs,
    );
    await waitForUiMarker(client, tabs.created[0].paneId, markerA, options.timeoutMs);
    await waitForUiCommand(client, tabs.created[0].paneId, commandA, options.timeoutMs);
    await scopedMcp.callTool("terminal.write", {
      agentSessionId: globalSessionId,
      data: commandB,
      sessionId: entryB.id,
    });
    const snapshotB = await waitForSnapshotMarker(
      scopedMcp,
      entryB.id,
      globalSessionId,
      markerB,
      options.timeoutMs,
    );
    await waitForUiMarker(client, tabs.created[1].paneId, markerB, options.timeoutMs);
    await waitForUiCommand(client, tabs.created[1].paneId, commandB, options.timeoutMs);

    phase = "legacy-global-fixture";
    const legacyRecord = await invokeTauri(client, "agent_session_create", {
      request: {
        agentId: "codex",
        title: "Legacy tab scope fixture",
        target: targetA,
      },
    });
    const legacySessionId = readAgentSessionId(legacyRecord);
    if (!legacySessionId) {
      throw new Error("Legacy fixture returned no session id");
    }
    const legacyPrepared = await prepareAgentWorkspace(client, legacySessionId);
    const legacyMcp = new KerminalMcpClient(legacyPrepared.endpoint);
    await legacyMcp.initialize();
    await legacyMcp.callTool("kerminal.agent.current_session", {
      agentSessionId: legacySessionId,
    });
    const legacyContext = await legacyMcp.callTool("kerminal.agent.target_context", {
      agentSessionId: legacySessionId,
      maxBytes: DEFAULT_SNAPSHOT_BYTES,
    });
    const legacyList = await legacyMcp.callTool("terminal.list", {});
    const legacyEntries = legacyList.data?.terminals ?? legacyList.data?.sessions ?? [];
    const legacyScope = legacyContext.data?.scope;
    const legacyIds = new Set(
      legacyEntries.map((entry) => entry?.sessionId ?? entry?.id).filter(Boolean),
    );
    if (legacyScope?.kind !== "global") {
      throw new Error(
        `Legacy scope was not promoted to global: ${JSON.stringify(legacyScope)}`,
      );
    }
    if (!legacyIds.has(entryA.id) || !legacyIds.has(entryB.id)) {
      throw new Error(
        `Legacy global scope did not include both sessions: ${JSON.stringify([...legacyIds])}`,
      );
    }
    await activateTab(client, tabs.created[0].tabId, options.timeoutMs);
    const legacyMarker = `KERM_AGENT_LEGACY_GLOBAL_VERIFY_B_${Date.now().toString(36).toUpperCase()}`;
    const legacyCommand = markerCommand(entryB.shell, legacyMarker);
    if (legacyCommand.includes(legacyMarker)) {
      throw new Error("Legacy marker command contains the complete expected marker");
    }
    await legacyMcp.callTool("terminal.write", {
      agentSessionId: legacySessionId,
      data: legacyCommand,
      sessionId: entryB.id,
    });
    const legacySnapshot = await waitForSnapshotMarker(
      legacyMcp,
      entryB.id,
      legacySessionId,
      legacyMarker,
      options.timeoutMs,
    );
    await activateTab(client, tabs.created[1].tabId, options.timeoutMs);
    await waitForUiMarker(client, tabs.created[1].paneId, legacyMarker, options.timeoutMs);
    await waitForUiCommand(client, tabs.created[1].paneId, legacyCommand, options.timeoutMs);

    phase = "context-file-verification";
    const contexts = {
      global: await readContextFiles(globalRecord),
      legacy: await readContextFiles(legacyRecord),
    };
    if (contexts.global.mcpEndpointJson?.endpoint !== prepared.endpoint) {
      throw new Error("global context/mcp-endpoint.json does not match the scoped endpoint");
    }
    if (
      contexts.global.targetBindingJson?.binding?.targetTerminalSessionId !== entryB.id ||
      contexts.global.terminalSnapshotJson?.targetTerminalSessionId !== entryB.id
    ) {
      throw new Error("global target-binding/terminal-snapshot context does not reflect target B");
    }

    phase = "agent-launcher-and-theme-screenshots";
    await activateTab(client, tabs.created[0].tabId, options.timeoutMs);
    const agentLauncher = await openAgentLauncherForScreenshot(client, options.timeoutMs);
    const screenshots = await captureThemeScreenshots(
      client,
      artifactDir,
      options.skipThemes,
      options.timeoutMs,
    );
    report = buildReport({
      status: "passed",
      cdpPort: options.cdpPort,
      app: {
        title: app.title,
        url: app.url,
        configRoot: workspace.workspaceDir,
        mcpEndpoint: mcpStatus.endpoint,
      },
      artifactDir,
      agentCliStarted: false,
      headlessStart: {
        initialUiTabCount: initialUiTabs.length,
        zeroTabStart: initialUiTabs.length === 0,
        tabCreated: headlessTabCreated,
        paneCreated: headlessPaneCreated,
        outputBuffered: headlessOutputBuffered,
        sessionId: headlessSessionId,
        marker: headlessMarker,
        commandFragment: headlessCommand.trim(),
        snapshotContainsMarker: snapshotText(headlessSnapshot).includes(headlessMarker),
        survivedReaper: afterReapSessions.some(
          (session) => session?.id === headlessSessionId,
        ),
        reapedSessionIds,
        closed: true,
        uiTabCountUnchanged:
          initialUiTabs.length === afterHeadlessCreateTabs.length &&
          initialUiTabs.length === afterHeadlessCloseTabs.length,
        thirdPartyRootMcp: true,
      },
      tabs: {
        created: tabs.created.map(summarizeTab),
        beforeCount: tabs.before.length,
        afterCount: tabs.after.length,
      },
      terminals: {
        mappingMode: "Tauri terminal_list_sessions creation-diff",
        a: { sessionId: entryA.id, paneId: tabs.created[0].paneId },
        b: { sessionId: entryB.id, paneId: tabs.created[1].paneId },
      },
      agent: {
        sessionId: globalSessionId,
        scope: targetContext.data?.scope,
        initialTargetBinding: {
          paneId: initialTargetBinding?.paneId,
          targetTerminalSessionId: initialTargetBinding?.targetTerminalSessionId,
          status: initialTargetBinding?.status,
        },
        targetBinding: readRecordTarget(reboundRecord),
        listSessionIds: [...scopedSessionIds],
        markers: { a: markerA, b: markerB },
        commandFragments: { a: commandA.trim(), b: commandB.trim() },
        xtermMarkersRendered: true,
        activeTabIndependentWrite: true,
        defaultSnapshotAfterRebind: reboundSnapshotSessionId,
      },
      legacyFixture: {
        sessionId: legacySessionId,
        scope: legacyScope,
        targetBindingSessionId: legacyContext.data?.targetBinding?.targetTerminalSessionId,
        listSessionIds: [...legacyIds],
        nonCurrentTabWrite: snapshotText(legacySnapshot).includes(legacyMarker),
        commandFragment: legacyCommand.trim(),
        xtermMarkerRendered: true,
      },
      agentLauncher: {
        currentTargetHint: agentLauncher.currentTarget,
        newSessionButton: agentLauncher.newButton,
      },
      mcp: {
        initialized: true,
        toolOrder: [
          "kerminal.agent.current_session",
          "kerminal.agent.target_context",
          "terminal.list",
          "terminal.snapshot",
          "terminal.write",
        ],
        globalListIncludesAAndB: true,
        snapshots: {
          aContainsMarker: snapshotText(snapshotA).includes(markerA),
          bContainsMarker: snapshotText(snapshotB).includes(markerB),
        },
        headlessToolOrder: [
          "terminal.create",
          "terminal.write",
          "terminal.snapshot",
          "terminal.close",
        ],
      },
      contextFiles: {
        global: Object.keys(contexts.global),
        legacy: Object.keys(contexts.legacy),
      },
      screenshots,
      currentSessionSummary: readAgentSessionId(currentSession.data?.agentSession)
        ? { sessionId: readAgentSessionId(currentSession.data.agentSession) }
        : null,
    });
  } catch (error) {
    report = buildReport({
      ...report,
      status: "failed",
      phase,
      error: String(error?.message ?? error),
    });
  } finally {
    client?.close();
  }
  return report;
}

/** 输出 JSON 证据并设置非零退出码，供 CI/人工验收直接消费。 */
async function main() {
  const options = parseArgs();
  if (options.help) {
    process.stdout.write(
      [
        "Usage: node scripts/verify-agent-global-terminal.mjs [options]",
        `  --cdp-port <port>       Tauri WebView2 CDP port (default: ${DEFAULT_CDP_PORT})`,
        "  --config-root <path>    expected isolated Kerminal config root",
        `  --artifact-root <path>  screenshot/report parent (default: ${DEFAULT_ARTIFACT_ROOT})`,
        `  --timeout-ms <ms>       bounded wait timeout (default: ${DEFAULT_TIMEOUT_MS})`,
        "  --skip-themes           skip light/dark/system screenshots",
      ].join("\n") + "\n",
    );
    return;
  }
  const report = await runVerification(options);
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (report.status !== "passed") {
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
