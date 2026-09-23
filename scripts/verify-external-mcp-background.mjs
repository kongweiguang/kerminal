#!/usr/bin/env node
// @author kongweiguang

import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_CDP_PORT,
  DEFAULT_SNAPSHOT_BYTES,
  DEFAULT_TIMEOUT_MS,
  KerminalMcpClient,
  assertSafeConfigRoot,
  markerCommand,
  normalizePath,
  parseArgs,
  snapshotText,
  waitForSnapshotMarker,
} from "./verify-agent-global-terminal-support.mjs";
import {
  assertNoBlockingUiError,
  connectToTauriPage,
  evaluate,
  invokeTauri,
  waitForExpression,
} from "./verify-agent-global-terminal-webview.mjs";

const TERMINAL_CREATE_BUTTON_SELECTOR = '[aria-label="新建临时终端"]';
const TERMINAL_TAB_SELECTOR = "[data-terminal-tab-id]";
const MCP_CLOSE_ACCEPTED_STATUSES = new Set([200, 202, 204, 404]);

/** 将一个 MCP 或指南响应转换为不含运行时对象的可搜索文本。 */
function jsonText(value) {
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value ?? "");
  } catch {
    return String(value ?? "");
  }
}

/** 从 callTool 返回值中取出 data，兼容纯 data 和 { data } 两种测试夹具。 */
function toolData(value) {
  return value?.data ?? value;
}

/** 从真实 store 读取活动身份，避开 dnd-kit 覆盖按钮 aria 属性造成的假阴性；等待连续稳定投影。 */
export async function readVisibleTerminalSurface(client) {
  let previous;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const surface = await evaluate(
    client,
    `(async () => {
      const { useWorkspaceStore } = await import('/src/features/workspace/workspaceStore.ts');
      const activeTabId = useWorkspaceStore.getState().activeTabId;
      const tabs = Array.from(document.querySelectorAll(${JSON.stringify(TERMINAL_TAB_SELECTOR)})).map((element) => {
        const tabId = element.getAttribute('data-terminal-tab-id') ?? element.id ?? null;
        return {
          active: tabId === activeTabId,
          tabId,
        };
      }).filter((tab) => tab.tabId);
      const active = tabs.find((tab) => tab.active);
      return {
        activeTabId: active?.tabId ?? null,
        tabIds: tabs.map((tab) => tab.tabId),
        tabs,
      };
    })()`,
    { awaitPromise: true },
  );
    const valid = surface.tabIds.length === 0 || surface.tabIds.includes(surface.activeTabId);
    const projection = JSON.stringify(stableUiProjection(surface));
    if (valid && previous === projection) return surface;
    previous = valid ? projection : undefined;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Visible UI tabs did not settle with a valid active Tab");
}

/** 把 UI 观测压缩为只包含 Tab ID 和活动 ID 的比较投影。 */
export function stableUiProjection(surface) {
  return {
    activeTabId: surface?.activeTabId ?? null,
    tabIds: Array.isArray(surface?.tabIds) ? [...surface.tabIds] : [],
  };
}

/** 非空 Tab 必须能观测有效活动身份，避免两个 null 被误判为 UI 未变。 */
export function assertStableUiSurface(before, after, label = "MCP operation") {
  const expected = stableUiProjection(before);
  const actual = stableUiProjection(after);
  for (const surface of [expected, actual]) {
    if (surface.tabIds.length > 0 && !surface.tabIds.includes(surface.activeTabId)) {
      throw new Error(`${label} has no valid active Tab: ${JSON.stringify(surface)}`);
    }
  }
  if (
    expected.activeTabId !== actual.activeTabId ||
    expected.tabIds.length !== actual.tabIds.length ||
    expected.tabIds.some((tabId, index) => tabId !== actual.tabIds[index])
  ) {
    throw new Error(
      `${label} changed visible UI tabs: ${JSON.stringify({ expected, actual })}`,
    );
  }
  return true;
}

