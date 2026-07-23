// @author kongweiguang

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const verifier = path.join(repoRoot, "scripts", "check-dead-code.mjs");
const baselinePath = "scripts/dead-code-baseline.json";
const configPath = "knip.config.mjs";

test("Knip baseline 拒绝新增未引用文件并要求同步清理已消失债务", (context) => {
  const fixture = createFixture(context);
  writeConfig(fixture);
  writeFile(fixture, "src/main.ts", 'import { used } from "./used";\nvoid used;');
  writeFile(fixture, "src/used.ts", "export const used = true;");
  writeFile(fixture, "src/unused.ts", "export const unused = true;");

  const bootstrap = runVerifier(fixture, ["--write-baseline"]);
  assert.equal(bootstrap.status, 0, bootstrap.output);
  const baseline = JSON.parse(
    fs.readFileSync(path.join(fixture, baselinePath), "utf8"),
  );
  assert.ok(
    baseline.entries.some(
      (entry) => entry.type === "files" && entry.name === "src/unused.ts",
    ),
  );
  assert.ok(baseline.entries.every((entry) => entry.owner && entry.targetTask));

  writeFile(fixture, "src/new-unused.ts", "export const value = true;");
  const growth = runVerifier(fixture);
  assert.equal(growth.status, 1, growth.output);
  assert.match(growth.output, /New dead-code debt/);
  assert.match(growth.output, /src\/new-unused\.ts/);

  fs.rmSync(path.join(fixture, "src/new-unused.ts"));
  fs.rmSync(path.join(fixture, "src/unused.ts"));
  const reduction = runVerifier(fixture);
  assert.equal(reduction.status, 1, reduction.output);
  assert.match(reduction.output, /Stale dead-code baseline/);
});

test("Knip reference baseline 阻止登记新的 dead-code 债务", (context) => {
  const fixture = createFixture(context);
  const reference = path.join(fixture, "reference.json");
  writeConfig(fixture);
  writeFile(fixture, "src/main.ts", "export const main = true;");
  writeFile(fixture, "src/unused.ts", "export const unused = true;");
  assert.equal(runVerifier(fixture, ["--write-baseline"]).status, 0);
  fs.writeFileSync(
    reference,
    `${JSON.stringify({ schemaVersion: 1, entries: [] }, null, 2)}\n`,
  );

  const result = runVerifier(fixture, ["--reference-baseline", reference]);

  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /Dead-code baseline regressed/);
  assert.match(result.output, /new-baseline-debt/);
});

test("tag push 不把不可达的旧 tag 对象当作参考提交", (context) => {
  const fixture = createFixture(context);
  writeConfig(fixture);
  writeFile(fixture, "src/main.ts", "export const main = true;");
  writeFile(fixture, "scripts/dead-code-baseline.json", JSON.stringify({ schemaVersion: 1, entries: [] }));
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
    path.join(os.tmpdir(), "kerminal-dead-code-fixture-"),
  );
  context.after(() => fs.rmSync(fixture, { force: true, recursive: true }));
  writeFile(
    fixture,
    "package.json",
    JSON.stringify({ name: "dead-code-fixture", private: true, type: "module" }),
  );
  return fixture;
}

function writeConfig(root) {
  writeFile(
    root,
    configPath,
    'export default { entry: ["src/main.ts"], project: ["src/**/*.ts"], include: ["files", "exports"] };',
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
