// @author kongweiguang

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const verifier = path.join(repoRoot, "scripts", "check-eslint.mjs");
const baselinePath = "scripts/eslint-baseline.json";
const configPath = "eslint.config.mjs";

test("ESLint baseline 对同一规则按稳定消息计数并拒绝增长", (context) => {
  const fixture = createFixture(context);
  writeConfig(fixture);
  writeFile(fixture, "src/value.ts", "var first = 1;\nvoid first;");

  const bootstrap = runVerifier(fixture, ["--write-baseline"]);
  assert.equal(bootstrap.status, 0, bootstrap.output);
  const baseline = JSON.parse(
    fs.readFileSync(path.join(fixture, baselinePath), "utf8"),
  );
  assert.equal(baseline.entries.length, 1);
  assert.equal(baseline.entries[0].rule, "no-var");
  assert.equal(baseline.entries[0].count, 1);
  assert.ok(baseline.entries[0].owner);

  writeFile(
    fixture,
    "src/value.ts",
    "var first = 1;\nvar second = 2;\nvoid first;\nvoid second;",
  );
  const growth = runVerifier(fixture);
  assert.equal(growth.status, 1, growth.output);
  assert.match(growth.output, /New ESLint debt/);
  assert.match(growth.output, /0 -> 1|1 -> 2/);
});

test("ESLint 债务减少后要求同一变更收紧 baseline", (context) => {
  const fixture = createFixture(context);
  writeConfig(fixture);
  writeFile(fixture, "src/value.ts", "var value = 1;\nvoid value;");
  assert.equal(runVerifier(fixture, ["--write-baseline"]).status, 0);

  writeFile(fixture, "src/value.ts", "const value = 1;\nvoid value;");
  const result = runVerifier(fixture);

  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /Stale ESLint baseline/);
  assert.match(result.output, /0 -> 1/);
});

test("ESLint reference baseline 阻止登记新规则债务", (context) => {
  const fixture = createFixture(context);
  const reference = path.join(fixture, "reference.json");
  writeConfig(fixture);
  writeFile(fixture, "src/value.ts", "var value = 1;\nvoid value;");
  assert.equal(runVerifier(fixture, ["--write-baseline"]).status, 0);
  fs.writeFileSync(
    reference,
    `${JSON.stringify({ schemaVersion: 1, entries: [] }, null, 2)}\n`,
  );

  const result = runVerifier(fixture, ["--reference-baseline", reference]);

  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /ESLint baseline regressed/);
  assert.match(result.output, /new-baseline-debt/);
});

test("tag push 不把不可达的旧 tag 对象当作参考提交", (context) => {
  const fixture = createFixture(context);
  writeConfig(fixture);
  writeFile(fixture, "src/value.ts", "const value = 1;\nvoid value;");
  writeBaseline(fixture, []);
  const eventPath = path.join(fixture, "tag-push-event.json");
  fs.writeFileSync(
    eventPath,
    JSON.stringify({
      before: "e3c20577fddf3d102ff59f8f6f5a7742294b85e3",
    }),
  );

  const result = runVerifier(fixture, [], {
    GITHUB_ACTIONS: "true",
    GITHUB_EVENT_PATH: eventPath,
    GITHUB_REF_TYPE: "tag",
    GITHUB_WORKSPACE: fixture,
  });

  assert.equal(result.status, 0, result.output);
  assert.doesNotMatch(result.output, /reference commit is unavailable/);
});

test("ESLint 解析错误不可进入 baseline", (context) => {
  const fixture = createFixture(context);
  writeConfig(fixture);
  writeFile(fixture, "src/value.ts", "const = ;");
  writeBaseline(fixture, []);

  const result = runVerifier(fixture);

  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /Unbaselinable ESLint errors/);
  assert.match(result.output, /Parsing error/);
});

function createFixture(context) {
  const fixture = fs.mkdtempSync(
    path.join(os.tmpdir(), "kerminal-eslint-fixture-"),
  );
  context.after(() => fs.rmSync(fixture, { force: true, recursive: true }));
  return fixture;
}

function writeConfig(root) {
  writeFile(
    root,
    configPath,
    'export default [{ files: ["src/**/*.ts"], rules: { "no-var": "error" } }];',
  );
}

function writeBaseline(root, entries) {
  writeFile(
    root,
    baselinePath,
    JSON.stringify({ schemaVersion: 1, entries }, null, 2),
  );
}

function writeFile(root, relativePath, content) {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${content}\n`);
}

function runVerifier(root, args = [], environment = {}) {
  const result = spawnSync(
    process.execPath,
    [
      verifier,
      "--repo-root",
      root,
      "--baseline",
      baselinePath,
      "--config",
      configPath,
      ...args,
    ],
    { encoding: "utf8", env: { ...process.env, ...environment } },
  );
  return {
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
    status: result.status,
  };
}
