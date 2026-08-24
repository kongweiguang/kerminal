// @author kongweiguang

import {
  clickSelector,
  clickExpression,
  clickTextButtonContaining,
  contextClickExpression,
  delay,
  pressKey,
  waitForBrowserExpression,
} from "./helpers.mjs";

export const captures = [
  { name: "kerminal-agent-session.png", setup: captureAgentSessionRestore },
  { name: "kerminal-hero.png", setup: captureHero },
  { name: "kerminal-context.png", setup: captureContextWorkspace },
  { name: "kerminal-connect.png", setup: captureConnectDialog },
  { name: "kerminal-external-launch.png", setup: captureExternalLaunch },
  { name: "kerminal-settings.png", setup: captureSettings },
  { name: "kerminal-docker.png", setup: captureDockerDialog },
  { name: "kerminal-system.png", setup: captureServerInfo },
  { name: "kerminal-resources.png", setup: captureServerResources },
  { name: "kerminal-agent.png", setup: captureAgentLauncher },
  { name: "kerminal-tool-rail.png", setup: captureToolRailCustomization },
  { name: "kerminal-tmux.png", setup: captureTmux },
  { name: "kerminal-ports.png", setup: capturePorts },
  { name: "kerminal-sftp.png", setup: captureSftp },
  { name: "kerminal-file-tab.png", setup: captureWorkspaceFileTab },
];

async function captureHero(client) {
  await waitForBrowserExpression(
    client,
    `document.querySelector('[aria-label="prod-api xterm 终端"]') !== null && document.querySelector('[data-testid="agent-restore-target-chip"]') !== null`,
    120_000,
  );
  await clickTextButtonContaining(client, "继续上次");
  await waitForBrowserExpression(
    client,
    `document.querySelector('[data-testid="agent-terminal-command"]') !== null && document.body.innerText.includes("OpenAI Codex") && document.body.innerText.includes("gpt-5.6-sol xhigh") && document.body.innerText.includes("MCP: kerminal ready") && !document.body.innerText.includes("MCP: kerminal starting")`,
    30_000,
  );
  await delay(2_000);
}

async function captureContextWorkspace(client) {
  await clickSelector(client, `[aria-label="打开 当前上下文"]`);
  await waitForBrowserExpression(
    client,
    `document.querySelector('[aria-label="当前上下文摘要"]') !== null && document.body.innerText.includes("当前目录") && document.body.innerText.includes("Agent")`,
    30_000,
  );
}

/** 通过新版 Agent 选择器的主动作进入恢复提示，验证截图不再依赖旧双按钮入口。 */
async function captureAgentSessionRestore(client) {
  await waitForBrowserExpression(
    client,
    `document.querySelector('[aria-label="prod-api xterm 终端"]') !== null`,
    120_000,
  );
  await clickSelector(client, `[aria-label="打开 Agent Launcher"]`);
  await waitForBrowserExpression(
    client,
    `document.querySelector('[aria-label="选择 Agent"]') !== null && document.querySelector('[aria-label="使用 Codex 进入"]') !== null`,
    30_000,
  );
  await clickSelector(client, `[aria-label="使用 Codex 进入"]`);
  await waitForBrowserExpression(
    client,
    `document.querySelector('[data-testid="agent-restore-target-chip"]') !== null && document.body.innerText.includes("继续上次")`,
    30_000,
  );
}

async function captureConnectDialog(client) {
  await clickSelector(client, `[aria-label="添加连接"]`);
  await waitForBrowserExpression(
    client,
    `document.body.innerText.includes("添加连接") || document.body.innerText.includes("连接")`,
    20_000,
  );
}

async function captureExternalLaunch(client) {
  await pressKey(client, "Escape");
  await clickSelector(client, `[aria-label="打开设置"]`);
  await waitForBrowserExpression(
    client,
    `document.querySelector('[aria-controls="settings-external-launch-panel"]') !== null`,
    20_000,
  );
  await clickSelector(client, `[aria-controls="settings-external-launch-panel"]`);
  await waitForBrowserExpression(
    client,
    `document.querySelector("#settings-external-launch-panel") !== null && document.body.innerText.includes("启用外部 SSH 启动")`,
    20_000,
  );
}

