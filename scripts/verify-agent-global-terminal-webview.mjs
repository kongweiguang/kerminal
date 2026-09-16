// @author kongweiguang

import { writeFile } from "node:fs/promises";
import path from "node:path";

import { CdpClient, requestJson } from "./readme-screenshots/cdp-client.mjs";
import {
  DEFAULT_MCP_REQUEST_TIMEOUT_MS,
  DEFAULT_TIMEOUT_MS,
} from "./verify-agent-global-terminal-support.mjs";

const TERMINAL_BUTTON_SELECTOR = '[aria-label="新建临时终端"]';
const LOCAL_TAB_SELECTOR = '[data-testid^="tab-local-"]';

/** 连接真实 Tauri WebView2 page target，并开启 CDP Runtime/Page 域。 */
export async function connectToTauriPage(cdpPort) {
  const targets = await requestJson(cdpPort, "/json/list");
  const page = targets.find(
    (target) => target.type === "page" && target.webSocketDebuggerUrl,
  );
  if (!page) {
    throw new Error(`No Tauri WebView page found on CDP port ${cdpPort}`);
  }
  const client = await CdpClient.connect(page.webSocketDebuggerUrl);
  await client.send("Runtime.enable");
  await client.send("Page.enable");
  installRuntimeErrorCapture(client);
  return { client, page };
}

/** 监听真实 WebView 异常和 console.error，作为 UI 稳定性门禁。 */
function installRuntimeErrorCapture(client) {
  client.runtimeErrors = [];
  client.ws.addEventListener("message", (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    if (message.method === "Runtime.exceptionThrown") {
      client.runtimeErrors.push(
        message.params?.exceptionDetails?.exception?.description ??
          message.params?.exceptionDetails?.text ??
          "Runtime exception",
      );
    }
    if (
      message.method === "Runtime.consoleAPICalled" &&
      message.params?.type === "error"
    ) {
      client.runtimeErrors.push(
        (message.params.args ?? [])
          .map((argument) => argument?.value ?? argument?.description ?? "")
          .join(" ") || "console.error",
      );
    }
  });
}

/** 执行 CDP Runtime.evaluate，并把 WebView exceptionDetails 转为 Error。 */
export async function evaluate(client, expression, options = {}) {
  const result = await client.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    ...options,
  });
  if (result.exceptionDetails) {
    const details = result.exceptionDetails;
    throw new Error(
      String(
        details.exception?.description ??
          details.exception?.value ??
          details.text ??
          "Runtime.evaluate failed",
      ),
    );
  }
  return result.result?.value;
}

/** 通过 Tauri 内部 IPC 调用无 UI 命令，并对单次调用设置超时。 */
export async function invokeTauri(
  client,
  command,
  args,
  timeoutMs = DEFAULT_MCP_REQUEST_TIMEOUT_MS,
) {
  const serializedArgs = args === undefined ? "" : `, ${JSON.stringify(args)}`;
  const expression = `Promise.race([
    window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)}${serializedArgs}),
    new Promise((_, reject) => setTimeout(() => reject(new Error("Tauri IPC timeout: ${command}")), ${timeoutMs})),
  ]).then((value) => ({ ok: true, value })).catch((error) => ({
    ok: false,
    error: String(error?.message ?? error),
  }))`;
  const result = await evaluate(client, expression, { awaitPromise: true });
  if (!result?.ok) {
    throw new Error(String(result?.error ?? `Tauri command failed: ${command}`));
  }
  return result.value;
}

/** 等待 WebView 中确定性的布尔条件，避免用无界固定 sleep。 */
export async function waitForExpression(client, expression, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await evaluate(client, expression)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for WebView expression: ${expression}`);
}

/** 读取当前页面的本地 terminal tab/pane 投影，保留真实 DOM pane 身份。 */
export async function readUiTerminals(client) {
  return evaluate(
    client,
    `Array.from(document.querySelectorAll(${JSON.stringify(LOCAL_TAB_SELECTOR)})).map((tab) => ({
      tabId: tab.getAttribute("data-testid") ?? tab.id,
      paneId: tab.querySelector('[data-testid^="pane-"]')?.getAttribute("data-testid") ?? null,
      title: tab.querySelector('[aria-label*="xterm 终端"]')?.getAttribute("aria-label") ?? tab.textContent?.trim().slice(0, 80) ?? "",
      rendered: Boolean(tab.querySelector('.xterm-rows')),
    }))`,
  );
}

/** 轮询 Tauri 运行态，取得某次新建 Tab 对应的唯一 PTY session。 */
async function waitForNewTerminalSession(client, knownSessionIds, timeoutMs) {
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
        `Expected one new PTY session after opening a Tab, got ${fresh.length}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for the PTY session created by a new Tab");
}

