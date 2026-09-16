// @author kongweiguang

import assert from "node:assert/strict";
import test from "node:test";

import {
  assertSafeConfigRoot,
  extractToolPayload,
  markerCommand,
  parseArgs,
  parseSseEvents,
} from "../../scripts/verify-agent-global-terminal.mjs";

/** 验证 CLI 参数可以覆盖 CDP/config/artifact 隔离边界，并保留主题跳过开关。 */
test("parseArgs accepts isolated runtime options", () => {
  const parsed = parseArgs(
    [
      "--cdp-port",
      "9444",
      "--config-root",
      "C:/temp/kerminal-agent",
      "--artifact-root=C:/temp/artifacts",
      "--timeout-ms=5000",
      "--skip-themes",
    ],
    {},
  );
  assert.equal(parsed.cdpPort, 9444);
  assert.equal(parsed.configRoot, "C:\\temp\\kerminal-agent");
  assert.equal(parsed.artifactRoot, "C:\\temp\\artifacts");
  assert.equal(parsed.timeoutMs, 5000);
  assert.equal(parsed.skipThemes, true);
});

/** 验证 MCP SSE 心跳不会遮蔽 JSON-RPC initialize/tools 响应。 */
test("parseSseEvents ignores heartbeat and parses JSON data", () => {
  const events = parseSseEvents(
    "data: \n\nid: 0\nretry: 3000\n\ndata: {\"jsonrpc\":\"2.0\",\"id\":1}\n\n",
  );
  assert.deepEqual(events, [{ jsonrpc: "2.0", id: 1 }]);
});

/** 验证 MCP 成功和错误响应都按 structuredContent.data/summary 语义解包。 */
test("extractToolPayload unwraps data and reports tool errors", () => {
  assert.deepEqual(
    extractToolPayload({
      result: {
        structuredContent: { data: { sessionCount: 2 }, summary: "ok" },
      },
    }),
    { sessionCount: 2 },
  );
  assert.throws(
    () =>
      extractToolPayload({
        result: {
          isError: true,
          structuredContent: { error: "scope mismatch", summary: "failed" },
        },
      }),
    /scope mismatch/,
  );
});

/** 验证 marker 命令只保留拆分片段，完整值只能由真实 shell 输出产生。 */
test("markerCommand keeps the expected stdout marker out of input echo", () => {
  const marker = "KERM_AGENT_GLOBAL_VERIFY_A_ABC123";
  for (const shell of ["pwsh.exe", "cmd.exe", "/bin/bash"]) {
    assert.equal(markerCommand(shell, marker).includes(marker), false);
  }
});

/** 验证脚本默认拒绝用户根目录，但允许显式隔离目录。 */
test("assertSafeConfigRoot protects user roots", () => {
  assert.throws(
    () =>
      assertSafeConfigRoot("C:/Users/test/.kerminal", {
        USERPROFILE: "C:/Users/test",
        LOCALAPPDATA: "C:/Users/test/AppData/Local",
      }),
    /Refusing to mutate/,
  );
  assert.equal(
    assertSafeConfigRoot("C:/temp/kerminal-agent", {
      USERPROFILE: "C:/Users/test",
      LOCALAPPDATA: "C:/Users/test/AppData/Local",
    }),
    "c:/temp/kerminal-agent",
  );
});
