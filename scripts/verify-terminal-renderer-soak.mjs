#!/usr/bin/env node
// @author kongweiguang

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const args = parseArgs(process.argv.slice(2));
const durationMinutes = readPositiveNumber(
  args["duration-minutes"],
  30,
  "--duration-minutes",
);
const outputPath = path.resolve(
  repoRoot,
  args.output ??
    ".updeng/docs/verification/terminal-renderer-soak.json",
);
mkdirSync(path.dirname(outputPath), { recursive: true });
const startedAt = Date.now();
const result = await run(
  process.execPath,
  [
    "--expose-gc",
    "node_modules/vitest/vitest.mjs",
    "run",
    "--run",
    "--disableConsoleIntercept",
    "tests/frontend/features/terminal/terminalRendererContinuousSoak.test.ts",
  ],
  {
    ...process.env,
    TERMINAL_RENDERER_SOAK_DURATION_MS: String(durationMinutes * 60_000),
  },
);
process.stdout.write(result.stdout);
process.stderr.write(result.stderr);
const reportLine = result.stdout
  .split(/\r?\n/)
  .find((line) => line.includes("TERMINAL_RENDERER_SOAK_REPORT="));
const generatedReport =
  result.exitCode === 0 && reportLine
    ? JSON.parse(reportLine.split("TERMINAL_RENDERER_SOAK_REPORT=")[1])
    : {
        actualDurationMs: Date.now() - startedAt,
        cycles: 0,
        pass: false,
      };
const report = {
  ...generatedReport,
  requestedDurationMinutes: durationMinutes,
  pass: result.exitCode === 0 && generatedReport.pass === true,
};

writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(
  `Terminal renderer soak: ${report.pass ? "passed" : "failed"}, ${report.cycles ?? 0} continuous cycles.`,
);
console.log(`Report: ${path.relative(repoRoot, outputPath)}`);
process.exitCode = report.pass ? 0 : 1;

function parseArgs(rawArgs) {
  const parsed = {};
  for (let index = 0; index < rawArgs.length; index += 1) {
    const key = rawArgs[index];
    if (!key?.startsWith("--")) {
      continue;
    }
    const value = rawArgs[index + 1];
    if (!value || value.startsWith("--")) {
      parsed[key.slice(2)] = true;
      continue;
    }
    parsed[key.slice(2)] = value;
    index += 1;
  }
  return parsed;
}

function readPositiveNumber(value, fallback, label) {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive number.`);
  }
  return parsed;
}

function run(command, commandArgs, env) {
  return new Promise((resolve) => {
    const child = spawn(command, commandArgs, {
      cwd: repoRoot,
      env,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("close", (exitCode) => {
      resolve({ exitCode: exitCode ?? 1, stderr, stdout });
    });
  });
}