/** 用应用自身的新建动作创建两个 Tab，并逐个差集绑定 PTY session。 */
export async function createTwoLocalTabs(client, timeoutMs) {
  await waitForExpression(
    client,
    `document.querySelector(${JSON.stringify(TERMINAL_BUTTON_SELECTOR)}) !== null`,
    timeoutMs,
  );
  const before = await readUiTerminals(client);
  const beforeIds = new Set(before.map((tab) => tab.tabId));
  const baselineSessions = await invokeTauri(client, "terminal_list_sessions");
  const knownSessionIds = new Set(
    (baselineSessions ?? []).map((session) => session?.id).filter(Boolean),
  );
  const created = [];
  for (let index = 0; index < 2; index += 1) {
    await evaluate(
      client,
      `(() => {
        const button = document.querySelector(${JSON.stringify(TERMINAL_BUTTON_SELECTOR)});
        if (!button) throw new Error("Missing new temporary terminal button");
        button.click();
        return true;
      })()`,
    );
    await waitForExpression(
      client,
      `document.querySelectorAll(${JSON.stringify(LOCAL_TAB_SELECTOR)}).length >= ${before.length + index + 1}`,
      timeoutMs,
    );
    const tabs = await readUiTerminals(client);
    const next = tabs.find(
      (tab) =>
        !beforeIds.has(tab.tabId) &&
        !created.some((item) => item.tabId === tab.tabId),
    );
    if (!next?.tabId || !next.paneId) {
      throw new Error(`New local terminal tab ${index + 1} did not expose a pane id`);
    }
    await waitForExpression(
      client,
      `Boolean(document.querySelector(${JSON.stringify(`[data-testid="${next.paneId}"] .xterm-rows`)}))`,
      timeoutMs,
    );
    const session = await waitForNewTerminalSession(
      client,
      knownSessionIds,
      timeoutMs,
    );
    created.push({ ...next, session });
  }
  return { before, created, after: await readUiTerminals(client) };
}

/** 创建不调用 provider CLI 的 Agent workspace，并取得 session-scoped endpoint。 */
export async function prepareAgentWorkspace(client, agentSessionId) {
  const spec = await invokeTauri(client, "prepare_external_agent_workspace", {
    request: {
      agentId: "codex",
      agentSessionId,
      dryRun: false,
    },
  });
  const endpoint = spec?.env?.KERMINAL_MCP_ENDPOINT;
  if (!endpoint) {
    throw new Error("prepare_external_agent_workspace returned no KERMINAL_MCP_ENDPOINT");
  }
  return { endpoint, spec };
}

/** 阻断 Vite/Babel 错误遮罩、Runtime exception 和 console.error。 */
export async function assertNoBlockingUiError(client) {
  const state = await evaluate(
    client,
    `(() => {
      const bodyText = document.body?.innerText ?? "";
      const overlay = document.querySelector('vite-error-overlay, [data-vite-error-overlay], .vite-error-overlay');
      const blockingText = ["[plugin:vite", "Unexpected token", "Internal Server Error"].find((text) => bodyText.includes(text));
      return { overlay: Boolean(overlay), blockingText: blockingText ?? null };
    })()`,
  );
  const runtimeErrors = client.runtimeErrors ?? [];
  if (state?.overlay || state?.blockingText || runtimeErrors.length > 0) {
    throw new Error(
      `Blocking frontend error detected: ${JSON.stringify({ ...state, runtimeErrors })}`,
    );
  }
}

/** 等待指定 pane 的真实 xterm DOM 行包含完整 stdout marker。 */
export async function waitForUiMarker(client, paneId, marker, timeoutMs) {
  const selector = `[data-testid="${paneId}"] .xterm-rows`;
  await waitForExpression(
    client,
    `Boolean(document.querySelector(${JSON.stringify(selector)})?.textContent?.includes(${JSON.stringify(marker)}))`,
    timeoutMs,
  );
}

/** 验证真实 xterm 保留不会出现在 stdout 中的输入语法片段。 */
export async function waitForUiCommand(client, paneId, command, timeoutMs) {
  const selector = `[data-testid="${paneId}"] .xterm-rows`;
  const probes = command.startsWith("Write-Output")
    ? [" + '", "Write-Output"]
    : command.startsWith("printf")
      ? ["printf ", "'%s\\n'"]
      : ["echo "];
  await waitForExpression(
    client,
    `(${JSON.stringify(probes)}).some((probe) => document.querySelector(${JSON.stringify(selector)})?.textContent?.includes(probe))`,
    timeoutMs,
  );
}

/** 将指定本地 Tab 置为当前项，供 UI 目标提示与跨 Tab 写入验收。 */
export async function activateTab(client, tabId, timeoutMs) {
  await evaluate(
    client,
    `(() => {
      const tab = document.querySelector(${JSON.stringify(`[data-testid="${tabId}"]`)});
      if (!tab) throw new Error("Missing terminal tab");
      tab.click();
      return true;
    })()`,
  );
  await waitForExpression(
    client,
    `Boolean(document.querySelector(${JSON.stringify(`[data-testid="${tabId}"]`)}))`,
    timeoutMs,
  );
}

