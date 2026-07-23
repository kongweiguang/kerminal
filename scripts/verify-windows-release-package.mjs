#!/usr/bin/env node
// @author kongweiguang

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  readOption("--repo-root") || fileURLToPath(new URL("..", import.meta.url)),
);
const bundleDir = readOption("--bundle-dir");
const requireUpdaterSignature = process.argv.includes("--require-updater-signature");
const requireArchiveInspection = process.argv.includes("--require-archive-inspection");

main();

// 无 bundle 参数时仅验证脚本可运行；CI 产包后再检查真实 NSIS 和 updater 签名。
function main() {
  const report = bundleDir
    ? verifyNsisBundle(path.resolve(repoRoot, bundleDir))
    : { bundleInspection: "deferred" };
  console.log(`Windows release package verified.\n${JSON.stringify(report, null, 2)}`);
}

function verifyNsisBundle(directory) {
  if (!fs.existsSync(directory)) {
    fail(`NSIS bundle directory does not exist: ${directory}`);
  }
  const installers = walkFiles(directory).filter(
    (file) => file.toLowerCase().endsWith("-setup.exe") || file.toLowerCase().endsWith("_setup.exe"),
  );
  if (installers.length !== 1) {
    fail(`expected exactly one NSIS installer, got ${installers.length}`);
  }
  const installer = installers[0];
  assertPortableExecutable(installer, "NSIS installer");
  if (fs.statSync(installer).size < 1024 * 1024) {
    fail("NSIS installer is unexpectedly small");
  }

  const listing = listArchive(installer);
  const inspectionMode = listing
    ? verifyArchiveListing(listing)
    : verifyGeneratedNsisScript(installer);
  const signature = `${installer}.sig`;
  if (requireUpdaterSignature && (!fs.existsSync(signature) || fs.statSync(signature).size === 0)) {
    fail("NSIS updater signature is missing or empty");
  }
  return {
    installer: relative(installer),
    installerSha256: sha256(installer),
    updaterSignature: fs.existsSync(signature) ? relative(signature) : null,
    inspectionMode,
  };
}

function listArchive(installer) {
  const executable = readOption("--seven-zip") || "7z";
  const result = spawnSync(executable, ["l", "-slt", installer], { encoding: "utf8" });
  if (result.error?.code === "ENOENT" && !requireArchiveInspection) {
    return null;
  }
  if (result.error || result.status !== 0) {
    fail(`7-Zip could not inspect the NSIS installer: ${result.error?.message ?? result.stderr}`);
  }
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

function verifyArchiveListing(listing) {
  if (!listing.toLowerCase().includes("kerminal.exe")) {
    fail("NSIS installer does not contain kerminal.exe");
  }
  return "archive";
}

// 本地没有 7-Zip 时检查 Tauri 生成的 NSIS 输入；发布 CI 禁止该降级。
function verifyGeneratedNsisScript(installer) {
  const configured = readOption("--generated-nsis-script");
  const script = path.resolve(
    repoRoot,
    configured || path.join("src-tauri", "target", "release", "nsis", "x64", "installer.nsi"),
  );
  if (!fs.existsSync(script)) {
    fail(`generated NSIS script does not exist: ${script}`);
  }
  if (fs.statSync(installer).mtimeMs < fs.statSync(script).mtimeMs) {
    fail("NSIS installer is older than the generated installer script");
  }
  const source = fs.readFileSync(script, "utf8");
  const fileCommands = source.match(/^\s*File\s+[^\r\n]+$/gim) ?? [];
  const directMainBinary = fileCommands.some((command) =>
    /"(?:[^"\r\n]*[\\/])?kerminal\.exe"/i.test(command),
  );
  const tauriMainBinary =
    /^\s*!define\s+MAINBINARYSRCPATH\s+"(?:[^"\r\n]*[\\/])?kerminal\.exe"\s*$/im.test(source) &&
    fileCommands.some((command) => /"\$\{MAINBINARYSRCPATH\}"/i.test(command));
  if (!directMainBinary && !tauriMainBinary) {
    fail("generated NSIS script does not package kerminal.exe");
  }
  return "generated-nsis-script";
}

function assertPortableExecutable(file, label) {
  if (!fs.existsSync(file)) {
    fail(`${label} does not exist: ${file}`);
  }
  const descriptor = fs.openSync(file, "r");
  try {
    const magic = Buffer.alloc(2);
    fs.readSync(descriptor, magic, 0, magic.length, 0);
    if (magic.toString("ascii") !== "MZ") {
      fail(`${label} is not a Windows PE executable`);
    }
  } finally {
    fs.closeSync(descriptor);
  }
}

function walkFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walkFiles(target) : entry.isFile() ? [target] : [];
  });
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function relative(file) {
  return path.relative(repoRoot, file).replaceAll("\\", "/");
}

function readOption(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return "";
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) fail(`${name} requires a value`);
  return value;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
