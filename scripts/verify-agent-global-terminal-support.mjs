// @author kongweiguang

import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const DEFAULT_CDP_PORT = 9337;
export const DEFAULT_TIMEOUT_MS = 120_000;
export const DEFAULT_MCP_REQUEST_TIMEOUT_MS = 30_000;
export const DEFAULT_SNAPSHOT_BYTES = 24 * 1024;
export const DEFAULT_ARTIFACT_ROOT = path.join(
  os.tmpdir(),
  "kerminal-agent-global-terminal",
);

/** 解析验收参数，并把环境变量仅作为可覆盖的默认值。 */
export function parseArgs(argv = process.argv.slice(2), env = process.env) {
  const values = {
    artifactRoot:
      env.KERMINAL_AGENT_VERIFY_ARTIFACT_ROOT ?? DEFAULT_ARTIFACT_ROOT,
    cdpPort: parsePort(
      env.KERMINAL_CDP_PORT ?? DEFAULT_CDP_PORT,
      "KERMINAL_CDP_PORT",
    ),
    configRoot: env.KERMINAL_CONFIG_ROOT ?? null,
    skipThemes: false,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      values.help = true;
      continue;
    }
    if (argument === "--skip-themes") {
      values.skipThemes = true;
      continue;
    }
    const [name, inlineValue] = argument.split("=", 2);
    if (
      ![
        "--port",
        "--cdp-port",
        "--config-root",
        "--artifact-root",
        "--timeout-ms",
      ].includes(name)
    ) {
      throw new Error(`Unknown argument: ${argument}`);
    }
    const value = inlineValue ?? argv[++index];
    if (!value || value.startsWith("--")) {
      throw new Error(`${name} requires a value`);
    }
    if (name === "--port" || name === "--cdp-port") {
      values.cdpPort = parsePort(value, name);
    } else if (name === "--config-root") {
      values.configRoot = path.resolve(value);
    } else if (name === "--artifact-root") {
      values.artifactRoot = path.resolve(value);
    } else {
      values.timeoutMs = parsePositiveInteger(value, name);
    }
  }

  if (values.configRoot) {
    values.configRoot = path.resolve(values.configRoot);
  }
  values.artifactRoot = path.resolve(values.artifactRoot);
  return values;
}