async function captureDockerDialog(client) {
  await pressKey(client, "Escape");
  await waitForBrowserExpression(
    client,
    `!document.body.innerText.includes("新建主机")`,
    10_000,
  );
  await contextClickExpression(
    client,
    `Array.from(document.querySelectorAll('[aria-label="主机侧边栏"] button')).find((button) => button.textContent?.includes("prod-api"))`,
  );
  await waitForBrowserExpression(
    client,
    `document.querySelector('[aria-label="主机操作菜单"]') !== null && document.body.innerText.includes("容器")`,
    10_000,
  );
  await clickTextButtonContaining(client, "容器");
  await waitForBrowserExpression(
    client,
    `document.body.innerText.includes("kerminal-stack") && document.querySelector('[aria-label^="打开 Compose YAML"]') !== null`,
    20_000,
  );
}

async function captureServerInfo(client) {
  await pressKey(client, "Escape");
  await waitForBrowserExpression(
    client,
    `!document.body.innerText.includes("kerminal/api:latest")`,
    10_000,
  );
  await clickSelector(client, `[aria-label="打开 系统"]`);
  await waitForBrowserExpression(
    client,
    `document.querySelector('[aria-label="系统信息视图"]') !== null && document.body.innerText.includes("概览") && document.body.innerText.includes("资源") && document.body.innerText.includes("进程")`,
    30_000,
  );
}

/** 切换资源视图并等待 GPU/NPU 两类加速卡，避免只凭能力文案宣称硬件监控。 */
async function captureServerResources(client) {
  await clickExpression(
    client,
    `Array.from(document.querySelectorAll('[aria-label="系统信息视图"] [role="tab"]')).find((tab) => tab.textContent?.includes("资源"))`,
  );
  await waitForBrowserExpression(
    client,
    `document.body.innerText.includes("NVIDIA RTX 4090") && document.body.innerText.includes("Ascend 910B4") && document.body.innerText.includes("NPU 2")`,
    20_000,
  );
}

/** 展开当前 Agent 选择器，直接展示 Codex、Claude、PI 与持久化自定义启动器。 */
async function captureAgentLauncher(client) {
  await clickExpression(
    client,
    `Array.from(document.querySelectorAll('[aria-label="左栏视图"] button')).find((button) => button.textContent?.includes("主机"))`,
  );
  await waitForBrowserExpression(
    client,
    `Array.from(document.querySelectorAll('[aria-label="主机侧边栏"] button')).some((button) => button.textContent?.includes("prod-api"))`,
    10_000,
  );
  await clickSelector(client, `[aria-label="打开 Agent Launcher"]`);
  await waitForBrowserExpression(
    client,
    `document.querySelector('[aria-label="Back to agent launcher"]') !== null`,
    30_000,
  );
  await clickSelector(client, `[aria-label="Back to agent launcher"]`);
  await waitForBrowserExpression(
    client,
    `document.querySelector('[aria-label="选择 Agent"]') !== null && document.querySelector('[aria-label="对话范围"]') !== null`,
    30_000,
  );
  await clickSelector(client, `[aria-label="选择 Agent"]`);
  await waitForBrowserExpression(
    client,
    `document.body.innerText.includes("Codex") && document.body.innerText.includes("Claude") && document.body.innerText.includes("PI Agent") && document.body.innerText.includes("Qwen Code") && document.body.innerText.includes("添加自定义 Agent")`,
    20_000,
  );
}

/** 右击真实工具栏入口打开编辑器，展示显示、排序、固定和四种面板位置。 */
async function captureToolRailCustomization(client) {
  await pressKey(client, "Escape");
  await contextClickExpression(
    client,
    `document.querySelector('[aria-label="工具栏"]')`,
  );
  await waitForBrowserExpression(
    client,
    `document.body.innerText.includes("自定义工具栏") && document.body.innerText.includes("贴靠右栏") && document.body.innerText.includes("底部固定区")`,
    20_000,
  );
  await clickSelector(client, `[aria-label="打开位置 Agent Launcher"]`);
  await waitForBrowserExpression(
    client,
    `document.body.innerText.includes("左侧栏") && document.body.innerText.includes("底部面板") && document.body.innerText.includes("自由浮窗")`,
    10_000,
  );
}

/** 关闭上一个模态编辑器后打开 tmux，确保场景之间不共享遮罩或焦点。 */
async function captureTmux(client) {
  await pressKey(client, "Escape");
  await delay(100);
  await pressKey(client, "Escape");
  await waitForBrowserExpression(
    client,
    `!document.body.innerText.includes("自定义工具栏")`,
    10_000,
  );
  await clickSelector(client, `[aria-label="打开 tmux"]`);
  await waitForBrowserExpression(
    client,
    `document.body.innerText.includes("release-watch") && document.querySelector('[aria-label="展开快捷命令"]') !== null`,
    30_000,
  );
}

