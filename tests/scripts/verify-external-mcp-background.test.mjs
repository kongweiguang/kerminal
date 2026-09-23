// @author kongweiguang

import assert from "node:assert/strict";
import test from "node:test";

import {
  assertExternalMcpBackgroundPolicy,
  assertStableUiSurface,
  stableUiProjection,
} from "../../scripts/verify-external-mcp-background.mjs";

const BACKGROUND_POLICY_TEXT =
  "External MCP calls default to background execution: use ssh.command for non-interactive SSH commands. For a persistent or interactive shell call terminal.create; terminal.create is headless and does not open a UI Tab. Only when the user explicitly asks to operate a specific visible UI Tab should the target be discovered and confirmed. A background failure must not fall back to a visible terminal. The built-in right-panel Agent/session-terminal flow retains global scope and targetBinding as its preferred target; ordinary Tab changes do not rebind it.";

/** 缺失或失效的活动身份必须失败，避免 DOM 观测缺陷给后台不切 Tab 门禁制造假通过。 */
test("rejects missing or invalid active identities for nonempty tabs", () => {
  for (const activeTabId of [null, undefined, "missing-tab"]) {
    const surface = { activeTabId, tabIds: ["fixture-tab"] };
    assert.throws(() => assertStableUiSurface(surface, surface), /no valid active Tab/);
  }
  assert.doesNotThrow(() => assertStableUiSurface({ tabIds: [] }, { tabIds: [] }));
});

/** 验证纯语义门禁能同时锁定 initialize 文案和发现/操作指南策略。 */
test("accepts the external MCP background policy across initialize and guides", () => {
  const guide = { text: BACKGROUND_POLICY_TEXT };
  const facts = assertExternalMcpBackgroundPolicy({
    appGuide: guide,
    capabilities: guide,
    initializeResult: { instructions: BACKGROUND_POLICY_TEXT },
    operationSsh: guide,
    operationTerminal: guide,
    runtimeSnapshot: guide,
    toolHelp: guide,
  });

  assert.equal(facts.initializationDefaultBackground, true);
  assert.equal(facts.guideHeadlessPty, true);
  assert.equal(facts.guideNoFallback, true);
});

/** 验证旧的“可见 PTY 优先”握手不会被误判为新外部 MCP 默认策略。 */
test("rejects an initialize result without the explicit background contract", () => {
  const visibleFirst =
    "Use the current visible PTY for ordinary commands; use ssh.command only as a fallback.";
  assert.throws(
    () =>
      assertExternalMcpBackgroundPolicy({
        appGuide: { text: visibleFirst },
        capabilities: { text: visibleFirst },
        initializeResult: { instructions: visibleFirst },
        operationSsh: { text: visibleFirst },
        operationTerminal: { text: visibleFirst },
        runtimeSnapshot: { text: visibleFirst },
        toolHelp: { text: visibleFirst },
      }),
    /External MCP background policy missing/,
  );
});

/** 验证后台 MCP 调用只能保持既有 Tab 顺序与活动目标，不能静默切换 UI。 */
test("compares visible Tab ids and active id as one stable projection", () => {
  const before = { activeTabId: "tab-local-b", tabIds: ["tab-local-a", "tab-local-b"] };
  const unchanged = { activeTabId: "tab-local-b", tabIds: ["tab-local-a", "tab-local-b"] };
  assert.deepEqual(stableUiProjection(before), stableUiProjection(unchanged));
  assert.doesNotThrow(() => assertStableUiSurface(before, unchanged));
  assert.throws(
    () =>
      assertStableUiSurface(before, {
        activeTabId: "tab-local-a",
        tabIds: ["tab-local-a", "tab-local-b"],
      }),
    /changed visible UI tabs/,
  );
});