/** 解析并校验 TCP 端口，避免无效值进入 CDP/MCP 请求。 */
function parsePort(value, label) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${label} must be an integer between 1 and 65535`);
  }
  return port;
}

/** 解析正整数超时，避免轮询因零值或负数忙循环。 */
function parsePositiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
  return parsed;
}

/** 把 Streamable HTTP 的 SSE 响应还原为 JSON-RPC 事件，忽略心跳块。 */
export function parseSseEvents(body) {
  const events = [];
  let dataLines = [];
  const flush = () => {
    if (dataLines.length === 0) {
      return;
    }
    const data = dataLines.join("\n").trim();
    dataLines = [];
    if (!data) {
      return;
    }
    try {
      events.push(JSON.parse(data));
    } catch {
      events.push(data);
    }
  };
  for (const line of String(body).split(/\r?\n/)) {
    if (line === "") {
      flush();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trimStart());
    }
  }
  flush();
  return events;
}

/** 解包 Kerminal MCP tool 的 structuredContent，并保留真实失败原因。 */
export function extractToolPayload(rpcResponse) {
  const result = rpcResponse?.result ?? rpcResponse;
  const structured = result?.structuredContent;
  const textPayload = (result?.content ?? [])
    .filter((item) => item?.type === "text")
    .map((item) => item.text)
    .map((text) => {
      try {
        return JSON.parse(text);
      } catch {
        return undefined;
      }
    })
    .find(Boolean);
  const wrapper = structured ?? textPayload ?? {};
  const error = wrapper?.error ?? (result?.isError ? wrapper?.summary : undefined);
  if (result?.isError || error) {
    throw new Error(String(error ?? wrapper?.summary ?? "MCP tool failed"));
  }
  return wrapper?.data ?? wrapper;
}

/** 只允许在隔离根运行，避免验收脚本修改用户 ~/.kerminal。 */
export function assertSafeConfigRoot(configRoot, env = process.env) {
  const actual = normalizePath(configRoot);
  if (!actual) {
    throw new Error("The running app did not expose a config root");
  }
  const protectedRoots = [
    env.USERPROFILE ? path.join(env.USERPROFILE, ".kerminal") : null,
    env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, "kerminal") : null,
  ]
    .map(normalizePath)
    .filter(Boolean);
  if (protectedRoots.includes(actual)) {
    throw new Error(
      `Refusing to mutate the user Kerminal config root: ${configRoot}. Pass --config-root to an isolated root.`,
    );
  }
  return actual;
}

/** 将 Windows/Unix 路径归一化为安全比较形式，不改变实际文件路径。 */
export function normalizePath(value) {
  if (!value) {
    return null;
  }
  return path.resolve(String(value)).replaceAll("\\", "/").toLowerCase();
}

/** 读取 Agent session 生成的全部 context JSON，验证文件均可解析。 */
export async function readContextFiles(record) {
  const context = record?.paths?.context;
  if (!context) {
    throw new Error("Agent session record did not include context paths");
  }
  const entries = await Promise.all(
    Object.entries(context).map(async ([name, filePath]) => {
      const contents = await readFile(filePath, "utf8");
      return [name, JSON.parse(contents)];
    }),
  );
  return Object.fromEntries(entries);
}

/** 根据 shell 类型生成只产生 stdout 的拆分 marker 命令。 */
export function markerCommand(shell, marker) {
  const split = Math.max(1, Math.floor(marker.length / 2));
  const left = marker.slice(0, split);
  const right = marker.slice(split);
  const normalized = String(shell ?? "").toLowerCase();
  if (normalized.includes("cmd")) {
    return `echo ${left}^${right}\r`;
  }
  if (
    normalized.includes("bash") ||
    normalized.endsWith("/sh") ||
    normalized.endsWith("\\sh")
  ) {
    return `printf '%s\\n' '${left}''${right}'\r`;
  }
  return `Write-Output ('${left}' + '${right}')\r`;
}

/** 从 terminal.snapshot data 中提取脱敏终端输出。 */
export function snapshotText(data) {
  return String(data?.snapshot?.data ?? data?.data ?? "");
}

/** 轮询 MCP 快照，直到真实 PTY 回显完整 marker。 */
export async function waitForSnapshotMarker(
  mcp,
  sessionId,
  agentSessionId,
  marker,
  timeoutMs,
) {
  const startedAt = Date.now();
  let last = null;
  while (Date.now() - startedAt < timeoutMs) {
    last = await mcp.callTool("terminal.snapshot", {
      ...(agentSessionId ? { agentSessionId } : {}),
      maxBytes: DEFAULT_SNAPSHOT_BYTES,
      sessionId,
    });
    if (snapshotText(last.data).includes(marker)) {
      return last.data;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(
    `Timed out waiting for marker ${marker} in terminal ${sessionId}; last snapshot tail: ${snapshotText(last?.data).slice(-500)}`,
  );
}

/**
 * Streamable HTTP MCP client for Kerminal's real endpoint；仅实现本验收需要的
 * initialize/notification/tools.call，避免引入额外运行时依赖。
 */
export class KerminalMcpClient {
  /** 创建一个尚未初始化的 MCP client。 */
  constructor(endpoint, requestTimeoutMs = DEFAULT_MCP_REQUEST_TIMEOUT_MS) {
    this.endpoint = endpoint;
    this.requestTimeoutMs = requestTimeoutMs;
    this.nextRequestId = 1;
    this.sessionId = null;
  }

  /** 建立 MCP session，并确认协议版本可用。 */
  async initialize() {
    const response = await this.request("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: {
        name: "kerminal-agent-global-terminal-verifier",
        version: "1.0.0",
      },
    });
    if (!response?.result?.protocolVersion) {
      throw new Error("MCP initialize returned no protocolVersion");
    }
    await this.request("notifications/initialized", undefined, false);
    return response.result;
  }

  /** 调用 Kerminal MCP tool，返回解包后的 data 与原始响应。 */
  async callTool(name, argumentsValue = {}) {
    const response = await this.request("tools/call", {
      name,
      arguments: argumentsValue,
    });
    return { data: extractToolPayload(response), response };
  }

  /** 发送 JSON-RPC 请求并维护 Streamable HTTP session header。 */
  async request(method, params, expectPayload = true) {
    const headers = {
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
    };
    if (this.sessionId) {
      headers["Mcp-Session-Id"] = this.sessionId;
    }
    const body = { jsonrpc: "2.0", method };
    if (method !== "notifications/initialized") {
      body.id = this.nextRequestId;
      this.nextRequestId += 1;
    }
    if (params !== undefined) {
      body.params = params;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    let response;
    let text;
    try {
      response = await fetch(this.endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      text = await response.text();
    } catch (error) {
      throw new Error(`MCP ${method} request failed: ${String(error?.message ?? error)}`);
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) {
      throw new Error(`MCP ${method} HTTP ${response.status}: ${text.slice(0, 500)}`);
    }
    const sessionId = response.headers.get("mcp-session-id");
    if (sessionId) {
      this.sessionId = sessionId;
    }
    if (!expectPayload || !text.trim()) {
      return null;
    }
    const contentType = response.headers.get("content-type") ?? "";
    const events = contentType.includes("text/event-stream")
      ? parseSseEvents(text)
      : [JSON.parse(text)];
    const rpcResponse = events.findLast(
      (event) =>
        event && typeof event === "object" && ("result" in event || "error" in event),
    );
    if (!rpcResponse) {
      throw new Error(`MCP ${method} returned no JSON-RPC response`);
    }
    if (rpcResponse.error) {
      throw new Error(`MCP ${method} error: ${JSON.stringify(rpcResponse.error)}`);
    }
    return rpcResponse;
  }
}
