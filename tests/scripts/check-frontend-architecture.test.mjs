// @author kongweiguang

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const verifier = path.join(repoRoot, "scripts", "check-frontend-architecture.mjs");
const baselineRelativePath = "scripts/frontend-architecture-baseline.json";

test("允许 composition root 依赖 feature 公共入口且忽略 type-only 环", (context) => {
  const fixture = createFixture(context);
  writeSource(fixture, "src/app/shell.ts", 'import { value } from "../features/alpha";\nvoid value;');
  writeSource(fixture, "src/features/alpha/index.ts", 'export { value } from "./public";');
  writeSource(fixture, "src/features/alpha/public.ts", "export const value = 1;");
  writeSource(fixture, "src/lib/type-a.ts", 'import type { B } from "./type-b";\nexport type A = B;');
  writeSource(fixture, "src/lib/type-b.ts", 'export { type A } from "./type-a";\nexport type B = A;');
  writeBaseline(fixture, []);

  const result = runVerifier(fixture);

  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /Runtime cycles: 0/);
  assert.match(result.output, /Architecture debt: 0/);
});

test("拒绝任意生产运行时依赖环", (context) => {
  const fixture = createFixture(context);
  writeSource(fixture, "src/lib/a.ts", 'import { b } from "./b";\nexport const a = b;');
  writeSource(fixture, "src/lib/b.ts", 'import { a } from "./a";\nexport const b = a;');
  writeBaseline(fixture, []);

  const result = runVerifier(fixture);

  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /Runtime dependency cycles/);
  assert.match(result.output, /src\/lib\/a\.ts -> src\/lib\/b\.ts -> src\/lib\/a\.ts/);
});

test("逐类识别跨层、跨 feature 私有入口、平台直连和测试支持依赖", (context) => {
  const fixture = createFixture(context);
  writeViolatingFixture(fixture);
  writeBaseline(fixture, []);

  const result = runVerifier(fixture);

  assert.equal(result.status, 1, result.output);
  for (const rule of [
    "feature-to-app",
    "lib-to-feature",
    "cross-feature-private-import",
    "tauri-outside-adapter",
    "production-test-support-import",
  ]) {
    assert.match(result.output, new RegExp(rule));
  }
  assert.doesNotMatch(result.output, /terminalApi\.ts.*tauri-outside-adapter/);
});

test("存量债务必须与 baseline 精确一致且新增和减少都要求同步", (context) => {
  const fixture = createFixture(context);
  writeViolatingFixture(fixture);

  const bootstrap = runVerifier(fixture, ["--write-baseline"]);
  assert.equal(bootstrap.status, 0, bootstrap.output);
  const baselinePath = path.join(fixture, baselineRelativePath);
  const bootstrapped = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
  assert.deepEqual(
    new Set(bootstrapped.entries.map((entry) => entry.rule)),
    new Set([
      "feature-to-app",
      "lib-to-feature",
      "cross-feature-private-import",
      "tauri-outside-adapter",
      "production-test-support-import",
    ]),
  );
  assert.ok(
    bootstrapped.entries.every(
      (entry) => entry.owner && entry.targetTask && entry.deadline,
    ),
  );

  writeSource(
    fixture,
    "src/features/beta/extra.ts",
    'import { shell } from "../../app/shell";\nvoid shell;',
  );
  const growth = runVerifier(fixture);
  assert.equal(growth.status, 1, growth.output);
  assert.match(growth.output, /New architecture debt/);
  assert.match(growth.output, /src\/features\/beta\/extra\.ts/);

  fs.rmSync(path.join(fixture, "src/features/beta/extra.ts"));
  fs.rmSync(path.join(fixture, "src/features/alpha/view.ts"));
  const reduction = runVerifier(fixture);
  assert.equal(reduction.status, 1, reduction.output);
  assert.match(reduction.output, /Stale architecture baseline/);
});

test("reference baseline 阻止在当前分支登记新债务", (context) => {
  const fixture = createFixture(context);
  const referencePath = path.join(fixture, "reference.json");
  writeViolatingFixture(fixture);
  const bootstrap = runVerifier(fixture, ["--write-baseline"]);
  assert.equal(bootstrap.status, 0, bootstrap.output);
  fs.writeFileSync(referencePath, `${JSON.stringify(baseline([]), null, 2)}\n`);

  const result = runVerifier(fixture, ["--reference-baseline", referencePath]);

  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /Architecture baseline regressed/);
  assert.match(result.output, /new-baseline-debt/);
});

test("tag push 不把不可达的旧 tag 对象当作参考提交", (context) => {
  const fixture = createFixture(context);
  writeSource(fixture, "src/app/shell.ts", "export const shell = true;");
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

function createFixture(context) {
  const fixture = fs.mkdtempSync(
    path.join(os.tmpdir(), "kerminal-frontend-architecture-fixture-"),
  );
  context.after(() => fs.rmSync(fixture, { force: true, recursive: true }));
  return fixture;
}

function writeViolatingFixture(root) {
  writeSource(root, "src/app/shell.ts", "export const shell = true;");
  writeSource(root, "src/features/alpha/index.ts", 'export { value } from "./private";');
  writeSource(root, "src/features/alpha/private.ts", "export const value = 1;");
  writeSource(
    root,
    "src/features/alpha/view.ts",
    'import { shell } from "../../app/shell";\nvoid shell;',
  );
  writeSource(
    root,
    "src/lib/bad-bridge.ts",
    'import { value } from "../features/alpha";\nvoid value;',
  );
  writeSource(
    root,
    "src/features/beta/view.ts",
    'import { value } from "../alpha/private";\nvoid value;',
  );
  writeSource(
    root,
    "src/features/beta/desktop.ts",
    'import { isTauri } from "@tauri-apps/api/core";\nvoid isTauri;',
  );
  writeSource(
    root,
    "src/features/beta/test-leak.ts",
    'import { fake } from "../../test-support/fake";\nvoid fake;',
  );
  writeSource(
    root,
    "src/test-support/fake.ts",
    "export const fake = true;",
  );
  writeSource(
    root,
    "src/lib/terminalApi.ts",
    'import { invoke } from "@tauri-apps/api/core";\nvoid invoke;',
  );
}

function writeSource(root, relativePath, content) {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${content}\n`);
}

function baseline(entries) {
  return {
    schemaVersion: 1,
    entries,
  };
}

function writeBaseline(root, entries) {
  const filePath = path.join(root, baselineRelativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(baseline(entries), null, 2)}\n`);
}

function runVerifier(root, args = [], environment = {}) {
  const result = spawnSync(
    process.execPath,
    [
      verifier,
      "--repo-root",
      root,
      "--baseline",
      baselineRelativePath,
      ...args,
    ],
    { encoding: "utf8", env: { ...process.env, ...environment } },
  );
  return {
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
    status: result.status,
  };
}