/** 打开真实 Agent Launcher，确认简化后的单一进入按钮和当前目标提示可见。 */
export async function openAgentLauncherForScreenshot(client, timeoutMs) {
  const visible = await evaluate(
    client,
    `Boolean(document.querySelector('[data-testid="agent-launcher-content"]:not([aria-hidden="true"])'))`,
  );
  if (!visible) {
    await evaluate(
      client,
      `(() => {
        const button = document.querySelector('[aria-label="打开 Agent Launcher"]');
        if (!button) throw new Error("Missing Agent Launcher button");
        button.click();
        return true;
      })()`,
    );
  }
  await waitForExpression(
    client,
    `Boolean(document.querySelector('[data-testid="agent-launcher-content"]:not([aria-hidden="true"])')) && Boolean(document.querySelector('[data-testid="agent-current-target"]'))`,
    timeoutMs,
  );
  const state = await evaluate(
    client,
    `(() => ({
      currentTarget: document.querySelector('[data-testid="agent-current-target"]')?.textContent?.trim() ?? "",
      newButton: document.querySelector('[aria-label="使用 Codex 进入"]')?.textContent?.trim() ?? "",
      launcherVisible: document.querySelector('[data-testid="agent-launcher-content"]:not([aria-hidden="true"])') !== null,
    }))()`,
  );
  if (!state?.launcherVisible || !state.currentTarget.includes("当前目标")) {
    throw new Error(`Agent Launcher current target hint is missing: ${JSON.stringify(state)}`);
  }
  if (!state.newButton) {
    throw new Error("Agent Launcher single new-session button is missing");
  }
  return state;
}

/** 打开设置外观页，并等待项目真实 settings store 已挂载。 */
async function openAppearanceSettings(client, timeoutMs) {
  await evaluate(
    client,
    `(() => {
      const button = document.querySelector('[aria-label="打开设置"]');
      if (!button) throw new Error("Missing settings button");
      button.click();
      return true;
    })()`,
  );
  await waitForExpression(
    client,
    "Boolean(document.querySelector('#settings-appearance-panel'))",
    timeoutMs,
  );
}

/** 通过真实设置 UI 修改主题，并等待 useDocumentTheme 投影到 document 根。 */
async function selectThemeViaSettings(client, mode, timeoutMs) {
  const labels = { dark: "深色", light: "浅色", system: "跟随系统" };
  await openAppearanceSettings(client, timeoutMs);
  await evaluate(
    client,
    `(() => {
      const button = Array.from(document.querySelectorAll('#settings-appearance-panel button'))
        .find((candidate) => candidate.textContent?.includes(${JSON.stringify(labels[mode])}));
      if (!button) throw new Error("Missing theme option: ${mode}");
      button.click();
      return true;
    })()`,
  );
  const expectedTheme =
    mode === "system"
      ? await evaluate(
          client,
          "window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'",
        )
      : mode;
  await waitForExpression(
    client,
    `document.documentElement.getAttribute('data-theme') === ${JSON.stringify(expectedTheme)}`,
    timeoutMs,
  );
  await evaluate(
    client,
    `document.querySelector('[aria-label="关闭弹窗"]')?.click() ?? true`,
  );
  await waitForExpression(
    client,
    "document.querySelector('#settings-appearance-panel') === null",
    timeoutMs,
  );
  return expectedTheme;
}

/** 经真实 settings store 切换三主题并截图，system 由 CDP media emulation 驱动。 */
export async function captureThemeScreenshots(
  client,
  artifactDir,
  skipThemes,
  timeoutMs,
) {
  if (skipThemes) {
    return { skipped: "--skip-themes" };
  }
  const available = await evaluate(
    client,
    `Boolean(document.body && document.querySelector(${JSON.stringify('[aria-label="终端工作区"]')}))`,
  );
  if (!available) {
    return { skipped: "Tauri UI surface unavailable" };
  }
  const originalSettings = await invokeTauri(client, "settings_get");
  const originalMode = ["light", "dark", "system"].includes(
    originalSettings?.themeMode,
  )
    ? originalSettings.themeMode
    : "dark";
  const screenshots = {};
  try {
    for (const mode of ["light", "dark", "system"]) {
      if (mode === "system") {
        await client.send("Emulation.setEmulatedMedia", {
          features: [{ name: "prefers-color-scheme", value: "dark" }],
        });
      } else {
        await client.send("Emulation.setEmulatedMedia", { features: [] });
      }
      await selectThemeViaSettings(client, mode, timeoutMs);
      await openAgentLauncherForScreenshot(client, timeoutMs);
      await assertNoBlockingUiError(client);
      const outputPath = path.join(artifactDir, `theme-${mode}.png`);
      screenshots[mode] = await captureScreenshot(client, outputPath);
    }
  } finally {
    await client.send("Emulation.setEmulatedMedia", { features: [] });
    await selectThemeViaSettings(client, originalMode, timeoutMs).catch(
      () => undefined,
    );
  }
  return screenshots;
}

/** 捕获真实 WebView surface 的 PNG 到临时 artifact 根。 */
async function captureScreenshot(client, outputPath) {
  const screenshot = await client.send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
  });
  await writeFile(outputPath, Buffer.from(screenshot.data, "base64"));
  return outputPath;
}
