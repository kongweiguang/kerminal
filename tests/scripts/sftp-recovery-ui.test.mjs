// @author kongweiguang

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const verifier = path.join(repoRoot, "scripts", "verify-sftp-recovery-ui.mjs");

test("SFTP UI visual verifier exposes the real queue, themes, and interaction checks", () => {
  const source = readFileSync(verifier, "utf8");
  for (const required of [
    "SftpTransferQueueRow",
    '["system", "light"], ["system", "dark"]',
    "Emulation.setEmulatedMedia",
    "Input.dispatchKeyEvent",
    "document-horizontal-overflow",
    "idle-failed:recovery-action-count",
    "等待响应",
    "正在恢复连接",
    "正在取消",
    "网络连续 3 分钟无响应",
    "commit-unknown:unsafe-retry-action",
    "--output",
  ]) {
    assert.ok(source.includes(required), `missing verifier contract: ${required}`);
  }
});

test("SFTP UI visual verifier has a side-effect-free help mode", () => {
  const result = spawnSync(process.execPath, [verifier, "--help"], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(`${result.stdout}\n${result.stderr}`, /--output/);
  assert.match(`${result.stdout}\n${result.stderr}`, /headless Chrome/);
});