/** 打开新建隧道编排器，直接呈现当前 -L、-R 与 SOCKS 三种生产入口。 */
async function capturePorts(client) {
  await clickSelector(client, `[aria-label="打开 端口"]`);
  await waitForBrowserExpression(
    client,
    `document.querySelector('[aria-label="添加隧道"]') !== null`,
    30_000,
  );
  await clickSelector(client, `[aria-label="添加隧道"]`);
  await waitForBrowserExpression(
    client,
    `document.body.innerText.includes("添加 SSH 隧道") && document.body.innerText.includes("访问主机服务") && document.body.innerText.includes("暴露本机服务") && document.body.innerText.includes("SOCKS / 高级")`,
    20_000,
  );
}

async function captureSftp(client) {
  await pressKey(client, "Escape");
  await clickExpression(
    client,
    `Array.from(document.querySelectorAll('[aria-label="左栏视图"] button')).find((button) => button.textContent?.includes("主机"))`,
  );
  await waitForBrowserExpression(
    client,
    `Array.from(document.querySelectorAll('[aria-label="主机侧边栏"] button')).some((button) => button.textContent?.includes("prod-api"))`,
    10_000,
  );
  await contextClickExpression(
    client,
    `Array.from(document.querySelectorAll('[aria-label="主机侧边栏"] button')).find((button) => button.textContent?.includes("prod-api"))`,
  );
  await waitForBrowserExpression(
    client,
    `document.querySelector('[aria-label="主机操作菜单"]') !== null && document.body.innerText.includes("新建传输 Tab")`,
    10_000,
  );
  await clickTextButtonContaining(client, "新建传输 Tab");
  await waitForBrowserExpression(
    client,
    `document.querySelector('[aria-label="SFTP 传输工作台"]') !== null && document.body.innerText.includes("release-2026-06-23.tar.gz")`,
    30_000,
  );
}

async function captureSettings(client) {
  await pressKey(client, "Escape");
  await clickSelector(client, `[aria-label="打开设置"]`);
  await delay(2_000);
  await clickSelector(client, `[aria-controls="settings-terminal-panel"]`);
  await delay(1_000);
}

async function captureWorkspaceFileTab(client) {
  const workspaceFileSession = {
    activeTabId: "tab-env-file",
    focusedPaneId: "pane-prod-api",
    removedSidebarMachineIds: [],
    selectedMachineId: "prod-api",
    sidebarMachines: [],
    terminalPanes: [
      {
        currentCwd: "/srv/kerminal",
        cwd: "/srv/kerminal",
        id: "pane-prod-api",
        lines: [],
        machineId: "prod-api",
        mode: "ssh",
        outputHistory:
          "deploy@prod-api:/srv/kerminal$ docker ps --format 'table {{.Names}}\\t{{.Status}}'\\r\\nNAMES        STATUS\\r\\napi          Up 12 minutes\\r\\nworker       Up 8 minutes\\r\\n",
        prompt: "deploy@prod-api:/srv/kerminal$",
        remoteHostId: "prod-api",
        remoteHostProduction: false,
        status: "online",
        target: { hostId: "prod-api", kind: "ssh" },
        title: "prod-api",
      },
    ],
    terminalTabs: [
      {
        id: "tab-prod-api",
        layout: { paneId: "pane-prod-api", type: "pane" },
        machineId: "prod-api",
        title: "prod-api",
      },
      {
        access: "editable",
        id: "tab-env-file",
        kind: "workspaceFile",
        machineId: "prod-api",
        path: "/srv/kerminal/.env",
        rootPath: "/srv/kerminal",
        source: "sftp",
        target: { hostId: "prod-api", kind: "ssh" },
        title: ".env",
      },
    ],
    version: 1,
  };
  await client.send("Runtime.evaluate", {
    expression: `localStorage.setItem("kerminal.readme.capture.session.override", ${JSON.stringify(JSON.stringify(workspaceFileSession))})`,
  });
  await client.send("Page.reload", { ignoreCache: true });
  await waitForBrowserExpression(
    client,
    `document.querySelector('[data-testid="workspace-file-tab-surface"]') !== null && document.body.innerText.includes("KERMINAL_MODE=production")`,
    60_000,
  );
}
