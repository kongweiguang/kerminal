// @author kongweiguang

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const verifier = path.join(repoRoot, "scripts", "verify-windows-release-package.mjs");

test("未提供安装包时通过发布前脚本检查", () => {
  const result = run([]);
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /"bundleInspection": "deferred"/);
});

test("缺少 NSIS 目录时拒绝包验证", () => {
  const missing = path.join(os.tmpdir(), `missing-kerminal-nsis-${Date.now()}`);
  const result = run(["--bundle-dir", missing]);
  assert.notEqual(result.status, 0);
  assert.match(result.output, /does not exist/);
});

test("伪造的小型 setup 可执行文件不能通过", (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "kerminal-nsis-fixture-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(path.join(directory, "kerminal_0.0.0_setup.exe"), Buffer.from("MZfake"));

  const result = run(["--bundle-dir", directory]);
  assert.notEqual(result.status, 0);
  assert.match(result.output, /unexpectedly small/);
});

test("没有 7-Zip 时可校验包含主程序的 NSIS 脚本", (context) => {
  const fixture = createNsisFixture(context);
  const result = run([
    "--bundle-dir",
    fixture.directory,
    "--seven-zip",
    path.join(fixture.directory, "missing-7z"),
    "--generated-nsis-script",
    fixture.script,
  ]);
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /"inspectionMode": "generated-nsis-script"/);
});

test("没有 7-Zip 时可校验 Tauri 的主程序路径宏", (context) => {
  const fixture = createNsisFixture(
    context,
    '!define MAINBINARYSRCPATH "C:\\\\build\\\\kerminal.exe"\nFile "${MAINBINARYSRCPATH}"\n',
  );
  const result = run([
    "--bundle-dir",
    fixture.directory,
    "--seven-zip",
    path.join(fixture.directory, "missing-7z"),
    "--generated-nsis-script",
    fixture.script,
  ]);
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /"inspectionMode": "generated-nsis-script"/);
});

test("发布门禁要求真实 archive inspection", (context) => {
  const fixture = createNsisFixture(context);
  const result = run([
    "--bundle-dir",
    fixture.directory,
    "--seven-zip",
    path.join(fixture.directory, "missing-7z"),
    "--generated-nsis-script",
    fixture.script,
    "--require-archive-inspection",
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.output, /7-Zip could not inspect/);
});

function createNsisFixture(
  context,
  source = 'File /a "/oname=kerminal.exe" "kerminal.exe"\n',
) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "kerminal-nsis-fixture-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const script = path.join(directory, "installer.nsi");
  fs.writeFileSync(script, source);
  const installer = path.join(directory, "kerminal_0.0.0_x64-setup.exe");
  const contents = Buffer.alloc(1024 * 1024 + 1);
  contents.write("MZ", 0, "ascii");
  fs.writeFileSync(installer, contents);
  const now = new Date(Date.now() + 1_000);
  fs.utimesSync(installer, now, now);
  return { directory, script };
}

function run(args) {
  const result = spawnSync(process.execPath, [verifier, ...args], { encoding: "utf8" });
  return {
    status: result.status,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}