/** 等待一次 UI 点击产生的唯一新 PTY，避免把既有会话误当作测试夹具。 */
async function waitForNewSession(client, knownSessionIds, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const sessions = await invokeTauri(client, "terminal_list_sessions");
    const fresh = (sessions ?? []).filter(
      (session) => session?.id && !knownSessionIds.has(session.id),
    );
    if (fresh.length === 1) {
      knownSessionIds.add(fresh[0].id);
      return fresh[0];
    }
    if (fresh.length > 1) {
      throw new Error(
        `Expected one new PTY session after opening a visible Tab, got ${fresh.length}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for a PTY created by the visible Tab fixture");
}

/** 创建两个只用于验收的本地可见 Tab，并保存每个 Tab 的 PTY session；创建回调让失败清理也能接管半成品夹具。 */
export async function createVisibleFixtureTabs(client, timeoutMs, onCreated) {
  await waitForExpression(
    client,
    `document.querySelector(${JSON.stringify(TERMINAL_CREATE_BUTTON_SELECTOR)}) !== null`,
    timeoutMs,
  );
  const before = await readVisibleTerminalSurface(client);
  const knownTabIds = new Set(before.tabIds);
  const baselineSessions = await invokeTauri(client, "terminal_list_sessions");
  const knownSessionIds = new Set(
    (baselineSessions ?? []).map((session) => session?.id).filter(Boolean),
  );
  const created = [];
  for (let index = 0; index < 2; index += 1) {
    await evaluate(
      client,
      `(() => {
        const button = document.querySelector(${JSON.stringify(TERMINAL_CREATE_BUTTON_SELECTOR)});
        if (!button) throw new Error("Missing new temporary terminal button");
        button.click();
        return true;
      })()`,
    );
    await waitForExpression(
      client,
      `document.querySelectorAll(${JSON.stringify(TERMINAL_TAB_SELECTOR)}).length >= ${before.tabIds.length + index + 1}`,
      timeoutMs,
    );
    const surface = await readVisibleTerminalSurface(client);
    const newTabId = surface.tabIds.find(
      (tabId) => !knownTabIds.has(tabId) && !created.some((item) => item.tabId === tabId),
    );
    if (!newTabId) {
      throw new Error(`Visible local Tab ${index + 1} did not expose a stable tab id`);
    }
    onCreated?.(newTabId);
    const session = await waitForNewSession(client, knownSessionIds, timeoutMs);
    if (session.targetRef !== "local") {
      throw new Error(
        `Visible fixture Tab ${newTabId} created a non-local target: ${session.targetRef ?? "missing"}`,
      );
    }
    knownTabIds.add(newTabId);
    created.push({
      activeTabId: surface.activeTabId,
      session,
      tabId: newTabId,
    });
  }
  return {
    after: await readVisibleTerminalSurface(client),
    before,
    created,
  };
}

/** 等待后台 PTY 从真实 TerminalManager 中消失，证明 terminal.close 完成。 */
async function waitForSessionGone(client, sessionId, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const sessions = await invokeTauri(client, "terminal_list_sessions");
    if (!(sessions ?? []).some((session) => session?.id === sessionId)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for terminal.close to remove ${sessionId}`);
}

/** 仅确认本次夹具关闭触发的单 Tab 弹窗；既有弹窗阻止清理，避免确认用户操作。 */
async function closeVisibleFixtureTabs(client, tabIds, timeoutMs) {
  const cleanupErrors = [];
  for (const tabId of [...tabIds].reverse()) {
    try {
      const current = await readVisibleTerminalSurface(client);
      if (!current.tabIds.includes(tabId)) {
        continue;
      }
      await evaluate(
        client,
        `(() => {
          if (document.querySelector('[role="dialog"]')) throw new Error("Existing dialog blocks fixture cleanup");
          const wrapper = document.querySelector(${JSON.stringify(`[data-terminal-tab-id="${tabId.replaceAll('"', '\\"')}"]`)});
          const closeButton = wrapper?.querySelector('button[aria-label^="关闭 "]');
          if (!closeButton) throw new Error("Missing fixture Tab close button");
          closeButton.click();
          return true;
        })()`,
      );
      await waitForExpression(
        client,
        `(() => {
          const exists = Array.from(document.querySelectorAll(${JSON.stringify(TERMINAL_TAB_SELECTOR)})).some(element => element.getAttribute('data-terminal-tab-id') === ${JSON.stringify(tabId)});
          if (!exists) return true;
          const dialogs = Array.from(document.querySelectorAll('[role="dialog"]'));
          if (dialogs.length !== 1) return false;
          const dialog = dialogs[0];
          if (!dialog.textContent.includes('确认关闭标签') || !dialog.textContent.includes('将关闭 1 个终端标签。')) return false;
          const button = Array.from(dialog.querySelectorAll('button')).find(element => element.textContent.trim() === '关闭标签');
          button?.click();
          return false;
        })()`,
        timeoutMs,
      );
    } catch (error) {
      cleanupErrors.push(String(error?.message ?? error));
    }
  }
  return {
    errors: cleanupErrors,
    surface: await readVisibleTerminalSurface(client).catch(() => null),
  };
}

/** 等待应用 MCP HTTP 服务就绪，不停止或重启其他应用进程。 */
async function ensureMcpStatus(client, timeoutMs) {
  let status = await invokeTauri(client, "mcp_http_server_status");
  if (!status?.running) {
    await invokeTauri(client, "mcp_http_server_start", { request: null });
  }
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    status = await invokeTauri(client, "mcp_http_server_status");
    if (status?.running && status.endpoint) {
      return status;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("Kerminal MCP server did not become ready");
}

/** 以正向语义检查 initialize 与发现/操作指南，避免依赖单个文案字段名称。 */
export function assertExternalMcpBackgroundPolicy({
  appGuide,
  capabilities,
  initializeResult,
  operationSsh,
  operationTerminal,
  runtimeSnapshot,
  toolHelp,
}) {
  const initializationText = jsonText(initializeResult);
  const guideText = [
    capabilities,
    appGuide,
    operationTerminal,
    operationSsh,
    runtimeSnapshot,
    toolHelp,
  ]
    .map(jsonText)
    .join("\n");
  const allText = `${initializationText}\n${guideText}`;
  const tests = {
    initializationDefaultBackground:
      /(?:external\s+mcp|外部\s*mcp)[\s\S]{0,160}(?:default|默认)[\s\S]{0,160}(?:background|后台)/i.test(
        initializationText,
      ),
    initializationNonInteractiveSsh:
      /ssh\.command(?:_on_resolved_host)?[\s\S]{0,160}(?:non[- ]interactive|非交互|background|后台)/i.test(
        initializationText,
      ),
    initializationHeadlessPty:
      /terminal\.create[\s\S]{0,220}(?:headless|后台|不[^.]{0,40}(?:ui|tab|标签))/i.test(
        initializationText,
      ),
    initializationExplicitVisibleTab:
      /(?:explicit(?:ly)?\s+(?:asks?|request)|明确(?:地)?要求|用户明确)[\s\S]{0,180}(?:visible|可见|ui|界面)[\s\S]{0,100}(?:tab|标签)/i.test(
        initializationText,
      ),
    initializationNoFallback:
      /(?:background failure|后台失败)[\s\S]{0,180}(?:must not|不得|不能|不应|不)[\s\S]{0,100}(?:fall\s*back|fallback|回退)[\s\S]{0,100}(?:visible|可见|terminal|终端)/i.test(
        initializationText,
      ),
    guideDefaultBackground:
      /(?:external\s+mcp|外部\s*mcp)[\s\S]{0,220}(?:default|默认)[\s\S]{0,220}(?:background|后台)|(?:default(?:mode|execution|policy)|默认(?:模式|执行|策略))["']?\s*[:=]\s*["']?(?:background|后台)/i.test(
        guideText,
      ),
    guideHeadlessPty:
      /terminal\.create[\s\S]{0,260}(?:headless|后台|不[^.]{0,50}(?:ui|tab|标签))/i.test(
        guideText,
      ),
    guideExplicitVisibleTab:
      /(?:explicit(?:ly)?\s+(?:asks?|request)|明确(?:地)?要求|用户明确)[\s\S]{0,220}(?:visible|可见|ui|界面)[\s\S]{0,120}(?:tab|标签)/i.test(
        guideText,
      ),
    guideNoFallback:
      /(?:background failure|后台失败)[\s\S]{0,220}(?:must not|不得|不能|不应|不)[\s\S]{0,120}(?:fall\s*back|fallback|回退)[\s\S]{0,120}(?:visible|可见|terminal|终端)/i.test(
        guideText,
      ),
    builtInAgentBinding:
      /(?:right[- ]panel|built[- ]in|内置右栏)[\s\S]{0,220}(?:targetBinding|global scope|全局|首选)/i.test(
        allText,
      ),
    ordinaryTabDoesNotRebind:
      /(?:ordinary|normal|普通)[\s\S]{0,140}(?:tab|标签)[\s\S]{0,140}(?:do not|不会|不)[\s\S]{0,80}(?:rebind|重绑|重新绑定)/i.test(
        allText,
      ),
  };
  const required = [
    "initializationDefaultBackground",
    "initializationNonInteractiveSsh",
    "initializationHeadlessPty",
    "initializationExplicitVisibleTab",
    "initializationNoFallback",
    "guideDefaultBackground",
    "guideHeadlessPty",
    "guideExplicitVisibleTab",
    "guideNoFallback",
    "builtInAgentBinding",
    "ordinaryTabDoesNotRebind",
  ];
  const missing = required.filter((key) => !tests[key]);
  if (missing.length > 0) {
    throw new Error(`External MCP background policy missing: ${missing.join(", ")}`);
  }
  return tests;
}

/** 从 MCP terminal.list 中提取可比较的 session ID 集合。 */
function terminalListIds(data) {
  const entries = data?.terminals ?? data?.sessions ?? [];
  return entries
    .map((entry) => entry?.sessionId ?? entry?.id)
    .filter(Boolean);
}

/** 读取指定 session 的脱敏终端快照，所有写入目标都显式传 sessionId。 */
async function readSessionSnapshot(mcp, sessionId) {
  return mcp.callTool("terminal.snapshot", {
    maxBytes: DEFAULT_SNAPSHOT_BYTES,
    sessionId,
  });
}

/** 断言 marker 只出现在预期快照，防止失败后静默回退到其他终端。 */
function assertMarkerRouting(snapshots, marker, expectedSessionId, label) {
  const matches = Object.entries(snapshots)
    .filter(([, snapshot]) => snapshotText(toolData(snapshot)).includes(marker))
    .map(([sessionId]) => sessionId);
  if (matches.length !== 1 || matches[0] !== expectedSessionId) {
    throw new Error(
      `${label} marker routing mismatch: ${JSON.stringify({ expectedSessionId, matches })}`,
    );
  }
  return true;
}

/** 断言一个 marker 没有进入任何既有可见终端。 */
function assertMarkerAbsent(snapshots, marker, label) {
  const matches = Object.entries(snapshots)
    .filter(([, snapshot]) => snapshotText(toolData(snapshot)).includes(marker))
    .map(([sessionId]) => sessionId);
  if (matches.length > 0) {
    throw new Error(`${label} marker leaked to visible sessions: ${matches.join(", ")}`);
  }
  return true;
}

/** 用 MCP Streamable HTTP DELETE 尝试释放本脚本的 client session，不停止服务器。 */
async function closeMcpSession(mcp) {
  if (!mcp?.endpoint || !mcp.sessionId) {
    return { attempted: false, ok: true };
  }
  try {
    const response = await fetch(mcp.endpoint, {
      headers: {
        Accept: "application/json, text/event-stream",
        "MCP-Protocol-Version": "2025-03-26",
        "Mcp-Session-Id": mcp.sessionId,
      },
      method: "DELETE",
    });
    return {
      attempted: true,
      ok: MCP_CLOSE_ACCEPTED_STATUSES.has(response.status),
      status: response.status,
    };
  } catch (error) {
    return {
      attempted: true,
      error: String(error?.message ?? error),
      ok: false,
    };
  }
}

/** 执行隔离 Tauri dev 的外部 MCP 后台默认策略验收。 */
export async function runVerification(options = parseArgs()) {
  let cdp;
  let mcp;
  let mcpStatus;
  let headlessSessionId;
  const fixtureTabIds = [];
  let phase = "connect";
  let report = {
    tool: "verify-external-mcp-background",
    version: 1,
    status: "failed",
    cdpPort: options.cdpPort,
    phase,
  };

  try {
    const connected = await connectToTauriPage(options.cdpPort);
    cdp = connected.client;
    const app = await evaluate(
      cdp,
      `({ title: document.title, url: location.href, tauri: Boolean(window.__TAURI_INTERNALS__) })`,
    );
    if (!app?.tauri) {
      throw new Error("Connected page is not a Tauri WebView");
    }
    await assertNoBlockingUiError(cdp);

    phase = "isolated-config-check";
    const workspace = await invokeTauri(cdp, "get_external_agent_workspace_status");
    const configRoot = assertSafeConfigRoot(workspace?.workspaceDir);
    if (options.configRoot && normalizePath(options.configRoot) !== configRoot) {
      throw new Error(
        `Running app config root does not match --config-root: ${workspace?.workspaceDir}`,
      );
    }

    phase = "mcp-initialize-and-policy-guides";
    mcpStatus = await ensureMcpStatus(cdp, options.timeoutMs);
    mcp = new KerminalMcpClient(mcpStatus.endpoint);
    const initializeResult = await mcp.initialize();
    const capabilities = await mcp.callTool("kerminal.capabilities");
    const appGuide = await mcp.callTool("kerminal.app_guide");
    const operationTerminal = await mcp.callTool("kerminal.operation_guide", {
      intent: "terminal",
    });
    const operationSsh = await mcp.callTool("kerminal.operation_guide", {
      intent: "ssh-command",
    });
    const runtimeSnapshot = await mcp.callTool("kerminal.runtime_snapshot");
    const toolHelp = await mcp.callTool("kerminal.tool_help", {
      includeSchemas: false,
      toolId: "terminal.create",
    });
    const policy = assertExternalMcpBackgroundPolicy({
      appGuide: toolData(appGuide),
      capabilities: toolData(capabilities),
      initializeResult,
      operationSsh: toolData(operationSsh),
      operationTerminal: toolData(operationTerminal),
      runtimeSnapshot: toolData(runtimeSnapshot),
      toolHelp: toolData(toolHelp),
    });

    phase = "visible-tab-fixture";
    const fixture = await createVisibleFixtureTabs(
      cdp,
      options.timeoutMs,
      (tabId) => {
        if (!fixtureTabIds.includes(tabId)) {
          fixtureTabIds.push(tabId);
        }
      },
    );
    const visibleA = fixture.created[0]?.session;
    const visibleB = fixture.created[1]?.session;
    if (!visibleA?.id || !visibleB?.id) {
      throw new Error("Visible fixture did not resolve two PTY session IDs");
    }
    const baselineUi = await readVisibleTerminalSurface(cdp);
    const listed = await mcp.callTool("terminal.list");
    const listedIds = terminalListIds(toolData(listed));
    if (!listedIds.includes(visibleA.id) || !listedIds.includes(visibleB.id)) {
      throw new Error(
        `terminal.list did not expose both visible fixture sessions: ${JSON.stringify(listedIds)}`,
      );
    }
    const initialVisibleSnapshots = {
      [visibleA.id]: await readSessionSnapshot(mcp, visibleA.id),
      [visibleB.id]: await readSessionSnapshot(mcp, visibleB.id),
    };

    phase = "headless-create-write-snapshot-close";
    const beforeHeadlessCreate = await readVisibleTerminalSurface(cdp);
    const headlessCreated = await mcp.callTool("terminal.create", {
      cols: 80,
      cwd: process.cwd(),
      rows: 24,
      target: "local",
    });
    const headlessData = toolData(headlessCreated) ?? {};
    const headlessSession = headlessData.session;
    headlessSessionId = headlessData.sessionId ?? headlessSession?.id;
    const backgroundSessionId = headlessSessionId;
    const headlessUi = headlessData.ui ?? {};
    if (
      !headlessSessionId ||
      headlessData.headless !== true ||
      headlessData.outputBuffered !== true ||
      headlessUi.tabCreated !== false ||
      headlessUi.paneCreated !== false
    ) {
      throw new Error(
        `terminal.create was not headless: ${JSON.stringify({
          headless: headlessData.headless,
          outputBuffered: headlessData.outputBuffered,
          paneCreated: headlessUi.paneCreated,
          sessionId: headlessSessionId,
          tabCreated: headlessUi.tabCreated,
        })}`,
      );
    }
    const afterHeadlessCreate = await readVisibleTerminalSurface(cdp);
    assertStableUiSurface(beforeHeadlessCreate, afterHeadlessCreate, "terminal.create");
    const headlessMarker = `KERM_EXTERNAL_MCP_HEADLESS_${Date.now().toString(36).toUpperCase()}`;
    const headlessCommand = markerCommand(headlessSession?.shell, headlessMarker);
    if (headlessCommand.includes(headlessMarker)) {
      throw new Error("Headless marker command contains the complete expected marker");
    }
    await mcp.callTool("terminal.write", {
      data: headlessCommand,
      sessionId: headlessSessionId,
    });
    const headlessSnapshot = await waitForSnapshotMarker(
      mcp,
      backgroundSessionId,
      undefined,
      headlessMarker,
      options.timeoutMs,
    );
    const afterHeadlessWrite = await readVisibleTerminalSurface(cdp);
    assertStableUiSurface(beforeHeadlessCreate, afterHeadlessWrite, "headless write");
    const visibleAfterHeadlessWrite = {
      [visibleA.id]: await readSessionSnapshot(mcp, visibleA.id),
      [visibleB.id]: await readSessionSnapshot(mcp, visibleB.id),
    };
    assertMarkerAbsent(visibleAfterHeadlessWrite, headlessMarker, "headless write");
    await mcp.callTool("terminal.close", { sessionId: backgroundSessionId });
    await waitForSessionGone(cdp, backgroundSessionId, options.timeoutMs);
    headlessSessionId = undefined;
    const afterHeadlessClose = await readVisibleTerminalSurface(cdp);
    assertStableUiSurface(beforeHeadlessCreate, afterHeadlessClose, "headless close");
    const afterHeadlessList = await mcp.callTool("terminal.list");
    if (terminalListIds(toolData(afterHeadlessList)).includes(backgroundSessionId)) {
      throw new Error("terminal.close left the headless session in terminal.list");
    }

    phase = "explicit-visible-target-write";
    const visibleMarker = `KERM_EXTERNAL_MCP_VISIBLE_A_${Date.now().toString(36).toUpperCase()}`;
    const visibleCommand = markerCommand(visibleA.shell, visibleMarker);
    if (visibleCommand.includes(visibleMarker)) {
      throw new Error("Visible marker command contains the complete expected marker");
    }
    await mcp.callTool("terminal.write", {
      data: visibleCommand,
      sessionId: visibleA.id,
    });
    await waitForSnapshotMarker(
      mcp,
      visibleA.id,
      undefined,
      visibleMarker,
      options.timeoutMs,
    );
    const visibleTargetAfterWrite = await readVisibleTerminalSurface(cdp);
    assertStableUiSurface(baselineUi, visibleTargetAfterWrite, "explicit visible write");
    const visibleWriteSnapshots = {
      [visibleA.id]: await readSessionSnapshot(mcp, visibleA.id),
      [visibleB.id]: await readSessionSnapshot(mcp, visibleB.id),
    };
    assertMarkerRouting(
      visibleWriteSnapshots,
      visibleMarker,
      visibleA.id,
      "explicit visible write",
    );

    phase = "invalid-explicit-target-no-fallback";
    const invalidSessionId = `invalid-external-mcp-${Date.now().toString(36)}`;
    const invalidMarker = `KERM_EXTERNAL_MCP_INVALID_${Date.now().toString(36).toUpperCase()}`;
    const invalidCommand = markerCommand(visibleA.shell, invalidMarker);
    let invalidWriteError;
    try {
      await mcp.callTool("terminal.write", {
        data: invalidCommand,
        sessionId: invalidSessionId,
      });
    } catch (error) {
      invalidWriteError = String(error?.message ?? error);
    }
    if (!invalidWriteError) {
      throw new Error("terminal.write unexpectedly accepted an invalid sessionId");
    }
    const afterInvalidWrite = await readVisibleTerminalSurface(cdp);
    assertStableUiSurface(baselineUi, afterInvalidWrite, "invalid explicit write");
    const invalidWriteSnapshots = {
      [visibleA.id]: await readSessionSnapshot(mcp, visibleA.id),
      [visibleB.id]: await readSessionSnapshot(mcp, visibleB.id),
    };
    assertMarkerAbsent(invalidWriteSnapshots, invalidMarker, "invalid explicit write");

    report = {
      ...report,
      status: "passed",
      phase: "complete",
      app: {
        title: app.title,
        url: app.url,
        configRoot,
      },
      mcp: {
        endpointReady: true,
        initialized: Boolean(initializeResult?.protocolVersion),
        policy,
        listedVisibleSessionIds: listedIds,
      },
      tabs: {
        beforeFixture: stableUiProjection(fixture.before),
        created: fixture.created.map((item) => ({
          activeTabId: item.activeTabId,
          sessionId: item.session.id,
          tabId: item.tabId,
        })),
        initialSnapshotsRead: Object.keys(initialVisibleSnapshots).length === 2,
        duringHeadless: {
          createStable: true,
          writeStable: true,
          closeStable: true,
        },
        activeTabIdBeforeMcp: baselineUi.activeTabId,
      },
      background: {
        sessionId: backgroundSessionId,
        headless: true,
        tabCreated: false,
        paneCreated: false,
        outputBuffered: true,
        markerSnapshot: snapshotText(headlessSnapshot).includes(headlessMarker),
        visibleMarkers: {
          headlessMarkerAbsent: true,
        },
        closed: true,
      },
      explicitVisible: {
        sessionId: visibleA.id,
        marker: visibleMarker,
        routedOnlyToSelectedSession: true,
        otherVisibleSessionId: visibleB.id,
      },
      invalidExplicit: {
        rejected: true,
        error: invalidWriteError,
        fallbackToVisibleTerminal: false,
        markerAbsentFromVisibleSessions: true,
      },
    };
  } catch (error) {
    report = {
      ...report,
      status: "failed",
      phase,
      error: String(error?.message ?? error),
    };
  } finally {
    const cleanup = {
      backgroundSessionClosed: !headlessSessionId,
      fixtureTabsClosed: false,
      mcpSessionClosed: false,
      errors: [],
    };
    if (mcp && headlessSessionId) {
      try {
        await mcp.callTool("terminal.close", { sessionId: headlessSessionId });
        await waitForSessionGone(cdp, headlessSessionId, options.timeoutMs);
        cleanup.backgroundSessionClosed = true;
      } catch (error) {
        cleanup.errors.push(`background cleanup: ${String(error?.message ?? error)}`);
      }
    }
    if (cdp && fixtureTabIds.length > 0) {
      const fixtureCleanup = await closeVisibleFixtureTabs(
        cdp,
        fixtureTabIds,
        options.timeoutMs,
      ).catch((error) => ({ errors: [String(error?.message ?? error)], surface: null }));
      cleanup.fixtureTabsClosed = fixtureCleanup.errors.length === 0;
      cleanup.errors.push(...fixtureCleanup.errors.map((error) => `fixture cleanup: ${error}`));
    } else {
      cleanup.fixtureTabsClosed = true;
    }
    const mcpCleanup = await closeMcpSession(mcp);
    cleanup.mcpSessionClosed = mcpCleanup.ok;
    if (!mcpCleanup.ok) {
      cleanup.errors.push(`MCP session cleanup: ${JSON.stringify(mcpCleanup)}`);
    }
    if (cdp) {
      try {
        cdp.close();
      } catch (error) {
        cleanup.errors.push(`CDP cleanup: ${String(error?.message ?? error)}`);
      }
    }
    report = {
      ...report,
      cleanup,
    };
    if (report.status === "passed" && cleanup.errors.length > 0) {
      report.status = "failed";
      report.phase = "cleanup";
    }
  }
  return report;
}

/** 输出短 JSON 事实报告，并以非零退出码标记任意失败或清理不完整。 */
async function main() {
  const options = parseArgs();
  if (options.help) {
    process.stdout.write(
      [
        "Usage: node scripts/verify-external-mcp-background.mjs [options]",
        `  --cdp-port <port>       Tauri WebView2 CDP port (default: ${DEFAULT_CDP_PORT})`,
        "  --config-root <path>    expected isolated Kerminal config root",
        `  --timeout-ms <ms>       bounded wait timeout (default: ${DEFAULT_TIMEOUT_MS})`,
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
